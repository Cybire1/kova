import {
  generateStealthAddress,
  type NetworkId,
  parseStealthMetaAddress,
  personalStealthKeysMessage,
  type StealthKeys,
  stealthKeysFromSignature,
  stealthMetaAddress,
  stealthRegistrationMessage,
} from '@kova/monad'
import { type Address, getAddress, type Hex, isAddressEqual, recoverMessageAddress } from 'viem'
import type { LocalAccount } from 'viem/accounts'
import type { Announcement } from '@/lib/api'
import { baseOf, scan, type ViewKey } from '@/lib/takings'
import { balanceOf, type IndexedTransfer, type StealthAnnouncement } from './chain'
import { inTurns, signMoves } from './takings'

/**
 * Private sends between people, in the browser: the app's keys and cryptography (packages/monad
 * src/stealth.ts, ERC-5564 scheme 1), as private takings are for shops.
 *
 * A wallet's private-receiving keys come from one signature of personalStealthKeysMessage(wallet).
 * Signatures are deterministic, so the app and the web make the same keys, with nothing stored.
 * Kova is given the public meta-address, signed by the wallet, so a sender can check Kova never
 * swapped it. A private send pays a fresh one-time address made from it; Kova announces that
 * address with no one named, in the same feed as shops' private sales, and only the recipient's
 * viewing key picks theirs out.
 *
 * On the web the keys live in memory, made again whenever the wallet opens: the view half finds
 * new private payments while the page is open, and the spending key moves them in. This browser
 * keeps only what anyone can read in Kova's feed: the addresses it found, never a key.
 */

/** This wallet's private-receiving keys, from one signature by the wallet. It moves no money. */
export async function privateKeys(account: LocalAccount): Promise<StealthKeys> {
  return stealthKeysFromSignature(
    await account.signMessage({ message: personalStealthKeysMessage(account.address) }),
  )
}

/**
 * Someone's private-receiving key (`st:eth:0x…`), checked against their own wallet's signature
 * so Kova can't swap in a key of its own. Null when they have none, or what came back isn't theirs.
 */
export async function fetchPrivateKey(address: Address): Promise<string | null> {
  const response = await fetch(`/api/wallet/${address}/stealth`, { cache: 'no-store' }).catch(
    () => null,
  )
  if (!response?.ok) return null
  const key = (await response.json().catch(() => ({}))) as {
    meta_address?: string
    signature?: Hex
  }
  if (!key.meta_address || !key.signature) return null
  try {
    parseStealthMetaAddress(key.meta_address)
  } catch {
    return null
  }
  const signer = await recoverMessageAddress({
    message: stealthRegistrationMessage(address, key.meta_address),
    signature: key.signature,
  }).catch(() => null)
  return signer && isAddressEqual(signer, address) ? key.meta_address : null
}

/** Publishes this wallet's private-receiving key, signed by the wallet, unless Kova has it already. */
export async function publishPrivateKey(account: LocalAccount, keys: StealthKeys): Promise<string> {
  const meta = stealthMetaAddress(keys)
  if ((await fetchPrivateKey(account.address)) === meta) return meta
  const signature = await account.signMessage({
    message: stealthRegistrationMessage(account.address, meta),
  })
  const response = await fetch(`/api/wallet/${account.address}/stealth`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ meta_address: meta, signature }),
  })
  if (!response.ok)
    throw new Error(`Publishing the private receiving key failed (${response.status}).`)
  return meta
}

/** A fresh one-time address for the holder of `meta`, and the announcement that lets them find it. */
export function oneTimeAddress(meta: string): {
  address: Address
  announcement: StealthAnnouncement
} {
  const made = generateStealthAddress(meta)
  return {
    address: made.stealthAddress,
    announcement: { ephemeral_public_key: made.ephemeralPublicKey, view_tag: made.viewTag },
  }
}

// --- Kova's feed ---------------------------------------------------------------------------------

async function feedPage(after: string | null, limit = 1000) {
  const query = new URLSearchParams({ limit: String(limit) })
  if (after) query.set('after', after)
  const response = await fetch(`/api/announcements?${query}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Kova didn’t answer (${response.status})`)
  return (await response.json()) as { data: Announcement[]; next: string | null }
}

/** Everything Kova announced after `after`, following its pages to the end. */
async function announcedAfter(after: string | null): Promise<Announcement[]> {
  const all: Announcement[] = []
  let cursor = after
  for (;;) {
    const page = await feedPage(cursor)
    all.push(...page.data)
    if (!page.next) return all
    cursor = page.next
  }
}

/** Whether Kova announced anything after `after`: one item's worth of asking, and no key needed. */
export async function announcedSince(after: string | null): Promise<boolean> {
  return (await feedPage(after, 1)).data.length > 0
}

// --- What this browser remembers -----------------------------------------------------------------

/** A private payment this wallet's viewing key found. Only what Kova's feed shows anyone. */
export interface FoundPayment {
  /** Kova's id for its announcement. */
  id: string
  /** The one-time address it was paid to. */
  address: string
  /** The sender's ephemeral key: with this wallet's spending key, it opens that address. */
  ephemeral: string
  /** Base units, as announced. */
  amount: string
  tx: string
  explorer: string
  at: number
  /** Who sent it, from Kova's index of that address; missing until Kova has seen it land. */
  from?: string
  /** Their note, sealed for the two of you, and the authorization nonce it's bound to. */
  note?: IndexedTransfer['note']
  /** Moved into the wallet: a one-time address that holds nothing now, so it isn't read again. */
  emptied?: boolean
}

export interface PrivateLedger {
  /** The last announcement looked at: the next look starts after it. */
  cursor: string | null
  found: FoundPayment[]
  /** One-time addresses this wallet sent to: a private send made in the app reads as one here too. */
  sentTo: string[]
}

export const emptyLedger: PrivateLedger = { cursor: null, found: [], sentTo: [] }

const ledgerKey = (wallet: string) => `kova.web.private.v1.${wallet.toLowerCase()}`

const isFound = (value: unknown): value is FoundPayment => {
  const f = value as FoundPayment | null
  return Boolean(
    f &&
      typeof f.id === 'string' &&
      typeof f.address === 'string' &&
      typeof f.ephemeral === 'string' &&
      typeof f.amount === 'string' &&
      typeof f.tx === 'string',
  )
}

export function readLedger(wallet: string): PrivateLedger {
  try {
    const raw = localStorage.getItem(ledgerKey(wallet))
    const stored = raw ? (JSON.parse(raw) as Partial<PrivateLedger>) : null
    if (!stored) return emptyLedger
    return {
      cursor: typeof stored.cursor === 'string' ? stored.cursor : null,
      found: Array.isArray(stored.found) ? stored.found.filter(isFound) : [],
      sentTo: Array.isArray(stored.sentTo)
        ? stored.sentTo.filter((a): a is string => typeof a === 'string')
        : [],
    }
  } catch {
    return emptyLedger
  }
}

export function writeLedger(wallet: string, ledger: PrivateLedger) {
  try {
    localStorage.setItem(ledgerKey(wallet), JSON.stringify(ledger))
  } catch {
    // Private mode or full storage: the next look finds them again.
  }
}

/**
 * Looks through what Kova announced since the ledger's cursor for this wallet's private payments:
 * each check is an elliptic-curve multiplication, a few at a time so the page keeps moving. `sent`
 * is everywhere this wallet sent money, so its own private sends are known for what they were.
 * Null if `stopped` says the page moved on to another wallet.
 */
export async function lookForPayments(
  view: ViewKey,
  ledger: PrivateLedger,
  sent: ReadonlySet<string>,
  stopped: () => boolean,
): Promise<PrivateLedger | null> {
  const list = await announcedAfter(ledger.cursor)
  if (stopped()) return null
  if (!list.length) return ledger
  const mine = await scan(view, list, () => {}, stopped)
  if (!mine) return null
  const known = new Set(ledger.found.map((f) => f.address.toLowerCase()))
  const found: FoundPayment[] = mine
    .filter((a) => !known.has(a.stealth_address.toLowerCase()))
    .map((a) => ({
      id: a.id,
      address: getAddress(a.stealth_address),
      ephemeral: a.ephemeral_public_key,
      amount: baseOf(a.amount).toString(),
      tx: a.tx_hash,
      explorer: a.explorer_url,
      at: a.paid_at ? Date.parse(a.paid_at) : Date.now(),
    }))
  const sentTo = list
    .map((a) => a.stealth_address.toLowerCase())
    .filter((address) => sent.has(address))
  return {
    cursor: list[list.length - 1]?.id ?? ledger.cursor,
    found: [...ledger.found, ...found],
    sentTo: [...new Set([...ledger.sentTo, ...sentTo])],
  }
}

/**
 * Who sent a private payment, and their note: Kova's index of its one-time address has both.
 * Null until Kova has seen it land, a second or two after it was paid.
 */
export async function senderOf(
  payment: FoundPayment,
): Promise<Pick<FoundPayment, 'from' | 'note'> | null> {
  const response = await fetch(
    `/api/wallet/${getAddress(payment.address)}/transfers?direction=in&after_block=0`,
    { cache: 'no-store' },
  ).catch(() => null)
  if (!response?.ok) return null
  const { data } = (await response.json().catch(() => ({ data: [] }))) as {
    data: IndexedTransfer[]
  }
  const paid = data.find((t) => t.tx_hash.toLowerCase() === payment.tx.toLowerCase())
  return paid ? { from: getAddress(paid.from), note: paid.note ?? null } : null
}

/** What each one-time address holds now, read from Monad. One Monad didn't answer for is left out. */
export async function holdings(network: NetworkId, addresses: string[]) {
  const read = await inTurns(addresses, (address) =>
    balanceOf(network, getAddress(address)).catch(() => null),
  )
  const held = new Map<string, bigint>()
  for (const [i, address] of addresses.entries()) {
    const value = read[i]
    if (typeof value === 'bigint') held.set(address.toLowerCase(), value)
  }
  return held
}

// --- Moving it in ------------------------------------------------------------------------------

export interface MovedIn {
  /** Base units that reached the wallet. */
  amount: bigint
  count: number
  /** Moves that didn't go through, and the first reason. */
  failed: number
  problem: string | null
  ms: number
  /** The last move's transaction, to see on Monadscan. */
  explorer: string | null
  /** One-time addresses that now hold nothing: moved, or already empty. */
  emptied: string[]
}

/** Kova's words for a failed move, or plain ones when they're about gas. */
function plain(error: string) {
  if (/insufficient|exceeds the balance|gas|funds/i.test(error))
    return 'Kova couldn’t pay the network fee just now. Your dollars are safe where they are; try again in a little while.'
  return error.length < 160
    ? error
    : 'Kova couldn’t move them just now. Nothing was lost; try again.'
}

/**
 * Brings private payments into the wallet. Each one-time address signs a transfer of everything it
 * holds, with its own key (the spending key plus that payment's shared secret), and Kova's relayer
 * submits it and pays the gas, one at a time so `onProgress` can say how far it's got.
 */
export async function moveIn(
  network: NetworkId,
  keys: StealthKeys,
  payments: FoundPayment[],
  to: Address,
  onProgress: (done: number, total: number) => void,
): Promise<MovedIn> {
  const started = performance.now()
  const { moves, empty } = await signMoves(
    keys,
    payments.map((p) => ({ stealth_address: p.address, ephemeral_public_key: p.ephemeral })),
    to,
    network,
  )
  const emptied = empty.map((e) => e.stealth_address.toLowerCase())
  let amount = 0n
  let count = 0
  let failed = 0
  let problem: string | null = null
  let explorer: string | null = null
  onProgress(0, moves.length)
  for (const [i, move] of moves.entries()) {
    try {
      const response = await fetch('/api/wallet/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(move.authorization),
      })
      const json = (await response.json().catch(() => ({}))) as {
        error?: string
        explorer_url?: string
      }
      if (!response.ok) throw new Error(json.error ?? `Kova didn’t answer (${response.status}).`)
      amount += move.amount
      count++
      explorer = json.explorer_url ?? explorer
      emptied.push(move.sale.stealth_address.toLowerCase())
    } catch (error) {
      failed++
      problem ??= plain(error instanceof Error ? error.message : String(error))
    }
    onProgress(i + 1, moves.length)
  }
  return {
    amount,
    count,
    failed,
    problem,
    ms: Math.round(performance.now() - started),
    explorer,
    emptied,
  }
}
