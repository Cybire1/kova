import { schema } from '@kova/db'
import { eip3009Abi, formatAmount, TEST_DOLLARS_A_DAY } from '@kova/monad'
import { eq, lt } from 'drizzle-orm'
import { type Address, encodeFunctionData, type Hash } from 'viem'
import { feePayerAccount, publicClient, settlementToken, walletClient } from '../chain.js'
import { db } from '../db.js'
import { KovaError } from '../errors.js'
import { sendFromRelayer } from '../relay.js'

/**
 * Test dollars, on testnet only: five a day for each wallet, from Kova's own testnet treasury (the
 * relayer, which pays the gas too). Agora's faucet gives 10,000 at once and has run dry; a small
 * daily amount from Kova's own stock keeps trying Kova working for everyone, and the treasury is
 * topped up by hand.
 */
const DAY_MS = 24 * 60 * 60 * 1000

export interface Drip {
  amount: string
  txHash: Hash
  /** When this wallet can have more. */
  nextAt: Date
}

type Claim = { ok: true } | { ok: false; nextAt: Date }

/**
 * Takes today's test dollars for a wallet, or says when it can have more. One conditional upsert,
 * so two taps at once can't both be paid.
 */
export async function claimTestDollars(to: Address, now = new Date()): Promise<Claim> {
  const address = to.toLowerCase()
  const [won] = await db
    .insert(schema.testDollarClaims)
    .values({ address, claimedAt: now })
    .onConflictDoUpdate({
      target: schema.testDollarClaims.address,
      set: { claimedAt: now, txHash: null },
      setWhere: lt(schema.testDollarClaims.claimedAt, new Date(now.getTime() - DAY_MS)),
    })
    .returning({ address: schema.testDollarClaims.address })
  if (won) return { ok: true }
  const [held] = await db
    .select({ claimedAt: schema.testDollarClaims.claimedAt })
    .from(schema.testDollarClaims)
    .where(eq(schema.testDollarClaims.address, address))
  return { ok: false, nextAt: new Date((held?.claimedAt ?? now).getTime() + DAY_MS) }
}

/** Gives today's claim back when nothing was sent. A claim only wins when the last is a day old, so removing it restores exactly that. */
export async function releaseTestDollars(to: Address) {
  await db
    .delete(schema.testDollarClaims)
    .where(eq(schema.testDollarClaims.address, to.toLowerCase()))
}

/** "in 7 hours", "in 40 minutes": when a wallet can have more, without guessing its time zone. */
export function inAbout(nextAt: Date, now = new Date()): string {
  const minutes = Math.max(1, Math.ceil((nextAt.getTime() - now.getTime()) / 60_000))
  if (minutes >= 90) return `in ${Math.round(minutes / 60)} hours`
  if (minutes >= 60) return 'in an hour'
  return minutes === 1 ? 'in a minute' : `in ${minutes} minutes`
}

export async function giveTestDollars(to: Address): Promise<Drip> {
  if (!walletClient || !feePayerAccount)
    throw new KovaError('chain_error', 'Test dollars are not switched on for this server yet.')
  const now = new Date()
  const claim = await claimTestDollars(to, now)
  if (!claim.ok)
    throw new KovaError(
      'rate_limited',
      `That wallet has had today’s test dollars. More ${inAbout(claim.nextAt, now)}.`,
      {
        next_at: claim.nextAt.toISOString(),
      },
    )

  try {
    const stock = await publicClient.readContract({
      address: settlementToken.address,
      abi: eip3009Abi,
      functionName: 'balanceOf',
      args: [feePayerAccount.address],
    })
    if (stock < TEST_DOLLARS_A_DAY) {
      console.error(
        `[faucet] the treasury holds ${formatAmount(stock)} AUSD: top up ${feePayerAccount.address}`,
      )
      throw new KovaError(
        'chain_error',
        'Test dollars have run out for the moment. Kova is topping up; try again later.',
      )
    }
    // Through the relayer's one send path, so payments and test dollars never race for a nonce.
    const receipt = await sendFromRelayer(
      settlementToken.address,
      encodeFunctionData({
        abi: eip3009Abi,
        functionName: 'transfer',
        args: [to, TEST_DOLLARS_A_DAY],
      }),
    )
    if (receipt.status !== 'success')
      throw new KovaError('chain_error', 'The test-dollar top-up failed. Try again in a moment.')
    await db
      .update(schema.testDollarClaims)
      .set({ txHash: receipt.transactionHash })
      .where(eq(schema.testDollarClaims.address, to.toLowerCase()))
    return {
      amount: formatAmount(TEST_DOLLARS_A_DAY),
      txHash: receipt.transactionHash,
      nextAt: new Date(now.getTime() + DAY_MS),
    }
  } catch (error) {
    // A failed top-up doesn't use up the day. (On testnet, a rare timeout that did land costs five test dollars at most.)
    await releaseTestDollars(to)
    if (error instanceof KovaError) throw error
    console.error('[faucet]', error instanceof Error ? error.message.split('\n')[0] : error)
    throw new KovaError(
      'chain_error',
      'The test-dollar top-up didn’t go through. Try again in a moment.',
    )
  }
}
