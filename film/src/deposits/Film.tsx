import type { CSSProperties } from 'react'
import { AbsoluteFill, Easing, Freeze, interpolate, OffthreadVideo, staticFile, useCurrentFrame } from 'remotion'
import vo from '../../public/deposits/audio/vo.json'
import networks from '../../public/deposits/networks.json'
import { Device } from '../ios-live-v2/Device'
import { Grain, Kovi, Logo } from '../parts'

/**
 * "Deposits." Kova takes deposits from 53 networks: 28 s, 16:9, 30 fps.
 *
 * Claim: send crypto from any of 53 networks and it lands in Kova as dollars, in about a second.
 *
 * Everything is real:
 *  - The 53 networks are the live list from Kova's mainnet API on 28 Oct 2026 (networks.json).
 *  - The deposit is the account holder's own recording of that day: $5 of USDC sent from Phantom on
 *    Arc, landing as $4.97 (Relay request 0x1793196000…f6e8; Arc block 14:00:01 UTC, Monad block
 *    14:00:02 UTC; route fee $0.03, Kova's fee $0). The recording's Kova screens that name another
 *    network (the holder picked Arbitrum, then sent from Arc) are left out: the film shows Add money,
 *    Phantom's send, and Kova's receipt.
 * The holder's balances and a stranger's chat line in Phantom are blurred on every frame.
 *
 * Motion (one vocabulary): words rise into place as they're said; objects Rise (decelerated); exits
 * are an accelerated fade with a short rise. The phone is one object that leaves and comes back.
 * Signature, once: the 53 names lighting up and the counter rolling to 53.
 *
 * Layout ledger (no archetype twice in a row, none more than twice):
 *   0.0  the result     Centred hero (the phone, +$4.97, over a wall of network names)
 *   3.7  fifty-three    Extreme scale contrast (an enormous counter, every name in a grid)
 *   11.0 the send       Split (words left, the phone large and cropped right)
 *   18.5 it lands       Baseline anchor (the line above, the receipt rising from the bottom edge)
 *   23.2 end            Centred hero (mark, line and address)
 *
 * Audit: enter styles 2 · every exit animated · bouncy springs: none · camera moves 0 · accent:
 * coral only · texture: grain only · depth: the phone over the wall.
 */

export const FPS = 30
export const DURATION = 28 * FPS

/** When each voiceover line starts, in film seconds. */
export const VO = { hook: 0.3, list: 4.3, send: 11.7, this: 14.0, lands: 19.3, end: 23.6 }

const K = { paper: '#e7e5e0', page: '#e6e5e0', ink: '#0b1a1d', coral: '#d46558', muted: '#566568' }
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const decel = Easing.bezier(0.16, 1, 0.3, 1)
const accel = Easing.bezier(0.7, 0, 0.84, 0)
const inOut = Easing.bezier(0.65, 0, 0.35, 1)
const ease = (t: number, a: number, b: number, e = decel) => interpolate(t, [a, b], [0, 1], { ...clamp, easing: e })
const mix = (a: number, b: number, p: number) => a + (b - a) * p

const NAMES: string[] = networks.networks
const DEP = 'deposits/rec-deposit-cfr.mp4' // Add money and Phantom, 880x1920
const ARR = 'deposits/rec-arrival-h264.mp4' // $4.97 arriving and its receipt, 1320x2868
const SIZE: Record<string, { w: number; h: number }> = { [DEP]: { w: 880, h: 1920 }, [ARR]: { w: 1320, h: 2868 } }

type Shot = { src: string; t: number }
type Seg = { a: number; b: number; src: string; from: number; to: number }
/** Which second of which recording the phone shows (it is off screen from 4.3 to 11.0). */
const SEGS: Seg[] = [
  { a: 0, b: 4.3, src: ARR, from: 0.2, to: 4.5 }, // +$4.97 arriving
  { a: 11.0, b: 12.6, src: DEP, from: 4.3, to: 6.0 }, // Add money → Deposit crypto
  { a: 12.6, b: 14.2, src: DEP, from: 28.9, to: 31.3 }, // Phantom: $5
  { a: 14.2, b: 16.0, src: DEP, from: 39.95, to: 40.9 }, // Phantom: review, up to $0.0011 fee
  { a: 16.0, b: 17.6, src: DEP, from: 42.0, to: 44.7 }, // Sending… → Sent $5.00
  { a: 17.6, b: 18.75, src: DEP, from: 44.7, to: 44.7 }, // "Sent $5.00" holds
  { a: 18.75, b: 24.0, src: ARR, from: 11.5, to: 12.05 }, // Kova's receipt: +$4.97, fee $0.00
]

function shotAt(t: number): Shot {
  const seg = SEGS.find((s) => t < s.b) ?? SEGS[SEGS.length - 1]
  return { src: seg.src, t: seg.from + (seg.to - seg.from) * Math.min(1, Math.max(0, (t - seg.a) / (seg.b - seg.a))) }
}

function filmTime(src: string, at: number) {
  const seg = SEGS.find((s) => s.src === src && at >= s.from && at <= s.to && s.to > s.from)
  return seg ? seg.a + ((at - seg.from) / (seg.to - seg.from)) * (seg.b - seg.a) : null
}

/** Phones are placed by centre x, top edge and height. */
type Place = { x: number; top: number; h: number }
const CENTER: Place = { x: 960, top: 300, h: 1060 }
const RIGHT: Place = { x: 1400, top: 34, h: 1340 }
const BASE: Place = { x: 960, top: 330, h: 1340 }

/** Where the phone is, and how far below its place it has dropped (0 = in place). */
function phoneAt(t: number): { place: Place; drop: number } | null {
  if (t < 3.6) return { place: CENTER, drop: 0 }
  if (t < 4.3) return { place: CENTER, drop: ease(t, 3.6, 4.2, accel) }
  if (t < 11.0) return null
  if (t < 18.5) return { place: RIGHT, drop: 1 - ease(t, 11.0, 11.7) }
  if (t < 19.15) return { place: { x: mix(RIGHT.x, BASE.x, ease(t, 18.5, 19.15, inOut)), top: mix(RIGHT.top, BASE.top, ease(t, 18.5, 19.15, inOut)), h: RIGHT.h }, drop: 0 }
  if (t < 23.9) return { place: BASE, drop: ease(t, 23.2, 23.8, accel) }
  return null
}

function onPhone(place: Place, src: string, x: number, y: number) {
  const s = place.h / 2708
  const { w, h } = SIZE[src]
  const k = (1204 / w) * s
  return {
    x: place.x - (1311 * s) / 2 + 54 * s + x * k,
    y: place.top + 44 * s + ((2620 - h * (1204 / w)) / 2) * s + y * k,
  }
}

/** Taps, in the recording's own time and pixels. */
const TAPS = [
  { src: DEP, at: 4.88, x: 440, y: 940 }, // Deposit crypto
  { src: DEP, at: 29.75, x: 440, y: 1538 }, // 5
]

/** Never readable: the holder's balances, and a stranger's line in Phantom's Live Chat. */
const DARK = 'rgba(16,16,18,0.55)'
const BLURS: { src: string; from: number; to: number; boxes: { x: number; y: number; w: number; h: number }[] }[] = [
  { src: DEP, from: 28.5, to: 31.6, boxes: [{ x: 160, y: 1100, w: 124, h: 58 }] },
  {
    src: DEP,
    from: 42.25,
    to: 45.0,
    boxes: [
      { x: 640, y: 266, w: 172, h: 80 },
      { x: 120, y: 312, w: 700, h: 290 },
      { x: 30, y: 898, w: 822, h: 148 },
    ],
  },
]

type Word = { text: string; start: number; end: number }
const lines = Object.fromEntries((vo.lines as { id: string; words: Word[] }[]).map((l) => [l.id, l.words]))

export function Deposits() {
  const frame = useCurrentFrame()
  const t = frame / FPS
  return (
    <AbsoluteFill style={{ background: K.paper, fontFamily: 'Manrope', color: K.ink, overflow: 'hidden' }}>
      <Wall t={t} />
      <Count t={t} />
      <Phone t={t} />
      <Words t={t} />
      <Proof t={t} />
      <EndCard t={t} />
      <Grain frame={frame} />
    </AbsoluteFill>
  )
}

/** 0–4.2 s: every network's name, faint, drifting in rows behind the phone. */
function Wall({ t }: { t: number }) {
  if (t > 4.3) return null
  const out = ease(t, 3.6, 4.2, accel)
  const rows = 8
  const per = Math.ceil(NAMES.length / rows)
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: 1 - out }}>
      {Array.from({ length: rows }, (_, r) => {
        const names = NAMES.slice(r * per, r * per + per)
        const dir = r % 2 ? 1 : -1
        return (
          <div
            key={r}
            style={{
              position: 'absolute',
              top: 200 + r * 112,
              left: -400 + (r % 3) * 140,
              whiteSpace: 'nowrap',
              fontWeight: 800,
              fontSize: 76,
              letterSpacing: '-0.035em',
              color: 'rgba(11,26,29,0.075)',
              transform: `translateX(${dir * 26 * t}px)`,
            }}
          >
            {[...names, ...names].map((n, i) => (
              <span key={`${n}${i}`} style={{ marginRight: 56 }}>
                {n}
              </span>
            ))}
          </div>
        )
      })}
    </div>
  )
}

/** When each name lights: the five said aloud on the voice, then the other 48 in a quick cascade. */
const SAID = ['Base', 'Solana', 'Arbitrum', 'Tron', 'Bitcoin']
const listWords = lines.list
const CASCADE = { from: VO.list + (listWords.find((w) => w.text === '48')?.start ?? 4.8), span: 1.2 }
const LIT = (() => {
  const others = NAMES.filter((n) => !SAID.includes(n))
  return NAMES.map((n) => {
    const said = SAID.indexOf(n)
    if (said >= 0) {
      const word = listWords.find((w) => w.text.replace(/\W/g, '') === n)
      return { name: n, at: VO.list + (word?.start ?? said), said: true }
    }
    return { name: n, at: CASCADE.from + (others.indexOf(n) / (others.length - 1)) * CASCADE.span, said: false }
  })
})()

/** 3.7–11.2 s, the signature: an enormous counter rolling to 53 as every name lights up. */
function Count({ t }: { t: number }) {
  if (t < 3.7 || t > 11.4) return null
  // It arrives with the first name, so it never reads "0 networks".
  const enter = ease(t, 4.25, 4.85)
  const out = ease(t, 10.9, 11.25, accel)
  const lit = LIT.filter((n) => t >= n.at).length
  const done = lit === NAMES.length
  const pop = done ? 1 + 0.05 * (1 - ease(t, CASCADE.from + CASCADE.span, CASCADE.from + CASCADE.span + 0.4)) : 1
  const rows = 14
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: 1 - out, transform: `translateY(${-12 * out}px)` }}>
      <div style={{ position: 'absolute', left: 120, top: 190, opacity: enter, transform: `translateY(${44 * (1 - enter)}px)` }}>
        <div
          style={{
            fontWeight: 800,
            fontSize: 430,
            lineHeight: 0.86,
            letterSpacing: '-0.07em',
            fontVariantNumeric: 'tabular-nums',
            color: done ? K.coral : K.ink,
            transform: `scale(${pop})`,
            transformOrigin: 'left bottom',
          }}
        >
          {lit}
        </div>
        <div style={{ fontWeight: 800, fontSize: 84, letterSpacing: '-0.04em', marginTop: 18 }}>{lit === 1 ? 'network.' : 'networks.'}</div>
        <div style={{ fontWeight: 700, fontSize: 34, color: K.muted, marginTop: 14 }}>Deposit from any of them.</div>
      </div>
      {LIT.map((n, i) => {
        const col = Math.floor(i / rows)
        const row = i % rows
        const show = ease(t, 3.9 + i * 0.011, 4.4 + i * 0.011)
        const on = ease(t, n.at - 0.04, n.at + 0.18)
        return (
          <div
            key={n.name}
            style={{
              position: 'absolute',
              left: 800 + col * 262,
              top: 128 + row * 59,
              fontWeight: 700,
              fontSize: 31,
              letterSpacing: '-0.015em',
              whiteSpace: 'nowrap',
              color: n.said ? (on > 0.5 ? K.coral : K.ink) : K.ink,
              opacity: show * (0.2 + 0.8 * on),
              transform: `translateY(${(1 - show) * 18}px) scale(${1 + 0.06 * on * (1 - ease(t, n.at + 0.18, n.at + 0.5))})`,
              transformOrigin: 'left center',
            }}
          >
            {n.name}
          </div>
        )
      })}
    </div>
  )
}

/** The phone: the arrival, then Add money and Phantom's send, then Kova's receipt. */
function Phone({ t }: { t: number }) {
  const at = phoneAt(t)
  if (!at) return null
  const { place, drop } = at
  const shot = shotAt(t)
  const soften = Math.max(0, ...[18.75].map((c) => 1 - Math.min(1, Math.abs(t - c) / 0.22)))
  return (
    <div style={{ position: 'absolute', inset: 0, transform: `translateY(${1000 * drop}px)` }}>
      <Device x={place.x} y={place.top + place.h / 2} h={place.h} screen={null}>
        <div style={{ position: 'absolute', inset: 0, background: K.page, filter: soften > 0.01 ? `blur(${soften * 26}px)` : undefined }}>
          <Recording shot={shot} />
        </div>
        {/* The island as it looks while recording, wide enough to cover the recording's own. */}
        <div style={{ position: 'absolute', left: 352, top: 33, width: 490, height: 120, borderRadius: 60, background: '#000' }} />
      </Device>
      {TAPS.map((p) => {
        const when = filmTime(p.src, p.at)
        if (when === null || t < when || t > when + 0.5) return null
        return <TapRing key={p.at} t={t} at={when} {...onPhone(place, p.src, p.x, p.y)} />
      })}
    </div>
  )
}

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
              background: DARK,
              backdropFilter: 'blur(16px)',
            }}
          />
        )),
      )}
    </div>
  )
}

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

/** Each line, as it's said: words rise into place on the voice; the line leaves before the next. */
type Layout = 'top' | 'left'
const SHOWN: { id: keyof typeof VO; until: number; layout: Layout; accent: string[] }[] = [
  { id: 'hook', until: 3.6, layout: 'top', accent: ['53', 'networks.'] },
  { id: 'send', until: 13.85, layout: 'left', accent: ['any'] },
  { id: 'this', until: 18.45, layout: 'left', accent: ['$5', 'Arc.'] },
  { id: 'lands', until: 23.1, layout: 'top', accent: ['about', 'a', 'second.'] },
]

function Words({ t }: { t: number }) {
  return (
    <>
      {SHOWN.map(({ id, until, layout, accent }) => {
        const start = VO[id]
        // The opening line is on screen from frame 0 (X's thumbnail); its accent lights as it's said.
        const opening = id === 'hook'
        if (t < (opening ? 0 : start - 0.2) || t > until + 0.35) return null
        const out = ease(t, until, until + 0.3, accel)
        const words = lines[id]
        const rise = (w: Word) => (opening ? 1 : ease(t, start + w.start - 0.08, start + w.start + 0.32))
        const lit = (w: Word) => accent.includes(w.text) && (!opening || t >= start + w.start)
        const word = (w: Word, i: number) => (
          <span key={`${w.text}${i}`} style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'bottom', marginRight: '0.24em', paddingBottom: '0.04em' }}>
            <span style={{ display: 'inline-block', transform: `translateY(${(1 - rise(w)) * 105}%)`, color: lit(w) ? K.coral : K.ink }}>
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
            <div key={id} style={{ ...base, left: 60, right: 60, top: 70, textAlign: 'center', fontSize: id === 'hook' ? 78 : 86 }}>
              {/* The landing line breaks after "dollars," so "in about a second." reads as one thought. */}
              {words.map((w, i) => (
                <span key={`${w.text}${i}`}>
                  {word(w, i)}
                  {id === 'lands' && w.text === 'dollars,' ? <br /> : null}
                </span>
              ))}
            </div>
          )
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
              fontSize: words.length > 6 ? 96 : 112,
            }}
          >
            <div>{words.map((w, i) => word(w, i))}</div>
          </div>
        )
      })}
    </>
  )
}

/** "About a second", from the chain: the Arc block that took the $5 and the Monad block that paid
 * the $4.97 (Relay's record of the request), beside the receipt. */
function Proof({ t }: { t: number }) {
  const at = VO.lands + (lines.lands.find((w) => w.text === 'about')?.start ?? 2.3)
  if (t < at - 0.1 || t > 23.5) return null
  const enter = ease(t, at - 0.05, at + 0.5)
  const out = ease(t, 23.0, 23.3, accel)
  const row = (label: string, time: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 28, fontSize: 30, fontWeight: 700, padding: '6px 0' }}>
      <span>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', color: K.ink }}>{time}</span>
    </div>
  )
  return (
    <div
      style={{
        position: 'absolute',
        left: 1300,
        top: 560,
        width: 560,
        padding: '22px 30px',
        borderRadius: 28,
        background: '#f1efea',
        boxShadow: '0 0 0 2px rgba(11,26,29,0.9)',
        opacity: enter * (1 - out),
        transform: `translateY(${44 * (1 - enter) - 10 * out}px)`,
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 700, color: K.muted, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 8 }}>
        On-chain, UTC
      </div>
      {row('Sent on Arc', '14:00:01')}
      {row('Landed on Monad', '14:00:02')}
    </div>
  )
}

/** The end: Kova, the line, the address; Kovi waves in and cheers when the address lands. */
function EndCard({ t }: { t: number }) {
  if (t < 23.3) return null
  const words = lines.end
  const at = (text: string) => VO.end + (words.find((w) => w.text.startsWith(text))?.start ?? 0)
  const mark = ease(t, at('Kova') + 0.05, at('Kova') + 0.65)
  const line = ease(t, at('Kova') + 0.45, at('Kova') + 1.05)
  const url = ease(t, at('Try') - 0.1, at('Try') + 0.5)
  const kovi = ease(t, at('Kova') + 0.6, at('Kova') + 1.2)
  const bob = 6 * Math.sin(((t - at('Kova')) / 1.4) * 2 * Math.PI) * kovi
  const rise = (p: number): CSSProperties => ({ opacity: p, transform: `translateY(${44 * (1 - p)}px)` })
  return (
    <>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 300, display: 'flex', justifyContent: 'center', ...rise(mark) }}>
        <Logo h={150} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 520, textAlign: 'center', fontWeight: 800, fontSize: 80, letterSpacing: '-0.035em', ...rise(line) }}>
        Deposit from <span style={{ color: K.coral }}>53 networks.</span>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 690, display: 'flex', justifyContent: 'center', ...rise(url) }}>
        <div style={{ padding: '18px 44px', borderRadius: 999, background: K.ink, color: '#fff', fontWeight: 800, fontSize: 52, letterSpacing: '-0.02em' }}>
          mykova.app
        </div>
      </div>
      <Kovi pose={url > 0.5 ? 'cheer' : 'wave'} size={170} x={1290} y={720 + 30 * (1 - kovi) + bob} style={{ opacity: kovi }} />
    </>
  )
}
