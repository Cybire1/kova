import type { CSSProperties } from 'react'
import { AbsoluteFill, Easing, Freeze, Img, interpolate, OffthreadVideo, staticFile, useCurrentFrame } from 'remotion'
import takeA from '../../public/credit-alert/take-a.json'
import vo from '../../public/ramps/audio/vo.json'
import { Device } from '../ios-live-v2/Device'
import { Grain, Kovi, Logo } from '../parts'

/**
 * "Ramps." Kova's on-ramps and off-ramps: 42 s, 16:9, 30 fps.
 *
 * Claim: money gets into Kova from any Nigerian bank or from crypto, and back out to any bank, in
 * seconds. The film opens on both ends at once (money in, money out), then walks each one.
 *
 * Everything is real:
 *  - Naira in: the account holder's own iPhone recording of 28 Oct 2026 (public/deposits/rec-flow.mp4):
 *    $2.00 for ₦2,801 by bank transfer from OPay. OPay says "Transfer successful" at 43.5 s of the
 *    recording and Kova shows the $2.00 arriving at 53.2 s: 9.7 s ("Ten seconds later").
 *  - Crypto in: the network list from the holder's recording (rec-deposit.mp4) and the $4.97 arriving
 *    (rec-arrival.mp4). Eleven networks are live on mainnet (GET /v1/wallets/…/chain-deposit-sources).
 *    That $4.97 came from Arc (Relay request 0x1793196000…f6e8), so the film names no source chain.
 *  - Naira out: the cash-out of 27 Oct 2026 (take-a/b, from "Credit alert"): $2.00 → ₦2,752.94, "Done
 *    in 11 seconds", and the holder's OPay alert.
 * Names, account numbers and the partner's name are blurred on every frame that shows them.
 *
 * Motion (one vocabulary): words rise into place as they're said; objects Rise (decelerated); exits
 * are an accelerated fade with a short rise. The phone is one object that travels between beats
 * (right, left, right) instead of cutting. Signature, once: the bank's alert drops in on "Done".
 *
 * Layout ledger (no archetype twice in a row, none more than twice):
 *   0.0  both ends   Centred hero (two phones under the line)
 *   3.1  naira in    Split (words left, the phone large and cropped right)
 *   15.9 crypto in   Extreme scale contrast (the phone left, an enormous 11 right)
 *   22.3 naira out   Split (words left, phone right), the alert dropping in over the words
 *   35.2 end         Baseline anchor (mark, line and address on one low axis)
 *
 * Audit: enter styles 2 · every exit animated · bouncy springs: none · camera moves 0 (the phone
 * travels three times) · accent: coral only · texture: grain only · depth: the phone over the paper.
 */

export const FPS = 30
export const DURATION = 42 * FPS

/** When each voiceover line starts, in film seconds. */
export const VO = { hook: 0.3, in: 3.9, lands: 11.2, crypto: 16.4, out: 23.2, done: 32.6, end: 35.7 }

const K = { paper: '#e7e5e0', page: '#e6e5e0', ink: '#0b1a1d', coral: '#d46558', muted: '#566568' }
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const decel = Easing.bezier(0.16, 1, 0.3, 1)
const accel = Easing.bezier(0.7, 0, 0.84, 0)
const inOut = Easing.bezier(0.65, 0, 0.35, 1)
const ease = (t: number, a: number, b: number, e = decel) => interpolate(t, [a, b], [0, 1], { ...clamp, easing: e })
const mix = (a: number, b: number, p: number) => a + (b - a) * p

// The recordings.
const FLOW = 'deposits/rec-flow-cfr.mp4' // naira in, 880x1920
const DEP = 'deposits/rec-deposit-cfr.mp4' // crypto: the network list, 880x1920
const ARR = 'deposits/rec-arrival-h264.mp4' // crypto: $4.97 arriving, 1320x2868
const TA = 'credit-alert/take-a.mp4' // naira out: Home → check and send (web, 393 CSS px)
const TB = 'credit-alert/take-b.mp4' // naira out: sending → done
const SIZE: Record<string, { w: number; h: number }> = { [FLOW]: { w: 880, h: 1920 }, [DEP]: { w: 880, h: 1920 }, [ARR]: { w: 1320, h: 2868 } }

type Shot = { src: string; t: number }
/** A stretch of film playing a stretch of a recording (at whatever speed the two lengths make). */
type Seg = { a: number; b: number; src: string; from: number; to: number }

/** The one phone, from the moment it leaves the opening pair until it leaves for the end card. */
const SEGS: Seg[] = [
  // Naira in.
  { a: 3.45, b: 4.9, src: FLOW, from: 2.8, to: 5.8 }, // Add money; "From your bank, in naira"
  { a: 4.9, b: 6.3, src: FLOW, from: 5.8, to: 10.3 }, // $2: you pay ₦2,795.44
  { a: 6.3, b: 7.7, src: FLOW, from: 10.3, to: 12.25 }, // the rate; "Get the account to pay"
  { a: 7.7, b: 8.4, src: FLOW, from: 12.25, to: 15.5 }, // opening an account
  { a: 8.4, b: 10.0, src: FLOW, from: 15.6, to: 17.2 }, // the account to pay
  { a: 10.0, b: 11.0, src: FLOW, from: 43.5, to: 44.1 }, // OPay: Transfer successful
  { a: 11.0, b: 12.6, src: FLOW, from: 46.0, to: 53.2 }, // back in Kova, waiting
  { a: 12.6, b: 16.2, src: FLOW, from: 53.2, to: 56.8 }, // +$2.00
  // Crypto in.
  { a: 16.2, b: 17.5, src: DEP, from: 5.9, to: 7.2 }, // eleven networks
  { a: 17.5, b: 19.4, src: DEP, from: 7.2, to: 7.2 },
  { a: 19.4, b: 22.6, src: ARR, from: 0.2, to: 3.4 }, // +$4.97
  // Naira out.
  { a: 22.6, b: 28.6, src: TA, from: 0.4, to: 11.0 },
  { a: 28.6, b: 30.5, src: TA, from: 11.0, to: 12.9 }, // check and send
  { a: 30.5, b: 32.4, src: TB, from: 0.0, to: 7.0 }, // on its way → done
  { a: 32.4, b: 36.2, src: TB, from: 7.0, to: 10.8 },
]

function shotAt(t: number): Shot {
  const seg = SEGS.find((s) => t < s.b) ?? SEGS[SEGS.length - 1]
  return { src: seg.src, t: seg.from + (seg.to - seg.from) * Math.min(1, Math.max(0, (t - seg.a) / (seg.b - seg.a))) }
}

/** Film time of a moment in a recording (for taps). */
function filmTime(src: string, at: number) {
  const seg = SEGS.find((s) => s.src === src && at >= s.from && at <= s.to && s.to > s.from)
  return seg ? seg.a + ((at - seg.from) / (seg.to - seg.from)) * (seg.b - seg.a) : null
}

/** Where things sit. Phones are placed by centre x, top edge and height. */
type Place = { x: number; top: number; h: number }
const PAIR_L: Place = { x: 655, top: 296, h: 1080 }
const PAIR_R: Place = { x: 1265, top: 296, h: 1080 }
const RIGHT: Place = { x: 1400, top: 34, h: 1340 }
const LEFT: Place = { x: 560, top: 34, h: 1340 }
const between = (a: Place, b: Place, p: number): Place => ({ x: mix(a.x, b.x, p), top: mix(a.top, b.top, p), h: mix(a.h, b.h, p) })

/** The phone's travels: out of the pair, right → left for crypto, back right, then away. */
const MOVES: { at: number; until: number; from: Place; to: Place }[] = [
  { at: 3.1, until: 3.85, from: PAIR_L, to: RIGHT },
  { at: 15.9, until: 16.55, from: RIGHT, to: LEFT },
  { at: 22.3, until: 22.95, from: LEFT, to: RIGHT },
]
const PHONE_LEAVES = 35.2

function placeAt(t: number): Place {
  let place = PAIR_L
  for (const m of MOVES) {
    if (t >= m.until) place = m.to
    else if (t >= m.at) return between(m.from, m.to, ease(t, m.at, m.until, inOut))
  }
  return place
}

/** A point of a recording (its own pixels; CSS px below the status bar for the web takes) in the frame. */
function onPhone(place: Place, src: string, x: number, y: number) {
  const s = place.h / 2708
  const left = place.x - (1311 * s) / 2 + 54 * s
  const top = place.top + 44 * s
  if (src === TA || src === TB) {
    const px = (1204 / 393) * s
    return { x: left + x * px, y: top + (y + 54) * px }
  }
  const { w, h } = SIZE[src]
  const k = (1204 / w) * s
  return { x: left + x * k, y: top + ((2620 - h * (1204 / w)) / 2) * s + y * k }
}

/** Taps, in each recording's own time and pixels. */
const TAPS: { src: string; at: number; x: number; y: number }[] = [
  { src: FLOW, at: 5.45, x: 440, y: 1072 }, // From your bank, in naira
  { src: FLOW, at: 10.45, x: 440, y: 1782 }, // Continue
  { src: FLOW, at: 12.2, x: 440, y: 1782 }, // Get the account to pay
  { src: DEP, at: 6.15, x: 440, y: 632 }, // From network
  ...takeA.taps.map((p) => ({ src: TA, at: p.t, x: p.x, y: p.y })),
]

/** What must never be readable: the partner's name and lines about it, the account to pay, and
 * OPay's offers. Boxes in the recording's own pixels, live for a stretch of its time. */
const CARD = 'rgba(232,231,225,0.55)'
const TEAL = 'rgba(132,175,174,0.55)'
const BLURS: { src: string; from: number; to: number; boxes: { x: number; y: number; w: number; h: number; tint: string }[] }[] = [
  {
    // The rate: "PAJ's rate, its fee included", "PAJ sends the dollars…".
    src: FLOW,
    from: 10.5,
    to: 15.62,
    boxes: [
      { x: 560, y: 520, w: 262, h: 40, tint: CARD },
      { x: 392, y: 709, w: 430, h: 40, tint: CARD },
    ],
  },
  {
    // The account to pay: its number, its holder, and the line naming the partner.
    src: FLOW,
    from: 15.5,
    to: 18.0,
    boxes: [
      { x: 516, y: 446, w: 188, h: 60, tint: CARD },
      { x: 630, y: 624, w: 190, h: 56, tint: CARD },
      { x: 26, y: 818, w: 826, h: 102, tint: TEAL },
    ],
  },
  {
    // OPay's offers under "Transfer successful".
    src: FLOW,
    from: 43.3,
    to: 44.3,
    boxes: [{ x: 32, y: 944, w: 826, h: 976, tint: 'rgba(236,245,240,0.5)' }],
  },
]

type Word = { text: string; start: number; end: number }
const lines = Object.fromEntries((vo.lines as { id: string; words: Word[] }[]).map((l) => [l.id, l.words]))

export function Ramps() {
  const frame = useCurrentFrame()
  const t = frame / FPS
  return (
    <AbsoluteFill style={{ background: K.paper, fontFamily: 'Manrope', color: K.ink, overflow: 'hidden' }}>
      <Pair t={t} />
      <Words t={t} />
      <Timer t={t} />
      <Phone t={t} />
      <Alert t={t} />
      <EndCard t={t} />
      <Grain frame={frame} />
    </AbsoluteFill>
  )
}

/** The phone: an iPhone 16 Pro frame around a recording. */
function Handset({ place, shot, soften = 0, style }: { place: Place; shot: Shot; soften?: number; style?: CSSProperties }) {
  return (
    <div style={{ position: 'absolute', inset: 0, ...style }}>
      <Device x={place.x} y={place.top + place.h / 2} h={place.h} screen={null}>
        <div style={{ position: 'absolute', inset: 0, background: K.page, filter: soften > 0.01 ? `blur(${soften * 26}px)` : undefined }}>
          {shot.src === TA || shot.src === TB ? <Web shot={shot} /> : <Recording shot={shot} />}
        </div>
        {/* The island as it looks while recording, wide enough to cover the recording's own. */}
        <div style={{ position: 'absolute', left: 352, top: 33, width: 490, height: 120, borderRadius: 60, background: '#000' }} />
      </Device>
    </div>
  )
}

/** An iPhone recording, filling the screen, with its blurs. */
function Recording({ shot }: { shot: Shot }) {
  const { w, h } = SIZE[shot.src]
  const k = 1204 / w
  const live = BLURS.filter((b) => b.src === shot.src && shot.t >= b.from && shot.t <= b.to)
  return (
    <div style={{ position: 'absolute', left: 0, top: (2620 - h * k) / 2, width: 1204, height: h * k }}>
      {/* The moment is an offset into the recording: a frozen frame is clamped to the film's length. */}
      <Freeze frame={0}>
        <OffthreadVideo src={staticFile(shot.src)} trimBefore={Math.round(shot.t * FPS)} muted style={{ width: 1204, height: h * k }} />
      </Freeze>
      {live.flatMap((b) =>
        b.boxes.map((box) => (
          <div
            key={`${b.from}${box.x}${box.y}`}
            style={{
              position: 'absolute',
              left: box.x * k,
              top: box.y * k,
              width: box.w * k,
              height: box.h * k,
              borderRadius: 16 * k,
              background: box.tint,
              backdropFilter: 'blur(16px)',
            }}
          />
        )),
      )}
    </div>
  )
}

/** A web take: Kova's web app at phone size, under iOS's status bar at the cash-out's time. */
function Web({ shot }: { shot: Shot }) {
  return (
    <div style={{ width: 393, height: 852, transform: `scale(${1204 / 393})`, transformOrigin: 'top left' }}>
      <StatusBar />
      <div style={{ position: 'absolute', top: 54, left: 0, width: 393, height: 798 }}>
        <Freeze frame={0}>
          <OffthreadVideo src={staticFile(shot.src)} trimBefore={Math.round(shot.t * FPS)} muted style={{ width: 393, height: 798 }} />
        </Freeze>
      </div>
    </div>
  )
}

/** iOS's status bar at the time of the cash-out (00:36 in Lagos). */
function StatusBar() {
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: 393, height: 54, color: K.ink }}>
      <span
        style={{
          position: 'absolute',
          left: 0,
          width: 142,
          top: 17,
          textAlign: 'center',
          fontFamily: '-apple-system, system-ui',
          fontWeight: 600,
          fontSize: 17,
          letterSpacing: -0.3,
        }}
      >
        00:36
      </span>
      <svg style={{ position: 'absolute', left: 285, top: 20 }} width={78} height={14} viewBox="0 0 78 14">
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={i * 5} y={9 - i * 2.6} width={3.2} height={3.4 + i * 2.6} rx={0.8} fill={K.ink} />
        ))}
        <path d="M31 4.6a10 10 0 0 1 14 0" stroke={K.ink} strokeWidth={2} fill="none" strokeLinecap="round" />
        <path d="M33.5 7.4a6.2 6.2 0 0 1 9 0" stroke={K.ink} strokeWidth={2} fill="none" strokeLinecap="round" />
        <circle cx={38} cy={10.6} r={1.6} fill={K.ink} />
        <rect x={52} y={1.2} width={22} height={11.6} rx={3.4} stroke={K.ink} strokeOpacity={0.4} strokeWidth={1} fill="none" />
        <rect x={54} y={3.2} width={15} height={7.6} rx={1.8} fill={K.ink} />
        <path d="M75.6 5.2v3.6a2 2 0 0 0 0-3.6z" fill={K.ink} fillOpacity={0.4} />
      </svg>
    </div>
  )
}

/** 0–3.6 s: both ends at once. Money in (the receipt for $2.00 from a bank transfer) and money out
 * (₦2,752.94 in an OPay account), each under its label. The right one leaves; the left one becomes
 * the film's phone. */
function Pair({ t }: { t: number }) {
  if (t > 3.7) return null
  const out = ease(t, 3.05, 3.55, accel)
  const drift = 1 + 0.015 * ease(t, 0, 3.05, inOut)
  const label = (text: string, x: number): CSSProperties => ({
    position: 'absolute',
    left: x - 160,
    width: 320,
    top: 214,
    display: 'flex',
    justifyContent: 'center',
    opacity: 1 - out,
    transform: `translateY(${-14 * out}px)`,
  })
  return (
    <>
      <div style={label('in', PAIR_L.x)}>
        <Pill>Money in</Pill>
      </div>
      <div style={label('out', PAIR_R.x)}>
        <Pill>Money out</Pill>
      </div>
      <Handset
        place={PAIR_R}
        shot={{ src: TB, t: Math.min(7.6 + t, 10.8) }}
        style={{
          opacity: 1 - out,
          transform: `translateY(${700 * out}px) scale(${drift})`,
          transformOrigin: `${PAIR_R.x}px ${PAIR_R.top + 300}px`,
        }}
      />
    </>
  )
}

function Pill({ children }: { children: string }) {
  return (
    <div
      style={{
        padding: '10px 26px',
        borderRadius: 999,
        background: K.ink,
        color: '#fff',
        fontWeight: 700,
        fontSize: 30,
        letterSpacing: '-0.01em',
      }}
    >
      {children}
    </div>
  )
}

/** The one phone: the left of the opening pair, then the walk through every way in and out. */
function Phone({ t }: { t: number }) {
  if (t > PHONE_LEAVES + 0.7) return null
  const leave = ease(t, PHONE_LEAVES, PHONE_LEAVES + 0.6, accel)
  const place = placeAt(t)
  // The receipt holds through the opening; the walk starts from the first screen as it travels.
  const shot = t < 3.45 ? { src: FLOW, t: 62.2 } : shotAt(t)
  const drift = t < 3.1 ? 1 + 0.015 * ease(t, 0, 3.05, inOut) : 1
  // Soften the screen through each cut that happens mid-travel.
  const soften = Math.max(
    0,
    ...[3.45, 16.2, 22.6].map((c) => 1 - Math.min(1, Math.abs(t - c) / 0.22)),
  )
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        transform: `translateY(${900 * leave}px) scale(${drift})`,
        transformOrigin: `${PAIR_L.x}px ${PAIR_L.top + 300}px`,
      }}
    >
      <Handset place={place} shot={shot} soften={soften} />
      {TAPS.map((p) => {
        const at = filmTime(p.src, p.at)
        if (at === null || t < at || t > at + 0.5) return null
        return <TapRing key={p.src + p.at} t={t} at={at} {...onPhone(place, p.src, p.x, p.y)} />
      })}
    </div>
  )
}

/** A thumb's tap: a soft press, and a ring that opens and fades. White with an ink edge, so it
 * shows on teal, ink and paper alike. */
function TapRing({ t, at, x, y }: { t: number; at: number; x: number; y: number }) {
  const p = (t - at) / 0.5
  if (p < 0 || p > 1) return null
  const r = 18 + 40 * decel(p)
  const press = 1 - Math.min(1, p / 0.4)
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: x - 24,
          top: y - 24,
          width: 48,
          height: 48,
          borderRadius: 24,
          background: 'rgba(255,255,255,0.5)',
          boxShadow: '0 0 0 1.5px rgba(11,26,29,0.35)',
          opacity: press,
        }}
      />
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

/** The real seconds since OPay said "Transfer successful", counted on the recording's own clock while
 * Kova waits, held when the dollars arrive (9.7 s). */
function Timer({ t }: { t: number }) {
  if (t < 10.9 || t > 15.95) return null
  const enter = ease(t, 10.95, 11.45)
  const out = ease(t, 15.5, 15.8, accel)
  // Two frames per reading, so the digits can be read.
  const held = Math.floor(t * FPS / 2) * 2 / FPS
  const src = held < 11.0 ? 43.5 : shotAt(Math.min(held, 12.6)).t
  const seconds = Math.min(9.7, Math.max(0, src - 43.5))
  const landed = t >= 12.6
  const pop = landed ? 1 + 0.06 * (1 - ease(t, 12.6, 13.0)) : 1
  return (
    <div
      style={{
        position: 'absolute',
        left: 130,
        top: 742,
        opacity: enter * (1 - out),
        transform: `translateY(${44 * (1 - enter) - 10 * out}px)`,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 28, color: K.muted, marginBottom: 12 }}>After the bank transfer</div>
      <div
        style={{
          display: 'inline-block',
          padding: '12px 30px',
          borderRadius: 999,
          background: landed ? K.coral : K.ink,
          color: '#fff',
          fontWeight: 800,
          fontSize: 58,
          letterSpacing: '-0.02em',
          fontVariantNumeric: 'tabular-nums',
          transform: `scale(${pop})`,
          transformOrigin: 'left center',
        }}
      >
        {seconds.toFixed(1)} s
      </div>
    </div>
  )
}

/** Each line, as it's said: words rise into place on the voice; the line leaves before the next. */
type Layout = 'top' | 'left' | 'eleven'
const SHOWN: { id: keyof typeof VO; until: number; layout: Layout; accent: string[] }[] = [
  { id: 'hook', until: 3.05, layout: 'top', accent: ['on-ramps', 'off-ramps.'] },
  { id: 'in', until: 10.9, layout: 'left', accent: ['bank,'] },
  { id: 'lands', until: 15.6, layout: 'left', accent: ['10', 'seconds'] },
  { id: 'crypto', until: 22.15, layout: 'eleven', accent: ['11'] },
  { id: 'out', until: 32.3, layout: 'left', accent: ['bank.'] },
  { id: 'done', until: 35.25, layout: 'left', accent: ['11', 'seconds.'] },
]

function Words({ t }: { t: number }) {
  return (
    <>
      {SHOWN.map(({ id, until, layout, accent }) => {
        const start = VO[id]
        // The opening line is on screen from frame 0 (X's thumbnail); its two ramps light as they're said.
        const opening = id === 'hook'
        if (t < (opening ? 0 : start - 0.2) || t > until + 0.35) return null
        const out = ease(t, until, until + 0.3, accel)
        const words = lines[id]
        const rise = (w: Word) => (opening ? 1 : ease(t, start + w.start - 0.08, start + w.start + 0.32))
        const lit = (w: Word) => accent.includes(w.text) && (!opening || t >= start + w.start)
        const word = (w: Word, i: number, style?: CSSProperties) => (
          <span key={`${w.text}${i}`} style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'bottom', marginRight: '0.24em', paddingBottom: '0.04em' }}>
            <span
              style={{
                display: 'inline-block',
                transform: `translateY(${(1 - rise(w)) * 105}%)`,
                color: lit(w) ? K.coral : K.ink,
                ...style,
              }}
            >
              {w.text}
            </span>
          </span>
        )
        const base: CSSProperties = {
          position: 'absolute',
          fontWeight: 800,
          lineHeight: 1.06,
          letterSpacing: '-0.04em',
          opacity: 1 - out,
          transform: `translateY(${-10 * out}px)`,
        }
        if (layout === 'top')
          return (
            <div key={id} style={{ ...base, left: 0, right: 0, top: 78, textAlign: 'center', fontSize: 84 }}>
              {words.map((w, i) => word(w, i))}
            </div>
          )
        if (layout === 'eleven') {
          // "Or deposit crypto from" over an enormous 11, "networks." under it; then the second sentence.
          const at = words.findIndex((w) => w.text === '11')
          return (
            <div key={id} style={{ ...base, left: 1010, width: 840, top: 150 }}>
              <div style={{ fontSize: 66 }}>{words.slice(0, at).map((w, i) => word(w, i))}</div>
              <div style={{ fontSize: 470, lineHeight: 0.86, letterSpacing: '-0.07em', marginLeft: -18 }}>{word(words[at], at)}</div>
              <div style={{ fontSize: 96 }}>{word(words[at + 1], at + 1)}</div>
              <div style={{ fontSize: 66, marginTop: 36 }}>{words.slice(at + 2).map((w, i) => word(w, at + 2 + i))}</div>
            </div>
          )
        }
        return (
          <div
            key={id}
            style={{
              ...base,
              left: 130,
              width: 830,
              top: 120,
              height: 840,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              fontSize: words.length > 6 ? 92 : 108,
            }}
          >
            <div>{words.map((w, i) => word(w, i))}</div>
          </div>
        )
      })}
    </>
  )
}

/** The banner from the holder's OPay alert (opay-banner.png, 1233x216), and its ₦2,752.94. */
const BANNER = { w: 1233, h: 216, scale: 0.74, x: 104, y: 46, naira: { x: 497, w: 182, y: 133 }, at: 33.25 }

/** The signature, once: as the cash-out says "Done", the bank's own alert drops in over the words. */
function Alert({ t }: { t: number }) {
  if (t < BANNER.at || t > PHONE_LEAVES + 0.5) return null
  const drop = ease(t, BANNER.at, BANNER.at + 0.55)
  const out = ease(t, PHONE_LEAVES - 0.15, PHONE_LEAVES + 0.25, accel)
  const draw = ease(t, BANNER.at + 0.6, BANNER.at + 1.05)
  const s = BANNER.scale
  return (
    <div
      style={{
        position: 'absolute',
        left: BANNER.x,
        top: BANNER.y,
        width: BANNER.w * s,
        height: BANNER.h * s,
        opacity: Math.min(1, drop * 1.6) * (1 - out),
        transform: `translateY(${-(BANNER.h * s + 80) * (1 - drop) - 30 * out}px)`,
        filter: 'drop-shadow(0 22px 34px rgba(24,28,25,0.22))',
      }}
    >
      <Img src={staticFile('credit-alert/opay-banner.png')} style={{ width: BANNER.w * s, height: BANNER.h * s }} />
      <div
        style={{
          position: 'absolute',
          left: BANNER.naira.x * s,
          top: BANNER.naira.y * s,
          width: BANNER.naira.w * s * draw,
          height: 6,
          borderRadius: 3,
          background: K.coral,
        }}
      />
    </div>
  )
}

/** The end: Kova, then the line word by word as it's said, then the address. Kovi waves in with the
 * line (the film's one idle bob) and cheers when the address lands. */
function EndCard({ t }: { t: number }) {
  if (t < PHONE_LEAVES + 0.2) return null
  const words = lines.end
  const at = (text: string) => VO.end + (words.find((w) => w.text.startsWith(text))?.start ?? 0)
  const mark = ease(t, at('Kova') + 0.05, at('Kova') + 0.65)
  const url = ease(t, at('Try') - 0.1, at('Try') + 0.5)
  const kovi = ease(t, at('No') - 0.05, at('No') + 0.6)
  const rise = (p: number): CSSProperties => ({ opacity: p, transform: `translateY(${44 * (1 - p)}px)` })
  // "No exchange. No P2P.": each word rises on the voice, like every line before it.
  const said = words.filter((w) => w.text.startsWith('No') || w.text.startsWith('exchange') || w.text.startsWith('P2P'))
  const bob = 6 * Math.sin(((t - at('No')) / 1.4) * 2 * Math.PI) * kovi
  return (
    <>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 300, display: 'flex', justifyContent: 'center', ...rise(mark) }}>
        <Logo h={150} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 520,
          textAlign: 'center',
          fontWeight: 800,
          fontSize: 80,
          lineHeight: 1.06,
          letterSpacing: '-0.035em',
        }}
      >
        {said.map((w, i) => {
          const p = ease(t, VO.end + w.start - 0.08, VO.end + w.start + 0.32)
          return (
            <span key={`${w.text}${i}`} style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'bottom', marginRight: '0.24em', paddingBottom: '0.04em' }}>
              <span style={{ display: 'inline-block', transform: `translateY(${(1 - p) * 105}%)`, color: w.text.startsWith('P2P') ? K.coral : K.ink }}>
                {w.text}
              </span>
            </span>
          )
        })}
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 690, display: 'flex', justifyContent: 'center', ...rise(url) }}>
        <div
          style={{
            padding: '18px 44px',
            borderRadius: 999,
            background: K.ink,
            color: '#fff',
            fontWeight: 800,
            fontSize: 52,
            letterSpacing: '-0.02em',
          }}
        >
          mykova.app
        </div>
      </div>
      <Kovi pose={url > 0.5 ? 'cheer' : 'wave'} size={170} x={1290} y={720 + 30 * (1 - kovi) + bob} style={{ opacity: kovi }} />
    </>
  )
}
