import { schema } from '@kova/db'
import {
  ERC5564_ANNOUNCER,
  erc5564AnnouncerAbi,
  STEALTH_SCHEME_ID,
  stealthMetadata,
} from '@kova/monad'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { type Address, encodeFunctionData, type Hash, type Hex } from 'viem'
import { publicClient } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { relayReady, sendFromRelayer } from '../relay.js'

/**
 * Posts every private payment to ERC-5564's announcer on Monad: a person's private send once it's
 * relayed, a shop's private sale once it's paid. Kova's feed already has them; on chain, any wallet
 * can find its payments without Kova, and nobody has to take Kova's word for the feed.
 *
 * The announcement names no recipient: the one-time address, the ephemeral key, and metadata laid
 * out as ERC-5564 does for a token (view tag, the transfer, the token, the amount), then the sender's
 * sealed memo. One at a time, through the relayer's one send path, so its nonce has one owner and a
 * payment is never stuck behind an announcement for long.
 */

const EVERY_MS = 4_000
/** An announcement costs about 40k gas; anything far beyond that is not one. */
const MAX_GAS = 400_000n
/** A row that failed is tried again after this long, so a bad one can't hold the queue. */
const RETRY_MS = 60_000

const failedAt = new Map<string, number>()

interface Pending {
  key: string
  stealthAddress: string
  ephemeralPublicKey: string
  viewTag: string
  token: string
  amount: bigint
  sealed: string | null
  save: (tx: Hash) => Promise<unknown>
}

async function nextPending(): Promise<Pending[]> {
  const sends = await db
    .select()
    .from(schema.stealthAnnouncements)
    .where(
      and(
        eq(schema.stealthAnnouncements.network, config.KOVA_NETWORK),
        isNull(schema.stealthAnnouncements.announceTx),
      ),
    )
    .orderBy(asc(schema.stealthAnnouncements.id))
    .limit(10)
  const sales = await db
    .select({ sale: schema.stealthPayments, intent: schema.paymentIntents })
    .from(schema.stealthPayments)
    .innerJoin(schema.paymentIntents, eq(schema.paymentIntents.id, schema.stealthPayments.intentId))
    .where(
      and(
        eq(schema.stealthPayments.network, config.KOVA_NETWORK),
        isNull(schema.stealthPayments.announceTx),
        eq(schema.paymentIntents.status, 'paid'),
      ),
    )
    .orderBy(asc(schema.stealthPayments.id))
    .limit(10)
  return [
    ...sends.map((a) => ({
      key: `send:${a.id}`,
      stealthAddress: a.stealthAddress,
      ephemeralPublicKey: a.ephemeralPublicKey,
      viewTag: a.viewTag,
      token: a.tokenAddress,
      amount: a.amount,
      sealed: a.sealed,
      save: (tx: Hash) =>
        db
          .update(schema.stealthAnnouncements)
          .set({ announceTx: tx })
          .where(eq(schema.stealthAnnouncements.id, a.id)),
    })),
    ...sales.map(({ sale, intent }) => ({
      key: `sale:${sale.id}`,
      stealthAddress: sale.stealthAddress,
      ephemeralPublicKey: sale.ephemeralPublicKey,
      viewTag: sale.viewTag,
      token: intent.tokenAddress,
      amount: intent.amount,
      sealed: null,
      save: (tx: Hash) =>
        db
          .update(schema.stealthPayments)
          .set({ announceTx: tx })
          .where(eq(schema.stealthPayments.id, sale.id)),
    })),
  ].filter((p) => Date.now() - (failedAt.get(p.key) ?? 0) > RETRY_MS)
}

async function announce(p: Pending): Promise<Hash> {
  const data = encodeFunctionData({
    abi: erc5564AnnouncerAbi,
    functionName: 'announce',
    args: [
      BigInt(STEALTH_SCHEME_ID),
      p.stealthAddress as Address,
      p.ephemeralPublicKey as Hex,
      stealthMetadata({
        viewTag: p.viewTag as Hex,
        token: p.token as Address,
        amount: p.amount,
        sealed: p.sealed as Hex | null,
      }),
    ],
  })
  const receipt = await sendFromRelayer(ERC5564_ANNOUNCER, data, { maxGas: MAX_GAS })
  if (receipt.status !== 'success')
    throw new Error(`announcement reverted (${receipt.transactionHash})`)
  return receipt.transactionHash
}

export function startAnnouncer(): void {
  if (!relayReady()) return
  let ready: boolean | undefined
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      if (ready === undefined) {
        const code = await publicClient.getCode({ address: ERC5564_ANNOUNCER })
        ready = Boolean(code && code !== '0x')
        console.log(
          ready
            ? `[announcer] posting private payments to ERC-5564's announcer at ${ERC5564_ANNOUNCER}`
            : `[announcer] no ERC-5564 announcer on this network: private payments stay in Kova's feed`,
        )
      }
      if (!ready) return
      for (const p of await nextPending()) {
        try {
          const tx = await announce(p)
          await p.save(tx)
          failedAt.delete(p.key)
        } catch (error) {
          failedAt.set(p.key, Date.now())
          console.error(
            '[announcer] not posted',
            p.key,
            error instanceof Error ? error.message.split('\n')[0] : error,
          )
        }
      }
    } catch (error) {
      // A read that failed (the code check, the queue): tried again on the next tick.
      if (ready === undefined)
        console.error(
          '[announcer] check failed',
          error instanceof Error ? error.message.split('\n')[0] : error,
        )
    } finally {
      running = false
    }
  }
  void tick()
  setInterval(() => void tick(), EVERY_MS)
}
