import { formatAmount, parseAmount, parseSignedAuthorization } from '@kova/monad'
import { Hono } from 'hono'
import { type Address, getAddress, isAddress } from 'viem'
import { z } from 'zod'
import { KovaError, notFound } from '../errors.js'
import { clientIp as ip, limit } from '../limits.js'
import {
  cashOutRow,
  cashOutsOf,
  cashOutTransferEvent,
  createCashOut,
  formatNaira,
  MAX_CASH_OUT,
  MAX_TOP_UP,
  MIN_CASH_OUT,
  MIN_TOP_UP,
  nairaBanks,
  nairaPartner,
  nairaReady,
  nairaTestMode,
  nameOnAccount,
  pajOrderEvent,
  payCashOut,
  quoteCashOut,
  quoteCashOutForNaira,
  quoteTopUp,
  refreshPajCashOut,
  serializeCashOut,
  serializeTopUp,
  settleTopUp,
  startTopUp,
  topUpRow,
  topUpsOf,
} from '../services/naira.js'
import { webhookIsPaj } from '../services/paj.js'
import { webhookIsPaystack } from '../services/paystack.js'

/**
 * Naira in and out, through PAJ or Paystack (services/naira.ts):
 *
 *   GET  /naira                                   whether it's on, the rates, the limits
 *   GET  /naira/banks                             Nigerian banks the partner can pay
 *   POST /naira/account                           the name on an account number at a bank
 *   GET  /naira/quote?amount=&direction=in|out    what an amount comes to in naira
 *   GET  /naira/quote?naira=&direction=out        the dollars a cash-out takes to pay that much naira
 *   POST /wallets/:address/cash-outs              a quote for dollars out to a bank
 *   POST /cash-outs/:id/pay                       the wallet's signed transfer: relay it, pay the naira
 *   GET  /cash-outs/:id                           one cash-out
 *   GET  /wallets/:address/cash-outs              a wallet's cash-outs
 *   POST /wallets/:address/naira-top-ups          add money in naira: where to send the payer
 *   POST /naira-top-ups/:reference/verify         the payer came back: check the payment
 *   GET  /naira-top-ups/:reference                one top-up
 *   GET  /wallets/:address/naira-top-ups          a wallet's top-ups
 *   POST /paystack/webhook                        Paystack's word, signed
 *   POST /paj/webhook                             PAJ's prompt to read an order again
 *
 * Nothing here moves a wallet's money without its own signature: a cash-out is paid only by the
 * EIP-3009 transfer the wallet signs, and a top-up only ever sends dollars to the wallet.
 */

const money = z.string().regex(/^\d{1,7}(\.\d{1,6})?$/, 'Expected dollars, like 50 or 12.50')

const bodyOf = async <T extends z.ZodTypeAny>(
  c: { req: { json: () => Promise<unknown> } },
  shape: T,
): Promise<z.infer<T>> => {
  const parsed = shape.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success)
    throw new KovaError('invalid_request', 'Invalid request body', { issues: parsed.error.issues })
  return parsed.data
}

function needNaira() {
  if (!nairaReady()) throw new KovaError('conflict', 'Naira isn’t switched on for this server yet.')
}

function walletOf(raw: string): Address {
  if (!isAddress(raw, { strict: false }))
    throw new KovaError('invalid_request', 'Expected a wallet address.')
  return getAddress(raw)
}

export const nairaRoutes = new Hono()

nairaRoutes.get('/naira', async (c) => {
  if (!nairaReady()) return c.json({ object: 'naira', enabled: false })
  const [out, inn] = await Promise.all([quoteCashOut(100_000_000n), quoteTopUp(100_000_000n)])
  return c.json({
    object: 'naira',
    enabled: true,
    partner: nairaPartner(),
    test_mode: nairaTestMode(),
    rate_source: out.source,
    market_rate: out.market.toFixed(2),
    cash_out_rate: out.rate.toFixed(2),
    top_up_rate: inn.rate.toFixed(2),
    min_cash_out: formatAmount(MIN_CASH_OUT),
    max_cash_out: formatAmount(MAX_CASH_OUT),
    min_top_up: formatAmount(MIN_TOP_UP),
    max_top_up: formatAmount(MAX_TOP_UP),
  })
})

nairaRoutes.get('/naira/banks', async (c) => {
  needNaira()
  return c.json({ object: 'list', data: await nairaBanks() })
})

nairaRoutes.post('/naira/account', async (c) => {
  needNaira()
  limit(`naira-account:${ip(c)}`, 30, 60_000, 'Too many look-ups. Wait a minute.')
  const body = await bodyOf(
    c,
    z.object({
      account_number: z.string().regex(/^\d{10}$/),
      bank_code: z.string().min(2).max(10),
    }),
  )
  return c.json({ account_name: await nameOnAccount(body.account_number, body.bank_code) })
})

nairaRoutes.get('/naira/quote', async (c) => {
  needNaira()
  // A cash-out can be asked for by what the bank account should get: ?naira=50000&direction=out.
  const naira = c.req.query('naira')
  if (naira !== undefined && c.req.query('direction') !== 'in') {
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(naira))
      throw new KovaError('invalid_request', 'Give an amount in naira.')
    const [whole = '0', kobo = ''] = naira.split('.')
    const quote = await quoteCashOutForNaira(BigInt(whole) * 100n + BigInt(kobo.padEnd(2, '0')))
    return c.json({
      direction: 'out',
      amount: formatAmount(quote.units),
      naira: formatNaira(quote.naira),
      naira_kobo: quote.naira.toString(),
      rate: quote.rate.toFixed(2),
      fee: formatNaira(quote.fee),
      rate_source: quote.source,
    })
  }
  const amount = c.req.query('amount') ?? ''
  if (!/^\d{1,7}(\.\d{1,6})?$/.test(amount))
    throw new KovaError('invalid_request', 'Give an amount in dollars.')
  if (c.req.query('direction') === 'in') {
    const quote = await quoteTopUp(parseAmount(amount))
    return c.json({
      direction: 'in',
      amount: formatAmount(parseAmount(amount)),
      naira: formatNaira(quote.naira),
      naira_kobo: quote.naira.toString(),
      rate: quote.rate.toFixed(2),
      fee: formatNaira(quote.fee),
      rate_source: quote.source,
    })
  }
  const quote = await quoteCashOut(parseAmount(amount))
  return c.json({
    direction: 'out',
    amount: formatAmount(parseAmount(amount)),
    naira: formatNaira(quote.naira),
    naira_kobo: quote.naira.toString(),
    rate: quote.rate.toFixed(2),
    fee: formatNaira(quote.fee),
    rate_source: quote.source,
  })
})

// ── Cash out ────────────────────────────────────────────────────────────────────────────────

nairaRoutes.post('/wallets/:address/cash-outs', async (c) => {
  needNaira()
  const wallet = walletOf(c.req.param('address'))
  limit(`cash-out:${wallet}`, 20, 60 * 60_000, 'That’s a lot of cash-outs. Try again later.')
  limit(`cash-out-ip:${ip(c)}`, 40, 60 * 60_000, 'That’s a lot of cash-outs. Try again later.')
  const body = await bodyOf(
    c,
    z.object({
      amount: money,
      bank_code: z.string().min(2).max(10),
      account_number: z.string().regex(/^\d{10}$/),
    }),
  )
  const row = await createCashOut(wallet, {
    amount: parseAmount(body.amount),
    bankCode: body.bank_code,
    accountNumber: body.account_number,
  })
  return c.json(serializeCashOut(row), 201)
})

nairaRoutes.post('/cash-outs/:id/pay', async (c) => {
  needNaira()
  const row = await cashOutRow(c.req.param('id'))
  if (!row) throw notFound('cash out', c.req.param('id'))
  const signed = parseSignedAuthorization(await c.req.json().catch(() => null))
  if (!signed)
    throw new KovaError('invalid_request', 'Expected the signed transfer for this cash-out.')
  return c.json(serializeCashOut(await payCashOut(row, signed)))
})

/** When a PAJ cash-out last asked PAJ, so a screen following it asks at most every few seconds. */
const askedPaj = new Map<string, number>()

nairaRoutes.get('/cash-outs/:id', async (c) => {
  let row = await cashOutRow(c.req.param('id'))
  if (!row) throw notFound('cash out', c.req.param('id'))
  if (
    row.partner === 'paj' &&
    row.status === 'paying' &&
    (askedPaj.get(row.id) ?? 0) < Date.now() - 4_000
  ) {
    askedPaj.set(row.id, Date.now())
    row = await refreshPajCashOut(row)
  }
  return c.json(serializeCashOut(row))
})

nairaRoutes.get('/wallets/:address/cash-outs', async (c) => {
  const wallet = walletOf(c.req.param('address'))
  // The list never carries the account holder's name: only the bank and the last four digits.
  const data = (await cashOutsOf(wallet))
    .map(serializeCashOut)
    .map(({ account_name: _, ...rest }) => rest)
  return c.json({ object: 'list', data })
})

// ── Add money in naira ──────────────────────────────────────────────────────────────────────

nairaRoutes.post('/wallets/:address/naira-top-ups', async (c) => {
  needNaira()
  const wallet = walletOf(c.req.param('address'))
  limit(`naira-top-up:${ip(c)}`, 20, 60_000, 'Too many tries. Wait a minute.')
  const body = await bodyOf(
    c,
    z.object({
      amount: money,
      // Paystack's receipt goes to it; PAJ needs none.
      email: z.string().email().max(200).optional(),
      return_url: z
        .string()
        .url()
        .max(500)
        .refine((u) => /^https?:\/\//.test(u), 'Expected a web address'),
    }),
  )
  const started = await startTopUp(wallet, {
    amount: parseAmount(body.amount),
    email: body.email,
    callbackUrl: body.return_url,
  })
  return c.json(
    { url: started.url, ...serializeTopUp(started.row), fee: formatNaira(started.quote.fee) },
    201,
  )
})

nairaRoutes.post('/naira-top-ups/:reference/verify', async (c) => {
  needNaira()
  limit(`naira-verify:${ip(c)}`, 60, 60_000, 'Too many tries. Wait a minute.')
  const row = await topUpRow(c.req.param('reference'))
  if (!row) throw notFound('naira top-up', c.req.param('reference'))
  return c.json(serializeTopUp(await settleTopUp(row.reference)))
})

nairaRoutes.get('/naira-top-ups/:reference', async (c) => {
  const row = await topUpRow(c.req.param('reference'))
  if (!row) throw notFound('naira top-up', c.req.param('reference'))
  return c.json(serializeTopUp(row))
})

nairaRoutes.get('/wallets/:address/naira-top-ups', async (c) => {
  const wallet = walletOf(c.req.param('address'))
  // The list never carries the account a payment was made to: only each payment's own page does.
  const data = (await topUpsOf(wallet))
    .map(serializeTopUp)
    .map(({ bank_transfer: _, ...rest }) => rest)
  return c.json({ object: 'list', data })
})

// ── Paystack's webhook ──────────────────────────────────────────────────────────────────────

nairaRoutes.post('/paystack/webhook', async (c) => {
  const raw = await c.req.text()
  if (!webhookIsPaystack(raw, c.req.header('x-paystack-signature')))
    return c.json({ ok: false }, 401)
  const event = JSON.parse(raw) as { event?: string; data?: { reference?: string } }
  const reference = event.data?.reference
  if (reference) {
    if (event.event === 'charge.success' && reference.startsWith('kova_'))
      void settleTopUp(reference).catch(() => {})
    if (event.event?.startsWith('transfer.'))
      void cashOutTransferEvent(reference, event.event).catch(() => {})
  }
  return c.json({ ok: true })
})

// ── PAJ's webhook ───────────────────────────────────────────────────────────────────────────

nairaRoutes.post('/paj/webhook', async (c) => {
  const raw = await c.req.text()
  if (webhookIsPaj(raw, c.req.header('x-paj-timestamp'), c.req.header('x-paj-signature')) === false)
    return c.json({ ok: false }, 401)
  // Signed or not, a delivery only prompts a read: the order's state comes from PAJ's own API.
  let id: unknown
  try {
    id = (JSON.parse(raw) as { id?: unknown }).id
  } catch {
    return c.json({ ok: false }, 400)
  }
  if (typeof id === 'string' && /^[0-9a-f]{24}$/i.test(id)) void pajOrderEvent(id).catch(() => {})
  return c.json({ ok: true })
})
