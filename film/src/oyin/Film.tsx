import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, Img, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion'
import vo from '../../public/oyin/audio/vo.json'
import { accel, decel, easeInOut, mix, span } from '../motion'
import { Grain } from '../parts'
import cues from './cues.json'

/**
 * "This link is a restaurant." 24.5 s, 16:9, 30 fps, 120 bpm (a beat is 15 frames).
 *
 * GOVERNING IDEA: the link opens. The film starts on a shop's address and every shot is what that
 * address holds: the menu (each dish slams in on a half-beat, its price rolling like a board), the
 * menu landing in the real shop on a real phone, a real order, a real Face ID payment, the receipt,
 * and back to the link. Same board vocabulary as the xStocks film the founder picked: everything
 * arrives by rolling up through a slot, objects slam on the hit.
 *
 * Feeling: "anyone, anywhere, can pay you" (open, quick, warm).
 *
 * Facts (all real): Oyin Kitchen (mykova.app/s/oyin-kitchen), a shop opened on Kova mainnet for this
 * film on 30 Oct 2026 with six dishes (photos: Wikimedia Commons, CC BY-SA 4.0 / CC BY-SA 2.0 / CC0).
 * The founder ordered Party jollof & chicken on his iPhone and paid with Face ID; the footage is his
 * screen recording (public/oyin/rec.mp4, never retimed, only cut). Order ord_06grmr5y… at
 * 01:15:58.466 UTC, paid 01:16:12.066 UTC (14 s), $6.50 AUSD into the shop's own wallet, fees $0.00
 * (Kova's relayer paid the gas), Monad mainnet block 117,764,737, tx 0xc0b3db5d…a045a614.
 *
 * Motion vocabulary (nothing moves any other way):
 *   text enter    Roll: up through a slot, 7 frames decelerated; per character for figures and the
 *                 link, per word for words (as spoken)
 *   object enter  Slam: scale 1.14 → 1 in 5 frames, decelerated, on a hit
 *   exit          shots change on hard cuts on the hits; inside a shot, roll out upward
 *   camera        one move: the phone rises and the menu flies into it (5.85-6.45)
 *   signature     the menu montage, then the six dishes landing in the real shop's grid
 *   accent        coral only (the dishes' grounds are the food's own colours, montage only)
 *   texture       grain only
 *
 * Layout ledger (no archetype twice in a row, none more than twice):
 *   0.0   hook    Z-axis cascade (ink): the line enormous behind, the message with the shop's preview
 *                   in front, tilted 2°; the link is tapped on 2.0
 *   2.5   menu    Full-bleed colour (each dish's own colour): photo left, name and price right
 *   5.5   board   Asymmetric bento (ink): six tiles right; the phone rises left and they fly into it
 *   6.5   order   Split (paper): the real phone left, the line right
 *   10.5  pay     Centred hero (ink): the phone centred, the line flanking it, Paid! on the hit
 *   14.5  proof   Baseline anchor (paper): three figures on one horizon
 *   19.5  end     Split (ink): the line left, the real shop right, the small print
 *
 * Audit: enter styles 2 (roll, slam) · bouncy springs 0 · camera moves 1 · accent: coral ·
 * texture: grain · depth: the board (tiles over the phone) · any two beats tell apart: yes.
 */

export const FPS = 30
export const DURATION = Math.round(cues.duration * FPS)

const K = { paper: '#e7e5e0', ink: '#0b1a1d', coral: '#d46558', dim: 'rgba(231,229,224,0.6)', inkDim: 'rgba(11,26,29,0.55)' }
const MONO = 'Menlo, ui-monospace, monospace'
const M = 120
const H = cues.hits
const F = 1 / FPS

// --- Words, as spoken -------------------------------------------------------------------------

type Word = { text: string; start: number; end: number }
type LineId = keyof typeof cues.vo
const lines = Object.fromEntries((vo.lines as { id: string; words: Word[] }[]).map((l) => [l.id, l.words]))
/** Each word's start on the film's clock, 2 frames early so it lands with the voice. */
function spoken(id: LineId, color?: (w: string) => string | undefined) {
  return lines[id].map((w) => ({ text: w.text, at: cues.vo[id] + w.start - 2 * F, color: color?.(w.text) }))
}

// --- The board's roll -------------------------------------------------------------------------

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

function Figures({ text, t, a, o, step = F, style }: { text: string; t: number; a: number; o?: number; step?: number; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', whiteSpace: 'pre', fontVariantNumeric: 'tabular-nums', ...style }}>
      {[...text].map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: characters of a fixed string
        <Slot key={i} y={slot(t, a + i * step, o === undefined ? undefined : o + i * step)}>
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

// --- The tape: the one real order, a thin mono line under every shot ----------------------------

const R = cues.receipt
const TAPE = `OYIN KITCHEN  •  PARTY JOLLOF & CHICKEN × 1  •  $6.50 AUSD  •  ORDERED 01:15:58 UTC  •  PAID 01:16:12 UTC  •  FEES $0.00, GAS PAID BY KOVA  •  INTO THE SHOP’S OWN WALLET  •  MONAD MAINNET  •  BLOCK 117,764,737  •  30 OCT 2026  •  TX ${R.tx}  •  `

function Tape({ t, color }: { t: number; color: string }) {
  const x = -((t * 110) % 2900)
  const mask = 'linear-gradient(90deg, transparent, black 60px, black calc(100% - 60px), transparent)'
  return (
    <div style={{ position: 'absolute', left: M, right: M, top: 1000, height: 26, overflow: 'hidden', WebkitMaskImage: mask, maskImage: mask }}>
      <div style={{ position: 'absolute', top: 2, left: x, whiteSpace: 'pre', fontFamily: MONO, fontSize: 17, letterSpacing: '0.08em', color }}>{TAPE.repeat(3)}</div>
    </div>
  )
}

// --- The phone: the device frame around the real recording -------------------------------------

const PH = 860
const k = PH / 2708
const TOP = 80
type Rect = { x: number; y: number; w: number; h: number }
/** The screen inside a device frame whose left edge is at `fx`. */
const screenAt = (fx: number, fy = TOP): Rect => ({ x: fx + 54 * k, y: fy + 44 * k, w: 1203 * k, h: 2620 * k })
const REC = staticFile('oyin/rec.mp4')

/** The recording's segments that fall inside [a, b) of the film, each a hard cut on its hit. */
function Footage({ a, b }: { a: number; b: number }) {
  return (
    <>
      {cues.segments
        .filter((s) => s.from >= a && s.to <= b)
        .map((s) => (
          <Sequence key={s.from} from={Math.round(s.from * FPS)} durationInFrames={Math.round((s.to - s.from) * FPS)} layout="none">
            <OffthreadVideo src={REC} trimBefore={Math.round(s.rec * FPS)} muted style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          </Sequence>
        ))}
    </>
  )
}

function Phone({ fx, fy = TOP, children, style }: { fx: number; fy?: number; children: ReactNode; style?: CSSProperties }) {
  const s = screenAt(fx, fy)
  const frame: CSSProperties = { position: 'absolute', left: fx, top: fy, width: 1311 * k, height: PH }
  return (
    <div style={{ position: 'absolute', inset: 0, ...style }}>
      <div style={frame}>
        <div style={{ position: 'absolute', left: 38 * k, right: 38 * k, top: 20 * k, bottom: 20 * k, borderRadius: 205 * k, background: K.ink, boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }} />
      </div>
      <div style={{ position: 'absolute', left: s.x, top: s.y, width: s.w, height: s.h, borderRadius: 176 * k, overflow: 'hidden', background: K.paper }}>{children}</div>
      <Img src={staticFile('ios-live-v2/device-frame.png')} style={frame} />
    </div>
  )
}

/** A tap the recording can't show: a coral ring at a point on the screen (fractions of it). */
function TapRing({ t, at, fx, px, py }: { t: number; at: number; fx: number; px: number; py: number }) {
  const p = span(t, at, at + 12 * F)
  if (p <= 0 || p >= 1) return null
  const s = screenAt(fx)
  const r = mix(18, 64, decel(p))
  return <div style={{ position: 'absolute', left: s.x + px * s.w - r, top: s.y + py * s.h - r, width: 2 * r, height: 2 * r, borderRadius: '50%', border: `4px solid ${K.coral}`, opacity: 1 - p }} />
}

// --- Shots ---------------------------------------------------------------------------------------

const LINK = 'mykova.app/s/oyin-kitchen'

/**
 * The link as it arrives in a chat: a message with the shop's preview (its cover, name and line, as
 * mykova.app now serves them for a shop link) and the address. Frame 0 is the thumbnail: the food,
 * the name, the link.
 */
function Hook({ t }: { t: number }) {
  const tap = H.tap
  const press = t >= tap ? Math.sin(decel(span(t, tap, tap + 6 * F)) * Math.PI) : 0
  const ring = span(t, tap, tap + 14 * F)
  const msg = { x: 1010, y: 250, w: 760 }
  const link = { x: msg.x + 360, y: msg.y + 600 }
  const r = mix(30, 150, decel(ring))
  return (
    <AbsoluteFill style={{ background: K.ink, color: K.paper }}>
      <Words
        words={spoken('hook', (w) => (w.startsWith('restaurant') ? K.coral : undefined))}
        t={t}
        style={{ position: 'absolute', left: M - 6, top: 230, width: 900, fontSize: 150, fontWeight: 800, letterSpacing: '-0.045em', lineHeight: 0.98 }}
      />
      <div style={{ position: 'absolute', left: M, top: 760, fontFamily: MONO, fontSize: 24, letterSpacing: '0.04em', color: K.dim }}>
        <Slot y={slot(t, 1.1)}>A shop on Kova, sent as a link</Slot>
      </div>
      <div
        style={{
          position: 'absolute',
          left: msg.x,
          top: msg.y,
          width: msg.w,
          padding: 16,
          borderRadius: '36px 36px 36px 10px',
          background: K.paper,
          color: K.ink,
          boxShadow: '0 30px 80px rgba(0,0,0,0.45)',
          transformOrigin: '0% 100%',
          transform: `rotate(-2deg) scale(${(t < 5 * F ? 1.14 - 0.14 * decel(span(t, 0, 5 * F)) : 1) * (1 - 0.02 * press)})`,
        }}
      >
        <div style={{ borderRadius: 24, overflow: 'hidden', background: '#d9d6cf' }}>
          <Img src={staticFile('oyin/cover-og.jpg')} style={{ display: 'block', width: '100%', height: (msg.w - 32) * (630 / 1200) }} />
          <div style={{ padding: '20px 26px 24px' }}>
            <div style={{ fontFamily: MONO, fontSize: 19, letterSpacing: '0.04em', opacity: 0.6 }}>mykova.app</div>
            <div style={{ fontSize: 31, fontWeight: 800, letterSpacing: '-0.01em', marginTop: 6 }}>Oyin Kitchen · order and pay with Kova</div>
            <div style={{ fontSize: 24, fontWeight: 500, opacity: 0.7, marginTop: 4 }}>Jollof, suya and small chops. Lekki, Lagos.</div>
          </div>
        </div>
        <div style={{ padding: '20px 14px 8px', fontSize: 36, fontWeight: 700, color: t >= tap ? K.coral : '#2f6f73', textDecoration: 'underline', textUnderlineOffset: 6 }}>
          {LINK}
        </div>
      </div>
      {ring > 0 && ring < 1 ? (
        <div style={{ position: 'absolute', left: link.x - r, top: link.y - r, width: 2 * r, height: 2 * r, borderRadius: '50%', border: `5px solid ${K.coral}`, opacity: 1 - ring }} />
      ) : null}
    </AbsoluteFill>
  )
}

type Dish = (typeof cues.dishes)[number]

function Dish({ t, d, i }: { t: number; d: Dish; i: number }) {
  const a = d.at
  return (
    <AbsoluteFill style={{ background: d.bg, color: d.text }}>
      <Img src={staticFile(`oyin/${d.id}-sq.jpg`)} style={{ position: 'absolute', left: M, top: 200, width: 640, height: 640, borderRadius: 28, objectFit: 'cover', ...slam(t, a) }} />
      <div style={{ position: 'absolute', left: 860, top: 236, fontFamily: MONO, fontSize: 24, letterSpacing: '0.1em', opacity: 0.8 }}>
        <Slot y={slot(t, a + 1 * F)}>{`OYIN KITCHEN · ${i + 1}/6`}</Slot>
      </div>
      <Words
        words={d.name.split(' ').map((w, j) => ({ text: w, at: a + (1 + j) * F }))}
        t={t}
        style={{ position: 'absolute', left: 856, top: 290, width: 960, fontSize: 112, fontWeight: 800, letterSpacing: '-0.035em', lineHeight: 1.0 }}
      />
      <Figures text={d.price} t={t} a={a + 4 * F} style={{ position: 'absolute', left: 852, top: 610, fontSize: 200, fontWeight: 800, letterSpacing: '-0.04em' }} />
    </AbsoluteFill>
  )
}

/** Board tiles (canvas px) and where each lands in the real shop's grid (fractions of the screen, measured in rec 6.9 s). */
const TILE = 250
const BOARD_X = 900
const BOARD_Y = 150
const GAP_X = 40
const ROW_H = TILE + 150
const LAND = [
  { x: 0.036, y: 0.384 },
  { x: 0.514, y: 0.384 },
  { x: 0.036, y: 0.662 },
  { x: 0.514, y: 0.662 },
  { x: 0.036, y: 0.939 },
  { x: 0.514, y: 0.939 },
]
const LAND_W = 0.448
const ORDER_FX = 240

function Board({ t }: { t: number }) {
  const [riseA, riseB] = cues.phone.rise
  const [flyA, flyB] = cues.phone.fly
  const rise = decel(span(t, riseA, riseB))
  const dy = Math.round((1 - rise) * 1000)
  const s = screenAt(ORDER_FX)
  return (
    <AbsoluteFill style={{ background: K.ink, color: K.paper }}>
      <div style={{ position: 'absolute', left: M, top: M, fontFamily: MONO, fontSize: 26, letterSpacing: '0.04em', color: K.dim }}>
        <Slot y={slot(t, H.board, riseA)}>{LINK}</Slot>
      </div>
      <Words
        words={[
          { text: 'Six', at: H.board + 2 * F },
          { text: 'dishes.', at: H.board + 4 * F },
          { text: 'One', at: H.board + 6 * F, color: K.coral },
          { text: 'link.', at: H.board + 8 * F, color: K.coral },
        ]}
        t={t}
        o={riseA}
        style={{ position: 'absolute', left: M, top: 400, width: 640, fontSize: 104, fontWeight: 800, letterSpacing: '-0.035em', lineHeight: 1.02 }}
      />
      {t >= riseA ? (
        <Phone fx={ORDER_FX} fy={TOP + dy}>
          <Img src={staticFile('oyin/freeze.png')} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
        </Phone>
      ) : null}
      {cues.dishes.map((d, i) => {
        const col = i % 3
        const row = Math.floor(i / 3)
        const a = H.board + i * 2 * F
        const order = i * 1.5 * F
        const p = easeInOut(span(t, flyA + order, flyB))
        const land = LAND[i]
        const box = {
          x: mix(BOARD_X + col * (TILE + GAP_X), s.x + land.x * s.w, p),
          y: mix(BOARD_Y + row * ROW_H, s.y + land.y * s.h, p),
          w: mix(TILE, LAND_W * s.w, p),
          r: mix(24, 11, p),
        }
        // The bottom row lands below the fold of the page: it fades as it slips under the screen's edge.
        const fade = i >= 4 ? span(t, flyB - 4 * F, flyB) : 0
        const label = 1 - span(t, flyA, flyA + 4 * F)
        return (
          <div key={d.id}>
            <Img
              src={staticFile(`oyin/${d.id}-sq.jpg`)}
              style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.w, borderRadius: box.r, objectFit: 'cover', border: `${mix(3, 2, p)}px solid ${K.ink}`, opacity: 1 - fade, ...(t < flyA ? slam(t, a) : {}) }}
            />
            {label > 0 ? (
              <div style={{ position: 'absolute', left: BOARD_X + col * (TILE + GAP_X), top: BOARD_Y + row * ROW_H + TILE + 18, width: TILE, opacity: label }}>
                <div style={{ fontSize: 24, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <Slot y={slot(t, a + 2 * F)}>{d.name}</Slot>
                </div>
                <Figures text={d.price} t={t} a={a + 3 * F} style={{ fontSize: 44, fontWeight: 800, letterSpacing: '-0.03em' }} />
              </div>
            ) : null}
          </div>
        )
      })}
    </AbsoluteFill>
  )
}

function Order({ t }: { t: number }) {
  const T = cues.taps
  return (
    <AbsoluteFill style={{ background: K.paper, color: K.ink }}>
      <Phone fx={ORDER_FX}>
        <Img src={staticFile('oyin/freeze.png')} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
        <Footage a={H.order} b={H.pay} />
      </Phone>
      <TapRing t={t} at={T.jollof} fx={ORDER_FX} px={0.26} py={0.49} />
      <TapRing t={t} at={T.add} fx={ORDER_FX} px={0.62} py={0.857} />
      <TapRing t={t} at={T.bag} fx={ORDER_FX} px={0.5} py={0.86} />
      <TapRing t={t} at={T.pay} fx={ORDER_FX} px={0.5} py={0.806} />
      <Words words={spoken('order', (w) => (w === 'Anyone' ? K.coral : undefined))} t={t} style={{ position: 'absolute', left: 860, top: 300, width: 900, fontSize: 120, fontWeight: 800, letterSpacing: '-0.035em', lineHeight: 1.0, rowGap: 6 }} />
      <div style={{ position: 'absolute', left: 864, top: 760, fontFamily: MONO, fontSize: 24, lineHeight: 1.6, color: K.inkDim }}>
        <Slot y={slot(t, H.order + 0.8)}>Opens in any browser.</Slot>
        <br />
        <Slot y={slot(t, H.order + 0.95)}>Party jollof & chicken · $6.50</Slot>
      </div>
    </AbsoluteFill>
  )
}

const PAY_FX = Math.round((1920 - 1311 * k) / 2)

function Pay({ t }: { t: number }) {
  const w = spoken('pay')
  const paid = t >= H.paid ? slam(t, H.paid) : {}
  return (
    <AbsoluteFill style={{ background: K.ink, color: K.paper }}>
      <Words words={w.slice(0, 2)} t={t} style={{ position: 'absolute', left: M, top: 420, width: PAY_FX - M - 80, justifyContent: 'flex-end', fontSize: 110, fontWeight: 800, letterSpacing: '-0.035em' }} />
      <Words words={w.slice(2).map((x, i) => (i === 1 ? { ...x, color: K.coral } : x))} t={t} style={{ position: 'absolute', left: PAY_FX + 1311 * k + 80, top: 420, fontSize: 110, fontWeight: 800, letterSpacing: '-0.035em' }} />
      <Phone fx={PAY_FX} style={{ transformOrigin: '960px 540px', ...paid }}>
        <Footage a={H.pay} b={H.proof} />
      </Phone>
      <div style={{ position: 'absolute', left: M, top: 600, width: PAY_FX - M - 80, textAlign: 'right', fontFamily: MONO, fontSize: 22, color: K.dim }}>
        <Slot y={slot(t, cues.taps.faceid)}>Face ID</Slot>
      </div>
      <div style={{ position: 'absolute', left: PAY_FX + 1311 * k + 80, top: 600, fontFamily: MONO, fontSize: 22, color: K.dim }}>
        <Slot y={slot(t, H.paid)}>Paid, on Monad</Slot>
      </div>
    </AbsoluteFill>
  )
}

function Proof({ t }: { t: number }) {
  const w = spoken('proof')
  const at = (word: string) => w.find((x) => x.text.replace(/[.,]/g, '') === word)?.at ?? 0
  const HORIZON = 800
  const cols = [
    { x: M, label: 'PAID', fig: '$6.50', a: at('$6.50'), under: 'Party jollof & chicken' },
    { x: 720, label: 'ORDER TO PAID', fig: '14 s', a: at('14'), under: '01:15:58 → 01:16:12 UTC' },
    { x: 1260, label: 'FEES', fig: '$0.00', a: at('No'), under: 'Kova paid the gas' },
  ]
  return (
    <AbsoluteFill style={{ background: K.paper, color: K.ink }}>
      <Words words={w} t={t} style={{ position: 'absolute', left: M, top: M, width: 1600, fontSize: 48, fontWeight: 700 }} />
      <div style={{ position: 'absolute', left: M, right: M, top: HORIZON, height: 3, background: K.ink, transformOrigin: '0 0', transform: `scaleX(${decel(span(t, H.proof, H.proof + 0.5))})` }} />
      {cols.map((c, i) => (
        <div key={c.label}>
          <div style={{ position: 'absolute', left: c.x, top: 500, fontFamily: MONO, fontSize: 24, letterSpacing: '0.12em', color: K.inkDim }}>
            <Slot y={slot(t, c.a)}>{c.label}</Slot>
          </div>
          <Figures text={c.fig} t={t} a={c.a + 2 * F} style={{ position: 'absolute', left: c.x - 8, top: 560, fontSize: 180, fontWeight: 800, letterSpacing: '-0.045em' }} />
          {i === 1 ? <div style={{ position: 'absolute', left: c.x, top: HORIZON - 14, height: 6, borderRadius: 3, background: K.coral, width: 380 * decel(span(t, c.a + 6 * F, c.a + 16 * F)) }} /> : null}
          <div style={{ position: 'absolute', left: c.x, top: HORIZON + 26, fontFamily: MONO, fontSize: 22, color: K.inkDim }}>
            <Slot y={slot(t, c.a + 6 * F)}>{c.under}</Slot>
          </div>
        </div>
      ))}
    </AbsoluteFill>
  )
}

const END_FX = Math.round(1920 - M - 1311 * k)
const SMALL_PRINT = 'Oyin Kitchen is a demo shop opened on Kova for this film; the order and the payment are real. Food photos: Wikimedia Commons contributors, CC BY-SA.'

function End({ t }: { t: number }) {
  const w = spoken('end', (x) => (x === 'link.' ? K.coral : undefined))
  const url = w.findIndex((x) => x.text.startsWith('mykova'))
  const urlAt = w[url].at
  const print = decel(span(t, urlAt + 0.4, urlAt + 0.8))
  return (
    <AbsoluteFill style={{ background: K.ink, color: K.paper }}>
      <Words words={w.slice(0, 5)} t={t} style={{ position: 'absolute', left: M - 4, top: 230, width: 1000, fontSize: 132, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1.0 }} />
      <Words words={w.slice(5, url)} t={t} style={{ position: 'absolute', left: M, top: 560, fontSize: 48, fontWeight: 700, color: K.dim }} />
      <div style={{ position: 'absolute', left: M, top: 630 }}>
        <Words words={[w[url]]} t={t} style={{ fontSize: 76, fontWeight: 800, letterSpacing: '-0.02em' }} />
        <div style={{ height: 6, borderRadius: 3, background: K.coral, marginTop: 4, width: `${100 * decel(span(t, urlAt + 4 * F, urlAt + 14 * F))}%` }} />
      </div>
      <div style={{ position: 'absolute', left: M, top: 900, width: END_FX - M - 100, fontSize: 21, lineHeight: 1.4, fontWeight: 500, color: K.paper, opacity: print * 0.55 }}>{SMALL_PRINT}</div>
      <Phone fx={END_FX} style={slam(t, H.end)}>
        <Footage a={H.end} b={cues.duration} />
      </Phone>
    </AbsoluteFill>
  )
}

// --- The film ------------------------------------------------------------------------------------

export function OyinFilm() {
  const frame = useCurrentFrame()
  const t = frame / FPS
  let shot: ReactNode
  let tape = K.dim
  if (t < H.drop) shot = <Hook t={t} />
  else if (t < H.board) {
    const i = cues.dishes.reduce((last, d, j) => (t >= d.at ? j : last), 0)
    const d = cues.dishes[i]
    shot = <Dish t={t} d={d} i={i} />
    tape = d.text === K.ink ? 'rgba(11,26,29,0.5)' : 'rgba(231,229,224,0.6)'
  } else if (t < H.order) shot = <Board t={t} />
  else if (t < H.pay) {
    shot = <Order t={t} />
    tape = 'rgba(11,26,29,0.45)'
  } else if (t < H.proof) shot = <Pay t={t} />
  else if (t < H.end) {
    shot = <Proof t={t} />
    tape = 'rgba(11,26,29,0.45)'
  } else shot = <End t={t} />
  return (
    <AbsoluteFill style={{ fontFamily: 'Manrope', background: K.paper, overflow: 'hidden' }}>
      {shot}
      <Tape t={t} color={tape} />
      <Grain frame={frame} />
    </AbsoluteFill>
  )
}
