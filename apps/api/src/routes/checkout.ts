import { schema } from '@kova/db'
import { explorerTxUrl, formatAmount, parseSignedAuthorization, tokenByAddress } from '@kova/monad'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { type Address, isAddressEqual } from 'viem'
import { z } from 'zod'
import { network } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { KovaError, notFound } from '../errors.js'
import { decodeId } from '../ids.js'
import { relayAuthorization } from '../relay.js'
import { type PaymentIntent, serializeIntent } from '../services/intents.js'
import { ordersForIntents } from '../services/orders.js'
import { tillCodeFor } from '../services/pockets.js'
import { confirmTransaction, settleFromReceipt } from '../services/settle.js'
import { stampsAt } from '../services/stamps.js'
import { tripForCheckout } from '../services/travel.js'

/**
 * The payer's side of a charge. No API key: anyone holding the charge's id (it is in the QR)
 * can read what to pay, hand Kova a signed authorization to submit, or report a transaction.
 * Nothing here can move money or change an intent except a payment Kova verifies on-chain.
 */

async function load(id: string): Promise<{ intent: PaymentIntent; merchantName: string }> {
  const uuid = decodeId('paymentIntent', id)
  if (!uuid) throw notFound('payment intent', id)
  const intent = await db.query.paymentIntents.findFirst({
    where: eq(schema.paymentIntents.id, uuid),
  })
  if (!intent) throw notFound('payment intent', id)
  const merchant = await db.query.merchants.findFirst({
    where: eq(schema.merchants.id, intent.merchantId),
  })
  return { intent, merchantName: merchant?.name ?? 'Merchant' }
}

function serializeCheckout(intent: PaymentIntent, merchantName: string) {
  const expired = intent.status === 'requires_payment' && intent.expiresAt.getTime() < Date.now()
  const {
    id,
    status,
    token,
    pay_to,
    memo,
    reference,
    network: networkId,
    currency,
  } = serializeIntent(intent)
  const tokenInfo = tokenByAddress(config.KOVA_NETWORK, intent.tokenAddress as Address)
  return {
    object: 'checkout',
    id,
    merchant_name: merchantName,
    amount: formatAmount(intent.amount),
    /** Base units (6 decimals), as a string so it survives JSON. */
    amount_base: intent.amount.toString(),
    currency,
    status: expired ? 'expired' : status,
    network: networkId,
    chain_id: network.chainId,
    token,
    /** What a wallet signs against: the token's EIP-712 name and version. */
    token_symbol: tokenInfo?.symbol ?? null,
    token_domain: tokenInfo?.domain ?? null,
    pay_to,
    memo,
    reference,
    expires_at: intent.expiresAt.toISOString(),
  }
}

/** The payment that settled a charge, for a payer who just paid it. */
async function paymentOf(intent: PaymentIntent) {
  const payment = await db.query.payments.findFirst({
    where: eq(schema.payments.intentId, intent.id),
  })
  return payment
    ? {
        payer: payment.payerAddress,
        tx_hash: payment.txHash,
        explorer_url: explorerTxUrl(network, payment.txHash as `0x${string}`),
      }
    : null
}

const confirmBody = z.object({ tx_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) })

export const checkoutRoutes = new Hono()
  .get('/:id', async (c) => {
    const { intent, merchantName } = await load(c.req.param('id'))
    const [orders, trip, ussdCode] = await Promise.all([
      ordersForIntents([intent.id]),
      tripForCheckout(intent.id),
      tillCodeFor(intent),
    ])
    const order = orders.get(intent.id)
    return c.json({
      ...serializeCheckout(intent, merchantName),
      ussd: ussdCode ? { code: ussdCode, dial: config.KOVA_USSD_CODE } : null,
      // What was ordered, when this charge came from a stall or a till sale.
      order: order
        ? {
            id: order.id,
            lines: order.lines,
            customer_name: order.customer_name,
            note: order.note,
            pay_for_me: order.pay_for_me,
            stall: order.stall,
            // Where it is at the counter, so the buyer's phone can say "ready" instead of a buzzer.
            status: order.status,
            table: order.table,
            reward: order.reward,
          }
        : null,
      // The flight or hotel, when this charge is a share of a Kova Travel trip.
      trip,
      // Who paid, once it's paid: public on Monad anyway, and how a receipt finds the payer's stamp card.
      payment: intent.status === 'paid' ? await paymentOf(intent) : null,
    })
  })
  /**
   * Pays a charge with a signed EIP-3009 authorization: the payer signs, Kova submits and pays
   * the gas. The authorization must be for exactly this charge (its memo as the nonce, its
   * amount, token and recipient), so a signature for one charge can never pay another.
   */
  .post('/:id/authorize', async (c) => {
    const signed = parseSignedAuthorization(await c.req.json().catch(() => null))
    if (!signed) throw new KovaError('invalid_request', 'Expected a signed transfer authorization.')
    const { authorization, signature } = signed
    const { intent, merchantName } = await load(c.req.param('id'))

    if (intent.status === 'paid') {
      // A retry after a dropped connection: the same payer gets the same answer.
      const payment = await paymentOf(intent)
      if (payment && isAddressEqual(payment.payer as Address, authorization.from))
        return c.json({ ...serializeCheckout(intent, merchantName), payment })
      throw new KovaError('conflict', 'This charge has already been paid.')
    }
    if (intent.status !== 'requires_payment')
      throw new KovaError('conflict', `This charge is ${intent.status}.`)
    if (intent.expiresAt.getTime() < Date.now())
      throw new KovaError('conflict', 'This charge has expired. Ask for a new code.')

    const token = tokenByAddress(config.KOVA_NETWORK, signed.token)
    if (!token || !isAddressEqual(token.address, intent.tokenAddress as Address))
      throw new KovaError('invalid_request', 'Pay in the dollar this charge asks for.')
    if (authorization.nonce !== intent.memo.toLowerCase())
      throw new KovaError('invalid_request', 'This approval is for a different charge.')
    if (!isAddressEqual(authorization.to, intent.payTo as Address))
      throw new KovaError('invalid_request', 'This approval pays someone else.')
    if (authorization.value !== intent.amount)
      throw new KovaError('invalid_request', 'This approval is for a different amount.')
    // A stamp-card reward is the card owner's alone, and a card pays for one reward.
    const rewardPayer =
      typeof intent.metadata?.payer === 'string' ? (intent.metadata.payer as Address) : null
    if (rewardPayer) {
      if (!isAddressEqual(rewardPayer, authorization.from))
        throw new KovaError('invalid_request', 'This free item is on someone else’s stamp card.')
      const order = await db.query.orders.findFirst({
        where: eq(schema.orders.intentId, intent.id),
      })
      const stall = order?.stallId
        ? await db.query.stalls.findFirst({ where: eq(schema.stalls.id, order.stallId) })
        : undefined
      if (
        order?.reward &&
        (await stampsAt(intent.merchantId, rewardPayer)) <
          (stall?.loyaltyEvery ?? order.reward.stamps)
      )
        throw new KovaError(
          'conflict',
          'This stamp card was already used. Order again for the full price.',
        )
    }

    const { receipt, ms } = await relayAuthorization(token, authorization, signature, {
      zero: intent.amount === 0n,
    })
    await settleFromReceipt(receipt)
    const settled = await load(c.req.param('id'))
    return c.json({
      ...serializeCheckout(settled.intent, settled.merchantName),
      payment: {
        payer: authorization.from,
        tx_hash: receipt.transactionHash,
        explorer_url: explorerTxUrl(network, receipt.transactionHash),
        ms: Math.round(ms),
      },
    })
  })
  .post('/:id/confirm', async (c) => {
    const parsed = confirmBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) throw new KovaError('invalid_request', 'Expected { tx_hash }')
    await confirmTransaction(parsed.data.tx_hash as `0x${string}`)
    const { intent, merchantName } = await load(c.req.param('id'))
    return c.json(serializeCheckout(intent, merchantName))
  })
