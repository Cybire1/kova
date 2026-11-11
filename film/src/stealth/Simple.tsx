/**
 * "What is a stealth address?": the plain version, 47 seconds. No names, no maths: you, Address A,
 * and the new addresses B, C and D that payments land at.
 *
 *   One address (A): every payment and the balance are public.
 *   A code instead: each payer's wallet turns it into a brand-new address (B, C, D).
 *   Outsiders see three strangers. Each payment leaves a clue only your key recognises,
 *   so your wallet finds them and shows one balance, and only your key can spend them.
 */
import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion'
import { decel, FPS, hero, mix, presenceStyle, rise, span } from '../motion'
import { Coin, Eye, Person, Pop, pop, Rise, Tick, txt } from './Explainer'
import E from './simple.json'

export const SIMPLE_DURATION = E.duration

const INK = '#0b1a1d'
const DIM = '#5d6b6d'
const LINE = '#e3e1dc'
const PANEL = '#f4f3f0'
const YOU = '#46878B'
const GREY = '#CFCBC3'
const RED = '#D46558'
const PAYERS = ['#7C8BD6', '#E0B44C', '#E58FB0']
const GROUND = 720
const F = 'Manrope'
const M = 'JetBrains Mono'
const S = E.scenes
const P = E.pay

function Card({ x, y, w, h, title, address, ring = INK, children }: { x: number; y: number; w: number; h: number; title: string; address: string; ring?: string; children?: ReactNode }) {
  return (
    <g transform={`translate(${x - w / 2} ${y - h / 2})`}>
      <rect width={w} height={h} rx={26} fill="#ffffff" stroke={ring} strokeWidth={ring === INK ? 4 : 6} />
      <text x={26} y={48} style={txt(30, 800)}>
        {title}
      </text>
      <text x={26} y={80} style={txt(20, 500, DIM, M)}>
        {address}
      </text>
      <line x1={26} y1={100} x2={w - 26} y2={100} stroke={LINE} strokeWidth={3} />
      {children}
    </g>
  )
}

function Padlock({ x, y, open = 0 }: { x: number; y: number; open?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={24} fill={open > 0.5 ? YOU : '#ffffff'} stroke={INK} strokeWidth={3} />
      <path d="M-7 -2 V-8 a7 7 0 0 1 14 0 V-2" stroke={open > 0.5 ? '#ffffff' : INK} strokeWidth={3.4} fill="none" transform={`translate(0 ${-open * 5}) rotate(${-open * 25} 7 -2)`} />
      <rect x={-10} y={-3} width={20} height={15} rx={3} fill={open > 0.5 ? '#ffffff' : INK} />
    </g>
  )
}

function Question({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <circle r={24} fill="#ffffff" stroke={INK} strokeWidth={3} />
      <text y={11} textAnchor="middle" style={txt(32, 800, RED)}>
        ?
      </text>
    </g>
  )
}

// ── 1. Address A: one address, and everything on it is public ───────────────────────────────────

const PAID = [
  ['+$2,400', 'salary'],
  ['+$85', 'rent share'],
  ['+$600', 'from a friend'],
]

function AddressA({ t }: { t: number }) {
  const out = S.code - 0.3
  const { coins, onlookers } = E.a
  const cx = 900
  return (
    <Rise t={t} at={-1} out={out}>
      <Person x={470} color={YOU} name="You" look={0.8} />
      <Card x={cx} y={455} w={440} h={330} title="Address A" address="0x5f3a…c210">
        {PAID.map(([amount, what], i) => (
          <g key={amount} opacity={span(t, (coins[i] as number) + 0.55, (coins[i] as number) + 0.7)}>
            <text x={26} y={146 + i * 44} style={txt(30, 800)}>
              {amount}
            </text>
            <text x={170} y={146 + i * 44} style={txt(24, 600, DIM)}>
              {what}
            </text>
          </g>
        ))}
        <g opacity={span(t, (coins[2] as number) + 0.9, (coins[2] as number) + 1.1)}>
          <line x1={26} y1={270} x2={414} y2={270} stroke={LINE} strokeWidth={3} />
          <text x={26} y={308} style={txt(26, 700, DIM)}>
            Balance
          </text>
          <text x={414} y={308} textAnchor="end" style={txt(30, 800)}>
            $3,085
          </text>
        </g>
      </Card>
      {coins.map((c) => {
        const e = decel(span(t, c, c + 0.6))
        return e > 0 && e < 1 ? <Coin key={c} x={mix(2000, cx + 160, e)} y={mix(360, 330, e) - Math.sin(Math.PI * e) * 120} /> : null
      })}
      {[1420, 1640].map((x, i) => {
        const at = onlookers + i * 0.3
        const look = pop(t, at + 0.6, out)
        return (
          <g key={x}>
            <Rise t={t} at={at} out={out}>
              <Person x={x} color={GREY} look={-0.9} />
            </Rise>
            {look.o > 0 ? (
              <g opacity={look.o}>
                <line x1={x - 50} y1={GROUND - 320} x2={cx + 230} y2={400} stroke={DIM} strokeWidth={3} strokeDasharray="8 12" />
                <Eye x={x} y={GROUND - 320} s={look.s} />
              </g>
            ) : null}
          </g>
        )
      })}
    </Rise>
  )
}

// ── 2–5. The code, three payments at B, C and D, strangers to everyone, found by your wallet ──────

const NEW = [
  { letter: 'B', address: '0x9a07…41c2', amount: '+$2,400', x: 1060 },
  { letter: 'C', address: '0x13fe…77b0', amount: '+$85', x: 1360 },
  { letter: 'D', address: '0x6b2c…d4a1', amount: '+$600', x: 1660 },
]
const CLUES = ['clue 02f4…', 'clue 9c1e…', 'clue 5b7a…']

function CodeAndPayments({ t }: { t: number }) {
  const out = S.end - 0.3
  const up = decel(span(t, S.pay, S.pay + 0.7))
  const codeX = 960
  const codeY = mix(400, 170, up)
  const codeS = mix(1, 0.78, up)
  const payersOut = P.strangers - 0.3
  const onlookerOut = P.clues - 0.4
  return (
    <>
      {/* You, sharing the code; back later with your wallet. */}
      <Rise t={t} at={S.code} out={S.pay - 0.3}>
        <Person x={520} color={YOU} name="You" look={0.8} />
      </Rise>
      <Pop t={t} at={S.code + 0.3} out={out} x={codeX} y={codeY}>
        <g transform={`scale(${codeS})`}>
          <rect x={-290} y={-80} width={580} height={160} rx={30} fill={PANEL} stroke={YOU} strokeWidth={5} />
          <text x={-254} y={-24} style={txt(30, 800)}>
            Your stealth code
          </text>
          <text x={254} y={-24} textAnchor="end" style={txt(22, 700, YOU)}>
            safe to share
          </text>
          <text x={-254} y={34} style={txt(30, 500, INK, M)}>
            st:eth:0x3f64…58f7
          </text>
        </g>
      </Pop>

      {/* Three people pay with the code. */}
      {PAYERS.map((color, i) => {
        const x = 230 + i * 170
        const read = span(t, P.payers + 0.8 + i * 0.2, P.payers + 1.1 + i * 0.2) * (1 - span(t, P.first, P.first + 0.3))
        return (
          <g key={color}>
            <Pop t={t} at={P.payers + i * 0.25} out={payersOut} x={x} y={GROUND}>
              <Person x={0} y={0} color={color} s={0.9} look={0.6} />
            </Pop>
            {read > 0 ? <line x1={codeX - 120} y1={235} x2={x + 20} y2={GROUND - 270} stroke={YOU} strokeWidth={3} strokeDasharray="6 10" opacity={read} /> : null}
          </g>
        )
      })}
      {NEW.map((n, i) => {
        const at = P.first + i * P.step
        const e = decel(span(t, at, at + 0.7))
        const found = span(t, P.ticks + i * 0.4, P.ticks + i * 0.4 + 0.2)
        const open = decel(span(t, P.spend + i * 0.45, P.spend + i * 0.45 + 0.35))
        const from = 230 + i * 170
        return (
          <g key={n.letter}>
            {e > 0 && e < 1 ? <Coin x={mix(from, n.x, e)} y={mix(GROUND - 280, 470, e) - Math.sin(Math.PI * e) * 200} /> : null}
            <Pop t={t} at={at + 0.6} out={out} x={n.x} y={470}>
              <Card x={0} y={0} w={260} h={200} title={`Address ${n.letter}`} address={n.address} ring={found > 0.5 ? YOU : INK}>
                <text x={26} y={160} style={txt(36, 800)}>
                  {n.amount}
                </text>
              </Card>
              <Padlock x={104} y={-74} open={open} />
            </Pop>
            {/* To everyone else: whose? */}
            {t < P.ticks + i * 0.4 ? (
              <Pop t={t} at={P.strangers + 0.5 + i * 0.2} out={P.ticks + i * 0.4} x={n.x} y={330}>
                <Question x={0} y={0} />
              </Pop>
            ) : (
              <Pop t={t} at={P.ticks + i * 0.4} out={out} x={n.x} y={330}>
                <Tick x={0} y={0} s={1.1} />
              </Pop>
            )}
            {/* The clue each payment leaves, and your wallet checking it. */}
            <Pop t={t} at={P.clues + i * 0.25} out={out} x={n.x} y={624}>
              <rect x={-110} y={-24} width={220} height={48} rx={24} fill={PANEL} stroke={INK} strokeWidth={3} />
              <text y={8} textAnchor="middle" style={txt(22, 500, INK, M)}>
                {CLUES[i]}
              </text>
            </Pop>
            {t > P.scan + i * 0.8 && t < P.scan + i * 0.8 + 0.9 ? (
              <ellipse cx={n.x} cy={624} rx={128 + 10 * span(t, P.scan + i * 0.8, P.scan + i * 0.8 + 0.9)} ry={38} fill="none" stroke={YOU} strokeWidth={5} opacity={1 - span(t, P.scan + i * 0.8 + 0.5, P.scan + i * 0.8 + 0.9)} />
            ) : null}
          </g>
        )
      })}

      {/* Everyone else sees three strangers. */}
      <Rise t={t} at={P.strangers} out={onlookerOut}>
        <Person x={400} color={GREY} look={0.9} />
        {NEW.map((n) => (
          <line key={n.letter} x1={440} y1={GROUND - 336} x2={n.x - 30} y2={322} stroke={DIM} strokeWidth={3} strokeDasharray="8 12" />
        ))}
        <Eye x={400} y={GROUND - 320} />
      </Rise>

      {/* You again, with your wallet: B, C and D found, one balance. */}
      <Rise t={t} at={P.clues - 0.2} out={out}>
        <Person x={250} color={YOU} name="You" look={0.8} />
        <g transform="translate(420 250)">
          <rect width={290} height={400} rx={36} fill="#ffffff" stroke={INK} strokeWidth={4} />
          <rect x={115} y={16} width={60} height={8} rx={4} fill={LINE} />
          <text x={24} y={70} style={txt(26, 800)}>
            Your wallet
          </text>
          {NEW.map((n, i) => (
            <g key={n.letter} opacity={span(t, P.ticks + i * 0.4 + 0.1, P.ticks + i * 0.4 + 0.3)}>
              <text x={24} y={130 + i * 56} style={txt(24, 700)}>
                {`Address ${n.letter}`}
              </text>
              <text x={266} y={130 + i * 56} textAnchor="end" style={txt(24, 800)}>
                {n.amount.replace('+', '')}
              </text>
            </g>
          ))}
          <g opacity={span(t, P.total, P.total + 0.25)}>
            <line x1={24} y1={300} x2={266} y2={300} stroke={LINE} strokeWidth={3} />
            <text x={24} y={346} style={txt(24, 700, DIM)}>
              Balance
            </text>
            <text x={266} y={348} textAnchor="end" style={txt(34, 800, YOU)}>
              $3,085
            </text>
          </g>
        </g>
      </Rise>
    </>
  )
}

function End({ t }: { t: number }) {
  const at = E.end.at
  const center: CSSProperties = { margin: 0, textAlign: 'center' }
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
      <p style={{ ...center, fontFamily: F, fontWeight: 800, fontSize: 96, letterSpacing: '-0.04em', color: INK, ...presenceStyle(hero(t, at)) }}>That’s a stealth address.</p>
      <p style={{ ...center, fontFamily: F, fontWeight: 700, fontSize: 40, color: INK, ...presenceStyle(rise(t, at + 0.6)) }}>
        Share a code. Get paid at new addresses. <span style={{ color: DIM }}>Only you can link them.</span>
      </p>
      <p style={{ ...center, fontFamily: F, fontWeight: 600, fontSize: 30, color: DIM, marginTop: 24, ...presenceStyle(rise(t, at + 1.2)) }}>
        Free, open-source code for five networks:
      </p>
      <div style={{ display: 'flex', gap: 30, ...presenceStyle(rise(t, at + 1.4)) }}>
        {[
          ['monad', 'Monad'],
          ['solana', 'Solana'],
          ['sui', 'Sui'],
          ['aptos', 'Aptos'],
          ['stellar', 'Stellar'],
        ].map(([id, name]) => (
          <div key={id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <Img src={staticFile(`stealth/${id}.svg`)} style={{ width: 60, height: 60, borderRadius: 30 }} />
            <span style={{ fontFamily: F, fontWeight: 700, fontSize: 22, color: INK }}>{name}</span>
          </div>
        ))}
      </div>
      <p style={{ ...center, fontFamily: M, fontWeight: 500, fontSize: 38, color: RED, marginTop: 10, ...presenceStyle(rise(t, at + 1.7)) }}>github.com/shaibuafeez/stealth</p>
    </div>
  )
}

function Captions({ t }: { t: number }) {
  const list = E.captions as Array<[number, string]>
  return (
    <>
      {list.map(([at, text], i) => {
        const next = i + 1 < list.length ? (list[i + 1] as [number, string])[0] : S.end
        const out = next - 0.35
        if (t < at - 0.05 || t > out + 0.32) return null
        return (
          <p key={at} style={{ position: 'absolute', left: 160, right: 160, top: 840, textAlign: 'center', fontFamily: F, fontWeight: 800, fontSize: 52, lineHeight: 1.18, letterSpacing: '-0.02em', color: INK, margin: 0, ...presenceStyle(hero(t, at === 0 ? -1 : at, out)) }}>
            {text}
          </p>
        )
      })}
    </>
  )
}

export function Simple() {
  const t = useCurrentFrame() / FPS
  return (
    <AbsoluteFill style={{ background: '#ffffff', overflow: 'hidden' }}>
      <svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
        <g transform={`translate(960 ${GROUND}) scale(1.12) translate(-960 ${-GROUND})`}>
        {t < S.end ? <line x1={100} y1={GROUND + 2} x2={1820} y2={GROUND + 2} stroke={LINE} strokeWidth={4} strokeLinecap="round" opacity={1 - span(t, S.end - 0.3, S.end)} /> : null}
        {t < S.code ? <AddressA t={t} /> : null}
        {t >= S.code - 0.05 && t < S.end ? <CodeAndPayments t={t} /> : null}
        </g>
      </svg>
      <Captions t={t} />
      {t >= S.end - 0.05 ? <End t={t} /> : null}
    </AbsoluteFill>
  )
}
