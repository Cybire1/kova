import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion'
import vo from '../../public/xstocks2/audio/vo.json'
import { accel, clamp01, decel, easeInOut, hop, mix, span } from '../motion'
import { bezier, type Curve, Grain, Kovi, Logo } from '../parts'
import cues from './cues.json'

/**
 * "xStocks. Live in Kova." v4. 17.2 s, 16:9, 30 fps, 120 bpm (a beat is 15 frames).
 * v4 = v3 (the phone ending) set smaller and editorial: 120 px margins on every side, headline type
 * at about 60% of v3, real UI at 0.75x of its capture (never upscaled), the tape a thin mono line.
 *
 * GOVERNING IDEA: the price board. Every figure and every word arrives the way a departures board
 * or a ticker prints it: it rolls up through a slot, one character (numbers) or one word (words) at a
 * time, with a tick under each. Under every shot a ticker tape runs the one real trade, end to end,
 * tx hash included. The film opens on that trade's receipt ($5.00 becomes 0.01225 TSLAx), and the
 * board's signature is the montage: each of the four buyable stocks slams in as a full-bleed field of
 * its own xStocks colour, its price rolling on the half-beat, then all four resolve into one board.
 *
 * Feeling: "five dollars, and it's yours" (small, sure, quick).
 *
 * Facts (all real): Monad mainnet, 29 Oct 2026 15:19:41 UTC, tx 0xbe51aece…818af023d: $5.00 AUSD in,
 * 0.01225308626834887 TSLAx out to the buyer's own wallet, fee $0 (Kova's relayer paid the gas).
 * Prices: the four buyable stocks from api-monad-mainnet /v1/stocks, fetched once (cues.prices).
 * Real UI only as large single-element crops at 1:1: the coral buy button, the "Bought" card.
 *
 * Motion vocabulary (nothing moves any other way):
 *   text enter    Roll: up through a slot, 7 frames decelerated; per character for figures (1 f
 *                 stagger), per word for words (as spoken)
 *   object enter  Slam: scale 1.14 → 1 in 5 frames, decelerated, on a hit
 *   exit          Roll out upward (accelerated, 5 frames); shots change on hard cuts 2 f before a hit
 *   camera        one move: the $5.00 travels into the receipt row as the stock rolls in
 *   Kovi          the one character and the one bouncy thing (falls, taps, flies, cheers)
 *   signature     the full-bleed stock montage, once
 *   texture       grain only
 *
 * Layout ledger (no archetype twice in a row, none more than twice):
 *   0.0   receipt   Extreme scale contrast (ink): $5.00 counts up on the first beat, becomes
 *                   0.01225 TSLAx from 1.25 s, mono proof beneath
 *   2.93  tap       Baseline anchor (paper): the real button (1.5x) on a low horizon, line above
 *   4.43  fee       Split (paper | ink): the line left, $0.00 in an ink panel right
 *   5.93  wallet    Z-axis cascade (paper): ghost figure behind, the Bought card, Kovi in front
 *   7.43  montage   Full-bleed (stock colour fields): logo, name, price; the S&P and the Nasdaq
 *                   cut again to the price alone, enormous, so the montage accelerates
 *   12.17 board     Four-up board (ink), then without a cut:
 *   12.5  phone     Split (ink): the phone rises right with the real Tesla page; on the resolve
 *                   (13.5) the real Bought sheet rises in it; line, address, small print left
 *
 * Audit: enter styles 2 (roll, slam) · every in-shot exit animated · bouncy: Kovi only · camera
 * moves 1 · accent: coral only (stock colours are the stocks' own, montage only) · texture: grain ·
 * depth: the wallet shot · any two beats tell apart: yes (ground changes every shot).
 */

export const FPS = 30
export const DURATION = Math.round(cues.duration * FPS)

const K = { paper: '#e7e5e0', ink: '#0b1a1d', coral: '#d46558', ghost: 'rgba(11,26,29,0.045)', dim: 'rgba(231,229,224,0.6)' }
const MONO = 'Menlo, ui-monospace, monospace'
const cut = cues.cuts
const f2s = (f: number) => f / FPS
const at = (name: keyof typeof cut) => f2s(cut[name])

// --- Words, as spoken -------------------------------------------------------------------------

type Word = { text: string; start: number; end: number }
const lines = Object.fromEntries((vo.lines as { id: string; words: Word[] }[]).map((l) => [l.id, l.words]))
/** Each word's start on the film's clock, 2 frames early so it lands with the voice. */
function spoken(id: 'hook' | 'tap' | 'fee' | 'end'): { text: string; at: number }[] {
  const mine = ((cues.words as Record<string, Record<string, number>>)[id] ?? {}) as Record<string, number>
  return lines[id].map((w) => {
    const bare = w.text.replace(/[.,]/g, '')
    const t = mine[bare] ?? cues.vo[id] + w.start
    return { text: w.text, at: t - 2 / FPS }
  })
}

// --- The board's roll -------------------------------------------------------------------------

const ROLL = 7 / FPS
/** Offset (in % of the slot) for something rolling in at `a` and out at `o`. */
function slot(t: number, a: number, o?: number) {
  let y = (1 - decel(span(t, a, a + ROLL))) * 108
  if (o !== undefined) y -= accel(span(t, o, o + 5 / FPS)) * 108
  return y
}

function Slot({ y, children, style }: { y: number; children: ReactNode; style?: CSSProperties }) {
  return (
    <span style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', lineHeight: 1.18, ...style }}>
      <span style={{ display: 'inline-block', transform: `translateY(${y}%)` }}>{children}</span>
    </span>
  )
}

/** Figures roll per character, 1 frame apart. */
function Figures({ text, t, a, o, style }: { text: string; t: number; a: number; o?: number; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', whiteSpace: 'pre', fontVariantNumeric: 'tabular-nums', ...style }}>
      {[...text].map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: characters of a fixed string
        <Slot key={i} y={slot(t, a + i / FPS, o === undefined ? undefined : o + i / FPS)}>
          {c}
        </Slot>
      ))}
    </div>
  )
}

/** Words roll per word, each at its own time (as spoken). */
function Words({ words, t, o, style, color }: { words: { text: string; at: number; color?: string }[]; t: number; o?: number; style?: CSSProperties; color?: string }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: '0.26em', ...style }}>
      {words.map((w, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: words of a fixed line
        <Slot key={i} y={slot(t, w.at, o)} style={{ color: w.color ?? color }}>
          {w.text}
        </Slot>
      ))}
    </div>
  )
}

/** A digit counting up 0 → `to` (quadratic ease-out), like a ticker spinning to its value. */
function Spin({ t, a, b, to }: { t: number; a: number; b: number; to: number }) {
  const p = clamp01((t - a) / (b - a))
  const v = to * (1 - (1 - p) ** 2)
  return (
    <span style={{ display: 'inline-block', overflow: 'hidden', height: '1.18em', lineHeight: 1.18, verticalAlign: 'top' }}>
      <span style={{ display: 'flex', flexDirection: 'column', transform: `translateY(${(-v * 100) / (to + 1)}%)` }}>
        {Array.from({ length: to + 1 }, (_, d) => (
          <span key={d} style={{ height: '1.18em' }}>
            {d}
          </span>
        ))}
      </span>
    </span>
  )
}

/** Slam: objects land on a hit. */
function slam(t: number, a: number): CSSProperties {
  if (t < a) return { opacity: 0 }
  const e = decel(span(t, a, a + 5 / FPS))
  return { transform: `scale(${1.14 - 0.14 * e})`, opacity: 1 }
}

const price = (p: number) => `$${(Math.round(p * 100 + 1e-6) / 100).toFixed(2)}`
const STOCK = Object.fromEntries(cues.prices.stocks.map((s) => [s.symbol, s]))
const fetched = new Date(cues.prices.fetchedAt)
const FETCHED = `${fetched.getUTCDate()} Oct ${fetched.getUTCFullYear()}, ${String(fetched.getUTCHours()).padStart(2, '0')}:${String(fetched.getUTCMinutes()).padStart(2, '0')} UTC`

// --- The tape: the one real trade, a thin mono line inside the bottom margin of every shot -----------

const TAPE =
  'AUSD 5.00 IN  •  TSLAx 0.01225308626834887 OUT  •  FEE 0.00, GAS PAID BY KOVA  •  TO THE BUYER’S OWN WALLET  •  MONAD MAINNET  •  29 OCT 2026 15:19:41 UTC  •  TX 0xbe51aece5bce96d2d307ee5f471f33991920557a0d5149d53c9347e818af023d  •  '
const M = 120 // the margin, on every side
const ON_INK = 'rgba(231,229,224,0.5)'
const ON_PAPER = 'rgba(11,26,29,0.45)'

/** The tape between x0 and x1 (canvas px), in `color`; it fades in and out at the margins. */
function Tape({ t, color, x0 = M, x1 = 1920 - M }: { t: number; color: string; x0?: number; x1?: number }) {
  const out = accel(span(t, cues.phone.fly[0], cues.phone.fly[0] + 0.3))
  const x = -((t * 110) % 2600)
  const fadeL = x0 === M ? 'transparent' : 'black'
  const fadeR = x1 === 1920 - M ? 'transparent' : 'black'
  const mask = `linear-gradient(90deg, ${fadeL}, black 60px, black calc(100% - 60px), ${fadeR})`
  return (
    <div style={{ position: 'absolute', left: x0, width: x1 - x0, top: 946, height: 26, overflow: 'hidden', opacity: 1 - out, WebkitMaskImage: mask, maskImage: mask }}>
      <div style={{ position: 'absolute', top: 2, left: x - (x0 - M), whiteSpace: 'pre', fontFamily: MONO, fontSize: 18, letterSpacing: '0.08em', color }}>{TAPE.repeat(3)}</div>
    </div>
  )
}

// --- Shots ---------------------------------------------------------------------------------------

function Hook({ t }: { t: number }) {
  const tesla = cues.hits.morph - 2 / FPS
  const monad = cues.words.hook.Monad - 2 / FPS
  // The one camera move: $5.00 travels down into the receipt row while the stock rolls in.
  const m = decel(span(t, tesla - 3 / FPS, tesla + 9 / FPS))
  const BIG = 264
  const ROW = 64
  const five: CSSProperties = {
    position: 'absolute',
    left: mix(116, 548, m),
    top: mix(270, 620, m),
    transformOrigin: '0 0',
    transform: `scale(${mix(1, ROW / BIG, m)})`,
    fontSize: BIG,
    fontWeight: 800,
    letterSpacing: '-0.035em',
    color: K.paper,
  }
  return (
    <AbsoluteFill style={{ background: K.ink, color: K.paper }}>
      <Words words={spoken('hook')} t={t} style={{ position: 'absolute', left: M, top: M, fontSize: 36, fontWeight: 700, color: K.paper }} />
      <div style={five}>
        <div style={{ display: 'flex', whiteSpace: 'pre', fontVariantNumeric: 'tabular-nums' }}>
          <Slot y={slot(t, -9 / FPS)}>$</Slot>
          <Spin t={t} a={cues.spin[0]} b={cues.spin[1]} to={5} />
          {['.', '0', '0'].map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: characters of a fixed string
            <Slot key={i} y={slot(t, (-7 + i) / FPS)}>
              {c}
            </Slot>
          ))}
        </div>
      </div>
      <Figures text="0.01225" t={t} a={tesla + 4 / FPS} style={{ position: 'absolute', left: 116, top: 270, fontSize: BIG, fontWeight: 800, letterSpacing: '-0.035em' }} />
      <div style={{ position: 'absolute', left: M, top: 620, display: 'flex', alignItems: 'center', gap: 18, height: 76 }}>
        <Img src={staticFile('xstocks2/TSLAx.png')} style={{ width: ROW, height: ROW, borderRadius: 15, ...slam(t, tesla + 4 / FPS) }} />
        <Words words={[{ text: 'TSLAx', at: tesla + 6 / FPS }]} t={t} style={{ fontSize: ROW, fontWeight: 800, color: K.coral, letterSpacing: '-0.02em' }} />
      </div>
      <Words words={[{ text: 'for', at: tesla + 9 / FPS }]} t={t} style={{ position: 'absolute', left: 430, top: 620, fontSize: ROW, fontWeight: 800, color: K.dim }} />
      <div style={{ position: 'absolute', left: M, top: 740, fontFamily: MONO, fontSize: 22, letterSpacing: '0.02em', color: K.dim, lineHeight: 1.5 }}>
        <Slot y={slot(t, monad)}>0.01225308626834887 TSLAx · Monad mainnet · 29 Oct 2026, 15:19:41 UTC</Slot>
      </div>
    </AbsoluteFill>
  )
}

/** The real buy button: capture x 66, y 2116, 1048 × 144, shown at 0.75x (prefiltered to 786 × 108). */
const BUTTON = { x: 66, w: 786, h: 108, s: 0.75 }
function Tap({ t }: { t: number }) {
  const left = M
  const top = 560
  const [fallA, fallB] = cues.kovi.fall
  const tapAt = fallB
  const press = t >= tapAt ? Math.sin(clamp01((t - tapAt) / (4 / FPS)) * Math.PI) : 0
  const ring = span(t, tapAt, tapAt + 12 / FPS)
  const icon = { x: left + (1042 - BUTTON.x) * BUTTON.s, y: top + BUTTON.h / 2 }
  const kSize = 180
  const r0 = 40
  const fall = accel(span(t, fallA, fallB))
  const rest = icon.y - r0 - kSize * 0.44
  const kY = t < fallB ? mix(-200, rest, fall) : rest + hop(t, fallB, 44) + press * 4
  const R = mix(r0, 150, decel(ring))
  return (
    <AbsoluteFill style={{ background: K.paper, color: K.ink }}>
      <Words words={spoken('tap')} t={t} style={{ position: 'absolute', left: 116, top: 250, fontSize: 120, fontWeight: 800, letterSpacing: '-0.03em' }} />
      <Img
        src={staticFile('xstocks4/button.png')}
        style={{ position: 'absolute', left, top: top + press * 3, width: BUTTON.w, height: BUTTON.h, borderRadius: BUTTON.h / 2, transformOrigin: '50% 50%', ...slam(t, at('tap')) }}
      />
      {ring > 0 && ring < 1 ? (
        <div style={{ position: 'absolute', left: icon.x - R, top: icon.y - R, width: 2 * R, height: 2 * R, borderRadius: '50%', border: `4px solid ${K.coral}`, opacity: 1 - ring }} />
      ) : null}
      <Kovi pose={t < fallB ? 'catch' : 'cheer'} size={kSize} x={icon.x} y={kY} />
    </AbsoluteFill>
  )
}

const SPLIT = 1060
function Fee({ t }: { t: number }) {
  const feeAt = cues.words.fee.fee - 2 / FPS
  const words = spoken('fee').slice(0, 4)
  return (
    <AbsoluteFill style={{ background: K.paper, color: K.ink }}>
      <Words words={words} t={t} style={{ position: 'absolute', left: M, top: 330, width: 560, fontSize: 100, lineHeight: 1.04, fontWeight: 800, letterSpacing: '-0.03em', rowGap: 4 }} />
      <div style={{ position: 'absolute', left: SPLIT, top: 0, right: 0, bottom: 0, background: K.ink, color: K.paper }}>
        <div style={{ position: 'absolute', left: M, top: 318, fontFamily: MONO, fontSize: 22, letterSpacing: '0.12em', color: K.dim }}>
          <Slot y={slot(t, at('fee') + 3 / FPS)}>FEE</Slot>
        </div>
        <Figures text="$0.00" t={t} a={feeAt} style={{ position: 'absolute', left: M - 6, top: 350, fontSize: 174, fontWeight: 800, letterSpacing: '-0.035em' }} />
        <div style={{ position: 'absolute', left: M, top: 582, height: 4, width: 456 * decel(span(t, feeAt + 4 / FPS, feeAt + 14 / FPS)), background: K.coral, borderRadius: 2 }} />
        <div style={{ position: 'absolute', left: M, top: 604, fontFamily: MONO, fontSize: 22, lineHeight: 1.5, color: K.dim }}>
          <Slot y={slot(t, feeAt + 8 / FPS)}>Kova’s relayer paid the gas</Slot>
        </div>
      </div>
    </AbsoluteFill>
  )
}

/** The real "Bought" card: capture x 60, y 1470, 1060 × 640, shown at 0.75x (prefiltered to 795 × 480). */
const BOUGHT = { x: 60, y: 1470, w: 795, h: 480, s: 0.75 }
function Wallet({ t }: { t: number }) {
  const words = spoken('fee').slice(4)
  const [a, b] = cues.kovi.plane
  const card = { left: 1920 - M - BOUGHT.w, top: 300 }
  const rise = decel(span(t, at('wallet'), at('wallet') + 0.5))
  const curve: Curve = [
    { x: -200, y: 900 },
    { x: 420, y: 940 },
    { x: 700, y: 560 },
    { x: card.left + 20, y: card.top + 10 },
  ]
  const p = easeInOut(span(t, a, b))
  const k = bezier(curve, p)
  const ahead = bezier(curve, Math.min(1, p + 0.02))
  const angle = (Math.atan2(ahead.y - k.y, ahead.x - k.x) * 180) / Math.PI
  // The stock: a TSLAx token Kovi carries, dropped into "You got" when he lands.
  const gotRow = { x: card.left + (730 - BOUGHT.x) * BOUGHT.s, y: card.top + (1922 - BOUGHT.y) * BOUGHT.s }
  const drop = decel(span(t, b, b + 9 / FPS))
  const token = t < b ? { x: k.x + 45, y: k.y + 26, s: 1 } : { x: mix(k.x + 45, gotRow.x, drop), y: mix(k.y + 26, gotRow.y, drop), s: mix(1, 0.35, drop) }
  const tokenGone = span(t, b + 8 / FPS, b + 11 / FPS)
  return (
    <AbsoluteFill style={{ background: K.paper, color: K.ink, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 90, top: 560, fontSize: 380, fontWeight: 800, letterSpacing: '-0.05em', color: K.ghost, whiteSpace: 'pre' }}>0.01225</div>
      <Words words={words} t={t} style={{ position: 'absolute', left: 116, top: 300, width: 560, fontSize: 84, lineHeight: 1.04, fontWeight: 800, letterSpacing: '-0.03em', rowGap: 2 }} />
      <div style={{ position: 'absolute', left: M, top: 640, fontFamily: MONO, fontSize: 22, color: 'rgba(11,26,29,0.62)', lineHeight: 1.5 }}>
        <Slot y={slot(t, cues.words.fee.holds - 2 / FPS)}>to the buyer’s own wallet</Slot>
      </div>
      <Img src={staticFile('xstocks4/bought-card.png')} style={{ position: 'absolute', left: card.left, top: card.top + (1 - rise) * 30, width: BOUGHT.w, height: BOUGHT.h, opacity: rise }} />
      {tokenGone < 1 && t > a ? (
        <Img
          src={staticFile('xstocks2/TSLAx.png')}
          style={{ position: 'absolute', left: token.x - 32, top: token.y - 32, width: 64, height: 64, borderRadius: 32, border: `3px solid ${K.ink}`, transform: `scale(${token.s})`, opacity: 1 - tokenGone }}
        />
      ) : null}
      {t > a ? <Kovi pose="ride" size={160} x={k.x} y={k.y + hop(t, b, 28)} rotate={t < b ? angle * 0.35 : 0} /> : null}
    </AbsoluteFill>
  )
}

const FIELD: Record<string, { bg: string; text: string; size: number }> = {
  TSLAx: { bg: '#ef0027', text: K.paper, size: 162 },
  NVDAx: { bg: '#78b808', text: K.ink, size: 162 },
  SPYx: { bg: '#001aff', text: K.paper, size: 142 },
  // The Nasdaq's own tile is blue like the S&P's; its field is Kova's teal so the four hits read apart.
  QQQx: { bg: '#46878b', text: K.paper, size: 118 },
}

function Stock({ t, symbol, from }: { t: number; symbol: string; from: number }) {
  const s = STOCK[symbol]
  const f = FIELD[symbol]
  const priceAt = (cues.price as Record<string, number>)[symbol] - 2 / FPS
  return (
    <AbsoluteFill style={{ background: f.bg, color: f.text }}>
      <Img src={staticFile(`xstocks2/${symbol}.png`)} style={{ position: 'absolute', left: M, top: 340, width: 264, height: 264, borderRadius: 4, ...slam(t, from) }} />
      <Words words={[{ text: s.name, at: from + 1 / FPS }]} t={t} style={{ position: 'absolute', left: 444, top: 328, fontSize: f.size, fontWeight: 800, letterSpacing: '-0.035em', whiteSpace: 'pre' }} />
      <div style={{ position: 'absolute', left: 448, top: 528, fontFamily: MONO, fontSize: 24, letterSpacing: '0.08em', opacity: 0.8 }}>
        <Slot y={slot(t, from + 3 / FPS)}>{symbol}</Slot>
      </div>
      <Figures text={price(s.price)} t={t} a={priceAt} style={{ position: 'absolute', left: 442, top: 562, fontSize: 100, fontWeight: 800, letterSpacing: '-0.03em' }} />
      <div style={{ position: 'absolute', left: M, top: 900, fontFamily: MONO, fontSize: 18, opacity: 0.7 }}>xStocks price, {FETCHED}</div>
    </AbsoluteFill>
  )
}

/** A stock's price as its own shot: the figure large on the stock's field, the mark small. */
function Price({ t, symbol, from }: { t: number; symbol: string; from: number }) {
  const s = STOCK[symbol]
  const f = FIELD[symbol]
  return (
    <AbsoluteFill style={{ background: f.bg, color: f.text }}>
      <div style={{ position: 'absolute', left: M, top: 200, display: 'flex', alignItems: 'center', gap: 20 }}>
        <Img src={staticFile(`xstocks2/${symbol}.png`)} style={{ width: 90, height: 90, borderRadius: 18, ...slam(t, from) }} />
        <div style={{ fontFamily: MONO, fontSize: 26, letterSpacing: '0.08em', opacity: 0.85 }}>
          <Slot y={slot(t, from + 1 / FPS)}>{symbol}</Slot>
        </div>
      </div>
      <Figures text={price(s.price)} t={t} a={from} style={{ position: 'absolute', left: 112, top: 400, fontSize: 240, fontWeight: 800, letterSpacing: '-0.04em' }} />
      <div style={{ position: 'absolute', left: M, top: 900, fontFamily: MONO, fontSize: 18, opacity: 0.7 }}>xStocks price, {FETCHED}</div>
    </AbsoluteFill>
  )
}

const SMALL_PRINT =
  'xStocks are tokens issued by Backed Finance, not shares. Kova doesn’t issue, sell or recommend them. Not available in the US, UK, EU/EEA, Switzerland, Canada or Australia. Not investment advice.'

/**
 * The finale, one continuous move (no cut): the four tiles slam in as a board; then the Tesla tile
 * flies into the Tesla logo of a phone rising from below, the other three roll out upward, and the
 * phone holds Kova's real Tesla page (price at the 17:54 UTC fetch) for 0.8 s. On the resolve the
 * real "Bought" sheet rises in it, the line, the address and the small print land on the left, and
 * the camera pushes gently in on the receipt so its rows read on a phone.
 *
 * The screens are Kova's own web wallet (StockDetail and TradeSheet from apps/web), rendered at
 * 393 x 852 @3x from the app's code with a throwaway harness: a mocked wallet (Ada, a throwaway key)
 * and a mocked /api returning the 17:54 quote, the 1W chart up to that minute (its change label
 * hidden: no performance figures) and the real trade's 0.01225308626834887 TSLAx. At rest each capture
 * is prefiltered (Lanczos) to its exact size on screen, 338 x 733, on whole pixels; during the push a
 * 2x copy (676 x 1466) is drawn so it never upscales.
 */
const PHONE = { k: 760 / 2708, screen: { x: 1447, y: 172, w: 338, h: 735 } }
const CAP_TO_SCREEN = PHONE.screen.w / 1179
/** The Tesla logo on the stock page: capture x 206-330, y 327-451 (44 pt at 3x). */
const LOGO = { x: PHONE.screen.x + 206 * CAP_TO_SCREEN, y: PHONE.screen.y + 327 * CAP_TO_SCREEN, s: 124 * CAP_TO_SCREEN }
/** Where the Bought sheet's top edge sits in the capture. */
const SHEET_PX = Math.round(1060 * CAP_TO_SCREEN)
/** The push: the receipt card's centre (capture 589, 2020) moves to (1450, 560) while the phone scales 1 → 1.8. */
const ANCHOR = { x: PHONE.screen.x + Math.round(589 * CAP_TO_SCREEN), y: PHONE.screen.y + Math.round(2020 * CAP_TO_SCREEN) }
const PUSH = { x: 1450, y: 560, z: 1.8 }

function Finale({ t }: { t: number }) {
  const order = ['TSLAx', 'NVDAx', 'SPYx', 'QQQx']
  const [riseA, riseB] = cues.phone.rise
  const [flyA, flyB] = cues.phone.fly
  const [sheetA, sheetB] = cues.phone.sheet
  const [zoomA, zoomB] = cues.phone.zoom
  const end = cues.hits.end - 2 / FPS
  const rise = decel(span(t, riseA, riseB))
  const dy = Math.round((1 - rise) * 900)
  const fly = easeInOut(span(t, flyA, flyB))
  const sheet = decel(span(t, sheetA, sheetB))
  const dim = span(t, sheetA, sheetA + 6 / FPS)
  const zp = easeInOut(span(t, zoomA, zoomB))
  const z = mix(1, PUSH.z, zp)
  const zoomed = zp > 0
  const words = [
    [{ text: 'xStocks.', at: end, color: K.coral }],
    [
      { text: 'Live', at: end + 3 / FPS },
      { text: 'in', at: end + 5 / FPS },
      { text: 'Kova.', at: end + 7 / FPS },
    ],
  ]
  const urlAt = end + 10 / FPS
  const print = decel(span(t, urlAt, urlAt + 0.4))
  const sc = PHONE.screen
  const IMG_H = 733
  const frameStyle: CSSProperties = {
    position: 'absolute',
    left: sc.x - 54 * PHONE.k,
    top: sc.y - 44 * PHONE.k + dy,
    width: 1311 * PHONE.k,
    height: 2708 * PHONE.k,
  }
  const screen = (name: 'stock' | 'bought') => staticFile(`xstocks4/${name}-${zoomed ? 676 : 338}.png`)
  const TW = 300
  const TH = 520
  return (
    <AbsoluteFill style={{ background: K.ink }}>
      {order.map((symbol, i) => {
        const s = STOCK[symbol]
        const f = FIELD[symbol]
        const a = at('board') + (i * 2) / FPS
        const box = { left: 300 + i * (TW + 40), top: 210, w: TW, h: TH, r: 22 }
        let style: CSSProperties = { ...slam(t, a) }
        let content = 1
        if (symbol === 'TSLAx') {
          // Into the phone: the tile becomes the page's own Tesla logo.
          box.left = mix(box.left, LOGO.x, fly)
          box.top = mix(box.top, LOGO.y + dy, fly)
          box.w = mix(box.w, LOGO.s, fly)
          box.h = mix(box.h, LOGO.s, fly)
          box.r = mix(22, LOGO.s * 0.22, fly)
          content = 1 - span(t, flyA, flyA + 4 / FPS)
          if (t >= flyB) style = { opacity: 1 - span(t, flyB, flyB + 3 / FPS) }
        } else {
          // Out of the way: roll out upward, 2 frames apart.
          const o = accel(span(t, flyA + (i * 2) / FPS, flyA + (i * 2 + 9) / FPS))
          box.top -= o * 900
          if (t > flyA) style = { opacity: 1 - o * 0.5 }
        }
        return (
          <div
            key={symbol}
            style={{ position: 'absolute', left: box.left, top: box.top, width: box.w, height: box.h, background: f.bg, color: f.text, borderRadius: box.r, overflow: 'hidden', zIndex: symbol === 'TSLAx' ? 3 : 1, ...style }}
          >
            {symbol === 'TSLAx' && content < 1 ? (
              <Img src={staticFile('xstocks2/TSLAx.png')} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 1 - content }} />
            ) : null}
            <div style={{ opacity: content }}>
              <Img src={staticFile(`xstocks2/${symbol}.png`)} style={{ position: 'absolute', left: (TW - 140) / 2, top: 60, width: 140, height: 140 }} />
              <div style={{ position: 'absolute', left: 0, width: TW, top: 236, textAlign: 'center', fontFamily: MONO, fontSize: 22, letterSpacing: '0.06em', opacity: 0.85 }}>{symbol}</div>
              <Figures text={price(s.price)} t={t} a={a + 2 / FPS} style={{ position: 'absolute', left: 0, width: TW, top: 286, justifyContent: 'center', fontSize: 62, fontWeight: 800, letterSpacing: '-0.03em' }} />
            </div>
          </div>
        )
      })}
      <div style={{ position: 'absolute', left: 300, top: 790, fontFamily: MONO, fontSize: 18, color: K.dim, opacity: 1 - span(t, flyA, flyA + 6 / FPS) }}>
        Buyable on Monad today · xStocks prices, {FETCHED}
      </div>

      {t >= riseA ? (
        <AbsoluteFill
          style={{
            zIndex: 2,
            transformOrigin: `${ANCHOR.x}px ${ANCHOR.y}px`,
            transform: zoomed ? `translate(${(PUSH.x - ANCHOR.x) * zp}px, ${(PUSH.y - ANCHOR.y) * zp}px) scale(${z})` : undefined,
          }}
        >
          <div style={frameStyle}>
            <div style={{ position: 'absolute', left: 38 * PHONE.k, right: 38 * PHONE.k, top: 20 * PHONE.k, bottom: 20 * PHONE.k, borderRadius: 205 * PHONE.k, background: K.ink, boxShadow: '0 24px 60px rgba(0,0,0,0.45)' }} />
          </div>
          <div style={{ position: 'absolute', left: sc.x, top: sc.y + dy, width: sc.w, height: sc.h, borderRadius: 176 * PHONE.k, overflow: 'hidden', background: K.paper }}>
            <Img src={screen('stock')} style={{ position: 'absolute', left: 0, top: 1, width: sc.w, height: IMG_H }} />
            {t >= sheetA && t < sheetB ? (
              <>
                {/* The app's own sheet rise: the page dims (its backdrop, measured from the capture), the sheet slides up. */}
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0, 9, 14, 0.30)', opacity: dim }} />
                <div style={{ position: 'absolute', left: 0, top: 1 + SHEET_PX + Math.round((1 - sheet) * 480), width: sc.w, height: IMG_H - SHEET_PX, overflow: 'hidden' }}>
                  <Img src={screen('bought')} style={{ position: 'absolute', left: 0, top: -SHEET_PX, width: sc.w, height: IMG_H }} />
                </div>
              </>
            ) : null}
            {t >= sheetB ? <Img src={screen('bought')} style={{ position: 'absolute', left: 0, top: 1, width: sc.w, height: IMG_H }} /> : null}
          </div>
          <Img src={staticFile('ios-live-v2/device-frame.png')} style={frameStyle} />
        </AbsoluteFill>
      ) : null}

      <div style={{ position: 'absolute', left: 116, top: 250, color: K.paper, zIndex: 4 }}>
        {words.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: two fixed lines
          <Words key={i} words={line} t={t} style={{ fontSize: 80, fontWeight: 800, letterSpacing: '-0.035em', lineHeight: 1.04 }} />
        ))}
      </div>
      <div style={{ position: 'absolute', left: M, top: 460, zIndex: 4 }}>
        <Words words={[{ text: 'mykova.app', at: urlAt }]} t={t} style={{ fontSize: 56, fontWeight: 800, letterSpacing: '-0.02em', color: K.paper }} />
        <div style={{ height: 5, borderRadius: 3, background: K.coral, marginTop: 4, width: `${100 * decel(span(t, urlAt + 4 / FPS, urlAt + 14 / FPS))}%` }} />
      </div>
      <div style={{ position: 'absolute', left: M, top: 580 + (1 - print) * 24, width: 940, opacity: print, fontSize: 44, lineHeight: 1.3, fontWeight: 500, color: 'rgba(231,229,224,0.72)', zIndex: 4 }}>
        {SMALL_PRINT}
      </div>
    </AbsoluteFill>
  )
}

// --- The film ------------------------------------------------------------------------------------

/** The montage: Tesla and Nvidia in one shot each; the S&P and the Nasdaq (longer names) cut again
 *  to their price, so the shots shorten into the board: 0.73, 0.77, 0.77, 0.73, 0.63, 0.6 s. */
const MONTAGE: [keyof typeof cut, string, 'name' | 'price'][] = [
  ['drop', 'TSLAx', 'name'],
  ['nvda', 'NVDAx', 'name'],
  ['spy', 'SPYx', 'name'],
  ['spyPrice', 'SPYx', 'price'],
  ['qqq', 'QQQx', 'name'],
  ['qqqPrice', 'QQQx', 'price'],
]

export function XStocks4() {
  const frame = useCurrentFrame()
  const t = frame / FPS
  let shot: ReactNode
  let tape: ReactNode = <Tape t={t} color={ON_INK} />
  if (frame < cut.tap) shot = <Hook t={t} />
  else if (frame < cut.fee) {
    shot = <Tap t={t} />
    tape = <Tape t={t} color={ON_PAPER} />
  } else if (frame < cut.wallet) {
    shot = <Fee t={t} />
    tape = (
      <>
        <Tape t={t} color={ON_PAPER} x1={SPLIT} />
        <Tape t={t} color={ON_INK} x0={SPLIT} />
      </>
    )
  } else if (frame < cut.drop) {
    shot = <Wallet t={t} />
    tape = <Tape t={t} color={ON_PAPER} />
  } else if (frame < cut.board) {
    const i = MONTAGE.reduce((last, [c], j) => (frame >= cut[c] ? j : last), 0)
    const [c, symbol, kind] = MONTAGE[i]
    shot = kind === 'name' ? <Stock t={t} symbol={symbol} from={at(c)} /> : <Price t={t} symbol={symbol} from={at(c)} />
    tape = <Tape t={t} color={FIELD[symbol].text === K.ink ? ON_PAPER : 'rgba(231,229,224,0.6)'} />
  } else shot = <Finale t={t} />
  return (
    <AbsoluteFill style={{ fontFamily: 'Manrope', background: K.paper, overflow: 'hidden' }}>
      {shot}
      {tape}
      <Grain frame={frame} />
    </AbsoluteFill>
  )
}
