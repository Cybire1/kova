import {
  decodeOfflinePayment,
  type NetworkId,
  networkByChainId,
  type OfflinePayment,
  offlineCodeFrom,
  toSignedAuthorization,
  verifyOfflinePayment,
} from '@kova/monad'
import type { Hex } from 'viem'

/**
 * Offline payments in the browser: a payment someone signed on their phone with no signal, carried
 * as a code (a QR, or the part of a mykova.app/o link after the #). This browser reads and checks
 * the code itself, with no network. Only handing it in reaches Kova: the signed payment goes to
 * this site's /api route, which passes it to Kova's relayer to settle on Monad.
 */

export type ReadCode =
  | { ok: true; payment: OfflinePayment; network: NetworkId }
  /** Not a payment code at all, or one cut short. */
  | { ok: false; reason: 'not-a-code' }
  | {
      ok: false
      reason: 'bad-signature' | 'too-large' | 'zero' | 'unknown-token' | 'unknown-network'
      payment: OfflinePayment
    }
  /** Signed and genuine, but past its week: it can only have settled before it ran out. */
  | { ok: false; reason: 'expired'; payment: OfflinePayment; network: NetworkId }

/** The code from a link's # (or anything pasted: a whole link, or the code alone), read and checked. */
export async function readOfflineCode(text: string): Promise<ReadCode> {
  const raw = text.replace(/^#/, '').trim()
  const code = offlineCodeFrom(raw) ?? (raw.length > 0 ? raw : null)
  const payment = code ? decodeOfflinePayment(code) : null
  if (!payment) return { ok: false, reason: 'not-a-code' }
  const check = await verifyOfflinePayment(payment)
  if (check.ok) return { ok: true, payment, network: networkOf(payment) }
  if (check.reason === 'expired')
    return { ok: false, reason: 'expired', payment, network: networkOf(payment) }
  return { ok: false, reason: check.reason, payment }
}

function networkOf(p: OfflinePayment): NetworkId {
  return networkByChainId(p.chainId).id
}

export interface OfflineStatus {
  status: 'settled' | 'waiting'
  tx_hash: Hex | null
  explorer_url: string | null
  settled_at: string | null
}

/** Whether Kova has seen it settle: asked by its sender and nonce, never by the code. */
export async function offlineStatus(p: OfflinePayment): Promise<OfflineStatus> {
  const { from, nonce } = p.authorization
  const response = await fetch(
    `/api/offline-payments/${from}/${nonce}?token=${encodeURIComponent(p.token)}`,
    { cache: 'no-store' },
  )
  if (!response.ok) throw new Error(`Kova didn’t answer (${response.status}).`)
  return response.json()
}

export interface HandedIn {
  tx_hash: Hex
  explorer_url: string
  /** From pressing the button to settled on Monad, as this browser saw it. */
  ms: number
}

/** Why Kova didn't settle it: its error code, and the balance when the sender was short. */
export class Refused extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly details: Record<string, unknown> | null,
  ) {
    super(message)
  }
  /** The token has already used it: it settled, whoever handed it in. */
  get alreadyPaid() {
    return this.status === 409
  }
  /** The sender's wallet holds less than the payment. */
  get short() {
    return this.code === 'policy_declined' && this.details?.balance !== undefined
  }
}

/** Hands the payment to Kova, which settles it on Monad and pays the gas. Anyone can. */
export async function handIn(p: OfflinePayment): Promise<HandedIn> {
  const started = performance.now()
  const response = await fetch('/api/offline-payments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(toSignedAuthorization(p.token, p.authorization, p.signature)),
  })
  const body = (await response.json().catch(() => ({}))) as {
    tx_hash?: Hex
    explorer_url?: string
    error?: string
    code?: string
    details?: Record<string, unknown>
  }
  if (!response.ok || !body.tx_hash)
    throw new Refused(
      body.error ?? `Kova didn’t answer (${response.status}). Nothing moved.`,
      response.status,
      body.code ?? null,
      body.details ?? null,
    )
  return {
    tx_hash: body.tx_hash,
    explorer_url: body.explorer_url ?? '',
    ms: Math.round(performance.now() - started),
  }
}

// --- What this browser has seen ------------------------------------------------------------
// The wallet's activity comes from Kova's index of Monad, where an offline payment is a transfer
// like any other. This browser remembers the ones it handed in or saw settle on /o, by
// transaction, so its activity can say which they were.

const SEEN = 'kova.web.offline.v1'
let seen: Set<string> | null = null

function seenSet(): Set<string> {
  if (seen) return seen
  try {
    const raw = localStorage.getItem(SEEN)
    seen = new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    seen = new Set()
  }
  return seen
}

export function rememberOfflineTx(hash: string) {
  const all = seenSet()
  const key = hash.toLowerCase()
  if (all.has(key)) return
  all.add(key)
  try {
    localStorage.setItem(SEEN, JSON.stringify([...all].slice(-200)))
  } catch {
    // Private mode or full storage: the payment still shows, just without the label.
  }
}

/** Whether this transaction settled an offline payment this browser saw. */
export function isOfflineTx(hash: string | undefined): boolean {
  if (!hash || typeof window === 'undefined') return false
  return seenSet().has(hash.toLowerCase())
}
