import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, Freeze, Html5Audio, Img, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion'
import { Device, DEVICE } from '../ios-live-v2/Device'
import { accel, clamp01, decel, easeInOut, FPS, hero, mix, presenceStyle, rise, span } from '../motion'
import { Grain } from '../parts'
import { C } from '../theme'
import vo from '../../public/dollar-card/audio/vo-cut.json'

/**
 * The Kova Dollar Card, launched: the founder's own run, start to finish, with Sarah saying only
 * what the picture can't. A $5 top-up with Face ID (5:54), a $2.20 domain on Namecheap with the
 * card ending 3421 (6:04), the purchase on the card in Kova. Every number is on screen in the real
 * footage or from Nuvion's API (card fee $0); top-ups are $50 a day for now, to be raised later.
 * Nothing personal shows: the phone clips start after Home, the Namecheap clips lose the account
 * bar, and the receipt's customer box is covered.
 *
 * For a global audience: dollars, Mastercard, any shop online. Nothing tied to one country.
 *
 * Motion vocabulary: words appear as they're spoken; objects rise 44 px (0.6 s); exits are an
 * accelerated fade with an 8 px lift; the fact cards cut hard on the beat. Camera: two slow
 * push-ins, both on the desktop footage. No boxes or rings drawn over the footage.
 *
 * Every cut lands on a beat of the score (100 bpm, a bar starting at 2.0 s): the sheet 3.8, the 5
 * typed 4.4, Face ID 5.6, the new balance 7.4, then 9.2, 12.2, 15.8, 18.8, 20.6 and 23.0.
 *
 * Layout ledger:
 *   1 card + top up  0.0–9.2    split: the phone left, the line right
 *   2 spend          9.2–12.2   full-bleed footage, caption inset low left
 *   3 paid           12.2–15.8  z-depth: the receipt in a window on ink, the word beside it
 *   4 on card        15.8–18.8  split mirrored: the line left, the phone right
 *   5 facts          18.8–23.0  full-bleed type, two hard cuts on the beat
 *   6 end            23.0–27.0  centred hero on coral
 */

export const DURATION = 27.0

const F = 'Manrope, system-ui, sans-serif'
const K = { ink: C.ink, paper: C.paper, surface: C.surface, coral: C.coral, bright: '#E1705F', dim: '#566568', onInk: '#A7B8B9', tealSoft: '#A9C9C9' }

type Word = { text: string; start: number; end: number }
type Line = { id: string; file: string; duration: number; words: Word[] }
const LINES = vo.lines as Line[]
/** When each voice line starts, in film seconds. scripts/dollar-card/score.py places the same files there. */
export const VO_AT: Record<string, number> = { hook: 0.35, topup: 3.9, spend: 9.6, paid: 12.75, there: 16.15 }

// ── Footage ──────────────────────────────────────────────────────────────────────────────────────

/** The phone recordings: 1320 × 2868 at 30 fps. */
const SRC = { w: 1320, h: 2868 }
const PHONE_H = 1040
const CLIP_H = DEVICE.screen.w * (SRC.h / SRC.w)

/** `expanded`: the island is open (Face ID) for the whole cut, so the red recording dot isn't in it. */
type Cut = { at: number; to: number; from: number; hold?: boolean; expanded?: boolean }

/** Cuts of a clip, each from film second `at` to `to`, starting at clip second `from` (or held there). */
function Cuts({ src, cuts, render }: { src: string; cuts: Cut[]; render: (video: ReactNode, cut: Cut) => ReactNode }) {
  return (
    <>
      {cuts.map((c) => {
        const video = (
          <OffthreadVideo src={staticFile(src)} startFrom={c.hold ? 0 : Math.round(c.from * FPS)} muted style={{ width: '100%', height: '100%' }} />
        )
        return (
          <Sequence key={`${c.at}`} from={Math.round(c.at * FPS)} durationInFrames={Math.round((c.to - c.at) * FPS)} layout="none">
            {render(c.hold ? <Freeze frame={Math.round(c.from * FPS)}>{video}</Freeze> : video, c)}
          </Sequence>
        )
      })}
    </>
  )
}

/**
 * The island at rest, in recording pixels: pure black over 392–906 × 42–150 in every frame, with the
 * red recording dot inside it and, at times, a dark red ring 4–7 px round it. This is that whole area.
 */
const ISLAND = { x0: 386, y0: 34, x1: 915, y1: 157 }

/**
 * The phone shows its own island, recorded with the screen; the frame adds none. At rest, the island's
 * own shape is painted black over it, so the red dot and ring go and the island stays where it is.
 */
function Phone({ x, y, src, cuts, style }: { x: number; y: number; src: string; cuts: Cut[]; style?: CSSProperties }) {
  const k = DEVICE.screen.w / SRC.w
  return (
    <Device x={x} y={y} h={PHONE_H} screen={null} frame="dollar-card/device-frame-open.png" style={style}>
      <Cuts
        src={src}
        cuts={cuts}
        render={(video, cut) => (
          <div style={{ position: 'absolute', left: 0, top: (DEVICE.screen.h - CLIP_H) / 2, width: DEVICE.screen.w, height: CLIP_H }}>
            {video}
            {cut.expanded ? null : (
              <div style={{ position: 'absolute', left: ISLAND.x0 * k, top: ISLAND.y0 * k, width: (ISLAND.x1 - ISLAND.x0) * k, height: (ISLAND.y1 - ISLAND.y0) * k, borderRadius: ((ISLAND.y1 - ISLAND.y0) * k) / 2, background: '#000' }} />
            )}
          </div>
        )}
      />
    </Device>
  )
}

/** Desktop footage at 1920 wide (2880 × 1614 shown at 2/3), the account bar trimmed off the top. */
function Desk({ src, cuts, origin, push, children }: { src: string; cuts: Cut[]; origin: [number, number]; push: number; children?: ReactNode }) {
  return (
    <div style={{ position: 'absolute', left: 0, top: -26, width: 1920, height: 1076, transform: `scale(${push})`, transformOrigin: `${origin[0]}px ${origin[1]}px` }}>
      <Cuts src={src} cuts={cuts} render={(video) => <div style={{ position: 'absolute', inset: 0 }}>{video}</div>} />
      {children}
    </div>
  )
}

// ── Words ────────────────────────────────────────────────────────────────────────────────────────

const type = (size: number, color: string, extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: F, fontWeight: 700, fontSize: size, lineHeight: 1.04, letterSpacing: '-0.035em', color, margin: 0, ...extra,
})

/** A voice line's words, each appearing as it's spoken; the word being said is lit. */
function Said({ t, id, size, color = K.surface, lit = K.bright, hold = 0.7, style }: {
  t: number; id: string; size: number; color?: string; lit?: string; hold?: number; style?: CSSProperties
}) {
  const line = LINES.find((l) => l.id === id)
  if (!line) return null
  const local = t - (VO_AT[id] ?? 0)
  const end = line.duration + hold
  const gone = accel(span(local, end, end + 0.3))
  return (
    <p style={{ ...type(size, color), opacity: 1 - gone, transform: `translateY(${-8 * gone}px)`, ...style }}>
      {line.words.map((w, i) => {
        const on = decel(span(local, w.start - 0.04, w.start + 0.16))
        const now = local >= w.start && local < (line.words[i + 1]?.start ?? line.duration + 0.25)
        return (
          <span key={`${w.text}-${w.start}`} style={{ opacity: on, display: 'inline-block', transform: `translateY(${(1 - on) * 18}px)`, marginRight: size * 0.24, color: now ? lit : undefined }}>
            {w.text}
          </span>
        )
      })}
    </p>
  )
}

function Mastercard({ w = 58 }: { w?: number }) {
  return (
    <svg width={w} height={(w * 24) / 38} viewBox="0 0 38 24" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#EB001B" />
      <circle cx="26" cy="12" r="12" fill="#F79E1B" />
      <path d="M19 2.25A12 12 0 0 1 19 21.75A12 12 0 0 1 19 2.25Z" fill="#FF5F00" />
    </svg>
  )
}

function CardArt({ w, style }: { w: number; style?: CSSProperties }) {
  return (
    <div style={{ position: 'absolute', width: w, height: w * (1276 / 2024), ...style }}>
      <Img src={staticFile('dollar-card/card.png')} style={{ width: '100%', height: '100%', borderRadius: w * 0.055, display: 'block' }} />
      <div style={{ position: 'absolute', right: w * 0.05, top: w * 0.055 }}><Mastercard w={w * 0.13} /></div>
    </div>
  )
}

/** Kova's lockup for the coral end card: the mark's arcs in cream, which coral would swallow. */
function CoralLogo({ h }: { h: number }) {
  const line = { stroke: K.ink, strokeWidth: 15.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: h * 0.18 }}>
      <svg width={h} height={h} viewBox="0 0 200 200" aria-hidden="true">
        <path d="M62 46 V154" stroke={K.ink} strokeWidth={19} strokeLinecap="round" />
        {['M92.6 74.3 A40 40 0 0 1 92.6 125.7', 'M115.6 55 A70 70 0 0 1 115.6 145', 'M138.6 35.7 A100 100 0 0 1 138.6 164.3'].map((d) => (
          <path key={d} d={d} stroke={K.surface} strokeWidth={17} strokeLinecap="round" fill="none" />
        ))}
      </svg>
      <svg width={(h * 0.6 * 252) / 100} height={h * 0.6} viewBox="0 0 252 100" aria-hidden="true">
        <path d="M8 8 V92" {...line} />
        <path d="M12 70 L40 38" {...line} />
        <path d="M26 56 L44 92" {...line} />
        <circle cx={86} cy={65} r={27} fill={K.surface} stroke={K.ink} strokeWidth={15.5} />
        <path d="M130 40 L150 92 L170 40" {...line} />
        <circle cx={212} cy={66} r={26} {...line} />
        <path d="M238 40 V92" {...line} />
      </svg>
    </div>
  )
}

const TOPUP = 'dollar-card/topup-hd.mp4'
const SPENT = 'dollar-card/spent-hd.mp4'

// ── 1 · The card, then the top-up ───────────────────────────────────────────────────────────────

/**
 * Film → clip: the card screen; the sheet, where 5 is typed at clip 10.0 (film 4.4); Topping up,
 * Face ID and its tick (drawn by clip 13.4, film 6.85); the card again, $0.12 becoming $5.12 at clip
 * 18.9 (film 7.8).
 */
const TOPUP_CUTS: Cut[] = [
  { at: 0, to: 3.8, from: 0.9 },
  { at: 3.8, to: 5.6, from: 9.4 },
  { at: 5.6, to: 7.4, from: 12.15, expanded: true },
  { at: 7.4, to: 9.6, from: 18.5 },
]

function CardAndTopUp({ t }: { t: number }) {
  const out = 8.95
  const hookGone = accel(span(t, 3.42, 3.72))
  return (
    <AbsoluteFill style={{ background: K.ink }}>
      <Phone x={640} y={540} src={TOPUP} cuts={TOPUP_CUTS} style={{ opacity: 1 - accel(span(t, out, out + 0.3)) }} />
      <div style={{ position: 'absolute', left: 1080, top: 300, width: 760 }}>
        <p style={{ ...type(26, K.bright, { fontWeight: 800, letterSpacing: '0.16em' }), marginBottom: 26, opacity: 1 - hookGone, transform: `translateY(${-8 * hookGone}px)` }}>
          INTRODUCING · KOVA DOLLAR CARD
        </p>
        <Said t={t} id="hook" size={88} hold={0.35} />
      </div>
      <div style={{ position: 'absolute', left: 1080, top: 380, width: 760 }}>
        <Said t={t} id="topup" size={88} hold={3.0} />
      </div>
    </AbsoluteFill>
  )
}

// ── 2 · Spend ────────────────────────────────────────────────────────────────────────────────────

/** The cart: Confirm Order is clicked at clip 1.15 (film 10.15), then the shop thinks. */
function Spend({ t }: { t: number }) {
  const a = 9.2
  const push = 1 + 0.3 * easeInOut(span(t, a + 0.3, a + 3.2))
  const line = LINES.find((l) => l.id === 'spend')
  const at = VO_AT.spend
  const plate = rise(t, at - 0.12, at + (line?.duration ?? 2) + 0.2, 24)
  return (
    <AbsoluteFill style={{ background: '#fff' }}>
      <Desk src="dollar-card/cart.mp4" cuts={[{ at: a, to: a + 3.4, from: 0.2 }]} origin={[1513, 367]} push={push} />
      <div style={{ position: 'absolute', left: 90, bottom: 90, padding: '26px 40px 30px', borderRadius: 26, background: K.ink, ...presenceStyle(plate) }}>
        <Said t={t} id="spend" size={72} hold={0.2} />
      </div>
    </AbsoluteFill>
  )
}

// ── 3 · Paid ─────────────────────────────────────────────────────────────────────────────────────

function Underline({ t, at, x, y, w }: { t: number; at: number; x: number; y: number; w: number }) {
  const e = decel(span(t, at, at + 0.4))
  return <div style={{ position: 'absolute', left: x, top: y, width: w * e, height: 6, borderRadius: 3, background: K.coral }} />
}

/** The receipt, as the shop showed it, in a plain browser window floating on ink. The clip shows the
 * shop's previous page until 0.33 s, so it starts at 0.4. */
function Paid({ t }: { t: number }) {
  const a = 12.2
  const out = 15.5
  const W = 1320
  const k = W / 1920
  const bar = 46
  const push = 1 + 0.5 * easeInOut(span(t, a + 0.5, a + 2.3))
  return (
    <AbsoluteFill style={{ background: K.ink }}>
      <div style={{ position: 'absolute', left: 540, top: 90, width: W, height: 1050 * k + bar, borderRadius: 18, overflow: 'hidden', background: '#fff', boxShadow: '0 60px 140px rgba(0,0,0,0.55)', ...presenceStyle(rise(t, a, out, 60)) }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: bar, background: '#ECEBE8', display: 'flex', alignItems: 'center', gap: 9, padding: '0 18px', zIndex: 2 }}>
          {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => <span key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c }} />)}
          <span style={{ marginLeft: 26, padding: '6px 18px', borderRadius: 8, background: '#fff', fontFamily: F, fontSize: 17, fontWeight: 600, color: K.dim }}>namecheap.com</span>
        </div>
        <div style={{ position: 'absolute', left: 0, top: bar, width: 1920, height: 1076, transform: `scale(${k})`, transformOrigin: '0 0' }}>
          <Desk src="dollar-card/thanks.mp4" cuts={[{ at: a, to: a + 4.0, from: 0.4 }]} origin={[1560, 860]} push={push}>
            {/* The customer box (name, address, phone, email): never shown. */}
            <div style={{ position: 'absolute', left: 1366, top: 178, width: 392, height: 392, borderRadius: 10, background: '#EEEDEA' }} />
            <Underline t={t} at={a + 2.0} x={1424} y={748} w={156} />
            <Underline t={t} at={a + 2.3} x={1676} y={872} w={48} />
          </Desk>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 100, bottom: 130 }}>
        <Said t={t} id="paid" size={150} hold={1.83} />
      </div>
    </AbsoluteFill>
  )
}

// ── 4 · On the card ──────────────────────────────────────────────────────────────────────────────

/** The card after the purchase: $2.92, Namecheap's $2.20 on top. The clip is still from 0.8 (before,
 * Kova is opening) to its scroll at 2.3, so it's held at 1.5. */
function OnCard({ t }: { t: number }) {
  const a = 15.8
  const out = 18.55
  return (
    <AbsoluteFill style={{ background: K.ink }}>
      <div style={presenceStyle(rise(t, a, out, 60))}>
        <Phone x={1300} y={540} src={SPENT} cuts={[{ at: a, to: 19.2, from: 1.5, hold: true }]} />
      </div>
      <div style={{ position: 'absolute', left: 120, top: 360, width: 820 }}>
        <Said t={t} id="there" size={92} hold={0.27} />
      </div>
    </AbsoluteFill>
  )
}

// ── 5 · Facts ────────────────────────────────────────────────────────────────────────────────────

function Facts({ t }: { t: number }) {
  const cards: Array<{ from: number; bg: string; fg: string; big: string; small: string; art?: boolean }> = [
    { from: 18.8, bg: K.coral, fg: K.ink, big: 'Free card.', small: 'Kova covers it.', art: true },
    { from: 20.6, bg: K.tealSoft, fg: K.ink, big: '$50 a day.', small: "The limit for now. We'll raise it." },
  ]
  const now = [...cards].reverse().find((c) => t >= c.from)
  if (!now) return null
  const local = t - now.from
  return (
    <AbsoluteFill style={{ background: now.bg }}>
      {now.art ? (
        <CardArt w={620} style={{ right: 110, top: 240, transform: `rotate(${-6 + 2 * span(local, 0, 1.6)}deg) translateY(${-30 * decel(span(local, 0, 0.6))}px)`, boxShadow: '0 50px 100px rgba(11,26,29,0.3)', borderRadius: 40 }} />
      ) : null}
      <div style={{ position: 'absolute', left: 130, top: 330 }}>
        <p style={{ ...type(210, now.fg), ...presenceStyle(hero(local, 0)) }}>{now.big}</p>
        <p style={{ ...type(60, now.fg, { fontWeight: 600, marginTop: 26, opacity: 0.78 }), ...presenceStyle(rise(local, 0.15)) }}>{now.small}</p>
      </div>
    </AbsoluteFill>
  )
}

// ── 6 · End ──────────────────────────────────────────────────────────────────────────────────────

function End({ t }: { t: number }) {
  const a = 23.0
  const fly = decel(span(t, a, a + 0.9))
  const kovi = decel(span(t, a + 0.5, a + 1.6))
  const bob = Math.sin((t - a) * 2.4) * 6
  return (
    <AbsoluteFill style={{ background: K.coral }}>
      <div style={{ position: 'absolute', left: 110, top: 90, ...presenceStyle(rise(t, a + 0.2)) }}><CoralLogo h={70} /></div>
      <CardArt w={720} style={{ left: mix(-900, 600, fly), top: mix(700, 230, fly) + bob, transform: `rotate(${mix(-20, -5, fly)}deg)`, boxShadow: '0 60px 120px rgba(11,26,29,0.35)', borderRadius: 40 }} />
      <Img src={staticFile('art/kovi-ride.png')} style={{ position: 'absolute', width: 300, height: 300, left: mix(1960, 1360, kovi), top: mix(80, 140, kovi) - bob, opacity: clamp01(kovi * 3) }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 780, textAlign: 'center' }}>
        <p style={{ ...type(88, K.ink), ...presenceStyle(hero(t, a + 0.6)) }}>Kova Dollar Card</p>
        <div style={{ marginTop: 26, display: 'inline-block', padding: '18px 42px', borderRadius: 999, background: K.ink, color: K.surface, fontFamily: F, fontWeight: 700, fontSize: 46, ...presenceStyle(rise(t, a + 1.1)) }}>
          mykova.app
        </div>
      </div>
    </AbsoluteFill>
  )
}

export function Film() {
  const frame = useCurrentFrame()
  const t = frame / FPS
  const beat = (from: number, to: number, node: ReactNode) => (t >= from - 0.01 && t < to + 0.35 ? node : null)
  return (
    <AbsoluteFill style={{ background: K.ink, fontFamily: F }}>
      {beat(0, 9.2, <CardAndTopUp t={t} />)}
      {beat(9.2, 12.2, <Spend t={t} />)}
      {beat(12.2, 15.8, <Paid t={t} />)}
      {beat(15.8, 18.8, <OnCard t={t} />)}
      {t >= 18.8 && t < 23.0 ? <Facts t={t} /> : null}
      {beat(23.0, DURATION, <End t={t} />)}
      <Grain frame={frame} />
      <Html5Audio src={staticFile('dollar-card/score.wav')} />
    </AbsoluteFill>
  )
}
