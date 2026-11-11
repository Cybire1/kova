import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, Easing, Freeze, Html5Audio, Img, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame } from 'remotion'
import arcDots from '../arc-dots.json'
import { Device, DEVICE } from '../ios-live-v2/Device'
import { KoviRig, type KoviPose } from '../KoviRig'
import { type Curve, Flight, Grain, Kovi, Logo } from '../parts'

/**
 * "Dollars for every phone." Kova's mainnet launch film: 56 s, 16:9, 30 fps.
 *
 * Claim: Kova gets dollars to any phone: yours, a private one, one with no signal, one with no internet.
 * The structure is the claim: four phones on one line, and Kovi (the dollar) reaches each in turn.
 *
 * Everything on a phone is the real app, recorded on real runs (public/demo, public/kovaphone):
 *   01 Ada's Bakery, croissant from table 3: $3.25, "Fee $0.00, Kova covers it", Paid!
 *   02 Ada → Sam $0.15 privately ("Train tickets"): one-time address 0xc8B1…FA5c, arrived in 1.10 s; its
 *      ERC-5564 announcement on Monadscan (announcer 0x5564…5564, the sealed note in its metadata).
 *   03 Sam → Lucia $0.25 signed with no signal, shown as a code; Lucia's phone: "Paid with no signal",
 *      then "Settled on Monad".
 *   04 Afeez → a Nigerian number (hidden here), $1.00, arrived in 1.31 s; that phone's text "$1.00 arrived in your USSD
 *      pocket. Balance $10.25"; the USSD menu (services/ussd.ts); a live cash-out quote from Kova's API,
 *      $5.00 → ₦6,556.93 at ₦1,316.39, Chainlink's rate on Monad. "OPay ••5678" stands for her account.
 *   05 Cards with a $50 daily limit (README card), Claude paying $0.20 with its own key and asking above
 *      $0.50 (the demo), monad.nad → 0x771C…6dD4, $20 abroad arriving ≈ €18.40, private payroll.
 *
 * Sound: kovaphone/music-a (ElevenLabs, 103.4 BPM), extended on beats (scripts/every-phone/music.sh), under
 * the film's own sound design, synthesised and tuned to it (sfx.py), mixed and mastered (mix.sh).
 * Beats at 0.81 + 0.5803 j s; downbeats D(k) = 24.3 + 69.63 k frames. Every cut is 2 frames before one.
 *
 * Motion (one vocabulary): text rises through a mask; objects Rise (y 44 → 0, decelerated); exits are an
 * accelerated fade with a short rise. Kovi is the only bouncy spring. Camera: three moves (the push from
 * the line into the first phone, the drift over the globe, the pull back to the line). Signature, once:
 * Kovi dives into Grandma's basic phone and becomes the text she receives.
 *
 * Layout ledger (no archetype twice in a row, none more than twice):
 *   0.0  hook       Baseline anchor (four phones on one horizon)
 *   5.4  your phone Split (words left, phone right)
 *   8.7  $0.00      Extreme scale contrast (a giant number, a small line)
 *   12.3 private    Z-axis cascade (Ada's phone behind, address cards in front, rotated)
 *   16.0 announcer  Full-bleed (the real Monadscan event, edge to edge)
 *   19.2 Sam        Split, unequal (Sam's phone left, words right)
 *   21.6 no signal  Asymmetric bento (Sam's phone large, Lucia's two moments stacked)
 *   28.6 globe      Full-bleed (the painted globe)
 *   33.3 the text   Extreme scale contrast (a huge basic phone, four small words)
 *   35.6 the code   Centred hero (the phone, the code above it)
 *   39.2 cash out   Editorial left (words hard left, the phone small right)
 *   42.5 the rest   Asymmetric bento (five tiles)
 *   49.5 end        Baseline anchor (the four phones lit, Kovi between them)
 *
 * Audit: enter styles 2 · runs without a ≥1.5 s hold 0 · every exit animated · bouncy springs: Kovi ·
 * camera moves 3 · text accent: coral only · texture: grain only · depth: the Z cascade and the globe.
 */

export const FPS = 30
export const DURATION = 1680
const D = (k: number) => 24.3 + 69.633 * k
const CUT = { ch1: 161, priv: 370, off: 649, gma: 858, all: 1275, end: 1484 }

const K = {
  paper: '#e7e5e0',
  surface: '#f1efea',
  ink: '#0b1a1d',
  coral: '#d46558',
  coralSoft: '#ebb3aa',
  teal: '#46878B',
  tealSoft: '#A9C9C9',
  muted: '#566568',
  cream: '#f7f3e9',
}

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const decel = Easing.bezier(0.16, 1, 0.3, 1)
const inOut = Easing.bezier(0.65, 0, 0.35, 1)
const accel = Easing.bezier(0.7, 0, 0.84, 0)
const ease = (f: number, a: number, b: number, e = decel) => interpolate(f, [a, b], [0, 1], { ...clamp, easing: e })
const mix = (a: number, b: number, p: number) => a + (b - a) * p
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
/** Soft: objects settle without overshoot. */
const soft = (f: number, at: number) => spring({ frame: f - at, fps: FPS, config: { stiffness: 140, damping: 26 } })

/* ── Ground, type ─────────────────────────────────────────────────────────────────────────── */

function Paper({ f }: { f: number }) {
  return (
    <AbsoluteFill style={{ background: 'radial-gradient(ellipse 80% 70% at 50% 45%, #f6f3ec 0%, #ece8e1 55%, #e2dfd9 100%)' }}>
      <Grain frame={f} />
    </AbsoluteFill>
  )
}

/** Text rises through a mask, and leaves the way it came. The film's one text enter. */
function Words({ f, at, leave, size, children, x = 0, y, center = false, weight = 800, color = K.ink, style }: {
  f: number; at: number; leave?: number; size: number; children: ReactNode; x?: number; y: number; center?: boolean; weight?: number; color?: string; style?: CSSProperties
}) {
  if (f < at - 1) return null
  const e = ease(f, at, at + 18)
  const l = leave === undefined ? 0 : ease(f, leave, leave + 10, accel)
  if (l >= 1) return null
  return (
    <div style={{ position: 'absolute', left: center ? 0 : x, right: center ? 0 : undefined, top: y, overflow: 'hidden', paddingBottom: size * 0.16, textAlign: center ? 'center' : 'left', ...style }}>
      <div
        style={{
          fontFamily: 'Manrope', fontSize: size, fontWeight: weight, lineHeight: 1.04, color,
          letterSpacing: -size * (weight >= 800 ? 0.045 : 0.012), whiteSpace: 'nowrap',
          transform: `translateY(${(1 - e) * size * 1.3 - l * size * 1.3}px)`, opacity: 1 - l,
        }}
      >
        {children}
      </div>
    </div>
  )
}

const Dot = () => <span style={{ color: K.coral }}>.</span>

function Eyebrow({ f, at, leave, n, label, x, y, color = K.ink }: { f: number; at: number; leave?: number; n: string; label: string; x: number; y: number; color?: string }) {
  return (
    <Words f={f} at={at} leave={leave} size={24} weight={800} x={x} y={y} color={color} style={{ letterSpacing: 0 }}>
      <span style={{ letterSpacing: 3 }}>
        <span style={{ color: K.coral }}>{n}</span>
        <span style={{ display: 'inline-block', width: 18 }} />
        {label}
      </span>
    </Words>
  )
}

/** An object's one enter (Rise) and one exit (accelerated fade, short rise). */
function presence(f: number, at: number, leave?: number) {
  const e = ease(f, at, at + 18)
  const l = leave === undefined ? 0 : ease(f, leave, leave + 10, accel)
  return { o: e * (1 - l), y: (1 - e) * 44 - l * 12 }
}

function Chip({ children, dark = false, style }: { children: ReactNode; dark?: boolean; style?: CSSProperties }) {
  return (
    <div
      style={{
        position: 'absolute', display: 'inline-flex', alignItems: 'center', gap: 12, padding: '12px 22px', borderRadius: 999,
        background: dark ? K.ink : K.surface, color: dark ? K.cream : K.ink, border: `3px solid ${K.ink}`,
        fontFamily: 'Manrope', fontSize: 26, fontWeight: 800, whiteSpace: 'nowrap', ...style,
      }}
    >
      {children}
    </div>
  )
}

/* ── Phones ───────────────────────────────────────────────────────────────────────────────── */

type Pos = { x: number; y: number; h: number }
/** Screen units per recording pixel: recordings are 394 × 854, the frame's screen 1204 wide. */
const RS = DEVICE.screen.w / 394
const RTOP = (DEVICE.screen.h - 854 * RS) / 2

/** A point in a recording (394 × 854), in film pixels, for a phone at `p`. */
function onRec(p: Pos, rx: number, ry: number) {
  const s = p.h / DEVICE.h
  return { x: p.x - (DEVICE.w * s) / 2 + (DEVICE.screen.x + rx * RS) * s, y: p.y - p.h / 2 + (DEVICE.screen.y + RTOP + ry * RS) * s, k: RS * s }
}

/** A real recording in the screen: playing from `from` seconds at film frame `at`, or held at `hold`. */
function Rec({ src, at = 0, from = 0, hold }: { src: string; at?: number; from?: number; hold?: number }) {
  const video = <OffthreadVideo src={staticFile(src)} startFrom={Math.round(from * FPS)} muted style={{ position: 'absolute', left: 0, top: RTOP, width: DEVICE.screen.w, height: 854 * RS }} />
  if (hold !== undefined)
    return (
      <AbsoluteFill>
        <Freeze frame={Math.round(hold * FPS)}>
          <OffthreadVideo src={staticFile(src)} muted style={{ position: 'absolute', left: 0, top: RTOP, width: DEVICE.screen.w, height: 854 * RS }} />
        </Freeze>
      </AbsoluteFill>
    )
  return (
    <Sequence from={at} layout="none">
      <AbsoluteFill>{video}</AbsoluteFill>
    </Sequence>
  )
}

/** The sender's web wallet was recorded with a border: 512 × 1070, the screen at x 10–511, y 4–1069. */
function WebRec({ hold }: { hold: number }) {
  const k = DEVICE.screen.h / 1066
  const left = -10 * k - (502 * k - DEVICE.screen.w) / 2
  return (
    <AbsoluteFill style={{ background: K.paper }}>
      <Freeze frame={Math.round(hold * FPS)}>
        <OffthreadVideo src={staticFile('kovaphone/app.mp4')} muted style={{ position: 'absolute', left, top: -4 * k, width: 512 * k, height: 1070 * k }} />
      </Freeze>
    </AbsoluteFill>
  )
}

/** A ring around part of a recording, in recording pixels, drawn inside the screen. */
function Ring({ f, at, leave, rx, ry, rw, rh, r = 26 }: { f: number; at: number; leave?: number; rx: number; ry: number; rw: number; rh: number; r?: number }) {
  if (f < at) return null
  const p = ease(f, at, at + 10)
  const l = leave === undefined ? 0 : ease(f, leave, leave + 8, accel)
  return (
    <div
      style={{
        position: 'absolute', left: rx * RS - 18, top: RTOP + ry * RS - 18, width: rw * RS + 36, height: rh * RS + 36, borderRadius: r * RS + 18,
        border: `16px solid ${K.coral}`, opacity: p * (1 - l), transform: `scale(${1 + (1 - p) * 0.05})`,
      }}
    />
  )
}

/** A thumb's press, in recording pixels. */
function Press({ f, at, rx, ry }: { f: number; at: number; rx: number; ry: number }) {
  const d = f - at
  if (d < -4 || d > 12) return null
  const p = d < 0 ? (d + 4) / 4 : 1 - d / 12
  return <div style={{ position: 'absolute', left: rx * RS - 110, top: RTOP + ry * RS - 110, width: 220, height: 220, borderRadius: 999, background: 'rgba(11,26,29,.2)', border: '8px solid rgba(255,255,255,.8)', opacity: p, transform: `scale(${0.8 + p * 0.2})` }} />
}

/** A held region of a recording, as a flat card of its own pixels. */
function Crop({ src, hold, rx, ry, rw, rh, scale, style }: { src: string; hold: number; rx: number; ry: number; rw: number; rh: number; scale: number; style?: CSSProperties }) {
  return (
    <div style={{ position: 'absolute', width: rw * scale, height: rh * scale, overflow: 'hidden', borderRadius: 18 * scale, ...style }}>
      <Freeze frame={Math.round(hold * FPS)}>
        <OffthreadVideo src={staticFile(src)} muted style={{ position: 'absolute', left: -rx * scale, top: -ry * scale, width: 394 * scale, height: 854 * scale }} />
      </Freeze>
    </div>
  )
}

/* ── Grandma's phone ──────────────────────────────────────────────────────────────────────── */

const BP = { w: 420, h: 900 }
const KEYS = [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'], ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['*', ''], ['0', '+'], ['#', '']] as const

/**
 * A basic phone, drawn in Kova's sticker style: an ink candybar, a green LCD, real keys. `x`, `top`
 * and `h` place it; the LCD shows `children`, its letters made of dots like a real LCD's.
 */
function BasicPhone({ x, top, h, children, lit = 1, press, rot = 0, shake = 0, style }: {
  x: number; top: number; h: number; children?: ReactNode; lit?: number; press?: string | null; rot?: number; shake?: number; style?: CSSProperties
}) {
  const s = h / BP.h
  return (
    <div style={{ position: 'absolute', left: x - (BP.w * s) / 2 + shake, top, width: BP.w * s, height: h, transform: `rotate(${rot}deg)`, ...style }}>
      <div style={{ position: 'absolute', width: BP.w, height: BP.h, transform: `scale(${s})`, transformOrigin: 'top left', fontFamily: 'Manrope' }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: 96, background: 'linear-gradient(160deg, #24434a 0%, #12292e 42%, #0b1a1d 100%)', border: `8px solid ${K.ink}`, boxShadow: '0 70px 110px -50px rgba(11,26,29,.55), inset 0 4px 0 rgba(255,255,255,.14), inset 0 -8px 0 rgba(0,0,0,.35)' }} />
        <div style={{ position: 'absolute', left: 170, top: 42, width: 80, height: 12, borderRadius: 6, background: '#33494d' }} />
        {/* the LCD */}
        <div style={{ position: 'absolute', left: 44, top: 92, width: 332, height: 356, borderRadius: 34, background: '#07141a' }}>
          <div style={{ position: 'absolute', inset: 14, borderRadius: 22, overflow: 'hidden', background: `linear-gradient(180deg, ${lit > 0.5 ? '#d9e8d9' : '#9fb3a5'} 0%, ${lit > 0.5 ? '#bdd3c0' : '#8ca091'} 100%)`, boxShadow: 'inset 0 6px 14px rgba(0,0,0,.25)' }}>
            <div style={{ position: 'absolute', inset: 0, opacity: 0.18, backgroundImage: 'repeating-linear-gradient(0deg, #3b5a48 0 1px, transparent 1px 4px), repeating-linear-gradient(90deg, #3b5a48 0 1px, transparent 1px 4px)' }} />
            <div style={{ position: 'absolute', left: 16, right: 16, top: 10, display: 'flex', justifyContent: 'space-between', fontSize: 17, fontWeight: 800, color: '#1d332b', letterSpacing: 0.5 }}>
              <span>▂▄▆ MTN</span>
              <span>no data</span>
            </div>
            <div style={{ position: 'absolute', left: 18, right: 18, top: 42, bottom: 14, color: '#10241c', opacity: 0.25 + 0.75 * lit, WebkitMaskImage: 'radial-gradient(circle, #000 0 1.15px, transparent 1.45px)', WebkitMaskSize: '3px 3px' }}>
              {children}
            </div>
          </div>
        </div>
        {/* soft keys and the round select key */}
        <div style={{ position: 'absolute', left: 56, top: 474, width: 92, height: 32, borderRadius: 16, background: '#1c3236', boxShadow: 'inset 0 2px 0 rgba(255,255,255,.08)' }} />
        <div style={{ position: 'absolute', left: 272, top: 474, width: 92, height: 32, borderRadius: 16, background: '#1c3236', boxShadow: 'inset 0 2px 0 rgba(255,255,255,.08)' }} />
        <div style={{ position: 'absolute', left: 164, top: 462, width: 92, height: 92, borderRadius: 999, background: '#16292d', border: '6px solid #2a4247' }} />
        {/* the keypad */}
        {KEYS.map(([k, sub], i) => {
          const on = press === k
          return (
            <div key={k} style={{ position: 'absolute', left: 54 + (i % 3) * 110, top: 576 + Math.floor(i / 3) * 76, width: 92, height: 62, borderRadius: 20, background: on ? K.coral : '#1c3236', color: on ? K.ink : '#e3ece7', boxShadow: on ? 'none' : 'inset 0 3px 0 rgba(255,255,255,.08)', transform: `scale(${on ? 0.94 : 1})`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
              <span style={{ fontSize: 28, fontWeight: 800 }}>{k}</span>
              {sub ? <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.7, marginTop: 3, letterSpacing: 1 }}>{sub}</span> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Where a point of the basic phone (in its 420 × 900 drawing) lands in the film. */
const onBasic = (x: number, top: number, h: number, px: number, py: number) => ({ x: x - (BP.w * h) / BP.h / 2 + (px * h) / BP.h, y: top + (py * h) / BP.h })

const SMS = 'Kova: $1.00 arrived in your USSD pocket. Balance $10.25. Dial *384*53916# to use it.'
const MENU = ['Kova', '1 Balance', '2 Pay a till', '3 Send to a phone', '4 My payments', '5 Cash out']

/* ── Kovi ─────────────────────────────────────────────────────────────────────────────────── */

type Pt = { x: number; y: number }
/** A jump: x moves at a steady pace, y on a parabola, so it reads as weight. */
function jump(f: number, t0: number, t1: number, a: Pt, b: Pt, apex: number): Pt {
  const u = clamp01((f - t0) / (t1 - t0))
  return { x: mix(a.x, b.x, u), y: mix(a.y, b.y, u) - 4 * apex * u * (1 - u) }
}

/** Kovi's body through a jump: a crouch before, stretch in the air, a squash on landing. */
function jumpPose(f: number, t0: number, t1: number, lookX = 1): KoviPose {
  const pre = clamp01((f - (t0 - 5)) / 5) * (f < t0 ? 1 : 0)
  const air = f >= t0 && f < t1
  const land = f >= t1 ? Math.max(0, 1 - (f - t1) / 7) : 0
  return {
    crouch: pre * 0.55 + land * 0.5,
    sy: air ? 1.06 : 1 - land * 0.14 - pre * 0.06,
    sx: air ? 0.96 : 1 + land * 0.1,
    armL: air ? -150 : -34,
    armR: air ? 150 : 155,
    mouth: air ? 'o' : 'grin',
    look: { x: lookX, y: air ? -0.3 : 0.2 },
    happy: air ? 0 : 0.2,
  }
}

/* ── 0 · Hook: four phones on one line ───────────────────────────────────────────────────── */

const LINE: Pos[] = [
  { x: 380, y: 700, h: 600 },
  { x: 760, y: 700, h: 600 },
  { x: 1140, y: 700, h: 600 },
]
const BASIC_LINE = { x: 1540, top: 500, h: 500 }
const LANDINGS = [24, 59, 94, 129]
const LABELS = ['Your phone', 'Private', 'No signal', 'No internet']
const TOPS: Pt[] = [{ x: 380, y: 400 }, { x: 760, y: 400 }, { x: 1140, y: 400 }, { x: 1540, y: 500 }]
const CH1_PHONE: Pos = { x: 1330, y: 548, h: 900 }

function Hook({ f }: { f: number }) {
  const push = ease(f, 132, 164, inOut)
  const p0: Pos = { x: mix(LINE[0]!.x, CH1_PHONE.x, push), y: mix(LINE[0]!.y, CH1_PHONE.y, push), h: mix(LINE[0]!.h, CH1_PHONE.h, push) }
  const lit = (i: number) => ease(f, LANDINGS[i]!, LANDINGS[i]! + 6)
  const recede = ease(f, 128, 150, accel)
  // Kovi: falls in, hops phone to phone on the beat, then dives into the first phone's screen.
  let at: Pt = TOPS[0]!
  let pose: KoviPose = {}
  let scale = 1
  if (f < LANDINGS[0]!) {
    at = jump(f, -14, LANDINGS[0]!, { x: 60, y: 150 }, TOPS[0]!, 60)
    pose = jumpPose(f, -14, LANDINGS[0]!)
  } else if (f < 130 + 8) {
    let i = 0
    while (i < 3 && f >= LANDINGS[i + 1]! - 23) i++
    const t1 = LANDINGS[i]!
    const t0 = t1 - 23
    at = i === 0 ? TOPS[0]! : jump(f, t0, t1, TOPS[i - 1]!, TOPS[i]!, 80)
    pose = i === 0 ? jumpPose(f, -14, LANDINGS[0]!) : jumpPose(f, t0, t1)
    if (f >= LANDINGS[3]!) pose = { ...jumpPose(f, t0, t1, -1), armL: -10 + Math.sin((f - 129) / 2.2) * 25, waveLines: 0.8 }
  } else {
    const target = onRec(p0, 197, 420)
    at = jump(f, 138, 160, TOPS[3]!, target, 160)
    pose = { ...jumpPose(f, 138, 160, -1), mouth: 'o' }
    scale = 1 - ease(f, 148, 160, accel)
  }
  return (
    <AbsoluteFill style={{ fontFamily: 'Manrope' }}>
      <Paper f={f} />
      <Words f={f} at={-16} leave={126} size={100} y={54} center>Dollars for every phone<Dot /></Words>
      {/* contact shadows on the line */}
      {[...LINE.map((p) => p.x), BASIC_LINE.x].map((x, i) => (
        <div key={`sh${x}`} style={{ position: 'absolute', left: x - (i < 3 ? 130 : 100), top: 984 + (i === 0 ? push * 60 : recede * 40), width: i < 3 ? 260 : 200, height: 30, borderRadius: '50%', background: 'rgba(11,26,29,.16)', filter: 'blur(10px)', opacity: i === 0 ? 1 - push : 1 - recede }} />
      ))}
      {/* a soft light behind each phone as Kovi lights it */}
      {[...LINE.map((p) => ({ x: p.x, y: p.y })), { x: BASIC_LINE.x, y: BASIC_LINE.top + BASIC_LINE.h / 2 }].map((p, i) => (
        <div key={`gl${p.x}`} style={{ position: 'absolute', left: p.x - 380, top: p.y - 460, width: 760, height: 920, background: `radial-gradient(closest-side, rgba(255,250,240,${0.95 * lit(i)}), rgba(255,250,240,0))`, opacity: i === 0 ? 1 - push : 1 - recede }} />
      ))}
      {/* the three smartphones */}
      {LINE.map((p, i) => {
        const pos = i === 0 ? p0 : { ...p, y: p.y + recede * 40 }
        const glow = Math.max(0, 1 - (f - LANDINGS[i]!) / 14) * (f >= LANDINGS[i]! ? 1 : 0)
        return (
          <Device key={p.x} x={pos.x} y={pos.y} h={pos.h} screen={null} style={{ filter: `brightness(${0.74 + 0.26 * lit(i)})`, opacity: i === 0 ? 1 : 1 - recede, transform: i === 0 ? undefined : `scale(${1 - recede * 0.08})` }}>
            {i === 0 ? (f < 147 ? <Rec src="demo/cafe.mp4" hold={0.4} /> : <Rec src="demo/cafe.mp4" at={147} from={5.3 - 14 / FPS} />) : null}
            {i === 1 ? <Rec src="demo/arrival.mp4" at={0} from={0} /> : null}
            {i === 2 ? <Rec src="demo/offline.mp4" hold={6} /> : null}
            {glow > 0 ? <AbsoluteFill style={{ boxShadow: `inset 0 0 0 ${30 * glow}px rgba(212,101,88,${0.55 * glow})` }} /> : null}
          </Device>
        )
      })}
      {/* Grandma's */}
      <BasicPhone x={BASIC_LINE.x} top={BASIC_LINE.top + recede * 40} h={BASIC_LINE.h} lit={lit(3)} style={{ opacity: 1 - recede, filter: `brightness(${0.75 + 0.25 * lit(3)})` }}>
        {f >= LANDINGS[3]! ? (
          <div style={{ fontSize: 21, lineHeight: 1.32, fontWeight: 700 }}>
            <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: 1.5, opacity: 0.8 }}>NEW MESSAGE</div>
            <div style={{ marginTop: 6 }}>{SMS}</div>
          </div>
        ) : null}
      </BasicPhone>
      {/* labels on the line */}
      {LABELS.map((l, i) => {
        const pr = presence(f, LANDINGS[i]! + 1, 124)
        const x = i < 3 ? LINE[i]!.x : BASIC_LINE.x
        return (
          <div key={l} style={{ position: 'absolute', left: x - 160, width: 320, top: 1016, textAlign: 'center', fontFamily: 'Manrope', fontSize: 24, fontWeight: 800, letterSpacing: 2.5, textTransform: 'uppercase', color: i === 3 ? K.coral : K.ink, opacity: pr.o, transform: `translateY(${pr.y * 0.4}px)` }}>
            {l}
          </div>
        )
      })}
      {scale > 0 ? <KoviRig x={at.x} y={at.y} size={150 * scale} pose={pose} /> : null}
      {LANDINGS.map((l, i) => (f >= l && f < l + 12 ? <Puff key={`p${l}`} f={f - l} x={TOPS[i]!.x} y={TOPS[i]!.y} /> : null))}
    </AbsoluteFill>
  )
}

/** Air pushed out from under Kovi's feet when he lands. */
function Puff({ f, x, y }: { f: number; x: number; y: number }) {
  const p = ease(f, 0, 12)
  return (
    <>
      {[-1, 1].flatMap((side) =>
        [0, 1, 2].map((k) => (
          <div key={`${side}${k}`} style={{ position: 'absolute', left: x + side * (26 + p * (40 + k * 26)) - 9, top: y - 10 - p * (10 + k * 6), width: 18 - k * 4, height: 18 - k * 4, borderRadius: 99, background: '#cbc4b8', opacity: (1 - p) * 0.9 }} />
        )),
      )}
    </>
  )
}

/* ── 01 · Your phone ─────────────────────────────────────────────────────────────────────── */

function YourPhone({ f }: { f: number }) {
  // f is local: 0 at the cut. The café recording was started at the hook's frame 147, at 5.3 s.
  const recede = ease(f, 103, 125, inOut)
  const p: Pos = { x: mix(CH1_PHONE.x, 1520, recede), y: CH1_PHONE.y, h: mix(CH1_PHONE.h, 760, recede) }
  const out = ease(f, 197, 209, accel)
  const chip = presence(f, 73, 99)
  return (
    <AbsoluteFill>
      <Paper f={f} />
      <Eyebrow f={f} at={3} leave={99} n="01" label="YOUR PHONE" x={124} y={300} />
      <Words f={f} at={5} leave={99} size={124} x={114} y={348}>Pay a shop.</Words>
      <Words f={f} at={11} leave={101} size={124} x={114} y={482}>One tap<Dot /></Words>
      <Chip style={{ left: 120, top: 676, opacity: chip.o, transform: `translateY(${chip.y}px)` }}>
        <span style={{ color: K.coral }}>✓</span> $3.25 to Ada’s Bakery, paid
      </Chip>

      <Words f={f} at={109} leave={197} size={330} x={96} y={250}>$0.00</Words>
      <Words f={f} at={119} leave={199} size={52} weight={600} color={K.muted} x={118} y={650}>in fees. Kova pays the gas.</Words>

      <Device x={p.x} y={p.y + out * 20} h={p.h} screen={null} style={{ opacity: 1 - out }}>
        <Rec src="demo/cafe.mp4" at={147} from={5.3 - 14 / FPS} />
        <Ring f={f} at={18} leave={58} rx={16} ry={698} rw={362} rh={36} r={14} />
        <Press f={f} at={49} rx={36} ry={786} />
      </Device>
    </AbsoluteFill>
  )
}

/* ── 02 · Private ────────────────────────────────────────────────────────────────────────── */

const ADA: Pos = { x: 560, y: 560, h: 880 }
const SAM: Pos = { x: 600, y: 548, h: 900 }
const FRONT = { x: 1290, y: 720 }

const HEX = '0123456789abcdef'
function scramble(f: number, seed: number) {
  let s = '0x'
  for (let i = 0; i < 40; i++) s += HEX[(i * 7 + seed * 13 + Math.floor(f / 2) * (i + 3)) % 16]
  return `${s.slice(0, 6)}…${s.slice(-4)}`
}

function AddressCard({ label, value, sub, live = true, style }: { label: string; value: string; sub?: string; live?: boolean; style?: CSSProperties }) {
  return (
    <div style={{ position: 'absolute', width: 640, padding: '30px 36px', borderRadius: 40, background: live ? K.surface : '#e2ded6', border: `4px solid ${K.ink}`, boxShadow: '0 40px 80px -40px rgba(11,26,29,.45)', fontFamily: 'Manrope', ...style }}>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 3, color: live ? K.coral : K.muted }}>{label}</div>
      <div style={{ fontFamily: 'Menlo, monospace', fontSize: 58, fontWeight: 700, marginTop: 8, color: live ? K.ink : '#7d8a8b', letterSpacing: -1 }}>{value}</div>
      {sub ? <div style={{ fontSize: 26, fontWeight: 600, color: K.muted, marginTop: 6 }}>{sub}</div> : null}
    </div>
  )
}

/** The sealed note: a little envelope with a coral seal. */
function Envelope({ x, y, s = 1, rot = 0, o = 1 }: { x: number; y: number; s?: number; rot?: number; o?: number }) {
  return (
    <div style={{ position: 'absolute', left: x - 90, top: y - 62, width: 180, height: 124, opacity: o, transform: `rotate(${rot}deg) scale(${s})` }}>
      <svg width={180} height={124} viewBox="0 0 180 124">
        <rect x={4} y={4} width={172} height={116} rx={16} fill="#f6e7c9" stroke={K.ink} strokeWidth={6} />
        <path d="M8 12 L90 70 L172 12" fill="none" stroke={K.ink} strokeWidth={6} strokeLinejoin="round" />
        <circle cx={90} cy={70} r={20} fill={K.coral} stroke={K.ink} strokeWidth={5} />
        <path d="M82 70 l6 6 l11 -12" fill="none" stroke={K.cream} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

/** Monadscan's event log for the announcement (public/demo/scan-announce.png, 1920 × 1080). */
const SCAN = { announcer: { x: 462, y: 280, w: 356, h: 38 }, stealth: { x: 628, y: 448, w: 350, h: 32 }, bytes: { x: 590, y: 562, w: 908, h: 108 } }
/** The scan is shown at 1.38×, framed on its event log (scan point 930, 470 → film 1060, 620). */
const Z = 1.38
const ZT = { x: 1060 - 930 * Z, y: 620 - 470 * Z }
const zb = (b: { x: number; y: number; w: number; h: number }) => ({ x: b.x * Z + ZT.x, y: b.y * Z + ZT.y, w: b.w * Z, h: b.h * Z })

function Private({ f }: { f: number }) {
  const ada = presence(f, 0, 100)
  const front = ease(f, 54, 76, Easing.bezier(0.2, 0.9, 0.25, 1))
  const origin = onRec(ADA, 197, 390)
  const cardsOut = ease(f, 100, 110, accel)
  const scan = presence(f, 108, 200)
  const sam = presence(f, 206)
  const out = ease(f, 268, 279, accel)
  // the sealed note's trip: out of the card, onto the announcement's bytes, then into Sam's phone
  const toBytes = ease(f, 140, 160, inOut)
  const toSam = ease(f, 210, 234, inOut)
  const note = onRec(SAM, 200, 605)
  const bytes = zb(SCAN.bytes)
  const bx = bytes.x + bytes.w / 2
  const by = bytes.y + bytes.h / 2
  const env = f < 140 ? { x: FRONT.x + 200, y: FRONT.y - 150 } : f < 200 ? { x: mix(1680, bx, toBytes), y: mix(140, by, toBytes) - Math.sin(toBytes * Math.PI) * 120 } : { x: mix(bx, note.x, toSam), y: mix(by, note.y, toSam) - Math.sin(toSam * Math.PI) * 160 }
  const envShown = (f >= 96 && f < 106) || (f >= 136 && f < 168) || (f >= 206 && f < 236)
  const envScale = f < 106 ? soft(f, 96) : f < 168 ? 1 - ease(f, 160, 168, accel) * 0.6 : 1 - ease(f, 228, 236, accel)
  return (
    <AbsoluteFill style={{ opacity: 1 - out }}>
      <Paper f={f} />

      {/* a: Ada sends it privately (her real phone, at the back) */}
      {f < 112 ? (
        <>
          <Eyebrow f={f} at={4} leave={48} n="02" label="PRIVATE" x={872} y={212} />
          <Words f={f} at={6} leave={48} size={100} x={864} y={258}>Send it privately<Dot /></Words>
          <Words f={f} at={54} leave={100} size={84} x={866} y={190}>Each payment gets</Words>
          <Words f={f} at={60} leave={102} size={84} x={866} y={290}>a new address<Dot /></Words>
          <Device x={ADA.x} y={ADA.y + ada.y} h={ADA.h} screen={null} style={{ opacity: ada.o, transform: `rotate(-2deg) scale(${1 - front * 0.04})`, filter: `brightness(${1 - front * 0.12})` }}>
            <Rec src="demo/private.mp4" at={CUT.priv} from={0} />
            {f >= 42 ? <Rec src="demo/private.mp4" at={CUT.priv + 42} from={4.7} /> : null}
            <Ring f={f} at={10} leave={36} rx={14} ry={470} rw={366} rh={76} r={22} />
            <Press f={f} at={28} rx={38} ry={592} />
          </Device>
          {/* the cards: this payment's address in front; the next ones still being made */}
          {f >= 68 ? <AddressCard label="THE ONE AFTER" value={scramble(f, 2)} live={false} style={{ left: FRONT.x - 180, top: FRONT.y - 250, transform: `rotate(5deg) translateY(${(1 - soft(f, 74)) * 40}px)`, opacity: clamp01(soft(f, 74)) * (1 - cardsOut) }} /> : null}
          {f >= 62 ? <AddressCard label="NEXT PAYMENT" value={scramble(f, 1)} live={false} style={{ left: FRONT.x - 250, top: FRONT.y - 170, transform: `rotate(2deg) translateY(${(1 - soft(f, 68)) * 40}px)`, opacity: clamp01(soft(f, 68)) * (1 - cardsOut) }} /> : null}
          {f >= 54 ? (
            <AddressCard
              label="ONE-TIME ADDRESS"
              value="0xc8B1…FA5c"
              sub="made for this payment alone"
              style={{ left: mix(origin.x, FRONT.x, front) - 320, top: mix(origin.y, FRONT.y, front) - 90, transform: `rotate(${-3 * front}deg) scale(${mix(0.35, 1, front)})`, opacity: clamp01(front * 3) * (1 - cardsOut) }}
            />
          ) : null}
        </>
      ) : null}

      {/* b: the announcement, as Monadscan shows it */}
      {f >= 106 && f < 212 ? (
        <AbsoluteFill style={{ opacity: scan.o, transform: `translateY(${scan.y}px)` }}>
          <Img src={staticFile('demo/scan-announce.png')} style={{ position: 'absolute', left: ZT.x, top: ZT.y, width: 1920 * Z, height: 1080 * Z }} />
          <div style={{ position: 'absolute', left: 64, top: 52, width: 980, padding: '30px 40px 34px', borderRadius: 40, background: K.surface, border: `4px solid ${K.ink}`, boxShadow: '0 40px 80px -40px rgba(11,26,29,.4)' }}>
            <Words f={f} at={122} size={64} x={40} y={22}>A sealed note goes to</Words>
            <Words f={f} at={128} size={64} x={40} y={102}>Monad’s announcer<Dot /></Words>
            <div style={{ height: 176 }} />
          </div>
          <Outline f={f} at={134} box={zb(SCAN.announcer)} label="Monad’s announcer" />
          <Outline f={f} at={162} box={zb(SCAN.bytes)} label="the sealed note" fill below />
          <Outline f={f} at={174} box={zb(SCAN.stealth)} label="the new address" />
        </AbsoluteFill>
      ) : null}

      {/* c: only Sam's phone can open it */}
      {f >= 204 ? (
        <>
          <Device x={SAM.x} y={SAM.y + sam.y} h={SAM.h} screen={null} style={{ opacity: sam.o }}>
            <Rec src="demo/arrival.mp4" at={CUT.priv + 204} from={0.6} />
            <Ring f={f} at={236} rx={22} ry={560} rw={356} rh={92} r={18} />
          </Device>
          <Words f={f} at={213} size={92} x={1000} y={330}>Only Sam’s phone</Words>
          <Words f={f} at={219} size={92} x={1000} y={444}>can open it<Dot /></Words>
          <Words f={f} at={240} size={30} weight={700} color={K.muted} x={1006} y={600} style={{ fontFamily: 'Menlo, monospace' }}>
            <span style={{ fontFamily: 'Menlo, monospace' }}>Public on Monad: $0.15 to 0xc8B1…FA5c</span>
          </Words>
        </>
      ) : null}

      {envShown ? <Envelope x={env.x} y={env.y} s={envScale} rot={f < 168 ? -8 + toBytes * 8 : -8 + toSam * 14} /> : null}
      {f >= 160 && f < 176 ? <Burst f={f - 160} x={bx} y={by} /> : null}
      {f >= 234 && f < 252 ? <Burst f={f - 234} x={note.x} y={note.y} /> : null}
    </AbsoluteFill>
  )
}

function Outline({ f, at, box, label, fill = false, below = false }: { f: number; at: number; box: { x: number; y: number; w: number; h: number }; label: string; fill?: boolean; below?: boolean }) {
  if (f < at) return null
  const p = ease(f, at, at + 10)
  return (
    <>
      <div style={{ position: 'absolute', left: box.x - 10, top: box.y - 8, width: box.w + 20, height: box.h + 16, borderRadius: 14, border: `5px solid ${K.coral}`, background: fill ? 'rgba(212,101,88,.12)' : 'transparent', opacity: p, transform: `scale(${1 + (1 - p) * 0.03})` }} />
      <Chip dark style={{ left: below ? box.x : box.x + box.w + 24, top: below ? box.y + box.h + 22 : box.y + box.h / 2 - 28, fontSize: 24, padding: '10px 20px', opacity: p, transform: `translateX(${(1 - p) * -16}px)` }}>
        {label}
      </Chip>
    </>
  )
}

/** A small burst of coral squares, the moment something arrives. */
function Burst({ f, x, y }: { f: number; x: number; y: number }) {
  return (
    <>
      {Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2 + 0.4
        const r = 30 + ease(f, 0, 16) * 120
        return <div key={i} style={{ position: 'absolute', left: x + Math.cos(a) * r - 8, top: y + Math.sin(a) * r - 8, width: 16, height: 16, borderRadius: 4, background: i % 3 === 0 ? K.ink : K.coral, opacity: 1 - ease(f, 6, 16), transform: `rotate(${i * 30 + f * 6}deg)` }} />
      })}
    </>
  )
}

/* ── 03 · No signal ──────────────────────────────────────────────────────────────────────── */

const PANEL = { big: { x: 80, y: 250, w: 900, h: 760 }, top: { x: 1000, y: 250, w: 840, h: 370 }, bottom: { x: 1000, y: 640, w: 840, h: 370 } }
const SAM_OFF: Pos = { x: 650, y: 630, h: 700 }

function Panel({ box, children, o = 1, y = 0, dashed = false }: { box: { x: number; y: number; w: number; h: number }; children?: ReactNode; o?: number; y?: number; dashed?: boolean }) {
  return (
    <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, borderRadius: 44, background: dashed ? 'transparent' : K.surface, border: dashed ? `4px dashed ${K.muted}` : `4px solid ${K.ink}`, opacity: o, transform: `translateY(${y}px)`, overflow: 'hidden' }}>
      {children}
    </div>
  )
}

function NoSignal({ f }: { f: number }) {
  const big = presence(f, 3, 197)
  const top = presence(f, 6, 197)
  const bottom = presence(f, 9, 197)
  const qrFly = ease(f, 71, 93, inOut)
  const from = onRec(SAM_OFF, 195, 315)
  const to = { x: PANEL.top.x + PANEL.top.w / 2, y: PANEL.top.y + 205 }
  const lucia = f >= 93
  const online = ease(f, 131, 141)
  const settled = f >= 141
  return (
    <AbsoluteFill>
      <Paper f={f} />
      <Eyebrow f={f} at={5} leave={197} n="03" label="NO SIGNAL" x={124} y={70} />
      <Words f={f} at={7} leave={113} size={84} x={116} y={110}>No signal? Pay with a code<Dot /></Words>
      <Words f={f} at={119} leave={197} size={84} x={116} y={110}>It settles once a phone’s online<Dot /></Words>

      <Panel box={PANEL.big} o={big.o} y={big.y}>
        <Chip dark style={{ left: 34, top: 30, fontSize: 24 }}>
          {online < 1 ? '✈︎  No signal' : '▂▄▆  Back online'}
        </Chip>
      </Panel>
      <Device x={SAM_OFF.x} y={SAM_OFF.y + big.y} h={SAM_OFF.h} screen={null} style={{ opacity: big.o }}>
        <Rec src="demo/offline.mp4" at={CUT.off} from={0.3} />
        {f >= 49 ? <Rec src="demo/offline.mp4" at={CUT.off + 49} from={4.4} /> : null}
      </Device>

      <Panel box={PANEL.top} o={top.o} y={top.y}>
        <div style={{ position: 'absolute', left: 34, top: 28, fontFamily: 'Manrope', fontSize: 22, fontWeight: 800, letterSpacing: 3, color: K.muted }}>LUCIA’S PHONE, ALSO OFFLINE</div>
        {lucia ? <Crop src="demo/opage.mp4" hold={2} rx={14} ry={92} rw={366} rh={168} scale={1.75} style={{ left: 100, top: 64, opacity: ease(f, 93, 101) }} /> : null}
      </Panel>

      <Panel box={PANEL.bottom} o={bottom.o} y={bottom.y} dashed={!settled}>
        {settled ? (
          <>
            <div style={{ position: 'absolute', left: 34, top: 28, fontFamily: 'Manrope', fontSize: 22, fontWeight: 800, letterSpacing: 3, color: K.coral }}>A PHONE IS BACK ONLINE</div>
            <Crop src="demo/settled.mp4" hold={2} rx={30} ry={486} rw={334} rh={150} scale={1.75} style={{ left: 128, top: 72, opacity: ease(f, 141, 149), transform: `scale(${0.96 + 0.04 * ease(f, 141, 151)})` }} />
          </>
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontFamily: 'Manrope', fontSize: 30, fontWeight: 700, color: K.muted }}>Waiting to settle on Monad…</div>
        )}
      </Panel>

      {/* the code itself travels: Sam's real QR, from his screen into Lucia's panel */}
      {f >= 71 && f < 97 ? (
        <Crop src="demo/offline.mp4" hold={6} rx={52} ry={186} rw={288} rh={258} scale={mix(from.k, 1.2, qrFly)} style={{ left: mix(from.x, to.x, qrFly) - (288 * mix(from.k, 1.2, qrFly)) / 2, top: mix(from.y, to.y, qrFly) - (258 * mix(from.k, 1.2, qrFly)) / 2 - Math.sin(qrFly * Math.PI) * 140, opacity: 1 - ease(f, 90, 97), boxShadow: '0 30px 60px -20px rgba(11,26,29,.45)', transform: `rotate(${Math.sin(qrFly * Math.PI) * -6}deg)` }} />
      ) : null}
      {f >= 141 && f < 160 ? <Burst f={f - 141} x={PANEL.bottom.x + PANEL.bottom.w / 2} y={PANEL.bottom.y + 190} /> : null}
    </AbsoluteFill>
  )
}

/* ── 04 · No internet: Grandma ───────────────────────────────────────────────────────────── */

const GLOBE = { w: 1780, left: 70, top: -60 }
const ART = { w: 1170, h: 960 }
const gs = GLOBE.w / ART.w
const art = (x: number, y: number) => ({ x: GLOBE.left + x * gs, y: GLOBE.top + y * gs })
const ARC: Curve = [art(323, 409), art(440, 289), art(722, 289), art(863.5, 434)]
const AFEEZ: Pos = { x: 250, y: 700, h: 560 }

function Grandma({ f }: { f: number }) {
  // a 0–146 the globe · b 135–211 the text (the signature) · c 211–316 the code · d 316–417 cash out
  const globeIn = presence(f, 0, 134)
  const drift = 1 + ease(f, 0, 141, inOut) * 0.06
  const fly = ease(f, 34, 104, inOut)
  const huge = { x: 1180, top: 270, h: 1600 }
  const centred = { x: 960, top: 200, h: 860 }
  const right = { x: 1520, top: 210, h: 760 }
  const toCentre = ease(f, 211, 234, inOut)
  const toRight = ease(f, 316, 336, inOut)
  const phoneRise = ease(f, 135, 153)
  const ph = f < 211 ? huge : f < 316 ? { x: mix(huge.x, centred.x, toCentre), top: mix(huge.top, centred.top, toCentre), h: mix(huge.h, centred.h, toCentre) } : { x: mix(centred.x, right.x, toRight), top: mix(centred.top, right.top, toRight), h: mix(centred.h, right.h, toRight) }
  const out = ease(f, 406, 417, accel)
  // keys pressed for *384*53916#, then 5
  const CODE = '*384*53916#'
  const ki = Math.floor((f - 238) / 3)
  const press = f >= 238 && ki < CODE.length && (f - 238) % 3 < 2 ? CODE[ki]! : f >= 300 && f < 306 ? '5' : null
  const shake = f >= 172 && f < 186 ? Math.sin(f * 2.4) * 7 * (1 - (f - 172) / 14) : 0
  const lcd = f < 172 ? 'idle' : f < 236 ? 'sms' : f < 272 ? 'dial' : f < 280 ? 'run' : f < 326 ? 'menu' : 'cash'
  const typed = SMS.slice(0, Math.max(0, Math.floor((f - 176) * 3)))
  // Kovi: from above onto the phone's top, a look down, then a dive into the LCD
  const lcdMid = onBasic(ph.x, ph.top + (1 - phoneRise) * 300, ph.h, 210, 270)
  const phoneTop = onBasic(ph.x, ph.top + (1 - phoneRise) * 300, ph.h, 230, 0)
  let kovi: Pt = { x: phoneTop.x, y: phoneTop.y }
  let kpose: KoviPose = {}
  let ks = 1
  if (f < 154) {
    kovi = jump(f, 141, 154, { x: 1500, y: -60 }, phoneTop, 40)
    kpose = jumpPose(f, 141, 154, -1)
  } else if (f < 160) {
    kpose = { ...jumpPose(f, 141, 154, -1), look: { x: -0.6, y: 0.9 }, mouth: 'ooh' }
  } else {
    kovi = jump(f, 160, 172, phoneTop, lcdMid, 110)
    kpose = { ...jumpPose(f, 160, 172, -1), mouth: 'grin', happy: 1 }
    ks = 1 - ease(f, 164, 172, accel)
  }
  return (
    <AbsoluteFill style={{ opacity: 1 - out }}>
      <Paper f={f} />

      {/* a: London to her village, over the painted globe */}
      {f < 146 ? (
        <AbsoluteFill style={{ opacity: globeIn.o, transform: `translateY(${globeIn.y}px) scale(${drift})`, transformOrigin: '960px 560px' }}>
          <Img src={staticFile('art/scene-welcome.png')} style={{ position: 'absolute', left: GLOBE.left, top: GLOBE.top, width: GLOBE.w, height: (GLOBE.w * ART.h) / ART.w }} />
          {(arcDots as [number, number][]).map(([x, y], i) => {
            const at = (x - 323) / (863.5 - 323)
            const lit = clamp01((fly - at) / 0.06)
            const d = art(x, y)
            return lit > 0 ? <div key={i} style={{ position: 'absolute', left: d.x - 15, top: d.y - 15, width: 30, height: 30, borderRadius: 99, background: K.coral, opacity: lit, transform: `scale(${0.7 + 0.3 * lit})` }} /> : null
          })}
          <Flight curve={ARC} p={fly} size={220} trail={false} />
          {fly > 0 && fly < 1 ? (() => {
            const t = fly
            const u = 1 - t
            const p = { x: u ** 3 * ARC[0].x + 3 * u * u * t * ARC[1].x + 3 * u * t * t * ARC[2].x + t ** 3 * ARC[3].x, y: u ** 3 * ARC[0].y + 3 * u * u * t * ARC[1].y + 3 * u * t * t * ARC[2].y + t ** 3 * ARC[3].y }
            return <Chip dark style={{ left: p.x - 50, top: p.y - 170, fontSize: 28 }}>$1.00</Chip>
          })() : null}
          {f >= 104 ? <Kovi pose="cheer" size={200} x={art(863.5, 496).x - 10} y={art(863.5, 496).y - 170 - Math.sin(ease(f, 104, 122) * Math.PI) * 60} /> : null}
          <Pin f={f} at={16} x={art(323, 471).x} y={art(323, 471).y + 120} label="London" sub="you" />
          <Pin f={f} at={22} x={art(863.5, 496).x} y={art(863.5, 496).y + 120} label="Her village" sub="no internet" />
        </AbsoluteFill>
      ) : null}
      {f < 146 ? (
        <>
          <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(236,232,225,.96) 0%, rgba(236,232,225,.85) 20%, rgba(236,232,225,0) 34%)', opacity: globeIn.o }} />
          <Eyebrow f={f} at={4} leave={134} n="04" label="NO INTERNET" x={124} y={62} />
          <Words f={f} at={6} leave={134} size={84} x={116} y={100}>Grandma’s phone has no internet<Dot /></Words>
          {(() => {
            const pr = presence(f, 12, 134)
            return (
              <Device x={AFEEZ.x} y={AFEEZ.y + pr.y} h={AFEEZ.h} screen={null} style={{ opacity: pr.o, transform: 'rotate(-5deg)' }}>
                <WebRec hold={26} />
              </Device>
            )
          })()}
        </>
      ) : null}

      {/* b–d: her phone */}
      {f >= 135 ? (
        <>
          <BasicPhone x={ph.x} top={ph.top + (1 - phoneRise) * 300} h={ph.h} shake={shake} press={press} style={{ opacity: phoneRise }}>
            {lcd === 'idle' ? (
              <div style={{ height: '100%', display: 'grid', placeItems: 'center', fontSize: 52, fontWeight: 800 }}>12:41</div>
            ) : lcd === 'sms' ? (
              <div style={{ fontSize: 26, lineHeight: 1.32, fontWeight: 700 }}>
                <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: 1.5, opacity: 0.85 }}>NEW MESSAGE · KOVA</div>
                <div style={{ marginTop: 8 }}>{typed}</div>
              </div>
            ) : lcd === 'dial' ? (
              <div style={{ height: '100%', display: 'grid', placeItems: 'center', fontSize: 38, fontWeight: 800, letterSpacing: 1 }}>{CODE.slice(0, Math.max(0, Math.min(CODE.length, ki + 1)))}</div>
            ) : lcd === 'run' ? (
              <div style={{ height: '100%', display: 'grid', placeItems: 'center', fontSize: 24, fontWeight: 700 }}>USSD code running…</div>
            ) : lcd === 'menu' ? (
              <div style={{ fontSize: 26, lineHeight: 1.36, fontWeight: 700 }}>
                {MENU.map((m, i) => {
                  const sel = i === 5 && f >= 300
                  return (
                    <div key={m} style={{ opacity: ease(f, 280 + i * 3, 284 + i * 3), fontWeight: i === 0 ? 800 : 700, background: sel ? '#10241c' : 'transparent', color: sel ? '#d9e8d9' : undefined, margin: sel ? '0 -8px' : 0, padding: sel ? '0 8px' : 0, borderRadius: 6 }}>
                      {m}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{ fontSize: 26, lineHeight: 1.4, fontWeight: 700 }}>
                <div>Cash out $5.00</div>
                <div style={{ fontWeight: 800 }}>You get ₦6,556.93</div>
                <div>to OPay ••5678</div>
                <div style={{ height: 14 }} />
                <div>Enter your PIN:</div>
              </div>
            )}
          </BasicPhone>
          {f >= 141 && f < 172 && ks > 0 ? <KoviRig x={kovi.x} y={kovi.y} size={210 * ks} pose={kpose} /> : null}
          {f >= 172 && f < 190 ? <Burst f={f - 172} x={lcdMid.x} y={lcdMid.y} /> : null}

          <Words f={f} at={176} leave={206} size={72} x={120} y={800}>She gets a text<Dot /></Words>
          <Words f={f} at={216} leave={312} size={80} y={62} center>No app. No data. Just a code<Dot /></Words>
          <Words f={f} at={322} size={104} x={114} y={300}>She cashes out</Words>
          <Words f={f} at={328} size={104} x={114} y={426}>to her bank or OPay<Dot /></Words>
          {(() => {
            const pr = presence(f, 366)
            return (
              <Chip style={{ left: 120, top: 600, fontSize: 26, opacity: pr.o, transform: `translateY(${pr.y}px)` }}>
                ₦1,316.39 per dollar · Chainlink’s rate on Monad
              </Chip>
            )
          })()}
          {f >= 338 ? (() => {
            // from her phone's screen to the coin: the dollars leave as naira
            const lcd = onBasic(right.x, right.top, right.h, 210, 270)
            const coin = { x: 1075, y: 785 }
            const trail: Curve = [lcd, { x: lcd.x - 120, y: lcd.y + 260 }, { x: coin.x + 260, y: coin.y - 60 }, coin]
            const go = ease(f, 338, 352, inOut)
            const pr = presence(f, 346)
            const flip = ease(f, 356, 370, inOut)
            return (
              <>
                {Array.from({ length: 22 }, (_, i) => {
                  const t = i / 21
                  if (t > go) return null
                  const u = 1 - t
                  const d = { x: u ** 3 * trail[0].x + 3 * u * u * t * trail[1].x + 3 * u * t * t * trail[2].x + t ** 3 * trail[3].x, y: u ** 3 * trail[0].y + 3 * u * u * t * trail[1].y + 3 * u * t * t * trail[2].y + t ** 3 * trail[3].y }
                  return <div key={i} style={{ position: 'absolute', left: d.x - 6, top: d.y - 6, width: 12, height: 12, borderRadius: 6, background: K.coral, opacity: 0.85 * (1 - ease(f, 396, 406)) }} />
                })}
                <Img src={staticFile(flip < 0.5 ? 'art/coin-usd.png' : 'art/coin-ngn.png')} style={{ position: 'absolute', left: coin.x - 115, top: coin.y - 115 + pr.y, width: 230, height: 230, opacity: pr.o, transform: `scaleX(${Math.max(0.04, Math.abs(Math.cos(flip * Math.PI)))})`, filter: 'drop-shadow(0 18px 24px rgba(11,26,29,.25))' }} />
                {f >= 370 && f < 388 ? <Burst f={f - 370} x={coin.x} y={coin.y} /> : null}
              </>
            )
          })() : null}
        </>
      ) : null}
    </AbsoluteFill>
  )
}

function Pin({ f, at, x, y, label, sub }: { f: number; at: number; x: number; y: number; label: string; sub: string }) {
  const pr = presence(f, at)
  return (
    <div style={{ position: 'absolute', left: x - 150, width: 300, top: y, textAlign: 'center', fontFamily: 'Manrope', opacity: pr.o, transform: `translateY(${pr.y * 0.5}px)` }}>
      <div style={{ display: 'inline-block', padding: '10px 22px', borderRadius: 999, background: K.ink, color: K.cream, fontSize: 30, fontWeight: 800 }}>{label}</div>
      <div style={{ marginTop: 8, fontSize: 24, fontWeight: 700, color: K.ink }}>{sub}</div>
    </div>
  )
}

/* ── 05 · Everything else ────────────────────────────────────────────────────────────────── */

function Tile({ f, at, box, title, children }: { f: number; at: number; box: { x: number; y: number; w: number; h: number }; title: string; children?: ReactNode }) {
  const pr = presence(f, at, 197)
  return (
    <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, borderRadius: 44, background: K.surface, border: `4px solid ${K.ink}`, overflow: 'hidden', opacity: pr.o, transform: `translateY(${pr.y}px)`, fontFamily: 'Manrope' }}>
      {children}
      <div style={{ position: 'absolute', left: 34, right: 34, bottom: 28, fontSize: 34, fontWeight: 800, letterSpacing: -0.6, color: K.ink, lineHeight: 1.1 }}>{title}</div>
    </div>
  )
}

function Everything({ f }: { f: number }) {
  const bob = (i: number) => Math.sin((f + i * 11) / 18) * 6
  return (
    <AbsoluteFill>
      <Paper f={f} />
      <Eyebrow f={f} at={4} leave={197} n="05" label="EVERYTHING ELSE" x={124} y={70} />
      <Words f={f} at={6} leave={197} size={84} x={116} y={110}>And everything else<Dot /></Words>

      <Tile f={f} at={9} box={{ x: 110, y: 250, w: 650, h: 760 }} title="Cards with a daily limit, kept on Monad.">
        <div style={{ position: 'absolute', left: 30, top: 34, width: 590, height: 370, overflow: 'hidden', borderRadius: 28, transform: `perspective(1400px) rotateY(${Math.sin(f / 24) * 8}deg) rotateX(${Math.cos(f / 29) * 4}deg)`, boxShadow: '0 30px 50px -30px rgba(11,26,29,.45)' }}>
          <Img src={staticFile('kova-launch/card.png')} style={{ position: 'absolute', left: -50 * 0.88, top: -250 * 0.88, width: 780 * 0.88, height: 1691 * 0.88 }} />
        </div>
        <div style={{ position: 'absolute', left: 30, top: 420, width: 590, height: 200, overflow: 'hidden', borderRadius: 28 }}>
          <Img src={staticFile('kova-launch/card.png')} style={{ position: 'absolute', left: -40 * 0.84, top: -1090 * 0.84, width: 780 * 0.84, height: 1691 * 0.84 }} />
        </div>
      </Tile>

      <Tile f={f} at={26} box={{ x: 780, y: 250, w: 520, h: 370 }} title="AI agents pay with their own key.">
        <div style={{ position: 'absolute', left: 34, top: 36, right: 34, minHeight: 96, padding: '18px 22px', borderRadius: 24, background: K.ink, color: K.cream, fontSize: 24, fontWeight: 700, lineHeight: 1.35, transform: `translateY(${bob(1)}px)` }}>
          {f < 44 ? (
            <div style={{ display: 'flex', gap: 10, paddingTop: 20 }}>
              {[0, 1, 2].map((d) => (
                <span key={d} style={{ width: 14, height: 14, borderRadius: 99, background: K.cream, opacity: 0.4 + 0.6 * Math.max(0, Math.sin((f - d * 4) / 3)) }} />
              ))}
            </div>
          ) : (
            <div style={{ opacity: ease(f, 44, 52), transform: `translateY(${(1 - ease(f, 44, 54)) * 10}px)` }}>
              Claude paid $0.20 on its own.<br />
              <span style={{ color: K.coralSoft }}>Over $0.50, it asks you.</span>
            </div>
          )}
        </div>
      </Tile>

      <Tile f={f} at={44} box={{ x: 1320, y: 250, w: 520, h: 370 }} title="Send to a .nad name.">
        <div style={{ position: 'absolute', left: 34, top: 40, fontSize: 64, fontWeight: 800, letterSpacing: -2 }}>
          {'monad.nad'.slice(0, Math.max(0, Math.min(9, Math.floor((f - 52) / 1.6))))}
          {f < 70 ? <span style={{ display: 'inline-block', width: 5, height: 56, background: K.coral, marginLeft: 4, verticalAlign: -6, opacity: Math.floor(f / 6) % 2 ? 0.2 : 1 }} /> : null}
        </div>
        <div style={{ position: 'absolute', left: 38, top: 128, fontFamily: 'Menlo, monospace', fontSize: 30, fontWeight: 700, color: K.muted, opacity: ease(f, 70, 78), transform: `translateX(${(1 - ease(f, 70, 80)) * -14}px)` }}>→ 0x771C…6dD4</div>
      </Tile>

      <Tile f={f} at={61} box={{ x: 780, y: 640, w: 520, h: 370 }} title="Send a link, abroad.">
        {(() => {
          const turn = ease(f, 70, 84, inOut)
          return <Img src={staticFile(turn < 0.5 ? 'art/coin-usd.png' : 'art/coin-eur.png')} style={{ position: 'absolute', left: 34, top: 34 + bob(2), width: 120, height: 120, transform: `scaleX(${Math.max(0.04, Math.abs(Math.cos(turn * Math.PI)))})` }} />
        })()}
        <div style={{ position: 'absolute', left: 174, top: 50, fontSize: 30, fontWeight: 700, color: K.muted }}>$20 sent</div>
        <div style={{ position: 'absolute', left: 172, top: 88, fontSize: 56, fontWeight: 800, letterSpacing: -2, opacity: ease(f, 80, 88), transform: `translateY(${(1 - ease(f, 80, 90)) * 14}px)` }}>≈ €18.40</div>
      </Tile>

      <Tile f={f} at={79} box={{ x: 1320, y: 640, w: 520, h: 370 }} title="Private payroll.">
        <div style={{ position: 'absolute', left: 34, top: 36, display: 'flex' }}>
          {[1, 2, 3, 5].map((a, i) => {
            const pr = soft(f, 84 + i * 4)
            return <Img key={a} src={staticFile(`art/avatar-${a}.png`)} style={{ width: 92, height: 92, borderRadius: 99, border: `4px solid ${K.ink}`, marginLeft: i ? -18 : 0, opacity: clamp01(pr), transform: `translateY(${(1 - clamp01(pr)) * 24 + bob(i + 3) * 0.6}px)` }} />
          })}
        </div>
        <div style={{ position: 'absolute', left: 36, top: 150, right: 34, fontSize: 26, fontWeight: 700, color: K.muted, lineHeight: 1.3 }}>Each person paid at an address made just for them.</div>
      </Tile>
    </AbsoluteFill>
  )
}

/* ── End: the line again, every phone lit ────────────────────────────────────────────────── */

const END_LINE: Pos[] = [
  { x: 420, y: 790, h: 440 },
  { x: 790, y: 790, h: 440 },
  { x: 1160, y: 790, h: 440 },
]

function End({ f }: { f: number }) {
  const pull = 1.12 - ease(f, 0, 30, inOut) * 0.12
  // Kovi comes back the way he left: from Grandma's phone, down onto the line, on the last chord.
  const land = { x: 975, y: 1010 }
  const perch = { x: 1530, y: 640 }
  const appear = presence(f, 40)
  const kovi = f < 55 ? perch : f < 72 ? jump(f, 55, 72, perch, land, 140) : land
  const wave = f >= 86 ? Math.sin((f - 86) / 2.3) * clamp01((140 - f) / 20) : 0
  const pose: KoviPose = f < 55 ? { look: { x: -0.8, y: 0.2 }, mouth: 'grin', happy: 0.2 } : f < 72 ? jumpPose(f, 55, 72, -1) : { ...jumpPose(f, 55, 72, -1), armL: -20 + wave * 30, waveLines: f >= 86 && f < 140 ? 0.9 : 0, blink: f >= 160 && f < 166 ? 1 : 0, happy: 0.3, look: { x: 0, y: -0.2 } }
  return (
    <AbsoluteFill>
      <Paper f={f} />
      <AbsoluteFill style={{ transform: `scale(${pull})`, transformOrigin: '960px 820px' }}>
        {[...END_LINE.map((p) => p.x), 1530].map((x, i) => (
          <div key={`sh${x}`} style={{ position: 'absolute', left: x - (i < 3 ? 95 : 75), top: 996, width: i < 3 ? 190 : 150, height: 24, borderRadius: '50%', background: 'rgba(11,26,29,.16)', filter: 'blur(9px)', opacity: presence(f, i * 4).o }} />
        ))}
        {END_LINE.map((p, i) => {
          const pr = presence(f, i * 4)
          return (
            <Device key={p.x} x={p.x} y={p.y + pr.y} h={p.h} screen={null} style={{ opacity: pr.o }}>
              {i === 0 ? <Rec src="demo/cafe.mp4" hold={8.5} /> : null}
              {i === 1 ? <Rec src="demo/arrival.mp4" at={CUT.end} from={1} /> : null}
              {i === 2 ? <Rec src="demo/settled.mp4" hold={2} /> : null}
            </Device>
          )
        })}
        {(() => {
          const pr = presence(f, 12)
          return (
            <BasicPhone x={1530} top={640 + pr.y} h={370} style={{ opacity: pr.o }}>
              <div style={{ fontSize: 24, lineHeight: 1.4, fontWeight: 700 }}>
                <div>Cash out $5.00</div>
                <div style={{ fontWeight: 800 }}>You get ₦6,556.93</div>
              </div>
            </BasicPhone>
          )
        })()}
      </AbsoluteFill>
      <Words f={f} at={8} size={96} y={110} center>Kova is live on Monad mainnet<Dot /></Words>
      {(() => {
        const lg = presence(f, 74)
        const url = soft(f, 82)
        return (
          <>
            <div style={{ position: 'absolute', left: 0, right: 0, top: 270 + lg.y, display: 'flex', justifyContent: 'center', opacity: lg.o }}>
              <Logo h={92} />
            </div>
            <div style={{ position: 'absolute', left: 0, right: 0, top: 392, display: 'flex', justifyContent: 'center', opacity: clamp01(url), transform: `translateY(${(1 - clamp01(url)) * 20}px)` }}>
              <div style={{ padding: '16px 34px', borderRadius: 999, background: K.ink, color: K.cream, fontFamily: 'Manrope', fontSize: 34, fontWeight: 800 }}>mykova.app</div>
            </div>
          </>
        )
      })()}
      {f >= 40 ? <KoviRig x={kovi.x} y={kovi.y + (f < 55 ? appear.y : 0)} size={170} pose={pose} style={{ opacity: f < 55 ? appear.o : 1 }} /> : null}
    </AbsoluteFill>
  )
}

/* ── The film ─────────────────────────────────────────────────────────────────────────────── */

export function EveryPhone() {
  const f = useCurrentFrame()
  const scene = (from: number, to: number, node: (l: number) => ReactNode) => (f >= from && f < to ? node(f - from) : null)
  return (
    <AbsoluteFill style={{ background: K.paper, overflow: 'hidden' }}>
      {scene(0, CUT.ch1, (l) => <Hook f={l} />)}
      {scene(CUT.ch1, CUT.priv, (l) => <YourPhone f={l} />)}
      {scene(CUT.priv, CUT.off, (l) => <Private f={l} />)}
      {scene(CUT.off, CUT.gma, (l) => <NoSignal f={l} />)}
      {scene(CUT.gma, CUT.all, (l) => <Grandma f={l} />)}
      {scene(CUT.all, CUT.end, (l) => <Everything f={l} />)}
      {scene(CUT.end, DURATION, (l) => <End f={l} />)}

      {/* The score and the film's own sound, mixed and mastered: scripts/every-phone/mix.sh. */}
      <Html5Audio src={staticFile('every-phone/mix.wav')} />
    </AbsoluteFill>
  )
}

export { D }
