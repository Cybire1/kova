import {
  generateStealthPayment,
  type NetworkId,
  openStealthMemo,
  parseStealthMetaAddress,
  personalStealthKeysMessage,
  planPrivateSpend,
  type StealthKeys,
  type StealthMemo,
  stealthKeysFromSignature,
  stealthMetaAddress,
  stealthPrivateKey,
  stealthRegistrationMessage,
  stealthSender,
} from '@kova/monad'
import {
  type Address,
  getAddress,
  type Hex,
  isAddress,
  isAddressEqual,
  recoverMessageAddress,
} from 'viem'
import { type LocalAccount, privateKeyToAccount } from 'viem/accounts'
import type { Announcement } from '@/lib/api'
import { baseOf, scan, type ViewKey } from '@/lib/takings'
import { balanceOf, type StealthAnnouncement } from './chain'
import { networkStorageKey } from './storage'
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
 * Each payment carries a sealed memo (who sent it, their name, a note) that only the recipient's
 * viewing key opens, so finding who paid never means asking Kova about an address. Kova also posts
 * every payment to ERC-5564's announcer on Monad, so any wallet can find its own on chain.
 *
 * On the web spending keys live in memory, made again whenever the wallet opens: the view half finds
 * new private payments while the page is open, and the spending key spends them, straight from
 * their one-time addresses, or moves them in. An encrypted read-only viewing key is cached locally
 * for automatic balance checks after reload, and deleted at sign-out. Signing keys are not cached.
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

/**
 * A fresh one-time address for the holder of `meta`, with the memo sealed for them, and the
 * announcement that lets them find both. `ephemeral` when the address was made first, to sign it.
 */
export function privatePayment(
  meta: string,
  memo: StealthMemo,
  ephemeral?: Hex,
): { address: Address; announcement: StealthAnnouncement } {
  const made = generateStealthPayment(meta, memo, ephemeral)
  return {
    address: made.stealthAddress,
    announcement: {
      ephemeral_public_key: made.ephemeralPublicKey,
      view_tag: made.viewTag,
      sealed: made.sealed,
    },
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

/** A private payment this wallet's viewing key found, and what its sealed memo said. */
export interface FoundPayment {
  /** Kova's id for its announcement (empty for change made here, until Kova lists it). */
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
  /** Who sent it: the memo's word, checked against Monad or their signature, or Monad's alone. */
  from?: string
  /** What they call themselves, from the memo. */
  name?: string
  /** 'chain': Monad shows it left their wallet. 'signed': their wallet signed for it. 'claimed': only the memo says so. */
  proven?: 'chain' | 'signed' | 'claimed'
  /** Their note, from the memo. */
  note?: string
  /** 'change': your own private dollars, gathered into one address so they can pay together. */
  kind?: 'send' | 'change'
  /** ERC-5564's Announcement of it on Monad, once Kova has posted it. */
  announced?: string
  /** Holds nothing now (moved in, spent or gathered): it isn't read again. */
  emptied?: boolean
  /** Paid out of privately (a shop, or a private send), so what's left is change. */
  used?: boolean
}

export interface PrivateLedger {
  /** The feed is read again from here: everything before it is settled (announced, or old). */
  cursor: string | null
  found: FoundPayment[]
  /** One-time addresses this wallet sent to: a private send made in the app reads as one here too. */
  sentTo: string[]
  /** The Announcement on Monad of each private payment this wallet sent, by one-time address. */
  announced: Record<string, string>
}

export const emptyLedger: PrivateLedger = { cursor: null, found: [], sentTo: [], announced: {} }

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

/** A payment as stored: notes from before sealed memos were Kova's sealed boxes, not text. */
const tidy = (f: FoundPayment): FoundPayment =>
  typeof f.note === 'string' || f.note === undefined ? f : { ...f, note: undefined }

export function readLedger(wallet: string, network: NetworkId): PrivateLedger {
  try {
    const raw = localStorage.getItem(networkStorageKey(ledgerKey(wallet), network))
    const stored = raw ? (JSON.parse(raw) as Partial<PrivateLedger>) : null
    if (!stored) return emptyLedger
    return {
      cursor: typeof stored.cursor === 'string' ? stored.cursor : null,
      found: Array.isArray(stored.found) ? stored.found.filter(isFound).map(tidy) : [],
      sentTo: Array.isArray(stored.sentTo)
        ? stored.sentTo.filter((a): a is string => typeof a === 'string')
        : [],
      announced: stored.announced && typeof stored.announced === 'object' ? stored.announced : {},
    }
  } catch {
    return emptyLedger
  }
}

export function writeLedger(wallet: string, ledger: PrivateLedger, network: NetworkId) {
  try {
    localStorage.setItem(networkStorageKey(ledgerKey(wallet), network), JSON.stringify(ledger))
  } catch {
    // Private mode or full storage: the next look finds them again.
  }
}

/** How long a new payment is read again for, waiting for its Announcement on Monad. */
const SETTLE_MS = 3 * 60_000

/**
 * Looks through what Kova announced since the ledger's cursor for this wallet's private payments:
 * each check is an elliptic-curve multiplication, a few at a time so the page keeps moving. Each
 * one found opens its sealed memo with the viewing key, here: who sent it and their note come from
 * the payment itself, and nobody is asked about its address. `sent` is everywhere this wallet sent
 * money, so its own private sends are known for what they were.
 *
 * Kova posts each Announcement to Monad a few seconds after the payment, so the cursor stops before
 * the first payment that has none yet (for three minutes at most) and the next look reads the
 * same pages again: ordinary pages of the feed, the same for everyone.
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
  const found = new Map(ledger.found.map((f) => [f.address.toLowerCase(), f]))
  for (const a of mine) {
    const key = a.stealth_address.toLowerCase()
    const known = found.get(key)
    if (known) {
      if (a.announce_url && !known.announced)
        found.set(key, { ...known, announced: a.announce_url })
      continue
    }
    const stealthAddress = getAddress(a.stealth_address)
    const memo = openStealthMemo(view.viewingPrivateKey, {
      ephemeralPublicKey: a.ephemeral_public_key as Hex,
      stealthAddress,
      sealed: (a.sealed ?? null) as Hex | null,
    })
    const sender = await stealthSender(memo, {
      stealthAddress,
      from: a.from && isAddress(a.from) ? getAddress(a.from) : null,
    }).catch(() => null)
    found.set(key, {
      id: a.id,
      address: stealthAddress,
      ephemeral: a.ephemeral_public_key,
      amount: baseOf(a.amount).toString(),
      tx: a.tx_hash,
      explorer: a.explorer_url,
      at: a.paid_at ? Date.parse(a.paid_at) : Date.now(),
      ...(sender ? { from: sender.address, proven: sender.proven } : {}),
      ...(sender?.name ? { name: sender.name } : {}),
      ...(memo?.note ? { note: memo.note } : {}),
      ...(memo?.kind ? { kind: memo.kind } : {}),
      ...(a.announce_url ? { announced: a.announce_url } : {}),
    })
  }
  const announced = { ...ledger.announced }
  const sentTo = new Set(ledger.sentTo)
  for (const a of list) {
    const key = a.stealth_address.toLowerCase()
    if (!sent.has(key)) continue
    sentTo.add(key)
    if (a.announce_url) announced[key] = a.announce_url
  }
  let cursor = ledger.cursor
  for (const a of list) {
    const settled =
      Boolean(a.announce_url) || !a.paid_at || Date.now() - Date.parse(a.paid_at) > SETTLE_MS
    if (!settled) break
    cursor = a.id
  }
  return { cursor, found: [...found.values()], sentTo: [...sentTo], announced }
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

// --- Spending it, straight from its one-time addresses -------------------------------------------

/** A one-time address's own account: the spending key plus that payment's shared secret. */
export function oneTimeAccount(
  keys: StealthKeys,
  payment: Pick<FoundPayment, 'address' | 'ephemeral'>,
): LocalAccount {
  const account = privateKeyToAccount(stealthPrivateKey(keys, payment.ephemeral as Hex))
  if (!isAddressEqual(account.address, getAddress(payment.address)))
    throw new Error('Your keys don’t open one of your private addresses. Nothing moved.')
  return account
}

/**
 * Where a private payment of `amount` comes from: the smallest one address that holds enough, so
 * the rest stay apart; else the fewest addresses, largest first, to gather into one first. The
 * rule is the privacy router's, shared with the app (@kova/monad).
 */
export function planSpend(
  spendable: { payment: FoundPayment; held: bigint }[],
  amount: bigint,
): { from: FoundPayment } | { gather: FoundPayment[] } | null {
  return planPrivateSpend(
    spendable.map((s) => ({ item: s.payment, held: s.held })),
    amount,
  )
}

/**
 * Gathers private dollars into one new address of yours, so a payment bigger than any one of them
 * can go from a single address. Each moves everything it holds, one at a time (the relayer's nonce
 * is shared), and only the first carries the announcement, so the new address is found like any
 * payment. This links those addresses to each other on Monad, never to your wallet.
 */
export async function gatherInto(
  network: NetworkId,
  keys: StealthKeys,
  sources: FoundPayment[],
  to: Address,
  announcement: StealthAnnouncement,
): Promise<{ amount: bigint; moved: string[]; tx: string | null; explorer: string | null }> {
  const { moves } = await signMoves(
    keys,
    sources.map((p) => ({ stealth_address: p.address, ephemeral_public_key: p.ephemeral })),
    to,
    network,
  )
  let amount = 0n
  let tx: string | null = null
  let explorer: string | null = null
  const moved: string[] = []
  for (const [i, move] of moves.entries()) {
    const response = await fetch('/api/wallet/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...move.authorization,
        ...(i === 0 ? { stealth: announcement } : {}),
      }),
    })
    const json = (await response.json().catch(() => ({}))) as {
      error?: string
      tx_hash?: string
      explorer_url?: string
    }
    // Whatever moved before this is at the new address, still yours and still private.
    if (!response.ok) {
      if (!moved.length)
        throw new Error(plain(json.error ?? `Kova didn’t answer (${response.status}).`))
      break
    }
    amount += move.amount
    moved.push(move.sale.stealth_address.toLowerCase())
    tx ??= json.tx_hash ?? null
    explorer ??= json.explorer_url ?? null
  }
  return { amount, moved, tx, explorer }
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
