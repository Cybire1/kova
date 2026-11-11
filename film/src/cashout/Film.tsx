import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, Html5Audio, Img, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion'
import { Device, DEVICE } from '../ios-live-v2/Device'
import { accel, clamp01, decel, easeInOut, FPS, hero, mix, presenceStyle, rise, span } from '../motion'
import { Grain, Logo } from '../parts'
import { C } from '../theme'
import cues from './cues.json'

/**
 * Cash out, almost anywhere: Kova's cash-out to 50+ countries, launched. One governing idea, a
 * split-flap departures board, carried as one ink object the whole film: it flips the destinations
 * beside the app (hook), opens into the full board (the ways out), shrinks into a ticket beside one
 * real run of the app (Kenya, M-Pesa, $50), lands it (LANDED, on the downbeat the app shows it),
 * and opens again into a wall of every flag it reaches. Music and the board's clatter, no voice.
 *
 * The footage is the real app (apps/mobile cash-out-world.tsx) on the simulator, recorded as it
 * plays one run by itself (`cashout=demo&film=1`): live countries, ways out and the live KES rate
 * from Kova's mainnet API; the account and the payout are the demo's. Every number on the ticket
 * is the one on the phone at that moment. 50+: 16 places by name and the 36 countries on SEPA.
 *
 * Motion vocabulary: board text only ever arrives by flipping (2 frames a flip); other words
 * sharpen in (hero); objects rise 44 px; exits are an accelerated fade with an 8 px lift. The
 * board object morphs (never cuts) between its shapes. Camera: a slow push on the board, a slow
 * pull on the wall. Nothing is drawn over the footage.
 *
 * Every change lands on the 120 bpm grid (cues.json): sections on downbeats, rows and cuts on beats.
 *
 * Layout ledger:
 *   1 hook     0–4    split: the phone left, the flipping destination right
 *   2 board    4–10   full-bleed ink, the departures board
 *   3 run     10–22   split mirrored: the ticket left, the phone right
 *   4 landed  22–26   z-depth: the phone over the board's edge, LANDED huge
 *   5 wall    26–31   full-bleed grid of flags, the count below
 *   6 end     31–34   centred hero on paper
 */

export const DURATION = cues.duration
const F = 'Manrope, system-ui, sans-serif'
const K = { ink: C.ink, paper: C.paper, surface: C.surface, coral: C.coral, cell: '#1a2a2d', seam: '#06110f', dim: '#8b9a9c' }

// ── Determinism ──────────────────────────────────────────────────────────────────────────────────

const hash = (a: number, b: number) => {
  let h = (a * 374761393 + b * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
const GLYPHS = 'ABCDEFGHIJKLMNOPRSTUVWXYZ0123456789'

// ── The split-flap ───────────────────────────────────────────────────────────────────────────────

const STEP = 2 / FPS

/** One flap: blank before `at`, then a run of seeded letters, then `ch`. */
function Cell({ t, at, ch, from, seed, w, h, color = K.surface, bg = K.cell, most = 10 }: {
  t: number; at: number; ch: string; from?: string; seed: number; w: number; h: number; color?: string; bg?: string; most?: number
}) {
  const fewest = Math.max(1, Math.round(most * 0.4))
  const flips = ch === ' ' && !from ? 0 : fewest + Math.floor(hash(seed, 7) * (most - fewest + 1))
  const seq = [from ?? ' ', ...Array.from({ length: flips }, (_, i) => GLYPHS[Math.floor(hash(seed, i + 11) * GLYPHS.length)] as string), ch]
  const local = (t - at) / STEP
  const i = Math.max(0, Math.min(seq.length - 1, Math.floor(local)))
  const f = local < 0 || i >= seq.length - 1 ? 1 : local - Math.floor(local)
  const cur = seq[i] as string
  const prev = seq[Math.max(0, i - 1)] as string
  const half = (char: string, top: boolean, extra: CSSProperties = {}) => (
    <div style={{ position: 'absolute', left: 0, width: w, height: h / 2, top: top ? 0 : h / 2, overflow: 'hidden', background: bg, ...extra }}>
      <div style={{ position: 'absolute', left: 0, top: top ? 0 : -h / 2, width: w, height: h, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: F, fontWeight: 800, fontSize: h * 0.68, color, lineHeight: 1 }}>
        {char}
      </div>
    </div>
  )
  const flipping = local >= 0 && i > 0 && f < 1
  return (
    <div style={{ position: 'relative', width: w, height: h, borderRadius: Math.max(3, w * 0.07), overflow: 'hidden', flex: 'none' }}>
      {half(cur, true)}
      {half(flipping && f < 0.5 ? prev : cur, false)}
      {flipping && f < 0.5 ? half(prev, true, { transform: `scaleY(${1 - f * 2})`, transformOrigin: 'bottom', filter: 'brightness(0.82)' }) : null}
      {flipping && f >= 0.5 ? half(cur, false, { transform: `scaleY(${(f - 0.5) * 2})`, transformOrigin: 'top', filter: 'brightness(1.12)' }) : null}
      <div style={{ position: 'absolute', left: 0, right: 0, top: h / 2 - 1, height: 2, background: K.seam }} />
    </div>
  )
}

/** A word on the board: each letter a flap, the letters starting a beat-fraction apart. */
function Flap({ t, at, text, from, seed, w, h, gap, color, bg, stagger = 0.022, most }: {
  t: number; at: number; text: string; from?: string; seed: number; w: number; h: number; gap: number; color?: string; bg?: string; stagger?: number; most?: number
}) {
  const chars = [...text]
  const was = from ? [...from.padEnd(chars.length, ' ')] : []
  return (
    <div style={{ display: 'flex', gap }}>
      {chars.map((ch, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed row of flaps, one per letter slot
        <Cell key={i} t={t} at={at + i * stagger} ch={ch} from={was[i]} seed={seed * 97 + i} w={w} h={h} color={color} bg={bg} most={most} />
      ))}
    </div>
  )
}

/** A word that changes on the board: each version flips from the one before. */
function Flaps({ t, steps, seed, width, ...size }: {
  t: number; steps: [string, number][]; seed: number; width: number; w: number; h: number; gap: number; color?: string; bg?: string; most?: number; stagger?: number
}) {
  let k = -1
  for (let i = 0; i < steps.length; i++) if (t >= (steps[i] as [string, number])[1]) k = i
  if (k < 0) return <Flap t={t} at={99} text={''.padEnd(width, ' ')} seed={seed} {...size} />
  const [text, at] = steps[k] as [string, number]
  const from = k > 0 ? (steps[k - 1] as [string, number])[0].padEnd(width, ' ') : undefined
  return <Flap t={t} at={at} text={text.padEnd(width, ' ')} from={from} seed={seed + k * 31} {...size} />
}

// ── The board object: one ink shape, morphing between its places ─────────────────────────────────

type Rect = { x: number; y: number; w: number; h: number; r: number }
const HOOK: Rect = { x: 960, y: 420, w: 860, h: 250, r: 26 }
const FULL: Rect = { x: 0, y: 0, w: 1920, h: 1080, r: 0 }
const TICKET: Rect = { x: 110, y: 230, w: 720, h: 620, r: 26 }
const LANDED: Rect = { x: 70, y: 150, w: 1180, h: 780, r: 30 }
const DOT: Rect = { x: 960, y: 540, w: 0, h: 0, r: 0 }

const between = (a: Rect, b: Rect, p: number): Rect => ({ x: mix(a.x, b.x, p), y: mix(a.y, b.y, p), w: mix(a.w, b.w, p), h: mix(a.h, b.h, p), r: mix(a.r, b.r, p) })
const MORPHS: [number, Rect][] = [
  [0, HOOK], [cues.board.at - 0.3, HOOK], [cues.board.at + 0.35, FULL],
  [cues.run.at - 0.35, FULL], [cues.run.at + 0.3, TICKET],
  [cues.peak.at - 0.2, TICKET], [cues.peak.at + 0.4, LANDED],
  [cues.wall.at - 0.35, LANDED], [cues.wall.at + 0.3, FULL],
  [cues.end.at - 0.2, FULL], [cues.end.at + 0.35, DOT],
]
function boardAt(t: number): Rect {
  for (let i = 1; i < MORPHS.length; i++) {
    const [ta, a] = MORPHS[i - 1] as [number, Rect]
    const [tb, b] = MORPHS[i] as [number, Rect]
    if (t <= tb) return between(a, b, easeInOut(span(t, ta, tb)))
  }
  return DOT
}

// ── Footage ──────────────────────────────────────────────────────────────────────────────────────

/** The recording: 1178 × 2556 at a constant 30 fps (scripts/cashout/render.sh makes it). */
const SRC = { w: 1178, h: 2556 }
const CLIP_H = DEVICE.screen.w * (SRC.h / SRC.w)
type Cut = { at: number; to: number; from: number }

function Phone({ x, y, h, cuts, style }: { x: number; y: number; h: number; cuts: Cut[]; style?: CSSProperties }) {
  return (
    <Device x={x} y={y} h={h} screen={null} frame="dollar-card/device-frame-open.png" style={style}>
      {cuts.map((c) => (
        <Sequence key={c.at} from={Math.round(c.at * FPS)} durationInFrames={Math.round((c.to - c.at) * FPS)} layout="none">
          <div style={{ position: 'absolute', left: 0, top: (DEVICE.screen.h - CLIP_H) / 2, width: DEVICE.screen.w, height: CLIP_H }}>
            <OffthreadVideo src={staticFile('cashout/run.mp4')} startFrom={Math.round(c.from * FPS)} muted style={{ width: '100%', height: '100%' }} />
          </div>
        </Sequence>
      ))}
    </Device>
  )
}

const flag = (code: string) => staticFile(`cashout/flags/${code}.svg`)
function FlagImg({ code, size, style }: { code: string; size: number; style?: CSSProperties }) {
  return <Img src={flag(code)} style={{ width: size, height: size, borderRadius: '50%', display: 'block', flex: 'none', boxShadow: '0 0 0 2px rgba(241,239,234,0.12)', ...style }} />
}

const label = (size: number, color = K.dim): CSSProperties => ({ fontFamily: F, fontWeight: 800, fontSize: size, letterSpacing: '0.16em', color, margin: 0 })

// ── 1. Hook ──────────────────────────────────────────────────────────────────────────────────────

function Hook({ t }: { t: number }) {
  if (t > cues.board.at + 0.4) return null
  const line = hero(t, cues.hook.lineAt, cues.board.at - 0.3)
  const names = cues.hook.names as [string, number][]
  const plate = boardAt(t)
  const showCells = t < cues.board.at - 0.15
  return (
    <>
      <Phone x={560} y={540} h={980} cuts={[{ at: 0, to: cues.board.at + 0.4, from: cues.hook.from }]} />
      <p style={{ position: 'absolute', left: 990, top: 300, ...presenceStyle(line), fontFamily: F, fontWeight: 700, fontSize: 76, letterSpacing: '-0.035em', color: K.ink, margin: 0 }}>
        Cash out to
      </p>
      {showCells ? (
        <div style={{ position: 'absolute', left: plate.x, top: plate.y, width: plate.w, height: plate.h, display: 'flex', alignItems: 'center', paddingLeft: 34, zIndex: 3 }}>
          <Flaps t={t} steps={names} seed={3} width={9} w={84} h={124} gap={6} most={4} stagger={0.03} />
        </div>
      ) : null}
    </>
  )
}

// ── 2. Board ─────────────────────────────────────────────────────────────────────────────────────

const ROWS: { code: string; to: string; by: string; when: string }[] = [
  { code: 'ke', to: 'KENYA', by: 'M-PESA', when: 'INSTANT' },
  { code: 'gb', to: 'UK', by: 'BANK', when: 'SAME DAY' },
  { code: 'ph', to: 'PHILIPPINES', by: 'E-WALLET', when: 'INSTANT' },
  { code: 'ca', to: 'CANADA', by: 'INTERAC', when: 'INSTANT' },
  { code: 'au', to: 'AUSTRALIA', by: 'BANK', when: '1-2 DAYS' },
  { code: 'us', to: 'USA', by: 'BANK', when: 'INSTANT' },
]
const CELL = { w: 50, h: 72, gap: 5 }
const COL = { flag: 120, to: 230, by: 880, when: 1390 }
const rowY = (i: number) => 236 + i * 128

function Board({ t }: { t: number }) {
  if (t < cues.board.at || t > cues.run.at + 0.35) return null
  const push = mix(1, 1.035, easeInOut(span(t, cues.board.at, cues.run.at)))
  const head = rise(t, cues.board.at + 0.1, cues.board.keep, 20)
  return (
    <AbsoluteFill style={{ transform: `scale(${push})`, transformOrigin: '50% 30%', zIndex: 4 }}>
      <div style={{ position: 'absolute', left: COL.flag, right: 120, top: 86, display: 'flex', justifyContent: 'space-between', alignItems: 'center', ...presenceStyle(head) }}>
        <p style={label(26, K.surface)}>KOVA · CASH OUT</p>
        <Flap t={t} at={cues.board.at + 0.2} text="09:41" seed={5} w={34} h={48} gap={4} />
      </div>
      {(['TO', 'BY', 'ARRIVES'] as const).map((l, i) => (
        <p key={l} style={{ position: 'absolute', top: 168, left: [COL.to, COL.by, COL.when][i], ...label(18), ...presenceStyle(rise(t, cues.board.at + 0.3, cues.board.keep, 16)) }}>
          {l}
        </p>
      ))}
      {ROWS.map((r, i) => {
        const at = (cues.board.rows as number[])[i] ?? 0
        const gone = i === 0 ? 0 : accel(span(t, cues.board.keep, cues.board.keep + 0.3))
        const kenyaGo = i === 0 ? easeInOut(span(t, cues.run.at - 0.35, cues.run.at + 0.3)) : 0
        const words = i === 0 ? 1 - accel(span(t, cues.run.at - 0.4, cues.run.at - 0.15)) : 1
        if (t < at - 0.1) return null
        const fx = mix(COL.flag, TICKET.x + 44, kenyaGo)
        const fy = mix(rowY(i), TICKET.y + 40, kenyaGo)
        return (
          <div key={r.code} style={{ opacity: 1 - gone, transform: `translateY(${-8 * gone}px)` }}>
            <FlagImg code={r.code} size={mix(72, 64, kenyaGo)} style={{ position: 'absolute', left: fx, top: fy, transform: `scaleY(${clamp01((t - at) / 0.12)})` }} />
            <div style={{ position: 'absolute', left: COL.to, top: rowY(i), opacity: words }}>
              <Flap t={t} at={at} text={r.to} seed={10 + i} {...CELL} />
            </div>
            <div style={{ position: 'absolute', left: COL.by, top: rowY(i), opacity: words }}>
              <Flap t={t} at={at + 0.12} text={r.by} seed={30 + i} {...CELL} />
            </div>
            <div style={{ position: 'absolute', left: COL.when, top: rowY(i), opacity: words }}>
              <Flap t={t} at={at + 0.24} text={r.when} seed={50 + i} {...CELL} />
            </div>
          </div>
        )
      })}
    </AbsoluteFill>
  )
}

// ── 3–4. The run and the landing ─────────────────────────────────────────────────────────────────

const T = cues.ticket
const TC = { w: 36, h: 52, gap: 4 }

function Ticket({ t }: { t: number }) {
  if (t < cues.run.at || t > cues.wall.at) return null
  const away = accel(span(t, cues.peak.at - 0.2, cues.peak.at + 0.1))
  if (away >= 1) return null
  const row = (y: number, name: string, steps: [string, number][], seed: number, width = 12) => (
    <div style={{ position: 'absolute', left: TICKET.x + 44, top: TICKET.y + y, display: 'flex', alignItems: 'center', gap: 22 }}>
      <p style={{ ...label(17), width: 92 }}>{name}</p>
      <Flaps t={t} steps={steps} seed={seed} width={width} {...TC} />
    </div>
  )
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: 1 - away, transform: `translateY(${-8 * away}px)`, zIndex: 5 }}>
      <FlagImg code="ke" size={64} style={{ position: 'absolute', left: TICKET.x + 44, top: TICKET.y + 40 }} />
      <p style={{ position: 'absolute', left: TICKET.x + 128, top: TICKET.y + 52, ...label(22, K.surface), ...presenceStyle(rise(t, cues.run.at + 0.2, undefined, 12)) }}>KOVA · CASH OUT</p>
      {row(150, 'TO', [['KENYA', T.to]], 101)}
      {row(232, 'BY', [['M-PESA', T.by]], 111)}
      {row(314, 'SEND', [[cues.numbers.send, T.send]], 121)}
      {row(396, 'GETS', [[cues.numbers.gets, T.gets]], 131)}
      {row(478, 'STATUS', [['ON ITS WAY', T.status]], 141)}
    </div>
  )
}

/** The wait for the bank: a slow push from the cut to the landing, held after. */
const wait = (t: number) => mix(1, 1.04, easeInOut(span(t, cues.peak.at + 0.4, cues.ticket.landed)))

function Landed({ t }: { t: number }) {
  if (t < cues.peak.at || t > cues.wall.at + 0.3) return null
  const plate = boardAt(t)
  const gone = accel(span(t, cues.wall.at - 0.4, cues.wall.at - 0.1))
  const line = rise(t, cues.peak.at + 0.5, undefined, 20)
  return (
    <div style={{ position: 'absolute', left: plate.x, top: plate.y, width: plate.w, height: plate.h, opacity: 1 - gone, zIndex: 5, transform: `scale(${wait(t)})`, transformOrigin: '20% 50%' }}>
      <div style={{ position: 'absolute', left: 74, top: 70, display: 'flex', alignItems: 'center', gap: 20, ...presenceStyle(rise(t, cues.peak.at + 0.3, undefined, 12)) }}>
        <FlagImg code="ke" size={56} />
        <p style={label(22, K.surface)}>KENYA · M-PESA</p>
      </div>
      <div style={{ position: 'absolute', left: 74, top: 250 }}>
        <Flaps t={t} steps={[['ON ITS WAY', cues.peak.at + 0.2], ['LANDED', T.landed - 0.3]]} seed={201} width={10} w={80} h={118} gap={6} most={4} stagger={0.015} color={t >= T.landed ? K.coral : K.surface} />
      </div>
      <div style={{ position: 'absolute', left: 74, top: 470, ...presenceStyle(line) }}>
        <Flap t={t} at={cues.peak.at + 0.6} text={cues.numbers.gets} seed={221} w={40} h={58} gap={4} />
      </div>
      <p style={{ position: 'absolute', left: 74, top: 560, ...label(18), ...presenceStyle(line) }}>FROM {cues.numbers.send} · FEE {cues.numbers.fee}</p>
    </div>
  )
}

function Run({ t }: { t: number }) {
  if (t < cues.run.at - 0.1 || t > cues.wall.at + 0.4) return null
  const enter = rise(t, cues.run.at + 0.05, undefined, 44)
  const toPeak = easeInOut(span(t, cues.peak.at - 0.2, cues.peak.at + 0.4))
  const leave = accel(span(t, cues.wall.at - 0.4, cues.wall.at - 0.1))
  const cuts: Cut[] = [...cues.run.cuts, { at: cues.peak.at, to: cues.peak.to, from: cues.peak.from }]
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: enter.opacity * (1 - leave), transform: `translateY(${enter.y - 8 * leave}px) scale(${wait(t)})`, transformOrigin: '60% 50%', zIndex: 6 }}>
      <Phone x={mix(1400, 1290, toPeak)} y={540} h={mix(980, 1010, toPeak)} cuts={cuts} style={{ transform: `rotate(${mix(0, 2, toPeak)}deg)` }} />
    </div>
  )
}

// ── 5. The wall ──────────────────────────────────────────────────────────────────────────────────

/** Every place cash-out reaches by name: 16, and the 36 countries on SEPA. */
const WALL = (
  'ke gb us ca gh ng za tz ug ae au sg ph hk cn mx ' +
  'de fr es it nl be pt ie at fi se dk no is ch pl cz sk si hr hu ro bg gr cy mt ee lv lt lu li mc sm va ad gi'
).split(' ')

function Wall({ t }: { t: number }) {
  if (t < cues.wall.at || t > cues.end.at + 0.4) return null
  const pull = mix(1.05, 1, decel(span(t, cues.wall.at, cues.end.at)))
  const gone = accel(span(t, cues.end.at - 0.3, cues.end.at))
  const cols = 13
  const size = 92
  const step = 124
  const x0 = (1920 - (cols - 1) * step - size) / 2
  return (
    <AbsoluteFill style={{ transform: `scale(${pull})`, opacity: 1 - gone, zIndex: 5 }}>
      {WALL.map((code, i) => {
        const at = cues.wall.flags + hash(i, 3) * 1.2
        const p = clamp01((t - at) / 0.14)
        if (p <= 0) return null
        return (
          <FlagImg key={code} code={code} size={size} style={{ position: 'absolute', left: x0 + (i % cols) * step, top: 150 + Math.floor(i / cols) * step, transform: `scaleY(${p})` }} />
        )
      })}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 720, display: 'flex', justifyContent: 'center' }}>
        <Flap t={t} at={cues.wall.title} text="50+ COUNTRIES" seed={301} w={66} h={96} gap={6} />
      </div>
      <p style={{ position: 'absolute', left: 0, right: 0, top: 870, textAlign: 'center', fontFamily: F, fontWeight: 700, fontSize: 40, letterSpacing: '-0.02em', color: K.surface, margin: 0, ...presenceStyle(hero(t, cues.wall.line)) }}>
        Banks and mobile money, from one wallet.
      </p>
    </AbsoluteFill>
  )
}

// ── 6. End ───────────────────────────────────────────────────────────────────────────────────────

function End({ t }: { t: number }) {
  if (t < cues.end.at + 0.2) return null
  const mark = hero(t, cues.end.at + 0.3)
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 56 }}>
      <div style={presenceStyle(mark)}>
        <Logo h={210} />
      </div>
      <Flap t={t} at={cues.end.at + 0.75} text="MYKOVA.APP" seed={401} w={76} h={110} gap={7} bg={K.ink} color={K.surface} most={5} />
    </AbsoluteFill>
  )
}

// ── The film ─────────────────────────────────────────────────────────────────────────────────────

export function Film() {
  const frame = useCurrentFrame()
  const t = frame / FPS
  const plate = boardAt(t)
  return (
    <AbsoluteFill style={{ background: K.paper, overflow: 'hidden' }}>
      <Hook t={t} />
      <div style={{ position: 'absolute', left: plate.x, top: plate.y, width: plate.w, height: plate.h, borderRadius: plate.r, background: K.ink, zIndex: 2 }} />
      <Board t={t} />
      <Run t={t} />
      <Ticket t={t} />
      <Landed t={t} />
      <Wall t={t} />
      <End t={t} />
      <AbsoluteFill style={{ zIndex: 20, pointerEvents: 'none' }}>
        <Grain frame={frame} />
      </AbsoluteFill>
      <Html5Audio src={staticFile('cashout/mix.wav')} />
    </AbsoluteFill>
  )
}

export type { ReactNode }
