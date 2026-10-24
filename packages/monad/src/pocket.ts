import { type Address, encodeAbiParameters, type Hex, keccak256, parseAbiParameters } from 'viem'

/**
 * USSD pockets: a small dollar balance a wallet sets aside to pay from any phone by dialling a
 * code. The wallet's owner approves every change to their pocket by signing one of these
 * messages with their passkey; Kova checks the signature and that it is newer than the last.
 */

export type PocketAction = 'setup' | 'update' | 'withdraw' | 'close' | 'payout'

export interface PocketChange {
  action: PocketAction
  wallet: Address
  chainId: number
  /** E.164, e.g. +254711000111. */
  phone?: string
  /** The daily spending limit, in base units (6 decimals). */
  cap?: bigint
  /** Binds a PIN change without exposing the PIN or its secret random nonce to the signer. */
  pinCommitment?: Hex
  /** For withdraw: how much to take back, in base units. */
  amount?: bigint
  /** For payout: the bank (Paystack's code) and account the pocket cashes out to. Neither: remove it. */
  bankCode?: string
  accountNumber?: string
  /** Unix seconds. */
  signedAt: number
}

/** The exact text a wallet signs to approve a change to its USSD pocket. */
export function pocketMessage(change: PocketChange): string {
  const lines = [
    'Kova USSD pocket v2',
    `Chain ${change.chainId}`,
    `Action ${change.action}`,
    `Wallet ${change.wallet.toLowerCase()}`,
  ]
  if (change.phone !== undefined) lines.push(`Phone ${change.phone}`)
  if (change.cap !== undefined) lines.push(`Cap ${change.cap}`)
  if (change.amount !== undefined) lines.push(`Amount ${change.amount}`)
  if (change.pinCommitment !== undefined) lines.push(`PIN commitment ${change.pinCommitment}`)
  if (change.bankCode !== undefined) lines.push(`Bank ${change.bankCode}`)
  if (change.accountNumber !== undefined) lines.push(`Account ${change.accountNumber}`)
  lines.push(`Signed at ${change.signedAt}`)
  return lines.join('\n')
}

/** The nonce goes only to the API over HTTPS, never into the signed message or public storage. */
export function pocketPinCommitment(
  wallet: Address,
  chainId: number,
  pin: string,
  nonce: Hex,
): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters('address, uint256, string, bytes32'), [
      wallet,
      BigInt(chainId),
      pin,
      nonce,
    ]),
  )
}

/** A phone number in E.164, or null. Accepts spaces and dashes; needs the country code. */
export function normalizePhone(input: string): string | null {
  const digits = input.trim().replace(/[\s()-]/g, '')
  const e164 = digits.startsWith('00') ? `+${digits.slice(2)}` : digits
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null
}

/** A PIN is 4 to 6 digits, and not one a stranger would guess first. */
export function pinProblem(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) return 'A PIN is 4 to 6 digits.'
  if (/^(\d)\1+$/.test(pin)) return 'Pick a PIN that isn’t one digit repeated.'
  if ('0123456789'.includes(pin) || '9876543210'.includes(pin))
    return 'Pick a PIN that isn’t a run of digits.'
  return null
}
