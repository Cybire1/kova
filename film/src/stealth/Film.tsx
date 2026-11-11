/**
 * "stealth": how private payments work, in 26 seconds, from the library's real runs on public test
 * networks (stealth/live, captured 5 Nov 2026). Every address, hash and note on screen came out of
 * those runs, except the hook's ledger, which shows the problem, and the Monad one-time address in
 * the fan, which the library derived for the film.
 *
 * The claim: share one string, and every payment lands at a new address only you can find and spend.
 *
 * Motion vocabulary, held all film: words sharpen in (hero), objects rise (rise), every exit is an
 * accelerated fade with an 8 px lift. Signature, once: the one string splits into five addresses.
 *
 * Layout ledger
 *   1 hook   0.0  split: words hard left, a public ledger card right
 *   2 split  4.0  centred column: one string fans into five rows
 *   3 found 10.0  split: a terminal left, a sealed note right that opens
 *   4 spend 16.0  baseline list: five chain rows, chips filling
 *   5 end   22.0  centred hero: the name, the chains, the link
 *
 * Audit: enter styles 2 (hero, rise) · every hold ≥1.5 s · bouncy springs 0 · blurred enters only on
 * words · no instant exits · camera moves 0 · one accent (coral) · no archetype twice in a row.
 */
import type { CSSProperties } from 'react'
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion'
import { decel, FPS, hero, mix, presenceStyle, rise, span } from '../motion'
import cues from './cues.json'

export const DURATION = cues.duration

/** Two looks from one film: dark, and a white one for explaining. `paper` is the main text colour. */
const DARK = {
  ground: '#0b1a1d',
  panel: '#11272a',
  line: '#263c3f',
  paper: '#f1efea',
  dim: '#93a3a5',
  coral: '#d46558',
  ink: '#0b1a1d',
  card: '#f1efea',
  cardInk: '#0b1a1d',
  cardFaint: 'rgba(11,26,29,0.42)',
  cardDim: 'rgba(11,26,29,0.55)',
  grain: { opacity: 0.05, blend: 'screen' as 'screen' | 'multiply' },
}
const LIGHT: typeof DARK = {
  ground: '#ffffff',
  panel: '#f4f3f0',
  line: '#e3e1dc',
  paper: '#0b1a1d',
  dim: '#5d6b6d',
  coral: '#d46558',
  ink: '#0b1a1d',
  card: '#0b1a1d',
  cardInk: '#f1efea',
  cardFaint: 'rgba(241,239,234,0.4)',
  cardDim: 'rgba(241,239,234,0.62)',
  grain: { opacity: 0.035, blend: 'multiply' },
}
let K = DARK
const F = 'Manrope'
const M = 'JetBrains Mono'
const logo = (name: string) => staticFile(`stealth/${name}.svg`)
const words = (size: number, color = K.paper): CSSProperties => ({
  fontFamily: F,
  fontWeight: 800,
  fontSize: size,
  letterSpacing: '-0.035em',
  lineHeight: 1.04,
  color,
  margin: 0,
})
const label = (size: number, color = K.dim): CSSProperties => ({
  fontFamily: F,
  fontWeight: 800,
  fontSize: size,
  letterSpacing: '0.16em',
  color,
  margin: 0,
})
const mono = (size: number, color = K.paper): CSSProperties => ({ fontFamily: M, fontWeight: 500, fontSize: size, color, margin: 0 })
const Step = ({ n, text, p, center = false }: { n: string; text: string; p: ReturnType<typeof rise>; center?: boolean }) => (
  <p style={{ ...label(22, K.coral), ...(center ? { textAlign: 'center' as const } : {}), ...presenceStyle(p) }}>
    {n}&nbsp;&nbsp;{text}
  </p>
)
const short = (s: string, a = 12, b = 8) => (s.length > a + b + 1 ? `${s.slice(0, a)}…${s.slice(-b)}` : s)

/** One texture: a fine grain, painted once over everything. */
function Grain() {
  return (
    <svg aria-hidden="true" width="1920" height="1080" style={{ position: 'absolute', inset: 0, opacity: K.grain.opacity, mixBlendMode: K.grain.blend }}>
      <filter id="g">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="1920" height="1080" filter="url(#g)" />
    </svg>
  )
}

// ── 1. The problem: one public address, and everything paid to it ─────────────────────────────────

const LEDGER = [
  ['+$2,400.00', 'Salary', '0x91c2…77ae'],
  ['+$85.00', 'Rent share', '0x4be1…09d3'],
  ['+$600.00', 'A client', '0x0d7a…c512'],
  ['+$1,150.00', 'A sale', '0xa311…5e6f'],
  ['+$40.00', 'A refund', '0x77f0…2b18'],
]

function Hook({ t }: { t: number }) {
  const out = cues.split.at - 0.3
  const card = rise(t, -1, out)
  return (
    <>
      <div style={{ position: 'absolute', left: 140, top: 92, width: 1640 }}>
        <div style={{ marginBottom: 22 }}>
          <Step n="01" text="THE PROBLEM" p={rise(t, -1, out)} />
        </div>
        <p style={{ ...words(96), ...presenceStyle(hero(t, -1, out)) }}>Your address is public.</p>
        <p style={{ ...words(96, K.dim), marginTop: 14, ...presenceStyle(hero(t, 0.7, out)) }}>So is every payment to it.</p>
      </div>
      <div style={{ position: 'absolute', left: 1000, top: 410, width: 780, borderRadius: 32, background: K.panel, border: `2px solid ${K.line}`, padding: '34px 36px 18px', ...presenceStyle(card) }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <span style={{ width: 300, height: 56 }} />
          <span style={{ ...label(18, K.ink), background: K.coral, borderRadius: 20, padding: '8px 16px' }}>PUBLIC</span>
        </div>
        {LEDGER.map(([amount, what, from], i) => {
          const p = rise(t, cues.hook.rows[i] as number, out, 26)
          return (
            <div key={amount} style={{ display: 'flex', alignItems: 'baseline', gap: 20, padding: '18px 0', borderTop: `2px solid ${K.line}`, ...presenceStyle(p) }}>
              <span style={{ ...words(38), width: 240 }}>{amount}</span>
              <span style={{ fontFamily: F, fontWeight: 600, fontSize: 28, color: K.paper, flex: 1, whiteSpace: 'nowrap' }}>{what}</span>
              <span style={{ ...mono(22, K.dim), whiteSpace: 'nowrap' }}>from {from}</span>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ── 2. The move: one string, and a new address for every payment ─────────────────────────────────

const META = 'st:sol:0x3f64dfb54890af1…9610d658f7'
const FAN = [
  ['monad', 'Monad', '0xe7417FC1cdE45C5A4bD7d522820aaE1c2933149C'],
  ['solana', 'Solana', 'BG6zZzzhRDRWMcsWGWmt8KtAaXAv8hFtALcfFrGFddP4'],
  ['stellar', 'Stellar', 'GC2NRFJGEALB735P2TDF5UKIG3DX6J3MS6RLPT5OQ5BCDL7EABUPRIJV'],
  ['sui', 'Sui', '0x1aa749645ee49e15834a79a1b09aefaa841e81647765bf204d4d7ece263cd5c6'],
  ['aptos', 'Aptos', '0xb3e904fa2e477fd52611a9d75d170b21674855c0bb8c172e3c07c790baac29ce'],
]

function Split({ t }: { t: number }) {
  const { at, fan, stagger, line } = cues.split
  const out = cues.found.at - 0.3
  return (
    <>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 96 }}>
        <Step n="02" text="THE IDEA" p={rise(t, at, out)} center />
      </div>
      <p style={{ ...words(78), position: 'absolute', left: 0, right: 0, top: 150, textAlign: 'center', ...presenceStyle(hero(t, at + 0.05, out)) }}>
        Share one string instead.
      </p>
      {FAN.map(([id, name, address], i) => {
        const e = decel(span(t, fan + i * stagger, fan + i * stagger + 0.7))
        const y = mix(318, 420 + i * 96, e)
        const exit = rise(t, -1, out)
        return (
          <div
            key={id}
            style={{
              position: 'absolute',
              left: 360,
              width: 1200,
              top: y,
              height: 80,
              display: 'flex',
              alignItems: 'center',
              gap: 26,
              padding: '0 28px',
              borderRadius: 22,
              background: K.panel,
              border: `2px solid ${K.line}`,
              opacity: e * exit.opacity,
              transform: `translateY(${exit.y}px) scale(${mix(0.86, 1, e)})`,
            }}
          >
            <Img src={logo(id as string)} style={{ width: 52, height: 52, borderRadius: 26 }} />
            <span style={{ fontFamily: F, fontWeight: 700, fontSize: 30, color: K.paper, width: 150 }}>{name}</span>
            <span style={mono(30)}>{short(address as string, 14, 10)}</span>
            <span style={{ ...label(16), marginLeft: 'auto' }}>NEW</span>
          </div>
        )
      })}
      <p style={{ ...words(44, K.dim), position: 'absolute', left: 0, right: 0, top: 930, textAlign: 'center', letterSpacing: '-0.02em', ...presenceStyle(hero(t, line, out)) }}>
        Each payment turns it into a brand-new address.
      </p>
    </>
  )
}

/**
 * The public address leaves the ledger, crosses the frame and becomes the one string you share: the
 * problem turns into the answer without a cut. Drawn from the first frame until the fan leaves.
 */
function Morph({ t }: { t: number }) {
  const { at, fan } = cues.split
  const m = decel(span(t, at, at + 0.8))
  const after = decel(span(t, fan, fan + 0.6))
  const gone = rise(t, -1, cues.found.at - 0.3)
  const left = mix(1036, 540, m)
  const top = mix(438, 300, m)
  const width = mix(300, 840, m)
  const height = mix(56, 76, m)
  const size = mix(30, 36, m)
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width,
        height,
        boxSizing: 'border-box',
        borderRadius: mix(14, 18, m),
        border: `2px solid ${after > 0.5 ? K.line : K.coral}`,
        background: m > 0.02 ? K.panel : 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        ...presenceStyle(gone),
      }}
    >
      <span style={{ ...mono(size), position: 'absolute', whiteSpace: 'nowrap', opacity: 1 - span(m, 0.25, 0.5) }}>0x5f3a…c210</span>
      <span style={{ ...mono(size, after > 0.5 ? K.dim : K.paper), position: 'absolute', whiteSpace: 'nowrap', opacity: span(m, 0.45, 0.75) }}>{META}</span>
    </div>
  )
}

// ── 3. Found: the receiver reads the chain, finds its payment, opens the note ─────────────────────

const LINES: Array<[string, string, boolean]> = [
  ['Solana devnet', '', false],
  ['one-time address', 'BG6zZzzhRDRW…FrGFddP4', false],
  ['paid 0.01 SOL', '2Yav9SamMEY2…aCG5cd', false],
  ['PASS', 'receiver finds it from the memo on chain', true],
  ['PASS', 'receiver opens the sealed note', true],
]
const HEX = ['9f 3a c1 07 5e d2 88 41', 'b3 0c 6a f0 12 9d 44 e7', '2b 50 c8 19 e5 71 0a bb', '36 92 cd 04 7f a8 13 d6', '58 e2 a1 4c 90 3b f7 2e']

function Found({ t }: { t: number }) {
  const { at, lines, open } = cues.found
  const out = cues.spend.at - 0.3
  const opened = decel(span(t, open, open + 0.5))
  return (
    <>
      <div style={{ position: 'absolute', left: 140, top: 82 }}>
        <Step n="03" text="FINDING IT" p={rise(t, at, out)} />
      </div>
      <p style={{ ...words(72), position: 'absolute', left: 140, top: 120, ...presenceStyle(hero(t, at + 0.05, out)) }}>Only you can find it, and read it.</p>
      <p style={{ ...words(40, K.dim), position: 'absolute', left: 140, top: 818, letterSpacing: '-0.02em', ...presenceStyle(hero(t, at + 1.2, out)) }}>
        Each payment leaves a public hint. <span style={{ color: K.paper }}>Only your key matches it.</span>
      </p>
      <div style={{ position: 'absolute', left: 140, top: 270, width: 1010, height: 500, borderRadius: 30, background: K.panel, border: `2px solid ${K.line}`, padding: '28px 36px', boxSizing: 'border-box', ...presenceStyle(rise(t, at + 0.1, out)) }}>
        <p style={{ ...mono(22, K.dim), marginBottom: 26 }}>$ node live/solana.mjs</p>
        {LINES.map(([a, b, pass], i) => {
          const p = rise(t, lines[i] as number, out, 12)
          return (
            <p key={`${a}${b}`} style={{ ...mono(29), lineHeight: '66px', whiteSpace: 'nowrap', ...presenceStyle(p) }}>
              {pass ? (
                <>
                  <span style={{ color: K.ink, background: K.coral, borderRadius: 8, padding: '3px 10px', fontWeight: 500 }}>PASS</span>
                  <span style={{ marginLeft: 18 }}>{b}</span>
                </>
              ) : (
                <>
                  <span style={{ color: i === 0 ? K.paper : K.dim, display: 'inline-block', width: i === 0 ? 'auto' : 330 }}>{a}</span>
                  <span>{b}</span>
                </>
              )}
            </p>
          )
        })}
      </div>
      <div style={{ position: 'absolute', left: 1190, top: 270, width: 590, height: 500, borderRadius: 30, background: K.card, padding: '40px 44px', boxSizing: 'border-box', ...presenceStyle(rise(t, at + 0.25, out)) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke={K.cardInk} strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <rect x="5" y="11" width="14" height="9" rx="2.2" />
            <path d={`M8 11V8a4 4 0 0 1 8 0${opened > 0.5 ? 'V6' : 'v3'}`} transform={`translate(${opened * 0} ${-opened * 3})`} />
          </svg>
          <span style={label(20, K.cardInk)}>{opened > 0.5 ? 'OPENED WITH YOUR KEY' : 'SEALED NOTE'}</span>
        </div>
        <div style={{ position: 'relative', marginTop: 40, height: 380 }}>
          <div style={{ position: 'absolute', inset: 0, opacity: 1 - opened, filter: `blur(${opened * 10}px)` }}>
            {HEX.map((row) => (
              <p key={row} style={{ ...mono(30, K.cardFaint), lineHeight: '58px', whiteSpace: 'nowrap' }}>{row}</p>
            ))}
          </div>
          <div style={{ position: 'absolute', inset: 0, ...presenceStyle(hero(t, open + 0.1, out)) }}>
            <p style={label(20, K.cardDim)}>FROM</p>
            <p style={{ ...words(84, K.cardInk), marginTop: 6 }}>Ada</p>
            <p style={{ ...label(20, K.cardDim), marginTop: 46 }}>NOTE</p>
            <p style={{ fontFamily: F, fontWeight: 700, fontSize: 48, letterSpacing: '-0.02em', color: K.cardInk, margin: '8px 0 0' }}>Rent, live on devnet</p>
          </div>
        </div>
      </div>
    </>
  )
}

// ── 4. Spent: on five networks, with someone else paying the fee ──────────────────────────────────

const SPENT = [
  ['monad', 'Monad', 'testnet', '0x969774c696…b1e4a2'],
  ['solana', 'Solana', 'devnet', '4xAz3iMpLgUi…He34qR'],
  ['stellar', 'Stellar', 'testnet', 'b96e385e36b5…f686a0'],
  ['sui', 'Sui', 'devnet', '6jYYda3DKuNq…gRbZxB'],
  ['aptos', 'Aptos', 'devnet', '0x9c088ce603…f01856'],
]
const STEPS = ['Paid', 'Found', 'Spent']

function Spend({ t }: { t: number }) {
  const { at, rows, stagger, chip, line } = cues.spend
  const out = cues.end.at - 0.3
  return (
    <>
      <div style={{ position: 'absolute', left: 140, top: 82 }}>
        <Step n="04" text="SPENDING IT" p={rise(t, at, out)} />
      </div>
      <p style={{ ...words(72), position: 'absolute', left: 140, top: 120, ...presenceStyle(hero(t, at + 0.05, out)) }}>Spend it. Never fund it.</p>
      {SPENT.map(([id, name, net, hash], i) => {
        const rowAt = rows + i * stagger
        return (
          <div
            key={id}
            style={{ position: 'absolute', left: 140, right: 140, top: 262 + i * 122, height: 106, borderRadius: 26, background: K.panel, border: `2px solid ${K.line}`, display: 'flex', alignItems: 'center', gap: 26, padding: '0 30px', boxSizing: 'border-box', ...presenceStyle(rise(t, rowAt - 0.25, out, 24)) }}
          >
            <Img src={logo(id as string)} style={{ width: 60, height: 60, borderRadius: 30 }} />
            <span style={{ display: 'flex', flexDirection: 'column', width: 220 }}>
              <span style={{ fontFamily: F, fontWeight: 800, fontSize: 34, color: K.paper, letterSpacing: '-0.02em' }}>{name}</span>
              <span style={{ fontFamily: F, fontWeight: 600, fontSize: 22, color: K.dim }}>{net}</span>
            </span>
            <span style={{ display: 'flex', gap: 14 }}>
              {STEPS.map((s, k) => {
                const on = span(t, rowAt + k * chip, rowAt + k * chip + 0.12)
                return (
                  <span
                    key={s}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, height: 52, padding: '0 22px', borderRadius: 26, boxSizing: 'border-box', border: `2px solid ${on > 0.5 ? K.coral : K.line}`, background: on > 0.5 ? K.coral : 'transparent', color: on > 0.5 ? K.ink : K.dim, fontFamily: F, fontWeight: 800, fontSize: 24 }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={on > 0.5 ? K.ink : K.line} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                    {s}
                  </span>
                )
              })}
            </span>
            <span style={{ ...mono(24, K.dim), marginLeft: 'auto' }}>{hash}</span>
          </div>
        )
      })}
      <p style={{ ...words(44, K.dim), position: 'absolute', left: 140, top: 900, letterSpacing: '-0.02em', ...presenceStyle(hero(t, line, out)) }}>
        Someone else pays the fee. <span style={{ color: K.paper }}>The new address never needs gas.</span>
      </p>
    </>
  )
}

// ── 5. The end card ───────────────────────────────────────────────────────────────────────────────

function End({ t }: { t: number }) {
  const at = cues.end.at
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 30 }}>
      <p style={{ ...words(190), letterSpacing: '-0.05em', ...presenceStyle(hero(t, at + 0.05)) }}>stealth</p>
      <p style={{ fontFamily: F, fontWeight: 600, fontSize: 40, color: K.dim, margin: 0, ...presenceStyle(rise(t, at + 0.6)) }}>
        Private payments on EVM, Solana, Sui, Aptos and Stellar.
      </p>
      <div style={{ display: 'flex', gap: 22, marginTop: 6, ...presenceStyle(rise(t, at + 0.9)) }}>
        {['monad', 'solana', 'stellar', 'sui', 'aptos'].map((id) => (
          <Img key={id} src={logo(id)} style={{ width: 64, height: 64, borderRadius: 32 }} />
        ))}
      </div>
      <p style={{ ...mono(38, K.coral), marginTop: 18, ...presenceStyle(rise(t, at + 1.2)) }}>github.com/shaibuafeez/stealth</p>
      <p style={{ fontFamily: F, fontWeight: 600, fontSize: 28, color: K.dim, margin: 0, ...presenceStyle(rise(t, at + 1.5)) }}>Open source. Tested live on five networks.</p>
    </div>
  )
}

export function Film({ light = false }: { light?: boolean }) {
  K = light ? LIGHT : DARK
  const t = useCurrentFrame() / FPS
  return (
    <AbsoluteFill style={{ background: K.ground, overflow: 'hidden' }}>
      {t < cues.split.at && <Hook t={t} />}
      {t >= cues.split.at - 0.05 && t < cues.found.at && <Split t={t} />}
      {t < cues.found.at && <Morph t={t} />}
      {t >= cues.found.at - 0.05 && t < cues.spend.at && <Found t={t} />}
      {t >= cues.spend.at - 0.05 && t < cues.end.at && <Spend t={t} />}
      {t >= cues.end.at - 0.05 && <End t={t} />}
      <Grain />
    </AbsoluteFill>
  )
}
