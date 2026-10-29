'use client'

import {
  explorerTxUrl,
  STOCK_BLOCKED_COUNTRIES,
  STOCK_BUY_MAX,
  STOCK_BUY_MIN,
  STOCK_NOT_ADVICE,
  STOCK_QUOTE_SECONDS,
  STOCK_WARNINGS,
  type StockHolding,
  type StockQuote,
  shareOfDollars,
} from '@kova/monad'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Art, Icon } from '@/components/brand'
import { applyKey, formatUsd, groupTyped, type Key, toBase } from '@/lib/wallet/money'
import { formatPrice } from '@/lib/wallet/stocks'
import {
  attestStocks,
  buyStock,
  countryName,
  expiresAt,
  formatShares,
  quoteStock,
  STOCKS_NETWORK,
  type StockAccess,
  sellStock,
  sharesToUnits,
  type Traded,
  type TradeQuote,
  type TradeSide,
  unitsToTyped,
} from '@/lib/wallet/stocks-trade'
import '@/styles/stock-trade.css'
import { useWallet } from './provider'
import { Fact, Fit } from './send'
import { Keypad } from './ui'

/**
 * Buying and selling a stock: one sheet over the stock, in the steps docs/stocks-trading.md sets.
 * Where you are decides first (a blocked country says why, and nothing more); then a one-time
 * confirmation the wallet signs; then the amount, the live quote with the least it gets and its
 * 60-second hold, the plain warnings and what Kova is; then the passkey, and the shares in your
 * wallet with a link to the transaction on Monad.
 */

type Step = 'blocked' | 'confirm' | 'amount' | 'review' | 'done'

const firstStep = (access: StockAccess): Step =>
  !access.allowed ? 'blocked' : !access.attested ? 'confirm' : 'amount'

const BUY_CHIPS = [10_000_000n, 50_000_000n, 100_000_000n] as const
const SELL_PARTS = [
  ['25%', 4n],
  ['50%', 2n],
] as const

const problemOf = (e: unknown) =>
  e instanceof Error ? e.message : 'Something went wrong. Try again.'

const Logo = ({ src, size }: { src: string; size: number }) => (
  // biome-ignore lint/performance/noImgElement: xStocks' logos are small PNGs from their own CDN.
  <img className="tr-logo" src={src} width={size} height={size} alt="" loading="lazy" />
)

export function TradeSheet({
  stock,
  side,
  held,
  access,
  onAccess,
  onClose,
}: {
  stock: StockQuote
  side: TradeSide
  held: StockHolding | undefined
  access: StockAccess
  onAccess: (access: StockAccess) => void
  onClose: () => void
}) {
  const { profile, balance, signMessage, signingAccount, refresh } = useWallet()
  const [step, setStep] = useState<Step>(() => firstStep(access))
  const [back, setBack] = useState(false)
  const [closing, setClosing] = useState(false)
  const [typed, setTyped] = useState('')
  /** Shares picked with a chip, exactly (All is every last unit); typing clears it. */
  const [picked, setPicked] = useState<bigint | null>(null)
  const [quote, setQuote] = useState<TradeQuote | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<(Traded & { paid: bigint }) | null>(null)
  const buying = side === 'buy'
  const owned = held ? BigInt(held.balance) : 0n
  const address = profile?.address

  const close = useCallback(() => {
    setClosing(true)
    setTimeout(onClose, 240)
  }, [onClose])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && close()
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [busy, close])

  const moveTo = (next: Step, backwards = false) => {
    setBack(backwards)
    setProblem(null)
    setStep(next)
  }

  // --- The amount ---
  const amount = buying
    ? (() => {
        try {
          return typed && Number(typed) > 0 ? toBase(Number(typed).toFixed(2)) : 0n
        } catch {
          return 0n
        }
      })()
    : (picked ?? sharesToUnits(typed))
  const most = buying ? (balance ?? 0n) : owned
  const over = amount > most
  const tooBig = buying && amount > STOCK_BUY_MAX
  const tooSmall = buying && amount > 0n && amount < STOCK_BUY_MIN
  const price = stock.price
  const onKey = useCallback(
    (key: Key) => {
      setPicked(null)
      setTyped((v) => applyKey(v, key, buying ? 2 : 6))
    },
    [buying],
  )

  // --- The quote, held 60 seconds and asked again when it lapses ---
  const ask = useCallback(async () => {
    if (!address || amount === 0n) return
    setQuoting(true)
    setProblem(null)
    try {
      setQuote(await quoteStock(address, side, stock.symbol, amount))
    } catch (e) {
      setProblem(problemOf(e))
    } finally {
      setQuoting(false)
    }
  }, [address, amount, side, stock.symbol])

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (step !== 'review') return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [step])
  const left = quote ? Math.max(0, expiresAt(quote) - now) : 0
  const lapsed = quote !== null && left === 0
  const asking = useRef(false)
  useEffect(() => {
    if (step !== 'review' || !lapsed || busy || quoting || asking.current) return
    asking.current = true
    void ask().finally(() => {
      asking.current = false
    })
  }, [step, lapsed, busy, quoting, ask])

  const review = () => {
    setQuote(null)
    moveTo('review')
    void ask()
  }

  // --- Signing ---
  const [agreed, setAgreed] = useState(false)
  const attest = async () => {
    if (!address) return
    setBusy(true)
    setProblem(null)
    try {
      await attestStocks(address, access.attestation, signMessage)
      onAccess({ ...access, attested: true })
      moveTo('amount')
    } catch (e) {
      setProblem(problemOf(e))
    } finally {
      setBusy(false)
    }
  }

  const trade = async () => {
    if (!quote || lapsed) return
    setBusy(true)
    setProblem(null)
    try {
      const value = buying ? BigInt(quote.amount_in) : BigInt(quote.amount_out)
      const account = await signingAccount(value)
      const traded = buying ? await buyStock(account, quote) : await sellStock(account, quote)
      setDone({ ...traded, paid: BigInt(quote.amount_in) })
      moveTo('done')
      void refresh()
    } catch (e) {
      setProblem(problemOf(e))
    } finally {
      setBusy(false)
    }
  }

  const title = `${buying ? 'Buy' : 'Sell'} ${stock.name}`
  const sub = buying
    ? `From your dollars · ${balance === null ? '—' : formatUsd(balance)}`
    : `You own ${formatShares(owned)} ${stock.symbol}`

  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        className={`w-sheet-scrim${closing ? ' w-sheet-out' : ''}`}
        onClick={() => !busy && close()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-sheet tr-sheet${closing ? ' w-sheet-out' : ''}`}
      >
        <button type="button" className="w-sheet-grab" aria-label="Close" onClick={close} />
        <Fit>
          <div key={step} className={`w-step${back ? ' w-step-back' : ''}`}>
            {step !== 'done' ? (
              <div className="tr-head">
                {step === 'review' ? (
                  <button
                    type="button"
                    className="round"
                    aria-label="Change the amount"
                    disabled={busy}
                    onClick={() => moveTo('amount', true)}
                  >
                    <Icon name="back" size={18} />
                  </button>
                ) : null}
                <Logo src={stock.logo} size={44} />
                <span className="w-sheet-who">
                  <strong>
                    {step === 'review' ? (buying ? 'Check and buy' : 'Check and sell') : title}
                  </strong>
                  <small>{step === 'review' ? title : sub}</small>
                </span>
              </div>
            ) : null}

            {step === 'blocked' ? <Blocked access={access} onClose={close} /> : null}

            {step === 'confirm' ? (
              <div className="tr-confirm">
                <p className="tr-eyebrow">Once, before your first stock</p>
                <h2 className="tr-h">Confirm this is you</h2>
                <p className="tr-lead">
                  Stock tokens come with rules. Read this, then sign it with your wallet. Signing
                  moves no money.
                </p>
                <Letter text={access.attestation} />
                <label className="tr-check">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                  />
                  <span className="tr-box" aria-hidden="true">
                    <Icon name="check" size={16} />
                  </span>
                  <span>This is true for me</span>
                </label>
                {problem ? <Problem text={problem} /> : null}
                <button
                  type="button"
                  className="pill pill-block"
                  data-tone="ink"
                  disabled={!agreed || busy}
                  onClick={() => void attest()}
                >
                  <span className="pill-label">{busy ? 'Signing…' : 'Sign with passkey'}</span>
                  <span className="pill-cap">
                    <Icon name="face" size={18} />
                  </span>
                </button>
                <p className="tr-fine">
                  Kova keeps your signature with the country you’re in. You sign again only if that
                  changes.
                </p>
              </div>
            ) : null}

            {step === 'amount' ? (
              <div className="tr-amount">
                <p className="w-typed" aria-live="polite">
                  {buying ? <span className="w-typed-sign">$</span> : null}
                  {picked !== null ? unitsToTyped(picked) : groupTyped(typed)}
                  {buying ? null : <span className="tr-typed-unit">{stock.symbol}</span>}
                </p>
                <p className="tr-about">
                  {amount === 0n || price === null
                    ? buying
                      ? 'Up to $1,000 a buy'
                      : `${formatShares(owned)} ${stock.symbol} in your wallet`
                    : buying
                      ? `About ${shareOfDollars(Number(amount) / 1e6, price)}`
                      : `About ${formatPrice((Number(amount) / 1e18) * price)}`}
                </p>
                <fieldset className="tr-chips">
                  <legend className="w-st-sr">{buying ? 'Amount' : 'How much to sell'}</legend>
                  {buying
                    ? BUY_CHIPS.map((v) => (
                        <button
                          key={String(v)}
                          type="button"
                          aria-pressed={amount === v}
                          onClick={() => setTyped(String(Number(v) / 1e6))}
                        >
                          {formatUsd(v).replace('.00', '')}
                        </button>
                      ))
                    : [
                        ...SELL_PARTS.map(([label, part]) => (
                          <button
                            key={label}
                            type="button"
                            aria-pressed={picked !== null && picked === owned / part}
                            onClick={() => {
                              setPicked(owned / part)
                              setTyped('')
                            }}
                          >
                            {label}
                          </button>
                        )),
                        <button
                          key="all"
                          type="button"
                          aria-pressed={picked === owned}
                          onClick={() => {
                            setPicked(owned)
                            setTyped('')
                          }}
                        >
                          All
                        </button>,
                      ]}
                </fieldset>
                <Keypad onKey={onKey} decimals={buying ? 2 : 6} />
                <button
                  type="button"
                  className="pill pill-block"
                  data-tone="ink"
                  disabled={amount === 0n || over || tooBig || tooSmall}
                  onClick={review}
                >
                  <span className="pill-label">
                    {tooBig
                      ? 'At most $1,000 a buy'
                      : tooSmall
                        ? 'At least $1'
                        : over
                          ? buying
                            ? 'More than you have'
                            : 'More than you own'
                          : 'See the price'}
                  </span>
                  <span className="pill-cap">
                    <Icon name="arrow" size={18} />
                  </span>
                </button>
              </div>
            ) : null}

            {step === 'review' ? (
              <div className="tr-review">
                <Ticket
                  quote={quote}
                  side={side}
                  symbol={stock.symbol}
                  left={left}
                  fresh={quoting}
                />
                {buying ? (
                  <section className="tr-warn" aria-labelledby="tr-warn-title">
                    <h3 id="tr-warn-title">Before you buy</h3>
                    <ul>
                      {STOCK_WARNINGS.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                <p className="tr-role">
                  <Icon name="info" size={16} />
                  <span>
                    {buying
                      ? STOCK_NOT_ADVICE
                      : `${STOCK_NOT_ADVICE.split('. ')[0]}. This swaps your ${stock.symbol} back for dollars on Monad.`}
                  </span>
                </p>
                {problem ? <Problem text={problem} unmoved /> : null}
                <button
                  type="button"
                  className="pill pill-block"
                  data-tone={buying ? 'coral' : 'ink'}
                  disabled={!quote || lapsed || quoting || busy}
                  onClick={() => void trade()}
                >
                  <span className="pill-label">
                    {busy
                      ? buying
                        ? 'Buying…'
                        : 'Selling…'
                      : quote
                        ? buying
                          ? `Buy ${formatUsd(BigInt(quote.amount_in))} of ${stock.name}`
                          : `Sell for about ${formatUsd(BigInt(quote.amount_out))}`
                        : 'Getting a price…'}
                  </span>
                  <span className="pill-cap">
                    <Icon name="face" size={18} />
                  </span>
                </button>
                <p className="tr-fine">
                  Your passkey approves it. If the price slips more than 1%, nothing happens and{' '}
                  {buying ? 'your dollars stay put' : 'your shares stay put'}.
                </p>
              </div>
            ) : null}

            {step === 'done' && done ? (
              <div className="w-sheet-sent tr-done">
                <div className="w-sheet-cheer">
                  <Art name="kovi-cheer" size={120} />
                  <Art name="sparkle-4" size={22} className="w-spark w-spark-1" />
                  <Art name="sparkle-8" size={26} className="w-spark w-spark-2" />
                  <Art name="sparkle-11" size={18} className="w-spark w-spark-3" />
                </div>
                <h2>{buying ? 'Bought' : 'Sold'}</h2>
                <p>
                  {buying
                    ? `${formatShares(done.received)} ${stock.symbol} is in your wallet.`
                    : `${formatUsd(done.received)} is in your balance.`}
                </p>
                <dl className="w-facts tr-receipt">
                  <Fact
                    label={buying ? 'You paid' : 'You sold'}
                    value={
                      buying ? formatUsd(done.paid) : `${formatShares(done.paid)} ${stock.symbol}`
                    }
                  />
                  <Fact
                    label="You got"
                    value={
                      buying
                        ? `${formatShares(done.received)} ${stock.symbol}`
                        : formatUsd(done.received)
                    }
                    icon="bolt"
                  />
                  <Fact label="Fee" value="$0.00, Kova covers it" />
                </dl>
                <button type="button" className="pill pill-block" data-tone="ink" onClick={close}>
                  <span className="pill-label">Done</span>
                  <span className="pill-cap">
                    <Icon name="check" size={18} />
                  </span>
                </button>
                <a
                  className="textlink tr-proof"
                  href={explorerTxUrl(STOCKS_NETWORK, done.tx_hash)}
                  target="_blank"
                  rel="noreferrer"
                >
                  See it on Monad <Icon name="external" size={13} />
                </a>
              </div>
            ) : null}
          </div>
        </Fit>
      </div>
    </>
  )
}

/** Where you are blocks it: said calmly, with why, and nothing to press but Close. */
function Blocked({ access, onClose }: { access: StockAccess; onClose: () => void }) {
  const code = access.country?.toUpperCase() ?? ''
  const where = STOCK_BLOCKED_COUNTRIES[code] ?? countryName(access.country)
  return (
    <div className="tr-blocked">
      <span className="tr-globe" aria-hidden="true">
        <Icon name="globe" size={30} />
      </span>
      {where ? (
        <span className="tr-where">
          <Icon name="globe" size={13} /> You’re in {where}
        </span>
      ) : null}
      <h2 className="tr-h">Not available in your country</h2>
      <p className="tr-lead">{access.reason ?? 'Stock tokens aren’t available where you are.'}</p>
      <dl className="w-facts">
        <Fact
          label="Why"
          value="The issuer’s rules"
          hint="Backed, which issues xStocks, doesn’t offer them here"
        />
        <Fact label="Your dollars" value="Untouched" hint="Nothing was signed or moved" />
      </dl>
      <button type="button" className="pill pill-block" data-tone="ink" onClick={onClose}>
        <span className="pill-label">Close</span>
        <span className="pill-cap">
          <Icon name="close" size={18} />
        </span>
      </button>
    </div>
  )
}

/** The text to sign, set like a letter: its title, what you confirm, and whose wallet, when. */
function Letter({ text }: { text: string }) {
  const lines = text.split('\n').filter(Boolean)
  const meta = lines.filter((l) => /^(Wallet|Date):/.test(l))
  const [head, ...body] = lines.filter((l) => !/^(Wallet|Date):/.test(l))
  return (
    <figure className="tr-letter" aria-label="What you sign">
      <span className="tr-letter-stamp" aria-hidden="true">
        Sign once
      </span>
      {head ? <strong>{head}</strong> : null}
      {body.map((l) => (
        <p key={l}>{l}</p>
      ))}
      {meta.length ? (
        <dl>
          {meta.map((l) => {
            const [k, ...v] = l.split(':')
            return (
              <div key={l}>
                <dt>{k}</dt>
                <dd>{v.join(':').trim()}</dd>
              </div>
            )
          })}
        </dl>
      ) : null}
    </figure>
  )
}

/** The live quote, as a ticket: what you get, the least you get, and how long the price holds. */
function Ticket({
  quote,
  side,
  symbol,
  left,
  fresh,
}: {
  quote: TradeQuote | null
  side: TradeSide
  symbol: string
  left: number
  fresh: boolean
}) {
  if (!quote)
    return (
      <div className="tr-ticket tr-ticket-ghost" aria-busy="true">
        <span>Getting a live price…</span>
      </div>
    )
  const buying = side === 'buy'
  const out = BigInt(quote.amount_out)
  const least = BigInt(quote.min_out)
  const seconds = Math.ceil(left / 1000)
  const price = Number(quote.price)
  return (
    <section className="tr-ticket" data-fresh={fresh} aria-label="Your price">
      <div className="tr-ticket-top">
        <span className="tr-ticket-get">
          <small>You get about</small>
          <strong>
            {buying ? formatShares(out) : formatUsd(out)}
            {buying ? <span> {symbol}</span> : null}
          </strong>
          <span className="tr-least">
            at least {buying ? `${formatShares(least)} ${symbol}` : formatUsd(least)}
          </span>
        </span>
        <Countdown left={left} fresh={fresh} />
      </div>
      <div className="tr-ticket-tear" aria-hidden="true" />
      <dl className="tr-ticket-rows">
        <div className="tr-row">
          <dt>{buying ? 'You pay' : 'You sell'}</dt>
          <dd>
            {buying
              ? formatUsd(BigInt(quote.amount_in))
              : `${formatShares(BigInt(quote.amount_in))} ${symbol}`}
          </dd>
        </div>
        <div className="tr-row">
          <dt>Price</dt>
          <dd>{Number.isFinite(price) && price > 0 ? `${formatPrice(price)} a share` : '—'}</dd>
        </div>
        <div className="tr-row">
          <dt>Fee</dt>
          <dd>$0.00, Kova covers it</dd>
        </div>
      </dl>
      <p className="tr-ticket-note" aria-live="polite">
        {fresh
          ? 'Getting a fresh price…'
          : seconds > 0
            ? `Price held for ${seconds} s`
            : 'Price lapsed'}
      </p>
    </section>
  )
}

/** A ring that empties over the quote's 60 seconds. */
function Countdown({ left, fresh }: { left: number; fresh: boolean }) {
  const size = 56
  const r = 23
  const c = 2 * Math.PI * r
  const part = Math.min(1, left / (STOCK_QUOTE_SECONDS * 1000))
  const seconds = Math.ceil(left / 1000)
  return (
    <span
      className="tr-clock"
      data-low={seconds <= 10}
      role="timer"
      aria-label={`${seconds} seconds left on this price`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} className="tr-clock-track" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="tr-clock-fill"
          strokeDasharray={`${part * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="tr-clock-n">{fresh ? <span className="tr-spin" /> : seconds}</span>
    </span>
  )
}

/** A problem in plain words; after a trade that didn't go, also that nothing moved. */
function Problem({ text, unmoved }: { text: string; unmoved?: boolean }) {
  return (
    <p className="w-sheet-problem" role="alert">
      <Icon name="info" size={16} />
      <span>
        {text}
        {unmoved && !/went through|nothing was signed|hasn’t moved/i.test(text)
          ? ' Your money hasn’t moved.'
          : ''}
      </span>
    </p>
  )
}
