import { schema, uuidv7 } from '@kova/db'
import { encodeMemo, tokenByAddress, transferAuthorizationTypedData } from '@kova/monad'
import { and, eq, inArray } from 'drizzle-orm'
import { type Address, isAddressEqual } from 'viem'
import { feePayerAccount, network } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { relayAuthorization } from '../relay.js'

/**
 * Gives a trip's money back when it can't be booked: every paid share goes back to the wallet
 * that paid it, from Kova Travel's treasury. The treasury signs an authorization like any payer,
 * with a refund memo as its nonce, so the payer's wallet can tell on-chain what the money is.
 * Each payment is refunded at most once (the refunds table remembers).
 *
 * On testnet the treasury is the relay's own account, so this runs by itself. On mainnet the
 * treasury key lives elsewhere, and refunds are recorded as pending for the treasury to send.
 */
export async function refundTrip(tripId: string, reason: string) {
  const shares = await db.query.tripShares.findMany({ where: eq(schema.tripShares.tripId, tripId) })
  if (shares.length === 0) return
  const paid = await db.query.payments.findMany({
    where: and(
      inArray(
        schema.payments.intentId,
        shares.map((s) => s.intentId),
      ),
      eq(schema.payments.status, 'paid'),
    ),
  })
  const shop = await db.query.merchants.findFirst({
    where: eq(schema.merchants.slug, 'kova-travel'),
  })
  const treasury =
    feePayerAccount &&
    shop &&
    config.KOVA_NETWORK === 'testnet' &&
    isAddressEqual(shop.settlementAddress as Address, feePayerAccount.address)
      ? feePayerAccount
      : null

  for (const payment of paid) {
    const already = await db.query.refunds.findFirst({
      where: eq(schema.refunds.paymentId, payment.id),
    })
    if (already) continue
    const id = uuidv7()
    const memo = encodeMemo({ kind: 'refund', id })
    await db.insert(schema.refunds).values({
      id,
      paymentId: payment.id,
      amount: payment.amount,
      memo,
      reason,
      status: 'pending',
    })
    const token = tokenByAddress(config.KOVA_NETWORK, payment.tokenAddress as Address)
    if (!treasury || !token) {
      console.warn('[refund] recorded for the treasury to send', id)
      continue
    }
    try {
      const authorization = {
        from: treasury.address,
        to: payment.payerAddress as Address,
        value: payment.amount,
        validAfter: 0n,
        validBefore: BigInt(Math.floor(Date.now() / 1000) + 600),
        nonce: memo,
      }
      const signature = await treasury.signTypedData(
        transferAuthorizationTypedData(token, network.chainId, authorization),
      )
      const { receipt } = await relayAuthorization(token, authorization, signature)
      await db
        .update(schema.refunds)
        .set({ status: 'confirmed', txHash: receipt.transactionHash, confirmedAt: new Date() })
        .where(eq(schema.refunds.id, id))
    } catch (error) {
      console.error('[refund] failed', id, error instanceof Error ? error.message : error)
      await db.update(schema.refunds).set({ status: 'failed' }).where(eq(schema.refunds.id, id))
    }
  }
}
