import { Hono } from 'hono'
import { type Address, getAddress, type Hex, isAddress } from 'viem'
import { z } from 'zod'
import { KovaError } from '../errors.js'
import { clientIp, limit } from '../limits.js'
import {
  attest,
  buy,
  quote,
  sell,
  stockAccess,
  TRADING_OFF,
  tradingLive,
} from '../services/stock-trades.js'

/**
 * Buying and selling xStocks through KovaStocks (services/stock-trades.ts, docs/stocks-trading.md).
 * The wallet proves itself by what it signs; where it is comes from its IP (the website vouches
 * for its visitors' with KOVA_PROXY_SECRET; the app calls directly). Off, every route answers
 * live: false.
 *
 *   GET  /wallets/:address/stocks/access  may this wallet trade from here, and the statement to sign
 *   POST /wallets/:address/stocks/attest  { message, signature }: the signed statement
 *   POST /wallets/:address/stocks/quote   { side, symbol, amount }: a 60-second quote
 *   POST /wallets/:address/stocks/buy     { quote_id, authorization, signature }
 *   POST /wallets/:address/stocks/sell    { quote_id, order_signature, permit }
 */

const signature = z.string().regex(/^0x[0-9a-fA-F]{130}$/)
const uint = (digits: number) => z.string().regex(new RegExp(`^\\d{1,${digits}}$`))

const attestBody = z.object({ message: z.string().min(1).max(1000), signature })
const quoteBody = z.object({
  side: z.enum(['buy', 'sell']),
  symbol: z.string().trim().min(1).max(20),
  amount: uint(40),
})
const buyBody = z.object({
  quote_id: z.string().min(1).max(64),
  authorization: z.object({
    value: uint(30),
    valid_after: uint(20),
    valid_before: uint(20),
    nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  }),
  signature,
})
const sellBody = z.object({
  quote_id: z.string().min(1).max(64),
  order_signature: signature,
  permit: z.object({ deadline: uint(20), signature }),
})

function walletAddress(c: { req: { param: (name: string) => string } }): Address {
  const address = c.req.param('address')
  if (!isAddress(address)) throw new KovaError('invalid_request', 'That isn’t a wallet address.')
  return getAddress(address)
}

async function body<T>(
  c: { req: { json: () => Promise<unknown> } },
  schema: z.ZodType<T>,
  expected: string,
): Promise<T> {
  const parsed = schema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) throw new KovaError('invalid_request', `Expected ${expected}.`)
  return parsed.data
}

const off = { live: false, error: { code: 'conflict', message: TRADING_OFF } } as const

/** Trades from one wallet, and from one place: a person makes a few, not hundreds. */
function limitTrades(wallet: Address, ip: string) {
  limit(
    `stock-trade:${wallet}`,
    30,
    3_600_000,
    'That’s a lot of trades in an hour. Try again later.',
  )
  limit(
    `stock-trade-ip:${ip}`,
    120,
    3_600_000,
    'That’s a lot of trades from here. Try again later.',
  )
}

export const stockTradeRoutes = new Hono()
  .get('/wallets/:address/stocks/access', async (c) => {
    const wallet = walletAddress(c)
    const ip = clientIp(c)
    limit(`stock-access:${ip}`, 120, 60_000, 'Too many requests. Try again shortly.')
    return c.json(await stockAccess(wallet, ip))
  })
  .post('/wallets/:address/stocks/attest', async (c) => {
    const wallet = walletAddress(c)
    if (!tradingLive()) return c.json(off, 409)
    const b = await body(c, attestBody, '{ message, signature }')
    const ip = clientIp(c)
    limit(`stock-attest:${wallet}`, 20, 3_600_000, 'That’s a lot of signing. Try again later.')
    return c.json(await attest(wallet, ip, b.message, b.signature as Hex))
  })
  .post('/wallets/:address/stocks/quote', async (c) => {
    const wallet = walletAddress(c)
    if (!tradingLive()) return c.json(off, 409)
    const b = await body(c, quoteBody, '{ side, symbol, amount }')
    const ip = clientIp(c)
    limit(`stock-quote:${wallet}`, 120, 3_600_000, 'That’s a lot of quotes. Try again later.')
    limit(
      `stock-quote-ip:${ip}`,
      600,
      3_600_000,
      'That’s a lot of quotes from here. Try again later.',
    )
    return c.json(
      await quote(wallet, ip, { side: b.side, symbol: b.symbol, amount: BigInt(b.amount) }),
    )
  })
  .post('/wallets/:address/stocks/buy', async (c) => {
    const wallet = walletAddress(c)
    if (!tradingLive()) return c.json(off, 409)
    const b = await body(
      c,
      buyBody,
      '{ quote_id, authorization: { value, valid_after, valid_before, nonce }, signature }',
    )
    const ip = clientIp(c)
    limitTrades(wallet, ip)
    return c.json(
      await buy(wallet, ip, {
        quoteId: b.quote_id,
        authorization: {
          value: BigInt(b.authorization.value),
          validAfter: BigInt(b.authorization.valid_after),
          validBefore: BigInt(b.authorization.valid_before),
          nonce: b.authorization.nonce as Hex,
        },
        signature: b.signature as Hex,
      }),
    )
  })
  .post('/wallets/:address/stocks/sell', async (c) => {
    const wallet = walletAddress(c)
    if (!tradingLive()) return c.json(off, 409)
    const b = await body(
      c,
      sellBody,
      '{ quote_id, order_signature, permit: { deadline, signature } }',
    )
    const ip = clientIp(c)
    limitTrades(wallet, ip)
    return c.json(
      await sell(wallet, ip, {
        quoteId: b.quote_id,
        orderSignature: b.order_signature as Hex,
        permit: { deadline: BigInt(b.permit.deadline), signature: b.permit.signature as Hex },
      }),
    )
  })
