/**
 * Offline payments on the phone, with no React Native in it, so it runs from Node against testnet
 * exactly as the app runs it.
 *
 * Paying with no signal: the wallet signs an EIP-3009 authorization (no network needed) and the
 * signed payment travels as a code, a QR or a link. Whoever gets signal first, payer or payee,
 * hands it to Kova, which settles it on Monad and pays the gas. The token accepts each
 * authorization once, so a second hand-in is refused (409) and means it's already settled.
 */
import {
  decodeOfflinePayment,
  encodeOfflinePayment,
  OFFLINE_MAX,
  OFFLINE_VALIDITY,
  type OfflinePayment,
  offlinePaymentId,
  randomNonce,
  toSignedAuthorization,
  transferAuthorizationTypedData,
} from '@kova/monad'
import type { Address, Hex, LocalAccount } from 'viem'
import { apiUrl, network, settlementToken } from './config'

export { OFFLINE_MAX, OFFLINE_VALIDITY }

/** Signs a payment with no network, and the code that carries it. */
export async function signOfflinePayment(
  account: LocalAccount,
  to: Address,
  amount: bigint,
  name: string | null,
  now = Date.now(),
): Promise<{ payment: OfflinePayment; code: string }> {
  if (amount <= 0n) throw new Error('A payment has to move some money.')
  if (amount > OFFLINE_MAX) throw new Error('One payment code carries $100 at most.')
  const authorization = {
    from: account.address,
    to,
    value: amount,
    validAfter: 0n,
    validBefore: BigInt(Math.floor(now / 1000)) + OFFLINE_VALIDITY,
    nonce: randomNonce(),
  }
  const signature = await account.signTypedData(transferAuthorizationTypedData(settlementToken, network.chainId, authorization))
  const payment: OfflinePayment = { chainId: network.chainId, token: settlementToken.address, authorization, signature, name: name?.trim() || null }
  return { payment, code: encodeOfflinePayment(payment) }
}

/** What happened when a phone handed a payment to Kova. */
export type HandIn =
  | { kind: 'settled'; txHash: Hex; ms: number }
  /** The other phone (or this one, earlier) already did: the token pays each one once. */
  | { kind: 'already' }
  /** The payer's wallet didn't hold enough when it was handed in. It can still settle later. */
  | { kind: 'short'; text: string }
  /** Past its week: it can never settle now. */
  | { kind: 'expired' }
  /** No connection, or Kova didn't answer: try again later. */
  | { kind: 'unreachable' }
  /** Kova refused it for another reason. */
  | { kind: 'refused'; text: string; retry: boolean }

const TIMEOUT_MS = 15_000

async function call(path: string, init?: RequestInit, timeout = TIMEOUT_MS): Promise<Response> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeout)
  try {
    return await fetch(`${apiUrl}${path}`, { ...init, signal: abort.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** Hands a payment to Kova: whichever phone does it first settles it. */
export async function handIn(code: string): Promise<HandIn> {
  const p = decodeOfflinePayment(code)
  if (!p) return { kind: 'refused', text: 'This code isn’t a payment.', retry: false }
  const started = Date.now()
  let response: Response
  try {
    response = await call('/v1/transfers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...toSignedAuthorization(p.token, p.authorization, p.signature), offline: true }),
    })
  } catch {
    return { kind: 'unreachable' }
  }
  const body = (await response.json().catch(() => ({}))) as { tx_hash?: Hex; ms?: number; error?: { code?: string; message?: string } }
  if (response.ok && body.tx_hash) return { kind: 'settled', txHash: body.tx_hash, ms: Date.now() - started }
  const error = body.error ?? {}
  const text = error.message ?? `Kova answered ${response.status}.`
  if (response.status === 409 || error.code === 'conflict') return { kind: 'already' }
  if (error.code === 'policy_declined' && /enough money/i.test(text)) return { kind: 'short', text }
  if (/ran out|expired/i.test(text) || p.authorization.validBefore <= BigInt(Math.floor(Date.now() / 1000))) return { kind: 'expired' }
  // Too many at once, Monad busy, Kova restarting: all of these pass.
  if (response.status === 429 || response.status >= 500) return { kind: 'refused', text, retry: true }
  return { kind: 'refused', text, retry: false }
}

export interface OfflineStatus {
  status: 'settled' | 'waiting'
  txHash: Hex | null
}

/** Whether a payment has settled, and its transaction once Kova's index has it. Null when Kova can't be reached. */
export async function offlineStatus(from: Address, nonce: Hex): Promise<OfflineStatus | null> {
  try {
    const response = await call(`/v1/public/offline-payments/${from}/${nonce}`)
    if (!response.ok) return null
    const body = (await response.json()) as { status: 'settled' | 'waiting'; tx_hash: Hex | null }
    return { status: body.status, txHash: body.tx_hash ?? null }
  } catch {
    return null
  }
}

/** Whether Kova answers at all: the phone's own test for "online". */
export async function reachable(timeout = 4000): Promise<boolean> {
  try {
    const response = await call('/health', undefined, timeout)
    return response.status < 500
  } catch {
    return false
  }
}

export { decodeOfflinePayment, offlinePaymentId }
