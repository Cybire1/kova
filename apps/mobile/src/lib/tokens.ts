import {
  type ChainDepositActivity,
  type ChainDepositSources,
  conversionActivity,
  convertibleTokens,
  type HeldToken,
  heldTokens,
  keptHoldings,
  type PendingTokenConversion,
  readWalletTokens,
  type SignedAuthorization,
  type TokenArrival,
  type TokenHoldings,
  tokenArrivals,
  tokenConversionKey,
  WALLET_TOKENS,
  type WalletToken,
  walletTokensKey,
} from '@kova/monad'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import { type Hash, parseUnits } from 'viem'
import { chainDepositActivity, chainDepositSources } from './chain'
import { apiUrl, network, networkId } from './config'
import { load, remove, save } from './storage'
import { useWallet } from './wallet'

/**
 * The wallet's other tokens on the phone (apps/web src/lib/wallet/tokens.ts on the web): one
 * watcher, mounted with the app, reads them every 20 seconds while it's open and queues what
 * arrived; Home and the Other tokens screen read what it found. USDC arrives here too: the
 * dollar arrival is for AUSD, the balance.
 */

interface Tokens {
  wallet: string | null
  holdings: TokenHoldings | null
  /** Arrivals waiting to be shown, oldest first. */
  arrivals: TokenArrival[]
  sources: ChainDepositSources | null
}

const empty: Tokens = { wallet: null, holdings: null, arrivals: [], sources: null }
let tokens = empty
const listeners = new Set<() => void>()
let lookNow: (() => Promise<void>) | null = null
/** Development only: made-up holdings on screen (previewTokens), so Monad isn't read over them. */
let previewing: TokenHoldings | null = null

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

/** Reads the wallet's other tokens while the app is open, and queues each arrival once. */
export function useTokenWatch() {
  const { profile } = useWallet()
  const wallet = profile?.address
  useEffect(() => {
    if (!wallet) return
    let active = true
    let running = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const key = walletTokensKey(wallet, networkId)
    update({ ...empty, wallet, holdings: previewing })
    const look = async () => {
      if (running || previewing) return
      running = true
      clearTimeout(timer)
      try {
        const [before, now] = await Promise.all([
          load<TokenHoldings | null>(key, null),
          readWalletTokens(wallet, networkId),
        ])
        if (!active || previewing) return
        const kept = keptHoldings(before, now)
        await save(key, kept).catch(() => {})
        const queued = new Set(tokens.arrivals.map((a) => a.id))
        const arrived = tokenArrivals(networkId, before, now).filter((a) => !queued.has(a.id))
        update({ holdings: kept, arrivals: [...tokens.arrivals, ...arrived] })
      } catch {
        // Monad's RPC stumbled: the last look stands, and the next one tries again.
      } finally {
        running = false
        if (active && AppState.currentState === 'active') timer = setTimeout(look, 20_000)
      }
    }
    lookNow = look
    void load<TokenHoldings | null>(key, null).then((saved) => {
      if (active && saved && !tokens.holdings) update({ holdings: saved })
    })
    void look()
    void chainDepositSources(wallet)
      .then((sources) => {
        if (active) update({ sources })
      })
      .catch(() => {})
    const state = AppState.addEventListener('change', (next) => {
      if (next === 'active') void look()
      else clearTimeout(timer)
    })
    return () => {
      active = false
      clearTimeout(timer)
      state.remove()
      if (lookNow === look) lookNow = null
      update(empty)
    }
  }, [wallet])
}

/** Looks again now, after a conversion or when a screen opens. */
export const refreshTokens = () => lookNow?.() ?? Promise.resolve()

const listedToken = (symbol: string) => WALLET_TOKENS[networkId].find((t) => t.symbol === symbol)

/**
 * Development only (dev.tsx `tokens=USDT0:5,WETH:0.0042`), to look at the design: made-up
 * holdings, with USDC and USDT0 converting as Kova's deposit route takes them today. Monad isn't
 * read over them until the app relaunches.
 */
export function previewTokens(amounts: Record<string, string>) {
  if (!__DEV__) return
  const holdings: TokenHoldings = {}
  for (const [symbol, amount] of Object.entries(amounts)) {
    const token = listedToken(symbol)
    if (token) holdings[token.address.toLowerCase()] = parseUnits(amount, token.decimals).toString()
  }
  previewing = holdings
  const convertible = ['USDC', 'USDT0'].flatMap((symbol) => listedToken(symbol) ?? [])
  update({
    holdings,
    sources: {
      live: true,
      tracking: false,
      network: networkId,
      reason: null,
      arrives_as: 'AUSD',
      chains: [
        {
          id: network.chainId,
          name: 'Monad',
          vm: 'evm',
          tokens: convertible.map(({ address, symbol, decimals }) => ({
            address,
            symbol,
            decimals,
          })),
        },
      ],
    },
  })
}

/** Development only (dev.tsx `tokenarrival=USDT0:5`): a made-up arrival, to look at its sheet. */
export function previewTokenArrival(symbol: string, amount: string) {
  const token = listedToken(symbol)
  if (!__DEV__ || !token) return
  const arrival = { id: `preview:${Date.now()}`, token, amount: parseUnits(amount, token.decimals) }
  update({ arrivals: [...tokens.arrivals, arrival] })
}

/** The next arrival to show, taken off the queue. */
export function takeTokenArrival(): TokenArrival | null {
  const [next, ...rest] = tokens.arrivals
  if (next) update({ arrivals: rest })
  return next ?? null
}

export function useWalletTokens(): {
  ready: boolean
  held: HeldToken[]
  convertible: WalletToken[]
  arrivals: TokenArrival[]
} {
  const { profile } = useWallet()
  const state = useSyncExternalStore(subscribe, current, current)
  const mine = state.wallet !== null && state.wallet === profile?.address
  const held = useMemo(() => (mine ? heldTokens(networkId, state.holdings) : []), [mine, state])
  const convertible = useMemo(
    () => (mine ? convertibleTokens(networkId, state.sources) : []),
    [mine, state],
  )
  return {
    ready: mine && state.holdings !== null,
    held,
    convertible,
    arrivals: mine ? state.arrivals : [],
  }
}

/** Hands a signed transfer to Kova's relayer, which submits it and pays the fee. */
export async function relayTransfer(signed: SignedAuthorization): Promise<Hash> {
  const response = await fetch(`${apiUrl}/v1/transfers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(signed),
  })
  const json = (await response.json().catch(() => ({}))) as {
    tx_hash?: Hash
    error?: { message?: string }
  }
  if (!response.ok || !json.tx_hash)
    throw new Error(json.error?.message ?? `Kova is unreachable (${response.status})`)
  return json.tx_hash
}

/** A conversion on its way, kept so it can be followed after a relaunch, until its dollars land. */
export function useTokenConversion() {
  const { profile, refresh } = useWallet()
  const wallet = profile?.address
  const [saved, setSaved] = useState<PendingTokenConversion | null>(null)
  const [activity, setActivity] = useState<ChainDepositActivity | null>(null)
  const [trackingProblem, setTrackingProblem] = useState(false)
  const [loadedWallet, setLoadedWallet] = useState<string | undefined>()
  const pending = saved?.wallet.toLowerCase() === wallet?.toLowerCase() ? saved : null

  useEffect(() => {
    let active = true
    setActivity(null)
    setTrackingProblem(false)
    setSaved(null)
    setLoadedWallet(undefined)
    if (wallet)
      void load<PendingTokenConversion | null>(tokenConversionKey(wallet), null).then((value) => {
        if (!active) return
        setSaved(value)
        setLoadedWallet(wallet)
      })
    return () => {
      active = false
    }
  }, [wallet])

  const remember = useCallback(
    async (value: PendingTokenConversion | null) => {
      if (!wallet) return
      if (value) await save(tokenConversionKey(wallet), value)
      else await remove(tokenConversionKey(wallet))
      setSaved(value)
      setActivity(null)
    },
    [wallet],
  )

  const done = activity?.status === 'success' || activity?.status === 'refund'
  useEffect(() => {
    if (!wallet || !pending || done) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const look = async () => {
      try {
        const found = conversionActivity(pending, await chainDepositActivity(wallet))
        if (!active) return
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
