import type { PasskeyCredentialMetadata } from '@category-labs/mera'
import { getAddress, isAddressEqual } from 'viem'
import { openGoogleWallet } from '@/lib/google-wallet'
import { openKovaPasskey, openSigningSession, passkeyProblem } from '@/lib/passkey'

export interface WalletIdentity {
  address: string
  name: string
  passkey?: PasskeyCredentialMetadata
  auth?: 'google'
}

/** The business screens use the wallet's chosen sign-in method too. */
export async function openWalletSigner(owner: WalletIdentity) {
  if (owner.auth === 'google') {
    if (!window.confirm('Unlock your Google wallet to approve this action?'))
      throw new Error('Cancelled. Nothing was signed.')
    const { session, account } = await openGoogleWallet(getAddress(owner.address))
    return { session, account }
  }
  const asserted = await openKovaPasskey(owner.passkey).catch((error) => {
    throw new Error(passkeyProblem(error))
  })
  const signed = await openSigningSession(asserted.prfOutput)
  if (!isAddressEqual(signed.account.address, getAddress(owner.address))) {
    signed.session.end()
    throw new Error('That passkey opens a different Kova wallet. Choose the one for this wallet.')
  }
  return signed
}
