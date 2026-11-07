import { type Address, getAddress, type Hex, isAddress, isHex } from 'viem'
import type { TransferAuthorization } from './authorization.js'
import type { NetworkId } from './networks.js'
import { networks } from './networks.js'
import { type Token, tokens } from './tokens.js'

/**
 * x402 (version 2): a website answers "payment required" (HTTP 402) with what it accepts, the
 * wallet pays with an EIP-3009 transfer authorization, and the request is sent again with it.
 *
 *   server → wallet   `PAYMENT-REQUIRED` header: base64 JSON { x402Version, accepts: [...], resource }
 *   wallet → server   `PAYMENT-SIGNATURE` header: base64 JSON { x402Version, accepted, payload, resource }
 *
 * Kova pays the `exact` scheme on Monad, in AUSD or USDC. A site's budget is spent in AUSD; where
 * the site wants USDC, Kova pays it from its own USDC and keeps the AUSD (apps/api x402 payments).
 */

export const X402_VERSION = 2
export const PAYMENT_REQUIRED_HEADER = 'payment-required'
export const PAYMENT_SIGNATURE_HEADER = 'payment-signature'

export interface X402Requirement {
  scheme: 'exact'
  /** CAIP-2: `eip155:143` on Monad mainnet, `eip155:10143` on testnet. */
  network: string
  /** Base units of `asset`, as a decimal string. */
  amount: string
  asset: Address
  payTo: Address
  maxTimeoutSeconds: number
  extra?: { name?: string; version?: string } & Record<string, unknown>
  /** Anything else the site sent, kept so `accepted` echoes it exactly. */
  [key: string]: unknown
}

export interface X402Resource {
  url?: string
  description?: string
  mimeType?: string
}

export interface PaymentRequired {
  x402Version: number
  accepts: X402Requirement[]
  resource?: X402Resource
  error?: string
}

/** What Kova can pay: the exact scheme on this network, in a dollar Kova knows the domain of. */
export interface Payable {
  requirement: X402Requirement
  token: Token
  amount: bigint
}

const UINT = /^\d{1,30}$/

function decodeBase64(text: string): string {
  const binary = atob(text.replace(/\s+/g, ''))
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function encodeBase64(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Reads a `PAYMENT-REQUIRED` header (base64 JSON) or a 402 body (JSON). Null for anything else. */
export function parsePaymentRequired(input: string): PaymentRequired | null {
  const trimmed = input.trim()
  let json: unknown
  try {
    json = JSON.parse(trimmed.startsWith('{') ? trimmed : decodeBase64(trimmed))
  } catch {
    return null
  }
  if (!json || typeof json !== 'object') return null
  const raw = json as Record<string, unknown>
  if (typeof raw.x402Version !== 'number' || !Array.isArray(raw.accepts)) return null
  const accepts = raw.accepts
    .map((a) => readRequirement(a))
    .filter((a): a is X402Requirement => a !== null)
  const resource =
    raw.resource && typeof raw.resource === 'object' ? (raw.resource as X402Resource) : undefined
  return {
    x402Version: raw.x402Version,
    accepts,
    ...(resource ? { resource } : {}),
    ...(typeof raw.error === 'string' ? { error: raw.error } : {}),
  }
}

/** One accepted way to pay, checked field by field; anything malformed is dropped, not guessed. */
export function readRequirement(input: unknown): X402Requirement | null {
  if (!input || typeof input !== 'object') return null
  const a = input as Record<string, unknown>
  if (a.scheme !== 'exact') return null
  if (typeof a.network !== 'string' || !/^eip155:\d{1,10}$/.test(a.network)) return null
  const amount =
    typeof a.amount === 'string'
      ? a.amount
      : typeof a.maxAmountRequired === 'string'
        ? a.maxAmountRequired
        : null
  if (!amount || !UINT.test(amount) || BigInt(amount) <= 0n) return null
  if (typeof a.asset !== 'string' || !isAddress(a.asset, { strict: false })) return null
  if (typeof a.payTo !== 'string' || !isAddress(a.payTo, { strict: false })) return null
  const timeout =
    typeof a.maxTimeoutSeconds === 'number' && Number.isFinite(a.maxTimeoutSeconds)
      ? Math.round(a.maxTimeoutSeconds)
      : 300
  return {
    ...a,
    scheme: 'exact',
    network: a.network,
    amount,
    asset: getAddress(a.asset),
    payTo: getAddress(a.payTo),
    maxTimeoutSeconds: Math.min(3600, Math.max(30, timeout)),
  } as X402Requirement
}

/**
 * The way Kova pays out of what a site accepts: on this network, in AUSD first (no swap), else
 * USDC. Null when the site accepts nothing Kova can pay.
 */
export function payableRequirement(required: PaymentRequired, network: NetworkId): Payable | null {
  const chain = `eip155:${networks[network].chainId}`
  const known = [tokens[network].AUSD, tokens[network].USDC].filter((t): t is Token => !!t)
  const options = required.accepts
    .filter((r) => r.network === chain)
    .map((r) => ({
      requirement: r,
      token: known.find((t) => t.address.toLowerCase() === r.asset.toLowerCase()),
    }))
    .filter((o): o is { requirement: X402Requirement; token: Token } => !!o.token)
    .sort((a, b) => (a.token.currency === 'AUSD' ? -1 : 0) - (b.token.currency === 'AUSD' ? -1 : 0))
  const best = options[0]
  return best
    ? { requirement: best.requirement, token: best.token, amount: BigInt(best.requirement.amount) }
    : null
}

/** The `PAYMENT-SIGNATURE` header for a signed authorization that pays `requirement`. */
export function paymentSignatureHeader(input: {
  requirement: X402Requirement
  resource?: X402Resource | undefined
  authorization: TransferAuthorization
  signature: Hex
}): string {
  const a = input.authorization
  return encodeBase64(
    JSON.stringify({
      x402Version: X402_VERSION,
      ...(input.resource ? { resource: input.resource } : {}),
      accepted: input.requirement,
      payload: {
        signature: input.signature,
        authorization: {
          from: a.from,
          to: a.to,
          value: a.value.toString(),
          validAfter: a.validAfter.toString(),
          validBefore: a.validBefore.toString(),
          nonce: a.nonce,
        },
      },
    }),
  )
}

/** Reads a `PAYMENT-SIGNATURE` header back (what a site, or a test, receives). */
export function readPaymentSignature(header: string): {
  accepted: X402Requirement
  authorization: TransferAuthorization
  signature: Hex
} | null {
  try {
    const json = JSON.parse(decodeBase64(header)) as {
      accepted?: unknown
      payload?: { signature?: unknown; authorization?: Record<string, unknown> }
    }
    const accepted = readRequirement(json.accepted)
    const auth = json.payload?.authorization
    const signature = json.payload?.signature
    if (!accepted || !auth || typeof signature !== 'string' || !isHex(signature)) return null
    const str = (v: unknown) => (typeof v === 'string' ? v : '')
    return {
      accepted,
      authorization: {
        from: getAddress(str(auth.from)),
        to: getAddress(str(auth.to)),
        value: BigInt(str(auth.value)),
        validAfter: BigInt(str(auth.validAfter)),
        validBefore: BigInt(str(auth.validBefore)),
        nonce: str(auth.nonce) as Hex,
      },
      signature,
    }
  } catch {
    return null
  }
}
