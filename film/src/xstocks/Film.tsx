import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from 'remotion'
import vo from '../../public/xstocks/audio/vo.json'
import { Device } from '../ios-live-v2/Device'
import { hop } from '../motion'
import { bezier, type Curve, Flight, Grain, Kovi, Logo } from '../parts'
import cues from './cues.json'

/**
 * "xStocks, live in Kova." 31 s, 16:9, 30 fps.
 *
 * Claim: buy Tesla with your dollars in Kova: one Face ID tap, and the stock lands in your own wallet.
 *
 * Everything is real. The screens are Kova's own web wallet (apps/web stock-trade.tsx, stocks.tsx),
 * rendered from its code and filled with one trade on Monad mainnet: 29 Oct 2026, 15:19:41 UTC, tx
 * 0xbe51aece…818af023d. The wallet paid exactly $5.00 of AUSD and got 0.01225308626834887 TSLAx (the
 * app shows four significant figures: 0.01225, at least 0.01213), sent by Kova's relayer, which paid
 * the gas. Tesla's xStock price then: $405.74. The chart is xStocks' own hourly prices for that day up
 * to the trade. The chart's change label is hidden (no performance figures) and the wallet's balance
 * is blurred.
 *
 * Motion (one vocabulary): words rise into place as they're said; objects Rise (decelerated); exits
 * are an accelerated fade with a short rise. The phone is one object the camera moves to three times
 * (push into the price, pan to the warnings, pull back). Kovi is the one bouncy thing. Signature,
 * once: on Monad, the $5 goes in and Kovi flies the stock back to the wallet.
 *
 * Layout ledger (no archetype twice in a row, none more than twice):
 *   0.0  the stock      Split (the line left, the phone right)
 *   3.0  $5             Extreme scale contrast (an enormous $5 beside the phone)
 *   5.6  the price      Full-bleed crop (the phone pushed in past the frame, words in the margin)
 *   14.3 the tap        Centred hero (the phone centred, words either side)
 *   19.3 on Monad       Split on an ink ground (the receipt left, the flight right)
 *   25.9 end            Centred hero (mark, line, address, small print)
 *
 * Audit: enter styles 2 · every exit animated · bouncy: Kovi only · camera moves 3 · accent: coral
 * only · texture: grain only · depth: the phone over the words, Kovi over the phone.
 */

export const FPS = 30
export const DURATION = Math.round(cues.duration * FPS)
const VO = cues.vo

const K = { paper: '#e7e5e0', ink: '#0b1a1d', coral: '#d46558', muted: '#566568', onInk: 'rgba(231,229,224,0.62)' }
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const decel = Easing.bezier(0.16, 1, 0.3, 1)
const accel = Easing.bezier(0.7, 0, 0.84, 0)
const inOut = Easing.bezier(0.65, 0, 0.35, 1)
const ease = (t: number, a: number, b: number, e = decel) => interpolate(t, [a, b], [0, 1], { ...clamp, easing: e })
const mix = (a: number, b: number, p: number) => a + (b - a) * p

type Word = { text: string; start: number; end: number }
const lines = Object.fromEntries((vo.lines as { id: string; words: Word[] }[]).map((l) => [l.id, l.words]))
const wordAt = (id: keyof typeof VO, text: string) => VO[id] + (lines[id].find((w) => w.text.startsWith(text))?.start ?? 0)

// --- The phone ------------------------------------------------------------------------------

/** Captures are 1179 × 2556 (393 pt at 3x); the device's screen is 1204 × 2620. */
const CAP = { w: 1179, h: 2556 }
const KS = 1204 / CAP.w
const CAP_TOP = (2620 - CAP.h * KS) / 2

/** Phones are placed by centre x, top edge and height. */
type Place = { x: number; top: number; h: number }
const HOOK: Place = { x: 1400, top: 96, h: 1000 }
const PRICE: Place = { x: 1460, top: -270, h: 2000 }
const WARN: Place = { x: 1460, top: -1060, h: 2000 }
const CENTER: Place = { x: 960, top: -20, h: 1180 }
const lerp = (a: Place, b: Place, p: number): Place => ({ x: mix(a.x, b.x, p), top: mix(a.top, b.top, p), h: mix(a.h, b.h, p) })

function placeAt(t: number): Place {
  // The one ambient move: the phone drifts up 10 px while the opening line is said.
  if (t < cues.push[0]) return { ...HOOK, top: HOOK.top + 10 - 10 * ease(t, 0, cues.push[0], Easing.linear) }
  if (t < cues.pan[0]) return lerp(HOOK, PRICE, ease(t, cues.push[0], cues.push[1], inOut))
  if (t < cues.pull[0]) return lerp(PRICE, WARN, ease(t, cues.pan[0], cues.pan[1], inOut))
  return lerp(WARN, CENTER, ease(t, cues.pull[0], cues.pull[1], inOut))
}

/** A point in capture pixels, on the canvas. */
function onPhone(place: Place, x: number, y: number) {
  const s = place.h / 2708
  return { x: place.x - (1311 * s) / 2 + 54 * s + x * KS * s, y: place.top + 44 * s + (CAP_TOP + y * KS) * s }
}

/** Where each tap lands, in capture pixels. */
const TAPS = [
  { at: cues.tapBuyTesla, x: 560, y: 1745 },
  { at: cues.tapFive, x: 589, y: 1730 },
  { at: cues.tapSeePrice, x: 589, y: 2333 },
  { at: cues.tapBuy, x: 589, y: 2187 },
  { at: cues.tapProof, x: 562, y: 2373 },
]

const cap = (name: string) => staticFile(`xstocks/${name}.png`)

/** One capture, filling the screen; `clip` and `dy` in capture pixels. */
function Shot({ name, opacity = 1, clipTop, dy = 0 }: { name: string; opacity?: number; clipTop?: number; dy?: number }) {
  return (
    <Img
      src={cap(name)}
      style={{
        position: 'absolute',
        left: 0,
        top: CAP_TOP,
        width: 1204,
        height: CAP.h * KS,
        opacity,
        transform: dy ? `translateY(${dy * KS}px)` : undefined,
        clipPath: clipTop === undefined ? undefined : `inset(${clipTop}px 0 0 0 round 72px 72px 0 0)`,
      }}
    />
  )
}

/** Which screen the phone shows: each step of the buy, with the sheet's own moves between them. */
function Screen({ t }: { t: number }) {
  const [up0, up1] = cues.sheetUp
  if (t < up0) return <Shot name="01-stock" />
  if (t < up1) {
    const p = ease(t, up0, up1)
    return (
      <>
        {/* The scrim (the dimmed page above the sheet, as captured) fades in; the sheet rises. */}
        <Shot name="01-stock" />
        <div style={{ position: 'absolute', inset: 0, background: '#0b1a1d', opacity: 0.32 * ease(t, up0, up0 + 0.25, Easing.linear) }} />
        <Shot name="02-amount-empty" clipTop={679} dy={(CAP.h - 679) * (1 - p)} />
      </>
    )
  }
  if (t < cues.tapFive + 0.05) return <Shot name="02-amount-empty" />
  const [r0, r1] = cues.review
  if (t < r0) return <Shot name="03-amount-5" />
  if (t < r1) {
    const p = ease(t, r0, r1)
    return (
      <>
        <Shot name="03-amount-5" />
        <Shot name="04-review-56" clipTop={210} dy={(683 - 214) * (1 - p)} opacity={ease(t, r0, r0 + 0.12, Easing.linear)} />
      </>
    )
  }
  if (t < cues.tapBuy + 0.03) return <Shot name={`04-review-${Math.max(47, 56 - Math.floor(t - r0))}`} />
  const [b0, b1] = cues.bought
  if (t < b0) return <Shot name="05-buying" />
  if (t < b1)
    return (
      <>
        <Shot name="05-buying" />
        <Shot name="06-bought" opacity={ease(t, b0, b1, Easing.linear)} />
      </>
    )
  return <Shot name="06-bought" />
}

/** The system's Face ID mark, as iOS draws it over the app while the passkey signs. */
function FaceId({ t }: { t: number }) {
  const [a, b] = cues.faceId
  if (t < a || t > b) return null
  const enter = ease(t, a, a + 0.18)
  const out = ease(t, b - 0.16, b, accel)
  const ok = ease(t, cues.faceIdOk, cues.faceIdOk + 0.28)
  const pulse = 1 + 0.035 * Math.sin((t - a) * 14) * (1 - ok)
  const size = 440
  const stroke = { stroke: '#fff', strokeWidth: 9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' }
  return (
    <div
      style={{
        position: 'absolute',
        left: 602 - size / 2,
        top: CAP_TOP + 1120 * KS - size / 2,
        width: size,
        height: size,
        borderRadius: 96,
        background: 'rgba(30,32,34,0.9)',
        opacity: enter * (1 - out),
        transform: `scale(${0.92 + 0.08 * enter})`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width={230} height={230} viewBox="0 0 100 100" style={{ transform: `scale(${pulse})` }}>
        <g opacity={1 - ok}>
          {['M8 30 V14 a6 6 0 0 1 6-6 H30', 'M70 8 H86 a6 6 0 0 1 6 6 V30', 'M92 70 V86 a6 6 0 0 1-6 6 H70', 'M30 92 H14 a6 6 0 0 1-6-6 V70'].map((d) => (
            <path key={d} d={d} {...stroke} strokeWidth={5} />
          ))}
          <path d="M34 36 V44 M66 36 V44 M50 36 V56 H45 M36 68 Q50 78 64 68" {...stroke} strokeWidth={5} />
        </g>
        <g opacity={ok}>
          <circle cx={50} cy={50} r={40} {...stroke} strokeWidth={5} />
          <path d="M32 51 L45 63 L69 38" {...stroke} strokeWidth={6} strokeDasharray={60} strokeDashoffset={60 * (1 - ok)} />
        </g>
      </svg>
    </div>
  )
}

function Phone({ t }: { t: number }) {
  if (t > cues.drop[1]) return null
  const place = placeAt(t)
  const drop = ease(t, cues.drop[0], cues.drop[1], accel)
  return (
    <div style={{ position: 'absolute', inset: 0, transform: `translateY(${1150 * drop}px)` }}>
      <Device x={place.x} y={place.top + place.h / 2} h={place.h} screen={null}>
        <div style={{ position: 'absolute', inset: 0, background: K.paper }}>
          <Screen t={t} />
          <FaceId t={t} />
        </div>
      </Device>
      {TAPS.map((p) => (t >= p.at && t <= p.at + 0.5 ? <TapRing key={p.at} t={t} at={p.at} {...onPhone(place, p.x, p.y)} /> : null))}
      <PeekingKovi t={t} place={place} />
    </div>
  )
}

/** Kovi peeks over the phone in the opening, hops on his name, and ducks as the camera pushes in. */
function PeekingKovi({ t, place }: { t: number; place: Place }) {
  if (t > cues.push[0] + 0.3) return null
  const out = ease(t, cues.push[0] - 0.15, cues.push[0] + 0.25, accel)
  const top = onPhone(place, 300, 0)
  const size = 210
  return (
    <Kovi
      pose="peek"
      size={size}
      x={top.x}
      y={top.y - size * 0.18 + hop(t, VO.hook, 24) + hop(t, wordAt('hook', 'Tesla'), 20) + 60 * out}
      style={{ opacity: 1 - out, clipPath: `inset(0 0 ${Math.round(28 + 60 * out)}% 0)` }}
    />
  )
}

function TapRing({ t, at, x, y }: { t: number; at: number; x: number; y: number }) {
  const p = (t - at) / 0.5
  if (p < 0 || p > 1) return null
  const r = 16 + 38 * decel(p)
  const press = 1 - Math.min(1, p / 0.4)
  return (
    <>
      <div style={{ position: 'absolute', left: x - 22, top: y - 22, width: 44, height: 44, borderRadius: 22, background: 'rgba(255,255,255,0.55)', boxShadow: '0 0 0 1.5px rgba(11,26,29,0.35)', opacity: press }} />
      <div
        style={{
          position: 'absolute',
          left: x - r,
          top: y - r,
          width: r * 2,
          height: r * 2,
          borderRadius: r,
          border: '3px solid rgba(255,255,255,0.95)',
          boxShadow: '0 0 0 1.5px rgba(11,26,29,0.45), inset 0 0 0 1.5px rgba(11,26,29,0.25)',
          opacity: 1 - p,
        }}
      />
    </>
  )
}

// --- Words ----------------------------------------------------------------------------------

type Shown = {
  id: keyof typeof VO
  until: number
  box: CSSProperties
  size: number
  accent: (w: Word, i: number) => boolean
  color?: string
}
const from = (first: string) => (w: Word, i: number, words: Word[] = []) => i >= words.findIndex((x) => x.text.startsWith(first))
const SHOWN: Shown[] = [
  { id: 'hook', until: 3.3, box: { left: 120, width: 920, top: 120, height: 840 }, size: 110, accent: (w) => ['Tesla', 'dollars.'].includes(w.text) },
  { id: 'amount', until: 5.45, box: { left: 110, width: 900, top: 90, height: 900 }, size: 470, accent: () => true },
  { id: 'price', until: 9.05, box: { left: 110, width: 820, top: 120, height: 840 }, size: 86, accent: (w) => ['price', 'least'].includes(w.text) },
  { id: 'what', until: 14.3, box: { left: 110, width: 820, top: 120, height: 840 }, size: 78, accent: (w, i) => from('not')(w, i, lines.what) },
  { id: 'tap', until: 16.55, box: { left: 110, width: 530, top: 120, height: 840 }, size: 96, accent: (w) => ['Face', 'ID'].includes(w.text) },
  { id: 'lands', until: 19.25, box: { left: 1300, width: 580, top: 120, height: 840 }, size: 86, accent: (w) => ['own', 'wallet.'].includes(w.text) },
]

function Words({ t }: { t: number }) {
  return (
    <>
      {SHOWN.map(({ id, until, box, size, accent, color }) => {
        const start = VO[id]
        // The opening line is on screen from frame 0 (X's thumbnail); its accent lights as it's said.
        const opening = id === 'hook'
        if (t < (opening ? 0 : start - 0.2) || t > until + 0.35) return null
        const out = ease(t, until, until + 0.3, accel)
        return (
          <div
            key={id}
            style={{
              position: 'absolute',
              ...box,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: size,
              lineHeight: id === 'amount' ? 0.9 : 1.06,
              letterSpacing: id === 'amount' ? '-0.06em' : '-0.04em',
              color: color ?? K.ink,
              opacity: 1 - out,
              transform: `translateY(${-10 * out}px)`,
            }}
          >
            <div>
              <Line words={lines[id]} t={t} start={start} instant={opening} accent={accent} />
            </div>
          </div>
        )
      })}
    </>
  )
}

/** Words rise into place as they're said (or stand from the start), accents lit as they're said. */
function Line({ words, t, start, instant, accent, base = K.ink }: { words: Word[]; t: number; start: number; instant?: boolean; accent: (w: Word, i: number) => boolean; base?: string }) {
  return (
    <>
      {words.map((w, i) => {
        const rise = instant ? 1 : ease(t, start + w.start - 0.08, start + w.start + 0.32)
        const lit = accent(w, i) && t >= start + w.start - 0.05
        return (
          <span key={`${w.text}${i}`} style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'bottom', marginRight: '0.24em', paddingBottom: '0.05em' }}>
            <span style={{ display: 'inline-block', transform: `translateY(${(1 - rise) * 105}%)`, color: lit ? K.coral : base }}>{w.text}</span>
          </span>
        )
      })}
    </>
  )
}

// --- On Monad -------------------------------------------------------------------------------

const WALLET = { x: 1560, y: 820 }
const STOCKS = { x: 1560, y: 330 }
const COIN: Curve = [
  { x: WALLET.x - 120, y: WALLET.y - 60 },
  { x: WALLET.x - 330, y: WALLET.y - 200 },
  { x: STOCKS.x - 330, y: STOCKS.y + 200 },
  { x: STOCKS.x - 120, y: STOCKS.y + 60 },
]
const RIDE: Curve = [
  { x: STOCKS.x + 120, y: STOCKS.y + 60 },
  { x: STOCKS.x + 360, y: STOCKS.y + 220 },
  { x: WALLET.x + 360, y: WALLET.y - 220 },
  { x: WALLET.x + 110, y: WALLET.y - 70 },
]

function Proof({ t }: { t: number }) {
  if (t < cues.ink[0] || t > cues.proofOut[1]) return null
  const enter = ease(t, cues.ink[0], cues.ink[1])
  const out = ease(t, cues.proofOut[0], cues.proofOut[1], accel)
  const rise = (at: number) => {
    const p = ease(t, at, at + 0.6)
    return { opacity: p, transform: `translateY(${44 * (1 - p)}px)` }
  }
  const coin = ease(t, cues.coin[0], cues.coin[1], inOut)
  const ride = ease(t, cues.flight[0], cues.flight[1], inOut)
  const landed = t >= cues.flight[1]
  const row = (label: string, value: ReactNode, at: number) => (
    <div style={{ ...rise(at), marginBottom: 30 }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: K.onInk, letterSpacing: '0.02em' }}>{label}</div>
      <div style={{ fontSize: 76, fontWeight: 800, letterSpacing: '-0.035em', color: K.paper, display: 'flex', alignItems: 'center', gap: 18, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  )
  const chip = (label: string, sub: string, at: { x: number; y: number }, lit: boolean) => (
    <div
      style={{
        position: 'absolute',
        left: at.x - 150,
        top: at.y - 54,
        width: 300,
        padding: '18px 0',
        borderRadius: 28,
        textAlign: 'center',
        background: lit ? K.paper : 'rgba(231,229,224,0.1)',
        color: lit ? K.ink : K.paper,
        boxShadow: '0 0 0 2px rgba(231,229,224,0.5)',
        ...rise(cues.ink[1] - 0.2),
      }}
    >
      <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.02em' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, opacity: 0.7, fontFamily: 'Menlo, ui-monospace, monospace' }}>{sub}</div>
    </div>
  )
  const coinAt = bezier(COIN, coin)
  const rideAt = bezier(RIDE, ride)
  const trail = (curve: Curve, p: number, color: string) =>
    Array.from({ length: 41 }, (_, i) => i / 40)
      .filter((q) => q < p - 0.02)
      .map((q) => {
        const d = bezier(curve, q)
        return <div key={q} style={{ position: 'absolute', left: d.x - 4, top: d.y - 4, width: 8, height: 8, borderRadius: 4, background: color, opacity: 0.85 }} />
      })
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: 1 - out, transform: `translateY(${-10 * out}px)` }}>
      <div style={{ position: 'absolute', inset: 0, background: K.ink, transform: `translateY(${1080 * (1 - enter)}px)` }}>
        <div style={{ position: 'absolute', left: 130, top: 78, fontSize: 24, fontWeight: 700, letterSpacing: '0.14em', color: K.onInk, ...rise(cues.ink[1] - 0.3) }}>
          MONAD MAINNET · 29 OCT 2026 · 15:19:41 UTC
        </div>
        <div style={{ position: 'absolute', left: 130, top: 130, width: 1080, fontSize: 72, fontWeight: 800, lineHeight: 1.06, letterSpacing: '-0.04em' }}>
          <Line words={lines.proof} t={t} start={VO.proof} accent={(w) => ['$5', 'stock'].includes(w.text)} base={K.paper} />
        </div>
        <div style={{ position: 'absolute', left: 130, top: 400 }}>
          {row('Paid', <>$5.00 <span style={{ fontSize: 40, color: K.onInk, letterSpacing: '-0.01em', fontWeight: 700 }}>AUSD</span></>, wordAt('proof', '$5'))}
          {row(
            'Got, in the buyer’s own wallet',
            <>
              <Img src={staticFile('xstocks/tsla-logo.png')} style={{ width: 58, height: 58, borderRadius: 29 }} />
              0.01225 <span style={{ fontSize: 40, color: K.onInk, letterSpacing: '-0.01em', fontWeight: 700 }}>TSLAx</span>
            </>,
            cues.flight[1] - 0.1,
          )}
          {row('Fee', <>$0 <span style={{ fontSize: 40, color: K.onInk, letterSpacing: '-0.01em', fontWeight: 700 }}>· Kova’s relayer paid the gas</span></>, cues.feeRow)}
        </div>
        <div style={{ position: 'absolute', left: 130, top: 930, fontSize: 23, lineHeight: 1.6, fontFamily: 'Menlo, ui-monospace, monospace', color: K.onInk, ...rise(cues.feeRow + 0.3) }}>
          exactly 5.000000 AUSD in · 0.01225308626834887 TSLAx out
          <br />
          tx 0xbe51aece5bce96d2d307ee5f471f33991920557a0d5149d53c9347e818af023d · monadscan.com
        </div>
        {chip('KovaStocks', '0xAF47…6ef3', STOCKS, false)}
        {chip('Your wallet', 'you hold the key', WALLET, landed)}
        {trail(COIN, coin, K.coral)}
        {coin > 0 && coin < 1 ? (
          <div
            style={{
              position: 'absolute',
              left: coinAt.x - 46,
              top: coinAt.y - 46,
              width: 92,
              height: 92,
              borderRadius: 46,
              background: K.coral,
              color: K.paper,
              fontWeight: 800,
              fontSize: 34,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              letterSpacing: '-0.03em',
            }}
          >
            $5
          </div>
        ) : null}
        <Flight curve={RIDE} p={ride} size={150} color={K.paper} />
        {ride > 0 && ride < 1 ? <Img src={staticFile('xstocks/tsla-logo.png')} style={{ position: 'absolute', left: rideAt.x - 92, top: rideAt.y + 6, width: 62, height: 62, borderRadius: 31, boxShadow: '0 0 0 4px #e7e5e0' }} /> : null}
        {landed ? (
          <Kovi pose="cheer" size={150} x={WALLET.x + 230} y={WALLET.y - 30 + hop(t, cues.flight[1], 40)} style={{ opacity: ease(t, cues.flight[1], cues.flight[1] + 0.15) }} />
        ) : null}
      </div>
    </div>
  )
}

// --- The end --------------------------------------------------------------------------------

function EndCard({ t }: { t: number }) {
  if (t < cues.proofOut[0]) return null
  const start = VO.end
  const mark = ease(t, start - 0.1, start + 0.5)
  const url = ease(t, cues.url - 0.1, cues.url + 0.5)
  const fine = ease(t, start + 0.6, start + 1.2)
  const kovi = ease(t, start + 0.4, start + 1.0)
  const bob = 6 * Math.sin(((t - start) / 1.4) * 2 * Math.PI) * kovi
  const rise = (p: number): CSSProperties => ({ opacity: p, transform: `translateY(${44 * (1 - p)}px)` })
  return (
    <>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 110, display: 'flex', justifyContent: 'center', ...rise(mark) }}>
        <Logo h={130} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 285, textAlign: 'center', fontWeight: 800, fontSize: 96, letterSpacing: '-0.04em' }}>
        <Line words={lines.end.filter((w) => !/^(Try|it|at|mykova)/.test(w.text))} t={t} start={start} accent={(w) => w.text === 'xStocks,'} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 445, display: 'flex', justifyContent: 'center', ...rise(url) }}>
        <div style={{ padding: '18px 46px', borderRadius: 999, background: K.ink, color: '#fff', fontWeight: 800, fontSize: 52, letterSpacing: '-0.02em' }}>
          <span style={{ fontWeight: 600, opacity: 0.7 }}>Try it at </span>mykova.app
        </div>
      </div>
      <div style={{ position: 'absolute', left: 150, right: 150, top: 660, textAlign: 'center', fontSize: 42, fontWeight: 700, lineHeight: 1.32, letterSpacing: '-0.01em', color: 'rgba(11,26,29,0.78)', ...rise(fine) }}>
        xStocks are tokens issued by Backed Finance, not shares. Kova doesn’t issue, sell or recommend them.
        <div style={{ height: 22 }} />
        Not available in the US, UK, EU/EEA, Switzerland, Canada or Australia. Not investment advice.
      </div>
      <Kovi pose={url > 0.5 ? 'cheer' : 'wave'} size={180} x={1640} y={330 + 30 * (1 - kovi) + bob} style={{ opacity: kovi }} />
    </>
  )
}

export function XStocks() {
  const frame = useCurrentFrame()
  const t = frame / FPS
  return (
    <AbsoluteFill style={{ background: K.paper, fontFamily: 'Manrope', color: K.ink, overflow: 'hidden' }}>
      <Words t={t} />
      <Phone t={t} />
      <Proof t={t} />
      <EndCard t={t} />
      <Grain frame={frame} />
    </AbsoluteFill>
  )
}
