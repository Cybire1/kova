import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion'
import vo from '../../public/xstocks2/audio/vo.json'
import { accel, clamp01, decel, easeInOut, hop, mix, span } from '../motion'
import { bezier, type Curve, Grain, Kovi, Logo } from '../parts'
import cues from './cues.json'

/**
 * "xStocks. Live in Kova." v2. 16.0 s, 16:9, 30 fps, 120 bpm (a beat is 15 frames).
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
 *   12.17 board     Asymmetric bento → four-up board (ink)
 *   12.93 end       Centred hero (paper): mark, line, address and small print, all on the resolve
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

// --- The tape: the one real trade, running under every shot -------------------------------------

const TAPE =
  'AUSD 5.00 IN  •  TSLAx 0.01225308626834887 OUT  •  FEE 0.00, GAS PAID BY KOVA  •  TO THE BUYER’S OWN WALLET  •  MONAD MAINNET  •  29 OCT 2026 15:19:41 UTC  •  TX 0xbe51aece5bce96d2d307ee5f471f33991920557a0d5149d53c9347e818af023d  •  '

function Tape({ t }: { t: number }) {
  const out = accel(span(t, at('end'), at('end') + 0.3))
  const x = -((t * 150) % 3200)
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: 1020 + out * 70, height: 60, background: K.ink, overflow: 'hidden', borderTop: `1px solid rgba(231,229,224,0.16)` }}>
      <div style={{ position: 'absolute', top: 15, left: x, whiteSpace: 'pre', fontFamily: MONO, fontSize: 25, letterSpacing: '0.06em', color: K.dim }}>
        {TAPE.repeat(3)}
      </div>
    </div>
  )
}

// --- Shots ---------------------------------------------------------------------------------------

function Hook({ t }: { t: number }) {
  const tesla = cues.hits.morph - 2 / FPS
  const monad = cues.words.hook.Monad - 2 / FPS
  // The one camera move: $5.00 travels down into the receipt row while the stock rolls in.
  const m = decel(span(t, tesla - 3 / FPS, tesla + 9 / FPS))
  const small = 112 / 440
  const five: CSSProperties = {
    position: 'absolute',
    left: mix(122, 838, m),
    top: mix(196, 700, m),
    transformOrigin: '0 0',
    transform: `scale(${mix(1, small, m)})`,
    fontSize: 440,
    fontWeight: 800,
    letterSpacing: '-0.035em',
    color: K.paper,
  }
  return (
    <AbsoluteFill style={{ background: K.ink, color: K.paper }}>
      <Words words={spoken('hook')} t={t} style={{ position: 'absolute', left: 130, top: 92, fontSize: 60, fontWeight: 700, color: K.paper }} />
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
      <Figures text="0.01225" t={t} a={tesla + 4 / FPS} style={{ position: 'absolute', left: 122, top: 196, fontSize: 440, fontWeight: 800, letterSpacing: '-0.035em' }} />
      <div style={{ position: 'absolute', left: 130, top: 700, display: 'flex', alignItems: 'center', gap: 30, height: 132 }}>
        <Img src={staticFile('xstocks2/TSLAx.png')} style={{ width: 112, height: 112, borderRadius: 26, ...slam(t, tesla + 4 / FPS) }} />
        <Words words={[{ text: 'TSLAx', at: tesla + 6 / FPS }]} t={t} style={{ fontSize: 112, fontWeight: 800, color: K.coral, letterSpacing: '-0.02em' }} />
      </div>
      <Words words={[{ text: 'for', at: tesla + 9 / FPS }]} t={t} style={{ position: 'absolute', left: 642, top: 700, fontSize: 112, fontWeight: 800, color: K.dim }} />
      <div style={{ position: 'absolute', left: 130, top: 878, fontFamily: MONO, fontSize: 30, letterSpacing: '0.02em', color: K.dim, lineHeight: 1.5 }}>
        <Slot y={slot(t, monad)}>0.01225308626834887 TSLAx · Monad mainnet · 29 Oct 2026, 15:19:41 UTC</Slot>
      </div>
    </AbsoluteFill>
  )
}

/** The real buy button: capture x 66, y 2116, 1048 × 144, shown at 1.5x so it reads on a phone. */
const BUTTON = { x: 66, y: 2116, w: 1048, h: 144 }
const BS = 1.5
function Tap({ t }: { t: number }) {
  const left = 130
  const top = 660
  const [fallA, fallB] = cues.kovi.fall
  const tapAt = fallB
  const press = t >= tapAt ? Math.sin(clamp01((t - tapAt) / (4 / FPS)) * Math.PI) : 0
  const ring = span(t, tapAt, tapAt + 12 / FPS)
  const icon = { x: left + (1042 - BUTTON.x) * BS, y: top + 72 * BS }
  const kSize = 300
  const r0 = 54 * BS
  const fall = accel(span(t, fallA, fallB))
  const kY = t < fallB ? mix(-300, icon.y - r0 - kSize * 0.44, fall) : icon.y - r0 - kSize * 0.44 + hop(t, fallB, 70) + press * 6
  const words = spoken('tap')
  return (
    <AbsoluteFill style={{ background: K.paper, color: K.ink }}>
      <Words words={words} t={t} style={{ position: 'absolute', left: 124, top: 200, fontSize: 200, fontWeight: 800, letterSpacing: '-0.03em' }} />
      <div
        style={{
          position: 'absolute',
          left,
          top: top + press * 5,
          width: BUTTON.w * BS,
          height: BUTTON.h * BS,
          borderRadius: (BUTTON.h * BS) / 2,
          overflow: 'hidden',
          transformOrigin: '50% 50%',
          ...slam(t, at('tap')),
        }}
      >
        <Img src={staticFile('xstocks/04-review-50.png')} style={{ position: 'absolute', left: -BUTTON.x * BS, top: -BUTTON.y * BS, width: 1179 * BS, height: 2556 * BS }} />
      </div>
      {ring > 0 && ring < 1 ? (
        <div
          style={{
            position: 'absolute',
            left: icon.x - mix(r0, 240, decel(ring)),
            top: icon.y - mix(r0, 240, decel(ring)),
            width: 2 * mix(r0, 240, decel(ring)),
            height: 2 * mix(r0, 240, decel(ring)),
            borderRadius: '50%',
            border: `6px solid ${K.coral}`,
            opacity: 1 - ring,
          }}
        />
      ) : null}
      <Kovi pose={t < fallB ? 'catch' : 'cheer'} size={kSize} x={icon.x} y={kY} />
    </AbsoluteFill>
  )
}

function Fee({ t }: { t: number }) {
  const feeAt = cues.words.fee.fee - 2 / FPS
  const words = spoken('fee').slice(0, 4)
  return (
    <AbsoluteFill style={{ background: K.paper, color: K.ink }}>
      <Words words={words} t={t} style={{ position: 'absolute', left: 124, top: 260, width: 820, fontSize: 168, lineHeight: 1.0, fontWeight: 800, letterSpacing: '-0.03em', rowGap: 6 }} />
      <div style={{ position: 'absolute', left: 1010, top: 0, right: 0, bottom: 0, background: K.ink, color: K.paper }}>
        <div style={{ position: 'absolute', left: 80, top: 250, fontFamily: MONO, fontSize: 30, letterSpacing: '0.12em', color: K.dim }}>
          <Slot y={slot(t, at('fee') + 3 / FPS)}>FEE</Slot>
        </div>
        <Figures text="$0.00" t={t} a={feeAt} style={{ position: 'absolute', left: 70, top: 300, fontSize: 290, fontWeight: 800, letterSpacing: '-0.035em' }} />
        <div style={{ position: 'absolute', left: 80, top: 680, fontFamily: MONO, fontSize: 30, lineHeight: 1.5, color: K.dim }}>
          <Slot y={slot(t, feeAt + 8 / FPS)}>Kova’s relayer paid the gas</Slot>
        </div>
        <div style={{ position: 'absolute', left: 80, top: 640, height: 6, width: 760 * decel(span(t, feeAt + 4 / FPS, feeAt + 14 / FPS)), background: K.coral, borderRadius: 3 }} />
      </div>
    </AbsoluteFill>
  )
}

/** The real "Bought" card, at its own pixels: capture x 60, y 1470, 1060 × 640. */
const BOUGHT = { x: 60, y: 1470, w: 1060, h: 640 }
function Wallet({ t }: { t: number }) {
  const words = spoken('fee').slice(4)
  const [a, b] = cues.kovi.plane
  const card = { left: 800, top: 196 }
  const rise = decel(span(t, at('wallet'), at('wallet') + 0.5))
  const curve: Curve = [
    { x: -260, y: 960 },
    { x: 520, y: 1000 },
    { x: 700, y: 560 },
    { x: 860, y: 214 },
  ]
  const p = easeInOut(span(t, a, b))
  const k = bezier(curve, p)
  const ahead = bezier(curve, Math.min(1, p + 0.02))
  const angle = (Math.atan2(ahead.y - k.y, ahead.x - k.x) * 180) / Math.PI
  // The stock: a TSLAx token Kovi carries, dropped into "You got" when he lands.
  const gotRow = { x: card.left + 730 - BOUGHT.x, y: card.top + 1922 - BOUGHT.y }
  const drop = decel(span(t, b, b + 9 / FPS))
  const token = t < b ? { x: k.x + 70, y: k.y + 40, s: 1 } : { x: mix(k.x + 70, gotRow.x, drop), y: mix(k.y + 40, gotRow.y, drop), s: mix(1, 0.3, drop) }
  const tokenGone = span(t, b + 8 / FPS, b + 11 / FPS)
  return (
    <AbsoluteFill style={{ background: K.paper, color: K.ink, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 40, top: 360, fontSize: 620, fontWeight: 800, letterSpacing: '-0.05em', color: K.ghost, whiteSpace: 'pre' }}>0.01225</div>
      <Words words={words} t={t} style={{ position: 'absolute', left: 124, top: 210, width: 620, fontSize: 138, lineHeight: 1.0, fontWeight: 800, letterSpacing: '-0.03em', rowGap: 4 }} />
      <div style={{ position: 'absolute', left: 130, top: 880, fontFamily: MONO, fontSize: 30, color: 'rgba(11,26,29,0.62)', lineHeight: 1.5 }}>
        <Slot y={slot(t, cues.words.fee.holds - 2 / FPS)}>to the buyer’s own wallet</Slot>
      </div>
      <div style={{ position: 'absolute', left: card.left, top: card.top + (1 - rise) * 44, width: BOUGHT.w, height: BOUGHT.h, overflow: 'hidden', opacity: rise }}>
        <Img src={staticFile('xstocks/06-bought.png')} style={{ position: 'absolute', left: -BOUGHT.x, top: -BOUGHT.y, width: 1179, height: 2556 }} />
      </div>
      {tokenGone < 1 && t > a ? (
        <Img
          src={staticFile('xstocks2/TSLAx.png')}
          style={{ position: 'absolute', left: token.x - 48, top: token.y - 48, width: 96, height: 96, borderRadius: 48, border: `4px solid ${K.ink}`, transform: `scale(${token.s})`, opacity: 1 - tokenGone }}
        />
      ) : null}
      {t > a ? <Kovi pose="ride" size={250} x={k.x} y={k.y + hop(t, b, 40)} rotate={t < b ? angle * 0.35 : 0} /> : null}
    </AbsoluteFill>
  )
}

const FIELD: Record<string, { bg: string; text: string; size: number }> = {
  TSLAx: { bg: '#ef0027', text: K.paper, size: 270 },
  NVDAx: { bg: '#78b808', text: K.ink, size: 270 },
  SPYx: { bg: '#001aff', text: K.paper, size: 236 },
  // The Nasdaq's own tile is blue like the S&P's; its field is Kova's teal so the four hits read apart.
  QQQx: { bg: '#46878b', text: K.paper, size: 196 },
}

function Stock({ t, symbol, from }: { t: number; symbol: string; from: number }) {
  const s = STOCK[symbol]
  const f = FIELD[symbol]
  const priceAt = (cues.price as Record<string, number>)[symbol] - 2 / FPS
  return (
    <AbsoluteFill style={{ background: f.bg, color: f.text }}>
      <Img src={staticFile(`xstocks2/${symbol}.png`)} style={{ position: 'absolute', left: 130, top: 190, width: 440, height: 440, ...slam(t, from) }} />
      <Words words={[{ text: s.name, at: from + 1 / FPS }]} t={t} style={{ position: 'absolute', left: 640, top: 150, fontSize: f.size, fontWeight: 800, letterSpacing: '-0.035em', whiteSpace: 'pre' }} />
      <div style={{ position: 'absolute', left: 650, top: 506, fontFamily: MONO, fontSize: 36, letterSpacing: '0.08em', opacity: 0.8 }}>
        <Slot y={slot(t, from + 3 / FPS)}>{symbol}</Slot>
      </div>
      <Figures text={price(s.price)} t={t} a={priceAt} style={{ position: 'absolute', left: 640, top: 556, fontSize: 168, fontWeight: 800, letterSpacing: '-0.03em' }} />
      <div style={{ position: 'absolute', left: 130, top: 930, fontFamily: MONO, fontSize: 26, opacity: 0.75 }}>xStocks price, {FETCHED}</div>
    </AbsoluteFill>
  )
}

/** A stock's price as its own shot: the figure enormous on the stock's field, the mark small. */
function Price({ t, symbol, from }: { t: number; symbol: string; from: number }) {
  const s = STOCK[symbol]
  const f = FIELD[symbol]
  return (
    <AbsoluteFill style={{ background: f.bg, color: f.text }}>
      <div style={{ position: 'absolute', left: 130, top: 150, display: 'flex', alignItems: 'center', gap: 28 }}>
        <Img src={staticFile(`xstocks2/${symbol}.png`)} style={{ width: 150, height: 150, borderRadius: 30, ...slam(t, from) }} />
        <div style={{ fontFamily: MONO, fontSize: 40, letterSpacing: '0.08em', opacity: 0.85 }}>
          <Slot y={slot(t, from + 1 / FPS)}>{symbol}</Slot>
        </div>
      </div>
      <Figures text={price(s.price)} t={t} a={from} style={{ position: 'absolute', left: 112, top: 360, fontSize: 400, fontWeight: 800, letterSpacing: '-0.04em' }} />
      <div style={{ position: 'absolute', left: 130, top: 930, fontFamily: MONO, fontSize: 26, opacity: 0.75 }}>xStocks price, {FETCHED}</div>
    </AbsoluteFill>
  )
}

function Board({ t }: { t: number }) {
  const order = ['TSLAx', 'NVDAx', 'SPYx', 'QQQx']
  return (
    <AbsoluteFill style={{ background: K.ink }}>
      {order.map((symbol, i) => {
        const s = STOCK[symbol]
        const f = FIELD[symbol]
        const a = at('board') + (i * 2) / FPS
        return (
          <div key={symbol} style={{ position: 'absolute', left: 130 + i * 420, top: 150, width: 400, height: 740, background: f.bg, color: f.text, borderRadius: 28, overflow: 'hidden', ...slam(t, a) }}>
            <Img src={staticFile(`xstocks2/${symbol}.png`)} style={{ position: 'absolute', left: 100, top: 70, width: 200, height: 200 }} />
            <div style={{ position: 'absolute', left: 0, right: 0, top: 330, textAlign: 'center', fontFamily: MONO, fontSize: 34, letterSpacing: '0.06em', opacity: 0.85 }}>{symbol}</div>
            <Figures text={price(s.price)} t={t} a={a + 2 / FPS} style={{ position: 'absolute', left: 0, right: 0, top: 400, justifyContent: 'center', fontSize: 92, fontWeight: 800, letterSpacing: '-0.03em' }} />
          </div>
        )
      })}
      <div style={{ position: 'absolute', left: 130, top: 930, fontFamily: MONO, fontSize: 26, color: K.dim }}>Buyable on Monad today · xStocks prices, {FETCHED}</div>
    </AbsoluteFill>
  )
}

const SMALL_PRINT =
  'xStocks are tokens issued by Backed Finance, not shares. Kova doesn’t issue, sell or recommend them. Not available in the US, UK, EU/EEA, Switzerland, Canada or Australia. Not investment advice.'

function End({ t }: { t: number }) {
  // Everything lands on the resolve: the line word by word (3 f apart), then address and small print together.
  const end = at('end')
  const words = spoken('end').map((w, i) => ({ ...w, at: end + (i * 3) / FPS, color: i === 0 ? K.coral : undefined }))
  const urlAt = end + 8 / FPS
  const print = decel(span(t, urlAt, urlAt + 0.4))
  return (
    <AbsoluteFill style={{ background: K.paper, color: K.ink }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 130, display: 'flex', justifyContent: 'center' }}>
        <div style={slam(t, at('end'))}>
          <Logo h={104} />
        </div>
      </div>
      <Words words={words} t={t} style={{ position: 'absolute', left: 0, right: 0, top: 300, justifyContent: 'center', fontSize: 156, fontWeight: 800, letterSpacing: '-0.035em' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 510, display: 'flex', justifyContent: 'center' }}>
        <div style={{ position: 'relative' }}>
          <Words words={[{ text: 'mykova.app', at: urlAt }]} t={t} style={{ fontSize: 96, fontWeight: 800, letterSpacing: '-0.02em' }} />
          <div style={{ position: 'absolute', left: 0, top: 120, height: 8, borderRadius: 4, background: K.coral, width: `${100 * decel(span(t, urlAt + 4 / FPS, urlAt + 14 / FPS))}%` }} />
          {t > urlAt ? <Kovi pose="cheer" size={180} x={630} y={92 + hop(t, urlAt + 2 / FPS, 50)} style={{ opacity: decel(span(t, urlAt, urlAt + 4 / FPS)) }} /> : null}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 160,
          right: 160,
          top: 730 + (1 - print) * 30,
          opacity: print,
          textAlign: 'center',
          fontSize: 44,
          lineHeight: 1.32,
          fontWeight: 600,
          color: 'rgba(11,26,29,0.74)',
        }}
      >
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

export function XStocks2() {
  const frame = useCurrentFrame()
  const t = frame / FPS
  let shot: ReactNode
  if (frame < cut.tap) shot = <Hook t={t} />
  else if (frame < cut.fee) shot = <Tap t={t} />
  else if (frame < cut.wallet) shot = <Fee t={t} />
  else if (frame < cut.drop) shot = <Wallet t={t} />
  else if (frame < cut.board) {
    const i = MONTAGE.reduce((last, [c], j) => (frame >= cut[c] ? j : last), 0)
    const [c, symbol, kind] = MONTAGE[i]
    shot = kind === 'name' ? <Stock t={t} symbol={symbol} from={at(c)} /> : <Price t={t} symbol={symbol} from={at(c)} />
  } else if (frame < cut.end) shot = <Board t={t} />
  else shot = <End t={t} />
  return (
    <AbsoluteFill style={{ fontFamily: 'Manrope', background: K.paper, overflow: 'hidden' }}>
      {shot}
      <Tape t={t} />
      <Grain frame={frame} />
    </AbsoluteFill>
  )
}
