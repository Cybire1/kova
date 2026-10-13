import { type Address, getAddress, type Hex, hexToBigInt, keccak256, toHex } from 'viem'

/**
 * Spending keys: a key that spends a wallet's dollars short of the wallet itself (an allowance on
 * someone's phone, a team member's budget, an AI agent's key Kova holds). Each is linked to the
 * owner's wallet through the KovaCard contract, exactly like a Kova Card: the chain caps what it
 * can spend in a day and stops it when frozen, and Kova checks the rest before it cosigns.
 */

export const KEY_DAY = 86_400
export const KEY_WEEK = 604_800

export type KeyKind = 'allowance' | 'team' | 'agent'

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
  return ['Kova: remove this key', `Key: ${input.keyId}`, `Wallet: ${getAddress(input.owner)}`].join('\n')
}
