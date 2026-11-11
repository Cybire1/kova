import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, Html5Audio, Img, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion'
import { DEVICE, Device } from '../ios-live-v2/Device'
import { accel, decel, easeInOut, FPS, hop, mix, span } from '../motion'
import { Grain, Logo } from '../parts'
import { C } from '../theme'
import cues from './cues.json'

/**
 * "All of it." Everything Kova does, for the people who keep asking: 53 s, 16:9, 30 fps, 120 bpm
 * (a beat is 15 frames, a bar 2 s).
 *
 * CLAIM: one app does all of it, and the network fees come to $0.00.
 *
 * GOVERNING IDEA: Kova's receipt printer. A till printer sits in every shot; each feature prints
 * one line on the same paper, the moment the app on the phone finishes it. The paper is the one
 * object that never cuts: it glides between shots while everything round it changes. At the end
 * the camera pulls back to the whole receipt, its total prints on the hit (NETWORK FEES $0.00),
 * and it tears off.
 *
 * Every phone is the real app, recorded on the Kova simulator as it played each flow by itself
 * (scripts/day/rec.sh, apps/mobile dev links), on Monad testnet with test dollars, 10 Nov 2026:
 *   01 Mia's Bakery, table 3: croissant + flat white, $7.75, "Fee $0.00, Kova covers it", Paid!
 *   02 Sam → Mia $2.50, "Arrived in 1.44 s"
 *   03 Mia → Sam $2.00 privately: "to 0x1b7E…5842, an address made for this payment alone";
 *      Sam's private dollars, "From Mia"
 *   04 $1.00 signed with no signal (status bar shows none), a payment code; settled back online
 *   05 a $5.00 link, "Dinner, my treat"
 *   08 Sam's Weaves till: woven pouch $9.00, paid by a customer's wallet, "Card fees $0.00"
 *   09 payroll: 3 people, $1.00 each, each to a one-time address
 *   10 the Kova Card, $50 a day
 *   11 cash out, Kenya, M-Pesa: $50 → KES 6,334.46 (the app's demo payout; the rate is live)
 * Send sheets open over Home (dev link `then=`), as they do in the app. 01-04 are fresh wallets
 * for Sam and Mia, so nothing older shows in their lists.
 * And from real mainnet runs: 06 the founder's $5.00 → 0.01225 TSLAx (xStocks, 29 Oct), 07 his
 * dollar card ••3421 paying NAME-CHEAP.COM $2.20 (2 Nov). 12: the API's own SMS and USSD text
 * from a real run ("$1.00 arrived in your USSD pocket. Balance $10.25").
 * NETWORK FEES $0.00 is true of every line: Kova's relayer pays the gas.
 *
 * Motion vocabulary (nothing moves any other way):
 *   mono text     prints: one character a frame, as the paper feeds a line up (receipt only)
 *   display text  rises through a mask (0.6 s, decelerated)
 *   objects       rise 44 px (0.6 s, decelerated); phone footage cuts hard on the beat inside them
 *   exit          accelerated fade with an 8 px lift, 0.25 s, before every cut
 *   the printer   glides between shots (0.5 s, ease in-out): the one thing that never cuts
 *   camera        one move: the pull back to the whole receipt (42.0-46.4)
 *   signature     the total prints on the hit (44.0), coral, then the receipt tears off
 *   Kovi          once, the one bouncy thing: he peeks over the end card and waves
 *   texture       grain only. Accent: coral only.
 *
 * Layout ledger (no archetype twice in a row, none more than twice):
 *    0 pay       Split (phone left, words right)
 *    6 send      Editorial left (huge words left, phone right)
 *   10 private   Z-axis cascade (Ada's phone behind, Sam's in front, both tilted)
 *   14 offline   Baseline anchor (the phone low and huge, cut by the frame; words flank it)
 *   18 link      Extreme scale contrast (the envelope enormous, the line small)
 *   21 stocks    Asymmetric bento (the phone, the words, the small print, the printer)
 *   24 card      Full-bleed ink (the real card, dark mode, edge to edge of its half)
 *   27 shop      Split (the till left, words right)
 *   30 payroll   Editorial left (words left, the run right)
 *   32 kovacard  Z-axis cascade (the phone tilted, the words behind it)
 *   34 cashout   Baseline anchor (the phone low, words flank it)
 *   38 basic     Centred hero (the basic phone)
 *   42 total     Full-bleed ink (the whole receipt)
 *   48 end       Centred hero (the logo, the link; Kovi)
 *
 * Audit: enter styles 2 (print, rise) · every exit animated · bouncy: Kovi only · camera moves 1 ·
 * accent: coral only · texture: grain · depth: the private cascade · any two beats tell apart: yes.
 */

export const DURATION = cues.duration
const F = 'Manrope, system-ui, sans-serif'
const MONO = 'JetBrains Mono, ui-monospace, monospace'
const K = { ...C, muted: '#566568', receipt: '#fbf9f4', rule: '#cdc8bf', tesla: '#e82127' }
const SHOT = Object.fromEntries(cues.shots.map((s) => [s.id, s])) as Record<string, { id: string; at: number; to: number }>
type Line = (typeof cues.lines)[number]

// ── Ground ───────────────────────────────────────────────────────────────────────────────────────

const INK_SHOTS = ['card', 'total']
const shotAt = (t: number) => cues.shots.find((s) => t >= s.at && t < s.to) ?? cues.shots[cues.shots.length - 1]

function Ground({ t, frame }: { t: number; frame: number }) {
  const ink = INK_SHOTS.includes(shotAt(t).id)
  return (
    <AbsoluteFill style={{ background: ink ? K.ink : K.paper }}>
      <Grain frame={frame} />
    </AbsoluteFill>
  )
}

// ── Presence: enter and exit ─────────────────────────────────────────────────────────────────────

/** Objects rise into place at `at` and leave with an accelerated fade just before `out`. */
/** Shots overlap by a few frames: the next one starts rising 0.1 s before the cut, the last one
 *  finishes leaving 0.08 s after it, so a cut never dips to an empty frame. */
const LEAD = 0.1
const TAIL = 0.08
function presence(t: number, at: number, out: number, distance = 44) {
  const a = at - LEAD
  const e = decel(span(t, a, a + 0.55))
  const x = accel(span(t, out - 0.12, out + TAIL))
  return { opacity: e * (1 - x), y: (1 - e) * distance - 8 * x, visible: t >= a && t < out + TAIL }
}

/** Display words rise through a mask, and fade with a short lift before the cut. */
function Words({ t, at, out, size, children, x, y, color = K.ink, align = 'left', weight = 800, width }: {
  t: number; at: number; out: number; size: number; children: ReactNode; x: number; y: number; color?: string; align?: 'left' | 'right' | 'center'; weight?: number; width?: number
}) {
  if (t < at - 0.02 || t >= out + TAIL) return null
  const e = decel(span(t, at, at + 0.6))
  const l = accel(span(t, out - 0.12, out + TAIL))
  const left = align === 'right' ? x - (width ?? 0) : align === 'center' ? x - (width ?? 0) / 2 : x
  return (
    <div style={{ position: 'absolute', left, top: y, width, overflow: 'hidden', paddingBottom: size * 0.18, textAlign: align }}>
      <div
        style={{
          fontFamily: F, fontSize: size, fontWeight: weight, lineHeight: 1.02, color, whiteSpace: 'pre',
          letterSpacing: -size * 0.045, transform: `translateY(${(1 - e) * size * 1.2 - l * 8}px)`, opacity: 1 - l,
        }}
      >
        {children}
      </div>
    </div>
  )
}

const Dot = ({ color = K.coral }: { color?: string }) => <span style={{ color }}>.</span>

function Small({ t, at, out, x, y, children, color = K.muted, width = 560 }: { t: number; at: number; out: number; x: number; y: number; children: ReactNode; color?: string; width?: number }) {
  const p = presence(t, at, out, 16)
  if (!p.visible) return null
  return <p style={{ position: 'absolute', left: x, top: y, width, margin: 0, opacity: p.opacity, transform: `translateY(${p.y}px)`, fontFamily: F, fontWeight: 600, fontSize: 21, lineHeight: 1.35, color }}>{children}</p>
}

// ── Phones: the real recordings ──────────────────────────────────────────────────────────────────

/** The simulator's recordings are 1178 × 2556 (made a steady 30 fps, scripts/day). */
const SRC = { w: 1178, h: 2556 }
const CLIP_H = DEVICE.screen.w * (SRC.h / SRC.w)
type Cut = { at: number; to: number; from: number; clip: string }

function Footage({ cuts }: { cuts: Cut[] }) {
  // The first cut starts a little early and the last runs a little late, for the overlap.
  const padded = cuts.map((c, i) => ({
    ...c,
    at: i === 0 ? c.at - LEAD - 0.04 : c.at,
    from: i === 0 ? Math.max(0, c.from - LEAD - 0.04) : c.from,
    to: i === cuts.length - 1 ? c.to + TAIL + 0.04 : c.to,
  }))
  return (
    <>
      {padded.map((c) => (
        <Sequence key={`${c.clip}${c.at}`} from={Math.round(c.at * FPS)} durationInFrames={Math.max(1, Math.round((c.to - c.at) * FPS))} layout="none">
          <div style={{ position: 'absolute', left: 0, top: (DEVICE.screen.h - CLIP_H) / 2, width: DEVICE.screen.w, height: CLIP_H }}>
            <OffthreadVideo src={staticFile(`day/half/${c.clip}.mp4`)} startFrom={Math.round(c.from * FPS)} muted style={{ width: '100%', height: '100%' }} />
          </div>
        </Sequence>
      ))}
    </>
  )
}

function Phone({ t, x, y, h, cuts, at, out, rot = 0, blur = 0, children }: {
  t: number; x: number; y: number; h: number; cuts?: Cut[]; at: number; out: number; rot?: number; blur?: number; children?: ReactNode
}) {
  const p = presence(t, at, out)
  if (!p.visible) return null
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: p.opacity, transform: `translateY(${p.y}px)`, filter: blur > 0.05 ? `blur(${blur}px)` : undefined }}>
      <Device x={x} y={y} h={h} screen={null} frame="dollar-card/device-frame-open.png" style={{ transform: `rotate(${rot}deg)` }}>
        {cuts ? <Footage cuts={cuts} /> : null}
        {children}
      </Device>
    </div>
  )
}

/** A still capture of the web wallet (1179 × 2556), for the Tesla buy. */
function Still({ src }: { src: string }) {
  const h = DEVICE.screen.w * (2556 / 1179)
  return <Img src={staticFile(src)} style={{ position: 'absolute', left: 0, top: (DEVICE.screen.h - h) / 2, width: DEVICE.screen.w, height: h }} />
}

/**
 * A window onto part of a recording, at `scale` of its pixels: a large, sharp crop of one piece of
 * real UI, with the sticker outline Kova draws round its cards.
 */
function Crop({ t, at, out, clip, from, src = SRC, sx, sy, sw, sh, scale, x, y, rot = 0, radius = 40, outline = K.ink, hold = false }: {
  t: number; at: number; out: number; clip: string; from: number; src?: { w: number; h: number }; sx: number; sy: number; sw: number; sh: number; scale: number; x: number; y: number; rot?: number; radius?: number; outline?: string; hold?: boolean
}) {
  // `hold`: this crop cuts in where another one was, so it arrives without a rise.
  const p = presence(t, hold ? at - 1 : at, out)
  if (!p.visible || (hold && t < at)) return null
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: sw * scale, height: sh * scale, opacity: p.opacity, transform: `translateY(${p.y}px) rotate(${rot}deg)`, borderRadius: radius, overflow: 'hidden', boxShadow: `0 0 0 3px ${outline}` }}>
      <Sequence from={Math.round((at - LEAD - 0.04) * FPS)} durationInFrames={Math.round((out - at + LEAD + TAIL + 0.08) * FPS)} layout="none">
        <OffthreadVideo
          src={staticFile(clip)}
          startFrom={Math.max(0, Math.round((from - LEAD - 0.04) * FPS))}
          muted
          style={{ position: 'absolute', left: -sx * scale, top: -sy * scale, width: src.w * scale, height: src.h * scale, maxWidth: 'none' }}
        />
      </Sequence>
    </div>
  )
}

// ── The printer ──────────────────────────────────────────────────────────────────────────────────

const W = 640
const HEADER = 200
const LH = 108
const TOTAL_H = 196
/** Where the printer sits in each shot: the slot's centre (x, y), its scale and how much paper shows. */
const PLACE: Record<string, { x: number; y: number; s: number; win: number }> = {
  pay: { x: 1390, y: 1012, s: 1, win: 390 },
  send: { x: 470, y: 1012, s: 1, win: 400 },
  private: { x: 450, y: 1012, s: 0.9, win: 400 },
  offline: { x: 330, y: 1012, s: 0.78, win: 400 },
  link: { x: 1530, y: 1012, s: 0.86, win: 420 },
  stocks: { x: 1560, y: 1012, s: 0.86, win: 440 },
  card: { x: 450, y: 1012, s: 0.9, win: 400 },
  shop: { x: 1390, y: 1012, s: 1, win: 400 },
  payroll: { x: 470, y: 1012, s: 0.9, win: 420 },
  kovacard: { x: 1530, y: 1012, s: 0.86, win: 440 },
  cashout: { x: 330, y: 1012, s: 0.78, win: 420 },
  basic: { x: 1560, y: 1012, s: 0.8, win: 440 },
  total: { x: 960, y: 1034, s: 0.59, win: 2000 },
  end: { x: 960, y: 1034, s: 0.59, win: 2000 },
}

/**
 * The film's camera, both moves on the receipt: from the cut to ink (42.0) it travels down the
 * paper from the header to the slot, arriving as the total prints (44.0); then it pulls back to
 * the whole receipt (45.0-46.4).
 */
function totalCamera(t: number) {
  const s0 = 0.92
  const before = HEADER + cues.lines.length * LH
  const top = 36
  const pan = easeInOut(span(t, SHOT.total.at, cues.total.at))
  const pull = easeInOut(span(t, cues.total.at + 1.0, cues.total.at + 2.4))
  const y = mix(top + before * s0, 1034, pan)
  return { x: 960, y: mix(y, 1034, pull), s: mix(s0, PLACE.total.s, pull), win: 2000 }
}

function placeAt(t: number) {
  const i = cues.shots.findIndex((s) => t >= s.at && t < s.to)
  const k = i < 0 ? cues.shots.length - 1 : i
  const now = PLACE[cues.shots[k].id]
  const prev = PLACE[cues.shots[Math.max(0, k - 1)].id]
  const at = cues.shots[k].at
  if (cues.shots[k].id === 'total' || cues.shots[k].id === 'end') return totalCamera(t)
  const p = easeInOut(span(t, at, at + 0.5))
  return { x: mix(prev.x, now.x, p), y: mix(prev.y, now.y, p), s: mix(prev.s, now.s, p), win: mix(prev.win, now.win, p) }
}

/** How far a line has fed out of the slot (0 → 1 over 0.24 s from when it prints). */
const fed = (t: number, at: number) => decel(span(t, at, at + 0.24))
/** Characters printed of a string, one a frame, starting `delay` seconds after `at`. */
const printed = (t: number, at: number, s: string, delay = 0) => s.slice(0, Math.max(0, Math.floor((t - at - delay) * FPS)))

function ReceiptLine({ t, line, top }: { t: number; line: Line; top: number }) {
  const label = `${line.n}  ${line.label}`
  return (
    <div style={{ position: 'absolute', left: 30, right: 30, top, height: LH }}>
      <div style={{ position: 'absolute', left: 0, top: 18, fontFamily: MONO, fontSize: 30, fontWeight: 500, color: K.ink, whiteSpace: 'pre' }}>
        {printed(t, line.at, label)}
      </div>
      <div style={{ position: 'absolute', right: 0, top: 18, fontFamily: MONO, fontSize: 30, fontWeight: 500, color: K.ink, whiteSpace: 'pre' }}>
        {printed(t, line.at, line.amount, label.length / FPS)}
      </div>
      <div style={{ position: 'absolute', left: 54, top: 62, fontFamily: MONO, fontSize: 22, fontWeight: 500, color: K.muted, whiteSpace: 'pre' }}>
        {printed(t, line.at, line.sub, 0.12)}
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, borderBottom: `2px dotted ${K.rule}`, opacity: t > line.at + 0.3 ? 1 : 0 }} />
    </div>
  )
}

function Printer({ t }: { t: number }) {
  const place = placeAt(t)
  const lines = cues.lines
  const totalAt = cues.total.at
  // Paper out of the slot: the header, every line printed so far, and the total.
  const fedLines = lines.reduce((sum, l) => sum + fed(t, l.at), 0)
  const height = HEADER + fedLines * LH + fed(t, totalAt) * TOTAL_H
  // The tear: the receipt lifts off the slot and tilts a little.
  const tear = decel(span(t, cues.total.tear, cues.total.tear + 0.6))
  const leave = accel(span(t, cues.end.at - 0.05, cues.end.at + 0.5))
  if (leave >= 1) return null
  const zig = 'polygon(' + Array.from({ length: 31 }, (_, i) => `${(i / 30) * 100}% ${i % 2 ? 0 : 14}px`).join(',') + ', 100% 100%, 0 100%)'
  const zigBottom = 'polygon(0 0, 100% 0, ' + Array.from({ length: 31 }, (_, i) => `${100 - (i / 30) * 100}% calc(100% - ${i % 2 ? 0 : 14}px)`).join(',') + ')'
  return (
    <div style={{ position: 'absolute', left: place.x, top: place.y, transform: `scale(${place.s})`, transformOrigin: '0 0', opacity: 1 - leave }}>
      {/* The window: paper shows from the slot up by `win`, fading where it runs on above. */}
      <div
        style={{
          position: 'absolute', left: -W / 2 - 20, top: -place.win, width: W + 40, height: place.win, overflow: 'hidden',
          WebkitMaskImage: height > place.win ? 'linear-gradient(to bottom, transparent 0, #000 90px)' : undefined,
        }}
      >
        <div
          style={{
            position: 'absolute', left: 20, width: W, top: place.win - height - 4 - tear * 34 + leave * 140, height: height + 4,
            transform: `rotate(${-1.6 * tear}deg)`, transformOrigin: '50% 100%',
          }}
        >
          {/* the paper, with a torn top edge, and a torn bottom once it's cut */}
          <div style={{ position: 'absolute', inset: 0, background: K.ink, clipPath: zig }} />
          <div style={{ position: 'absolute', left: 3, right: 3, top: 3, bottom: 0, background: K.receipt, clipPath: zig }} />
          {tear > 0 ? <div style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 18, background: K.ink, clipPath: zigBottom, opacity: tear }} /> : null}
          {/* header */}
          <div style={{ position: 'absolute', left: 0, right: 0, top: 44, display: 'flex', justifyContent: 'center' }}>
            <Logo h={58} />
          </div>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 122, textAlign: 'center', fontFamily: MONO, fontSize: 19, color: K.muted, letterSpacing: 3 }}>
            MYKOVA.APP · ON MONAD
          </div>
          <div style={{ position: 'absolute', left: 30, right: 30, top: HEADER - 16, borderBottom: `2px dashed ${K.ink}` }} />
          {lines.map((l, i) => (t >= l.at ? <ReceiptLine key={l.n} t={t} line={l} top={HEADER + i * LH} /> : null))}
          {t >= totalAt ? <Total t={t} top={HEADER + lines.length * LH} /> : null}
        </div>
      </div>
      {/* the slot */}
      <div style={{ position: 'absolute', left: -W / 2 - 34, top: -6, width: W + 68, height: 22, borderRadius: 11, background: K.ink }} />
    </div>
  )
}

function Total({ t, top }: { t: number; top: number }) {
  const at = cues.total.at
  const slam = decel(span(t, at, at + 0.3))
  return (
    <div style={{ position: 'absolute', left: 30, right: 30, top, height: TOTAL_H }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 14, borderTop: `3px solid ${K.ink}` }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 22, borderTop: `3px solid ${K.ink}` }} />
      <div style={{ position: 'absolute', left: 0, top: 48, fontFamily: MONO, fontSize: 32, fontWeight: 500, color: K.ink, whiteSpace: 'pre' }}>{printed(t, at, 'NETWORK FEES')}</div>
      <div style={{ position: 'absolute', right: 0, top: 30, fontFamily: F, fontSize: 66, fontWeight: 800, letterSpacing: -2, color: K.coral, transform: `scale(${mix(1.25, 1, slam)})`, transformOrigin: 'right center', opacity: slam }}>
        $0.00
      </div>
      <div style={{ position: 'absolute', left: 0, top: 124, fontFamily: MONO, fontSize: 26, fontWeight: 500, color: K.muted, whiteSpace: 'pre' }}>{printed(t, at, 'APPS YOU NEEDED', 0.3)}</div>
      <div style={{ position: 'absolute', right: 0, top: 124, fontFamily: MONO, fontSize: 26, fontWeight: 500, color: K.ink, whiteSpace: 'pre' }}>{printed(t, at, '1', 0.8)}</div>
    </div>
  )
}

// ── The basic phone (drawn; its words are the API's own) ────────────────────────────────────────

const BP = { w: 420, h: 900 }
const KEYS = [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'], ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['*', ''], ['0', '+'], ['#', '']] as const
const SMS = 'Kova: $1.00 arrived in your USSD pocket. Balance $10.25. Dial *384*53916# to use it.'
const CODE = '*384*53916#'
const MENU = ['Kova', '1 Balance', '2 Pay a till', '3 Send to a phone', '4 My payments', '5 Cash out']

function BasicPhone({ x, top, h, children, press, shake = 0 }: { x: number; top: number; h: number; children?: ReactNode; press?: string | null; shake?: number }) {
  const s = h / BP.h
  return (
    <div style={{ position: 'absolute', left: x - (BP.w * s) / 2 + shake, top, width: BP.w * s, height: h }}>
      <div style={{ position: 'absolute', width: BP.w, height: BP.h, transform: `scale(${s})`, transformOrigin: 'top left', fontFamily: F }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: 96, background: 'linear-gradient(160deg, #24434a 0%, #12292e 42%, #0b1a1d 100%)', border: `8px solid ${K.ink}`, boxShadow: 'inset 0 4px 0 rgba(255,255,255,.14), inset 0 -8px 0 rgba(0,0,0,.35)' }} />
        <div style={{ position: 'absolute', left: 170, top: 42, width: 80, height: 12, borderRadius: 6, background: '#33494d' }} />
        <div style={{ position: 'absolute', left: 44, top: 92, width: 332, height: 356, borderRadius: 34, background: '#07141a' }}>
          <div style={{ position: 'absolute', inset: 14, borderRadius: 22, overflow: 'hidden', background: 'linear-gradient(180deg, #d9e8d9 0%, #bdd3c0 100%)', boxShadow: 'inset 0 6px 14px rgba(0,0,0,.25)' }}>
            <div style={{ position: 'absolute', inset: 0, opacity: 0.18, backgroundImage: 'repeating-linear-gradient(0deg, #3b5a48 0 1px, transparent 1px 4px), repeating-linear-gradient(90deg, #3b5a48 0 1px, transparent 1px 4px)' }} />
            <div style={{ position: 'absolute', left: 16, right: 16, top: 10, display: 'flex', justifyContent: 'space-between', fontSize: 17, fontWeight: 800, color: '#1d332b', letterSpacing: 0.5 }}>
              <span>▂▄▆</span>
              <span>no data</span>
            </div>
            <div style={{ position: 'absolute', left: 18, right: 18, top: 42, bottom: 14, color: '#10241c', WebkitMaskImage: 'radial-gradient(circle, #000 0 1.15px, transparent 1.45px)', WebkitMaskSize: '3px 3px' }}>
              {children}
            </div>
          </div>
        </div>
        <div style={{ position: 'absolute', left: 56, top: 474, width: 92, height: 32, borderRadius: 16, background: '#1c3236' }} />
        <div style={{ position: 'absolute', left: 272, top: 474, width: 92, height: 32, borderRadius: 16, background: '#1c3236' }} />
        <div style={{ position: 'absolute', left: 164, top: 462, width: 92, height: 92, borderRadius: 999, background: '#16292d', border: '6px solid #2a4247' }} />
        {KEYS.map(([k, sub], i) => {
          const on = press === k
          return (
            <div key={k} style={{ position: 'absolute', left: 54 + (i % 3) * 110, top: 576 + Math.floor(i / 3) * 76, width: 92, height: 62, borderRadius: 20, background: on ? K.coral : '#1c3236', color: on ? K.ink : '#e3ece7', transform: `scale(${on ? 0.94 : 1})`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
              <span style={{ fontSize: 28, fontWeight: 800 }}>{k}</span>
              {sub ? <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.7, marginTop: 3, letterSpacing: 1 }}>{sub}</span> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Basic({ t }: { t: number }) {
  const s = SHOT.basic
  const p = presence(t, s.at, s.to)
  if (!p.visible) return null
  const { sms, dial } = cues.basic
  const keyStep = 0.07
  const typed = Math.max(0, Math.min(CODE.length, Math.floor((t - dial) / keyStep) + 1))
  const pressing = t >= dial && t < dial + CODE.length * keyStep ? CODE[Math.floor((t - dial) / keyStep)] : null
  const menuAt = dial + CODE.length * keyStep + 0.35
  // The text arriving buzzes the phone for a moment.
  const shake = t >= sms && t < sms + 0.35 ? Math.sin((t - sms) * 90) * 5 * (1 - (t - sms) / 0.35) : 0
  let lcd: ReactNode
  if (t < sms) lcd = <div style={{ display: 'grid', placeItems: 'center', height: '100%', fontSize: 64, fontWeight: 800, letterSpacing: -1 }}>12:41</div>
  else if (t < dial) lcd = <div style={{ fontSize: 23, fontWeight: 800, lineHeight: 1.24 }}>{SMS}</div>
  else if (t < menuAt) lcd = <div style={{ display: 'grid', placeItems: 'center', height: '100%', fontSize: 40, fontWeight: 800 }}>{CODE.slice(0, typed)}</div>
  else lcd = <div style={{ fontSize: 25, fontWeight: 800, lineHeight: 1.32 }}>{MENU.map((m) => <div key={m}>{m}</div>)}</div>
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: p.opacity, transform: `translateY(${p.y}px)` }}>
      <BasicPhone x={960} top={214} h={830} press={pressing} shake={shake}>{lcd}</BasicPhone>
    </div>
  )
}

// ── The shots ────────────────────────────────────────────────────────────────────────────────────

function Shots({ t }: { t: number }) {
  const S = SHOT
  return (
    <>
      {/* 01 Pay: Split. The real order at Mia's Bakery: the menu, the order, Confirm, Paid! (4.0).
          The menu is one held frame of a second take (pay-open), where its photos had loaded. */}
      <Phone t={t} x={560} y={560} h={960} at={-1} out={S.pay.to} cuts={[
        { at: 0, to: 1.93, from: 0.14, clip: 'pay-open' },
        { at: 1.93, to: 2.93, from: 9.0, clip: 'pay' },
        { at: 2.93, to: 3.93, from: 12.4, clip: 'pay' },
        { at: 3.93, to: 6.0, from: 19.2, clip: 'pay' },
      ]} />
      <Words t={t} at={0.15} out={S.pay.to} size={124} x={960} y={250}>{'Pay any\nshop'}<Dot /></Words>

      {/* 02 Send: Editorial left. The sheet rises over Home; Sent lands on 8.0, "Arrived in 1.44 s". */}
      <Words t={t} at={S.send.at + 0.05} out={S.send.to} size={150} x={120} y={150}>{'Send in\na second'}<Dot /></Words>
      <Phone t={t} x={1450} y={560} h={940} at={S.send.at} out={S.send.to} cuts={[
        { at: 6, to: 7.0, from: 7.25, clip: 'send' },
        { at: 7.0, to: 7.93, from: 9.8, clip: 'send' },
        { at: 7.93, to: 10, from: 15.6, clip: 'send' },
      ]} />

      {/* 03 Private: Z-axis cascade. Mia sends privately (Sent privately on 12.0); Sam's phone shows it. */}
      <Phone t={t} x={1030} y={540} h={830} rot={-4} blur={t > 12.2 ? mix(0, 2.2, span(t, 12.2, 12.8)) : 0} at={S.private.at} out={S.private.to} cuts={[
        { at: 10, to: 11.93, from: 7.35, clip: 'mia-private-sheet' },
        { at: 11.93, to: 14, from: 15.95, clip: 'mia-private-sheet' },
      ]} />
      <Phone t={t} x={1470} y={600} h={940} rot={3} at={12.2} out={S.private.to} cuts={[{ at: 12.2, to: 14, from: 8.55, clip: 'private-arrive' }]} />
      <Words t={t} at={S.private.at + 0.05} out={S.private.to} size={112} x={120} y={300}>{'Get paid\nprivately'}<Dot /></Words>

      {/* 04 Offline: Baseline anchor. Signed with no signal, a code (15.5), settled back online (17.0). */}
      <Phone t={t} x={960} y={790} h={1240} at={S.offline.at} out={S.offline.to} cuts={[
        { at: 14, to: 15.43, from: 7.2, clip: 'offline' },
        { at: 15.43, to: 16.5, from: 14.4, clip: 'offline' },
        { at: 16.5, to: 18, from: 6.83, clip: 'online' },
      ]} />
      <Words t={t} at={S.offline.at + 0.05} out={S.offline.to} size={104} x={120} y={250}>{'Pay with'}</Words>
      <Words t={t} at={S.offline.at + 0.2} out={S.offline.to} size={104} x={1800} width={560} align="right" y={250}>{'no signal'}<Dot /></Words>

      {/* 05 Link: Extreme scale contrast. The envelope, enormous; ready at 19.5. */}
      <Crop t={t} at={S.link.at} out={19.7} clip="day/link-crop.mp4" from={1.0} src={{ w: 960, h: 960 }} sx={0} sy={95} sw={960} sh={865} scale={1.04} x={110} y={80} />
      <Crop t={t} at={19.43} out={S.link.to} hold clip="day/link-crop.mp4" from={9.1} src={{ w: 960, h: 960 }} sx={0} sy={95} sw={960} sh={865} scale={1.04} x={110} y={80} />
      <Words t={t} at={S.link.at + 0.1} out={S.link.to} size={70} x={1180} y={250}>{'Send money\nas a link'}<Dot /></Words>

      {/* 06 Stocks: Asymmetric bento. The founder's real buy on mainnet, 29 Oct: $5 → 0.01225 TSLAx. */}
      <Phone t={t} x={1000} y={560} h={960} at={S.stocks.at} out={S.stocks.to}>
        {t < 22 ? <Still src="xstocks/01-stock.png" /> : t < 22.5 ? <Still src="xstocks/03-amount-5.png" /> : t < 23 ? <Still src="xstocks/04-review-50.png" /> : <Still src="xstocks/06-bought.png" />}
      </Phone>
      <Words t={t} at={S.stocks.at + 0.05} out={S.stocks.to} size={92} x={120} y={150}>{'Buy a slice\nof Tesla'}<Dot /></Words>
      <Small t={t} at={S.stocks.at + 0.3} out={S.stocks.to} x={120} y={930} width={560}>
        xStocks are tokens issued by Backed, backed 1:1 by shares. Not available in the US and some other countries.
      </Small>

      {/* 07 Card: Full-bleed ink. The founder's dollar card ••3421 paying NAME-CHEAP.COM $2.20 (2 Nov). */}
      <Crop t={t} at={S.card.at} out={S.card.to} clip="day/card-crop.mp4" src={{ w: 920, h: 920 }} from={0.5} sx={0} sy={0} sw={920} sh={920} scale={1} x={900} y={80} radius={44} outline="#2a3b3e" />
      <Words t={t} at={S.card.at + 0.05} out={S.card.to} size={96} x={120} y={210} color={K.surface}>{'A card for\nonline shops'}<Dot /></Words>

      {/* 08 Shop: Split. Sam's Weaves till: $9.00, Paid! at 28.5. */}
      <Phone t={t} x={560} y={560} h={960} at={S.shop.at} out={S.shop.to} cuts={[
        { at: 27, to: 28.43, from: 8.4, clip: 'till' },
        { at: 28.43, to: 30, from: 27.3, clip: 'till' },
      ]} />
      <Words t={t} at={S.shop.at + 0.05} out={S.shop.to} size={112} x={960} y={250}>{'Your phone\nis the till'}<Dot /></Words>

      {/* 09 Payroll: Editorial left. October salary, 3 of 3 people, each to a one-time address. */}
      <Words t={t} at={S.payroll.at + 0.05} out={S.payroll.to} size={116} x={120} y={180}>{'Pay your\nwhole team'}<Dot /></Words>
      <Phone t={t} x={1450} y={560} h={940} at={S.payroll.at} out={S.payroll.to} cuts={[{ at: 30, to: 32, from: 19.3, clip: 'payroll' }]} />

      {/* 10 Kova Card: Z-axis cascade. The card, $50 a day. */}
      <Words t={t} at={S.kovacard.at + 0.05} out={S.kovacard.to} size={112} x={120} y={170}>{'Tap to pay.\nYour limit'}<Dot /></Words>
      <Phone t={t} x={1000} y={600} h={960} rot={-5} at={S.kovacard.at} out={S.kovacard.to} cuts={[{ at: 32, to: 34, from: 14.6, clip: 'kovacard' }]} />

      {/* 11 Cash out: Baseline anchor. Kenya, M-Pesa, $50 → KES 6,334.46, Arrived (37.5). */}
      <Phone t={t} x={960} y={790} h={1240} at={S.cashout.at} out={S.cashout.to} cuts={[
        { at: 34, to: 35, from: 12.3, clip: 'cashout' },
        { at: 35, to: 36, from: 16.5, clip: 'cashout' },
        { at: 36, to: 37, from: 29.1, clip: 'cashout' },
        { at: 37, to: 38, from: 38.9, clip: 'cashout' },
      ]} />
      <Words t={t} at={S.cashout.at + 0.05} out={S.cashout.to} size={100} x={120} y={250}>{'Cash out'}</Words>
      <Words t={t} at={S.cashout.at + 0.2} out={S.cashout.to} size={100} x={1800} width={700} align="right" y={250}>{'in 50+\ncountries'}<Dot /></Words>

      {/* 12 Basic phone: Centred hero. The API's own SMS (39.0), then the code, then the menu. */}
      <Basic t={t} />
      <Words t={t} at={S.basic.at + 0.05} out={S.basic.to} size={82} x={960} width={1400} align="center" y={60}>{'Even on a basic phone'}<Dot /></Words>

      {/* 13 Total: Full-bleed ink. The whole receipt; the total prints on the hit (44.0). */}
      <Words t={t} at={cues.total.headline} out={S.total.to} size={124} x={120} y={330} color={K.surface}>{'All of it'}<Dot /></Words>
      <Words t={t} at={cues.total.headline + 0.25} out={S.total.to} size={124} x={1800} width={560} align="right" y={520} color={K.surface}>{'One app'}<Dot /></Words>
    </>
  )
}

// ── The end card ─────────────────────────────────────────────────────────────────────────────────

function End({ t }: { t: number }) {
  const at = cues.end.at
  if (t < at) return null
  const logo = decel(span(t, at + 0.1, at + 0.7))
  const kovi = cues.end.kovi
  // Kovi pops up from behind the logo's baseline and hops: the film's one bouncy moment.
  const up = decel(span(t, kovi, kovi + 0.45))
  const y = mix(230, 20, up) + hop(t, kovi + 0.45, 30)
  const fade = accel(span(t, DURATION - 0.6, DURATION))
  return (
    <AbsoluteFill style={{ opacity: 1 - fade }}>
      <div style={{ position: 'absolute', left: 1196, top: 330, width: 210, height: 222, overflow: 'hidden' }}>
        <Img src={staticFile('art/kovi-wave.png')} style={{ position: 'absolute', left: 0, top: y, width: 200, height: 200 }} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 380, display: 'flex', justifyContent: 'center', opacity: logo, transform: `translateY(${(1 - logo) * 44}px)` }}>
        <Logo h={170} />
      </div>
      <Words t={t} at={at + 0.5} out={DURATION + 1} size={60} weight={700} x={960} width={1200} align="center" y={612}>{'mykova.app'}</Words>
      <Small t={t} at={at + 0.9} out={DURATION + 1} x={560} y={716} width={800} color={K.muted}>
        <span style={{ display: 'block', textAlign: 'center' }}>Live on Monad mainnet.</span>
      </Small>
    </AbsoluteFill>
  )
}

export function Film() {
  const frame = useCurrentFrame()
  const t = frame / FPS
  return (
    <AbsoluteFill style={{ background: K.paper, overflow: 'hidden' }}>
      <Ground t={t} frame={frame} />
      <Shots t={t} />
      <Printer t={t} />
      <End t={t} />
      <Html5Audio src={staticFile('day/mix.wav')} />
    </AbsoluteFill>
  )
}

