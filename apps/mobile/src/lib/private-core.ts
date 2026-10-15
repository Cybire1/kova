import {
  checkStealthAddress,
  generateStealthAddress,
  generateStealthPayment,
  openStealthMemo,
  parseStealthMetaAddress,
  parseStealthViewKey,
  personalStealthKeysMessage,
  planPrivateSpend,
  type PrivateHolding,
  STEALTH_SCHEME_ID,
  type StealthKeys,
  stealthKeysFromSignature,
  stealthMemoMessage,
  stealthPrivateKey,
  stealthRegistrationMessage,
  stealthSender,
} from '@kova/monad'
import { type Address, getAddress, type Hash, type Hex, isAddressEqual, type LocalAccount, recoverMessageAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { balancesOf, explorerTx, getBalance, sendMoney } from './chain'
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
 * from that key, and Kova announces it in one public feed with every shop's private sales (and on
 * Monad, to ERC-5564's announcer), naming no recipient. Monad shows who sent how much, but not to
 * whom. Each payment carries a sealed memo (who sent it, their name, a note) that only the
 * recipient's viewing key opens, so the phone never has to ask Kova about one of its addresses.
 *
 * The recipient spends straight from those addresses: each signs its own transfer with a key only
 * the spending key can make, and Kova submits it and pays the gas. Several small ones are gathered
 * into one new address of theirs first. Moving them into the wallet is possible too, but that move
 * is public: it shows the addresses paying the wallet.
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
  /** Where the dollars came from on Monad: public anyway. Null when Kova doesn't know. */
  from?: Address | null
  /** The sealed memo, for the recipient's viewing key. */
  sealed?: Hex | null
  /** Kova's ERC-5564 Announcement on Monad, a few seconds after the payment. */
  announce_tx?: Hash | null
  announce_url?: string | null
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
  /** Who sent it: their wallet, from the sealed memo or Monad. Null when there's no telling. */
  from: Address | null
  /** What the sender calls themselves, from the memo. */
  senderName?: string | null
  /**
   * How sure that is: 'chain' when Monad shows it left their wallet, 'signed' when their wallet
   * signed for it, 'claimed' when only the memo says so (shown as unconfirmed).
   */
  proven?: 'chain' | 'signed' | 'claimed' | null
  /** Their note, from the sealed memo. */
  note: string | null
  /** 'change': this wallet's own private dollars, gathered into one address. Not a payment to it. */
  kind?: 'send' | 'change'
  /** Base units at the one-time address, as last read from Monad: "0" once it's spent or moved in. */
  held: string
  /** The move into this wallet, when this phone made it. */
  movedTx?: Hash
  /** Kova's Announcement of it on Monad (ERC-5564), once posted. */
  announceUrl?: string | null
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

/**
 * A payment found in the feed, read with this wallet's viewing key: its sealed memo opened on the
 * phone (who sent it, their name, their note), and the sender checked against Monad or their
 * signature. Nothing about the one-time address is asked of Kova.
 */
export async function readReceipt(viewingPrivateKey: Hex, item: Announcement): Promise<PrivateReceipt> {
  const amount = toBase(item.amount).toString()
  const stealthAddress = getAddress(item.stealth_address)
  const memo = openStealthMemo(viewingPrivateKey, { ephemeralPublicKey: item.ephemeral_public_key, stealthAddress, sealed: item.sealed })
  const sender = await stealthSender(memo, { stealthAddress, from: item.from ?? null }).catch(() => null)
  return {
    id: item.id,
    stealthAddress,
    ephemeralPublicKey: item.ephemeral_public_key,
    amount,
    txHash: item.tx_hash,
    explorerUrl: item.explorer_url,
    at: item.paid_at ? Date.parse(item.paid_at) : Date.now(),
    from: sender?.address ?? null,
    senderName: sender?.name ?? null,
    proven: sender?.proven ?? null,
    note: memo?.note ?? null,
    kind: memo?.kind === 'change' ? 'change' : 'send',
    held: amount,
    announceUrl: item.announce_url ?? null,
  }
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

/** One move at a time: Kova's relayer sends them in order anyway. */
const AT_ONCE = 1

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

// --- Spending private dollars ----------------------------------------------------------------------

/** The account that signs for a one-time address, checked to open exactly that address. */
export function oneTimeAccount(keys: StealthKeys, receipt: Pick<PrivateReceipt, 'stealthAddress' | 'ephemeralPublicKey'>): LocalAccount {
  const account = privateKeyToAccount(stealthPrivateKey(keys, receipt.ephemeralPublicKey))
  if (!isAddressEqual(account.address, receipt.stealthAddress)) throw new Error('A private payment’s address didn’t open with your keys. Nothing moved.')
  return account
}

/** Private dollars as the router reads them: each address that still holds some, and how much. */
export function holdingsOf(receipts: PrivateReceipt[]): PrivateHolding<PrivateReceipt>[] {
  return receipts.flatMap((r) => (BigInt(r.held) > 0n ? [{ item: r, held: BigInt(r.held) }] : []))
}

/**
 * Which private dollars pay `amount`: the smallest single address that covers it (the change stays
 * there, still private), or, when none does alone, the largest ones until they cover it together,
 * to be gathered into one address first. Null when they don't cover it at all. The rule is the
 * router's, shared with the web (@kova/monad).
 */
export function planSpend(receipts: PrivateReceipt[], amount: bigint): { from: PrivateReceipt } | { gather: PrivateReceipt[] } | null {
  return planPrivateSpend(holdingsOf(receipts), amount)
}

/**
 * Gathers several one-time addresses into one new address of this wallet's: each moves its whole
 * balance there (the first carries the sealed memo, kind 'change', vouched for by the wallet's
 * signature), one at a time. Those addresses become linked to each other on Monad, but not to the
 * wallet. Returns the new address as a private receipt, to pay from at once.
 */
export async function gather(input: {
  keys: StealthKeys
  meta: string
  sources: PrivateReceipt[]
  me: Address
  name?: string | null
  sign: (message: string) => Promise<Hex>
  onProgress?: (done: number, total: number) => void
}): Promise<{ receipt: PrivateReceipt; moved: { from: Address; txHash: Hash; amount: bigint }[] }> {
  const { keys, meta, sources, me, onProgress } = input
  const e = generatePrivateKey()
  const address = generateStealthAddress(meta, e).stealthAddress
  const proof = await input.sign(stealthMemoMessage(address))
  const g = generateStealthPayment(meta, { from: me, ...(input.name ? { name: input.name } : {}), kind: 'change', proof }, e)
  const held = await balancesOf(sources.map((r) => r.stealthAddress))
  const moved: { from: Address; txHash: Hash; amount: bigint }[] = []
  for (const [i, r] of sources.entries()) {
    const value = held.get(r.stealthAddress.toLowerCase()) ?? BigInt(r.held)
    if (value === 0n) continue
    const first = moved.length === 0
    const sent = await sendMoney(
      oneTimeAccount(keys, r),
      g.stealthAddress,
      value,
      undefined,
      first ? { ephemeralPublicKey: g.ephemeralPublicKey, viewTag: g.viewTag, sealed: g.sealed } : undefined,
    )
    moved.push({ from: r.stealthAddress, txHash: sent.hash, amount: value })
    onProgress?.(i + 1, sources.length)
  }
  const first = moved[0]
  if (!first) throw new Error('Those private dollars had already moved. Nothing was paid.')
  const total = moved.reduce((sum, m) => sum + m.amount, 0n)
  return {
    moved,
    receipt: {
      id: `local:${g.stealthAddress.toLowerCase()}`,
      stealthAddress: g.stealthAddress,
      ephemeralPublicKey: g.ephemeralPublicKey,
      amount: total.toString(),
      txHash: first.txHash,
      explorerUrl: explorerTx(first.txHash),
      at: Date.now(),
      from: me,
      senderName: input.name ?? null,
      proven: 'signed',
      note: null,
      kind: 'change',
      held: total.toString(),
    },
  }
}
