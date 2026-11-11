/**
 * Kova on the wall: a 12 s ad made for a big curved screen (3:1), after the stage loops where the
 * identity becomes the layout. The title's letters melt into a frame of soft pills around one real
 * payment, hold, then flow back together as the name. Every number is from a real run on Monad
 * testnet ($20.00 from Ada, arrived in 0.6 s, fee $0.00, Kova covers it).
 *
 * One colour system, Kova's own, dimmed for a dark room: cream type on deep teal, coral only for the
 * one detail that matters. One face: Manrope, Kova's own, in small letters. Letters and pills share
 * a goo filter, so they read as one liquid material; the goo thickens only while it moves.
 *
 * Beats (frames at 30 fps): title 0–60, melt 60–90 (the drop), payment 90–240, flow 240–270, name
 * 270–360 (the final hit).
 * This file is the screen alone; WallStage.tsx puts it on a curved LED wall in a dark room.
 */
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'

/** Kova's palette, dimmed for a screen in a dark room: an LED wall at full white blows out on
 * camera, so the teal sits deeper and the cream and coral sit lower. */
export const W = {
  ground: '#123533',
  groundDeep: '#0B2423',
  cream: '#E2DFC2',
  coral: '#C76E5E',
  ink: '#0B1A1D',
}

export const WALL_FRAMES = 360
// Every beat sits on the music's own grid (a beat every 0.5 s from 0.56 s; see
// scripts/wall/beats.py), 2 frames early so the eye lands with the ear.
const T = { melt: 60, info: 90, stats: [105, 120, 135], kovi: 150, out: 223, flow: 240, end: 270, koviEnd: 286, tag: 301 }
const BEAT = 15 // 120 BPM: the beat grid is exactly 0.5 s, from 0.56 s

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return k * k * (3 - 2 * k)
}
const inOut = Easing.inOut(Easing.cubic)
const lerp = (a: number, b: number, k: number) => a + (b - a) * k

/** A word or element arriving: up, from a slight blur, over 9 frames. Leaving is the same, reversed. */
const rise = (frame: number, at: number, leave: number, dist: number) => {
  const k = interpolate(frame - at, [0, 9], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })
  const o = interpolate(frame - leave, [0, 8], [1, 0], { ...clamp, easing: Easing.in(Easing.cubic) })
  return { opacity: k * o, transform: `translateY(${(1 - k) * dist - (1 - o) * dist * 0.6}px)`, filter: `blur(${(1 - k * o) * 8}px)` }
}

/** The frame of pills around the edge, the shape every letter melts into. Deterministic, ordered
 * clockwise from the top-left: top 9, right 3, bottom 8, left 3. */
export function framePills(width: number, height: number) {
  const u = height / 1000
  const t = 70 * u
  const m = 60 * u
  const x0 = m + t / 2
  const y0 = m + t / 2
  const x1 = width - x0
  const y1 = height - y0
  // irregular but fixed lengths, like hand-cut pieces
  const weights = [1.4, 0.8, 1.1, 1.7, 0.7, 1.2, 0.9, 1.5, 1.0, 1.3, 0.75, 1.6, 0.85, 1.15, 1.05, 1.45, 0.95, 1.25, 0.8, 1.35, 1.1, 0.9, 1.2]
  const edges: { a: [number, number]; b: [number, number]; n: number }[] = [
    { a: [x0, y0], b: [x1, y0], n: 9 },
    { a: [x1, y0], b: [x1, y1], n: 3 },
    { a: [x1, y1], b: [x0, y1], n: 8 },
    { a: [x0, y1], b: [x0, y0], n: 3 },
  ]
  const pills: { cx: number; cy: number; len: number; angle: number }[] = []
  let k = 0
  for (const e of edges) {
    const ws = weights.slice(k, k + e.n)
    k += e.n
    const sum = ws.reduce((a, b) => a + b, 0)
    const L = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1])
    const dir = [(e.b[0] - e.a[0]) / L, (e.b[1] - e.a[1]) / L]
    const gap = 0.45 * t
    let s = 0
    for (const w of ws) {
      const seg = (L * w) / sum
      const len = Math.max(t, seg - gap)
      const mid = s + seg / 2
      pills.push({ cx: e.a[0] + dir[0] * mid, cy: e.a[1] + dir[1] * mid, len, angle: (Math.atan2(dir[1], dir[0]) * 180) / Math.PI })
      s += seg
    }
  }
  return { pills, t, m }
}

/** Glyph boxes for a line of Manrope ExtraBold, measured in the browser with the font loaded. */
type Glyph = { ch: string; x: number; top: number; size: number; cx: number; cy: number }
let ctx: CanvasRenderingContext2D | null = null
function layout(text: string, size: number, tracking: number, centerX: number, top: number): Glyph[] {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d')
  const c = ctx as CanvasRenderingContext2D
  c.font = `800 ${size}px Manrope`
  const adv = [...text].map((ch) => c.measureText(ch).width)
  const total = adv.reduce((a, b) => a + b, 0) + tracking * size * (text.length - 1)
  let x = centerX - total / 2
  const out: Glyph[] = []
  ;[...text].forEach((ch, i) => {
    if (ch !== ' ') out.push({ ch, x, top, size, cx: x + adv[i] / 2, cy: top + 0.9 * size * 0.6 })
    x += adv[i] + tracking * size
  })
  return out
}

function Goo({ id, sigma }: { id: string; sigma: number }) {
  return (
    <svg width={0} height={0} style={{ position: 'absolute' }}>
      <filter id={id} x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceGraphic" stdDeviation={sigma} result="b" />
        <feColorMatrix in="b" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -10" />
      </filter>
    </svg>
  )
}

const glyphStyle = (g: Glyph) =>
  ({
    position: 'absolute',
    left: g.x,
    top: g.top,
    fontSize: g.size,
    lineHeight: `${0.9 * g.size}px`,
    whiteSpace: 'pre',
    transformOrigin: `${g.cx - g.x}px ${g.cy - g.top}px`,
  }) as const

export function WallScreen() {
  const frame = useCurrentFrame()
  const { width, height, fps } = useVideoConfig()
  const u = height / 1000
  const t = frame / fps
  const { pills, t: thick, m } = framePills(width, height)

  // the title, each line set to the same width
  const titleW = 0.84 * width
  const s1 = titleW / 6.81
  const s2 = titleW / 5.86
  const top1 = (height - 0.9 * (s1 + s2)) / 2 - 10 * u
  const line1 = layout('every payment', s1, -0.045, width / 2, top1)
  const line2 = layout('a new wallet.', s2, -0.045, width / 2, top1 + 0.9 * s1)
  const letters = [...line1, ...line2.slice().reverse()] // pill k takes letter k (line 2 runs right to left)

  // the name at the end, with Kovi beside it
  const ks = 560 * u
  const kovaW = 2.195 * ks
  const kovaX = (width - (kovaW + 60 * u + 380 * u)) / 2 + kovaW / 2
  const kova = layout('kova', ks, -0.06, kovaX, height / 2 - 0.9 * ks * 0.5 - 60 * u)
  const order = pills.map((p, i) => ({ i, cx: p.cx })).sort((a, b) => a.cx - b.cx)
  const group = new Array(pills.length).fill(0)
  order.forEach((o, rank) => {
    group[o.i] = Math.min(3, Math.floor((rank * 4) / pills.length))
  })

  // the goo thickens only while the material moves
  const sigma = (9 + 7 * (smooth(T.melt - 4, T.melt + 12, frame) - smooth(T.info - 2, T.info + 10, frame) + smooth(T.flow - 4, T.flow + 12, frame) - smooth(T.end - 4, T.end + 8, frame))) * u

  const goo: React.ReactNode[] = []
  if (frame < T.info + 4) {
    letters.forEach((g, k) => {
      const p = clamp01((frame - (T.melt + k * 0.5)) / 22)
      const e = inOut(p)
      const P = pills[k]
      const dx = lerp(0, P.cx - g.cx, e)
      const dy = lerp(0, P.cy - g.cy, e)
      const breathe = 1 + 0.012 * Math.sin(2 * Math.PI * (0.45 * t + k * 0.13))
      const gOp = 1 - smooth(0.25, 0.6, p)
      if (gOp > 0) {
        goo.push(
          <span key={`g${k}`} style={{ ...glyphStyle(g), opacity: gOp, transform: `translate(${dx}px, ${dy}px) scale(${breathe * (1 - 0.55 * e)})` }}>
            {g.ch}
          </span>,
        )
      }
      const pOp = smooth(0.15, 0.5, p)
      if (pOp > 0) {
        const len = lerp(0.5 * thick, P.len, smooth(0.35, 1, p))
        const th = thick * lerp(0.6, 1, smooth(0.2, 0.8, p))
        goo.push(<Pill key={`p${k}`} cx={g.cx + dx} cy={g.cy + dy} len={len} th={th} angle={P.angle} opacity={pOp} />)
      }
    })
  } else if (frame < T.end + 10) {
    pills.forEach((P, i) => {
      const gi = group[i]
      const rankInGroup = pills.filter((_, j) => j < i && group[j] === gi).length
      const p = clamp01((frame - (T.flow + gi * 1.5 + rankInGroup)) / 24)
      const e = inOut(p)
      const target = kova[gi]
      const spread = (1 - e) * 0
      const cx = lerp(P.cx, target.cx + spread, e)
      const cy = lerp(P.cy, target.cy, e)
      const breathe = 1 + 0.015 * Math.sin(2 * Math.PI * (0.35 * t + i * 0.37))
      const len = lerp(P.len * breathe, thick * 0.9, smooth(0, 0.6, p))
      const op = 1 - smooth(0.65, 1, p)
      // a coral light runs once around the frame, one pill per half beat, while the payment holds
      const head = (frame - (T.info + 20)) / (BEAT / 2)
      const d = Math.min(Math.abs(i - head), Math.abs(i - head + pills.length), Math.abs(i - head - pills.length))
      const glow = frame > T.info + 20 && frame < T.out ? Math.exp(-(d * d) / 2.2) : 0
      if (op > 0) goo.push(<Pill key={`p${i}`} cx={cx} cy={cy} len={len} th={thick} angle={P.angle} opacity={op} color={mix(W.cream, W.coral, glow)} />)
    })
  }
  if (frame >= T.flow) {
    kova.forEach((g, gi) => {
      const p = clamp01((frame - (T.flow + 10 + gi * 1.5)) / 16)
      if (p <= 0) return
      const e = Easing.out(Easing.cubic)(p)
      goo.push(
        <span key={`k${gi}`} style={{ ...glyphStyle(g), opacity: p > 0.1 ? 1 : 0, transform: `scale(${0.3 + 0.7 * e})` }}>
          {g.ch}
        </span>,
      )
    })
  }

  const kovi = spring({ frame: frame - T.koviEnd, fps, config: { damping: 13, stiffness: 160, mass: 0.7 } })
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse at 50% 40%, ${W.ground} 0%, ${W.groundDeep} 100%)`,
        fontFamily: 'Manrope',
        fontWeight: 800,
        color: W.cream,
        letterSpacing: 0,
      }}
    >
      <Goo id="goo" sigma={sigma} />
      <AbsoluteFill style={{ filter: 'url(#goo)' }}>{goo}</AbsoluteFill>

      {frame >= T.info && frame < T.flow + 4 ? <Payment frame={frame} u={u} fps={fps} /> : null}

      {frame >= T.end ? (
        <>
          <Img
            src={staticFile('wall/kovi-cheer.png')}
            style={{
              position: 'absolute',
              left: kovaX + kovaW / 2 + 60 * u,
              top: height / 2 - 0.9 * ks * 0.5 - 20 * u + 8 * u * Math.sin(2 * Math.PI * 0.5 * t),
              width: 380 * u,
              height: 380 * u,
              opacity: Math.min(1, kovi * 2),
              transform: `scale(${0.7 + 0.3 * kovi}) rotate(${(1 - kovi) * -12}deg)`,
              filter: 'brightness(.9)',
            }}
          />
          <div style={{ position: 'absolute', left: 0, right: 0, top: height / 2 + 0.9 * ks * 0.5 - 20 * u, textAlign: 'center', fontSize: 70 * u, letterSpacing: '-0.025em', color: 'rgba(226,223,194,.9)', ...rise(frame, T.tag, 9999, 30 * u) }}>
            private dollar payments on Monad <span style={{ color: W.coral }}>·</span> mykova.app
          </div>
        </>
      ) : null}
    </AbsoluteFill>
  )
}

/** The payment, laid out like a page: the amount huge on the left with its proof beneath it as a
 * row of figures; the real phone upright in the middle; the one idea on the right with its key words in coral; Kovi sitting on the frame's edge. */
function Payment({ frame, u, fps }: { frame: number; u: number; fps: number }) {
  const amount = 20 * Easing.out(Easing.cubic)(clamp01((frame - (T.info + 4)) / 16))
  const kovi = spring({ frame: frame - T.kovi, fps, config: { damping: 9, stiffness: 180, mass: 0.6 } })
  const koviOut = clamp01((frame - (T.out + 4)) / 6)
  const dim = 'rgba(226,223,194,.66)'
  const stat = (i: number, value: string, label: string) => (
    <div
      key={value}
      style={{
        paddingRight: 54 * u,
        marginRight: 54 * u,
        borderRight: i < 2 ? `${3 * u}px solid rgba(226,223,194,.2)` : 'none',
        ...rise(frame, T.stats[i], T.out + i, 26 * u),
      }}
    >
      <div style={{ fontSize: 92 * u, letterSpacing: '-0.035em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 36 * u, fontWeight: 600, color: dim, marginTop: 12 * u, letterSpacing: '-0.01em' }}>{label}</div>
    </div>
  )
  return (
    <AbsoluteFill>
      {/* the amount and its proof */}
      <div style={{ position: 'absolute', left: 250 * u, top: 215 * u }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 * u, fontSize: 46 * u, fontWeight: 700, color: dim, ...rise(frame, T.info + 2, T.out, 24 * u) }}>
          <Img src={staticFile('wall/ada.png')} style={{ width: 68 * u, height: 68 * u, borderRadius: 34 * u, filter: 'brightness(.9)' }} />
          ada
          <svg width={70 * u} height={24 * u} viewBox="0 0 70 24">
            <path d="M2 12 H64 M54 3 L66 12 L54 21" stroke="rgba(226,223,194,.66)" strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <Img src={staticFile('wall/sam.png')} style={{ width: 68 * u, height: 68 * u, borderRadius: 34 * u, filter: 'brightness(.9)' }} />
          sam
        </div>
        <div style={{ fontSize: 360 * u, lineHeight: 0.92, letterSpacing: '-0.06em', fontVariantNumeric: 'tabular-nums', marginTop: 4 * u, ...rise(frame, T.info + 4, T.out + 1, 40 * u) }}>
          ${amount.toFixed(2)}
        </div>
        <div style={{ display: 'flex', marginTop: 44 * u }}>
          {stat(0, '0.6 s', 'to arrive')}
          {stat(1, '$0.00', 'fee, Kova pays it')}
          {stat(2, 'Monad', 'settled on')}
        </div>
      </div>

      {/* the real phone, upright inside the frame */}
      <div
        style={{
          position: 'absolute',
          left: 1700 * u,
          top: 190 * u,
          height: 620 * u,
          aspectRatio: '1179 / 2556',
          borderRadius: 52 * u,
          overflow: 'hidden',
          border: `${10 * u}px solid ${W.ink}`,
          boxShadow: `0 ${30 * u}px ${80 * u}px rgba(0,0,0,.35)`,
          ...rise(frame, T.info + 8, T.out + 2, 60 * u),
        }}
      >
        <Img src={staticFile('wall/c-040-done.jpg')} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(.86)' }} />
      </div>

      {/* the one idea */}
      <div style={{ position: 'absolute', left: 2170 * u, top: 230 * u, width: 600 * u, fontSize: 84 * u, lineHeight: 1.04, letterSpacing: '-0.035em' }}>
        <div style={rise(frame, T.info + 14, T.out + 2, 26 * u)}>a new wallet,</div>
        <div style={{ color: W.coral, ...rise(frame, T.info + 17, T.out + 3, 26 * u) }}>made for sam.</div>
        <div style={{ fontSize: 38 * u, fontWeight: 600, color: dim, lineHeight: 1.35, marginTop: 26 * u, letterSpacing: '-0.01em', ...rise(frame, T.info + 22, T.out + 4, 20 * u) }}>
          opens with face id.
          <br />
          nothing to install.
        </div>
      </div>

      {/* Kovi, sitting on the frame */}
      <Img
        src={staticFile('wall/kovi-cheer.png')}
        style={{
          position: 'absolute',
          left: 2470 * u,
          top: 612 * u,
          width: 300 * u,
          height: 300 * u,
          filter: 'brightness(.9)',
          transformOrigin: '50% 100%',
          opacity: frame >= T.kovi ? 1 - koviOut : 0,
          transform: `translateY(${(1 - kovi) * 160 * u + 6 * u * Math.sin((2 * Math.PI * frame) / (2 * BEAT))}px) scale(${0.6 + 0.4 * kovi}, ${0.6 + 0.4 * kovi + 0.06 * Math.sin((2 * Math.PI * frame) / (2 * BEAT))})`,
        }}
      />
    </AbsoluteFill>
  )
}

function clamp01(x: number) {
  return Math.min(1, Math.max(0, x))
}

function mix(a: string, b: string, k: number) {
  const pa = [1, 3, 5].map((i) => Number.parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map((i) => Number.parseInt(b.slice(i, i + 2), 16))
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * k)).join(',')})`
}

function Pill({ cx, cy, len, th, angle, opacity, color = W.cream }: { cx: number; cy: number; len: number; th: number; angle: number; opacity: number; color?: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: cx - len / 2,
        top: cy - th / 2,
        width: len,
        height: th,
        borderRadius: th / 2,
        background: color,
        opacity,
        transform: `rotate(${angle}deg)`,
      }}
    />
  )
}
