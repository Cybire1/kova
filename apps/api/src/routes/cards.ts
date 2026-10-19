import { schema } from '@kova/db'
import { explorerTxUrl, formatAmount, parseAmount } from '@kova/monad'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { type Address, getAddress, type Hex, isAddress, isHex } from 'viem'
import { z } from 'zod'
import { requireApiKey } from '../auth.js'
import { network, settlementToken } from '../chain.js'
import { db } from '../db.js'
import { KovaError, notFound } from '../errors.js'
import { decodeId, encodeId } from '../ids.js'
import { clientIp as ip, limit } from '../limits.js'
import {
  cardContract,
  cardRow,
  cardsOf,
  cardsReady,
  changePin,
  completeTap,
  getTap,
  holderNonce,
  linkCard,
  MAX_DAILY_LIMIT,
  NO_PIN_LIMIT,
  permitState,
  prepareTap,
  requireCards,
  serializeCard,
  tapTypedData,
  unlinkCard,
  updateCard,
} from '../services/cards.js'

/**
 * Kova Cards.
 *
 * The holder's side is public, like every wallet route: a wallet proves itself by signing, and
 * the KovaCard contract checks each signature again.
 *   GET  /cards/config                   what the app needs to sign for a card
 *   GET  /wallets/:address/cards         a wallet's cards, with today's spending from the chain
 *   GET  /cards/:card                    whether a card someone just tapped is linked
 *   POST /cards/link                     link a card (wallet + card signatures, a permit, a PIN)
 *   POST /cards/:card/update             daily limit, freeze
 *   POST /cards/:card/unlink             for good
 *   POST /cards/:card/pin                a new PIN
 *
 * The till's side takes the shop's terminal key:
 *   POST /card_taps                      a card was read: check it can pay, return what it signs
 *   POST /card_taps/:id/complete         the card signed: PIN, cosign, pay, settle
 */

const hex = z.string().refine((v) => isHex(v), 'Expected hex')
const addr = z.string().refine((v) => isAddress(v), 'Expected an address')
const money = z.string().regex(/^\d{1,7}(\.\d{1,6})?$/, 'Expected dollars, like 50 or 12.50')

function cardParam(value: string): Address {
  if (!isAddress(value)) throw new KovaError('invalid_request', 'Not a card address.')
  return getAddress(value)
}

async function activeCard(value: string) {
  const row = await cardRow(cardParam(value))
  if (!row || row.status !== 'active') throw notFound('card', value)
  return row
}

const bodyOf = async <T extends z.ZodTypeAny>(
  c: { req: { json: () => Promise<unknown> } },
  shape: T,
): Promise<z.infer<T>> => {
  const parsed = shape.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success)
    throw new KovaError('invalid_request', 'Invalid request body', { issues: parsed.error.issues })
  return parsed.data
}

const linkBody = z.object({
  holder: addr,
  card: addr,
  daily_limit: money,
  deadline: z.coerce.number().int().positive(),
  holder_signature: hex,
  card_signature: hex,
  permit: z
    .object({
      value: z.string().regex(/^\d+$/),
      deadline: z.coerce.number().int().positive(),
      signature: hex,
    })
    .nullable(),
  pin: z.string(),
  label: z.string().max(40).optional(),
})

const updateBody = z.object({
  daily_limit: money,
  frozen: z.boolean(),
  deadline: z.coerce.number().int().positive(),
  holder_signature: hex,
})

export const cardRoutes = new Hono()
  .get('/cards/config', (c) =>
    c.json({
      object: 'card_config',
      ready: cardsReady(),
      contract: cardContract,
      chain_id: network.chainId,
      token: {
        address: settlementToken.address,
        symbol: settlementToken.symbol,
        domain: settlementToken.domain,
      },
      max_daily_limit: formatAmount(MAX_DAILY_LIMIT),
      no_pin_limit: formatAmount(NO_PIN_LIMIT),
    }),
  )
  .get('/wallets/:address/cards', async (c) => {
    requireCards()
    const holder = c.req.param('address')
    if (!isAddress(holder)) throw new KovaError('invalid_request', 'Not a Monad address.')
    const wallet = getAddress(holder)
    const [rows, nonce, permit] = await Promise.all([
      cardsOf(wallet),
      holderNonce(wallet),
      permitState(wallet),
    ])
    return c.json({
      object: 'list',
      // What the wallet's next card signature must carry, and where its allowance to cards stands.
      nonce: nonce.toString(),
      permit_nonce: permit.nonce.toString(),
      allowance: permit.allowance.toString(),
      data: await Promise.all(rows.map(serializeCard)),
    })
  })
  .get('/cards/:card', async (c) => {
    requireCards()
    const row = await cardRow(cardParam(c.req.param('card')))
    if (!row || row.status !== 'active') return c.json({ object: 'card_status', linked: false })
    return c.json({
      object: 'card_status',
      linked: true,
      holder: getAddress(row.holderAddress),
      last_four: row.lastFour,
    })
  })
  .post('/cards/link', async (c) => {
    const body = await bodyOf(c, linkBody)
    limit(
      `card-link:${body.holder.toLowerCase()}`,
      10,
      3_600_000,
      'That’s a lot of cards in an hour. Try again later.',
    )
    limit(
      `card-link-ip:${ip(c)}`,
      30,
      3_600_000,
      'That’s a lot of cards from here. Try again later.',
    )
    const row = await linkCard({
      holder: getAddress(body.holder),
      card: getAddress(body.card),
      dailyLimit: parseAmount(body.daily_limit),
      deadline: BigInt(body.deadline),
      holderSignature: body.holder_signature as Hex,
      cardSignature: body.card_signature as Hex,
      permit: body.permit
        ? {
            value: BigInt(body.permit.value),
            deadline: BigInt(body.permit.deadline),
            signature: body.permit.signature as Hex,
          }
        : null,
      pin: body.pin,
      label: body.label,
    })
    return c.json(await serializeCard(row), 201)
  })
  .post('/cards/:card/update', async (c) => {
    const row = await activeCard(c.req.param('card'))
    const body = await bodyOf(c, updateBody)
    limit(
      `card-update:${row.address}`,
      30,
      600_000,
      'That’s a lot of changes. Try again in a few minutes.',
    )
    const updated = await updateCard(row, {
      dailyLimit: parseAmount(body.daily_limit),
      frozen: body.frozen,
      deadline: BigInt(body.deadline),
      holderSignature: body.holder_signature as Hex,
    })
    return c.json(await serializeCard(updated))
  })
  .post('/cards/:card/unlink', async (c) => {
    const row = await activeCard(c.req.param('card'))
    const body = await bodyOf(
      c,
      z.object({ deadline: z.coerce.number().int().positive(), holder_signature: hex }),
    )
    await unlinkCard(row, {
      deadline: BigInt(body.deadline),
      holderSignature: body.holder_signature as Hex,
    })
    return c.json({ object: 'card', address: getAddress(row.address), unlinked: true })
  })
  .post('/cards/:card/pin', async (c) => {
    const row = await activeCard(c.req.param('card'))
    const body = await bodyOf(
      c,
      z.object({ pin: z.string(), signed_at: z.coerce.number().int(), signature: hex }),
    )
    limit(`card-pin:${row.address}`, 10, 3_600_000, 'That’s a lot of PIN changes. Try again later.')
    await changePin(row, {
      pin: body.pin,
      signedAt: body.signed_at,
      signature: body.signature as Hex,
    })
    return c.json({ object: 'card', address: getAddress(row.address), pin_changed: true })
  })

/** A typed-data payload as JSON: bigints as decimal strings, so a till can hand it to the card. */
function typedDataJson(typedData: ReturnType<typeof tapTypedData>) {
  return {
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: {
      ...typedData.message,
      amount: typedData.message.amount.toString(),
      deadline: typedData.message.deadline.toString(),
    },
  }
}

function tapUuid(id: string): string {
  const uuid = decodeId('cardTap', id)
  if (!uuid) throw notFound('card tap', id)
  return uuid
}

export const cardTapRoutes = new Hono()
  .use(requireApiKey)
  .post('/', async (c) => {
    const { contract } = requireCards()
    const body = await bodyOf(c, z.object({ payment_intent: z.string(), card: addr }))
    const intentId = decodeId('paymentIntent', body.payment_intent)
    if (!intentId) throw notFound('payment intent', body.payment_intent)
    const merchant = c.get('merchant')
    const intent = await db.query.paymentIntents.findFirst({
      where: and(
        eq(schema.paymentIntents.id, intentId),
        eq(schema.paymentIntents.merchantId, merchant.id),
      ),
    })
    if (!intent) throw notFound('payment intent', body.payment_intent)
    limit(
      `card-tap:${body.card.toLowerCase()}`,
      20,
      600_000,
      'That card has been tapped a lot. Try again shortly.',
    )
    const { tap } = await prepareTap({
      intent,
      card: getAddress(body.card),
      terminalId: c.get('apiKey').terminalId ?? null,
    })
    return c.json(
      {
        object: 'card_tap',
        id: encodeId('cardTap', tap.id),
        card: getAddress(tap.cardAddress),
        amount: formatAmount(tap.amount),
        pin_required: tap.pinRequired,
        expires_at: tap.deadline,
        typed_data: typedDataJson(tapTypedData(contract, tap)),
      },
      201,
    )
  })
  .post('/:id/complete', async (c) => {
    const tap = await getTap(tapUuid(c.req.param('id')))
    if (!tap) throw notFound('card tap', c.req.param('id'))
    // Only the shop whose charge it is can finish the tap.
    const intent = await db.query.paymentIntents.findFirst({
      where: eq(schema.paymentIntents.id, tap.intentId),
    })
    if (!intent || intent.merchantId !== c.get('merchant').id)
      throw notFound('card tap', c.req.param('id'))
    const body = await bodyOf(
      c,
      z.object({ card_signature: hex, pin: z.string().max(6).optional() }),
    )
    const done = await completeTap(tap, {
      cardSignature: body.card_signature as Hex,
      pin: body.pin,
    })
    return c.json({
      object: 'card_tap',
      id: encodeId('cardTap', done.tap.id),
      status: 'paid',
      amount: formatAmount(done.tap.amount),
      payment: {
        id: done.paymentId ? encodeId('payment', done.paymentId) : null,
        tx_hash: done.receipt.transactionHash,
        explorer_url: explorerTxUrl(network, done.receipt.transactionHash),
      },
    })
  })
