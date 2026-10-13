import { type Address, type Hex, isAddressEqual } from 'viem'
import { offlineStatus } from './offline-core'
import { load, save } from './storage'

/**
 * This wallet's offline payments, kept on the phone until they settle: the outbox (codes it signed
 * for other people) and the inbox (codes other people showed it). Module-level, like the private
 * and takings stores, so the wallet's arrivals watcher can tell an offline payment settling from
 * new money, and kept per wallet, so a second wallet on the phone never sees the first one's.
 */

export type OfflineState = 'waiting' | 'settled' | 'failed' | 'expired'

export interface OfflineItem {
  /** keccak256(from, nonce): the payment's lasting id, as the token records it. */
  id: Hex
  /** Out: this wallet signed it. In: someone showed this wallet their code. */
  direction: 'out' | 'in'
  /** The payment itself, as its QR and link carry it. */
  code: string
  from: Address
  to: Address
  /** Base units. */
  amount: string
  nonce: Hex
  /** Unix seconds: after this it can never settle. */
  validBefore: number
  /** The other side, as this phone named them when the payment was made or scanned. */
  name: string
  /** The name the code carries: what the sender calls themselves. Unsigned. */
  claimed: string | null
  /** When it was signed (out) or scanned (in), ms. */
  at: number
  status: OfflineState
  /** Why it didn't settle the last time this phone tried. `balance`: the payer's wallet was short. */
  problem: { kind: 'balance' | 'other'; text: string; at: number } | null
  tries: number
  settledAt?: number
  txHash?: Hex
  /** From handing it in to settled on Monad, when this phone handed it in. */
  ms?: number
  /** Whose phone handed it in: this one, or the other person's. */
  by?: 'me' | 'them'
  /** Its line in your activity, once settled. */
  entryId?: string
}

const key = (owner: string) => `kova.monad.offline.v1.${owner.toLowerCase()}`

let owner: string | null = null
let items: OfflineItem[] = []
let loading: Promise<void> = Promise.resolve()
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

/** Opens this wallet's offline payments (or none, signed out). */
export function openOfflineStore(address: Address | null): Promise<void> {
  const next = address?.toLowerCase() ?? null
  if (next === owner) return loading
  owner = next
  items = []
  notify()
  if (!next) return (loading = Promise.resolve())
  loading = load<OfflineItem[]>(key(next), []).then((saved) => {
    if (owner !== next) return
    items = Array.isArray(saved) ? saved : []
    notify()
  })
  return loading
}

export const offlineItems = () => items
export const offlineReady = () => loading

export function onOfflineChange(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

async function persist() {
  if (owner) await save(key(owner), items)
}

export async function putOffline(item: OfflineItem) {
  await loading
  items = [item, ...items.filter((i) => i.id !== item.id)]
  notify()
  await persist()
}

export async function patchOffline(id: Hex, patch: Partial<OfflineItem>) {
  await loading
  items = items.map((i) => (i.id === id ? { ...i, ...patch } : i))
  notify()
  await persist()
}

/** Its line in activity has an id of its own, so whichever part of the app records it first, it's recorded once. */
export const offlineEntryId = (id: Hex) => `offline-${id.slice(2, 18)}`

/**
 * Money Kova's index saw arrive that is one of this phone's offline payments settling (matched on
 * its sender and nonce, through Kova's status): the payment, now marked settled, or null when it's
 * new money. It already had its arrival screen when its code was scanned.
 */
export async function offlineArrival(from: Address, amount: bigint, hash: Hex): Promise<OfflineItem | null> {
  await loading
  const lower = hash.toLowerCase()
  const known = items.find((i) => i.direction === 'in' && i.txHash?.toLowerCase() === lower)
  if (known) return known
  const candidates = items.filter((i) => i.direction === 'in' && !i.txHash && isAddressEqual(i.from, from) && BigInt(i.amount) === amount)
  for (const c of candidates) {
    const status = await offlineStatus(c.from, c.nonce)
    if (status?.status === 'settled' && status.txHash?.toLowerCase() === lower) {
      const patch: Partial<OfflineItem> = {
        status: 'settled',
        txHash: hash,
        settledAt: c.settledAt ?? Date.now(),
        by: c.by ?? 'them',
        entryId: offlineEntryId(c.id),
        problem: null,
      }
      await patchOffline(c.id, patch)
      return { ...c, ...patch }
    }
  }
  return null
}
