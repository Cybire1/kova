import { useEffect, useState } from 'react'
import { apiUrl } from './config'
import { currencyInfo, type DisplayCurrency, displayCurrencies } from './money'
import { load, save } from './storage'

/**
 * Live reference rates. Kova's API reads them from KovaRates on Monad, where a Chainlink CRE
 * workflow publishes them: two independent sources, cross-checked on every node, and the DON's
 * median. They replace the table in money.ts in place, so every local price on screen uses
 * them, and the last ones are kept so the next launch starts with them.
 */
const KEY = 'kova.rates.v1'

interface Published {
  source: 'chainlink' | 'table'
  rates: Partial<Record<string, { per_usd: number; as_of: string | null }>>
}

let current: { source: Published['source']; asOf: string | null } = { source: 'table', asOf: null }

function apply(published: Published) {
  let newest: string | null = null
  for (const code of displayCurrencies) {
    const rate = published.rates[code]
    if (code === 'USD' || !rate || !(rate.per_usd > 0)) continue
    currencyInfo[code as DisplayCurrency].perUsd = rate.per_usd
    if (rate.as_of && (!newest || rate.as_of > newest)) newest = rate.as_of
  }
  current = { source: published.source, asOf: newest }
}

async function refresh(timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${apiUrl}/v1/rates`, { signal: controller.signal })
    if (!response.ok) return
    const published = (await response.json()) as Published
    apply(published)
    await save(KEY, published)
  } catch {
    // Offline or slow: the last rates stand.
  } finally {
    clearTimeout(timer)
  }
}

/** Applies the last known rates at once, gives fresh ones a moment to arrive, then keeps them fresh. */
export function useLiveRates(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let alive = true
    void (async () => {
      const cached = await load<Published | null>(KEY, null)
      if (cached) apply(cached)
      await refresh(1200)
      if (alive) setReady(true)
    })()
    const timer = setInterval(() => void refresh(8000), 15 * 60_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  return ready
}

/** Whether the rates on screen are Chainlink's, rather than the fixed table. */
export const ratesLive = () => current.source === 'chainlink'

/**
 * Where a rate on screen comes from, in plain words: "Market rate from 4 min ago" (Chainlink's,
 * live), or "reference rate" (the fixed table).
 */
export function rateLabel(now = Date.now()): string {
  if (current.source !== 'chainlink') return 'reference rate'
  if (!current.asOf) return 'Market rate'
  const minutes = Math.max(0, Math.round((now - Date.parse(current.asOf)) / 60_000))
  if (minutes < 1) return 'Market rate, just now'
  if (minutes < 90) return `Market rate from ${minutes} min ago`
  return `Market rate from ${Math.round(minutes / 60)} h ago`
}
