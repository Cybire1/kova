/**
 * The numbers flyer for X (1080 x 1350, 4:5): Kova's real numbers on Monad, printed as a Kova receipt,
 * with Kovi peeking over its top edge and a PAID stamp on it.
 *
 * The numbers are props, read from the live API (`/v1/public/stats`) when the flyer is rendered, and
 * dated. They're things that happened, whoever made them happen (payments settled, test dollars moved,
 * shops opened), so the flyer says those and asks people to be among the first, rather than claiming
 * a count of users. The barcode is drawn from a real testnet payment, printed under it.
 */
import type React from 'react'
import { useEffect, useState } from 'react'
import { AbsoluteFill, continueRender, delayRender, Img, staticFile } from 'remotion'
import { Grain, Logo } from '../parts'
import { C, fontsReady } from '../theme'

const CREAM = '#f8f6f1'
const MUTED = '#55646a'
const ui: React.CSSProperties = { fontFamily: 'Manrope', color: C.ink }

/** Ordered and paid from table 3 at Ada's Bakery, $7.75 in 0.76 s (README, "On-chain"). */
const PROOF_TX = '0x617498997c9c5d23163ded2e4d522c6e48918b3f491ebd919469a9515e5a16f2'

export interface FlyerProps {
  payments: number
  /** Test dollars paid, e.g. "1651.70". */
  volume: string
  shops: number
  /** When the numbers were read, as the receipt prints it. */
  asOf: string
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, fontSize: 32, fontWeight: 700, lineHeight: 1.5, fontVariantNumeric: 'tabular-nums' }}>
      <span style={{ whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ flex: 1, borderBottom: `3px dotted ${C.ink}`, opacity: 0.3, transform: 'translateY(-9px)' }} />
      <span style={{ whiteSpace: 'nowrap', fontWeight: 800 }}>{value}</span>
    </div>
  )
}

const Rule = ({ gap }: { gap: string }) => <div style={{ borderTop: `3px dashed ${C.ink}`, opacity: 0.28, margin: gap }} />

/** A barcode whose bars are the bytes of a real transaction hash: the receipt's proof. */
function Barcode({ hash, width, height }: { hash: string; width: number; height: number }) {
  const bars: { x: number; w: number }[] = []
  let x = 0
  for (const ch of hash.slice(2)) {
    const n = Number.parseInt(ch, 16)
    const w = 1 + (n & 3)
    bars.push({ x, w })
    x += w + 1 + ((n >> 2) & 1)
  }
  const k = width / x
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {bars.map((b) => (
        <rect key={b.x} x={b.x * k} y={0} width={b.w * k} height={height} fill={C.ink} />
      ))}
    </svg>
  )
}

/** The receipt's torn bottom edge. */
function Teeth({ width }: { width: number }) {
  const n = 30
  const w = width / n
  const zig = Array.from({ length: n }, (_, i) => `L${(i + 0.5) * w},16 L${(i + 1) * w},2`).join(' ')
  return (
    <svg width={width} height={22} style={{ display: 'block', marginTop: -2, overflow: 'visible' }}>
      <path d={`M0,2 ${zig}`} fill={CREAM} stroke={C.ink} strokeWidth={4} strokeLinejoin="round" />
      <rect x={2} y={-2} width={width - 4} height={4} fill={CREAM} />
    </svg>
  )
}

function Stamp() {
  return (
    <div style={{ position: 'absolute', right: -26, bottom: -14, width: 196, height: 196, borderRadius: '50%', border: `7px solid ${C.coral}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', transform: 'rotate(-16deg)', mixBlendMode: 'multiply', opacity: 0.9 }}>
      <div style={{ position: 'absolute', inset: 9, borderRadius: '50%', border: `3px solid ${C.coral}` }} />
      <span style={{ ...ui, color: C.coral, fontSize: 15, fontWeight: 800, letterSpacing: '0.24em', marginBottom: 2 }}>SETTLED</span>
      <span style={{ ...ui, color: C.coral, fontSize: 54, fontWeight: 800, letterSpacing: '0.02em', lineHeight: 1 }}>PAID</span>
      <span style={{ ...ui, color: C.coral, fontSize: 15, fontWeight: 800, letterSpacing: '0.24em', marginTop: 4 }}>ON MONAD</span>
    </div>
  )
}

export function StatsFlyer({ payments = 230, volume = '1651.70', shops = 18, asOf = '12 Oct 2026' }: Partial<FlyerProps>) {
  const [handle] = useState(() => delayRender('fonts'))
  useEffect(() => {
    fontsReady.then(() => continueRender(handle))
  }, [handle])
  const dollars = `$${Number(volume).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const W = 770
  // Kovi's art is 456 x 352 with the ledge line at y 398 - 80 = 318: scaled so it sits on the receipt's top edge.
  const kovi = { scale: 0.5, line: 318 }

  return (
    <AbsoluteFill style={{ background: C.paper, overflow: 'hidden' }}>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse 75% 50% at 50% 58%, rgba(255,255,255,0.55), rgba(255,255,255,0) 72%)' }} />

      <div style={{ position: 'absolute', left: 64, right: 64, top: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Logo h={46} />
        <span style={{ ...ui, fontSize: 21, fontWeight: 800, letterSpacing: '0.14em', padding: '10px 20px 10px 18px', borderRadius: 999, border: `3px solid ${C.ink}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 12, height: 12, borderRadius: 6, background: C.coral }} />
          ON MONAD
        </span>
      </div>

      <div style={{ position: 'absolute', left: 64, top: 152, width: 960 }}>
        <div style={{ ...ui, fontSize: 112, fontWeight: 800, letterSpacing: '-0.045em', lineHeight: 1 }}>{payments} payments.</div>
        <div style={{ ...ui, fontSize: 112, fontWeight: 800, letterSpacing: '-0.045em', lineHeight: 1, color: C.coral }}>Zero card fees.</div>
        <div style={{ ...ui, fontSize: 30, fontWeight: 600, color: MUTED, marginTop: 24 }}>Paid with Kova on Monad, about a second each.</div>
      </div>

      {/* The receipt. */}
      <div style={{ position: 'absolute', left: (1080 - W) / 2, top: 590, width: W, transform: 'rotate(-2deg)', filter: 'drop-shadow(0 30px 42px rgba(11,26,29,0.17))' }}>
        <Img src={staticFile('art/sparkle-8.png')} style={{ position: 'absolute', width: 34, left: W / 2 - 150, top: -128, zIndex: 2 }} />
        <Img src={staticFile('art/sparkle-11.png')} style={{ position: 'absolute', width: 22, left: W / 2 + 140, top: -112, zIndex: 2 }} />
        <Img
          src={staticFile('art/kovi-peek-ledge.png')}
          style={{ position: 'absolute', width: 456 * kovi.scale, left: W / 2 - (456 * kovi.scale) / 2, top: 2 - kovi.line * kovi.scale, zIndex: 2 }}
        />
        <div style={{ ...ui, background: CREAM, border: `4px solid ${C.ink}`, borderBottom: 'none', borderRadius: '20px 20px 0 0', padding: '34px 44px 22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 21, fontWeight: 800, letterSpacing: '0.16em' }}>
            <span>KOVA · MONAD TESTNET</span>
            <span style={{ color: MUTED, letterSpacing: '0.08em' }}>{asOf.toUpperCase()}</span>
          </div>
          <Rule gap="16px 0 8px" />
          <Row label="Payments settled" value={String(payments)} />
          <Row label="Test dollars paid" value={dollars} />
          <Row label="Shops opened" value={String(shops)} />
          <Row label="Tap to paid" value="about 1 s" />
          <Rule gap="10px 0 6px" />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ fontSize: 30, letterSpacing: '0.12em' }}>FEES</span>
            <span style={{ fontSize: 58, letterSpacing: '-0.03em' }}>$0.00</span>
          </div>
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Barcode hash={PROOF_TX} width={430} height={52} />
            <span style={{ fontSize: 18, fontWeight: 700, color: MUTED, lineHeight: 1.35, fontVariantNumeric: 'tabular-nums' }}>
              Table 3, $7.75, paid in 0.76 s
              <br />
              tx {PROOF_TX.slice(0, 10)}…{PROOF_TX.slice(-8)}
            </span>
          </div>
        </div>
        <Teeth width={W} />
        <Stamp />
      </div>

      {/* Be one of the first. */}
      <div style={{ position: 'absolute', left: 64, right: 64, bottom: 62, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
        <div style={{ ...ui, display: 'flex', alignItems: 'center', gap: 16, background: C.ink, color: '#fff', borderRadius: 999, padding: '14px 14px 14px 32px', fontSize: 30, fontWeight: 800 }}>
          Try Kova in a minute
          <span style={{ width: 50, height: 50, borderRadius: 25, background: C.coral, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </span>
        </div>
        <div style={{ ...ui, textAlign: 'right' }}>
          <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.01em' }}>mykova.app/try</div>
          <div style={{ fontSize: 21, fontWeight: 600, color: MUTED, marginTop: 2 }}>Live on Monad mainnet too</div>
        </div>
      </div>
      <Grain frame={7} />
    </AbsoluteFill>
  )
}
