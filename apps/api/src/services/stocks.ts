import {
  CHART_DAYS,
  type ChartRange,
  type MarketPeriod,
  monClient,
  POPULAR_STOCKS,
  type StockChart,
  type StockHolding,
  type StockQuote,
  sharesOf,
  stockBalances,
  stockName,
} from '@kova/monad'
import { type Address, getAddress } from 'viem'
import { config } from '../config.js'

/**
 * Stocks: xStocks on Monad (packages/monad/src/stocks.ts says what they are).
 *
 * xStocks' public API lists every xStock and prices each one; it sends no CORS headers and has no
 * history, so the apps come here. Prices are xStocks' own quotes; charts are the token's price
 * history from CoinGecko; holdings are read from Monad mainnet, where the tokens are. Everything
 * is cached, and when a source is down the last good answer stands.
 */

const XSTOCKS = 'https://api.xstocks.fi/api/v2/public'
const COINGECKO = 'https://api.coingecko.com/api/v3'

const CATALOG_MS = 15 * 60_000
const PRICE_MS = 60_000
const HOLDINGS_MS = 15_000
/** A chart never needs more points than a phone is wide. */
const CHART_POINTS = 120

type Listing = Omit<StockQuote, 'price'>

interface XStock {
  symbol: string
  name: string
  underlyingSymbol: string
  logo: string
  isTradingHalted: boolean
  underlying?: { currency?: string; exchange?: { abbreviation?: string } | null }
  trading?: { currency?: string; currentPeriod?: string; isTradingHalted?: boolean }
  deployments: { network: string; address: string }[]
}

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`)
  return (await response.json()) as T
}

/**
 * Remembers each answer for `ms`. After that, for up to ten times as long, it answers at once with
 * the last one and asks again behind it, so nobody waits on xStocks; older than that, it waits.
 * Callers share one request, and when a source fails the last good answer stands.
 */
function cached<K, V>(ms: number | ((key: K) => number), load: (key: K) => Promise<V>) {
  const entries = new Map<K, { at: number; value?: V; pending?: Promise<V> }>()
  const ask = (key: K, entry?: { at: number; value?: V }) => {
    const pending = load(key)
      .then((value) => {
        entries.set(key, { at: Date.now(), value })
        return value
      })
      .catch((error) => {
        if (entry?.value !== undefined) {
          entries.set(key, { at: entry.at, value: entry.value })
          return entry.value
        }
        entries.delete(key)
        throw error
      })
    entries.set(key, { at: entry?.at ?? 0, value: entry?.value, pending })
    return pending
  }
  return async (key: K): Promise<V> => {
    const entry = entries.get(key)
    const fresh = typeof ms === 'number' ? ms : ms(key)
    const age = entry?.value !== undefined ? Date.now() - entry.at : Number.POSITIVE_INFINITY
    if (entry?.value !== undefined && age < fresh) return entry.value
    const pending = entry?.pending ?? ask(key, entry)
    if (entry?.value !== undefined && age < fresh * 10) {
      pending.catch(() => {})
      return entry.value
    }
    return pending
  }
}

const PERIODS: MarketPeriod[] = ['market', 'extended', 'overnight', 'closed']
const period = (value: string | undefined): MarketPeriod =>
  PERIODS.includes(value as MarketPeriod) ? (value as MarketPeriod) : 'closed'

/** Every xStock on Monad that's priced in dollars. */
export const catalog = cached<'all', Listing[]>(CATALOG_MS, async () => {
  const all: XStock[] = []
  for (let page = 1; page <= 50; page++) {
    const body = await getJson<{ nodes: XStock[]; page: { hasNextPage: boolean } }>(
      `${XSTOCKS}/assets?page=${page}`,
    )
    all.push(...body.nodes)
    if (!body.page.hasNextPage) break
  }
  const listings: Listing[] = []
  for (const x of all) {
    const monad = x.deployments.find((d) => d.network === 'Monad')
    if (!monad || (x.trading?.currency ?? 'USD') !== 'USD') continue
    listings.push({
      symbol: x.symbol,
      name: stockName(x.symbol, x.name),
      ticker: x.underlyingSymbol,
      exchange: x.underlying?.exchange?.abbreviation ?? null,
      logo: x.logo,
      address: getAddress(monad.address),
      period: period(x.trading?.currentPeriod),
      halted: Boolean(x.isTradingHalted || x.trading?.isTradingHalted),
    })
  }
  if (listings.length === 0) throw new Error('xStocks listed no stocks on Monad')
  return listings
})

const priceOf = cached<string, number | null>(PRICE_MS, async (symbol) => {
  const body = await getJson<{ quote?: number }>(
    `${XSTOCKS}/assets/${encodeURIComponent(symbol)}/price-data`,
  )
  return typeof body.quote === 'number' && body.quote > 0 ? body.quote : null
})

/** The market period moves through the day; the catalog's is up to 15 minutes old, a stock's own isn't. */
const tradingOf = cached<string, { period: MarketPeriod; halted: boolean }>(
  PRICE_MS,
  async (symbol) => {
    const x = await getJson<XStock>(`${XSTOCKS}/assets/${encodeURIComponent(symbol)}`)
    return {
      period: period(x.trading?.currentPeriod),
      halted: Boolean(x.isTradingHalted || x.trading?.isTradingHalted),
    }
  },
)

async function price(symbol: string): Promise<number | null> {
  return priceOf(symbol).catch(() => null)
}

/** Prices a list, a few at a time, so a long list can't flood xStocks. */
async function priced(listings: Listing[]): Promise<StockQuote[]> {
  const out: StockQuote[] = []
  for (let i = 0; i < listings.length; i += 8) {
    const batch = listings.slice(i, i + 8)
    const prices = await Promise.all(batch.map((l) => price(l.symbol)))
    out.push(...batch.map((l, j) => ({ ...l, price: prices[j] ?? null })))
  }
  // xStocks quotes nothing while the market is shut (nights, weekends); the token still has a last
  // market price, so show that, under the "Closed" the stock already wears.
  const missing = out.filter((q) => q.price === null).map((q) => q.symbol)
  if (missing.length) {
    const last = await lastPrices(missing).catch(() => new Map<string, number>())
    for (const q of out) if (q.price === null) q.price = last.get(q.symbol) ?? null
  }
  return out
}

export async function findStock(symbol: string): Promise<Listing | undefined> {
  const wanted = symbol.toLowerCase()
  return (await catalog('all')).find((s) => s.symbol.toLowerCase() === wanted)
}

export async function popularStocks(): Promise<StockQuote[]> {
  const all = await catalog('all')
  const listings = POPULAR_STOCKS.map((s) => all.find((l) => l.symbol === s)).filter(
    (l): l is Listing => Boolean(l),
  )
  return priced(listings)
}

/** Up to 20 stocks matching a name or ticker, best matches first. */
export async function searchStocks(query: string): Promise<StockQuote[]> {
  const q = query.trim().toLowerCase()
  if (!q) return popularStocks()
  const rank = (l: Listing) => {
    const ticker = l.ticker.toLowerCase()
    const name = l.name.toLowerCase()
    if (ticker === q || l.symbol.toLowerCase() === q) return 0
    if (name === q) return 1
    if (ticker.startsWith(q)) return 2
    if (name.startsWith(q)) return 3
    if (name.split(/[\s.&-]+/).some((word) => word.startsWith(q))) return 4
    return -1
  }
  const popular = new Set<string>(POPULAR_STOCKS)
  const found = (await catalog('all'))
    .map((l) => ({ l, r: rank(l) }))
    .filter((m) => m.r >= 0)
    .sort((a, b) => a.r - b.r || Number(popular.has(b.l.symbol)) - Number(popular.has(a.l.symbol)))
    .slice(0, 20)
    .map((m) => m.l)
  return priced(found)
}

export async function stockQuote(listing: Listing): Promise<StockQuote> {
  const [value, trading] = await Promise.all([
    price(listing.symbol),
    tradingOf(listing.symbol).catch(() => null),
  ])
  const last =
    value ?? (await lastPrices([listing.symbol]).catch(() => null))?.get(listing.symbol) ?? null
  return { ...listing, ...(trading ?? {}), price: last }
}

// --- charts --------------------------------------------------------------------------------

const coingeckoHeaders = (): Record<string, string> =>
  config.COINGECKO_API_KEY ? { 'x-cg-demo-api-key': config.COINGECKO_API_KEY } : {}

/** CoinGecko's id for each xStock, by symbol: "tslax" → "tesla-xstock". */
const coingeckoIds = cached<'all', Map<string, string>>(24 * 60 * 60_000, async () => {
  const coins = await getJson<{ id: string; symbol: string; name: string }[]>(
    `${COINGECKO}/coins/list`,
    coingeckoHeaders(),
  )
  const ids = new Map<string, string>()
  for (const coin of coins)
    if (/xstock/i.test(coin.name) && !/wrapped/i.test(coin.name)) ids.set(coin.symbol, coin.id)
  return ids
})

/** The tokens' last market prices on CoinGecko, many in one call, for when xStocks quotes none. */
const lastPricesOf = cached<string, Map<string, number>>(5 * 60_000, async (key) => {
  const ids = await coingeckoIds('all')
  const wanted = key.split(',').flatMap((symbol) => {
    const id = ids.get(symbol.toLowerCase())
    return id ? [[symbol, id] as const] : []
  })
  const prices = new Map<string, number>()
  if (!wanted.length) return prices
  const body = await getJson<Record<string, { usd?: number }>>(
    `${COINGECKO}/simple/price?vs_currencies=usd&ids=${wanted.map(([, id]) => id).join(',')}`,
    coingeckoHeaders(),
  )
  for (const [symbol, id] of wanted) {
    const usd = body[id]?.usd
    if (typeof usd === 'number' && usd > 0) prices.set(symbol, usd)
  }
  return prices
})

function lastPrices(symbols: string[]): Promise<Map<string, number>> {
  return lastPricesOf([...new Set(symbols)].sort().join(','))
}

/**
 * Two series a stock, so CoinGecko's free tier goes far: 30 days hourly draws 1D, 1W and 1M; a
 * year daily draws 1Y.
 */
const seriesOf = cached<`${string}:${'hourly' | 'daily'}`, [number, number][]>(
  (key) => (key.endsWith(':daily') ? 6 * 60 * 60_000 : 15 * 60_000),
  async (key) => {
    const [symbol, grain] = key.split(':') as [string, 'hourly' | 'daily']
    const id = (await coingeckoIds('all')).get(symbol.toLowerCase())
    if (!id) return []
    const body = await getJson<{ prices?: [number, number][] }>(
      `${COINGECKO}/coins/${id}/market_chart?vs_currency=usd&days=${grain === 'daily' ? 365 : 30}`,
      coingeckoHeaders(),
    )
    return (body.prices ?? []).filter(([t, p]) => t > 0 && p > 0)
  },
)

/** Keeps every nth point, and always the last. */
function thin(points: [number, number][]): [number, number][] {
  if (points.length <= CHART_POINTS) return points
  const step = (points.length - 1) / (CHART_POINTS - 1)
  return Array.from(
    { length: CHART_POINTS },
    (_, i) => points[Math.round(i * step)] as [number, number],
  )
}

/** The token's price history, or null when there isn't one to show. */
export async function stockChart(symbol: string, range: ChartRange): Promise<StockChart | null> {
  const series = await seriesOf(`${symbol}:${range === '1Y' ? 'daily' : 'hourly'}`)
  const since = Date.now() - CHART_DAYS[range] * 24 * 60 * 60_000
  const points = thin(series.filter(([t]) => t >= since))
  return points.length >= 2 ? { symbol, range, points, source: 'coingecko' } : null
}

// --- holdings ------------------------------------------------------------------------------

/** What a wallet owns, biggest first. Read from Monad mainnet whatever network Kova runs on. */
export const holdingsOf = cached<Address, StockHolding[]>(HOLDINGS_MS, async (wallet) => {
  const all = await catalog('all')
  const balances = await stockBalances(wallet, all, monClient)
  const held = all.filter((l) => balances.has(l.address))
  const quotes = await priced(held)
  return quotes
    .map((q) => {
      const balance = balances.get(q.address) ?? 0n
      const shares = sharesOf(balance)
      return {
        ...q,
        balance: balance.toString(),
        shares,
        value: q.price === null ? null : Math.round(shares * q.price * 100) / 100,
      }
    })
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
})
