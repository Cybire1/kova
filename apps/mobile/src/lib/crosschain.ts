import { useEffect, useState } from 'react'
import { bridgeOut } from './config'
import {
  type CrossChainSender,
  demoSender,
  feeUrl,
  quote as localQuote,
  type Network,
  type NetworkId,
  type Quote,
  readForwardFee,
} from './crosschain-core'
import { setsunaSender } from './crosschain-setsuna'
import { load, save } from './storage'

export * from './crosschain-core'

/**
 * Send to any network, on the phone: which sender moves the money, quotes, and the network each
 * address was last sent on. The rules and the network list are in crosschain-core.ts.
 *
 * Mainnet sends through Setsuna's sponsored bridge (EXPO_PUBLIC_KOVA_BRIDGE=0 turns it off, and
 * Send is Monad-only again). Testnet has no bridge: development builds there use the stand-in,
 * which moves nothing and says so; release builds on testnet don't offer other networks.
 */

let sender: CrossChainSender | null = bridgeOut ? setsunaSender : __DEV__ ? demoSender : null

/** Swap what moves the money (tests, or a different bridge). Null turns other networks off. */
export function setCrossChainSender(next: CrossChainSender | null) {
  sender = next
}

export function crossChainSender(): CrossChainSender | null {
  return sender
}

/** Whether Send offers other networks at all. */
export const crossChainOn = () => sender !== null

/** Whether `n` is somewhere the sender can send. */
export const reaches = (n: Network) => !!sender && sender.reach.includes(n.id)

const fees = new Map<NetworkId, { fee: bigint; at: number }>()
const FEE_TTL = 60_000

/** Circle's forwarding fee to `n` right now, kept for a minute. Null if Circle didn't answer. */
export async function fetchForwardFee(n: Network): Promise<bigint | null> {
  const kept = fees.get(n.id)
  if (kept && Date.now() - kept.at < FEE_TTL) return kept.fee
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(feeUrl(n), { signal: controller.signal })
    if (!res.ok) return null
    const fee = readForwardFee(await res.json())
    if (fee !== null) fees.set(n.id, { fee, at: Date.now() })
    return fee
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The quote for sending `amount` to `n`: the sender's own (Setsuna's covers the AUSD swap and
 * Circle's fee ceiling), asked a moment after typing stops; until it answers, an estimate from
 * Circle's fee. `exact` is false while showing the estimate.
 */
export function useSendQuote(
  n: Network | null,
  amount: bigint,
  coverGas: boolean,
): { quote: Quote | null; exact: boolean; problem: string | null } {
  const [live, setLive] = useState<bigint | null>(null)
  const [own, setOwn] = useState<{ key: string; quote: Quote } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const key = n ? `${n.id}:${amount}:${coverGas}` : ''

  useEffect(() => {
    setLive(null)
    if (!n || n.fallbackFee === null || n.id === 'monad') return
    let on = true
    void fetchForwardFee(n).then((fee) => {
      if (on) setLive(fee)
    })
    return () => {
      on = false
    }
  }, [n])

  useEffect(() => {
    setProblem(null)
    const s = sender
    if (!n || !s?.quote || amount <= 0n) return
    let on = true
    const timer = setTimeout(() => {
      s.quote?.(n, amount, coverGas).then(
        (q) => {
          if (on) setOwn({ key, quote: q })
        },
        (e: unknown) => {
          if (on) setProblem(e instanceof Error ? e.message : 'Couldn’t get a quote. Try again.')
        },
      )
    }, 350)
    return () => {
      on = false
      clearTimeout(timer)
    }
  }, [n, amount, coverGas, key])

  if (!n) return { quote: null, exact: false, problem: null }
  if (own && own.key === key) return { quote: own.quote, exact: true, problem }
  return {
    quote: localQuote(n, amount, coverGas, live),
    exact: !sender?.quote && live !== null,
    problem,
  }
}

const RECENT = 'kova.anywhere.recent.v1'

/** The network each address was last sent on, so the picker can start there. */
export function useLastNetwork(address: string): NetworkId | null {
  const [id, setId] = useState<NetworkId | null>(null)
  useEffect(() => {
    let on = true
    void load<Record<string, NetworkId>>(RECENT, {}).then((all) => {
      if (on) setId(all[address.toLowerCase()] ?? null)
    })
    return () => {
      on = false
    }
  }, [address])
  return id
}

export async function rememberNetwork(address: string, id: NetworkId) {
  const all = await load<Record<string, NetworkId>>(RECENT, {})
  all[address.toLowerCase()] = id
  await save(RECENT, all)
}
