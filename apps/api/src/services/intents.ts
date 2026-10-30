import { schema, uuidv7 } from '@kova/db'
import {
  type Currency,
  encodeMemo,
  formatAmount,
  generateStealthAddress,
  parseAmount,
} from '@kova/monad'
import { and, eq, lt } from 'drizzle-orm'
import { tokenFor } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { KovaError, notFound } from '../errors.js'
import { encodeId } from '../ids.js'

type Merchant = typeof schema.merchants.$inferSelect
export type PaymentIntent = typeof schema.paymentIntents.$inferSelect

export interface CreateIntentInput {
  merchant: Merchant
  amount: string
  currency: Currency
  reference?: string | undefined
  metadata?: Record<string, unknown> | undefined
  terminalId?: string | undefined
  expiresInSeconds?: number | undefined
  /** A stamp card can make an order free: it is still paid, for $0, so it has a receipt on Monad like any other. */
  allowZero?: boolean | undefined
}

export async function createIntent(input: CreateIntentInput): Promise<PaymentIntent> {
  const amount = parseAmount(input.amount)
  if (amount < 0n || (amount === 0n && !input.allowZero))
    throw new KovaError('invalid_request', 'amount must be greater than zero')

  const token = tokenFor(input.currency)
  const id = uuidv7()
  const ttl = input.expiresInSeconds ?? config.KOVA_INTENT_TTL_SECONDS

  if (input.terminalId) {
    const terminal = await db.query.terminals.findFirst({
      where: and(
        eq(schema.terminals.id, input.terminalId),
        eq(schema.terminals.merchantId, input.merchant.id),
      ),
    })
    if (!terminal) throw notFound('terminal', input.terminalId)
  }

  // Private takings: the customer pays a fresh one-time address only the shop can open, and the
  // announcement that lets the shop find it is written in the same transaction, so a sale can never
  // land somewhere its shop can't see.
  const sale = input.merchant.stealthMetaAddress
    ? generateStealthAddress(input.merchant.stealthMetaAddress)
    : null

  const intent = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.paymentIntents)
      .values({
        id,
        merchantId: input.merchant.id,
        terminalId: input.terminalId ?? null,
        amount,
        currency: input.currency,
        tokenAddress: token.address,
        network: input.merchant.network,
        // The merchant's settlement address, or with private takings, this sale's own address.
        // The memo does the attribution either way.
        // With splits (and no private takings), the shop's splitter, which shares the sale out.
        payTo: sale
          ? sale.stealthAddress
          : (input.merchant.splitterAddress ?? input.merchant.settlementAddress),
        memo: encodeMemo({ kind: 'payment', id }),
        reference: input.reference ?? null,
        metadata: input.metadata ?? null,
        isTest: input.merchant.isTest,
        expiresAt: new Date(Date.now() + ttl * 1000),
      })
      .returning()
    if (row && sale)
      await tx.insert(schema.stealthPayments).values({
        id: uuidv7(),
        network: input.merchant.network,
        merchantId: input.merchant.id,
        intentId: row.id,
        stealthAddress: sale.stealthAddress.toLowerCase(),
        ephemeralPublicKey: sale.ephemeralPublicKey,
        viewTag: sale.viewTag,
      })
    return row
  })

  if (!intent) throw new KovaError('internal', 'Failed to create payment intent')
  return intent
}

export async function getIntent(merchantId: string, id: string): Promise<PaymentIntent> {
  const intent = await db.query.paymentIntents.findFirst({
    where: and(eq(schema.paymentIntents.id, id), eq(schema.paymentIntents.merchantId, merchantId)),
  })
  if (!intent) throw notFound('payment intent', id)
  return intent
}

/** Looks up an intent by its on-chain memo. Used by the relay and the chain watcher. */
export async function findIntentByMemo(memo: string): Promise<PaymentIntent | undefined> {
  return db.query.paymentIntents.findFirst({ where: eq(schema.paymentIntents.memo, memo) })
}

export async function cancelIntent(merchantId: string, id: string): Promise<PaymentIntent> {
  const intent = await getIntent(merchantId, id)
  if (intent.status === 'paid') throw new KovaError('conflict', 'This intent is already paid')
  if (intent.status !== 'requires_payment')
    throw new KovaError('conflict', `Cannot cancel an intent that is ${intent.status}`)

  const [updated] = await db
    .update(schema.paymentIntents)
    .set({ status: 'canceled', updatedAt: new Date() })
    .where(eq(schema.paymentIntents.id, id))
    .returning()
  return updated as PaymentIntent
}

/** Expires intents past their deadline. Safe to run repeatedly. */
export async function expireStaleIntents(): Promise<number> {
  const expired = await db
    .update(schema.paymentIntents)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(
      and(
        eq(schema.paymentIntents.status, 'requires_payment'),
        lt(schema.paymentIntents.expiresAt, new Date()),
      ),
    )
    .returning({ id: schema.paymentIntents.id })
  return expired.length
}

/** The public representation. Internal UUIDs never leave the API. */
export function serializeIntent(intent: PaymentIntent) {
  return {
    id: encodeId('paymentIntent', intent.id),
    object: 'payment_intent',
    amount: formatAmount(intent.amount),
    currency: intent.currency,
    status: intent.status,
    network: intent.network,
    token: intent.tokenAddress,
    pay_to: intent.payTo,
    memo: intent.memo,
    reference: intent.reference,
    metadata: intent.metadata,
    livemode: !intent.isTest,
    expires_at: intent.expiresAt.toISOString(),
    paid_at: intent.paidAt?.toISOString() ?? null,
    created_at: intent.createdAt.toISOString(),
  }
}
