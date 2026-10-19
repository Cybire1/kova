'use client'

import type { providerSigningSession } from '@kova/monad'
import type { Address } from 'viem'

export interface GoogleConnection extends ReturnType<typeof providerSigningSession> {
  vaultSecret: Uint8Array
  email: string
  name: string
  resumed: boolean
}

interface GoogleBridge {
  connect(expected?: Address): Promise<GoogleConnection>
}

let bridge: GoogleBridge | null = null

/** Also used by the business and private-takings screens outside the wallet layout. */
export function registerGoogleWallet(value: GoogleBridge) {
  bridge = value
  return () => {
    if (bridge === value) bridge = null
  }
}

export function openGoogleWallet(expected?: Address) {
  if (!bridge) throw new Error('Google sign-in is not available. Reload Kova and try again.')
  return bridge.connect(expected)
}
