/**
 * The numbers flyer, landscape for X (1600 x 900, rendered at 1.5x): "Tap. Paid. 230 times on Monad."
 * The 0 of 230 is Kovi, cheering, drawn exactly in the zero's slot: the coin is the digit's height and
 * sits on its baseline. The brand line is the site's own hero ("Tap. Paid. Anywhere."), coin dots and
 * all; the other numbers stand in a column on the right.
 *
 * Every number is a prop read from the live API (`/v1/public/stats`) when the flyer is rendered. They
 * count wallets, not people: a wallet is anything that did something only Kova wallets do, our own
 * test runs included.
 */
import type React from 'react'
import { useEffect, useState } from 'react'
import { AbsoluteFill, continueRender, delayRender, Img, staticFile } from 'remotion'
import { Grain, Logo } from '../parts'
import { C, fontsReady } from '../theme'

const TEAL_DEEP = '#376b70'
const MUTED = '#566568'
const ui: React.CSSProperties = { fontFamily: 'Manrope', color: C.ink }

export interface LandscapeProps {
  payments: number
  wallets: number
  walletsThisWeek: number
  shops: number
  /** Test dollars paid, e.g. "1651.70". */
  volume: string
  asOf: string
}

// Manrope ExtraBold, in em: digit advances and the zero's ink box (from the font file).
const ADV = { '2': 0.604, '3': 0.591 } as const
const ZERO = { top: 0.735, bottom: -0.015 }
// Kovi cheering (kovi-cheer.png, 1024 px): the coin's box inside the art.
const COIN = { left: 235, top: 166, bottom: 701, width: 554 }

/** The site's coin dot, the full stop in "Tap. Paid. Anywhere." */
function Dot({ fill }: { fill: string }) {
  return <span style={{ display: 'inline-block', width: '0.2em', height: '0.2em', marginLeft: '0.05em', borderRadius: '50%', background: fill, boxShadow: `inset 0 0 0 0.042em ${C.ink}`, verticalAlign: '0.02em' }} />
}

/** Text whose baseline sits at y: Manrope's line box (line-height 1) puts the baseline 0.883em down. */
function At({ x, baseline, size, style, children }: { x: number; baseline: number; size: number; style?: React.CSSProperties; children: React.ReactNode }) {
  return <div style={{ ...ui, position: 'absolute', left: x, top: baseline - 0.883 * size, fontSize: size, lineHeight: 1, whiteSpace: 'nowrap', ...style }}>{children}</div>
}

function Stat({ value, label, color = C.ink, chip, size = 74 }: { value: string; label: string; color?: string; chip?: string; size?: number }) {
  return (
    <div style={{ ...ui, display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <span style={{ fontSize: size, fontWeight: 800, letterSpacing: '-0.045em', lineHeight: 1, color, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
        {chip ? <span style={{ fontSize: 21, fontWeight: 800, padding: '7px 14px', borderRadius: 999, background: C.coralSoft, boxShadow: `inset 0 0 0 2.5px ${C.ink}` }}>{chip}</span> : null}
      </div>
      <span style={{ fontSize: 24, fontWeight: 700, color: MUTED }}>{label}</span>
    </div>
  )
}

const Hairline = () => <div style={{ height: 2, background: 'rgba(11,26,29,0.12)', margin: '17px 0' }} />

export function StatsLandscape({ payments = 230, wallets = 108, walletsThisWeek = 40, shops = 18, volume = '1651.70', asOf = '12 Oct 2026' }: Partial<LandscapeProps>) {
  const [handle] = useState(() => delayRender('fonts'))
  useEffect(() => {
    fontsReady.then(() => continueRender(handle))
  }, [handle])
  const dollars = `$${Number(volume).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  // The giant number: every digit but the last zero, then Kovi in the zero's place.
  const digits = String(payments)
  const lead = digits.endsWith('0') ? digits.slice(0, -1) : digits
  const S = 420
  const B = 585
  const track = -0.04 * S
  const x0 = 72 - 0.05 * S
  const origins: number[] = []
  let x = x0
  for (const d of lead) {
    origins.push(x)
    x += (ADV[d as keyof typeof ADV] ?? 0.6) * S + track
  }
  const k = ((ZERO.top - ZERO.bottom) * S) / (COIN.bottom - COIN.top)
  const coinLeft = x + 0.07 * S + 44
  const coinTop = B - ZERO.top * S
  const kovi = { left: coinLeft - COIN.left * k, top: coinTop - COIN.top * k, size: 1024 * k }
  const ring = { x: coinLeft + (COIN.width * k) / 2, y: coinTop + ((COIN.bottom - COIN.top) * k) / 2 }

  return (
    <AbsoluteFill style={{ background: C.paper, overflow: 'hidden' }}>
      <AbsoluteFill style={{ background: `radial-gradient(circle at ${ring.x}px ${ring.y}px, rgba(255,255,255,0.7), rgba(255,255,255,0) 520px)` }} />
      {/* The tap rings, out from Kovi. */}
      <svg width={1600} height={900} style={{ position: 'absolute', inset: 0 }}>
        {[230, 330, 430, 530, 630, 730].map((r, i) => (
          <circle key={r} cx={ring.x} cy={ring.y} r={r} fill="none" stroke={C.ink} strokeWidth={2} opacity={0.085 - i * 0.011} />
        ))}
      </svg>

      <div style={{ position: 'absolute', left: 72, right: 72, top: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Logo h={46} />
        <span style={{ ...ui, fontSize: 20, fontWeight: 800, letterSpacing: '0.12em', padding: '10px 20px 10px 16px', borderRadius: 999, boxShadow: `inset 0 0 0 2.5px ${C.ink}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 12, height: 12, borderRadius: 6, background: C.coral, boxShadow: `0 0 0 4px rgba(212,101,88,0.22)` }} />
          LIVE ON MONAD · {asOf.toUpperCase()}
        </span>
      </div>

      {/* Tap. Paid. */}
      <At x={72} baseline={226} size={104} style={{ fontWeight: 800, letterSpacing: '-0.065em' }}>
        Tap
        <Dot fill={C.coralSoft} />
        <span style={{ marginLeft: '0.22em', color: TEAL_DEEP }}>Paid</span>
        <Dot fill={C.coral} />
      </At>

      <Img src={staticFile('art/coin-gbp.png')} style={{ position: 'absolute', left: 612, top: 150, width: 66, transform: 'rotate(-14deg)' }} />
      <Img src={staticFile('art/coin-eur.png')} style={{ position: 'absolute', left: 990, top: 160, width: 72, transform: 'rotate(10deg)' }} />
      <Img src={staticFile('art/coin-usd.png')} style={{ position: 'absolute', left: 934, top: 668, width: 56, transform: 'rotate(-8deg)' }} />

      {/* 23, and Kovi as the 0. */}
      <svg width={1600} height={900} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        {[...lead].map((d, i) => (
          <text key={i} x={origins[i]} y={B} fontFamily="Manrope" fontWeight={800} fontSize={S} fill={C.ink}>
            {d}
          </text>
        ))}
      </svg>
      {/* Kovi's shadow on the ground, below his jump. */}
      <div style={{ position: 'absolute', left: ring.x - 150, top: B + 150, width: 300, height: 30, borderRadius: '50%', background: 'radial-gradient(closest-side, rgba(11,26,29,0.16), rgba(11,26,29,0))' }} />
      <Img src={staticFile('art/kovi-cheer.png')} style={{ position: 'absolute', left: kovi.left, top: kovi.top, width: kovi.size, height: kovi.size }} />

      <At x={72} baseline={B + 74} size={50} style={{ fontWeight: 800, letterSpacing: '-0.03em' }}>
        times on Monad.
      </At>
      <At x={74} baseline={B + 120} size={27} style={{ fontWeight: 600, color: MUTED }}>
        About a second each, no gas.
      </At>

      {/* The rest of the numbers. */}
      <div style={{ position: 'absolute', left: 1120, width: 408, top: 150 }}>
        <Stat value={String(wallets)} label="Kova wallets" chip={`+${walletsThisWeek} this week`} />
        <Hairline />
        <Stat value={String(shops)} label="shops open" />
        <Hairline />
        <Stat value={dollars} label="test dollars paid" size={66} />
        <Hairline />
        <Stat value="$0.00" label="in card fees and gas" color={C.coral} />
      </div>

      {/* Try it. */}
      <div style={{ position: 'absolute', left: 72, top: 778, display: 'flex', alignItems: 'center', gap: 26 }}>
        <div style={{ ...ui, display: 'flex', alignItems: 'center', gap: 16, background: C.coral, borderRadius: 999, padding: '10px 10px 10px 30px', fontSize: 29, fontWeight: 800 }}>
          Try Kova in a minute
          <span style={{ width: 50, height: 50, borderRadius: 25, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#a94b40" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </span>
        </div>
        <span style={{ ...ui, fontSize: 32, fontWeight: 800, letterSpacing: '-0.01em' }}>mykova.app/try</span>
      </div>
      <div style={{ ...ui, position: 'absolute', right: 72, top: 784, textAlign: 'right', fontSize: 20, fontWeight: 600, color: MUTED, lineHeight: 1.45 }}>
        Numbers from Monad testnet, in test dollars.
        <br />
        Kova is live on Monad mainnet too.
      </div>
      <Grain frame={11} />
    </AbsoluteFill>
  )
}
