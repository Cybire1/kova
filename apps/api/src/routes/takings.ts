import { schema } from '@kova/db'
import {
  eip3009Abi,
  explorerTxUrl,
  formatAmount,
  parseSignedAuthorization,
  parseStealthMetaAddress,
  STEALTH_SCHEME_ID,
  tokenByAddress,
} from '@kova/monad'
import { and, asc, desc, eq, gt, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { type Address, getAddress, isAddressEqual } from 'viem'
import { z } from 'zod'
import { requireApiKey, requireMerchantKey } from '../auth.js'
import { network, publicClient, settlementToken } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { KovaError } from '../errors.js'
import { decodeId, encodeId } from '../ids.js'
import { relayAuthorization } from '../relay.js'

/**
 * Private takings. A shop turns them on by publishing a stealth meta-address (ERC-5564 scheme 1,
 * made on the shop's own device from its wallet); from then on every charge it creates is paid to a
 * fresh one-time address (services/intents.ts). Kova keeps an announcement per sale, publishes them
 * without the shop's name, and relays the shop's moves from those addresses to its wallet. Kova
 * never has a private key that can move the dollars.
 */

const MAX_VALIDITY = 3600n

/** Paid sales at one-time addresses, with what's needed to find and open each. */
async function receipts(where: ReturnType<typeof and>, order: 'asc' | 'desc', limit: number) {
  const rows = await db
    .select({
      sale: schema.stealthPayments,
      intent: schema.paymentIntents,
      payment: schema.payments,
    })
    .from(schema.stealthPayments)
    .innerJoin(schema.paymentIntents, eq(schema.paymentIntents.id, schema.stealthPayments.intentId))
    .innerJoin(
      schema.payments,
      and(
        eq(schema.payments.intentId, schema.paymentIntents.id),
        eq(schema.payments.status, 'paid'),
      ),
    )
    .where(
      and(
        where,
        eq(schema.paymentIntents.status, 'paid'),
        eq(schema.stealthPayments.network, config.KOVA_NETWORK),
      ),
    )
    .orderBy(order === 'asc' ? asc(schema.stealthPayments.id) : desc(schema.stealthPayments.id))
    .limit(limit)
  return rows.map(({ sale, intent, payment }) => ({
    id: encodeId('stealthPayment', sale.id),
    scheme_id: STEALTH_SCHEME_ID,
    stealth_address: getAddress(sale.stealthAddress),
    ephemeral_public_key: sale.ephemeralPublicKey,
    view_tag: sale.viewTag,
    amount: formatAmount(intent.amount),
    currency: intent.currency,
    token: intent.tokenAddress,
    tx_hash: payment.txHash,
    explorer_url: explorerTxUrl(network, payment.txHash as `0x${string}`),
    paid_at: intent.paidAt?.toISOString() ?? null,
    /** Who paid: public on Monad anyway. */
    from: payment.payerAddress ? getAddress(payment.payerAddress) : null,
    sealed: null as string | null,
    ...announced(sale.announceTx),
    payment_intent: encodeId('paymentIntent', intent.id),
    swept_tx: sale.sweptTx,
    swept_at: sale.sweptAt?.toISOString() ?? null,
  }))
}

/** The ERC-5564 Announcement Kova posted on Monad for a payment, once it has. */
function announced(tx: string | null) {
  return { announce_tx: tx, announce_url: tx ? explorerTxUrl(network, tx as `0x${string}`) : null }
}

const sweepBody = z.object({ authorizations: z.array(z.unknown()).min(1).max(50) })

export const takingsRoutes = new Hono()
  /** Whether private takings are on, and every sale they've received. */
  .get('/private_takings', requireApiKey, async (c) => {
    const merchant = c.get('merchant')
    const data = await receipts(
      and(eq(schema.stealthPayments.merchantId, merchant.id)),
      'desc',
      500,
    )
    return c.json({
      object: 'private_takings',
      enabled: Boolean(merchant.stealthMetaAddress),
      meta_address: merchant.stealthMetaAddress,
      receipts: data.map(({ id: _id, ...r }) => r),
    })
  })

  /** Turns private takings on: new charges pay one-time addresses derived from this meta-address. */
  .put('/private_takings', requireApiKey, requireMerchantKey, async (c) => {
    const parsed = z
      .object({ meta_address: z.string() })
      .safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) throw new KovaError('invalid_request', 'Expected { meta_address }')
    try {
      parseStealthMetaAddress(parsed.data.meta_address)
    } catch {
      throw new KovaError('invalid_request', 'That isn’t a stealth meta-address (st:eth:0x…).')
    }
    await db
      .update(schema.merchants)
      .set({ stealthMetaAddress: parsed.data.meta_address, updatedAt: new Date() })
      .where(eq(schema.merchants.id, c.get('merchant').id))
    return c.json({
      object: 'private_takings',
      enabled: true,
      meta_address: parsed.data.meta_address,
    })
  })

  /** Turns them off for new charges. Sales already at one-time addresses stay the shop's to move. */
  .delete('/private_takings', requireApiKey, requireMerchantKey, async (c) => {
    await db
      .update(schema.merchants)
      .set({ stealthMetaAddress: null, updatedAt: new Date() })
      .where(eq(schema.merchants.id, c.get('merchant').id))
    return c.json({ object: 'private_takings', enabled: false, meta_address: null })
  })

  /**
   * Moves sales from their one-time addresses to the shop's wallet: each a transfer authorization
   * signed with that address's own key, for everything it holds. Kova submits them and pays the gas.
   */
  .post('/private_takings/sweep', requireApiKey, async (c) => {
    const parsed = sweepBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success)
      throw new KovaError('invalid_request', 'Expected { authorizations: [...] }, at most 50')
    const merchant = c.get('merchant')
    const signed = parsed.data.authorizations.map((a) => {
      const s = parseSignedAuthorization(a)
      if (!s) throw new KovaError('invalid_request', 'Expected signed transfer authorizations.')
      const token = tokenByAddress(config.KOVA_NETWORK, s.token)
      if (!token || !isAddressEqual(token.address, settlementToken.address))
        throw new KovaError('invalid_request', 'Move the dollar the sales were paid in.')
      const now = BigInt(Math.floor(Date.now() / 1000))
      if (s.authorization.validBefore > now + MAX_VALIDITY)
        throw new KovaError('invalid_request', 'An approval to move can last an hour at most.')
      return { ...s, token }
    })
    const froms = signed.map((s) => s.authorization.from.toLowerCase())
    const owned = await db.query.stealthPayments.findMany({
      where: and(
        eq(schema.stealthPayments.merchantId, merchant.id),
        inArray(schema.stealthPayments.stealthAddress, froms),
      ),
    })
    const byAddress = new Map(owned.map((o) => [o.stealthAddress, o]))
    const results = []
    for (const s of signed) {
      const sale = byAddress.get(s.authorization.from.toLowerCase())
      if (!sale) {
        results.push({ from: s.authorization.from, error: 'Not one of this shop’s private sales.' })
        continue
      }
      const held = await publicClient.readContract({
        address: s.token.address,
        abi: eip3009Abi,
        functionName: 'balanceOf',
        args: [s.authorization.from],
      })
      if (held === 0n || s.authorization.value !== held) {
        results.push({
          from: s.authorization.from,
          error: held === 0n ? 'Already moved.' : 'Move everything the address holds.',
        })
        continue
      }
      try {
        const { receipt, ms } = await relayAuthorization(s.token, s.authorization, s.signature)
        await db
          .update(schema.stealthPayments)
          .set({ sweptTx: receipt.transactionHash, sweptAt: new Date() })
          .where(eq(schema.stealthPayments.id, sale.id))
        results.push({
          from: s.authorization.from,
          to: s.authorization.to as Address,
          amount: formatAmount(held),
          tx_hash: receipt.transactionHash,
          explorer_url: explorerTxUrl(network, receipt.transactionHash),
          ms: Math.round(ms),
        })
      } catch (error) {
        results.push({
          from: s.authorization.from,
          error: error instanceof Error ? error.message : 'Could not move it.',
        })
      }
    }
    return c.json({ object: 'list', data: results })
  })

  /**
   * Public: every private payment's announcement, naming no recipient, as ERC-5564's Announcement
   * events do (Kova also posts each one to the announcer on Monad: `announce_tx`). Only the holder of
   * a viewing key can tell which are its own (checkStealthAddress), and open a sender's sealed memo.
   */
  .get('/public/stealth/announcements', async (c) => {
    // One feed for every private payment on this network: shops' sales and people's private
    // sends, in the order they happened (both tables use time-ordered ids). The cursor is the last
    // item's id, of either kind.
    const afterId = c.req.query('after')
    const after = afterId
      ? (decodeId('stealthPayment', afterId) ?? decodeId('stealthAnnouncement', afterId))
      : undefined
    if (afterId && !after) throw new KovaError('invalid_request', 'Unknown cursor')
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 500) || 500, 1), 1000)
    const sales = await receipts(
      and(after ? gt(schema.stealthPayments.id, after) : undefined),
      'asc',
      limit,
    )
    const sends = await db
      .select()
      .from(schema.stealthAnnouncements)
      .where(
        and(
          eq(schema.stealthAnnouncements.network, config.KOVA_NETWORK),
          after ? gt(schema.stealthAnnouncements.id, after) : undefined,
        ),
      )
      .orderBy(asc(schema.stealthAnnouncements.id))
      .limit(limit)
    const items = [
      ...sales.map(({ payment_intent: _pi, swept_tx: _s, swept_at: _sa, ...r }) => ({
        ...r,
        uuid: decodeId('stealthPayment', r.id) ?? '',
      })),
      ...sends.map((a) => ({
        id: encodeId('stealthAnnouncement', a.id),
        uuid: a.id,
        scheme_id: STEALTH_SCHEME_ID,
        stealth_address: getAddress(a.stealthAddress),
        ephemeral_public_key: a.ephemeralPublicKey,
        view_tag: a.viewTag,
        amount: formatAmount(a.amount),
        currency: settlementToken.symbol,
        token: a.tokenAddress,
        tx_hash: a.txHash,
        explorer_url: explorerTxUrl(network, a.txHash as `0x${string}`),
        paid_at: a.createdAt.toISOString(),
        /** Who sent it: public on Monad anyway (a one-time address, when it came from private dollars). */
        from: getAddress(a.fromAddress),
        /** Their memo, sealed: only the recipient's viewing key opens it (openStealthMemo). */
        sealed: a.sealed,
        ...announced(a.announceTx),
      })),
    ]
      .sort((x, y) => (x.uuid < y.uuid ? -1 : x.uuid > y.uuid ? 1 : 0))
      .slice(0, limit)
    return c.json({
      object: 'list',
      scheme_id: STEALTH_SCHEME_ID,
      data: items.map(({ uuid: _u, ...r }) => r),
      next: items.length === limit ? items[items.length - 1]?.id : null,
    })
  })
