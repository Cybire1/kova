/**
 * "How a stealth address works": an illustrated lesson, about a minute, for people who want to
 * understand it rather than be sold to. Ada gets paid; Sam pays her. The cryptography is told with the
 * paint-mixing picture used to teach key exchange: a common colour everyone has, a secret colour each,
 * and mixes that are easy to make and impossible to unmix.
 *
 *   Ada's secret v, public V = v·G        → blue, and blue + yellow = green ("Ada's shared colour")
 *   Sam's secret r, hint R = r·G          → red, and red + yellow = orange ("Sam's hint")
 *   shared secret r·V = v·R               → red + green = blue + orange = brown, made by both, by no one else
 *   one-time address from the shared mix  → a new mailbox, #7f3a
 *   anyone else: V + R                    → green + orange = olive, the wrong mix
 *   spending key s + hash(shared)         → Ada's key with the brown mix opens the mailbox
 *
 * Motion vocabulary: objects pop or rise, words sharpen in (captions), every exit fades with a lift.
 * One signature: the mixes, held all film. Captions carry the explanation; nothing is narrated twice.
 */
import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion'
import { decel, FPS, hero, mix, presenceStyle, rise, span } from '../motion'
import E from './explainer.json'

export const EXPLAINER_DURATION = E.duration

const INK = '#0b1a1d'
const DIM = '#5d6b6d'
const LINE = '#e3e1dc'
const PANEL = '#f4f3f0'
const ADA = '#46878B'
const SAM = '#7C8BD6'
const HELP = '#E0B44C'
const GREY = '#CFCBC3'
const YELLOW = '#F2C14E'
const BLUE = '#3E73C4'
const RED = '#D46558'
const GREEN = '#5DA271'
const ORANGE = '#E8894A'
const BROWN = '#8B5A3C'
const OLIVE = '#A3913E'
const PINK = '#E58FB0'
const CYAN = '#5CC3C9'
const PURPLE = '#8C6BC8'
const COIN = '#F6CF5A'
const GROUND = 720
const F = 'Manrope'
const M = 'JetBrains Mono'
const S = E.scenes

export const txt = (size: number, weight = 700, color = INK, family = F): CSSProperties => ({ fontFamily: family, fontWeight: weight, fontSize: size, fill: color })

/** Objects pop into place: a quick scale up from 70%, a fade, and the shared exit. */
export function pop(t: number, at: number, out?: number) {
  const e = decel(span(t, at, at + 0.45))
  const gone = out === undefined ? 0 : span(t, out, out + 0.3)
  return { o: span(t, at, at + 0.18) * (1 - gone), s: 0.7 + 0.3 * e, y: -8 * gone }
}

export function Pop({ t, at, out, x, y, children }: { t: number; at: number; out?: number; x: number; y: number; children: ReactNode }) {
  const p = pop(t, at, out)
  if (p.o <= 0) return null
  return (
    <g opacity={p.o} transform={`translate(${x} ${y + p.y}) scale(${p.s})`}>
      {children}
    </g>
  )
}

export function Rise({ t, at, out, children }: { t: number; at: number; out?: number; children: ReactNode }) {
  const p = rise(t, at, out, 30)
  if (p.opacity <= 0) return null
  return (
    <g opacity={p.opacity} transform={`translate(0 ${p.y})`}>
      {children}
    </g>
  )
}

// ── The drawings ────────────────────────────────────────────────────────────────────────────────

export function Person({ x, y = GROUND, color, name, s = 1, look = 0 }: { x: number; y?: number; color: string; name?: string; s?: number; look?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx={0} cy={3} rx={64} ry={10} fill={INK} opacity={0.07} />
      <rect x={-50} y={-150} width={100} height={150} rx={48} fill={color} stroke={INK} strokeWidth={4} />
      <circle cx={0} cy={-196} r={46} fill="#ffffff" stroke={INK} strokeWidth={4} />
      <circle cx={-15 + look * 8} cy={-202} r={5.5} fill={INK} />
      <circle cx={15 + look * 8} cy={-202} r={5.5} fill={INK} />
      <path d={`M ${-12 + look * 7} -181 Q ${look * 7} -172 ${12 + look * 7} -181`} stroke={INK} strokeWidth={4} fill="none" strokeLinecap="round" />
      {name ? (
        <text x={0} y={46} textAnchor="middle" style={txt(28, 800)}>
          {name}
        </text>
      ) : null}
    </g>
  )
}

export function Coin({ x, y, r = 22 }: { x: number; y: number; r?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r} fill={COIN} stroke={INK} strokeWidth={r > 16 ? 3.5 : 2.5} />
      <text y={r * 0.38} textAnchor="middle" style={txt(r * 1.05, 800)}>
        $
      </text>
    </g>
  )
}

function Mailbox({ x, y = GROUND, s = 1, glass = false, num, open = 0, glow = 0, children }: { x: number; y?: number; s?: number; glass?: boolean; num?: string; open?: number; glow?: number; children?: ReactNode }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      {glow > 0 ? <circle cx={0} cy={-240} r={170} fill={ADA} opacity={0.16 * glow} /> : null}
      <ellipse cx={0} cy={3} rx={60} ry={9} fill={INK} opacity={0.07} />
      <rect x={-9} y={-175} width={18} height={175} fill={INK} />
      <rect x={-95} y={-310} width={190} height={140} rx={30} fill={glass ? 'rgba(126,182,214,0.18)' : '#ECEAE5'} stroke={INK} strokeWidth={4} />
      {children}
      <rect x={-50} y={-292} width={100} height={10} rx={5} fill={INK} />
      <rect x={95} y={-300} width={7} height={72} fill={INK} />
      <rect x={102} y={-300} width={44} height={28} rx={5} fill={glass ? RED : '#B4B0A8'} stroke={INK} strokeWidth={3} />
      {num ? (
        <text x={0} y={-222} textAnchor="middle" style={txt(32, 500, INK, M)}>
          {num}
        </text>
      ) : null}
      <g transform={`rotate(${-open * 58} -95 -312)`}>
        <rect x={-99} y={-322} width={198} height={22} rx={11} fill={INK} />
      </g>
    </g>
  )
}

export function Lock({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={20} fill="#ffffff" stroke={INK} strokeWidth={3} />
      <path d="M-6 -2 V-7 a6 6 0 0 1 12 0 V-2" stroke={INK} strokeWidth={3.2} fill="none" />
      <rect x={-9} y={-3} width={18} height={14} rx={3} fill={INK} />
    </g>
  )
}

/** A colour: a paint drop, so it never reads as a coin. */
function Drop({ x, y, r = 48, color, label, sub, lock = false, o = 1, s = 1 }: { x: number; y: number; r?: number; color: string; label?: string; sub?: string; lock?: boolean; o?: number; s?: number }) {
  if (o <= 0) return null
  const d = `M0 ${-r * 1.35} C ${r * 0.95} ${-r * 0.35} ${r} ${r * 0.1} ${r} ${r * 0.38} A ${r} ${r} 0 0 1 ${-r} ${r * 0.38} C ${-r} ${r * 0.1} ${-r * 0.95} ${-r * 0.35} 0 ${-r * 1.35} Z`
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} opacity={o}>
      <path d={d} fill={color} stroke={INK} strokeWidth={4} strokeLinejoin="round" />
      <ellipse cx={-r * 0.38} cy={0} rx={r * 0.13} ry={r * 0.24} fill="#ffffff" opacity={0.5} />
      {lock ? <Lock x={r * 0.85} y={-r * 0.85} /> : null}
      {label ? (
        <text y={r * 1.38 + 36} textAnchor="middle" style={txt(26, 800)}>
          {label}
        </text>
      ) : null}
      {sub ? (
        <text y={r * 1.38 + 68} textAnchor="middle" style={txt(22, 600, DIM)}>
          {sub}
        </text>
      ) : null}
    </g>
  )
}

/** Two colours meet and become a third: the copies travel, the originals stay. */
function MixDrops({ t, at, out, a, b, to, ca, cb, cOut, r = 40, rOut = 54, label, sub, arc = 0 }: { t: number; at: number; out?: number; a: [number, number]; b: [number, number]; to: [number, number]; ca: string; cb: string; cOut: string; r?: number; rOut?: number; label?: string; sub?: string; arc?: number }) {
  if (t < at) return null
  const e = decel(span(t, at, at + 0.75))
  const m = span(t, at + 0.6, at + 0.95)
  const gone = out === undefined ? 0 : span(t, out, out + 0.3)
  const lift = Math.sin(Math.PI * e) * arc
  return (
    <g opacity={1 - gone} transform={`translate(0 ${-8 * gone})`}>
      <Drop x={mix(a[0], to[0] - r * 0.5, e)} y={mix(a[1], to[1], e) - lift} r={r} color={ca} s={1 - 0.5 * m} o={1 - m} />
      <Drop x={mix(b[0], to[0] + r * 0.5, e)} y={mix(b[1], to[1], e) - lift} r={r} color={cb} s={1 - 0.5 * m} o={1 - m} />
      <Drop x={to[0]} y={to[1]} r={rOut} color={cOut} s={0.6 + 0.4 * decel(m)} o={m} label={label} sub={sub} />
    </g>
  )
}

export function Eye({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-36 0 Q0 -28 36 0 Q0 28 -36 0 Z" fill="#ffffff" stroke={INK} strokeWidth={4} strokeLinejoin="round" />
      <circle r={10} fill={INK} />
    </g>
  )
}

export function Key({ x, y, glow = 0, s = 1 }: { x: number; y: number; glow?: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      {glow > 0 ? <circle cx={-26} r={46} fill={BROWN} opacity={0.22 * glow} /> : null}
      <circle cx={-26} r={24} fill={ADA} stroke={INK} strokeWidth={4} />
      <circle cx={-26} r={8} fill="#ffffff" stroke={INK} strokeWidth={3} />
      <path d="M-2 0 H52 M36 0 V16 M48 0 V12" stroke={INK} strokeWidth={8} strokeLinecap="round" fill="none" />
    </g>
  )
}

function Tag({ x, y, text, hit = false }: { x: number; y: number; text: string; hit?: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={-56} y={-22} width={112} height={44} rx={22} fill={hit ? ADA : '#ffffff'} stroke={hit ? ADA : INK} strokeWidth={3} />
      <text y={9} textAnchor="middle" style={txt(24, 500, hit ? '#ffffff' : INK, M)}>
        {text}
      </text>
    </g>
  )
}

export function Tick({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <circle r={22} fill={ADA} stroke={INK} strokeWidth={3} />
      <path d="M-9 1 L-2 8 L10 -6" stroke="#ffffff" strokeWidth={4.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  )
}

function Board({ x, y, w, h, children }: { x: number; y: number; w: number; h: number; children?: ReactNode }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={w} height={h} rx={24} fill={PANEL} stroke={INK} strokeWidth={4} />
      <text x={28} y={50} style={txt(26, 800)}>
        Public board
      </text>
      <text x={28} y={80} style={txt(20, 600, DIM)}>
        everyone can read it
      </text>
      {children}
    </g>
  )
}

const Pin = ({ x, y }: { x: number; y: number }) => <circle cx={x} cy={y} r={7} fill={RED} stroke={INK} strokeWidth={2.5} />

// ── The scenes ──────────────────────────────────────────────────────────────────────────────────

/** 1. A normal address: a glass mailbox, and everyone watching it. */
function Glass({ t }: { t: number }) {
  const out = S.recipe - 0.3
  const { coins, onlookers } = E.glass
  const box = 980
  return (
    <Rise t={t} at={-1} out={out}>
      <Person x={620} color={ADA} name="Ada" look={0.6} />
      <Mailbox x={box} glass>
        {['$2,400', '$85', '$600'].map((amount, i) => (
          <g key={amount} opacity={span(t, (coins[i] as number) + 0.42, (coins[i] as number) + 0.55)}>
            <Coin x={-60} y={-254 + i * 30} r={11} />
            <text x={-40} y={-246 + i * 30} style={txt(22, 800)}>
              {amount}
            </text>
          </g>
        ))}
      </Mailbox>
      {coins.map((c) => {
        const e = span(t, c, c + 0.45)
        return e > 0 && e < 1 ? <Coin key={c} x={box} y={mix(GROUND - 600, GROUND - 292, e * e)} /> : null
      })}
      {[1390, 1610].map((x, i) => {
        const at = onlookers + i * 0.3
        const look = pop(t, at + 0.6, out)
        return (
          <g key={x}>
            <Rise t={t} at={at} out={out}>
              <Person x={x} color={GREY} look={-0.9} />
            </Rise>
            {look.o > 0 ? (
              <g opacity={look.o}>
                <line x1={x - 50} y1={GROUND - 320} x2={box + 110} y2={GROUND - 250} stroke={DIM} strokeWidth={3} strokeDasharray="8 12" />
                <Eye x={x} y={GROUND - 320} s={look.s} />
              </g>
            ) : null}
          </g>
        )
      })}
    </Rise>
  )
}

/** 2. Ada's shared colour: her secret mixed with the common colour. */
function Recipe({ t }: { t: number }) {
  const out = S.pay - 0.3
  const { secret, common, mix: mixAt, note } = E.recipe
  return (
    <>
      <Rise t={t} at={S.recipe} out={out}>
        <Person x={330} color={ADA} name="Ada" look={0.8} />
      </Rise>
      <Pop t={t} at={secret} out={out} x={620} y={460}>
        <Drop x={0} y={0} r={50} color={BLUE} lock label="Ada’s secret" sub="never leaves her phone" />
      </Pop>
      <Pop t={t} at={common} out={out} x={790} y={470}>
        <text textAnchor="middle" style={txt(64, 800, DIM)}>
          +
        </text>
      </Pop>
      <Pop t={t} at={common} out={out} x={960} y={460}>
        <Drop x={0} y={0} r={50} color={YELLOW} label="Common colour" sub="the same for everyone" />
      </Pop>
      <Pop t={t} at={mixAt} out={out} x={1150} y={470}>
        <text textAnchor="middle" style={txt(64, 800, DIM)}>
          =
        </text>
      </Pop>
      <MixDrops t={t} at={mixAt} out={out} a={[620, 460]} b={[960, 460]} to={[1400, 450]} ca={BLUE} cb={YELLOW} cOut={GREEN} r={34} rOut={64} label="Ada’s shared colour" sub="she can post it anywhere" arc={120} />
      <Pop t={t} at={note} out={out} x={960} y={230}>
        <rect x={-330} y={-40} width={660} height={72} rx={36} fill={PANEL} stroke={LINE} strokeWidth={3} />
        <text y={10} textAnchor="middle" style={txt(30, 800)}>
          Easy to mix. Impossible to unmix.
        </text>
      </Pop>
    </>
  )
}

/** 3. Sam pays: his secret and Ada's colour make a mix, the mix makes a new mailbox, and he leaves a hint. */
function Pay({ t }: { t: number }) {
  const out = S.find - 0.3
  const P = E.pay
  const box = 1180
  const toBox = decel(span(t, P.mailbox, P.mailbox + 0.6))
  const coin = span(t, P.coin, P.coin + 0.8)
  const flyAt = P.hint + 1.6
  const fly = decel(span(t, flyAt, flyAt + 0.9))
  return (
    <>
      <Rise t={t} at={S.pay} out={out}>
        <Drop x={720} y={270} r={40} color={GREEN} label="Ada’s shared colour" />
      </Rise>
      <Pop t={t} at={P.sam} out={out} x={250} y={GROUND}>
        <Person x={0} y={0} color={SAM} name="Sam" look={0.8} />
      </Pop>
      <Pop t={t} at={P.secret} out={out} x={460} y={480}>
        <Drop x={0} y={0} r={44} color={RED} lock label="Sam’s secret" />
      </Pop>
      {/* The shared mix, which then becomes the mailbox. */}
      {t < P.mailbox ? <MixDrops t={t} at={P.mix} a={[460, 480]} b={[720, 270]} to={[900, 460]} ca={RED} cb={GREEN} cOut={BROWN} r={30} rOut={52} label="Their shared mix" /> : null}
      {t >= P.mailbox && toBox < 1 ? <Drop x={mix(900, box, toBox)} y={mix(460, GROUND - 240, toBox)} r={52} color={BROWN} s={1 - 0.6 * toBox} o={1 - span(toBox, 0.75, 1)} /> : null}
      <Pop t={t} at={P.mailbox + 0.2} out={out} x={box} y={GROUND}>
        <Mailbox x={0} y={0} num="#7f3a" />
      </Pop>
      <Pop t={t} at={P.mailbox + 0.5} out={out} x={box} y={GROUND + 46}>
        <text textAnchor="middle" style={txt(27, 700, DIM)}>
          a new mailbox, made from the mix
        </text>
      </Pop>
      {coin > 0 && coin < 1 ? <Coin x={mix(330, box, coin)} y={mix(GROUND - 260, GROUND - 292, coin) - Math.sin(Math.PI * coin) * 200} /> : null}
      {/* The hint: Sam's secret with the common colour, pinned on the public board. */}
      <Rise t={t} at={P.board} out={out}>
        <Board x={1420} y={210} w={400} h={320}>
          {fly >= 1 ? (
            <>
              <Pin x={200} y={140} />
              <Drop x={200} y={196} r={30} color={ORANGE} />
              <text x={200} y={280} textAnchor="middle" style={txt(22, 700, DIM)}>
                Sam’s hint
              </text>
            </>
          ) : null}
        </Board>
      </Rise>
      {t < P.hint + 0.95 ? (
        <Pop t={t} at={P.hint} out={out} x={700} y={620}>
          <Drop x={0} y={0} r={28} color={YELLOW} label="common" />
        </Pop>
      ) : null}
      {t < flyAt ? <MixDrops t={t} at={P.hint + 0.4} out={out} a={[460, 480]} b={[700, 620]} to={[580, 630]} ca={RED} cb={YELLOW} cOut={ORANGE} r={26} rOut={34} label="Sam’s hint" /> : null}
      {t >= flyAt && fly < 1 ? <Drop x={mix(580, 1620, fly)} y={mix(630, 406, fly) - Math.sin(Math.PI * fly) * 260} r={mix(34, 30, fly)} color={ORANGE} /> : null}
    </>
  )
}

/** 4. Ada reads the board: each hint mixed with her secret; one comes out as the mailbox's number. */
const HINTS = [
  { c: PINK, out: '#9A7FC0', tag: '#9a07' },
  { c: CYAN, out: '#4F9AC6', tag: '#13fe' },
  { c: OLIVE, out: '#6E8A6E', tag: '#6b2c' },
  { c: ORANGE, out: BROWN, tag: '#7f3a' },
  { c: PURPLE, out: '#6A6BC4', tag: '#d4a1' },
]
const BOXES = [
  { x: 1210, num: '#2b91' },
  { x: 1370, num: '#e0c4' },
  { x: 1530, num: '#7f3a' },
  { x: 1690, num: '#51d8' },
]

function Find({ t }: { t: number }) {
  const out = S.spend - 0.3
  const { first, step, match, line, onlooker } = E.find
  const hx = (i: number) => 240 + i * 130
  const drawn = decel(span(t, line, line + 0.7))
  const glow = span(t, line + 0.5, line + 0.8)
  return (
    <>
      <Rise t={t} at={S.find} out={out}>
        <Board x={140} y={200} w={720} h={420}>
          {HINTS.map((h, i) => (
            <g key={h.tag}>
              <Pin x={hx(i) - 140} y={104} />
              <Drop x={hx(i) - 140} y={156} r={28} color={h.c} />
            </g>
          ))}
        </Board>
        <Person x={1010} color={ADA} name="Ada" look={-0.9} />
        {BOXES.map((b) => (
          <Mailbox key={b.num} x={b.x} s={0.62} num={b.num} glow={b.num === '#7f3a' ? glow : 0} />
        ))}
      </Rise>
      <Pop t={t} at={S.find + 0.4} out={out} x={940} y={440}>
        <Drop x={0} y={0} r={26} color={BLUE} lock />
      </Pop>
      {HINTS.map((h, i) => {
        const at = first + i * step
        const go = decel(span(t, at, at + 0.3))
        const res = pop(t, at + 0.28, out)
        return (
          <g key={h.tag}>
            {t >= at && t < at + 0.32 ? <Drop x={mix(940, hx(i), go)} y={mix(440, 356, go)} r={16} color={BLUE} /> : null}
            {res.o > 0 ? (
              <g opacity={res.o} transform={`translate(0 ${res.y})`}>
                <Drop x={hx(i)} y={470} r={22} color={h.out} s={res.s} />
                <Tag x={hx(i)} y={560} text={h.tag} hit={i === match && t >= line} />
              </g>
            ) : null}
          </g>
        )
      })}
      {drawn > 0 ? (
        <g opacity={1 - span(t, out, out + 0.3)}>
          <path d={`M ${hx(match) + 56} 560 Q 1120 300 1530 ${GROUND - 214}`} stroke={ADA} strokeWidth={5} fill="none" strokeLinecap="round" strokeDasharray="1" strokeDashoffset={1 - drawn} pathLength={1} />
          <Pop t={t} at={line + 0.5} out={out} x={1530} y={GROUND - 256}>
            <Tick x={0} y={0} />
          </Pop>
        </g>
      ) : null}
      {/* Anyone else: Ada's shared colour with the hint makes the wrong mix. */}
      <Rise t={t} at={onlooker} out={out}>
        <Person x={210} s={0.42} color={GREY} />
        <Drop x={310} y={672} r={18} color={GREEN} />
        <text x={360} y={684} textAnchor="middle" style={txt(34, 800, DIM)}>
          +
        </text>
        <Drop x={410} y={672} r={18} color={ORANGE} />
        <text x={460} y={684} textAnchor="middle" style={txt(34, 800, DIM)}>
          =
        </text>
        <Drop x={510} y={672} r={18} color={OLIVE} />
        <Tag x={620} y={672} text="#c41d" />
        <text x={712} y={686} textAnchor="middle" style={txt(40, 800, RED)}>
          ✕
        </text>
      </Rise>
    </>
  )
}

/** 5. Ada spends: her key with the mix opens the mailbox; a helper pays the fee. */
function Spend({ t }: { t: number }) {
  const out = S.recap - 0.3
  const P = E.spend
  const box = 1060
  const merge = span(t, P.key + 0.5, P.key + 0.9)
  const fly = decel(span(t, P.fly, P.fly + 0.7))
  const open = decel(span(t, P.open, P.open + 0.45))
  const coin = span(t, P.coin, P.coin + 0.8)
  const stamp = decel(span(t, P.stamp, P.stamp + 0.7))
  return (
    <>
      <Rise t={t} at={S.spend} out={out}>
        <Person x={520} color={ADA} name="Ada" look={0.8} />
        <Mailbox x={box} num="#7f3a" open={open} glow={1} />
        <g transform={`translate(320 ${GROUND - 70})`}>
          <rect x={-58} y={-40} width={116} height={80} rx={16} fill={ADA} stroke={INK} strokeWidth={4} />
          <rect x={18} y={-14} width={40} height={28} rx={8} fill="#ffffff" stroke={INK} strokeWidth={3} />
          <text y={78} textAnchor="middle" style={txt(22, 700, DIM)}>
            Ada’s wallet
          </text>
        </g>
      </Rise>
      {t < P.open + 0.4 ? (
        <g opacity={1 - span(t, P.open, P.open + 0.4)}>
          <Pop t={t} at={P.key} out={out} x={mix(700, box - 30, fly)} y={mix(470, GROUND - 300, fly)}>
            <Key x={0} y={0} glow={merge} />
          </Pop>
        </g>
      ) : null}
      {merge < 1 ? (
        <Pop t={t} at={P.key + 0.15} out={out} x={mix(820, 690, merge)} y={470}>
          <Drop x={0} y={0} r={24} color={BROWN} o={1 - merge} label={merge > 0 ? undefined : 'the mix'} />
        </Pop>
      ) : null}
      {coin > 0 && coin < 1 ? <Coin x={mix(box, 320, coin)} y={mix(GROUND - 300, GROUND - 90, coin) - Math.sin(Math.PI * coin) * 220} /> : null}
      {coin >= 1 ? (
        <Pop t={t} at={P.coin + 0.8} out={out} x={320} y={GROUND - 150}>
          <Coin x={0} y={0} />
        </Pop>
      ) : null}
      <Pop t={t} at={P.helper} out={out} x={1500} y={GROUND}>
        <Person x={0} y={0} color={HELP} name="Helper" look={-0.8} />
      </Pop>
      {t >= P.stamp ? (
        <g opacity={1 - span(t, out, out + 0.3)} transform={`translate(${mix(1440, box + 170, stamp)} ${mix(GROUND - 260, GROUND - 380, stamp) - Math.sin(Math.PI * stamp) * 90})`}>
          <rect x={-40} y={-30} width={80} height={60} rx={6} fill="#ffffff" stroke={INK} strokeWidth={3.5} strokeDasharray="6 4" />
          <text y={9} textAnchor="middle" style={txt(22, 800, INK)}>
            fee
          </text>
        </g>
      ) : null}
      <Pop t={t} at={P.stamp + 0.7} out={out} x={box + 190} y={GROUND - 440}>
        <text textAnchor="middle" style={txt(26, 700, DIM)}>
          paid by the helper
        </text>
      </Pop>
    </>
  )
}

/** 6. Recap: one shared colour, a new mailbox every time, and only Ada's ticks. */
function Recap({ t }: { t: number }) {
  const out = S.end - 0.3
  const { boxes, ticks } = E.recap
  const xs = [760, 950, 1140, 1330, 1520, 1710]
  const nums = ['#7f3a', '#a90e', '#3c57', '#f12b', '#6d04', '#b8e9']
  return (
    <>
      <Rise t={t} at={S.recap} out={out}>
        <Person x={300} color={ADA} name="Ada" look={0.8} />
        <Drop x={480} y={330} r={40} color={GREEN} label="shared once" />
      </Rise>
      {xs.map((x, i) => (
        <g key={x}>
          <Pop t={t} at={boxes + i * 0.22} out={out} x={x} y={GROUND}>
            <Mailbox x={0} y={0} s={0.55} num={nums[i]} />
          </Pop>
          <Pop t={t} at={ticks + i * 0.28} out={out} x={x} y={GROUND - 230}>
            <Tick x={0} y={0} s={0.9} />
          </Pop>
        </g>
      ))}
    </>
  )
}

function End({ t }: { t: number }) {
  const at = E.end.at
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 26 }}>
      <p style={{ fontFamily: F, fontWeight: 800, fontSize: 96, letterSpacing: '-0.04em', color: INK, margin: 0, ...presenceStyle(hero(t, at)) }}>That’s a stealth address.</p>
      <p style={{ fontFamily: F, fontWeight: 600, fontSize: 36, color: DIM, margin: 0, ...presenceStyle(rise(t, at + 0.7)) }}>
        Free, open-source code that does this on five networks:
      </p>
      <div style={{ display: 'flex', gap: 30, marginTop: 4, ...presenceStyle(rise(t, at + 1.0)) }}>
        {[
          ['monad', 'Monad'],
          ['solana', 'Solana'],
          ['sui', 'Sui'],
          ['aptos', 'Aptos'],
          ['stellar', 'Stellar'],
        ].map(([id, name]) => (
          <div key={id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <Img src={staticFile(`stealth/${id}.svg`)} style={{ width: 64, height: 64, borderRadius: 32 }} />
            <span style={{ fontFamily: F, fontWeight: 700, fontSize: 22, color: INK }}>{name}</span>
          </div>
        ))}
      </div>
      <p style={{ fontFamily: M, fontWeight: 500, fontSize: 40, color: RED, margin: '16px 0 0', ...presenceStyle(rise(t, at + 1.3)) }}>github.com/shaibuafeez/stealth</p>
      <p style={{ fontFamily: F, fontWeight: 600, fontSize: 24, color: DIM, margin: 0, ...presenceStyle(rise(t, at + 1.6)) }}>Standard: ERC-5564</p>
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
          <p key={at} style={{ position: 'absolute', left: 160, right: 160, top: 836, textAlign: 'center', fontFamily: F, fontWeight: 800, fontSize: 50, lineHeight: 1.18, letterSpacing: '-0.02em', color: INK, margin: 0, ...presenceStyle(hero(t, at === 0 ? -1 : at, out)) }}>
            {text}
          </p>
        )
      })}
    </>
  )
}

export function Explainer() {
  const t = useCurrentFrame() / FPS
  const within = (a: number, b: number) => t >= a - 0.05 && t < b
  return (
    <AbsoluteFill style={{ background: '#ffffff', overflow: 'hidden' }}>
      <svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
        <g transform={`translate(960 ${GROUND}) scale(1.1) translate(-960 ${-GROUND})`}>
        {t < S.end ? <line x1={100} y1={GROUND + 2} x2={1820} y2={GROUND + 2} stroke={LINE} strokeWidth={4} strokeLinecap="round" opacity={1 - span(t, S.end - 0.3, S.end)} /> : null}
        {within(S.glass, S.recipe) ? <Glass t={t} /> : null}
        {within(S.recipe, S.pay) ? <Recipe t={t} /> : null}
        {within(S.pay, S.find) ? <Pay t={t} /> : null}
        {within(S.find, S.spend) ? <Find t={t} /> : null}
        {within(S.spend, S.recap) ? <Spend t={t} /> : null}
        {within(S.recap, S.end) ? <Recap t={t} /> : null}
        </g>
      </svg>
      <Captions t={t} />
      {t >= S.end - 0.05 ? <End t={t} /> : null}
    </AbsoluteFill>
  )
}
