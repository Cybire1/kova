/**
 * The numbers as a billboard for X (1600 x 900, rendered at 1.5x): four lines of giant lowercase
 * type on Kova coral, each fitted to the same width so the short lines grow (the house caption
 * rule), the two zeros in ink, and Kovi cheering in front of the stack. One colour, one type stack,
 * one character; the small print carries the rest.
 *
 * The lines are measured in the browser once Manrope has loaded, so they fit to the pixel. Every
 * number is a prop from the live API (`/v1/public/stats`); they count wallets, not people.
 */
import { useEffect, useState } from 'react'
import { AbsoluteFill, continueRender, delayRender, Img, staticFile } from 'remotion'
import { Mark } from '../atm/Textures'
import { Grain } from '../parts'
import { C, fontsReady } from '../theme'

const CREAM = '#f8f6f1'
/** Tracking for the stack, in em. */
const TRACK = -0.055
/** The site's coin dot (the full stop in "Tap. Paid. Anywhere."): margin and size, in em. */
const DOT = { margin: 0.05, size: 0.2 }
/** Manrope ExtraBold: ascender and descender, in em (from the font file). */
const ASC = 0.735
const DESC = 0.24

interface Line {
  text: string
  color: string
  /** Whether it has a p, y or g reaching below the baseline. */
  descends: boolean
}
interface Fitted extends Line {
  size: number
  x: number
  baseline: number
}

/** Each line's size and place so its ink runs from `left` to `left + width`, stacked `gap` apart. */
function fit(lines: Line[], left: number, width: number, gap: number): { lines: Fitted[]; height: number } {
  const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D
  ctx.font = '800 100px Manrope'
  let y = 0
  const out = lines.map((line, i) => {
    const m = ctx.measureText(line.text)
    const inkLeft = -m.actualBoundingBoxLeft
    // CSS tracking follows every letter, then the dot's margin and the dot itself.
    const right = m.width + TRACK * 100 * [...line.text].length + (DOT.margin + DOT.size) * 100
    const size = (width / (right - inkLeft)) * 100
    y += (i === 0 ? 0 : gap) + ASC * size
    const fitted = { ...line, size, x: left - (inkLeft / 100) * size, baseline: y }
    y += (line.descends ? DESC : 0.015) * size
    return fitted
  })
  return { lines: out, height: y }
}

function Dot({ fill }: { fill: string }) {
  return (
    <span
      style={{ display: 'inline-block', width: `${DOT.size}em`, height: `${DOT.size}em`, marginLeft: `${DOT.margin}em`, borderRadius: '50%', background: fill, boxShadow: `inset 0 0 0 0.042em ${C.ink}`, verticalAlign: '0.02em' }}
    />
  )
}

export interface BillboardProps {
  payments: number
  wallets: number
  shops: number
  /** Test dollars paid, e.g. "1651.70". */
  volume: string
  asOf: string
}

export function StatsBillboard({ payments = 230, wallets = 108, shops = 18, volume = '1651.70', asOf = '12 Oct 2026' }: Partial<BillboardProps>) {
  const [handle] = useState(() => delayRender('fit the stack'))
  const [stack, setStack] = useState<{ lines: Fitted[]; height: number } | null>(null)

  useEffect(() => {
    fontsReady
      .then(() => document.fonts.load('800 100px Manrope'))
      .then(() => {
        const fitted =
          fit(
            [
              { text: `${payments} payments`, color: CREAM, descends: true },
              { text: `${wallets} wallets`, color: CREAM, descends: false },
              { text: '0 card fees', color: C.ink, descends: false },
              { text: '0 seed phrases', color: C.ink, descends: true },
            ],
            72,
            980,
            14,
          )
        setStack(fitted)
        continueRender(handle)
      })
      .catch((err) => console.error('fit failed', err))
  }, [handle, payments, wallets])

  const dollars = `$${Number(volume).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const top = 134
  // Kovi cheering (kovi-cheer.png, 1024 px): his coin is 535 px tall at (235..789, 166..701).
  const k = 400 / 535
  const kovi = { left: 1236 - 512 * k, top: 414 - 433 * k, size: 1024 * k }

  return (
    <AbsoluteFill style={{ background: C.coral, overflow: 'hidden', fontFamily: 'Manrope', color: C.ink }}>
      <div style={{ position: 'absolute', left: 72, right: 72, top: 54, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Mark h={44} color={C.ink} accent={CREAM} />
      </div>

      {stack?.lines.map((l) => (
        <div
          key={l.text}
          style={{ position: 'absolute', left: l.x, top: top + l.baseline - 0.883 * l.size, fontSize: l.size, lineHeight: 1, fontWeight: 800, letterSpacing: `${TRACK}em`, color: l.color, whiteSpace: 'nowrap' }}
        >
          {l.text}
          <Dot fill={CREAM} />
        </div>
      ))}

      {/* Kova's tap waves, giant and faint, coming off Kovi. */}
      <svg width={1600} height={900} style={{ position: 'absolute', inset: 0 }}>
        {[280, 400, 520].map((r) => {
          const cx = kovi.left + 512 * k - 120
          const cy = kovi.top + 433 * k
          const a = (40 * Math.PI) / 180
          return (
            <path
              key={r}
              d={`M ${cx + r * Math.cos(-a)} ${cy + r * Math.sin(-a)} A ${r} ${r} 0 0 1 ${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`}
              fill="none"
              stroke={CREAM}
              strokeWidth={34}
              strokeLinecap="round"
              opacity={0.13}
            />
          )
        })}
      </svg>
      <Img
        src={staticFile('art/kovi-cheer.png')}
        style={{ position: 'absolute', left: kovi.left, top: kovi.top, width: kovi.size, height: kovi.size, filter: 'drop-shadow(0 22px 34px rgba(11,26,29,0.28))' }}
      />

      <div style={{ position: 'absolute', right: 72, bottom: 58, textAlign: 'right', fontSize: 24, fontWeight: 700, color: CREAM, lineHeight: 1.4 }}>
        {shops} shops · {dollars} in test dollars · about a second each
        <br />
        on monad testnet, {asOf.toLowerCase()} · gas paid by kova
      </div>

      <div style={{ position: 'absolute', left: 72, bottom: 46, display: 'flex', alignItems: 'center', gap: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, background: C.ink, color: CREAM, borderRadius: 999, padding: '9px 9px 9px 28px', fontSize: 27, fontWeight: 800 }}>
          try kova in a minute
          <span style={{ width: 48, height: 48, borderRadius: 24, background: CREAM, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </span>
        </div>
        <span style={{ fontSize: 30, fontWeight: 800 }}>mykova.app/try</span>
      </div>
      <Grain frame={5} />
    </AbsoluteFill>
  )
}
