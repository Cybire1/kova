import { type Address, getAddress, type Hex, hexToBigInt, keccak256, toHex } from 'viem'

/**
 * Spending keys: a key that spends a wallet's dollars short of the wallet itself (an allowance on
 * someone's phone, a team member's budget, an AI agent's key Kova holds). Each is linked to the
 * owner's wallet through the KovaCard contract, exactly like a Kova Card: the chain caps what it
 * can spend in a day and stops it when frozen, and Kova checks the rest before it cosigns.
 */

export const KEY_DAY = 86_400
export const KEY_WEEK = 604_800

/**
 * allowance and team: a key on someone's own device; agent: a key Kova holds for an AI agent;
 * site: a key Kova for Chrome holds for one website, so the site gets a budget, never the wallet.
 */
export type KeyKind = 'allowance' | 'team' | 'agent' | 'site'

/**
 * What the recipient's wallet signs to make an allowance's (or a team member's) key. The key is
 * the hash of that signature, so it is never stored: the same passkey makes the same key again on
 * any phone or browser it opens, and nobody else can make it.
 */
export function spendKeyMessage(input: { keyId: string; owner: Address; holder: Address }): string {
  return [
    'Kova spending key',
    `Key: ${input.keyId}`,
    `From: ${getAddress(input.owner)}`,
    `For: ${getAddress(input.holder)}`,
    'Signing this makes the key on this device. It moves no money.',
  ].join('\n')
}

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n

/** The private key a spendKeyMessage signature makes: keccak256 of it, kept inside the curve. */
export function spendKeyFromSignature(signature: Hex): Hex {
  let key = keccak256(signature)
  while (hexToBigInt(key) === 0n || hexToBigInt(key) >= SECP256K1_N) key = keccak256(key)
  return toHex(hexToBigInt(key), { size: 32 })
}

/** The owner's yes or no to one payment an agent asked for, signed with their wallet. */
export function keyApprovalMessage(input: {
  owner: Address
  paymentId: string
  decision: 'approve' | 'decline'
  amount: string
  to: string
}): string {
  return [
    input.decision === 'approve' ? 'Kova: approve this payment' : 'Kova: decline this payment',
    `Payment: ${input.paymentId}`,
    `Amount: $${input.amount}`,
    `To: ${input.to}`,
    `Wallet: ${getAddress(input.owner)}`,
  ].join('\n')
}

/** Cancelling a key nobody has switched on yet (an invite, or an agent not yet linked). */
export function keyRemoveMessage(input: { owner: Address; keyId: string }): string {
  return [
    'Kova: remove this key',
    `Key: ${input.keyId}`,
    `Wallet: ${getAddress(input.owner)}`,
  ].join('\n')
}

/**
 * What a key signs to freeze itself (Kova for Chrome's freeze switch): Kova stops cosigning for it at
 * once. Only the owner's wallet can switch it back on. `at` is unix seconds, so an old one can't be
 * replayed later.
 */
export function keySelfFreezeMessage(input: { keyId: string; at: number }): string {
  return ['Kova: freeze this key', `Key: ${input.keyId}`, `At: ${input.at}`].join('\n')
}

/** A website as a budget is named: its host, lowercase, without a port's default or a path. */
export function siteName(origin: string): string | null {
  try {
    const url = new URL(origin)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.host.toLowerCase().slice(0, 80)
  } catch {
    return null
  }
}

/**
 * What the wallet signs to connect Kova for Chrome (mykova.app/extension): proof this wallet said
 * yes to this browser. It moves no money; each website still needs a budget the wallet approves.
 */
export function extensionConnectMessage(input: { wallet: Address; at: number }): string {
  return [
    'Kova for Chrome: connect this browser',
    `Wallet: ${getAddress(input.wallet)}`,
    `At: ${input.at}`,
    'This moves no money. Each website still needs a budget you approve.',
  ].join('\n')
}
