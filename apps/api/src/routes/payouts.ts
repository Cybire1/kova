import { formatAmount, parseAmount, parseSignedAuthorization } from '@kova/monad'
import { Hono } from 'hono'
import { type Address, getAddress, isAddress } from 'viem'
import { z } from 'zod'
import { config } from '../config.js'
import { KovaError, notFound } from '../errors.js'
import { clientIp, limit } from '../limits.js'
import { requireWalletSignature } from '../services/money.js'
import { publicCorridors } from '../services/payout-corridors.js'
import {
  addRecipient,
  MAX_PAYOUT,
  MIN_PAYOUT,
  payoutBanks,
  payoutRate,
  payoutReadiness,
  payoutRow,
  payoutsLive,
  payoutsOf,
  payoutWithRecipient,
  payPayout,
  quotePayout,
  recipientsOf,
  removeRecipient,
  serializePayout,
  serializeRecipient,
} from '../services/payouts.js'
import { refuseSanctioned } from '../services/sanctions.js'

/**
 * Cash-outs through Nuvion, to banks, mobile money and wallets in 20+ countries.
 *
 *   GET    /payouts                                    on or off, the limits, Kova's fee, every rail
 *   GET    /payouts/banks/:country                     a country's banks, for the picker
 *   GET    /payouts/rates/:currency                    what $1 comes to now (live, for the amount screen)
 *   GET    /wallets/:address/payout-recipients         where this wallet cashes out to
 *   POST   /wallets/:address/payout-recipients         save one (signed): the details go to Nuvion
 *   DELETE /wallets/:address/payout-recipients/:id     forget one (signed)
 *   POST   /wallets/:address/payouts                   a quote: the rate locked for a few minutes
 *   POST   /payouts/:id/pay                            the wallet's signed transfer: relay it, pay out
 *   GET    /payouts/:id                                one cash-out
 *   GET    /wallets/:address/payouts                   a wallet's cash-outs
 *
 * Nothing moves a wallet's money without its signature: a payout is paid only by the EIP-3009
 * transfer the wallet signs for exactly that quote.
 */

function walletAddress(c: { req: { param: (name: string) => string } }): Address {
  const address = c.req.param('address')
  if (!isAddress(address)) throw new KovaError('invalid_request', 'That isn’t a wallet address.')
  return getAddress(address)
}

const signed = { signed_at: z.number().int(), signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }
const recipientBody = z.object({
  corridor: z.string().min(2).max(40),
  fields: z.record(z.string(), z.string().max(200)),
  ...signed,
})
const quoteBody = z.object({
  recipient_id: z.string().uuid(),
  amount: z.string().regex(/^\d{1,7}(\.\d{1,2})?$/, 'Expected dollars, like 50 or 12.50'),
})

async function body<T>(
  c: { req: { json: () => Promise<unknown> } },
  shape: z.ZodType<T>,
  expected: string,
): Promise<T> {
  const parsed = shape.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) throw new KovaError('invalid_request', `Expected ${expected}.`)
  return parsed.data
}

function needLive() {
  if (!payoutsLive())
    throw new KovaError('conflict', 'Cashing out isn’t switched on for this server yet.')
}

export const payoutRoutes = new Hono()
  .get('/payouts', (c) =>
    c.json({
      object: 'payouts',
      live: payoutsLive(),
      min: formatAmount(MIN_PAYOUT),
      max: formatAmount(MAX_PAYOUT),
      fee_bps: config.KOVA_PAYOUT_FEE_BPS,
      corridors: publicCorridors(),
    }),
  )
  .get('/payouts/banks/:country', async (c) => {
    const country = c.req.param('country')
    if (!/^[A-Za-z]{2}$/.test(country))
      throw new KovaError('invalid_request', 'Expected a country.')
    const list = await payoutBanks(country)
    return c.json({
      data: list.map((b) => ({
        name: b.bank_name,
        code: b.bank_code ?? b.bank_institution_number ?? b.swift_bic ?? '',
        bank_code: b.bank_code ?? null,
        institution: b.bank_institution_number ?? null,
        swift_bic: b.swift_bic ?? null,
      })),
    })
  })
  .get('/payouts/rates/:currency', async (c) => {
    const currency = c.req.param('currency').toUpperCase()
    if (!/^[A-Z]{3,4}$/.test(currency))
      throw new KovaError('invalid_request', 'Expected a currency.')
    limit(
      `payout-rate:${clientIp(c)}`,
      120,
      60_000,
      'That’s a lot of rates. Try again in a minute.',
    )
    return c.json({ object: 'payout_rate', currency, per_dollar: await payoutRate(currency) })
  })
  .get('/wallets/:address/payout-recipients', async (c) => {
    const wallet = walletAddress(c)
    const [list, ready] = await Promise.all([recipientsOf(wallet), payoutReadiness(wallet)])
    // In the person's own name, accounts saved under Kova's own entity before can't be paid now.
    const usable = ready.verification_required ? list.filter((r) => r.entityId) : list
    return c.json({ data: usable.map(serializeRecipient), ...ready })
  })
  .post('/wallets/:address/payout-recipients', async (c) => {
    needLive()
    refuseSanctioned(clientIp(c), 'Cashing out abroad')
    const wallet = walletAddress(c)
    const b = await body(c, recipientBody, '{ corridor, fields, signed_at, signature }')
    await requireWalletSignature(wallet, 'payout-recipient', b.signed_at, b.signature, b.corridor)
    limit(
      `payout-recipient:${wallet.toLowerCase()}`,
      15,
      3_600_000,
      'That’s a lot of new accounts in an hour. Try again later.',
    )
    return c.json(serializeRecipient(await addRecipient(wallet, b.corridor, b.fields)))
  })
  .delete('/wallets/:address/payout-recipients/:id', async (c) => {
    const wallet = walletAddress(c)
    const b = await body(c, z.object(signed), '{ signed_at, signature }')
    await requireWalletSignature(
      wallet,
      'payout-recipient-remove',
      b.signed_at,
      b.signature,
      c.req.param('id'),
    )
    await removeRecipient(wallet, c.req.param('id'))
    return c.json({ deleted: true })
  })
  .post('/wallets/:address/payouts', async (c) => {
    needLive()
    refuseSanctioned(clientIp(c), 'Cashing out abroad')
    const wallet = walletAddress(c)
    const b = await body(c, quoteBody, '{ recipient_id, amount }')
    limit(
      `payout-quote:${wallet.toLowerCase()}`,
      60,
      3_600_000,
      'That’s a lot of quotes in an hour. Try again later.',
    )
    const { row, recipient } = await quotePayout(wallet, b.recipient_id, parseAmount(b.amount))
    return c.json(serializePayout(row, recipient))
  })
  .post('/payouts/:id/pay', async (c) => {
    needLive()
    refuseSanctioned(clientIp(c), 'Cashing out abroad')
    const row = await payoutRow(c.req.param('id'))
    if (!row) throw notFound('cash out', c.req.param('id'))
    const signedTransfer = parseSignedAuthorization(await c.req.json().catch(() => null))
    if (!signedTransfer)
      throw new KovaError('invalid_request', 'Expected the signed transfer for this cash-out.')
    limit(
      `payout-pay:${row.wallet}`,
      20,
      3_600_000,
      'That’s a lot of cash-outs in an hour. Try again later.',
    )
    return c.json(await payoutWithRecipient(await payPayout(row, signedTransfer)))
  })
  .get('/payouts/:id', async (c) => {
    const row = await payoutRow(c.req.param('id'))
    if (!row) throw notFound('cash out', c.req.param('id'))
    return c.json(await payoutWithRecipient(row))
  })
  .get('/wallets/:address/payouts', async (c) => {
    const rows = await payoutsOf(walletAddress(c))
    return c.json({ data: await Promise.all(rows.map(payoutWithRecipient)) })
  })
