import type { Address } from 'viem'

/**
 * USSD pockets: a small dollar balance a wallet sets aside to pay from any phone by dialling a
 * code. The wallet's owner approves every change to their pocket by signing one of these
 * messages with their passkey; Kova checks the signature and that it is newer than the last.
 */

export type PocketAction = 'setup' | 'update' | 'withdraw' | 'close'

export interface PocketChange {
  action: PocketAction
  wallet: Address
  /** E.164, e.g. +254711000111. */
  phone?: string
  /** The cap, in base units (6 decimals): the most the pocket may hold or spend in a day. */
  cap?: bigint
  /** For withdraw: how much to take back, in base units. */
  amount?: bigint
  /** Unix seconds. */
  signedAt: number
}

/** The exact text a wallet signs to approve a change to its USSD pocket. */
export function pocketMessage(change: PocketChange): string {
  const lines = [
    'Kova USSD pocket',
    `Action ${change.action}`,
    `Wallet ${change.wallet.toLowerCase()}`,
  ]
  if (change.phone !== undefined) lines.push(`Phone ${change.phone}`)
  if (change.cap !== undefined) lines.push(`Cap ${change.cap}`)
  if (change.amount !== undefined) lines.push(`Amount ${change.amount}`)
  lines.push(`Signed at ${change.signedAt}`)
  return lines.join('\n')
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
