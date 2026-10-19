'use client'

import { useCreateWallet, useLogin, usePrivy, useWallets } from '@privy-io/react-auth'
import { useEffect, useRef, useState } from 'react'
import { returningFromPrivy } from '@/lib/privy-return'

/**
 * A wallet for people who don't have one: log in with email or Google, and Privy makes an
 * embedded wallet on the spot, with nothing to install. It hands back a standard EIP-1193
 * provider, so paying with it is the same signed authorization as any other wallet, and Kova's
 * relayer pays the gas. A shop's owner signs in to Kova with the same wallet.
 *
 * Loaded only when someone asks for it (next/dynamic), so the pay page stays light on a phone
 * that just scanned a code. The provider must stay mounted while the wallet is in use: the
 * embedded wallet lives inside it. Google sends people away and back, so a page that comes back
 * from Google mounts this straight away, and it finishes the sign-in rather than starting one.
 */

export interface EmbeddedWallet {
  address: `0x${string}`
  provider: { request(args: { method: string; params?: unknown }): Promise<unknown> }
  /** How they signed in, to show them: an email address, or "Google". */
  signedInAs: string
  /** Ends the Privy session on this browser, so the next person here isn't signed in as them. */
  logout: () => Promise<void>
}

interface Props {
  appId: string
  chainId: number
  onWallet: (wallet: EmbeddedWallet) => void
  onCancel: () => void
  /** The heading on Privy's sign-in. */
  title?: string
  /** Ask who they are even if someone is still signed in to Privy here. */
  fresh?: boolean
}

export default function PrivyWallet({ onWallet, onCancel, fresh = false }: Props) {
  return <Connect onWallet={onWallet} onCancel={onCancel} fresh={fresh} />
}

function Connect({
  onWallet,
  onCancel,
  fresh,
}: Pick<Props, 'onWallet' | 'onCancel'> & { fresh: boolean }) {
  const { ready, authenticated, user, logout } = usePrivy()
  const { wallets, ready: walletsReady } = useWallets()
  const { createWallet } = useCreateWallet()
  const creating = useRef(false)
  // Back from Google: Privy is finishing that sign-in, so neither start another nor end it.
  const [resuming] = useState(returningFromPrivy)
  // In fresh mode, whoever was signed in before is signed out before anything is delivered.
  const [cleared, setCleared] = useState(!fresh || resuming)
  const clearing = useRef(false)
  const asked = useRef(false)
  const delivered = useRef(false)
  // Closing Privy's sign-in without finishing counts as changing their mind.
  const { login } = useLogin({ onError: () => !delivered.current && onCancel() })

  useEffect(() => {
    if (!ready || cleared || clearing.current) return
    if (!authenticated) {
      setCleared(true)
      return
    }
    clearing.current = true
    void logout().finally(() => setCleared(true))
  }, [ready, authenticated, cleared, logout])

  // Open Privy's sign-in once it's ready, unless they're already signed in or coming back from Google.
  useEffect(() => {
    if (!ready || !cleared || authenticated || resuming || asked.current) return
    asked.current = true
    login()
  }, [ready, cleared, authenticated, resuming, login])

  // The embedded wallet appears moments after sign-in.
  useEffect(() => {
    if (!cleared || !authenticated || !walletsReady || delivered.current) return
    const embedded = wallets.filter((w) => w.walletClientType === 'privy')
      .sort((a, b) => (a.walletIndex ?? 0) - (b.walletIndex ?? 0))[0]
    if (!embedded) {
      if (!creating.current) {
        creating.current = true
        void createWallet().catch(onCancel).finally(() => { creating.current = false })
      }
      return
    }
    delivered.current = true
    void embedded.getEthereumProvider().then((provider) =>
      onWallet({
        address: embedded.address as `0x${string}`,
        provider,
        signedInAs: user?.email?.address ?? user?.google?.email ?? 'your email',
        logout,
      }),
    ).catch(onCancel)
  }, [cleared, authenticated, walletsReady, wallets, user, onWallet, logout, createWallet, onCancel])

  return null
}
