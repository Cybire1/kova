import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, Easing, Html5Audio, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame } from 'remotion'
import { Device, DEVICE } from '../ios-live-v2/Device'
import { KoviRig } from '../KoviRig'
import { Grain, Logo } from '../parts'
import { C } from '../theme'

/**
 * "Kova: dollars for every phone." The launch film: 52 s, 16:9, 30 fps, on a 120 BPM grid (a bar is
 * 60 frames), over public/kova-launch/music.mp3: the phone film's own ElevenLabs track (kovaphone/music-b.mp3,
 * 120 BPM), extended to 52 s by repeating bars 8–12 on bar lines (scripts/kova-launch/render.sh).
 *
 * The grammar is borrowed from a reference launch (chhddavid on X, 2113264415357472909): a grainy
 * brand-colour open with "Introducing" in a viewfinder and a swapping word, a giant typed input, one
 * sentence whose ending keeps changing with a small live artifact above it, notifications stacking,
 * and a typed URL to close. The palette, type, characters and every number are Kova's own.
 *
 * Every screen is a capture of the real app, and every figure is from a real run:
 *   Ada → Sam, $20.00 privately, 13 Oct: one-time 0x1603…Dad6, arrived in 1.00 s, announced by the
 *     ERC-5564 announcer 0x5564…5564 in block 70,553,803 (public/private/run.json).
 *   A payment code paid with no signal, settled in 0.66 s; table 3, $7.75 in 0.76 s; $20 abroad as
 *     ≈ €18.40 (README receipts).
 *   $3.00 to a phone with no apps, "Balance $8.25", then $1.00 more in 1.37 s (the phone film's run);
 *     the SMS and USSD screens are the API's own text (services/arrival-sms.ts, services/ussd.ts).
 *   monad.nad resolves to 0x771C…6dD4 on Monad (checked 24 Oct).
 *
 *   0    HOOK      coral grain, "Introducing Kova for …", then "Send $50 to Grandma" typed huge
 *   6    SENTENCE  "Your dollars …" six endings, each with its artifact
 *   14   PRIVATE   a new address for every payment, a sealed note to Monad's announcer, Sam opens it
 *   26   OFFLINE   no signal: signed, carried as a code, settled in 0.66 s
 *   32   GRANDMA   London to her village; a text, a dial code, a menu, cash out
 *   42   ALL       the lock screen fills with Kova
 *   48   END       mykova.app typed; Kovi waves
 */

export const FPS = 30
export const DURATION = 1560
const BAR = 60

/** Each cut 2 frames before its downbeat (the track's downbeats fall at 0.12 s + 2 s × n). */
const T = { hook: 0, sentence: 182, priv: 422, offline: 781, grandma: 961, all: 1260, end: 1440 }

const K = {
  ...C,
  teal: '#46878B',
  tealDeep: '#376B70',
  tealSoft: '#A9C9C9',
  muted: '#566568',
  cream: '#f7f3e9',
}

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const decel = Easing.bezier(0.16, 1, 0.3, 1)
const inOut = Easing.bezier(0.65, 0, 0.35, 1)
const ios = Easing.bezier(0.2, 0.9, 0.25, 1)
const ease = (f: number, a: number, b: number, e = decel) => interpolate(f, [a, b], [0, 1], { ...clamp, easing: e })
const pop = (f: number, at: number, stiffness = 170, damping = 16) =>
  spring({ frame: f - at, fps: FPS, config: { stiffness, damping } })
const mix = (a: number, b: number, p: number) => a + (b - a) * p
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/* ── Grounds ──────────────────────────────────────────────────────────────────────────────── */

/** A grainy gradient in Kova's colours, drifting slowly: the reference's open, in coral and teal. */
function Glow({ f, tone }: { f: number; tone: 'coral' | 'ink' | 'teal' }) {
  const d = Math.sin(f / 70) * 60
  const g =
    tone === 'coral'
      ? `radial-gradient(ellipse 70% 60% at ${30 + d / 20}% 30%, #f0a093 0%, transparent 60%), radial-gradient(ellipse 60% 70% at ${78 - d / 30}% 80%, #b9503f 0%, transparent 65%), radial-gradient(ellipse 50% 50% at 85% 15%, ${K.tealSoft} 0%, transparent 55%), ${K.coral}`
      : tone === 'teal'
        ? `radial-gradient(ellipse 70% 60% at ${25 + d / 20}% 25%, #7fb0b2 0%, transparent 60%), radial-gradient(ellipse 60% 70% at ${80 - d / 30}% 85%, #24545a 0%, transparent 65%), ${K.teal}`
        : `radial-gradient(ellipse 60% 55% at ${70 + d / 30}% 30%, #1d4a4c 0%, transparent 60%), radial-gradient(ellipse 50% 60% at 15% 90%, #3a2420 0%, transparent 60%), ${K.ink}`
  return (
    <AbsoluteFill style={{ background: g }}>
      <AbsoluteFill style={{ opacity: tone === 'ink' ? 0.5 : 1 }}>
        <Grain frame={f} />
        <Grain frame={f + 11} />
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

function Paper({ f }: { f: number }) {
  return (
    <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 42%, #fbf9f4 0%, #efe9e0 50%, #e7e5e0 100%)' }}>
      <Grain frame={f} />
    </AbsoluteFill>
  )
}

/* ── Type ─────────────────────────────────────────────────────────────────────────────────── */

/** Words rise through a mask, and leave the way they came. */
function Words({ f, at, leave, size, children, style, weight = 800, color }: {
  f: number; at: number; leave?: number; size: number; children: ReactNode; style?: CSSProperties; weight?: number; color?: string
}) {
  const e = ease(f, at, at + 18)
  const l = leave === undefined ? 0 : ease(f, leave, leave + 10, Easing.in(Easing.cubic))
  return (
    <div style={{ position: 'absolute', overflow: 'hidden', paddingBottom: size * 0.14, ...style }}>
      <div
        style={{
          fontSize: size,
          fontWeight: weight,
          lineHeight: 1.02,
          letterSpacing: -size * (weight >= 800 ? 0.045 : 0.015),
          whiteSpace: 'nowrap',
          color,
          transform: `translateY(${(1 - e) * size * 1.3 - l * size * 1.3}px)`,
          opacity: 1 - l,
        }}
      >
        {children}
      </div>
    </div>
  )
}

const Dot = ({ c = K.coral }: { c?: string }) => <span style={{ color: c }}>.</span>

/** The reference's viewfinder: four corner brackets around a thing. */
function Brackets({ x, y, w, h, color, size = 22, stroke = 3, o = 1 }: {
  x: number; y: number; w: number; h: number; color: string; size?: number; stroke?: number; o?: number
}) {
  const s: CSSProperties = { position: 'absolute', width: size, height: size, borderColor: color, borderStyle: 'solid' }
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, opacity: o }}>
      <div style={{ ...s, left: 0, top: 0, borderWidth: `${stroke}px 0 0 ${stroke}px` }} />
      <div style={{ ...s, right: 0, top: 0, borderWidth: `${stroke}px ${stroke}px 0 0` }} />
      <div style={{ ...s, left: 0, bottom: 0, borderWidth: `0 0 ${stroke}px ${stroke}px` }} />
      <div style={{ ...s, right: 0, bottom: 0, borderWidth: `0 ${stroke}px ${stroke}px 0` }} />
    </div>
  )
}

/** Four tiny squares framing an artifact, as in the reference's white section. */
function Ticks({ x, y, w, h, o = 1 }: { x: number; y: number; w: number; h: number; o?: number }) {
  const d: CSSProperties = { position: 'absolute', width: 9, height: 9, background: K.ink }
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, opacity: o }}>
      <div style={{ ...d, left: 0, top: 0 }} />
      <div style={{ ...d, right: 0, top: 0 }} />
      <div style={{ ...d, left: 0, bottom: 0 }} />
      <div style={{ ...d, right: 0, bottom: 0 }} />
    </div>
  )
}

/* ── Phones ───────────────────────────────────────────────────────────────────────────────── */

const SK = DEVICE.screen.w / DEVICE.image.w
const STOP = (DEVICE.screen.h - DEVICE.image.h * SK) / 2

/** A real capture filling the screen; it may be any width with the iPhone's aspect. */
/** Each capture's own colour behind its notch, which the frame redraws. */
const NOTCH: Record<string, string> = {
  'kova-launch/ada-private.png': 'rgb(203,202,197)',
  'kova-launch/sam-arrival.png': 'rgb(169,201,201)',
  'kova-launch/offline.png': 'rgb(234,179,170)',
}

function Shot({ src, style }: { src: string; style?: CSSProperties }) {
  return (
    <AbsoluteFill style={style}>
      <Img src={staticFile(src)} style={{ position: 'absolute', left: 0, top: STOP, width: DEVICE.screen.w, height: DEVICE.image.h * SK }} />
      <div style={{ position: 'absolute', left: 392 * SK, top: STOP + 25 * SK, width: 400 * SK, height: 127 * SK, background: NOTCH[src] ?? K.paper }} />
    </AbsoluteFill>
  )
}

/** A ring around part of a capture, in capture pixels (1179 wide). */
function Ring({ f, at, x, y, w, h, r = 40, color = K.coral }: { f: number; at: number; x: number; y: number; w: number; h: number; r?: number; color?: string }) {
  const p = ease(f, at, at + 10)
  return (
    <div
      style={{
        position: 'absolute', left: x * SK - 14, top: STOP + y * SK - 14, width: w * SK + 28, height: h * SK + 28,
        borderRadius: r * SK + 14, border: `10px solid ${color}`, opacity: p, transform: `scale(${1 + (1 - p) * 0.06})`,
      }}
    />
  )
}

/** A basic phone, drawn: the kind grandma has. Its screen shows whatever the story needs. */
function FeaturePhone({ x, y, scale = 1, children, rot = 0, style }: { x: number; y: number; scale?: number; children: ReactNode; rot?: number; style?: CSSProperties }) {
  const W = 380
  const H = 760
  return (
    <div style={{ position: 'absolute', left: x - (W * scale) / 2, top: y - (H * scale) / 2, width: W * scale, height: H * scale, transform: `rotate(${rot}deg)`, ...style }}>
      <div style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: 64, background: K.ink, boxShadow: '0 40px 80px -30px rgba(11,26,29,.45), inset 0 2px 0 rgba(255,255,255,.08)' }} />
        <div style={{ position: 'absolute', left: 150, top: 26, width: 80, height: 8, borderRadius: 4, background: '#33464a' }} />
        <div style={{ position: 'absolute', left: 30, top: 58, width: 320, height: 300, borderRadius: 22, background: '#cfe0d6', overflow: 'hidden', boxShadow: 'inset 0 0 0 3px #0b1a1d' }}>
          <div style={{ position: 'absolute', left: 16, right: 16, top: 10, display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 800, color: '#1b2e2a', letterSpacing: 0.4 }}>
            <span>▂▄▆ MTN</span>
            <span>no data</span>
          </div>
          <div style={{ position: 'absolute', left: 18, right: 18, top: 38, bottom: 14, color: '#10201d', fontFamily: 'Manrope', fontWeight: 700 }}>{children}</div>
        </div>
        {/* keypad */}
        <div style={{ position: 'absolute', left: 40, top: 392, width: 300, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((k) => (
            <div key={k} style={{ height: 66, borderRadius: 18, background: '#203337', color: '#dfe7e4', display: 'grid', placeItems: 'center', fontSize: 26, fontWeight: 700 }}>
              {k}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── 1. HOOK ──────────────────────────────────────────────────────────────────────────────── */

const SWAP = ['shops', 'friends', 'payroll', 'AI agents', 'travel', 'grandma', 'no internet']

function Hook({ f }: { f: number }) {
  // "Introducing Kova for ___": the word swaps every 4 frames, then lands.
  const intro = ease(f, 2, 16)
  const landed = f >= 64
  const word = landed ? 'every phone' : SWAP[Math.min(SWAP.length - 1, Math.floor(Math.max(0, f - 14) / 7))]
  const settle = pop(f, 64, 220, 14)
  // Then a giant input fills the frame and types.
  const typeIn = ease(f, 96, 116, ios)
  const text = 'Send dollars to Grandma'
  const typed = text.slice(0, Math.max(0, Math.floor((f - 112) / 2)))
  const caret = Math.floor(f / 8) % 2 === 0
  const out = ease(f, 170, 180, Easing.in(Easing.cubic))
  return (
    <AbsoluteFill style={{ fontFamily: 'Manrope', color: K.cream }}>
      <Glow f={f} tone="coral" />
      <AbsoluteFill style={{ opacity: 1 - typeIn }}>
        <Brackets x={560} y={470} w={800} h={140} color="rgba(255,255,255,.9)" o={intro} />
        <div style={{ position: 'absolute', left: 560, top: 470, width: 800, height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, fontSize: 44, fontWeight: 600, letterSpacing: -0.6, opacity: intro }}>
          <span>Introducing</span>
          <Img src={staticFile('ios-live-v2/app-icon.png')} style={{ width: 54, height: 54, borderRadius: 14 }} />
          <span style={{ fontWeight: 800 }}>Kova for</span>
          <span style={{ fontWeight: 800, color: landed ? K.ink : K.cream, transform: `scale(${landed ? 0.9 + settle * 0.1 : 1})`, display: 'inline-block', minWidth: 230 }}>{word}</span>
        </div>
      </AbsoluteFill>
      {f >= 96 ? (
        <div style={{ position: 'absolute', left: mix(560, 110, typeIn), top: mix(470, 400, typeIn), width: mix(800, 1700, typeIn), height: mix(140, 280, typeIn), borderRadius: 999, background: K.cream, boxShadow: '0 40px 90px -40px rgba(60,20,10,.5)', display: 'flex', alignItems: 'center', padding: `0 ${mix(30, 70, typeIn)}px`, opacity: (typeIn > 0 ? 1 : 0) * (1 - out), transform: `scale(${1 + out * 0.08})` }}>
          <div style={{ fontSize: mix(40, 128, typeIn), fontWeight: 800, letterSpacing: -5, color: K.ink, whiteSpace: 'nowrap', flex: 1, overflow: 'hidden' }}>
            {typed}
            <span style={{ display: 'inline-block', width: 8, height: '0.85em', background: K.coral, marginLeft: 6, verticalAlign: '-0.08em', opacity: caret ? 1 : 0 }} />
          </div>
          <div style={{ width: mix(70, 190, typeIn), height: mix(70, 190, typeIn), borderRadius: 999, background: K.coral, display: 'grid', placeItems: 'center', color: K.cream, fontSize: mix(30, 90, typeIn), fontWeight: 800, transform: `scale(${1 - Math.sin(ease(f, 160, 168) * Math.PI) * 0.12})` }}>→</div>
        </div>
      ) : null}
    </AbsoluteFill>
  )
}

/* ── 2. SENTENCE ──────────────────────────────────────────────────────────────────────────── */

const ENDINGS: { words: string; art: (f: number) => ReactNode }[] = [
  { words: 'arrive in 1 second.', art: () => <Chip dark icon="⚡">Arrived in 1.00 s on Monad</Chip> },
  { words: 'move for $0.00.', art: () => <Row k="Fee" v="$0.00, Kova covers it" /> },
  {
    words: 'go to monad.nad.',
    art: () => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 22px 14px 14px', borderRadius: 26, background: K.surface, border: `3px solid ${K.ink}` }}>
        <Img src={staticFile('kova-launch/avatar.png')} style={{ width: 56, height: 56, borderRadius: 99 }} />
        <div style={{ lineHeight: 1.15 }}>
          <div style={{ fontSize: 26, fontWeight: 800 }}>Send to monad.nad</div>
          <div style={{ fontSize: 19, fontWeight: 600, color: K.muted }}>Their Monad name, 0x771C…6dD4</div>
        </div>
      </div>
    ),
  },
  { words: 'stay private.', art: () => <Chip icon="🔒">Paid to 0x1603…Dad6, one-time</Chip> },
  { words: 'work with no signal.', art: () => <Chip icon="◷">Waiting to settle · settles once either phone is online</Chip> },
  {
    words: 'reach any phone.',
    art: () => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '16px 26px', borderRadius: 26, background: K.ink, color: K.cream }}>
        <span style={{ fontSize: 30 }}>📟</span>
        <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: 1 }}>*384*53916#</span>
        <span style={{ fontSize: 20, fontWeight: 600, color: '#a7b8b9' }}>no app, no data</span>
      </div>
    ),
  },
]

function Chip({ children, dark = false, icon }: { children: ReactNode; dark?: boolean; icon?: string }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, padding: '14px 26px', borderRadius: 999, background: dark ? K.ink : K.surface, color: dark ? K.cream : K.ink, border: dark ? 'none' : `3px solid ${K.ink}`, fontSize: 26, fontWeight: 800, whiteSpace: 'nowrap' }}>
      {icon ? <span>{icon}</span> : null}
      {children}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', width: 520, padding: '18px 26px', borderRadius: 22, background: K.surface, border: `3px solid ${K.ink}`, fontSize: 26 }}>
      <span style={{ fontWeight: 600, color: K.muted }}>{k}</span>
      <span style={{ fontWeight: 800 }}>{v}</span>
    </div>
  )
}

function Sentence({ f }: { f: number }) {
  const each = 40
  const i = Math.min(ENDINGS.length - 1, Math.floor(f / each))
  const local = f - i * each
  const swap = ease(local, 0, 8, ios)
  const art = pop(local, 2, 200, 15)
  const prev = i > 0 ? ENDINGS[i - 1] : null
  const cur = ENDINGS[i]!
  const lead = ease(f, -6, 10)
  return (
    <AbsoluteFill style={{ fontFamily: 'Manrope', color: K.ink }}>
      <Paper f={f} />
      <Ticks x={460} y={250} w={1000} h={270} o={lead} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 300, height: 170, display: 'grid', placeItems: 'center', opacity: clamp01(art), transform: `translateY(${(1 - art) * 30}px) scale(${1.45 + clamp01(art) * 0.12})` }}>
        {cur.art(local)}
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 600, fontSize: 92, fontWeight: 800, letterSpacing: -4, opacity: lead }}>
        <span style={{ position: 'absolute', right: 1920 - 760, top: 0, whiteSpace: 'nowrap' }}>Your dollars</span>
        <span style={{ position: 'absolute', left: 786, top: 0, overflow: 'hidden', height: 120, width: 1100, display: 'inline-block' }}>
          {prev && swap < 1 ? <span style={{ position: 'absolute', left: 0, top: 0, color: K.coral, transform: `translateY(${-swap * 120}px)`, whiteSpace: 'nowrap' }}>{prev.words}</span> : null}
          <span style={{ position: 'absolute', left: 0, top: 0, color: K.coral, transform: `translateY(${i === 0 ? 0 : (1 - swap) * 120}px)`, whiteSpace: 'nowrap' }}>{cur.words}</span>
        </span>
      </div>
    </AbsoluteFill>
  )
}

/* ── 3. PRIVATE ───────────────────────────────────────────────────────────────────────────── */

const HEX = '0123456789abcdef'
function scramble(f: number, seed: number) {
  let s = '0x'
  for (let i = 0; i < 40; i++) s += HEX[(i * 7 + seed * 13 + Math.floor(f / 2) * (i + 3)) % 16]
  return `${s.slice(0, 6)}…${s.slice(-4)}`
}

function Private({ f }: { f: number }) {
  // a: Ada turns on "Send privately" (real capture). b: a brand-new address. c: a sealed note to
  // Monad's announcer. d: Sam's phone finds it, and only Sam can open it (real capture).
  const phoneIn = ease(f, 0, 18, ios)
  const toSam = ease(f, 262, 280, ios)
  const phoneX = mix(1330, 1460, ease(f, 70, 90, inOut))
  return (
    <AbsoluteFill style={{ fontFamily: 'Manrope', color: K.cream }}>
      <Glow f={f} tone="ink" />

      <Words f={f} at={4} leave={64} size={120} style={{ left: 120, top: 380 }}>Send privately<Dot /></Words>
      <Words f={f} at={18} leave={66} size={36} weight={600} color="#a7b8b9" style={{ left: 126, top: 560 }}>One switch. Only Sam knows it’s from Ada.</Words>

      <Words f={f} at={74} leave={168} size={92} style={{ left: 120, top: 250 }}>Every payment gets</Words>
      <Words f={f} at={80} leave={170} size={92} style={{ left: 120, top: 360 }}>a brand-new address<Dot /></Words>

      <Words f={f} at={176} leave={256} size={92} style={{ left: 120, top: 250 }}>A sealed note goes to</Words>
      <Words f={f} at={182} leave={258} size={92} style={{ left: 120, top: 360 }}>Monad’s announcer<Dot /></Words>

      <Words f={f} at={266} size={92} style={{ left: 120, top: 300 }}>Sam’s phone finds it.</Words>
      <Words f={f} at={278} size={92} color={K.tealSoft} style={{ left: 120, top: 410 }}>Only Sam can open it<Dot /></Words>
      <Words f={f} at={300} size={30} weight={600} color="#a7b8b9" style={{ left: 126, top: 560 }}>Public on Monad: $20.00 to 0x1603…Dad6. Not to Sam.</Words>

      {/* b: addresses */}
      {f >= 84 && f < 176 ? <Addresses f={f - 84} /> : null}
      {/* c: the note flies to the announcer */}
      {f >= 182 && f < 262 ? <Announce f={f - 182} /> : null}

      <Device x={phoneX} y={mix(600, 548, phoneIn)} h={980} screen={null} style={{ opacity: phoneIn }}>
        <AbsoluteFill style={{ background: K.paper }}>
          <Shot src="kova-launch/ada-private.png" style={{ transform: `translateX(${-toSam * 300}px)`, opacity: 1 - toSam }} />
          {f >= 262 ? <Shot src="kova-launch/sam-arrival.png" style={{ transform: `translateX(${(1 - toSam) * DEVICE.screen.w}px)` }} /> : null}
          {f < 262 ? <Ring f={f} at={30} x={50} y={1840} w={1080} h={230} r={60} /> : null}
          {f >= 290 ? <Ring f={f} at={296} x={70} y={1540} w={1040} h={360} r={60} color={K.teal} /> : null}
        </AbsoluteFill>
      </Device>
    </AbsoluteFill>
  )
}

function Addresses({ f }: { f: number }) {
  const rows = [
    { label: 'This payment', settle: 26, real: '0x1603…Dad6' },
    { label: 'Next payment', settle: Number.POSITIVE_INFINITY, real: '' },
    { label: 'The one after', settle: Number.POSITIVE_INFINITY, real: '' },
  ]
  return (
    <div style={{ position: 'absolute', left: 126, top: 540, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {rows.map((r, i) => {
        const p = pop(f, 6 + i * 8, 180, 16)
        const settled = f >= r.settle
        return (
          <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 24, opacity: clamp01(p) * (i === 0 ? 1 : 0.62), transform: `translateX(${(1 - clamp01(p)) * -40}px)` }}>
            <span style={{ width: 220, fontSize: 26, fontWeight: 600, color: '#a7b8b9' }}>{r.label}</span>
            <span style={{ fontFamily: 'Menlo, monospace', fontSize: 38, fontWeight: 700, padding: '12px 24px', borderRadius: 18, background: settled ? K.teal : 'rgba(255,255,255,.07)', color: settled ? K.cream : '#cfd8d6', border: settled ? 'none' : '2px dashed rgba(255,255,255,.25)' }}>
              {settled ? r.real : scramble(f, i + 1)}
            </span>
            {settled ? <span style={{ fontSize: 24, fontWeight: 800, color: K.tealSoft }}>one-time ✓</span> : null}
          </div>
        )
      })}
    </div>
  )
}

function Announce({ f }: { f: number }) {
  const fly = ease(f, 6, 40, inOut)
  const land = pop(f, 40, 240, 14)
  const x = mix(150, 700, fly)
  const y = mix(560, 640, fly) - Math.sin(fly * Math.PI) * 120
  return (
    <>
      {/* the announcer */}
      <div style={{ position: 'absolute', left: 640, top: 560, width: 520, padding: '26px 30px', borderRadius: 28, background: 'rgba(255,255,255,.06)', border: `3px solid ${f >= 40 ? K.tealSoft : 'rgba(255,255,255,.25)'}`, transform: `scale(${f >= 40 ? 1 + (1 - clamp01(land)) * 0.05 : 1})` }}>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 2, color: '#a7b8b9' }}>ERC-5564 ANNOUNCER</div>
        <div style={{ fontFamily: 'Menlo, monospace', fontSize: 32, fontWeight: 700, marginTop: 6 }}>0x5564…5564</div>
        <div style={{ marginTop: 14, fontSize: 24, fontWeight: 700, color: K.tealSoft, opacity: clamp01(land) }}>✓ Announced · block 70,553,803</div>
      </div>
      {/* the sealed note */}
      {f < 44 ? (
        <div style={{ position: 'absolute', left: x, top: y, transform: `rotate(${-6 + fly * 10}deg) scale(${1 - fly * 0.35})`, padding: '18px 24px', borderRadius: 18, background: '#f6e7c9', color: K.ink, boxShadow: '0 20px 40px rgba(0,0,0,.35)', width: 330 }}>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 1.5, color: K.coral }}>🔒 SEALED NOTE</div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, filter: 'blur(5px)' }}>“Train tickets”</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: K.muted, filter: 'blur(4px)' }}>From Ada</div>
        </div>
      ) : null}
    </>
  )
}

/* ── 4. OFFLINE ───────────────────────────────────────────────────────────────────────────── */

function Offline({ f }: { f: number }) {
  const phoneIn = ease(f, 0, 18, ios)
  const steps = ['Signed on the phone', 'Carried as a code', 'Settled on Monad in 0.66 s']
  return (
    <AbsoluteFill style={{ fontFamily: 'Manrope', color: K.ink }}>
      <Paper f={f} />
      <Words f={f} at={2} size={120} style={{ left: 120, top: 250 }}>No signal?</Words>
      <Words f={f} at={14} size={120} color={K.coral} style={{ left: 120, top: 380 }}>Pay anyway<Dot c={K.ink} /></Words>
      <div style={{ position: 'absolute', left: 126, top: 600, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {steps.map((s, i) => {
          const p = pop(f, 50 + i * 26, 190, 16)
          return (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 38, fontWeight: 700, opacity: clamp01(p), transform: `translateX(${(1 - clamp01(p)) * -30}px)` }}>
              <span style={{ width: 52, height: 52, borderRadius: 99, background: i === 2 ? K.teal : K.ink, color: K.cream, display: 'grid', placeItems: 'center', fontSize: 26, fontWeight: 800 }}>{i === 2 ? '✓' : i + 1}</span>
              {s}
            </div>
          )
        })}
      </div>
      <Device x={1360} y={mix(600, 548, phoneIn)} h={980} screen={null} style={{ opacity: phoneIn }}>
        <AbsoluteFill style={{ background: K.paper }}>
          <Shot src="kova-launch/offline.png" />
          {/* Kemi's phone reads the code: a scan line sweeps it while the steps tick. */}
          {f >= 40 && f < 150 ? (
            <div
              style={{
                position: 'absolute', left: 170 * SK, width: 840 * SK, top: STOP + mix(600, 1340, (Math.sin(((f - 40) / 40) * Math.PI - Math.PI / 2) + 1) / 2) * SK,
                height: 14, borderRadius: 7, background: K.teal, boxShadow: `0 0 40px 14px rgba(70,135,139,.45)`, opacity: ease(f, 40, 48) * (1 - ease(f, 140, 150)),
              }}
            />
          ) : null}
        </AbsoluteFill>
      </Device>
      <div style={{ position: 'absolute', left: 1580, top: 150, padding: '14px 26px', borderRadius: 99, background: K.ink, color: K.cream, fontSize: 30, fontWeight: 800, opacity: ease(f, 20, 30), transform: `rotate(4deg) translateY(${(1 - ease(f, 20, 30)) * 20}px)` }}>✈︎ Phone offline</div>
    </AbsoluteFill>
  )
}

/* ── 5. GRANDMA ───────────────────────────────────────────────────────────────────────────── */

function Grandma({ f }: { f: number }) {
  // a 0–80 London to her village · b 80–160 the text · c 160–240 the menu · d 240–300 cash out
  const map = 1 - ease(f, 74, 88, Easing.in(Easing.cubic))
  const fly = ease(f, 10, 64, inOut)
  const phoneIn = pop(f, 80, 150, 17)
  const screen = f < 160 ? 'sms' : f < 200 ? 'dial' : f < 240 ? 'menu' : 'cash'
  const press = (at: number) => 1 - Math.sin(ease(f, at, at + 6) * Math.PI) * 0.06
  return (
    <AbsoluteFill style={{ fontFamily: 'Manrope', color: K.cream }}>
      <Glow f={f} tone="coral" />

      {/* a: the trip */}
      {map > 0 ? (
        <AbsoluteFill style={{ opacity: map }}>
          <Words f={f} at={0} size={84} style={{ left: 120, top: 150 }}>You’re in London.</Words>
          <Words f={f} at={10} size={84} style={{ left: 120, top: 250 }}>Grandma has a basic phone<Dot c={K.ink} /></Words>
          <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
            <path d="M330 780 C 700 520, 1200 520, 1590 760" fill="none" stroke="rgba(255,255,255,.75)" strokeWidth={6} strokeDasharray="1 22" strokeLinecap="round" strokeDashoffset={0} pathLength={1000} style={{ strokeDasharray: `1 22` }} />
          </svg>
          <Pin x={330} y={780} label="London" sub="you, with Kova" />
          <Pin x={1590} y={760} label="Her village" sub="no smartphone, no data" />
          {(() => {
            const t = fly
            const x = (1 - t) ** 3 * 330 + 3 * (1 - t) ** 2 * t * 700 + 3 * (1 - t) * t ** 2 * 1200 + t ** 3 * 1590
            const y = (1 - t) ** 3 * 780 + 3 * (1 - t) ** 2 * t * 520 + 3 * (1 - t) * t ** 2 * 520 + t ** 3 * 760
            return (
              <div style={{ position: 'absolute', left: x - 70, top: y - 120, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 99, background: K.ink, fontSize: 30, fontWeight: 800, transform: `rotate(${(0.5 - t) * -18}deg)` }}>
                $3.00 →
              </div>
            )
          })()}
        </AbsoluteFill>
      ) : null}

      {/* b–d: her phone */}
      {f >= 80 ? (
        <>
          <Words f={f} at={86} leave={154} size={84} style={{ left: 120, top: 330 }}>She gets a text.</Words>
          <Words f={f} at={96} leave={156} size={36} weight={600} color="#fde3dd" style={{ left: 126, top: 450 }}>The dollars are already in her Kova pocket.</Words>
          <Words f={f} at={164} leave={234} size={84} style={{ left: 120, top: 330 }}>She dials a code.</Words>
          <Words f={f} at={174} leave={236} size={36} weight={600} color="#fde3dd" style={{ left: 126, top: 450 }}>Enters her PIN. Checks, pays, sends.</Words>
          <Words f={f} at={244} size={84} style={{ left: 120, top: 300 }}>And cashes out</Words>
          <Words f={f} at={252} size={84} color={K.ink} style={{ left: 120, top: 400 }}>to her bank or OPay<Dot c={K.cream} /></Words>
          <Words f={f} at={268} size={36} weight={600} color="#fde3dd" style={{ left: 126, top: 530 }}>No app. No data.</Words>

          <FeaturePhone x={1380} y={mix(820, 560, clamp01(phoneIn))} scale={1.15} rot={mix(8, -4, clamp01(phoneIn))} style={{ opacity: clamp01(phoneIn) }}>
            {screen === 'sms' ? (
              <div style={{ fontSize: 22, lineHeight: 1.35 }}>
                <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: 1.5, color: '#4a6460' }}>NEW MESSAGE · KOVA</div>
                <div style={{ marginTop: 10, opacity: ease(f, 104, 112) }}>Kova: $3.00 arrived in your USSD pocket. Balance $8.25. Dial *384*53916# to use it.</div>
              </div>
            ) : screen === 'dial' ? (
              <div style={{ height: '100%', display: 'grid', placeItems: 'center', fontSize: 40, fontWeight: 800, letterSpacing: 1 }}>{'*384*53916#'.slice(0, Math.max(1, Math.floor((f - 160) / 2.6)))}</div>
            ) : screen === 'menu' ? (
              <div style={{ fontSize: 26, lineHeight: 1.42 }}>
                <div style={{ fontWeight: 800 }}>Kova</div>
                {['1 Balance', '2 Pay a till', '3 Send to a phone', '4 My payments', '5 Cash out'].map((l, i) => (
                  <div key={l} style={{ opacity: ease(f, 202 + i * 3, 208 + i * 3), color: i === 4 && f >= 230 ? K.coral : undefined, fontWeight: i === 4 && f >= 230 ? 800 : 700 }}>{l}</div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 26, lineHeight: 1.4 }}>
                <div>Cash out to</div>
                <div style={{ fontWeight: 800, fontSize: 30 }}>OPay ••5678</div>
                <div style={{ marginTop: 8 }}>Amount in dollars:</div>
                <div style={{ marginTop: 6, fontSize: 34, fontWeight: 800, borderBottom: '3px solid #10201d', width: 120 }}>{f >= 262 ? '3' : ''}</div>
              </div>
            )}
          </FeaturePhone>
          {/* a thumb press on 5 */}
          {f >= 228 && f < 240 ? <div style={{ position: 'absolute', left: 1380 - 30, top: 560 + 95, width: 70, height: 70, borderRadius: 99, background: 'rgba(255,255,255,.35)', transform: `scale(${press(228)})` }} /> : null}
        </>
      ) : null}
    </AbsoluteFill>
  )
}

function Pin({ x, y, label, sub }: { x: number; y: number; label: string; sub: string }) {
  return (
    <div style={{ position: 'absolute', left: x - 18, top: y - 18 }}>
      <div style={{ width: 36, height: 36, borderRadius: 99, background: K.ink, boxShadow: '0 0 0 10px rgba(255,255,255,.25)' }} />
      <div style={{ position: 'absolute', left: -120, width: 276, top: 54, textAlign: 'center' }}>
        <div style={{ fontSize: 34, fontWeight: 800 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 600, color: '#fde3dd' }}>{sub}</div>
      </div>
    </div>
  )
}

/* ── 6. EVERYTHING ────────────────────────────────────────────────────────────────────────── */

const NOTES = [
  { t: 'Table 3 paid $7.75', s: 'Croissant, flat white · settled in 0.76 s' },
  { t: 'Ada paid you privately', s: '+$20.00 · “Train tickets”' },
  { t: '$1.00 reached a phone with no apps', s: 'Arrived in 1.37 s · fee $0.00' },
  { t: 'Lucia got ≈ €18.40', s: 'You sent $20 abroad' },
  { t: 'Claude paid with its own key', s: 'Within the limit you set' },
  { t: 'Payroll sent', s: 'Each person paid at a one-time address' },
  { t: 'Card tapped', s: '$50 a day limit, kept on Monad' },
]

function Everything({ f }: { f: number }) {
  const phoneIn = ease(f, 0, 16, ios)
  const list = ['Shops and tills', 'Payment links', 'Cards with limits', 'AI agents', 'Private payroll', 'Chainlink rates']
  return (
    <AbsoluteFill style={{ fontFamily: 'Manrope', color: K.ink }}>
      <Paper f={f} />
      <Words f={f} at={2} size={110} style={{ left: 120, top: 200 }}>And everything</Words>
      <Words f={f} at={8} size={110} style={{ left: 120, top: 320 }}>a wallet needs<Dot /></Words>
      <div style={{ position: 'absolute', left: 126, top: 500, display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 40, rowGap: 14, width: 760 }}>
        {list.map((l, i) => {
          const p = pop(f, 24 + i * 6, 200, 16)
          return (
            <div key={l} style={{ fontSize: 34, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 14, opacity: clamp01(p), transform: `translateY(${(1 - clamp01(p)) * 20}px)` }}>
              <span style={{ width: 14, height: 14, borderRadius: 99, background: i % 2 ? K.teal : K.coral }} />
              {l}
            </div>
          )
        })}
      </div>
      {/* a lock screen filling with Kova */}
      <Device x={1400} y={mix(620, 548, phoneIn)} h={1000} screen={null} style={{ opacity: phoneIn }}>
        <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 20%, #7fb0b2 0%, ${K.teal} 45%, #24545a 100%)`, color: K.cream }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 190, textAlign: 'center', fontSize: 64, fontWeight: 600 }}>Monday 27 October</div>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 260, textAlign: 'center', fontSize: 250, fontWeight: 700, letterSpacing: -8, lineHeight: 1 }}>9:41</div>
          <div style={{ position: 'absolute', left: 40, right: 40, bottom: 120, display: 'flex', flexDirection: 'column-reverse', gap: 22 }}>
            {NOTES.map((n, i) => {
              const at = 10 + i * 17
              const p = pop(f, at, 220, 18)
              if (f < at) return null
              return (
                <div key={n.t} style={{ display: 'flex', gap: 30, alignItems: 'center', padding: '34px 38px', borderRadius: 60, background: 'rgba(241,239,234,.92)', color: K.ink, transform: `translateY(${(1 - clamp01(p)) * -60}px) scale(${0.94 + clamp01(p) * 0.06})`, opacity: clamp01(p) }}>
                  <Img src={staticFile('ios-live-v2/app-icon.png')} style={{ width: 130, height: 130, borderRadius: 32 }} />
                  <div style={{ flex: 1, lineHeight: 1.2 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 58, fontWeight: 800, letterSpacing: -1 }}>{n.t}</span>
                      <span style={{ fontSize: 40, fontWeight: 600, color: K.muted }}>now</span>
                    </div>
                    <div style={{ fontSize: 48, fontWeight: 600, color: K.muted }}>{n.s}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </AbsoluteFill>
      </Device>
    </AbsoluteFill>
  )
}

/* ── 7. END ───────────────────────────────────────────────────────────────────────────────── */

function End({ f }: { f: number }) {
  const logo = pop(f, 2, 160, 16)
  const url = 'mykova.app'
  const typed = url.slice(0, Math.max(0, Math.floor((f - 22) / 2.2)))
  const caret = Math.floor(f / 8) % 2 === 0
  const kovi = pop(f, 44, 150, 14)
  const wave = Math.sin((f - 54) * 0.3) * clamp01((f - 54) / 6) * Math.max(0, 1 - (f - 54) / 50)
  return (
    <AbsoluteFill style={{ fontFamily: 'Manrope', color: K.ink }}>
      <Paper f={f} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 330, display: 'flex', justifyContent: 'center', opacity: clamp01(logo), transform: `scale(${0.9 + clamp01(logo) * 0.1})` }}>
        <Logo h={150} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 560, textAlign: 'center', fontSize: 64, fontWeight: 800, letterSpacing: -2 }}>
        {typed}
        <span style={{ display: 'inline-block', width: 6, height: 60, background: K.coral, marginLeft: 6, verticalAlign: -8, opacity: caret ? 1 : 0 }} />
      </div>
      <Words f={f} at={46} size={40} weight={600} color={K.muted} style={{ left: 0, right: 0, top: 680, textAlign: 'center' }}>
        <span style={{ display: 'block', textAlign: 'center' }}>Dollars for every phone, on Monad.</span>
      </Words>
      <KoviRig
        x={1500}
        y={760 + (1 - clamp01(kovi)) * 80}
        size={190}
        style={{ opacity: clamp01(kovi) }}
        pose={{ look: { x: -0.8, y: -0.2 }, mouth: 'grin', armL: -5 - wave * 30, armR: 35, waveLines: clamp01((f - 58) / 8) * Math.max(0, 1 - (f - 100) / 20), lean: -wave * 1.5, happy: 0.3 }}
      />
    </AbsoluteFill>
  )
}

/* ── Film ─────────────────────────────────────────────────────────────────────────────────── */

/** A flash of the next section's colour on a cut: one frame, as the reference does. */
function Cut({ f, at }: { f: number; at: number }) {
  const d = f - at
  if (d < 0 || d > 2) return null
  return <AbsoluteFill style={{ background: K.cream, opacity: d === 0 ? 0.85 : d === 1 ? 0.35 : 0.1 }} />
}

const At = ({ at, src, volume }: { at: number; src: string; volume: number }) => (
  <Sequence from={at} layout="none">
    <Html5Audio src={staticFile(src)} volume={volume} />
  </Sequence>
)

export function KovaLaunch() {
  const f = useCurrentFrame()
  const scene = (from: number, to: number, node: (local: number) => ReactNode) => (f >= from && f < to ? node(f - from) : null)
  return (
    <AbsoluteFill style={{ background: K.paper, overflow: 'hidden' }}>
      {scene(T.hook, T.sentence, (l) => <Hook f={l} />)}
      {scene(T.sentence, T.priv, (l) => <Sentence f={l} />)}
      {scene(T.priv, T.offline, (l) => <Private f={l} />)}
      {scene(T.offline, T.grandma, (l) => <Offline f={l} />)}
      {scene(T.grandma, T.all, (l) => <Grandma f={l} />)}
      {scene(T.all, T.end, (l) => <Everything f={l} />)}
      {scene(T.end, DURATION, (l) => <End f={l} />)}
      {[T.sentence, T.priv, T.offline, T.grandma, T.all, T.end].map((at) => (
        <Cut key={at} f={f} at={at} />
      ))}

      <Html5Audio src={staticFile('kova-launch/music.mp3')} volume={(fr) => 0.7 * interpolate(fr, [DURATION - 24, DURATION], [1, 0], clamp)} />
      {[T.sentence, T.priv, T.offline, T.grandma, T.all, T.end].map((at) => (
        <At key={`w${at}`} at={at - 3} src="link/sfx/swoosh.mp3" volume={0.28} />
      ))}
      <At at={T.hook + 160} src="link/sfx/tap.mp3" volume={0.6} />
      <At at={T.priv + 30} src="link/sfx/tap.mp3" volume={0.5} />
      <At at={T.priv + 222} src="queue/sfx/stamp.mp3" volume={0.45} />
      <At at={T.grandma + 104} src="kovaphone/sms.wav" volume={0.5} />
      <At at={T.grandma + 160} src="kovaphone/dtmf.wav" volume={0.35} />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <At key={`n${i}`} at={T.all + 10 + i * 17} src="queue/sfx/blip.mp3" volume={0.3} />
      ))}
      <At at={T.end + 4} src="link/sfx/logo.mp3" volume={0.5} />
    </AbsoluteFill>
  )
}

export { BAR }
