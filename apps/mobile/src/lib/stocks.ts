import type { ChartRange, StockChart, StockHolding, StockQuote } from '@kova/monad'
import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { apiUrl } from './config'
import { useWallet } from './wallet'

/**
 * Stocks: xStocks on Monad, through Kova's API (prices from xStocks, charts from CoinGecko,
 * holdings read on Monad mainnet). packages/monad/src/stocks.ts says what they are.
 */

async function get<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const body = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } }
  if (!response.ok)
    throw new Error(body.error?.message ?? `Kova is unreachable (${response.status})`)
  return body
}

/** The stocks Kova lists: only the ones Monad's markets carry now, so every one can be bought. */
export const getStocks = (q = '') =>
  get<{ data: StockQuote[] }>(`/v1/stocks${q ? `?q=${encodeURIComponent(q)}` : ''}`).then((r) =>
    r.data.filter((s) => s.tradable !== false),
  )

export const getStock = (symbol: string) =>
  get<StockQuote>(`/v1/stocks/${encodeURIComponent(symbol)}`)

export const getStockChart = (symbol: string, range: ChartRange) =>
  get<StockChart>(`/v1/stocks/${encodeURIComponent(symbol)}/chart?range=${range}`)

export const getStockAlerts = (wallet: string) =>
  get<{ data: string[] }>(`/v1/wallets/${wallet}/stock-alerts`).then((r) => r.data)

export const askStockAlert = (wallet: string, symbol: string) =>
  get<{ symbol: string; waiting: number }>(`/v1/wallets/${wallet}/stock-alerts`, {
    method: 'POST',
    body: JSON.stringify({ symbol }),
  })

export interface Holdings {
  data: StockHolding[]
  total: number
}

/** The last holdings read, per wallet, so Home and Stocks open on numbers instead of a spinner. */
const last = new Map<string, Holdings>()
const listeners = new Set<() => void>()

/** What this wallet owns, kept fresh while a screen showing it is in focus. */
export function useStockHoldings() {
  const { profile } = useWallet()
  const wallet = profile?.address
  const [, rerender] = useState(0)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const listener = () => rerender((n) => n + 1)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!wallet) return
    try {
      const holdings = await get<Holdings>(`/v1/wallets/${wallet}/stocks`)
      last.set(wallet, holdings)
      setFailed(false)
      for (const listener of listeners) listener()
    } catch {
      setFailed(true)
    }
  }, [wallet])

  useFocusEffect(
    useCallback(() => {
      void refresh()
      const timer = setInterval(() => void refresh(), 30_000)
      return () => clearInterval(timer)
    }, [refresh]),
  )

  return { holdings: wallet ? (last.get(wallet) ?? null) : null, failed, refresh }
}

/** Live prices for the popular list, refreshed every 30 seconds while in view. */
export function useStockQuotes(q: string) {
  const [stocks, setStocks] = useState<StockQuote[] | null>(null)
  const [failed, setFailed] = useState(false)
  useFocusEffect(
    useCallback(() => {
      let live = true
      const load = () =>
        getStocks(q.trim())
          .then((data) => {
            if (!live) return
            setStocks(data)
            setFailed(false)
          })
          .catch(() => live && setFailed(true))
      // Typing waits a beat, so every letter isn't a request.
      const first = setTimeout(load, q ? 250 : 0)
      const timer = setInterval(load, 30_000)
      return () => {
        live = false
        clearTimeout(first)
        clearInterval(timer)
      }
    }, [q]),
  )
  return { stocks, failed }
}

/** "$378.40", "$0.42", "$12,480.00". */
export function stockUsd(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
