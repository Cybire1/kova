import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion'
import vo from '../../public/privacy/audio/vo.json'
import { accel, decel, mix, span } from '../motion'
import { Grain, Kovi } from '../parts'
import cues from './cues.json'

/**
 * "How a private payment works": a 43-second explainer, told with one real run.
 *
 * GOVERNING IDEA: the public record. From the first send to the end, a strip along the foot of the
 * frame shows exactly what anyone can read on Monad, entry by entry, as it becomes public. The
 * story above it shows what only Ada and Sam know. The point is what never reaches the strip: Sam's
 * name and Sam's wallet. The film ends by searching the record for his wallet: 0 results.
 *
 * Facts (all real, public/private/run.json): Monad testnet, 13 Oct 2026, test dollars. Ada
 * 0x7FFa…31fD sent $20.00 privately to the one-time address 0x1603…Dad6 (block 70,553,800); Kova
 * posted the ERC-5564 announcement, 201 bytes with the sealed note, 3 blocks later (70,553,803);
 * Sam's phone found it and opened "Train tickets"; Sam paid Ada's Bakery $7.75 straight from the
 * one-time address (block 70,554,621), and his wallet 0x29cF…1b22 appears in none of it. The
 * screens are the app's own, from that run. The hook's "normal payment" is labelled as what a
 * normal payment would show, not a transaction that happened.
 *
 * Motion vocabulary (nothing moves any other way):
 *   text enter    Roll: up through a slot, 7 frames decelerated; per character for addresses and
 *                 figures, per word for words (as spoken)
 *   object enter  Slam: scale 1.14 → 1 in 5 frames, decelerated
 *   exit          hard cuts on the beats; inside a beat, roll out upward
 *   camera        one move: the sealed note travels into the record (18.9-19.8)
 *   signature     the search of the record for Sam's wallet: 0 results
 *   accent        coral only; teal is the app's own (its screens)
 *   texture       grain only
 *
 * Layout ledger (no archetype twice in a row, none more than twice):
 *   0.0   hook     Extreme scale contrast (ink): a normal payment's record, enormous
 *   6.8   send     Split (paper): the line left, Ada's phone right, its switch lifted out
 *   10.8  address  Centred hero (ink): the brand-new address, the lock
 *   17.7  note     Editorial left (paper): the line left, the sealed note right, flying down
 *   25.2  find     Split, mirrored (teal): Sam's phone left, the line right, his note lifted
 *   31.0  spend    Z-axis cascade (ink): Sam's phone, Pay from lifted in front, Paid behind
 *   37.5  end      Baseline anchor (paper): the line on the record, the address below
 *
 * Audit: enter styles 2 (roll, slam) · bouncy 0 · camera moves 1 · accent coral · grain only ·
 * depth: the cascade · any two beats tell apart: yes.
 */

export const FPS = 30
export const DURATION = Math.round(cues.duration * FPS)

const K = {
  paper: '#e7e5e0',
  ink: '#0b1a1d',
  coral: '#d46558',
  teal: '#a9c9c9',
  dim: 'rgba(231,229,224,0.62)',
  inkDim: 'rgba(11,26,29,0.55)',
}
const MONO = 'Menlo, ui-monospace, monospace'
const M = 120
const F = 1 / FPS
const C = cues.cuts
const S = cues.strip
const T = cues.moments
const R = cues.run
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const blocks = (n: number) => n.toLocaleString('en-US')

// --- Words, as spoken ---------------------------------------------------------------------------

type Word = { text: string; start: number }
type LineId = keyof typeof cues.vo
const lines = Object.fromEntries((vo.lines as { id: string; words: Word[] }[]).map((l) => [l.id, l.words]))
function spoken(id: LineId, color?: (w: string) => string | undefined) {
  return lines[id].map((w) => ({ text: w.text, at: cues.vo[id] + w.start - 2 * F, color: color?.(w.text) }))
}
const at = (id: LineId, word: string) =>
  spoken(id).find((w) => w.text.replace(/[.,]/g, '').toLowerCase() === word.toLowerCase())?.at ?? cues.vo[id]

// --- The roll -----------------------------------------------------------------------------------

const ROLL = 7 * F
function slot(t: number, a: number, o?: number) {
  let y = (1 - decel(span(t, a, a + ROLL))) * 108
  if (o !== undefined) y -= accel(span(t, o, o + 5 * F)) * 108
  return y
}

function Slot({ y, children, style }: { y: number; children: ReactNode; style?: CSSProperties }) {
  return (
    <span style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', lineHeight: 1.18, ...style }}>
      <span style={{ display: 'inline-block', transform: `translateY(${y}%)` }}>{children}</span>
    </span>
  )
}

function Figures({ text, t, a, step = F, style }: { text: string; t: number; a: number; step?: number; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', whiteSpace: 'pre', fontVariantNumeric: 'tabular-nums', ...style }}>
      {[...text].map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: characters of a fixed string
        <Slot key={i} y={slot(t, a + i * step)}>
          {c}
        </Slot>
      ))}
    </div>
  )
}

function Words({ words, t, o, style }: { words: { text: string; at: number; color?: string }[]; t: number; o?: number; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: '0.26em', ...style }}>
      {words.map((w, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: words of a fixed line
        <Slot key={i} y={slot(t, w.at, o)} style={{ color: w.color }}>
          {w.text}
        </Slot>
      ))}
    </div>
  )
}

function slam(t: number, a: number): CSSProperties {
  if (t < a) return { opacity: 0 }
  const e = decel(span(t, a, a + 5 * F))
  return { transform: `scale(${1.14 - 0.14 * e})`, opacity: 1 }
}

// --- The phone ----------------------------------------------------------------------------------

const PH = 720
const k = PH / 2708
const PHONE_TOP = 70

function Phone({ fx, src, next, swapAt, t, style }: { fx: number; src: string; next?: string; swapAt?: number; t: number; style?: CSSProperties }) {
  const sx = fx + 54 * k
  const sy = PHONE_TOP + 44 * k
  const w = 1203 * k
  const h = 2620 * k
  const frame: CSSProperties = { position: 'absolute', left: fx, top: PHONE_TOP, width: 1311 * k, height: PH }
  const swap = next && swapAt !== undefined ? span(t, swapAt, swapAt + 6 * F) : 0
  return (
    <div style={{ position: 'absolute', inset: 0, ...style }}>
      <div style={frame}>
        <div style={{ position: 'absolute', left: 38 * k, right: 38 * k, top: 20 * k, bottom: 20 * k, borderRadius: 205 * k, background: '#0a0c0d', boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }} />
      </div>
      <div style={{ position: 'absolute', left: sx, top: sy, width: w, height: h, borderRadius: 176 * k, overflow: 'hidden', background: K.paper }}>
        <Img src={staticFile(`privacy/${src}`)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
        {next ? (
          <Img src={staticFile(`privacy/${next}`)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: swap }} />
        ) : null}
      </div>
      <Img src={staticFile('ios-live-v2/device-frame.png')} style={frame} />
    </div>
  )
}

/** A piece of a real screen, lifted toward the viewer at no more than its own resolution. */
function Lift({ src, t, a, x, y, w, rotate = 0 }: { src: string; t: number; a: number; x: number; y: number; w: number; rotate?: number }) {
  if (t < a) return null
  const e = decel(span(t, a, a + 8 * F))
  return (
    <Img
      src={staticFile(`privacy/${src}`)}
      style={{
        position: 'absolute',
        left: x,
        top: y + (1 - e) * 40,
        width: w,
        borderRadius: 26,
        opacity: e,
        transform: `rotate(${rotate}deg) scale(${1.06 - 0.06 * e})`,
        boxShadow: '0 30px 70px rgba(0,0,0,0.35)',
      }}
    />
  )
}

// --- The record: what anyone can read on Monad ----------------------------------------------------

const STRIP_Y = 870
const STRIP_H = 150

type Entry = { at: number; parts: { text: string; tone?: 'mute' | 'coral' }[] }
const ENTRIES: Entry[] = [
  {
    at: S.entry1,
    parts: [
      { text: `${short(R.ada)} → ${short(R.oneTime)}` },
      { text: '   $20.00' },
      { text: `   block ${blocks(R.send.block)}`, tone: 'mute' },
    ],
  },
  {
    at: S.entry2,
    parts: [
      { text: `Announcement: something for ${short(R.oneTime)}` },
      { text: `   sealed, ${R.announce.bytes} bytes`, tone: 'mute' },
    ],
  },
  {
    at: S.entry3,
    parts: [
      { text: `${short(R.oneTime)} → Ada’s Bakery` },
      { text: '   $7.75' },
      { text: `   block ${blocks(R.spend.block)}`, tone: 'mute' },
    ],
  },
]

function Record({ t }: { t: number }) {
  const rise = decel(span(t, S.rise, S.rise + 12 * F))
  if (t < S.rise) return null
  const notWho = span(t, S.notWho, S.notWho + 10 * F)
  const nothing = t >= S.nothingNew && t < C.spend
  const search = t >= S.search
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: STRIP_Y + (1 - rise) * (STRIP_H + 60),
        height: STRIP_H + 60,
        background: K.ink,
        color: K.paper,
        borderTop: `3px solid ${K.coral}`,
        zIndex: 5,
      }}
    >
      <div style={{ position: 'absolute', left: M, top: 16, fontFamily: MONO, fontSize: 17, letterSpacing: '0.14em', color: K.coral }}>
        ON MONAD · ANYONE CAN READ
      </div>
      <div style={{ position: 'absolute', right: M, top: 16, fontFamily: MONO, fontSize: 17, letterSpacing: '0.06em', color: K.dim }}>
        {search ? (
          <Slot y={slot(t, S.search)}>
            <span>
              find {short(R.sam)} (Sam): <span style={{ color: K.coral }}>0 results</span>
            </span>
          </Slot>
        ) : nothing ? (
          <Slot y={slot(t, S.nothingNew)}>Sam opened it: nothing new here</Slot>
        ) : t < S.entry1 ? (
          'nothing yet'
        ) : null}
      </div>
      {ENTRIES.map((e, i) =>
        t >= e.at ? (
          <div key={e.at} style={{ position: 'absolute', left: M, top: 52 + i * 40, fontFamily: MONO, fontSize: 25, whiteSpace: 'pre' }}>
            <Slot y={slot(t, e.at)}>
              {e.parts.map((p, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: parts of a fixed entry
                <span key={j} style={{ color: p.tone === 'mute' ? K.dim : p.tone === 'coral' ? K.coral : K.paper }}>
                  {p.text}
                </span>
              ))}
            </Slot>
            {i === 1 && notWho > 0 ? (
              <span style={{ marginLeft: 18, color: K.coral, opacity: notWho }}>for whom? not said</span>
            ) : null}
          </div>
        ) : null,
      )}
      {search ? (
        <div style={{ position: 'absolute', right: M, top: 44, height: 4, width: 128 * decel(span(t, S.search + 4 * F, S.search + 14 * F)), background: K.coral, borderRadius: 2 }} />
      ) : null}
    </div>
  )
}

// --- Beats --------------------------------------------------------------------------------------

// --- The public, as characters: pairs of cartoon eyes ----------------------------------------------

type Pt = { x: number; y: number }
type EyeSpec = {
  x: number
  y: number
  r: number
  /** Pops in. */
  at: number
  /** Where it looks: a point, or a point that moves. */
  look: Pt | ((t: number) => Pt)
  /** From here it darts left and right, searching. */
  dart?: number
  /** Squints shut, then pops away. */
  squint?: number
  leave?: number
  /** A question mark pops up over it. */
  ask?: number
  /** A little shrug (a squash) here. */
  shrug?: number
}

/** A pair of cartoon eyes: pops in, blinks once, looks, darts, asks, shrugs, squints, pops away. */
function Eye({ t, e, seed }: { t: number; e: EyeSpec; seed: number }) {
  if (t < e.at) return null
  const p = span(t, e.at, e.at + 9 * F)
  // Back-out pop: past full size, then settle (the eyes are characters, like Kovi).
  const pop = p < 1 ? 1 + 0.3 * Math.sin(p * Math.PI) - 0.3 * (1 - p) * (1 - p) : 1
  const squint = e.squint === undefined ? 0 : span(t, e.squint, e.squint + 4 * F)
  const gone = e.leave === undefined ? 0 : span(t, e.leave, e.leave + 5 * F)
  if (gone >= 1) return null
  const blinkAt = e.at + 1.0 + ((seed * 37) % 9) * 0.13
  const blink = t > blinkAt && t < blinkAt + 4 * F ? 0.12 : 1
  const lid = Math.min(blink, 1 - 0.85 * squint)
  const target = typeof e.look === 'function' ? e.look(t) : e.look
  const dx = target.x - e.x
  const dy = target.y - e.y
  const d = Math.hypot(dx, dy) || 1
  let look = { x: (dx / d) * e.r * 0.34, y: (dy / d) * e.r * 0.34 }
  if (e.dart !== undefined && t >= e.dart && (e.squint === undefined || t < e.squint))
    look = { x: Math.sin((t - e.dart) * 7 + seed) * e.r * 0.36, y: e.r * 0.05 }
  const shrug = e.shrug === undefined ? 0 : Math.sin(span(t, e.shrug, e.shrug + 8 * F) * Math.PI)
  const ask = e.ask === undefined ? 0 : span(t, e.ask, e.ask + 6 * F)
  const one = (ox: number) => (
    <div
      style={{
        position: 'absolute',
        left: ox - e.r,
        top: -e.r,
        width: 2 * e.r,
        height: 2 * e.r,
        borderRadius: '50%',
        background: '#fbfaf6',
        border: `${Math.max(3, e.r / 9)}px solid ${K.paper}`,
        overflow: 'hidden',
        transform: `scaleY(${lid})`,
      }}
    >
      <div style={{ position: 'absolute', left: e.r - e.r * 0.42 + look.x, top: e.r - e.r * 0.42 + look.y, width: e.r * 0.84, height: e.r * 0.84, borderRadius: '50%', background: K.ink }} />
    </div>
  )
  return (
    <div style={{ position: 'absolute', left: e.x, top: e.y, transform: `scale(${pop * (1 - gone) * (1 + 0.12 * shrug)}, ${pop * (1 - gone) * (1 - 0.2 * shrug)})` }}>
      {one(-e.r * 1.05)}
      {one(e.r * 1.05)}
      {ask > 0 ? (
        <div
          style={{
            position: 'absolute',
            left: -e.r * 0.5,
            top: -e.r * 2.6 - Math.sin(Math.max(0, t - (e.ask ?? t)) * 6) * 4,
            fontSize: e.r * 1.5,
            fontWeight: 800,
            color: K.coral,
            transform: `scale(${ask < 1 ? 1 + 0.4 * Math.sin(ask * Math.PI) : 1})`,
          }}
        >
          ?
        </div>
      ) : null}
    </div>
  )
}

function Crowd({ t, eyes }: { t: number; eyes: EyeSpec[] }) {
  return (
    <>
      {eyes.map((e, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed crowd
        <Eye key={i} t={t} e={e} seed={i + Math.round(e.at * 10)} />
      ))}
    </>
  )
}

/** A hop, as Kovi does them: up and back, settling, over `d` seconds from `a`. */
const hopAt = (t: number, a: number, h: number, d = 0.38) =>
  t < a || t > a + d ? 0 : Math.abs(Math.sin(((t - a) / d) * Math.PI)) * h * (1 - (t - a) / d)

/** Kovi dropping in from above to (x, y) between a and b, then hopping where it lands. */
function KoviDrop({ t, pose, a, b, x, y, size = 230, hops = [] as number[] }: { t: number; pose: Parameters<typeof Kovi>[0]['pose']; a: number; b: number; x: number; y: number; size?: number; hops?: number[] }) {
  if (t < a) return null
  const ky = mix(-260, y, accel(span(t, a, b))) - hopAt(t, b, 36) - hops.reduce((h, at) => h + hopAt(t, at, 56, 0.42), 0)
  return <Kovi pose={pose} size={size} x={x} y={ky} />
}

/** A burst of little stars, for the moment Sam's key opens the note. */
function Sparkles({ t, at, x, y }: { t: number; at: number; x: number; y: number }) {
  const p = span(t, at, at + 0.7)
  if (p <= 0 || p >= 1) return null
  return (
    <>
      {Array.from({ length: 9 }, (_, i) => {
        const angle = (i / 9) * Math.PI * 2 + 0.3
        const dist = 40 + decel(p) * 150
        const size = 18 * (1 - p) + 6
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed burst
            key={i}
            style={{
              position: 'absolute',
              left: x + Math.cos(angle) * dist - size / 2,
              top: y + Math.sin(angle) * dist - size / 2,
              width: size,
              height: size,
              background: i % 2 ? K.coral : '#f2c14e',
              clipPath: 'polygon(50% 0, 61% 39%, 100% 50%, 61% 61%, 50% 100%, 39% 61%, 0 50%, 39% 39%)',
              opacity: 1 - p,
            }}
          />
        )
      })}
    </>
  )
}

/** The opening crowd, around the record of a normal payment. */
const EYES = [
  { x: 330, y: 330, r: 34 },
  { x: 760, y: 300, r: 28 },
  { x: 1180, y: 320, r: 36 },
  { x: 1620, y: 300, r: 30 },
  { x: 1780, y: 460, r: 26 },
  { x: 1660, y: 880, r: 34 },
  { x: 1190, y: 900, r: 28 },
  { x: 700, y: 890, r: 36 },
  { x: 250, y: 860, r: 30 },
  { x: 1430, y: 440, r: 24 },
]
const ROW = { x: 960, y: 570 }
const H = cues.hook
const HOOK_EYES: EyeSpec[] = EYES.map((e, i) => ({
  ...e,
  at: H.eyes[0] + i * H.eyes[1],
  look: ROW,
  squint: H.squint,
  leave: H.squint + 0.25 + i * 0.05,
}))

function Hook({ t }: { t: number }) {
  const row = `${short(R.ada)}  →  ${short(R.sam)}   $20.00`
  const [ka, kb] = H.kovi
  const [sa, sb] = H.shutter
  const drop = accel(span(t, ka, kb))
  const landed = t >= kb
  const hop = landed ? Math.abs(Math.sin(Math.min(1, (t - kb) / 0.35) * Math.PI)) * 40 * (1 - Math.min(1, (t - kb) / 0.35)) : 0
  const cheerHop = t >= H.cheer ? Math.abs(Math.sin(Math.min(1, (t - H.cheer) / 0.4) * Math.PI)) * 60 * (1 - Math.min(1, (t - H.cheer) / 0.4)) : 0
  const shut = decel(span(t, sa, sb))
  // He lands on the shutter's box, then rides its edge down as he pulls it.
  const kY = mix(-240, 420, drop) + shut * 290 - hop - cheerHop
  return (
    <AbsoluteFill style={{ background: K.ink, color: K.paper }}>
      <Words words={spoken('hook', (w) => (w.startsWith('private') ? K.coral : undefined))} t={t} style={{ position: 'absolute', left: M, top: 110, width: 1500, fontSize: 52, fontWeight: 700 }} />
      <Crowd t={t} eyes={HOOK_EYES} />
      <div style={{ position: 'absolute', left: M, top: 470, fontFamily: MONO, fontSize: 19, letterSpacing: '0.12em', color: K.dim }}>
        <Slot y={slot(t, 0.9)}>A NORMAL PAYMENT, AS ANYONE CAN READ IT</Slot>
      </div>
      <Figures text={row} t={t} a={0.15} step={0.7 * F} style={{ position: 'absolute', left: M - 4, top: 520, fontFamily: MONO, fontSize: 76, fontWeight: 700, letterSpacing: '-0.02em' }} />
      <div style={{ position: 'absolute', left: M, top: 650, display: 'flex', gap: 0, fontSize: 40, fontWeight: 800 }}>
        <span style={{ width: 760, ...slam(t, T.names) }}>Ada</span>
        <span style={{ ...slam(t, T.names + 4 * F), color: K.coral }}>Sam</span>
      </div>
      <div style={{ position: 'absolute', left: M, top: 730, fontSize: 26, fontWeight: 600, color: K.dim }}>
        <Slot y={slot(t, T.names + 10 * F)}>Who paid whom, how much, when. Forever.</Slot>
      </div>
      {/* Kovi pulls a shutter down over the record: the one move of the hook. */}
      <div style={{ position: 'absolute', left: M - 30, top: 500, width: 1720, height: 300, overflow: 'hidden', borderRadius: 26 }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: `translateY(${(shut - 1) * 105}%)`,
            background: `repeating-linear-gradient(180deg, ${K.coral} 0 54px, #c4574b 54px 60px)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 24,
            color: K.ink,
          }}
        >
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke={K.ink} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
            <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
          </svg>
          <span style={{ fontSize: 76, fontWeight: 800, letterSpacing: '-0.03em' }}>Private</span>
        </div>
      </div>
      {t >= ka ? <Kovi pose={t >= H.cheer ? 'cheer' : 'key'} size={250} x={1540} y={kY} /> : null}
    </AbsoluteFill>
  )
}

function Send({ t }: { t: number }) {
  return (
    <AbsoluteFill style={{ background: K.paper, color: K.ink }}>
      <Words words={spoken('send', (w) => (w.startsWith('privately') ? K.coral : undefined))} t={t} style={{ position: 'absolute', left: M, top: 230, width: 820, fontSize: 104, fontWeight: 800, letterSpacing: '-0.035em', lineHeight: 1.0, rowGap: 4 }} />
      <Phone fx={1240} src="ada-review.png" t={t} />
      <Lift src="ada-review-lift0.png" t={t} a={T.lift1} x={760} y={560} w={760} rotate={-1.5} />
    </AbsoluteFill>
  )
}

function Address({ t }: { t: number }) {
  const words = spoken('address')
  const lockAt = T.lock
  const lock = decel(span(t, lockAt, lockAt + 8 * F))
  return (
    <AbsoluteFill style={{ background: K.ink, color: K.paper }}>
      <Words words={words.slice(0, 10)} t={t} style={{ position: 'absolute', left: M, top: 110, width: 1600, fontSize: 46, fontWeight: 700 }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 330, display: 'flex', justifyContent: 'center' }}>
        <Figures text={short(R.oneTime)} t={t} a={T.address} step={1.2 * F} style={{ fontFamily: MONO, fontSize: 150, fontWeight: 700, letterSpacing: '-0.02em' }} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 530, textAlign: 'center', fontFamily: MONO, fontSize: 21, letterSpacing: '0.12em', color: K.dim }}>
        <Slot y={slot(t, T.address + 0.5)}>A BRAND-NEW ADDRESS · USED FOR THIS ONE PAYMENT · NEVER SEEN BEFORE</Slot>
      </div>
      <KoviDrop t={t} pose="key" a={lockAt - 0.4} b={lockAt} x={470} y={640} size={210} />
      {t >= lockAt ? (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 610, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 22, opacity: lock, transform: `translateY(${(1 - lock) * 20}px)` }}>
          <svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke={K.coral} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
            <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
          </svg>
          <span style={{ fontSize: 62, fontWeight: 800, letterSpacing: '-0.03em', color: K.coral }}>Only Sam can open it.</span>
        </div>
      ) : null}
    </AbsoluteFill>
  )
}

function Note({ t }: { t: number }) {
  const [a, b] = S.envelope
  const fly = decel(span(t, a, b))
  const gone = t > b
  const card = { x: mix(1460, 1030, fly), y: mix(430, 930, fly) }
  return (
    <AbsoluteFill style={{ background: K.paper, color: K.ink }}>
      <Words
        words={spoken('note', (w) => (w.startsWith('Not') || w === 'who' ? K.coral : undefined))}
        t={t}
        style={{ position: 'absolute', left: M, top: 150, width: 900, fontSize: 70, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.04, rowGap: 4 }}
      />
      {gone ? null : (
        <div
          style={{
            position: 'absolute',
            left: mix(1180, 880, fly),
            top: mix(260, 840, fly),
            width: mix(560, 300, fly),
            height: mix(340, 180, fly),
            borderRadius: 26,
            background: K.ink,
            color: K.paper,
            boxShadow: '0 30px 70px rgba(0,0,0,0.3)',
            transform: `rotate(${mix(-3, 0, fly)}deg)`,
            overflow: 'hidden',
            ...(t < cues.vo.note + 0.5 ? { opacity: 0 } : { opacity: 1 - span(t, b - 3 * F, b) }),
            scale: t < cues.vo.note + 0.5 + 5 * F ? String(1.14 - 0.14 * decel(span(t, cues.vo.note + 0.5, cues.vo.note + 0.5 + 5 * F))) : undefined,
          }}
        >
          <div style={{ position: 'absolute', left: '8%', top: '12%', fontFamily: MONO, fontSize: `${mix(20, 11, fly)}px`, letterSpacing: '0.1em', color: K.dim }}>
            SEALED NOTE
          </div>
          <div style={{ position: 'absolute', left: '8%', top: '30%', right: '8%', fontFamily: MONO, fontSize: `${mix(22, 12, fly)}px`, lineHeight: 1.5, color: 'rgba(231,229,224,0.35)', letterSpacing: '0.1em' }}>
            {'•••• '.repeat(14)}
          </div>
          <div style={{ position: 'absolute', right: '8%', bottom: '10%', width: mix(70, 38, fly), height: mix(70, 38, fly), borderRadius: '50%', background: K.coral, display: 'grid', placeItems: 'center', color: K.ink, fontWeight: 800, fontSize: mix(30, 16, fly) }}>
            K
          </div>
        </div>
      )}
      {t >= a - 0.5 && t < b ? (
        <Kovi
          pose="ride"
          size={mix(200, 120, fly)}
          x={card.x + mix(150, 70, fly)}
          y={t < a ? mix(-200, card.y - 200, accel(span(t, a - 0.5, a))) : card.y - mix(200, 110, fly)}
          rotate={mix(0, 18, fly)}
        />
      ) : null}
    </AbsoluteFill>
  )
}

function Find({ t }: { t: number }) {
  return (
    <AbsoluteFill style={{ background: K.teal, color: K.ink }}>
      <Phone fx={M + 40} src="sam-arrival.png" t={t} style={slam(t, T.arrival)} />
      <Words words={spoken('find', (w) => (w === 'own' || w === 'key,' ? K.coral : undefined))} t={t} style={{ position: 'absolute', left: 820, top: 200, width: 960, fontSize: 84, fontWeight: 800, letterSpacing: '-0.035em', lineHeight: 1.02, rowGap: 4 }} />
      <Lift src="sam-arrival-lift0.png" t={t} a={T.lift2} x={760} y={560} w={720} rotate={1.2} />
      <Sparkles t={t} at={T.lift2 + 0.1} x={1120} y={690} />
      <KoviDrop t={t} pose="key" a={T.lift2 - 0.25} b={T.lift2 + 0.1} x={1620} y={560} size={200} hops={[T.lift2 + 0.6]} />
    </AbsoluteFill>
  )
}

function Spend({ t }: { t: number }) {
  const words = spoken('spend', (w) => (w === 'never' ? K.coral : undefined))
  return (
    <AbsoluteFill style={{ background: K.ink, color: K.paper }}>
      <Words words={words} t={t} style={{ position: 'absolute', left: M, top: 180, width: 860, fontSize: 70, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.04, rowGap: 4 }} />
      <Phone fx={1290} src="sam-pay.png" next="sam-paid.png" swapAt={T.paid} t={t} />
      {t < T.paid ? <Lift src="sam-pay-lift0.png" t={t} a={cues.vo.spend + 0.5} x={880} y={470} w={600} rotate={-1.2} /> : null}
    </AbsoluteFill>
  )
}

const FIN = { shutter: [C.end + 0.55, C.end + 1.05] as const, cheer: cues.vo.end + 3.0 }

/** The end, behind the shutter: the record as it stands, and Kovi waving. */
function End(_: { t: number }) {
  return <AbsoluteFill style={{ background: K.ink }} />
}

/**
 * The finale, over everything (the record too): Kovi drops in waving, then pulls a full-frame coral
 * shutter down over everything, riding its edge; the line is printed on the shutter, then
 * the address; he cheers.
 */
function Finale({ t }: { t: number }) {
  if (t < C.end) return null
  const [sa, sb] = FIN.shutter
  const shut = decel(span(t, sa, sb))
  const edge = shut * 1080
  const kY = t < sa ? mix(-260, 360, accel(span(t, C.end + 0.05, C.end + 0.4))) - hopAt(t, C.end + 0.4, 36) : Math.max(360, edge - 150)
  const cheerHop = hopAt(t, FIN.cheer, 70, 0.45)
  return (
    <AbsoluteFill style={{ zIndex: 10, pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: 1080,
          transform: `translateY(${(shut - 1) * 100}%)`,
          background: `repeating-linear-gradient(180deg, ${K.coral} 0 78px, #c4574b 78px 86px)`,
          color: K.ink,
        }}
      >
        <Words words={spoken('end')} t={t} style={{ position: 'absolute', left: M - 4, top: 250, width: 1500, fontSize: 124, fontWeight: 800, letterSpacing: '-0.045em', lineHeight: 1.0 }} />
        <div style={{ position: 'absolute', left: M, top: 620 }}>
          <Figures text="mykova.app" t={t} a={cues.vo.end + 2.0} style={{ fontSize: 64, fontWeight: 800, letterSpacing: '-0.02em' }} />
          <div style={{ height: 6, borderRadius: 3, background: K.ink, marginTop: 4, width: 310 * decel(span(t, cues.vo.end + 2.3, cues.vo.end + 2.7)) }} />
        </div>
        <div style={{ position: 'absolute', left: M, top: 940, fontSize: 21, fontWeight: 600, color: 'rgba(11,26,29,0.7)', opacity: span(t, cues.vo.end + 2.6, cues.vo.end + 3.2) }}>
          A real run on Monad testnet with test dollars, 13 Oct 2026. Kova pays the gas. One-time addresses follow ERC-5564.
        </div>
      </div>
      <Kovi pose={t >= FIN.cheer ? 'cheer' : t >= sa ? 'key' : 'wave'} size={280} x={1560} y={kY - cheerHop} />
    </AbsoluteFill>
  )
}

export function PrivacyFilm() {
  const frame = useCurrentFrame()
  const t = frame / FPS
  let shot: ReactNode
  if (t < C.send) shot = <Hook t={t} />
  else if (t < C.address) shot = <Send t={t} />
  else if (t < C.note) shot = <Address t={t} />
  else if (t < C.find) shot = <Note t={t} />
  else if (t < C.spend) shot = <Find t={t} />
  else if (t < C.end) shot = <Spend t={t} />
  else shot = <End t={t} />
  return (
    <AbsoluteFill style={{ fontFamily: 'Manrope', background: K.paper, overflow: 'hidden' }}>
      {shot}
      <Record t={t} />
      <Finale t={t} />
      <Grain frame={frame} />
    </AbsoluteFill>
  )
}
