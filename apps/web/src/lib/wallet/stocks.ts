'use client'

import type { ChartRange, StockChart, StockHolding, StockQuote } from '@kova/monad'
import { useEffect, useState } from 'react'

/**
 * Stocks on the web: xStocks on Monad, through this site's /api/stocks routes (Kova's API reads
 * xStocks, CoinGecko and Monad, and caches them). Each answer is kept for the visit, so going from
 * Home to Stocks to a stock and back never shows an empty card while it asks again.
 */

async function get<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', ...init })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error ?? 'Stock prices are unreachable right now.')
  return body as T
}

const kept = new Map<string, { at: number; value: unknown }>()

/** Asks `path` now, showing what was kept from before while it does, and again every `every` ms. */
function useKept<T>(path: string | null, every = 0) {
  const [value, setValue] = useState<T | null>(() =>
    path ? ((kept.get(path)?.value as T) ?? null) : null,
  )
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!path) return
    let live = true
    setValue((kept.get(path)?.value as T) ?? null)
    setFailed(false)
    const ask = () =>
      get<T>(path)
        .then((v) => {
          kept.set(path, { at: Date.now(), value: v })
          if (live) {
            setValue(v)
            setFailed(false)
          }
        })
        .catch(() => live && setFailed(true))
    void ask()
    const timer = every > 0 ? setInterval(ask, every) : undefined
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [path, every])
  return { value, failed }
}

export interface Holdings {
  data: StockHolding[]
  total: number
}

/** What this wallet owns, read from Monad mainnet; refreshed every 30 seconds while shown. */
export function useHoldings(address: string | undefined) {
  const { value, failed } = useKept<Holdings>(
    address ? `/api/wallet/${address}/stocks` : null,
    30_000,
  )
  return { holdings: value, failed }
}

/** Popular stocks, or the ones matching `query` (asked 250 ms after typing stops). */
export function useStockList(query: string) {
  const [asked, setAsked] = useState(query.trim())
  useEffect(() => {
    const timer = setTimeout(() => setAsked(query.trim()), 250)
    return () => clearTimeout(timer)
  }, [query])
  const { value, failed } = useKept<{ data: StockQuote[] }>(
    `/api/stocks${asked ? `?q=${encodeURIComponent(asked)}` : ''}`,
    asked ? 0 : 60_000,
  )
  return { stocks: value?.data ?? null, failed, searching: asked !== query.trim() }
}

export function useStock(symbol: string) {
  const { value, failed } = useKept<StockQuote>(`/api/stocks/${encodeURIComponent(symbol)}`, 60_000)
  return { stock: value, failed }
}

export function useStockChart(symbol: string, range: ChartRange) {
  const { value, failed } = useKept<StockChart>(
    `/api/stocks/${encodeURIComponent(symbol)}/chart?range=${range}`,
  )
  return { chart: value, failed }
}

/** Whether this wallet asked to be told it can buy `symbol`, and a way to ask. */
export function useStockAlert(address: string | undefined, symbol: string) {
  const [asked, setAsked] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    if (!address) return
    let live = true
    get<{ data: string[] }>(`/api/wallet/${address}/stock-alerts`)
      .then((r) => live && setAsked(r.data.includes(symbol)))
      .catch(() => live && setAsked(false))
    return () => {
      live = false
    }
  }, [address, symbol])
  const ask = async () => {
    if (!address || busy) return
    setBusy(true)
    setProblem(null)
    try {
      await get(`/api/wallet/${address}/stock-alerts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ symbol }),
      })
      setAsked(true)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'That didn’t go through. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return { asked, busy, problem, ask }
}

/** "$378.40", and cents below a dollar: "$0.42". */
export function formatPrice(dollars: number): string {
  return dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
