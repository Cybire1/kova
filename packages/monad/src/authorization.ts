import { type Address, getAddress, type Hex, isAddress, isHex, parseSignature, toHex } from 'viem'
import type { Token } from './tokens.js'

/**
 * EIP-3009 "transfer with authorization": the payer signs a transfer off-chain (EIP-712) and
 * anyone can submit it. On Monad that makes Kova payments gasless: the payer's phone signs,
 * Kova's relayer submits and pays the MON gas.
 *
 * The authorization's 32-byte nonce carries the Kova memo of the charge it pays. The token
 * emits AuthorizationUsed(authorizer, nonce) beside the Transfer, which ties the payment to
 * its charge exactly as TransferWithMemo does on Tempo, and makes each charge payable once.
 */
export const eip3009Abi = [
  {
    type: 'function',
    name: 'transferWithAuthorization',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'authorizationState',
    stateMutability: 'view',
    inputs: [
      { name: 'authorizer', type: 'address' },
      { name: 'nonce', type: 'bytes32' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'event',
    name: 'AuthorizationUsed',
    inputs: [
      { name: 'authorizer', type: 'address', indexed: true },
      { name: 'nonce', type: 'bytes32', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
] as const

/** Agora's testnet faucet: requestFunds(recipient) sends 10,000 AUSD. */
export const faucetAbi = [
  {
    type: 'function',
    name: 'requestFunds',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'recipient', type: 'address' }],
    outputs: [],
  },
] as const

export const transferAuthorizationTypes = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const

export interface TransferAuthorization {
  from: Address
  to: Address
  value: bigint
  /** Unix seconds. 0 means valid at once. */
  validAfter: bigint
  /** Unix seconds after which it can no longer be used. */
  validBefore: bigint
  /** The Kova memo of the charge it pays, or random bytes for a plain send. */
  nonce: Hex
}

/** The EIP-712 payload a wallet signs to authorize one transfer of `token`. */
export function transferAuthorizationTypedData(
  token: Token,
  chainId: number,
  message: TransferAuthorization,
) {
  return {
    domain: {
      name: token.domain.name,
      version: token.domain.version,
      chainId,
      verifyingContract: token.address,
    },
    types: transferAuthorizationTypes,
    primaryType: 'TransferWithAuthorization' as const,
    message,
  }
}

/** JSON-safe form of an authorization, as the app sends it to Kova's relayer. */
export interface SignedAuthorization {
  token: Address
  from: Address
  to: Address
  value: string
  validAfter: string
  validBefore: string
  nonce: Hex
  signature: Hex
}

export function toSignedAuthorization(
  token: Address,
  authorization: TransferAuthorization,
  signature: Hex,
): SignedAuthorization {
  return {
    token,
    from: authorization.from,
    to: authorization.to,
    value: authorization.value.toString(),
    validAfter: authorization.validAfter.toString(),
    validBefore: authorization.validBefore.toString(),
    nonce: authorization.nonce,
    signature,
  }
}

const UINT = /^\d{1,78}$/

/** Reads an authorization off the wire. Returns null for anything malformed rather than guessing. */
export function parseSignedAuthorization(
  input: unknown,
): { token: Address; authorization: TransferAuthorization; signature: Hex } | null {
  if (!input || typeof input !== 'object') return null
  const a = input as Record<string, unknown>
  const addr = (v: unknown) =>
    typeof v === 'string' && isAddress(v, { strict: false }) ? getAddress(v) : null
  const uint = (v: unknown) =>
    typeof v === 'string' && UINT.test(v)
      ? BigInt(v)
      : typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
        ? BigInt(v)
        : null
  const token = addr(a.token)
  const from = addr(a.from)
  const to = addr(a.to)
  const value = uint(a.value)
  const validAfter = uint(a.validAfter)
  const validBefore = uint(a.validBefore)
  const nonce =
    typeof a.nonce === 'string' && isHex(a.nonce) && a.nonce.length === 66
      ? (a.nonce.toLowerCase() as Hex)
      : null
  const signature =
    typeof a.signature === 'string' && isHex(a.signature) && a.signature.length === 132
      ? (a.signature as Hex)
      : null
  if (
    !token ||
    !from ||
    !to ||
    value === null ||
    validAfter === null ||
    validBefore === null ||
    !nonce ||
    !signature
  )
    return null
  return { token, authorization: { from, to, value, validAfter, validBefore, nonce }, signature }
}

/** The arguments of transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, v, r, s). */
export function transferWithAuthorizationArgs(
  authorization: TransferAuthorization,
  signature: Hex,
) {
  const { r, s, v, yParity } = parseSignature(signature)
  const recovery = Number(v ?? BigInt(yParity + 27))
  return [
    authorization.from,
    authorization.to,
    authorization.value,
    authorization.validAfter,
    authorization.validBefore,
    authorization.nonce,
    recovery,
    r,
    s,
  ] as const
}

/** A fresh nonce for a transfer that pays no charge: 32 random bytes, never a Kova memo. */
export function randomNonce(): Hex {
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  // A random value could only look like a Kova memo by starting with "KOVA"; make sure it doesn't.
  if (bytes[0] === 0x4b) bytes[0] = 0x00
  return toHex(bytes)
}
