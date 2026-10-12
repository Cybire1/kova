import {
  checkStealthAddress,
  parseStealthMetaAddress,
  parseStealthViewKey,
  personalStealthKeysMessage,
  STEALTH_SCHEME_ID,
  type StealthKeys,
  stealthKeysFromSignature,
  stealthPrivateKey,
  stealthRegistrationMessage,
} from '@kova/monad'
import { type Address, getAddress, type Hash, type Hex, isAddressEqual, recoverMessageAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { balancesOf, explorerTx, getBalance, type Incoming, incomingSince, sendMoney } from './chain'
import { apiUrl } from './config'
import { toBase } from './money'
import type { MoveProgress } from './takings-core'

/**
 * Private sends between people, with no React Native in it so it runs the same in Node.
 *
 * Every payment on Monad is public: anyone who knows your address can add up what you receive. So
 * each wallet has private-receiving keys (ERC-5564, scheme 1), made from one signature by the
 * wallet, the same on the phone and on the web. It publishes the public half with Kova, signed, so
 * a sender can check Kova never swapped it. A private send goes to a fresh one-time address made
 * from that key, and Kova announces it in one public feed with every shop's private sales, naming
 * no recipient. Monad shows who sent how much, but not to whom. The recipient's phone finds its
 * own payments in the feed with the viewing key, and moves them into its balance with keys only
 * the spending key can make: one transfer per address, which Kova submits and pays the gas for.
 */

/** One entry in Kova's public feed of private payments: a shop's sale or a person's send. It names nobody. */
export interface Announcement {
  id: string
  scheme_id: number
  stealth_address: Address
  /** Compressed, 33 bytes. */
  ephemeral_public_key: Hex
  view_tag: Hex
  /** Dollars, e.g. "5.00". */
  amount: string
  tx_hash: Hash
  explorer_url: string
  paid_at: string | null
}

/** A private payment this wallet found with its viewing key. Kept as JSON, so amounts are strings. */
export interface PrivateReceipt {
  /** Kova's id for the announcement. */
  id: string
  /** The one-time address it was paid to. */
  stealthAddress: Address
  ephemeralPublicKey: Hex
  /** Base units, as sent. */
  amount: string
  txHash: Hash
  explorerUrl: string
  /** When it was paid (ms). */
  at: number
  /** Who sent it: public on Monad, so Kova's index of the chain says. Null until it's been read. */
  from: Address | null
  /** Their private note, opened on this phone. */
  note: string | null
  /** Whether the sender sealed a note, so a note that won't open yet is tried again. */
  sealed?: boolean
  /** Base units at the one-time address, as last read from Monad: "0" once it's moved in. */
  held: string
  /** The move into this wallet, when this phone made it. */
  movedTx?: Hash
}

/** What finds this wallet's private payments: the viewing key and the spending public key. It can't move a cent. */
export interface ReceivingView {
  viewingPrivateKey: Hex
  spendingPublicKey: Hex
}

export const viewFromKey = (viewKey: string): ReceivingView => parseStealthViewKey(viewKey)

/** This wallet's private-receiving keys, from one signature of a message naming it. Deterministic. */
export async function receivingKeys(wallet: Address, sign: (message: string) => Promise<Hex>): Promise<StealthKeys> {
  return stealthKeysFromSignature(await sign(personalStealthKeysMessage(wallet)))
}

/** Kova returned a key for someone that doesn't carry their own signature. Never send to it. */
export class UntrustedKey extends Error {}

/** Checks a published key against its owner's signature, so Kova can't swap in a key of its own. */
export async function verifyReceivingKey(wallet: Address, meta: string, signature: Hex): Promise<string> {
  try {
    parseStealthMetaAddress(meta)
  } catch {
    throw new UntrustedKey('Kova returned a private key for them that isn’t a real key.')
  }
  const signer = await recoverMessageAddress({ message: stealthRegistrationMessage(wallet, meta), signature }).catch(() => null)
  if (!signer || !isAddressEqual(signer, wallet)) throw new UntrustedKey('Kova returned a private key for them that they didn’t sign.')
  return meta
}

/**
 * Someone's private-receiving key (`st:eth:0x…`), checked against their signature. Null when they
 * haven't published one; throws UntrustedKey when what Kova returned isn't theirs, and an error when
 * Kova can't be asked.
 */
export async function fetchReceivingKey(wallet: Address, base = apiUrl): Promise<string | null> {
  const response = await fetch(`${base}/v1/wallets/${getAddress(wallet)}/stealth`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Kova is unreachable (${response.status})`)
  const body = (await response.json().catch(() => ({}))) as { meta_address?: unknown; signature?: unknown }
  if (typeof body.meta_address !== 'string' || typeof body.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(body.signature))
    throw new UntrustedKey('Kova returned a private key for them without their signature.')
  return verifyReceivingKey(wallet, body.meta_address, body.signature as Hex)
}

/** Gives Kova this wallet's key and the wallet's signature over it. No signing here: it was signed when the keys were made. */
export async function publishReceivingKey(wallet: Address, meta: string, signature: Hex, base = apiUrl): Promise<void> {
  const response = await fetch(`${base}/v1/wallets/${getAddress(wallet)}/stealth`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ meta_address: meta, signature }),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Error(body.error?.message ?? `Kova didn’t take the private receiving key (${response.status}).`)
  }
}

/** Kova's public feed after `cursor`, a thousand at a time. */
export async function feedAfter(cursor: string | null, base = apiUrl): Promise<Announcement[]> {
  const items: Announcement[] = []
  let after = cursor
  for (let page = 0; page < 20; page += 1) {
    const response = await fetch(`${base}/v1/public/stealth/announcements?limit=1000${after ? `&after=${encodeURIComponent(after)}` : ''}`)
    const body = (await response.json().catch(() => ({}))) as { data?: Announcement[]; next?: string | null; error?: { message?: string } }
    if (!response.ok || !Array.isArray(body.data)) throw new Error(body.error?.message ?? `Kova is unreachable (${response.status})`)
    items.push(...body.data)
    if (!body.next) break
    after = body.next
  }
  return items
}

/** How far the feed's cursor stays behind the newest entry, so an entry written a moment late isn't skipped. */
export const FEED_LAG_MS = 60_000

/**
 * Where to read the feed from next time: the last entry more than a minute old. The newer ones are
 * read again until they're older (and skipped as checked), so an entry whose write landed just after
 * a later one's is never jumped over.
 */
export function advance(items: Announcement[], cursor: string | null, now = Date.now()): { cursor: string | null; recent: string[] } {
  let settled = -1
  items.forEach((item, i) => {
    const at = item.paid_at ? Date.parse(item.paid_at) : 0
    if (!(at > now - FEED_LAG_MS)) settled = i
  })
  return { cursor: settled >= 0 ? (items[settled]?.id ?? cursor) : cursor, recent: items.slice(settled + 1).map((item) => item.id) }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * The entries that are this wallet's. Each check is an elliptic-curve multiplication (tens of
 * milliseconds on a phone), so ids already checked are skipped, and so is anything paid before
 * `since`: this wallet had no key then, so nothing paid then can be for it.
 */
export async function findMine(
  view: ReceivingView,
  items: Announcement[],
  skip: { checked: ReadonlySet<string>; since: number | null },
): Promise<Announcement[]> {
  const mine: Announcement[] = []
  let checks = 0
  for (const item of items) {
    if (skip.checked.has(item.id) || item.scheme_id !== STEALTH_SCHEME_ID) continue
    const at = item.paid_at ? Date.parse(item.paid_at) : Number.NaN
    if (skip.since !== null && at < skip.since) continue
    let ours = false
    try {
      ours = checkStealthAddress(view, { ephemeralPublicKey: item.ephemeral_public_key, viewTag: item.view_tag, stealthAddress: item.stealth_address }) !== null
    } catch {
      ours = false
    }
    if (ours) mine.push(item)
    checks += 1
    // Let the screen draw between checks.
    if (checks % 4 === 0) await tick()
  }
  return mine
}

export function receiptOf(item: Announcement): PrivateReceipt {
  const amount = toBase(item.amount).toString()
  return {
    id: item.id,
    stealthAddress: getAddress(item.stealth_address),
    ephemeralPublicKey: item.ephemeral_public_key,
    amount,
    txHash: item.tx_hash,
    explorerUrl: item.explorer_url,
    at: item.paid_at ? Date.parse(item.paid_at) : Date.now(),
    from: null,
    note: null,
    held: amount,
  }
}

/**
 * Who sent it, with their note still sealed: the sender is public on Monad, and Kova's index of the
 * chain has the transfer into the one-time address. Null while the index hasn't seen it yet.
 */
export async function transferInto(receipt: Pick<PrivateReceipt, 'stealthAddress' | 'txHash'>): Promise<Incoming | null> {
  const { transfers } = await incomingSince(receipt.stealthAddress, 0n)
  return transfers.find((t) => t.hash.toLowerCase() === receipt.txHash.toLowerCase()) ?? null
}

/** What's at each one-time address now, read from Monad; an address whose read failed keeps what it had. */
export async function readHeld(receipts: PrivateReceipt[]): Promise<Map<string, bigint>> {
  return balancesOf(receipts.map((r) => r.stealthAddress))
}

/** Unmoved dollars at one-time addresses, added up. */
export function waitingIn(receipts: PrivateReceipt[]): { amount: bigint; count: number } {
  let amount = 0n
  let count = 0
  for (const r of receipts) {
    const held = BigInt(r.held)
    if (held > 0n) {
      amount += held
      count += 1
    }
  }
  return { amount, count }
}

export interface MoveInOutcome {
  /** Base units that reached the wallet. */
  amount: bigint
  /** Addresses moved. */
  count: number
  /** Each move, by one-time address. */
  moved: { stealthAddress: Address; txHash: Hash; amount: bigint }[]
  /** The newest move's transaction, to see on Monadscan. */
  explorerUrl: string | null
  /** Moves that didn't go through, and the first reason given. */
  failed: number
  reason: string | null
  /** Addresses that held nothing: moved already, from another phone or the web. */
  empty: number
  /** Addresses whose balance was read, so the caller can keep what it shows true. */
  held: Map<string, bigint>
  /** From the first read to the last answer. */
  ms: number
}

/** A move is your own money coming home; Kova's relay speaks of payments. Said for what it is. */
function moveProblem(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  if (/did not confirm|in time/i.test(text)) return 'Monad was slow to confirm it. Nothing is lost: move it in again in a moment.'
  if (/lot of sends/i.test(text)) return 'That’s a lot of moves at once. Move the rest in a few minutes.'
  return text
}

/** How many moves Kova is asked for at once. */
const AT_ONCE = 4

/**
 * Moves private dollars into `to`, this wallet. Each one-time address signs its own transfer of
 * everything it holds (with the key only the spending key can make for it), and Kova submits it
 * through the same door as any send, paying the gas. An address the keys don't open is never signed for.
 */
export async function moveIn(input: {
  keys: StealthKeys
  receipts: PrivateReceipt[]
  to: Address
  onProgress?: (progress: MoveProgress) => void
}): Promise<MoveInOutcome> {
  const { keys, receipts, onProgress } = input
  const to = getAddress(input.to)
  const started = Date.now()
  onProgress?.({ step: 'checking', done: 0, total: receipts.length })
  const held = await readHeld(receipts)

  const jobs: { receipt: PrivateReceipt; value: bigint; account: ReturnType<typeof privateKeyToAccount> }[] = []
  let empty = 0
  let failed = 0
  let reason: string | null = null
  for (const receipt of receipts) {
    const value = held.get(receipt.stealthAddress.toLowerCase()) ?? BigInt(receipt.held)
    if (value === 0n) {
      empty += 1
      continue
    }
    const account = privateKeyToAccount(stealthPrivateKey(keys, receipt.ephemeralPublicKey))
    if (!isAddressEqual(account.address, receipt.stealthAddress)) {
      failed += 1
      reason ??= 'A payment’s address didn’t open with your keys.'
      continue
    }
    jobs.push({ receipt, value, account })
  }

  const moved: MoveInOutcome['moved'] = []
  let done = 0
  onProgress?.({ step: 'moving', done: 0, total: jobs.length })
  for (let i = 0; i < jobs.length; i += AT_ONCE) {
    await Promise.all(
      jobs.slice(i, i + AT_ONCE).map(async ({ receipt, value, account }) => {
        try {
          const sent = await sendMoney(account, to, value)
          moved.push({ stealthAddress: receipt.stealthAddress, txHash: sent.hash, amount: value })
          held.set(receipt.stealthAddress.toLowerCase(), 0n)
        } catch (error) {
          // Gone between the read and the move (moved from the web, say): nothing is lost.
          const now = await getBalance(receipt.stealthAddress).catch(() => null)
          if (now === 0n) {
            empty += 1
            held.set(receipt.stealthAddress.toLowerCase(), 0n)
          } else {
            failed += 1
            reason ??= moveProblem(error)
          }
        }
        done += 1
        onProgress?.({ step: 'moving', done, total: jobs.length })
      }),
    )
  }
  const amount = moved.reduce((sum, m) => sum + m.amount, 0n)
  const last = moved.at(-1)
  return {
    amount,
    count: moved.length,
    moved,
    explorerUrl: last ? explorerTx(last.txHash) : null,
    failed,
    reason,
    empty,
    held,
    ms: Date.now() - started,
  }
}
