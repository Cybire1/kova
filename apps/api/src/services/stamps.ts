import { schema } from '@kova/db'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '../db.js'

/**
 * The stamp card: every order a wallet pays at a shop is a stamp, and once a stall's card is full
 * the next order there has its cheapest item free. There is nothing to sign up for: the wallet
 * that pays is the card, and its stamps are read from the shop's own paid orders.
 */

/** Stamps a wallet holds at a shop: paid orders since it last spent a full card. */
export async function stampsAt(merchantId: string, payer: string): Promise<number> {
  const rows = await db
    .select({ reward: schema.orders.reward })
    .from(schema.orders)
    .innerJoin(schema.paymentIntents, eq(schema.paymentIntents.id, schema.orders.intentId))
    .innerJoin(schema.payments, eq(schema.payments.intentId, schema.paymentIntents.id))
    .where(
      and(
        eq(schema.orders.merchantId, merchantId),
        eq(schema.paymentIntents.status, 'paid'),
        eq(schema.payments.status, 'paid'),
        sql`lower(${schema.payments.payerAddress}) = ${payer.toLowerCase()}`,
      ),
    )
    .orderBy(desc(schema.paymentIntents.paidAt))
    .limit(200)
  let stamps = 0
  for (const row of rows) {
    if (row.reward) break
    stamps++
  }
  return stamps
}

/** A stall's card, as the buyer sees it. */
export async function stampCard(
  stall: { merchantId: string; loyaltyEvery: number | null },
  payer: string,
) {
  if (!stall.loyaltyEvery) return null
  const stamps = await stampsAt(stall.merchantId, payer)
  return {
    every: stall.loyaltyEvery,
    stamps: Math.min(stamps, stall.loyaltyEvery),
    ready: stamps >= stall.loyaltyEvery,
  }
}
