'use client'

import type { ChainDepositActivity, ChainDepositQuote, ChainDepositSources } from '@kova/monad'
import { useEffect, useRef, useState } from 'react'
import { parseUnits } from 'viem'
import { Art, Icon } from '@/components/brand'
import { formatUsd } from '@/lib/wallet/money'
import { ScreenHead } from './activity'
import { useWallet } from './provider'
import { QR } from './ui'

async function get<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', ...init })
  const body = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? 'Kova didn’t answer. Try again.')
  return body
}

export function FromChain() {
  const { profile } = useWallet()
  return profile ? <DepositForm key={profile.address} wallet={profile.address} /> : null
}

function DepositForm({ wallet }: { wallet: string }) {
  const { refresh } = useWallet()
  const [sources, setSources] = useState<ChainDepositSources | null>(null)
  const [chainId, setChainId] = useState(143)
  const [tokenAddress, setTokenAddress] = useState('')
  const [amount, setAmount] = useState('')
  const [refund, setRefund] = useState('')
  const [quote, setQuote] = useState<ChainDepositQuote | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [trackingProblem, setTrackingProblem] = useState(false)
  const [deposits, setDeposits] = useState<ChainDepositActivity[]>([])
  const [copied, setCopied] = useState(false)
  const [retry, setRetry] = useState(0)
  const generation = useRef(0)
  const instructions = useRef<HTMLElement>(null)
  const arrived = useRef(new Set<string>())
  const chain = sources?.chains.find((c) => c.id === chainId) ?? sources?.chains[0]
  const token = chain?.tokens.find((t) => t.address === tokenAddress) ?? chain?.tokens[0]
  const refundTo = refund.trim() || (chain?.vm === 'evm' ? wallet : '')

  useEffect(() => {
    if (quote)
      instructions.current?.scrollIntoView?.({
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
        block: 'start',
      })
  }, [quote])

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry explicitly reloads the catalogue after a failed request.
  useEffect(() => {
    let active = true
    setProblem(null)
    void get<ChainDepositSources>(`/api/wallet/${wallet}/chain-deposit-sources`)
      .then((r) => {
        if (active) setSources(r)
      })
      .catch((e) => {
        if (active) setProblem(e.message)
      })
    return () => {
      active = false
      generation.current++
    }
  }, [wallet, retry])

  useEffect(() => {
    if (!sources?.tracking && !sources?.live) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const look = async () => {
      try {
        const r = await get<{ data: ChainDepositActivity[] }>(
          `/api/wallet/${wallet}/chain-deposits`,
        )
        if (!active) return
        setDeposits(r.data.filter((d) => d.deposit_tx || d.status !== 'waiting'))
        setTrackingProblem(false)
        for (const d of r.data)
          if (d.status === 'success' && !arrived.current.has(d.id)) {
            arrived.current.add(d.id)
            void refresh()
          }
      } catch {
        if (active) setTrackingProblem(true)
      }
      if (active) timer = setTimeout(look, 8000)
    }
    void look()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [wallet, sources?.live, sources?.tracking, refresh])

  const invalidate = () => {
    generation.current++
    setQuote(null)
    setProblem(null)
    setBusy(false)
    setCopied(false)
  }
  const preview = async () => {
    if (!chain || !token) return
    const current = ++generation.current
    setBusy(true)
    setProblem(null)
    setQuote(null)
    try {
      const made = await get<ChainDepositQuote>(`/api/wallet/${wallet}/chain-deposit-quote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chain_id: chain.id,
          token: token.address,
          amount,
          refund_to: refundTo,
        }),
      })
      if (current === generation.current) setQuote(made)
    } catch (e) {
      if (current === generation.current)
        setProblem(e instanceof Error ? e.message : 'Couldn’t get a deposit quote.')
    } finally {
      if (current === generation.current) setBusy(false)
    }
  }

  return (
    <div className="w-screen">
      <ScreenHead title="Deposit crypto" back="/wallet/add" />
      <div className="w-deposit-intro">
        <Art name="kovi-catch" size={80} />
        <div>
          <h1 className="w-title">Make it spendable.</h1>
          <p className="w-fine">Send crypto. Receive AUSD in your Kova balance.</p>
        </div>
      </div>
      {!sources && !problem ? (
        <p className="w-fine" role="status">
          Finding available networks…
        </p>
      ) : null}
      {sources && !sources.live ? <p className="w-lead">{sources.reason}</p> : null}
      {sources?.live && chain && token ? (
        <>
          <div className="w-naira-form w-deposit-form">
            <label className="w-naira-field">
              <span className="w-naira-label">From network</span>
              <select
                aria-label="From network"
                value={chain.id}
                onChange={(e) => {
                  invalidate()
                  setChainId(Number(e.target.value))
                  setTokenAddress('')
                  setRefund('')
                }}
              >
                {sources.chains.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.id === 143 ? ' · MON & more' : ''}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="w-deposit-tokens">
              <legend className="w-naira-label">Token</legend>
              <div>
                {chain.tokens.map((t) => (
                  <button
                    key={t.address}
                    type="button"
                    aria-pressed={token.address === t.address}
                    onClick={() => {
                      invalidate()
                      setTokenAddress(t.address)
                    }}
                  >
                    {t.symbol}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="w-naira-field">
              <span className="w-naira-label">Amount to send</span>
              <span className="w-naira-money">
                <input
                  aria-label="Amount to send"
                  inputMode="decimal"
                  placeholder="0.00"
                  maxLength={80}
                  value={amount}
                  onChange={(e) => {
                    const v = e.target.value
                    if (/^\d*(\.\d*)?$/.test(v)) {
                      invalidate()
                      setAmount(v)
                    }
                  }}
                />
                <span>{token.symbol}</span>
              </span>
            </label>
            {chain.vm === 'evm' ? (
              <details className="w-deposit-details">
                <summary>Refund & token details</summary>
                <label className="w-naira-field">
                  <span className="w-naira-label">Refund wallet on {chain.name}</span>
                  <input
                    aria-label="Refund address"
                    value={refund}
                    placeholder={wallet}
                    onChange={(e) => {
                      invalidate()
                      setRefund(e.target.value)
                    }}
                  />
                </label>
                <p className="w-fine">
                  Defaults to your Kova address. Refunds stay on {chain.name}. If sending from an
                  exchange, use a personal wallet address here.
                </p>
                <p className="w-fine w-deposit-contract">Token: {token.address}</p>
              </details>
            ) : (
              <label className="w-naira-field">
                <span className="w-naira-label">Your refund wallet on {chain.name}</span>
                <input
                  aria-label="Refund address"
                  value={refund}
                  placeholder={`Your ${chain.name} wallet address`}
                  onChange={(e) => {
                    invalidate()
                    setRefund(e.target.value)
                  }}
                />
                <span className="w-naira-help">
                  Use a wallet you control. If the conversion fails, funds return here, less network
                  costs.
                </span>
              </label>
            )}
          </div>
          <button
            type="button"
            className="pill pill-block"
            data-tone="ink"
            disabled={busy || !amount || !refundTo}
            onClick={() => void preview()}
          >
            <span className="pill-label">
              {busy ? 'Getting your estimate…' : quote ? 'Refresh estimate' : 'Preview deposit'}
            </span>
            <span className="pill-cap">
              <Icon name="arrow" size={18} />
            </span>
          </button>
        </>
      ) : null}
      {problem ? (
        <div role="alert">
          <p className="form-error">{problem}</p>
          {!sources ? (
            <button type="button" className="pill" onClick={() => setRetry((r) => r + 1)}>
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
      {quote ? (
        <section
          ref={instructions}
          className="w-chain-card"
          aria-label="Deposit instructions"
          aria-live="polite"
        >
          <small>You’ll receive approximately</small>
          <strong className="w-deposit-total">
            {formatUsd(parseUnits(quote.expected_ausd, 6))} <span>AUSD</span>
          </strong>
          <p className="w-fine w-center">
            From {quote.amount} {quote.token.symbol} on {quote.chain.name}
          </p>
          <dl className="w-review-card w-deposit-review">
            <div className="w-review-row">
              <dt>Route fee, included</dt>
              <dd>
                {quote.route_fee_usd === null
                  ? 'Included in estimate'
                  : formatUsd(parseUnits(quote.route_fee_usd, 6))}
              </dd>
            </div>
            <div className="w-review-row">
              <dt>Kova fee</dt>
              <dd>$0</dd>
            </div>
          </dl>
          <QR
            value={quote.address}
            size={176}
            label={`${quote.token.symbol} deposit address on ${quote.chain.name}`}
          />
          <strong>
            Send only {quote.token.symbol} on {quote.chain.name}
          </strong>
          <code>{quote.address}</code>
          <button
            type="button"
            className="pill pill-block"
            data-tone="ink"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(quote.address)
                setCopied(true)
              } catch {
                setProblem('Copy failed. Select the address above to copy it.')
              }
            }}
          >
            <span className="pill-label">{copied ? 'Address copied' : 'Copy deposit address'}</span>
            <span className="pill-cap">
              <Icon name={copied ? 'check' : 'copy'} size={18} />
            </span>
          </button>
          <p className="w-fine w-center">
            We’ll convert your deposit to AUSD automatically. This address is for{' '}
            {quote.token.symbol} on {quote.chain.name}; you can reuse it for that route. Prices and
            fees update when funds arrive. Very small deposits may not cover the route costs.
          </p>
          <details className="w-deposit-details">
            <summary>Conversion & refund details</summary>
            <p className="w-fine">
              At this quote: minimum {quote.minimum_ausd} AUSD with 0.5% swap slippage. This
              estimate changes with the market; your sending wallet or exchange also charges its own
              network fee.
            </p>
            <p className="w-fine w-deposit-contract">
              Refunds on {quote.chain.name}: {quote.refund_to}
            </p>
            <p className="w-fine">
              Deposits of $0.05 or less are not processed. Use the quoted amount. Conversions are
              handled by Relay.
            </p>
            <a href="https://relay.link/withdraw" target="_blank" rel="noreferrer">
              Get help recovering a deposit
            </a>
          </details>
        </section>
      ) : null}
      {trackingProblem ? (
        <p className="w-fine" role="status">
          Deposit tracking is reconnecting. You can keep this page open; your funds are processed
          independently.
        </p>
      ) : null}
      {deposits.length ? (
        <>
          <h2 className="w-section">Your deposits</h2>
          <div className="w-list">
            {deposits.map((d) => (
              <div key={d.id} className="w-list-row">
                <span
                  className={`w-chain-dot w-chain-dot-${d.status === 'success' ? 'arrived' : d.status === 'failure' ? 'failed' : 'seen'}`}
                />
                <span className="w-list-text">
                  <strong>
                    {d.status === 'success'
                      ? `${d.received_ausd ? `${d.received_ausd} AUSD ` : ''}Arrived`
                      : d.status === 'refund'
                        ? 'Refunded to your source wallet'
                        : d.status === 'failure'
                          ? 'Deposit needs attention'
                          : 'Deposit on its way'}
                  </strong>
                  <small>
                    {d.status === 'success'
                      ? 'Ready to spend in Kova'
                      : d.status === 'refund'
                        ? 'Refunds may take time to confirm'
                        : d.status === 'failure'
                          ? 'Use Relay recovery below'
                          : 'We’ll update your balance when it arrives'}
                  </small>
                </span>
                {d.status === 'success' && d.destination_tx ? (
                  <a
                    href={`https://monadvision.com/tx/${encodeURIComponent(d.destination_tx)}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="View deposit transaction"
                  >
                    <Icon name="arrow" size={18} />
                  </a>
                ) : null}
              </div>
            ))}
          </div>
          <p className="w-fine">
            <a href="https://relay.link/withdraw" target="_blank" rel="noreferrer">
              Deposit recovery
            </a>
          </p>
        </>
      ) : null}
    </div>
  )
}
