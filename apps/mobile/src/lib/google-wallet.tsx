import { providerSigningSession, providerVaultSecret, type WalletProviderRpc } from '@kova/monad'
import { PrivyProvider, useEmbeddedEthereumWallet, useLoginWithOAuth, usePrivy } from '@privy-io/expo'
import { PrivyElements } from '@privy-io/expo/ui'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { type Address, type LocalAccount, getAddress, isAddressEqual } from 'viem'
import { network, networkId, privyAppId, privyClientId } from './config'
import { endSession } from './session'

export interface GoogleConnection {
  session: { end(): void }
  account: LocalAccount
  vaultSecret: Uint8Array
  name: string
  email: string
}

interface GoogleWallet {
  enabled: boolean
  busy: boolean
  connect(expected?: Address): Promise<GoogleConnection>
  logout(): Promise<void>
}

const unavailable: GoogleWallet = {
  enabled: false, busy: false,
  connect: async () => { throw new Error('Google sign-in is not configured for this build.') },
  logout: async () => {},
}
const Context = createContext<GoogleWallet>(unavailable)
export const useGoogleWallet = () => useContext(Context)

export function GoogleWalletProvider({ children }: { children: ReactNode }) {
  if (!privyAppId || !privyClientId) return children
  return (
    <PrivyProvider appId={privyAppId} clientId={privyClientId} supportedChains={[network.chain as never]}>
      <GoogleSession>{children}</GoogleSession>
      <PrivyElements config={{
        appearance: { colorScheme: 'light', accentColor: '#d46558' },
        mfa: { enableMfaVerificationUIs: true },
      }} />
    </PrivyProvider>
  )
}

function GoogleSession({ children }: { children: ReactNode }) {
  const privy = usePrivy()
  const embedded = useEmbeddedEthereumWallet()
  const { login } = useLoginWithOAuth()
  const latest = useRef({ privy, embedded })
  latest.current = { privy, embedded }
  const active = useRef(false)
  const generation = useRef(0)
  const [busy, setBusy] = useState(false)
  const previousUserId = useRef(privy.user?.id)
  const connection = useRef<GoogleConnection | null>(null)
  useEffect(() => {
    if (previousUserId.current !== privy.user?.id && connection.current) {
      connection.current.session.end()
      connection.current.vaultSecret.fill(0)
      connection.current = null
      endSession()
    }
    previousUserId.current = privy.user?.id
  }, [privy.user?.id])

  const connect = useCallback(async (expected?: Address): Promise<GoogleConnection> => {
    if (active.current) throw new Error('Finish the current sign-in first.')
    active.current = true
    setBusy(true)
    const version = generation.current
    const waitFor = async (ready: () => boolean) => {
      const until = Date.now() + 30_000
      while (!ready()) {
        if (version !== generation.current) throw new Error('Sign-in was cancelled.')
        if (Date.now() > until) throw new Error('Google sign-in took too long. Check your connection and try again.')
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
    try {
      await waitFor(() => latest.current.privy.isReady)
      let google = latest.current.privy.user?.linked_accounts.find((a) => a.type === 'google_oauth')
      if (!google) {
        if (latest.current.privy.user) await latest.current.privy.logout()
        const signedIn = await login({ provider: 'google' })
        if (!signedIn) throw new Error('Google sign-in was cancelled.')
        await waitFor(() => Boolean(latest.current.privy.user?.linked_accounts.some((a) => a.type === 'google_oauth')))
        google = latest.current.privy.user?.linked_accounts.find((a) => a.type === 'google_oauth')
      }
      if (!google || google.type !== 'google_oauth') throw new Error('Choose a Google account to open your wallet.')
      const userId = latest.current.privy.user?.id
      if (!latest.current.embedded.wallets.length) {
        await latest.current.embedded.create()
        await waitFor(() => latest.current.embedded.wallets.length > 0)
      }
      const wallet = [...latest.current.embedded.wallets].sort((a, b) => a.walletIndex - b.walletIndex)[0]
      if (!wallet) throw new Error('Your Google wallet is not ready. Try again.')
      if (expected && !isAddressEqual(getAddress(wallet.address), expected)) {
        await latest.current.privy.logout()
        throw new Error('This Google account opens a different wallet. Use the Google account you originally chose.')
      }
      const provider = await wallet.getProvider()
      // Privy and the shared package ship separate viem declaration versions. The boundary is
      // the standard JSON-RPC interface, rather than their recursive generic provider types.
      const signed = providerSigningSession(getAddress(wallet.address), provider as unknown as WalletProviderRpc, networkId)
      try {
        const vaultSecret = await providerVaultSecret(signed.account)
        if (version !== generation.current || latest.current.privy.user?.id !== userId) {
          vaultSecret.fill(0)
          throw new Error('Your Google account changed. Sign in again.')
        }
        const value = { session: signed.session, account: signed.account as unknown as LocalAccount,
          vaultSecret, name: google.name ?? '', email: google.email ?? '' }
        connection.current = value
        return value
      } catch (error) { signed.session.end(); throw error }
    } finally { active.current = false; setBusy(false) }
  }, [login])

  const logout = useCallback(async () => {
    generation.current++
    connection.current?.session.end()
    connection.current?.vaultSecret.fill(0)
    connection.current = null
    await latest.current.privy.logout()
  }, [])

  return <Context.Provider value={{ enabled: true, busy, connect, logout }}>{children}</Context.Provider>
}
