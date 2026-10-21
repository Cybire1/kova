import { type Address, erc20Abi, getAddress, type PublicClient } from 'viem'

/**
 * Stocks in Kova are xStocks: ERC-20 tokens on Monad mainnet, each backed 1:1 by a share Backed
 * holds (xstocks.fi). Kova shows their live prices and what a wallet owns; buying waits for a
 * partner, since xStocks are issued only to approved partners and only for USDC on Monad.
 *
 * The tokens live on mainnet whatever network Kova runs on, so holdings are always read there.
 * Every xStock has 18 decimals, and one token tracks one share (balanceOf already includes any
 * split or dividend multiplier).
 */
export const XSTOCK_DECIMALS = 18

/** The stocks Kova opens with, in this order. All of them trade on Monad. */
export const POPULAR_STOCKS = [
  'TSLAx',
  'NVDAx',
  'AAPLx',
  'MSFTx',
  'SPYx',
  'AMZNx',
  'METAx',
  'GOOGLx',
  'QQQx',
  'NFLXx',
  'COINx',
  'PLTRx',
  'CRCLx',
  'HOODx',
  'GLDx',
] as const

/** Where a stock's market is right now, as xStocks reports it. */
export type MarketPeriod = 'market' | 'extended' | 'overnight' | 'closed'

/** One stock, as Kova's API serves it (GET /v1/stocks). */
export interface StockQuote {
  symbol: string
  /** The company or fund, as people say it: "Tesla", "S&P 500". */
  name: string
  /** The share behind it: TSLA. */
  ticker: string
  exchange: string | null
  logo: string
  /** The token on Monad mainnet. */
  address: Address
  /** Dollars a token, from xStocks. Null when xStocks couldn't price it just now. */
  price: number | null
  period: MarketPeriod
  halted: boolean
}

/** What a wallet owns of one stock (GET /v1/wallets/:address/stocks). */
export interface StockHolding extends StockQuote {
  /** Tokens, in base units (18 decimals). */
  balance: string
  /** balance as a number of shares. */
  shares: number
  /** shares × price, in dollars. Null without a price. */
  value: number | null
}

/** A price chart: [ms since epoch, dollars] points, oldest first. */
export interface StockChart {
  symbol: string
  range: ChartRange
  points: [number, number][]
  source: 'coingecko'
}

export const CHART_RANGES = ['1D', '1W', '1M', '1Y'] as const
export type ChartRange = (typeof CHART_RANGES)[number]

export const isChartRange = (value: string): value is ChartRange =>
  (CHART_RANGES as readonly string[]).includes(value)

/** Days of history for each range, as CoinGecko takes them. */
export const CHART_DAYS: Record<ChartRange, number> = { '1D': 1, '1W': 7, '1M': 30, '1Y': 365 }

/** Names people say, where xStocks' own name isn't one ("Amazon.com xStock", "SP500 xStock"). */
const NAMES: Record<string, string> = {
  SPYx: 'S&P 500',
  QQQx: 'Nasdaq 100',
  AMZNx: 'Amazon',
  GOOGLx: 'Google',
  NVDAx: 'Nvidia',
  GLDx: 'Gold',
  MSTRx: 'Strategy',
}

export function stockName(symbol: string, xstocksName: string): string {
  return NAMES[symbol] ?? xstocksName.replace(/\s*xStock$/i, '').trim()
}

/** "1/20 of a share", "0.37 of a share", "1 share", "2.5 shares". */
export function shareLabel(shares: number): string {
  if (!(shares > 0)) return 'No shares'
  if (shares >= 1) {
    const rounded = Math.round(shares * 100) / 100
    return `${rounded} ${rounded === 1 ? 'share' : 'shares'}`
  }
  const n = Math.round(1 / shares)
  // A clean fraction only when it's close: within 5% of what's owned.
  if (n >= 2 && n <= 1000 && Math.abs(1 / n - shares) / shares < 0.05) return `1/${n} of a share`
  return `${Math.round(shares * 1000) / 1000} of a share`
}

/** How much of a share a dollar amount buys at this price: "1/76 of a share". */
export function shareOfDollars(dollars: number, price: number): string {
  return shareLabel(dollars / price)
}

/** The part of a ring to fill for this many shares: the fraction past the last whole share. */
export function ringFill(shares: number): number {
  if (!(shares > 0)) return 0
  const part = shares % 1
  return part === 0 ? 1 : part
}

export function marketLabel(period: MarketPeriod, halted: boolean): string {
  if (halted) return 'Paused'
  return {
    market: 'Market open',
    extended: 'Extended hours',
    overnight: 'Overnight',
    closed: 'Closed',
  }[period]
}

/** The 18-decimal balance as shares. Exact enough for display: a number keeps 15 digits. */
export function sharesOf(balance: bigint): number {
  const whole = balance / 10n ** 12n
  return Number(whole) / 1e6
}

/** Reads what `wallet` holds of each stock, in one multicall per 400 tokens. Skips what it can't read. */
export async function stockBalances(
  wallet: Address,
  stocks: { address: Address }[],
  client: PublicClient,
): Promise<Map<Address, bigint>> {
  const owner = getAddress(wallet)
  const found = new Map<Address, bigint>()
  for (let i = 0; i < stocks.length; i += 400) {
    const batch = stocks.slice(i, i + 400)
    const results = await client.multicall({
      allowFailure: true,
      contracts: batch.map((s) => ({
        address: s.address,
        abi: erc20Abi,
        functionName: 'balanceOf' as const,
        args: [owner] as const,
      })),
    })
    batch.forEach((stock, j) => {
      const r = results[j]
      if (r?.status === 'success' && typeof r.result === 'bigint' && r.result > 0n)
        found.set(stock.address, r.result)
    })
  }
  return found
}
