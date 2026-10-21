import { schema, uuidv7 } from '@kova/db'
import { isChartRange } from '@kova/monad'
import { eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getAddress, isAddress } from 'viem'
import { z } from 'zod'
import { db } from '../db.js'
import { KovaError } from '../errors.js'
import { clientIp, limit } from '../limits.js'
import {
  findStock,
  holdingsOf,
  popularStocks,
  searchStocks,
  stockChart,
  stockQuote,
} from '../services/stocks.js'

/**
 * Stocks: xStocks on Monad (services/stocks.ts). Public, and cached: prices are xStocks', charts
 * CoinGecko's, holdings Monad mainnet's.
 *
 *   GET  /stocks?q=                      popular stocks, or up to 20 matching q
 *   GET  /stocks/:symbol                 one stock, priced
 *   GET  /stocks/:symbol/chart?range=    its price history: 1D, 1W, 1M or 1Y
 *   GET  /wallets/:address/stocks        what a wallet owns, biggest first
 *   GET  /wallets/:address/stock-alerts  the stocks it asked to be told about
 *   POST /wallets/:address/stock-alerts  { symbol }: tell this wallet when it can buy symbol
 */

const unreachable = () =>
  new KovaError('chain_error', 'Stock prices are unreachable right now. Try again in a moment.')

const wallet = (value: string) => {
  if (!isAddress(value)) throw new KovaError('invalid_request', 'That isn’t a wallet address.')
  return getAddress(value)
}

const alertBody = z.object({ symbol: z.string().trim().min(1).max(20) })

export const stockRoutes = new Hono()
  .get('/stocks', async (c) => {
    const q = c.req.query('q')?.slice(0, 40) ?? ''
    const data = await (q ? searchStocks(q) : popularStocks()).catch(() => {
      throw unreachable()
    })
    c.header('cache-control', 'public, max-age=30')
    return c.json({ object: 'list', source: 'xstocks', data })
  })
  .get('/stocks/:symbol', async (c) => {
    const listing = await findStock(c.req.param('symbol')).catch(() => {
      throw unreachable()
    })
    if (!listing) throw new KovaError('not_found', 'Kova doesn’t have that stock.')
    c.header('cache-control', 'public, max-age=30')
    return c.json({ object: 'stock', source: 'xstocks', ...(await stockQuote(listing)) })
  })
  .get('/stocks/:symbol/chart', async (c) => {
    const range = c.req.query('range') ?? '1W'
    if (!isChartRange(range)) throw new KovaError('invalid_request', 'range is 1D, 1W, 1M or 1Y.')
    const listing = await findStock(c.req.param('symbol')).catch(() => {
      throw unreachable()
    })
    if (!listing) throw new KovaError('not_found', 'Kova doesn’t have that stock.')
    const chart = await stockChart(listing.symbol, range).catch(() => null)
    c.header('cache-control', 'public, max-age=60')
    // No history to show is an answer, not an error: the app says so where the chart would be.
    return c.json({
      object: 'stock_chart',
      ...(chart ?? { symbol: listing.symbol, range, points: [], source: 'coingecko' }),
    })
  })
  .get('/wallets/:address/stocks', async (c) => {
    const address = wallet(c.req.param('address'))
    const data = await holdingsOf(address).catch(() => {
      throw unreachable()
    })
    const total = Math.round(data.reduce((sum, h) => sum + (h.value ?? 0), 0) * 100) / 100
    return c.json({ object: 'list', chain: 'Monad', data, total })
  })
  .get('/wallets/:address/stock-alerts', async (c) => {
    const address = wallet(c.req.param('address'))
    const rows = await db
      .select({ symbol: schema.stockAlerts.symbol })
      .from(schema.stockAlerts)
      .where(eq(schema.stockAlerts.wallet, address))
    return c.json({ object: 'list', data: rows.map((r) => r.symbol) })
  })
  .post('/wallets/:address/stock-alerts', async (c) => {
    const address = wallet(c.req.param('address'))
    const parsed = alertBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) throw new KovaError('invalid_request', 'Say which stock: { symbol }.')
    limit(`stock-alerts:${clientIp(c)}`, 30, 3_600_000, 'That’s a lot of alerts. Try again later.')
    const listing = await findStock(parsed.data.symbol).catch(() => {
      throw unreachable()
    })
    if (!listing) throw new KovaError('not_found', 'Kova doesn’t have that stock.')
    await db
      .insert(schema.stockAlerts)
      .values({ id: uuidv7(), wallet: address, symbol: listing.symbol })
      .onConflictDoNothing()
    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.stockAlerts)
      .where(eq(schema.stockAlerts.symbol, listing.symbol))
    return c.json({ object: 'stock_alert', symbol: listing.symbol, waiting: count?.n ?? 1 })
  })
