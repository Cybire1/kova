'use client'

import {
  CHART_RANGES,
  type ChartRange,
  type MarketPeriod,
  marketLabel,
  ringFill,
  type StockHolding,
  type StockQuote,
  shareLabel,
  shareOfDollars,
} from '@kova/monad'
import Link from 'next/link'
import { useEffect, useId, useState } from 'react'
import { Art, Icon } from '@/components/brand'
import {
  formatPrice,
  useHoldings,
  useStock,
  useStockAlert,
  useStockChart,
  useStockList,
} from '@/lib/wallet/stocks'
import { type TradeSide, useStockAccess } from '@/lib/wallet/stocks-trade'
import { ScreenHead } from './activity'
import { useWallet } from './provider'
import { TradeSheet } from './stock-trade'

/**
 * Stocks: xStocks on Monad, each token backed 1:1 by a share. Kova shows live prices and what you
 * own, and counts none of it in your dollars: stocks aren't money you can spend. Buying and selling
 * open where Kova's API says they're live (components/wallet/stock-trade.tsx); until then Buy says
 * "coming soon" and offers to tell you the day it opens.
 */

const TONES = ['coral', 'teal'] as const

const Logo = ({ src, size }: { src: string; size: number }) => (
  // biome-ignore lint/performance/noImgElement: xStocks' logos are small PNGs from their own CDN.
  <img className="w-st-logo" src={src} width={size} height={size} alt="" loading="lazy" />
)

/** How much of a share you own: the part past the last whole share, filled clockwise from the top. */
function Ring({
  shares,
  size,
  stroke,
  track,
  fill,
  children,
  label,
}: {
  shares: number
  size: number
  stroke: number
  track: string
  fill: string
  children?: React.ReactNode
  label: string
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const part = Math.max(ringFill(shares), 0.02)
  return (
    <span className="w-st-ring" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={fill}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${part * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {children ? <span className="w-st-ring-in">{children}</span> : null}
    </span>
  )
}

function MarketPill({ period, halted }: { period: MarketPeriod; halted: boolean }) {
  const open = !halted && period !== 'closed'
  return (
    <span className="w-st-pill" data-open={open}>
      <span className="w-st-pill-dot" />
      {marketLabel(period, halted)}
    </span>
  )
}

const money = (value: number | null, hide: boolean) =>
  hide ? '••••' : value === null ? '—' : formatPrice(value)

// --- Home ------------------------------------------------------------------------------------

/** Stocks on Home: what you own, or the way in when you own none. */
export function StocksCard() {
  const { profile, hideBalance } = useWallet()
  const { holdings } = useHoldings(profile?.address)
  const owned = holdings?.data ?? []
  if (owned.length === 0)
    return (
      <Link href="/wallet/stocks" className="w-st-invite">
        <span className="w-st-invite-logos" aria-hidden="true">
          {['TSLAx', 'NVDAx', 'AAPLx'].map((s) => (
            <Logo
              key={s}
              src={`https://xstocks-metadata.backed.fi/logos/tokens/${s}.png`}
              size={30}
            />
          ))}
        </span>
        <span className="w-st-invite-text">
          <strong>Stocks</strong>
          <small>Tesla, Nvidia, the S&amp;P 500… live prices</small>
        </span>
        <span className="w-shopcard-go">
          <Icon name="arrow" size={18} />
        </span>
      </Link>
    )
  return (
    <Link href="/wallet/stocks" className="w-st-home">
      <span className="w-st-home-top">
        <span>
          <small>Your stocks</small>
          <strong>{money(holdings?.total ?? null, hideBalance)}</strong>
        </span>
        <span className="w-shopcard-go">
          <Icon name="arrow" size={18} />
        </span>
      </span>
      <span className="w-st-home-tiles">
        {owned.slice(0, 2).map((h, i) => (
          <span key={h.symbol} className="w-st-home-tile">
            <Ring
              shares={h.shares}
              size={44}
              stroke={5}
              track="rgba(11,26,29,0.12)"
              fill={i % 2 ? 'var(--teal-deep)' : 'var(--coral)'}
              label={`${shareLabel(h.shares)} of ${h.name}`}
            >
              <Logo src={h.logo} size={26} />
            </Ring>
            <span className="w-st-home-tile-text">
              <strong>{h.name}</strong>
              <small>{shareLabel(h.shares)}</small>
            </span>
          </span>
        ))}
      </span>
    </Link>
  )
}

// --- Stocks ----------------------------------------------------------------------------------

export function Stocks() {
  const { profile, hideBalance } = useWallet()
  const { holdings, failed: holdingsFailed } = useHoldings(profile?.address)
  const [query, setQuery] = useState('')
  const { stocks, failed, searching } = useStockList(query)
  const market = stocks?.[0]
  const owned = holdings?.data ?? []

  return (
    <div className="w-screen w-st">
      <ScreenHead title="Stocks">
        {market ? <MarketPill period={market.period} halted={false} /> : null}
      </ScreenHead>

      <section className="w-st-mine" aria-label="Your stocks">
        <Art name="kovi-peek" size={88} className="w-st-peek" />
        <small>Your stocks</small>
        <strong className="w-st-total">
          {holdings ? money(holdings.total, hideBalance) : holdingsFailed ? '—' : '…'}
        </strong>
        <span className="w-st-mine-note">
          {owned.length > 0
            ? 'In your wallet. Not part of your dollars.'
            : holdingsFailed
              ? 'Couldn’t read your stocks just now.'
              : 'You don’t own any stocks yet. Pick one below to see it live.'}
        </span>
        {owned.length > 0 ? (
          <div className="w-st-tiles">
            {owned.slice(0, 4).map((h, i) => (
              <HoldingTile
                key={h.symbol}
                holding={h}
                tone={TONES[i % 2] ?? 'coral'}
                hide={hideBalance}
              />
            ))}
          </div>
        ) : null}
      </section>

      <label className="w-st-search">
        <Icon name="search" size={18} />
        <span className="w-st-sr">Search stocks</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Tesla, Nvidia, S&P 500…"
          autoComplete="off"
          spellCheck={false}
        />
        {query ? (
          <button
            type="button"
            className="w-st-clear"
            aria-label="Clear search"
            onClick={() => setQuery('')}
          >
            <Icon name="close" size={14} />
          </button>
        ) : null}
      </label>

      <div className="w-section-row">
        <h2 className="w-section">{query.trim() ? 'Results' : 'Popular'}</h2>
        <span className="w-st-source">
          {market?.period === 'closed' ? 'Market closed: last prices' : 'Live from xStocks'}
        </span>
      </div>

      {stocks === null ? (
        failed ? (
          <p className="w-quiet">Stock prices are unreachable right now. Try again in a moment.</p>
        ) : (
          <div className="w-st-list" aria-busy="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className="w-st-row w-st-row-ghost" />
            ))}
          </div>
        )
      ) : stocks.length === 0 && !searching ? (
        <p className="w-quiet">No stock matches “{query.trim()}”.</p>
      ) : (
        <div className="w-st-list" aria-busy={searching}>
          {stocks.map((s) => (
            <StockRow key={s.symbol} stock={s} />
          ))}
        </div>
      )}
    </div>
  )
}

function HoldingTile({
  holding,
  tone,
  hide,
}: {
  holding: StockHolding
  tone: 'coral' | 'teal'
  hide: boolean
}) {
  return (
    <Link href={`/wallet/stocks/${holding.symbol}`} className="w-st-tile" data-tone={tone}>
      <span className="w-st-tile-top">
        <span className="w-st-tile-name">
          <Logo src={holding.logo} size={28} />
          <strong>{holding.name}</strong>
        </span>
        <Ring
          shares={holding.shares}
          size={34}
          stroke={6}
          track="rgba(255,255,255,0.28)"
          fill="#fff"
          label={shareLabel(holding.shares)}
        />
      </span>
      <span className="w-st-tile-value">{money(holding.value, hide)}</span>
      <small>{shareLabel(holding.shares)}</small>
    </Link>
  )
}

function StockRow({ stock }: { stock: StockQuote }) {
  return (
    <Link href={`/wallet/stocks/${stock.symbol}`} className="w-st-row">
      <Logo src={stock.logo} size={42} />
      <span className="w-st-row-text">
        <strong>{stock.name}</strong>
        <small>
          {stock.ticker}
          {stock.exchange ? ` · ${stock.exchange}` : ''}
        </small>
      </span>
      <strong className="w-st-row-price">
        {stock.price === null ? '—' : formatPrice(stock.price)}
      </strong>
    </Link>
  )
}

// --- One stock -------------------------------------------------------------------------------

export function StockDetail({ symbol }: { symbol: string }) {
  const { profile, hideBalance } = useWallet()
  const { stock, failed } = useStock(symbol)
  const { holdings } = useHoldings(profile?.address)
  const [range, setRange] = useState<ChartRange>('1W')
  const [buying, setBuying] = useState(false)
  const { access, failed: accessFailed, setAccess } = useStockAccess(profile?.address)
  const [trading, setTrading] = useState<TradeSide | null>(null)

  if (!stock)
    return (
      <div className="w-screen w-st">
        <ScreenHead title={failed ? 'Stock' : ''} back="/wallet/stocks" />
        {failed ? (
          <p className="w-quiet">Kova couldn’t find that stock, or prices are unreachable.</p>
        ) : (
          <div className="w-st-detail-ghost" aria-busy="true" />
        )}
      </div>
    )

  const held = holdings?.data.find((h) => h.symbol === stock.symbol)
  const [whole, cents] = (stock.price === null ? '—' : formatPrice(stock.price)).split('.')

  return (
    <div className="w-screen w-st">
      <div className="w-head w-st-head">
        <Link href="/wallet/stocks" className="round" aria-label="Back to stocks">
          <Icon name="back" size={18} />
        </Link>
        <Logo src={stock.logo} size={44} />
        <span className="w-st-head-text">
          <h1>{stock.name}</h1>
          <small>
            {stock.symbol}
            {stock.exchange ? ` · ${stock.exchange}` : ''}
          </small>
        </span>
      </div>

      <div className="w-st-price">
        <p>
          <span className="w-st-price-big">{whole}</span>
          {cents ? <span className="w-st-price-cents">.{cents}</span> : null}
        </p>
        <span className="w-st-price-side">
          <MarketPill period={stock.period} halted={stock.halted} />
          <small>a share, from xStocks</small>
        </span>
      </div>

      <Chart symbol={stock.symbol} name={stock.name} range={range} onRange={setRange} />

      {held ? (
        <section className="w-st-own" aria-label="You own">
          <Ring
            shares={held.shares}
            size={104}
            stroke={14}
            track="#24363a"
            fill="var(--coral)"
            label={`You own ${shareLabel(held.shares)}`}
          >
            <span className="w-st-own-ring">
              <strong>{shareLabel(held.shares).split(' ')[0]}</strong>
              <small>
                {held.shares >= 1 ? (held.shares === 1 ? 'share' : 'shares') : 'of a share'}
              </small>
            </span>
          </Ring>
          <span className="w-st-own-text">
            <small>You own</small>
            <strong>{money(held.value, hideBalance)}</strong>
            <small>
              {held.shares} {stock.symbol}, in your wallet
            </small>
          </span>
        </section>
      ) : null}

      <div className="w-st-facts">
        <span>
          <small>Backed by</small>
          <strong>{stock.ticker} shares, 1:1</strong>
        </span>
        <span>
          <small>Trades</small>
          <strong>24 hours, 5 days</strong>
        </span>
      </div>

      {access?.live && stock.tradable === false ? (
        <p className="w-fine w-st-untradable">
          {stock.name} can’t be bought on Monad yet: no market there carries it. Its price is shown
          here for reference.
        </p>
      ) : access?.live ? (
        <div className="tr-actions">
          <button
            type="button"
            className="pill pill-block"
            data-tone="coral"
            onClick={() => setTrading('buy')}
          >
            <span className="pill-label">{held ? 'Buy' : `Buy ${stock.name}`}</span>
            <span className="pill-cap">
              <Icon name="plus" size={18} />
            </span>
          </button>
          {held ? (
            <button
              type="button"
              className="pill pill-block"
              data-tone="light"
              onClick={() => setTrading('sell')}
            >
              <span className="pill-label">Sell</span>
              <span className="pill-cap">
                <Icon name="minus" size={18} />
              </span>
            </button>
          ) : null}
        </div>
      ) : profile && !access && !accessFailed ? (
        <span className="tr-actions-ghost" aria-hidden="true" />
      ) : (
        <button type="button" className="w-st-buy" onClick={() => setBuying(true)}>
          Buy {stock.name}
          <span className="w-st-sticker">Coming soon</span>
        </button>
      )}

      {buying ? <BuySheet stock={stock} onClose={() => setBuying(false)} /> : null}
      {trading && access ? (
        <TradeSheet
          stock={stock}
          side={trading}
          held={held}
          access={access}
          onAccess={setAccess}
          onClose={() => setTrading(null)}
        />
      ) : null}
    </div>
  )
}

function Chart({
  symbol,
  name,
  range,
  onRange,
}: {
  symbol: string
  name: string
  range: ChartRange
  onRange: (range: ChartRange) => void
}) {
  const { chart, failed } = useStockChart(symbol, range)
  const gradient = useId()
  const points = chart?.points ?? []
  const W = 330
  const H = 128
  let line = ''
  let end: [number, number] | null = null
  let change: number | null = null
  const first = points[0]
  const last = points[points.length - 1]
  if (first && last && points.length >= 2) {
    const prices = points.map((p) => p[1])
    const lo = Math.min(...prices)
    const hi = Math.max(...prices)
    const [t0, p0] = first
    const [t1, p1] = last
    const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * W
    const y = (p: number) => 10 + (1 - (p - lo) / (hi - lo || 1)) * (H - 20)
    line = points
      .map(([t, p], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)} ${y(p).toFixed(1)}`)
      .join(' ')
    end = [x(t1), y(p1)]
    change = (p1 - p0) / p0
  }
  const up = change === null || change >= 0
  const label = { '1D': 'today', '1W': 'this week', '1M': 'this month', '1Y': 'this year' }[range]

  return (
    <section className="w-st-chart" aria-label={`${name} price ${label}`}>
      <div className="w-st-chart-change" data-up={up}>
        {change === null ? (
          <span>&nbsp;</span>
        ) : (
          <>
            <strong>
              {up ? '+' : '−'}
              {Math.abs(change * 100).toFixed(2)}%
            </strong>
            <span>{label}</span>
          </>
        )}
      </div>
      {line && end ? (
        <div className="w-st-chart-plot">
          <svg
            width="100%"
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`${name} price ${label}, ${up ? 'up' : 'down'} ${Math.abs((change ?? 0) * 100).toFixed(2)}%`}
          >
            <defs>
              <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={up ? '#46878b' : '#d46558'} stopOpacity="0.3" />
                <stop offset="1" stopColor={up ? '#46878b' : '#d46558'} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`${line} L${W} ${H} L0 ${H} Z`} fill={`url(#${gradient})`} />
            <path
              d={line}
              fill="none"
              stroke={up ? 'var(--teal-deep)' : 'var(--coral-deep)'}
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <span
            className="w-st-chart-dot"
            data-up={up}
            style={{ left: `${(end[0] / W) * 100}%`, top: `${end[1]}px` }}
          />
        </div>
      ) : (
        <div className="w-st-chart-empty">
          {chart || failed ? 'No chart for this one right now' : ''}
        </div>
      )}
      <fieldset className="w-st-ranges">
        <legend className="w-st-sr">Chart range</legend>
        {CHART_RANGES.map((r) => (
          <button key={r} type="button" aria-pressed={r === range} onClick={() => onRange(r)}>
            {r}
          </button>
        ))}
      </fieldset>
    </section>
  )
}

// --- Buy -------------------------------------------------------------------------------------

const AMOUNTS = [1, 2, 5] as const

function BuySheet({ stock, onClose }: { stock: StockQuote; onClose: () => void }) {
  const { profile } = useWallet()
  const [amount, setAmount] = useState<number>(5)
  const [closing, setClosing] = useState(false)
  const alert = useStockAlert(profile?.address, stock.symbol)
  const close = () => {
    setClosing(true)
    setTimeout(onClose, 240)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        className={`w-sheet-scrim${closing ? ' w-sheet-out' : ''}`}
        onClick={close}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="w-st-buy-title"
        className={`w-sheet w-st-sheet${closing ? ' w-sheet-out' : ''}`}
      >
        <button type="button" className="w-sheet-grab" aria-label="Close" onClick={close} />
        <Art name="kovi-peek" size={84} className="w-st-sheet-peek" />
        <div className="w-sheet-top w-st-sheet-top">
          <Logo src={stock.logo} size={44} />
          <span className="w-sheet-who">
            <strong id="w-st-buy-title">Buy {stock.name}</strong>
            <small>From your dollars</small>
          </span>
        </div>

        <p className="w-st-amount">
          <span className="w-typed-sign">$</span>
          {amount}
        </p>
        <p className="w-st-amount-share">
          {stock.price ? `That’s ${shareOfDollars(amount, stock.price)}` : 'Price unavailable'}
        </p>

        <fieldset className="w-st-chips">
          <legend className="w-st-sr">Amount</legend>
          {AMOUNTS.map((n) => (
            <button key={n} type="button" aria-pressed={amount === n} onClick={() => setAmount(n)}>
              ${n}
            </button>
          ))}
        </fieldset>

        <dl className="w-st-terms">
          <div>
            <dt>Fee</dt>
            <dd>Set by our partner</dd>
          </div>
          <div>
            <dt>Lands in</dt>
            <dd>About a second</dd>
          </div>
        </dl>

        <div className="w-st-locked">
          <button type="button" disabled aria-describedby="w-st-soon">
            <span className="w-st-locked-cap">
              <Icon name="arrow" size={20} />
            </span>
            Buy {stock.name}
          </button>
          <span id="w-st-soon" className="w-st-sticker">
            Coming soon
          </span>
        </div>

        {alert.asked ? (
          <p className="w-st-told" role="status">
            <Icon name="check" size={18} />
            We’ll tell you here the day it opens
          </p>
        ) : (
          <button
            type="button"
            className="w-st-tell"
            disabled={alert.busy || alert.asked === null || !profile}
            onClick={() => void alert.ask()}
          >
            {alert.busy ? 'One moment…' : 'Tell me when I can buy'}
          </button>
        )}
        {alert.problem ? (
          <p className="w-st-problem" role="alert">
            {alert.problem}
          </p>
        ) : null}

        <p className="w-st-fine">
          Stocks in Kova are xStocks: tokens backed 1:1 by shares. Not available in the US and some
          other countries. Prices move outside market hours.
        </p>
      </div>
    </>
  )
}
