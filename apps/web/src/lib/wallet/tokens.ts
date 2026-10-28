'use client'

import {
  type ChainDepositActivity,
  type ChainDepositSources,
  conversionActivity,
  convertibleTokens,
  type HeldToken,
  heldTokens,
  keptHoldings,
  type NetworkId,
  type PendingTokenConversion,
  readWalletTokens,
  type SignedAuthorization,
  type TokenArrival,
  type TokenHoldings,
  tokenArrivals,
  tokenByAddress,
  tokenConversionKey,
  WALLET_TOKENS,
  type WalletToken,
  walletTokensKey,
} from '@kova/monad'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { type Hash, parseUnits } from 'viem'
import { useWallet } from '@/components/wallet/provider'
import { monApi } from './mon'
import { networkStorageKey } from './storage'

/**
 * The wallet's other tokens on the web (apps/mobile src/lib/tokens.ts on the phone): one watcher,
 * mounted with the wallet, reads them every 20 seconds and queues what arrived; Home and the
 * Other tokens screen read what it found.
 */

interface Tokens {
  wallet: string | null
  network: NetworkId | null
  holdings: TokenHoldings | null
  /** Arrivals waiting to be shown, oldest first. */
  arrivals: TokenArrival[]
  sources: ChainDepositSources | null
}

const empty: Tokens = { wallet: null, network: null, holdings: null, arrivals: [], sources: null }
let tokens = empty
const listeners = new Set<() => void>()
let lookNow: (() => Promise<void>) | null = null
/** Development only: made-up holdings are on screen, so Monad isn't read over them. */
let previewing = false

function update(next: Partial<Tokens>) {
  tokens = { ...tokens, ...next }
  for (const listener of listeners) listener()
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const current = () => tokens
const initial = () => empty

function stored(key: string): TokenHoldings | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null')
    return value && typeof value === 'object' ? (value as TokenHoldings) : null
  } catch {
    return null
  }
}

/** Kova's own dollars (USDC) already get the dollar arrival, so they don't get this one too. */
const announcedAsDollars = (network: NetworkId, arrival: TokenArrival) =>
  Boolean(tokenByAddress(network, arrival.token.address))

/** Reads the wallet's other tokens while it's open, and queues each arrival once. Mount it once. */
export function useTokenWatch() {
  const { profile, network } = useWallet()
  const wallet = profile?.address
  useEffect(() => {
    if (!wallet) return
    let active = true
    let running = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const key = networkStorageKey(walletTokensKey(wallet, network), network)
    update({ ...empty, wallet, network, holdings: stored(key) })
    const look = async () => {
      if (running || previewing) return
      running = true
      clearTimeout(timer)
      try {
        const now = await readWalletTokens(wallet, network)
        if (!active) return
        // Another tab may have looked since: compare with what it kept, so it's announced once.
        const before = stored(key)
        const kept = keptHoldings(before, now)
        try {
          localStorage.setItem(key, JSON.stringify(kept))
        } catch {}
        const queued = new Set(tokens.arrivals.map((a) => a.id))
        const arrived = tokenArrivals(network, before, now).filter(
          (a) => !queued.has(a.id) && !announcedAsDollars(network, a),
        )
        update({ holdings: kept, arrivals: [...tokens.arrivals, ...arrived] })
      } catch {
        // Monad's RPC stumbled: the last look stands, and the next one tries again.
      } finally {
        running = false
        if (active) timer = setTimeout(look, document.hidden ? 60_000 : 20_000)
      }
    }
    lookNow = look
    void look()
    monApi<ChainDepositSources>(`/api/wallet/${wallet}/chain-deposit-sources`)
      .then((sources) => {
        if (active) update({ sources })
      })
      .catch(() => {})
    const onShow = () => {
      if (!document.hidden) void look()
    }
    document.addEventListener('visibilitychange', onShow)
    return () => {
      active = false
      clearTimeout(timer)
      if (lookNow === look) lookNow = null
      document.removeEventListener('visibilitychange', onShow)
      update(empty)
    }
  }, [wallet, network])
}

/** Looks again now, after a conversion or when a screen opens. */
export const refreshTokens = () => lookNow?.() ?? Promise.resolve()

/**
 * Development only, to look at the design (as `kovaArrival` does for dollars): in the console,
 * `kovaTokens({ USDT0: '5', WETH: '0.0042' })` shows made-up holdings, and stops reading Monad
 * until the page reloads; `kovaTokenArrival('USDT0', '5')` shows a made-up arrival.
 */
export function useTokenPreview() {
  const { network } = useWallet()
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    const w = window as unknown as {
      kovaTokens?: (amounts: Record<string, string>) => void
      kovaTokenArrival?: (symbol: string, amount: string) => void
    }
    const find = (symbol: string) => WALLET_TOKENS[network].find((t) => t.symbol === symbol)
    w.kovaTokens = (amounts) => {
      previewing = true
      const holdings: TokenHoldings = {}
      for (const [symbol, amount] of Object.entries(amounts)) {
        const token = find(symbol)
        if (token)
          holdings[token.address.toLowerCase()] = parseUnits(amount, token.decimals).toString()
      }
      update({ holdings })
    }
    w.kovaTokenArrival = (symbol, amount) => {
      const token = find(symbol)
      if (!token) return
      const id = `preview:${Date.now()}`
      update({
        arrivals: [...tokens.arrivals, { id, token, amount: parseUnits(amount, token.decimals) }],
      })
    }
    return () => {
      previewing = false
      delete w.kovaTokens
      delete w.kovaTokenArrival
    }
  }, [network])
}

export function useWalletTokens(): {
  ready: boolean
  held: HeldToken[]
  convertible: WalletToken[]
  arrival: TokenArrival | null
  dismissArrival: () => void
} {
  const { profile, network } = useWallet()
  const state = useSyncExternalStore(subscribe, current, initial)
  const mine = state.wallet !== null && state.wallet === profile?.address
  const held = useMemo(
    () => (mine && state.network ? heldTokens(state.network, state.holdings) : []),
    [mine, state.network, state.holdings],
  )
  const convertible = useMemo(
    () => (mine ? convertibleTokens(network, state.sources) : []),
    [mine, network, state.sources],
  )
  const dismissArrival = useCallback(() => update({ arrivals: tokens.arrivals.slice(1) }), [])
  return {
    ready: mine && state.holdings !== null,
    held,
    convertible,
    arrival: mine ? (state.arrivals[0] ?? null) : null,
    dismissArrival,
  }
}

/** Hands a signed transfer to Kova's relayer, which submits it and pays the fee. */
export const relayTransfer = async (signed: SignedAuthorization) =>
  (await monApi<{ tx_hash: Hash }>('/api/wallet/send', signed)).tx_hash

/** A conversion on its way, kept so it can be followed after a reload, until its dollars land. */
export function useTokenConversion() {
  const { profile, network, refresh } = useWallet()
  const wallet = profile?.address
  const [saved, setSaved] = useState<PendingTokenConversion | null>(null)
  const [activity, setActivity] = useState<ChainDepositActivity | null>(null)
  const [trackingProblem, setTrackingProblem] = useState(false)
  const [loadedWallet, setLoadedWallet] = useState<string | undefined>()
  const pending = saved?.wallet.toLowerCase() === wallet?.toLowerCase() ? saved : null
  const key = wallet ? networkStorageKey(tokenConversionKey(wallet), network) : null

  useEffect(() => {
    setActivity(null)
    setTrackingProblem(false)
    if (!key) {
      setSaved(null)
      setLoadedWallet(undefined)
      return
    }
    try {
      setSaved(JSON.parse(localStorage.getItem(key) ?? 'null'))
    } catch {
      setSaved(null)
    }
    setLoadedWallet(wallet)
  }, [key, wallet])

  const remember = useCallback(
    (value: PendingTokenConversion | null) => {
      if (!key) return
      try {
        if (value) localStorage.setItem(key, JSON.stringify(value))
        else localStorage.removeItem(key)
      } catch {}
      setSaved(value)
      setActivity(null)
    },
    [key],
  )

  const done = activity?.status === 'success' || activity?.status === 'refund'
  useEffect(() => {
    if (!wallet || !pending || done) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const look = async () => {
      try {
        const result = await monApi<{ data: ChainDepositActivity[] }>(
          `/api/wallet/${wallet}/chain-deposits`,
        )
        if (!active) return
        const found = conversionActivity(pending, result.data)
        if (found) setActivity(found)
        setTrackingProblem(false)
        if (found?.status === 'success' || found?.status === 'refund') {
          void refresh()
          void refreshTokens()
          return
        }
      } catch {
        if (active) setTrackingProblem(true)
      }
      if (active) timer = setTimeout(look, 6000)
    }
    void look()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [wallet, pending, done, refresh])

  return { pending, activity, trackingProblem, ready: loadedWallet === wallet, remember }
}
