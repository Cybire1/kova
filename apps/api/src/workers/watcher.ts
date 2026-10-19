import { schema, uuidv7 } from '@kova/db'
import {
  decodeAuthorizedTransfers,
  decodeCardTransfers,
  decodeMemo,
  decodeTokenTransfers,
  eip3009Abi,
  kovaCardAbi,
  kovaCardAddress,
  LOG_RANGE,
} from '@kova/monad'
import { eq } from 'drizzle-orm'
import { type Address, getAbiItem, type Hash, isAddressEqual, type Log } from 'viem'
import { acceptedTokens, network, publicClient } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { notifyArrivals } from '../services/arrival-sms.js'
import { settleFromReceipt } from '../services/settle.js'

/**
 * Watches Monad for money moving in the tokens Kova accepts. One scan does two jobs:
 *
 * - It settles charges paid by any route. An authorization whose nonce is a Kova memo pays its
 *   charge whoever submits it (Kova's relayer, a browser wallet paying its own gas, anyone), and
 *   the watcher is the backstop if the relayer stops between submitting a payment and recording
 *   it. Settlement is idempotent, so seeing a payment the relayer already recorded is a no-op.
 * - It indexes every transfer, so wallets can ask Kova what arrived. Monad's RPCs answer log
 *   queries 100 blocks (about 30 seconds) at a time, too little for a phone to catch up itself.
 *
 * It reads only finalized blocks (two behind the tip, about 0.6s), so nothing it records can be
 * reorganized away.
 */

const events = [
  getAbiItem({ abi: eip3009Abi, name: 'AuthorizationUsed' }),
  getAbiItem({ abi: eip3009Abi, name: 'Transfer' }),
  getAbiItem({ abi: kovaCardAbi, name: 'CardPayment' }),
]
const tokens: Address[] = acceptedTokens.map((t) => t.address)
/** Card taps: the KovaCard contract records which charge each one paid. */
const cardContract = kovaCardAddress(config.KOVA_NETWORK)
const watched: Address[] = cardContract ? [...tokens, cardContract] : tokens

/** About 15 minutes of blocks: a fresh deployment still sees every charge that could be open. */
const COLD_START_LOOKBACK = 3_000n
/** About six hours. A longer outage skips ahead rather than crawling for minutes at startup. */
const MAX_CATCH_UP = 70_000n
/** Log windows fetched at once while catching up: two stays well inside public RPC limits. */
const CATCH_UP_CONCURRENCY = 2
/** Windows per poll, so catching up after downtime is steady progress rather than a burst. */
const WINDOWS_PER_TICK = 20n
/** Blocks are ~0.31s, so a poll a second keeps the watcher a few blocks behind at worst. */
const POLL_INTERVAL = 1_000
/** After a failed poll, wait this long, doubling to a minute, before trying again. */
const FIRST_BACKOFF = 2_000

export interface WatcherHandle {
  stop: () => Promise<void>
}

const finalizedBlock = async () => (await publicClient.getBlock({ blockTag: 'finalized' })).number

async function loadCursor(head: bigint): Promise<bigint> {
  const row = await db.query.watcherState.findFirst({
    where: eq(schema.watcherState.network, config.KOVA_NETWORK),
  })
  if (row && head - row.lastBlock <= MAX_CATCH_UP) return row.lastBlock
  const from = head > COLD_START_LOOKBACK ? head - COLD_START_LOOKBACK : 0n
  if (row)
    console.warn(`[watcher] ${head - row.lastBlock} blocks behind; skipping ahead to ${from}`)
  await saveCursor(from)
  return from
}

async function saveCursor(block: bigint): Promise<void> {
  await db
    .insert(schema.watcherState)
    .values({ network: config.KOVA_NETWORK, lastBlock: block, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.watcherState.network,
      set: { lastBlock: block, updatedAt: new Date() },
    })
}

/** The block the index is complete up to. Wallets use it as their cursor. */
export async function indexedThrough(): Promise<bigint | null> {
  const row = await db.query.watcherState.findFirst({
    where: eq(schema.watcherState.network, config.KOVA_NETWORK),
  })
  return row?.lastBlock ?? null
}

/** Records a batch of logs: every transfer into the index, and any charge they pay. */
export async function handleLogs(logs: Log[]): Promise<number> {
  const byTx = new Map<Hash, Log[]>()
  for (const log of logs) {
    if (!log.transactionHash) continue
    const list = byTx.get(log.transactionHash) ?? []
    list.push(log)
    byTx.set(log.transactionHash, list)
  }

  let recorded = 0
  for (const [hash, txLogs] of byTx) {
    const rows: (typeof schema.transfers.$inferInsert)[] = []
    let paysACharge = false
    for (const token of tokens) {
      const tokenLogs = txLogs.filter((log) => isAddressEqual(log.address, token))
      if (tokenLogs.length === 0) continue
      // Card taps pair a CardPayment with the token's Transfer, so both kinds of log are in play.
      const cardLogs = cardContract
        ? txLogs.filter((log) => isAddressEqual(log.address, cardContract))
        : []
      const paired = [...tokenLogs, ...cardLogs]
      const authorized = [
        ...decodeAuthorizedTransfers(tokenLogs, token),
        ...decodeCardTransfers(paired, token, cardContract),
      ]
      if (authorized.some((a) => decodeMemo(a.nonce)?.kind === 'payment')) paysACharge = true
      for (const transfer of decodeTokenTransfers(paired, token, cardContract)) {
        const log = tokenLogs.find((l) => l.logIndex === transfer.logIndex)
        if (!log || log.blockNumber === null) continue
        rows.push({
          id: uuidv7(),
          network: config.KOVA_NETWORK,
          tokenAddress: token.toLowerCase(),
          fromAddress: transfer.from.toLowerCase(),
          toAddress: transfer.to.toLowerCase(),
          amount: transfer.value,
          txHash: hash,
          logIndex: transfer.logIndex,
          blockNumber: log.blockNumber,
          nonce: transfer.nonce,
        })
      }
    }
    if (rows.length) {
      // Only rows this insert added: a replayed block is already indexed, so it never texts twice.
      const added = await db.insert(schema.transfers).values(rows).onConflictDoNothing().returning({
        tokenAddress: schema.transfers.tokenAddress,
        fromAddress: schema.transfers.fromAddress,
        toAddress: schema.transfers.toAddress,
        amount: schema.transfers.amount,
      })
      recorded += rows.length
      if (added.length)
        void notifyArrivals(added).catch((error) =>
          console.error('[watcher] arrival texts', error instanceof Error ? error.message : error),
        )
    }
    if (paysACharge) await settleTransaction(hash)
  }
  return recorded
}

async function settleTransaction(hash: Hash): Promise<void> {
  const existing = await db.query.payments.findFirst({ where: eq(schema.payments.txHash, hash) })
  if (existing) return
  const receipt = await publicClient.getTransactionReceipt({ hash })
  const result = await settleFromReceipt(receipt)
  if (result.status !== 'ignored') console.log(`[watcher] ${hash} -> ${result.status}`)
}

/** Replays a block range in 100-block windows, a few at a time, recording them in order. */
export async function catchUp(fromBlock: bigint, toBlock: bigint): Promise<number> {
  let recorded = 0
  let start = fromBlock
  while (start <= toBlock) {
    const windows: [bigint, bigint][] = []
    for (let i = 0; i < CATCH_UP_CONCURRENCY && start <= toBlock; i++) {
      const end = start + LOG_RANGE - 1n < toBlock ? start + LOG_RANGE - 1n : toBlock
      windows.push([start, end])
      start = end + 1n
    }
    const batches = await Promise.all(
      windows.map(([from, to]) =>
        publicClient.getLogs({ address: watched, events, fromBlock: from, toBlock: to }),
      ),
    )
    for (const logs of batches) recorded += await handleLogs(logs as Log[])
  }
  return recorded
}

/**
 * Starts watching, and never gives up: the cursor lives in the database, each poll moves it
 * forward by at most a few thousand blocks, and a failed poll (a rate limit, an RPC outage) only
 * pauses it, with backoff. It is never a one-shot catch-up that can die at startup.
 */
export async function startWatcher(): Promise<WatcherHandle> {
  let cursor: bigint | null = null
  let stopped = false
  let inFlight = false
  let backoff = 0
  let resumeAt = 0
  let caughtUp = false

  const poll = async () => {
    if (stopped || inFlight || Date.now() < resumeAt) return
    inFlight = true
    try {
      const head = await finalizedBlock()
      if (cursor === null) cursor = await loadCursor(head)
      if (head > cursor) {
        const until =
          cursor + LOG_RANGE * WINDOWS_PER_TICK < head
            ? cursor + LOG_RANGE * WINDOWS_PER_TICK
            : head
        await catchUp(cursor + 1n, until)
        cursor = until
        await saveCursor(cursor)
      }
      if (!caughtUp && cursor >= head) {
        caughtUp = true
        console.log(`[watcher] ${network.name}: caught up to block ${head}`)
      }
      backoff = 0
    } catch (error) {
      backoff = backoff ? Math.min(backoff * 2, 60_000) : FIRST_BACKOFF
      resumeAt = Date.now() + backoff
      console.error(
        `[watcher] poll failed; retrying in ${backoff / 1000}s:`,
        error instanceof Error
          ? ((error as { details?: string }).details ?? error.message.split('\n')[0])
          : error,
      )
    } finally {
      inFlight = false
    }
  }

  void poll()
  const timer = setInterval(() => void poll(), POLL_INTERVAL)

  return {
    stop: async () => {
      stopped = true
      clearInterval(timer)
      if (cursor !== null) await saveCursor(cursor)
    },
  }
}
