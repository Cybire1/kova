'use client'

import { type NetworkId, providerSigningSession, providerVaultSecret } from '@kova/monad'
import {
  PrivyProvider,
  useCreateWallet,
  useLoginWithOAuth,
  usePrivy,
  useWallets,
} from '@privy-io/react-auth'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { type Address, getAddress, isAddress, isAddressEqual } from 'viem'
import { monad, monadTestnet } from 'viem/chains'
import { type GoogleConnection, registerGoogleWallet } from '@/lib/google-wallet'
import { returningFromPrivy } from '@/lib/privy-return'
import { endSession } from '@/lib/wallet/session'

const PENDING = 'kova.google.signin.v1'
type Pending = { expected?: Address; network: NetworkId; startedAt: number }
type Request = { resolve(value: GoogleConnection): void; reject(error: Error): void }

interface GoogleWalletState {
  enabled: boolean
  busy: boolean
  error: string | null
  connection: GoogleConnection | null
  connect(expected?: Address): Promise<GoogleConnection>
  logout(): Promise<void>
}

const unavailable: GoogleWalletState = {
  enabled: false,
  busy: false,
  error: null,
  connection: null,
  connect: async () => {
    throw new Error('Google sign-in is not configured.')
  },
  logout: async () => {},
}
const GoogleWalletContext = createContext<GoogleWalletState>(unavailable)
export const useGoogleWallet = () => useContext(GoogleWalletContext)

/** One Privy provider for wallet, checkout, and shop sign-in, so they share the same identity. */
export function GoogleWalletProvider({
  appId,
  network,
  children,
}: {
  appId: string | null
  network: NetworkId
  children: React.ReactNode
}) {
  if (!appId) return children
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ['google', 'email'],
        defaultChain: network === 'mainnet' ? monad : monadTestnet,
        supportedChains: [monad, monadTestnet],
        appearance: { theme: 'light', accentColor: '#d46558', landingHeader: 'Your Kova wallet' },
        embeddedWallets: { ethereum: { createOnLogin: 'off' }, showWalletUIs: false },
      }}
    >
      <GoogleSession network={network}>{children}</GoogleSession>
    </PrivyProvider>
  )
}

function savedPending(): Pending | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING) ?? 'null') as Pending | null
    if (
      !value ||
      (value.network !== 'mainnet' && value.network !== 'testnet') ||
      typeof value.startedAt !== 'number' ||
      Date.now() - value.startedAt > 10 * 60_000 ||
      (value.expected !== undefined && !isAddress(value.expected))
    )
      return null
    return value
  } catch {
    return null
  }
}
function clearPending() {
  try {
    sessionStorage.removeItem(PENDING)
  } catch {}
}

function GoogleSession({ network, children }: { network: NetworkId; children: React.ReactNode }) {
  const { ready, authenticated, user, logout: privyLogout } = usePrivy()
  const { wallets, ready: walletsReady } = useWallets()
  const { createWallet } = useCreateWallet()
  const [pending, setPending] = useState<Pending | null>(null)
  const [connection, setConnection] = useState<GoogleConnection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const request = useRef<Request | null>(null)
  const asked = useRef(false)
  const delivering = useRef(false)
  const creating = useRef(false)
  const signingOut = useRef(false)
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  const userIdRef = useRef(user?.id)
  userIdRef.current = user?.id
  const previousUserId = useRef(user?.id)

  useEffect(() => {
    if (previousUserId.current !== user?.id && connection) {
      connection.session.end()
      connection.vaultSecret.fill(0)
      endSession()
      setConnection(null)
    }
    previousUserId.current = user?.id
  }, [user?.id, connection])

  const fail = useCallback((reason: unknown) => {
    const error =
      reason instanceof Error ? reason : new Error('Google sign-in was cancelled. Try again.')
    request.current?.reject(error)
    request.current = null
    clearPending()
    setPending(null)
    setError(error.message)
    asked.current = false
    delivering.current = false
  }, [])
  const { initOAuth } = useLoginWithOAuth({ onError: fail })

  useEffect(() => {
    const saved = savedPending()
    if (!saved) return
    if (saved.network !== network || !returningFromPrivy()) {
      clearPending()
      return
    }
    setPending(saved)
  }, [network])

  const connect = useCallback(
    (expected?: Address) => {
      if (request.current || signingOut.current)
        return Promise.reject(new Error('Finish the current sign-in first.'))
      const next: Pending = { network, startedAt: Date.now(), ...(expected ? { expected } : {}) }
      setError(null)
      asked.current = false
      delivering.current = false
      try {
        sessionStorage.setItem(PENDING, JSON.stringify(next))
      } catch {}
      return new Promise<GoogleConnection>((resolve, reject) => {
        request.current = { resolve, reject }
        setPending(next)
      })
    },
    [network],
  )

  useEffect(() => registerGoogleWallet({ connect }), [connect])

  useEffect(() => {
    if (!pending || !ready || delivering.current) return
    if (!authenticated || !user?.google) {
      if (!authenticated && returningFromPrivy()) return
      if (asked.current) return
      asked.current = true
      void (async () => {
        if (authenticated) await privyLogout()
        await initOAuth({ provider: 'google' })
      })().catch(fail)
      return
    }
    if (!walletsReady) return
    const wallet = wallets
      .filter((w) => w.walletClientType === 'privy')
      .sort((a, b) => (a.walletIndex ?? 0) - (b.walletIndex ?? 0))[0]
    if (!wallet) {
      if (!creating.current) {
        creating.current = true
        void createWallet()
          .catch(fail)
          .finally(() => {
            creating.current = false
          })
      }
      return
    }
    if (pending.expected && !isAddressEqual(getAddress(wallet.address), pending.expected)) {
      signingOut.current = true
      void privyLogout()
        .catch(() => {})
        .finally(() => {
          signingOut.current = false
        })
      fail(
        new Error(
          'This Google account opens a different wallet. Use the Google account you originally chose.',
        ),
      )
      return
    }
    delivering.current = true
    void (async () => {
      const provider = await wallet.getEthereumProvider()
      const signed = providerSigningSession(getAddress(wallet.address), provider, network)
      try {
        const vaultSecret = await providerVaultSecret(signed.account)
        if (pendingRef.current !== pending || signingOut.current) {
          signed.session.end()
          vaultSecret.fill(0)
          return
        }
        if (userIdRef.current !== user.id) {
          vaultSecret.fill(0)
          throw new Error('Your Google account changed. Sign in again.')
        }
        const value: GoogleConnection = {
          ...signed,
          vaultSecret,
          email: user.google?.email ?? '',
          name: user.google?.name ?? '',
          resumed: request.current === null,
        }
        setConnection(value)
        clearPending()
        setPending(null)
        request.current?.resolve(value)
        request.current = null
      } catch (error) {
        signed.session.end()
        if (pendingRef.current === pending) fail(error)
      }
    })().catch(fail)
  }, [
    pending,
    ready,
    authenticated,
    user,
    walletsReady,
    wallets,
    network,
    createWallet,
    initOAuth,
    privyLogout,
    fail,
  ])

  const logout = useCallback(async () => {
    signingOut.current = true
    connection?.session.end()
    connection?.vaultSecret.fill(0)
    setConnection(null)
    clearPending()
    fail(new Error('Signed out.'))
    setError(null)
    try {
      await privyLogout()
    } finally {
      signingOut.current = false
    }
  }, [connection, fail, privyLogout])

  return (
    <GoogleWalletContext.Provider
      value={{
        enabled: true,
        busy: pending !== null,
        error,
        connection,
        connect,
        logout,
      }}
    >
      {children}
    </GoogleWalletContext.Provider>
  )
}
