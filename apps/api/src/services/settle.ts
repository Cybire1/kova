import { schema, uuidv7 } from '@kova/db'
import {
  decodeCardPayments,
  decodeMemo,
  eip3009Abi,
  kovaCardAddress,
  verifyPayment,
} from '@kova/monad'
import { and, eq, isNull } from 'drizzle-orm'
import { type Address, decodeEventLog, type Hash, type TransactionReceipt } from 'viem'
import { publicClient } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { KovaError } from '../errors.js'
import { encodeId } from '../ids.js'
import { findIntentByMemo, type PaymentIntent } from './intents.js'
import { takeStock } from './orders.js'
import { onIntentPaid } from './travel.js'

/** Kova Card taps settle like any payment: the KovaCard contract records the charge's memo. */
const cardContract = kovaCardAddress(config.KOVA_NETWORK)

export interface SettleResult {
  status: 'paid' | 'held' | 'failed' | 'ignored'
  paymentId?: string
  reason?: string
}

/**
 * Records an on-chain transfer against its payment intent.
 *
 * This is the single place a payment becomes real, and it is deliberately idempotent: the
 * same transaction can arrive from the relay (which submitted it), from the chain watcher
 * (which sees every transfer), and from a client calling /confirm, in any order.
 */
export async function settleFromReceipt(
  receipt: TransactionReceipt,
  options: { credentialId?: string | undefined } = {},
): Promise<SettleResult> {
  const existing = await db.query.payments.findFirst({
    where: eq(schema.payments.txHash, receipt.transactionHash),
  })
  if (existing) return { status: existing.status as SettleResult['status'], paymentId: existing.id }

  // Find the intent this transaction claims to pay, from the Kova memo it carries.
  const intent = await findIntentForReceipt(receipt)
  if (!intent) return { status: 'ignored', reason: 'no matching payment intent' }

  const verdict = verifyPayment(receipt, {
    token: intent.tokenAddress as Address,
    payTo: intent.payTo as Address,
    amount: intent.amount,
    memo: intent.memo as `0x${string}`,
    cardContract,
  })

  if (verdict.status === 'pending') return { status: 'ignored', reason: 'pending' }
  if (verdict.status === 'unmatched' || verdict.status === 'memo_mismatch')
    return { status: 'ignored', reason: verdict.status }

  const status: 'paid' | 'failed' = verdict.status === 'paid' ? 'paid' : 'failed'
  const paymentId = uuidv7()
  const now = new Date()

  await db.transaction(async (tx) => {
    await tx.insert(schema.payments).values({
      id: paymentId,
      intentId: intent.id,
      txHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      payerAddress: verdict.payer ?? '0x',
      credentialId: options.credentialId ?? null,
      amount: intent.amount,
      tokenAddress: intent.tokenAddress,
      status,
      gasUsed: receipt.gasUsed,
      // Whoever submitted the authorization paid the gas: Kova's relayer, or the payer's own wallet.
      feePayerAddress: receipt.from,
      confirmedAt: status === 'paid' ? now : null,
    })

    await tx
      .update(schema.paymentIntents)
      .set({
        status,
        paidAt: status === 'paid' ? now : null,
        updatedAt: now,
      })
      .where(eq(schema.paymentIntents.id, intent.id))

    if (status === 'paid') {
      // Double entry: the payer's funds left an account Kova does not control, and the
      // merchant's settlement address gained them.
      await tx.insert(schema.ledgerEntries).values([
        {
          id: uuidv7(),
          account: 'external',
          direction: 'debit',
          amount: intent.amount,
          currency: intent.currency,
          refType: 'payment',
          refId: paymentId,
        },
        {
          id: uuidv7(),
          account: `merchant:${intent.merchantId}`,
          direction: 'credit',
          amount: intent.amount,
          currency: intent.currency,
          refType: 'payment',
          refId: paymentId,
        },
      ])
      // A till sale changes hands across the counter as it is paid: it is never waiting to be collected.
      await tx
        .update(schema.orders)
        .set({ collectedAt: now })
        .where(
          and(
            eq(schema.orders.intentId, intent.id),
            eq(schema.orders.source, 'till'),
            isNull(schema.orders.collectedAt),
          ),
        )
    }

    await tx.insert(schema.events).values({
      id: uuidv7(),
      merchantId: intent.merchantId,
      type: status === 'paid' ? 'payment_intent.paid' : `payment_intent.${status}`,
      data: {
        payment_intent: encodeId('paymentIntent', intent.id),
        payment: encodeId('payment', paymentId),
        tx_hash: receipt.transactionHash,
        amount: intent.amount.toString(),
        currency: intent.currency,
      },
    })
  })

  // The last share of a Kova Travel trip books it. Outside the transaction: booking calls Duffel.
  if (status === 'paid')
    void onIntentPaid(intent.id).catch((error) => console.error('[travel] after payment', error))
  if (status === 'paid')
    void takeStock(intent.id).catch((error) => console.error('[stock] after payment', error))

  return { status, paymentId }
}

/** The intent a receipt claims to pay: the authorization (or card tap) carrying a Kova payment memo. */
async function findIntentForReceipt(
  receipt: TransactionReceipt,
): Promise<PaymentIntent | undefined> {
  for (const tap of decodeCardPayments(receipt.logs, cardContract)) {
    if (decodeMemo(tap.memo)?.kind !== 'payment') continue
    const intent = await findIntentByMemo(tap.memo)
    if (intent) return intent
  }
  for (const log of receipt.logs) {
    let nonce: `0x${string}`
    try {
      // decodeEventLog decodes whatever event the log is; it doesn't enforce the name asked for.
      const event = decodeEventLog({ abi: eip3009Abi, data: log.data, topics: log.topics })
      if (event.eventName !== 'AuthorizationUsed') continue
      nonce = event.args.nonce
    } catch {
      continue
    }
    if (decodeMemo(nonce)?.kind !== 'payment') continue
    const intent = await findIntentByMemo(nonce)
    if (intent) return intent
  }
  return undefined
}

/** Confirms a transaction hash a client reports, verifying it independently on-chain. */
export async function confirmTransaction(
  txHash: Hash,
  options: { credentialId?: string | undefined } = {},
): Promise<SettleResult> {
  let receipt: TransactionReceipt
  try {
    receipt = await publicClient.getTransactionReceipt({ hash: txHash })
  } catch (error) {
    throw new KovaError('chain_error', `Could not read transaction ${txHash}`, {
      cause: String(error),
    })
  }
  return settleFromReceipt(receipt, options)
}
