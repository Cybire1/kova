import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * Stocks read three outside sources: xStocks for the list and prices, CoinGecko for charts, Monad
 * for holdings. Here xStocks and CoinGecko answer from fixtures, so this runs offline.
 */

const asset = (
  symbol: string,
  name: string,
  ticker: string,
  address: string,
  currency = 'USD',
) => ({
  symbol,
  name,
  underlyingSymbol: ticker,
  logo: `https://xstocks-metadata.backed.fi/logos/tokens/${symbol}.png`,
  isTradingHalted: false,
  underlying: { currency, exchange: { abbreviation: 'NASDAQ' } },
  trading: { currency, currentPeriod: 'extended', isTradingHalted: false },
  deployments: [{ network: 'Monad', address }],
})

const ASSETS = [
  asset('TSLAx', 'Tesla xStock', 'TSLA', '0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0'),
  asset('TSCOx', 'Tesco xStock', 'TSCO', '0x0000000000000000000000000000000000000002'),
  asset('AMZNx', 'Amazon.com xStock', 'AMZN', '0x0000000000000000000000000000000000000003'),
  // Priced in euros: Kova lists dollar stocks only.
  asset('BEIx', 'Beiersdorf xStock', 'BEI', '0x0000000000000000000000000000000000000004', 'EUR'),
  // Not on Monad.
  {
    ...asset('SOLOx', 'Solo xStock', 'SOLO', '0x05'),
    deployments: [{ network: 'Solana', address: 'x' }],
  },
]

const now = Date.now()
const HOUR = 3_600_000

function answer(url: string): unknown {
  const u = new URL(url)
  if (u.host === 'api.xstocks.fi') {
    if (u.pathname.endsWith('/assets'))
      return u.searchParams.get('page') === '1'
        ? { nodes: ASSETS.slice(0, 3), page: { hasNextPage: true } }
        : { nodes: ASSETS.slice(3), page: { hasNextPage: false } }
    // xStocks quotes nothing for a stock whose market is shut: Tesco, here.
    if (u.pathname.endsWith('/price-data'))
      return {
        quote: u.pathname.includes('TSLAx') ? 387.5 : u.pathname.includes('TSCOx') ? null : 100,
      }
    return ASSETS.find((a) => u.pathname.endsWith(`/${a.symbol}`))
  }
  if (u.pathname.endsWith('/coins/list'))
    return [
      { id: 'tesla-xstock', symbol: 'tslax', name: 'Tesla xStock' },
      { id: 'wrapped-tesla-xstock', symbol: 'wtslax', name: 'Wrapped Tesla xStock' },
      { id: 'tesco-xstock', symbol: 'tscox', name: 'Tesco xStock' },
    ]
  if (u.pathname.endsWith('/simple/price'))
    return Object.fromEntries(
      (u.searchParams.get('ids') ?? '')
        .split(',')
        .filter((id) => id === 'tesco-xstock')
        .map((id) => [id, { usd: 4.25 }]),
    )
  if (u.pathname.includes('/coins/tesla-xstock/market_chart')) {
    // 30 days hourly, rising a cent an hour.
    const prices = Array.from({ length: 720 }, (_, i) => [now - (719 - i) * HOUR, 300 + i / 100])
    return { prices }
  }
  return null
}

let app: typeof import('../src/index.js')['app']

beforeAll(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const body = answer(url)
      return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404 })
    }),
  )
  app = (await import('../src/index.js')).app
})

afterAll(() => {
  vi.unstubAllGlobals()
})

async function get<T>(path: string) {
  const response = await app.request(path)
  return { status: response.status, body: (await response.json()) as T }
}

describe('stocks', () => {
  it('lists dollar xStocks on Monad, named the way people say them', async () => {
    const { status, body } = await get<{ data: { symbol: string; name: string; price: number }[] }>(
      '/v1/stocks',
    )
    expect(status).toBe(200)
    expect(body.data.map((s) => s.symbol)).toEqual(['TSLAx', 'AMZNx'])
    expect(body.data[0]).toMatchObject({ name: 'Tesla', price: 387.5 })
    expect(body.data[1]).toMatchObject({ name: 'Amazon' })
  })

  it('searches by ticker and name, exact matches first', async () => {
    const { body } = await get<{ data: { symbol: string }[] }>('/v1/stocks?q=ts')
    expect(body.data.map((s) => s.symbol)).toEqual(['TSLAx', 'TSCOx'])
    const tesco = await get<{ data: { symbol: string }[] }>('/v1/stocks?q=tesco')
    expect(tesco.body.data.map((s) => s.symbol)).toEqual(['TSCOx'])
    const none = await get<{ data: unknown[] }>('/v1/stocks?q=beiersdorf')
    expect(none.body.data).toEqual([])
  })

  it('shows the token’s last market price while xStocks quotes none', async () => {
    const list = await get<{ data: { symbol: string; price: number | null }[] }>(
      '/v1/stocks?q=tesco',
    )
    expect(list.body.data).toMatchObject([{ symbol: 'TSCOx', price: 4.25 }])
    const one = await get<{ price: number | null }>('/v1/stocks/TSCOx')
    expect(one.body.price).toBe(4.25)
  })

  it('prices one stock, and says when Kova does not have it', async () => {
    const tesla = await get<{ symbol: string; period: string }>('/v1/stocks/tslax')
    expect(tesla.body).toMatchObject({ symbol: 'TSLAx', period: 'extended' })
    expect((await get('/v1/stocks/NOPE')).status).toBe(404)
  })

  it('draws each range from the hourly series, thinned to fit a phone', async () => {
    const day = await get<{ points: [number, number][] }>('/v1/stocks/TSLAx/chart?range=1D')
    expect(day.body.points.length).toBeGreaterThanOrEqual(24)
    expect(day.body.points.length).toBeLessThanOrEqual(25)
    const month = await get<{ points: [number, number][] }>('/v1/stocks/TSLAx/chart?range=1M')
    expect(month.body.points).toHaveLength(120)
    expect(month.body.points.at(-1)?.[1]).toBeCloseTo(307.19)
    expect((await get('/v1/stocks/TSLAx/chart?range=5Y')).status).toBe(400)
  })

  it('answers with no points for a stock CoinGecko has no history for', async () => {
    const { status, body } = await get<{ points: unknown[] }>('/v1/stocks/AMZNx/chart?range=1W')
    expect(status).toBe(200)
    expect(body.points).toEqual([])
  })

  it('turns away a wallet address that is not one', async () => {
    expect((await get('/v1/wallets/nope/stocks')).status).toBe(400)
  })
})
