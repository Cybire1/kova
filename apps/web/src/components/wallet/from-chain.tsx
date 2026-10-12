'use client'

import { useEffect, useState } from 'react'
import { Art, Icon } from '@/components/brand'
import { ScreenHead } from './activity'
import { useWallet } from './provider'
import { QR } from './ui'

interface Sources {
  live: boolean
  network: 'mainnet' | 'testnet'
  arrives_as: string
  sources: { id: string; name: string; chains: string[]; send: string[] }[]
}

interface Deposit {
  tx_hash: string
  status: 'seen' | 'arrived' | 'failed'
  chain: string | null
  amount: string
}

const MARK: Record<string, string> = { evm: 'Ξ', sol: '◎', tron: 'T', btc: '₿' }
const CHAIN_NAMES: Record<string, string> = {
  eth: 'Ethereum',
  base: 'Base',
  arb: 'Arbitrum',
  bsc: 'BNB Chain',
  pol: 'Polygon',
  op: 'Optimism',
  avax: 'Avalanche',
  sol: 'Solana',
  tron: 'Tron',
  btc: 'Bitcoin',
}

async function get<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', ...init })
  const body = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? 'Kova didn’t answer. Try again.')
  return body
}

const listOf = (items: string[]) =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`

/**
 * Bringing money in from another chain, with Aurora Intents (NEAR Intents), as in the app: pick
 * where your money is, and Kova shows this wallet's own permanent address there. What lands
 * arrives here as dollars on Monad.
 */
export function FromChain() {
  const { profile } = useWallet()
  const [sources, setSources] = useState<Sources | null>(null)
  const [source, setSource] = useState('evm')
  const [addresses, setAddresses] = useState<Record<string, string>>({})
  const [deposits, setDeposits] = useState<Deposit[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const wallet = profile?.address

  useEffect(() => {
    if (!wallet) return
    void get<Sources>(`/api/wallet/${wallet}/deposit-sources`)
      .then(setSources)
      .catch((e) => setProblem(e.message))
  }, [wallet])

  const live = sources?.live ?? false
  const address = addresses[source]

  useEffect(() => {
    if (!wallet || !live || address) return
    let current = true
    setProblem(null)
    void get<{ address: string }>(`/api/wallet/${wallet}/deposit-address`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source }),
    })
      .then((made) => current && setAddresses((a) => ({ ...a, [source]: made.address })))
      .catch((e) => current && setProblem(e.message))
    return () => {
      current = false
    }
  }, [wallet, live, source, address])

  useEffect(() => {
    if (!wallet || !address) return
    let stopped = false
    const look = () =>
      void get<{ data: Deposit[] }>(
        `/api/wallet/${wallet}/deposits?address=${encodeURIComponent(address)}`,
      )
        .then((r) => !stopped && setDeposits(r.data))
        .catch(() => {})
    look()
    const timer = setInterval(look, 5000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [wallet, address])

  const chosen = sources?.sources.find((s) => s.id === source)

  return (
    <div className="w-screen">
      <ScreenHead title="From another chain" back="/wallet/add" />
      <p className="w-lead">
        Send from wherever your money is. It arrives here as dollars, with nothing to bridge and no
        gas to buy.
      </p>
      <div className="w-chains" role="tablist" aria-label="Where your money is">
        {(sources?.sources ?? []).map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={s.id === source}
            className={`w-chain w-chain-${s.id}`}
            onClick={() => {
              setSource(s.id)
              setDeposits([])
            }}
          >
            <span className="w-chain-disc" aria-hidden="true">
              {MARK[s.id]}
            </span>
            <span>{s.id === 'evm' ? 'EVM chains' : s.name}</span>
          </button>
        ))}
      </div>
      {chosen ? (
        <p className="w-fine">
          Send <strong>{chosen.send.join(', ')}</strong> on {listOf(chosen.chains)}.
        </p>
      ) : null}

      {sources && !live ? (
        <div className="w-empty w-empty-art w-chain-soon">
          <Art name="kovi-ride" size={104} className="w-bob" />
          <strong>Live on Monad mainnet</strong>
          <span>
            NEAR Intents moves real liquidity between chains, so this opens when Kova moves to
            mainnet. On testnet, use free test dollars.
          </span>
        </div>
      ) : null}

      {live && address ? (
        <div className="w-chain-card" key={source}>
          <QR value={address} size={176} label={`Your ${chosen?.name ?? ''} deposit address`} />
          <small>Your {source === 'evm' ? 'EVM' : chosen?.name} address</small>
          <code>{address}</code>
          <button
            type="button"
            className="pill pill-block"
            data-tone="ink"
            onClick={async () => {
              await navigator.clipboard.writeText(address).catch(() => {})
              setCopied(true)
              setTimeout(() => setCopied(false), 1600)
            }}
          >
            <span className="pill-label">{copied ? 'Copied' : 'Copy address'}</span>
            <span className="pill-cap">
              <Icon name={copied ? 'check' : 'copy'} size={18} />
            </span>
          </button>
          <p className="w-fine w-center">
            Yours to keep: reuse it any time. Arrives as {sources?.arrives_as} in about 1–3 minutes.
            Kova charges nothing; the swap costs a small route fee.
          </p>
        </div>
      ) : null}

      {live && !address && !problem ? (
        <p className="w-fine w-center">Making your address…</p>
      ) : null}
      {problem ? <p className="form-error">{problem}</p> : null}

      {deposits.length ? (
        <>
          <h2 className="w-section">Coming in</h2>
          <div className="w-list">
            {deposits.map((d) => (
              <div key={`${d.tx_hash}:${d.status}`} className="w-list-row">
                <span className={`w-chain-dot w-chain-dot-${d.status}`} aria-hidden="true" />
                <span className="w-list-text">
                  <strong>
                    {d.status === 'arrived'
                      ? `${d.amount} arrived`
                      : d.status === 'failed'
                        ? 'Didn’t go through'
                        : `${d.amount} on its way`}
                  </strong>
                  <small>
                    {d.status === 'arrived'
                      ? 'In your Kova wallet on Monad'
                      : `From ${CHAIN_NAMES[d.chain ?? ''] ?? d.chain ?? 'another chain'}, swapping to dollars`}
                  </small>
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
