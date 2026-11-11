/**
 * "How Kova works", the founder's own take (IMG_9062: 96 s, 4K HLG, landscape) cut to 33 s at
 * 16:9 for X, YouTube and LinkedIn. The register is a native talker: his face, his voice, real
 * screens. The award layer (house title behind the subject, house captions, the Monad motif, a
 * diagram built on the words) sits on top and never replaces him.
 *
 * Footage: public/founder/aroll.mp4 (scripts/founder/aroll16.py), cut on speech from Apple's own
 * HDR→709 tone map in ProRes. Wides use the whole 4K frame, tights a 2880x1620 window on his face,
 * so every frame is downsampled (2x / 1.5x), never upscaled. The voice (public/founder/voice.wav)
 * is the same cut. Words: words.json (Whisper word times on the cut, his actual words). Screens are
 * real captures of Kova on Monad testnet, drawn at 0.9x their own pixels so the text reads.
 *
 * Type is Kova's own face, Manrope, in small letters, in the house colours red #E83425 and cream
 * #FAFAD8. The hook title rises word by word behind his head; spoken captions sit beside his head
 * in the open wall, small cream narration with the key word big in red, each word rising in as he
 * says it. Motion is subtle throughout: rises from a slight blur, soft dissolves, one light sweep.
 *
 * Layout: captions on whichever side of his head has more room (faces.json, his face every 0.1 s);
 * over a phone insert the phone takes the right and the captions the left column.
 */
import type React from 'react'
import { useEffect, useState } from 'react'
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  Easing,
  Html5Audio,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import { fontsReady } from '../theme'
import FACES from './faces.json'
import WORDS from './words.json'

export const FPS = 30
export const WIDTH = 1920
export const HEIGHT = 1080
const AROLL = 954
const END = 45
export const FOUNDER_DURATION = AROLL + END

const K = {
  ink: '#0B1A1D',
  paper: '#E7E5E0',
  surface: '#F1EFEA',
  coral: '#D46558',
  teal: '#2F6669',
  muted: '#4A5A5C',
  red: '#E83425',
  cream: '#FAFAD8',
  monad: '#836EF9',
  monadDeep: '#5B3FD9',
}
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const f = (s: number) => Math.round(s * FPS)
const ease = Easing.bezier(0.65, 0, 0.35, 1)


// ── The inserts, on the cut's own seconds ──────────────────────────────────────────────────
/** A screen, and where the camera looks on it (y in the screenshot's own pixels, 1179x2556). */
type Shot = { src: string; from: number; look: { at: number; y: number }[]; tap?: { at: number; x: number; y: number } }
type Insert =
  | { kind: 'monad'; from: number; to: number; label: string; big: string; line: string }
  | { kind: 'phone'; from: number; to: number; shots: Shot[] }
  | { kind: 'diagram'; from: number; to: number }

const INSERTS: Insert[] = [
  // "…a financial system on Monad." The chain's name gets its own beat (and covers a lean-in).
  { kind: 'monad', from: 5.08, to: 6.47, label: 'Kova runs', big: 'on Monad', line: 'Every payment settles in about a second.' },
  // "You sign in with passkeys and you get the wallet initiated." The real web claim flow.
  {
    kind: 'phone',
    from: 6.47,
    to: 10.1,
    shots: [
      { src: 'founder/screens/c-00-choose.jpg', from: 6.47, look: [{ at: 6.47, y: 760 }, { at: 7.0, y: 1420 }], tap: { at: 7.5, x: 0.5, y: 0.598 } },
      { src: 'founder/screens/c-001-faceid.jpg', from: 8.0, look: [{ at: 8.0, y: 1480 }] },
      { src: 'founder/screens/c-040-done.jpg', from: 8.8, look: [{ at: 8.8, y: 1640 }] },
    ],
  },
  // "Every time it's a transaction to a wallet…" One switch: send privately.
  {
    kind: 'phone',
    from: 12.55,
    to: 14.75,
    shots: [
      {
        src: 'founder/screens/05-app-router-picks-private.png',
        from: 12.55,
        look: [{ at: 12.55, y: 1080 }, { at: 13.2, y: 1880 }],
        tap: { at: 13.9, x: 0.5, y: 0.876 },
      },
    ],
  },
  // "…a new wallet has been attached to the receiver." Two real payments, two new addresses.
  { kind: 'diagram', from: 14.75, to: 19.3 },
  // "…as seamless as possible." The arrival, the new private receiving flow.
  {
    kind: 'phone',
    from: 20.8,
    to: 22.45,
    shots: [{ src: 'founder/screens/01-app-arrival-first-time.png', from: 20.8, look: [{ at: 20.8, y: 760 }, { at: 21.5, y: 1640 }] }],
  },
  // "…and everything settles on Monad." The motif returns, with the receipt's own numbers.
  { kind: 'monad', from: 22.45, to: 24.22, label: 'Settled', big: 'on Monad', line: 'Arrived in 0.6 s. Fee: $0.00, Kova pays it.' },
  // "…creating shops. They get a link they can share to their customers."
  {
    kind: 'phone',
    from: 26.1,
    to: 28.95,
    shots: [
      { src: 'founder/screens/09-till-paid.png', from: 26.1, look: [{ at: 26.1, y: 1480 }] },
      { src: 'founder/screens/stall-web.png', from: 27.15, look: [{ at: 27.15, y: 980 }], tap: { at: 27.86, x: 0.27, y: 0.521 } },
    ],
  },
]

const insertAt = (t: number) => INSERTS.find((i) => t >= i.from && t < i.to)

// ── Captions: 1–3 words a page, from the words' own times ──────────────────────────────────
type Word = { w: string; s: number; e: number }
const LITTLE = /^(a|an|the|to|of|and|is|on|in|with|for|as|we|we're|it's|they|you|that|can|has|been|have|don't|their|this|such|it)$/i
const PAGES = (() => {
  const words = (WORDS as Word[]).filter((w) => w.s >= 3.1) // the hook title carries 0–3.17 s
  const ends = (w: Word) => /[.,!?]$/.test(w.w)
  // The best split by cost: 2–3 words a page, short lines, a page never ends on a little word
  // ("…it's a") and never runs past a comma or full stop.
  const cost = (i: number, j: number) => {
    const ws = words.slice(i, j)
    if (ws.slice(0, -1).some(ends) || ws.length > 4) return Infinity
    const chars = ws.map((w) => w.w).join(' ').length
    const last = ws[ws.length - 1]
    let c = ws.length === 4 ? 3 : 0
    if (chars > 18) c += 4
    else if (chars > 15) c += 1
    if (!ends(last) && LITTLE.test(last.w)) c += 6
    if (ws.length === 1) c += LITTLE.test(last.w) ? 4 : 1.5
    return c
  }
  const best = [0]
  const from = [0]
  for (let j = 1; j <= words.length; j++) {
    best[j] = Infinity
    for (let i = Math.max(0, j - 4); i < j; i++) {
      const c = best[i] + cost(i, j)
      if (c < best[j]) [best[j], from[j]] = [c, i]
    }
  }
  const pages: Word[][] = []
  for (let j = words.length; j > 0; j = from[j]) pages.unshift(words.slice(from[j], j))
  // a page stays until the next begins (no flicker in short gaps), at least 0.35 s
  return pages.map((ws, i) => ({ ws, s: ws[0].s, until: Math.max(ws[0].s + 0.35, pages[i + 1]?.[0].s ?? ws[ws.length - 1].e + 0.3) }))
})()

// ── Caption placement: beside his head, on the side of the frame with more room ───────────
const FACE_ROWS = FACES as number[][] // [t, cx, cy, w, h], normalised to the 16:9 frame, every 0.1 s
const faceAt = (t: number) => FACE_ROWS.reduce((a, b) => (Math.abs(b[0] - t) < Math.abs(a[0] - t) ? b : a))
const KEY = /^(financial|system|monad|passkeys|wallet|initiated|private|payment|transaction|new|attached|receiver|control|seamless|possible|everything|settles|shops|link|share|customers|building|kova)/i
type Place = { left: number; top: number; width: number; align: 'left' | 'right' | 'center' }
/** Where a page sits: in the phone's free column, under the diagram, or in the open wall beside
 * his head, clear of everywhere his head goes while the page is up (head = face box widened). */
function placeFor(s: number, e: number): Place {
  const ins = insertAt(s)
  if (ins?.kind === 'phone') return { left: 130, top: 440, width: 560, align: 'left' }
  if (ins?.kind === 'diagram') return { left: 260, top: 790, width: 1400, align: 'center' }
  const rows = FACE_ROWS.filter((r) => r[0] >= s - 0.05 && r[0] <= e + 0.05)
  const span = rows.length ? rows : [faceAt(s)]
  const headL = Math.min(...span.map(([, cx, , w]) => (cx - 0.8 * w) * WIDTH))
  const headR = Math.max(...span.map(([, cx, , w]) => (cx + 0.8 * w) * WIDTH))
  const eyes = Math.min(...span.map(([, , cy, , h]) => (cy - 0.2 * h) * HEIGHT))
  const top = Math.min(Math.max(eyes, 170), HEIGHT - 330)
  const roomL = headL - 70 - 110
  const roomR = WIDTH - 110 - (headR + 70)
  return roomR >= roomL
    ? { left: headR + 70, top, width: Math.min(600, roomR), align: 'left' }
    : { left: Math.max(110, headL - 70 - Math.min(600, roomL)), top, width: Math.min(600, roomL), align: 'right' }
}

// ── The film ───────────────────────────────────────────────────────────────────────────────
export function FounderFilm() {
  const [handle] = useState(() => delayRender('fonts'))
  useEffect(() => {
    fontsReady.then(() => continueRender(handle))
  }, [handle])

  return (
    <AbsoluteFill style={{ background: K.ink, fontFamily: 'Manrope' }}>
      <Sequence durationInFrames={AROLL}>
        <OffthreadVideo src={staticFile('founder/aroll.mp4')} muted />
      </Sequence>

      <Sequence durationInFrames={f(3.17)}>
        <HookTitle />
        <AbsoluteFill>
          <OffthreadVideo src={staticFile('founder/hook-cutout.webm')} transparent muted />
        </AbsoluteFill>
      </Sequence>

      {INSERTS.map((ins) => (
        <Sequence key={`${ins.kind}${ins.from}`} from={f(ins.from)} durationInFrames={f(ins.to) - f(ins.from)}>
          <Dissolve frames={f(ins.to) - f(ins.from)}>
            <Blurred from={f(ins.from)} />
            {ins.kind === 'monad' ? <MonadCard {...ins} /> : null}
            {ins.kind === 'phone' ? <Phone shots={ins.shots} start={ins.from} /> : null}
            {ins.kind === 'diagram' ? <Diagram start={ins.from} /> : null}
          </Dissolve>
        </Sequence>
      ))}

      <Captions />

      <Sequence from={AROLL} durationInFrames={END}>
        <EndCard />
      </Sequence>

      <Html5Audio src={staticFile('founder/voice.wav')} />
      <Sfx />
    </AbsoluteFill>
  )
}

/** Inserts arrive and leave as a short soft dissolve (5 frames in, 4 out), never a hard flash. */
function Dissolve({ frames, children }: { frames: number; children: React.ReactNode }) {
  const frame = useCurrentFrame()
  const o = interpolate(frame, [0, 5, frames - 4, frames], [0, 1, 1, 0], { ...clamp, easing: Easing.inOut(Easing.quad) })
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>
}

/** The room itself, blurred and dimmed: the ground for every insert (never a flat gradient). */
function Blurred({ from }: { from: number }) {
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <OffthreadVideo
        src={staticFile('founder/aroll.mp4')}
        startFrom={from}
        muted
        style={{ transform: 'scale(1.12)', filter: 'blur(40px) brightness(0.5) saturate(0.9)' }}
      />
    </AbsoluteFill>
  )
}

/** A word arriving: up 16 px, from a 6 px blur, over 7 frames. The only motion the type has. */
const rise = (frame: number, at: number, dist = 16) => {
  const k = interpolate(frame - at, [0, 7], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })
  return { opacity: k, transform: `translateY(${(1 - k) * dist}px)`, filter: `blur(${(1 - k) * 6}px)` }
}

/** The title: Kova's own face (Manrope ExtraBold) in small letters, red then cream, each line set
 * to the same width, word by word on the voice, behind his head. */
function HookTitle() {
  const frame = useCurrentFrame()
  const word = (text: string, s: number, color: string) => (
    <span style={{ display: 'inline-block', whiteSpace: 'pre', color, ...rise(frame, f(s), 26) }}>{text}</span>
  )
  const line = {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    fontFamily: 'Manrope',
    fontWeight: 800,
    lineHeight: 0.92,
    letterSpacing: '-0.045em',
    textShadow: '0 4px 30px rgba(0,0,0,.3)',
  } as const
  return (
    <AbsoluteFill>
      <div style={{ ...line, top: 140, fontSize: 161 }}>
        {word('every ', 0.12, K.red)}
        {word('payment', 0.28, K.red)}
      </div>
      <div style={{ ...line, top: 140 + 150, fontSize: 197 }}>
        {word('a new ', 1.12, K.cream)}
        {word('wallet', 1.6, K.cream)}
      </div>
    </AbsoluteFill>
  )
}

/** Small letters; names keep their capital. */
const lower = (w: string) => (/^(kova|monad)/i.test(w) ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())

/** Spoken captions in Kova's face: small cream narration, and the page's key word big in red on
 * its own line. Each word rises in as he says it; the page lifts away as the next begins. They sit
 * in the open wall beside his head (or in the phone's free column), wherever the shot leaves room. */
function Captions() {
  const frame = useCurrentFrame()
  const t = frame / FPS
  if (frame >= AROLL) return null
  const ins = insertAt(t)
  if (ins?.kind === 'monad') return null // the card says it
  const page = PAGES.find((p) => t >= p.s - 0.04 && t < p.until)
  if (!page) return null
  const keyIdx = page.ws.map((w) => KEY.test(w.w)).lastIndexOf(true)
  // a page that crosses into or out of an insert is placed for the part we are in now
  const inIns = insertAt(t)
  const s0 = inIns ? Math.max(page.s, inIns.from) : Math.max(page.s, ...INSERTS.filter((i) => i.to <= t + 1e-6).map((i) => i.to))
  const e0 = inIns ? Math.min(page.until, inIns.to) : Math.min(page.until, ...INSERTS.filter((i) => i.from > t).map((i) => i.from))
  const pl = placeFor(s0, e0)
  const out = interpolate(frame, [f(page.until) - 4, f(page.until)], [1, 0], clamp)
  const before = keyIdx >= 0 ? page.ws.slice(0, keyIdx) : page.ws
  const lines: Word[][] = keyIdx >= 0 ? [before, [page.ws[keyIdx]], page.ws.slice(keyIdx + 1)] : [page.ws]
  const justify = pl.align === 'left' ? 'flex-start' : pl.align === 'right' ? 'flex-end' : 'center'
  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: pl.left - 90,
          top: pl.top - 70,
          width: pl.width + 180,
          height: 340,
          opacity: out * 0.9,
          background: `radial-gradient(ellipse at ${pl.align === 'left' ? '30%' : pl.align === 'right' ? '70%' : '50%'} 45%, rgba(0,0,0,.5), rgba(0,0,0,0) 70%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: pl.left,
          top: pl.top,
          width: pl.width,
          display: 'flex',
          flexDirection: 'column',
          alignItems: justify,
          gap: 4,
          opacity: out,
          transform: `translateY(${(1 - out) * -8}px)`,
          fontWeight: 800,
          color: K.cream,
          textShadow: '0 1px 2px rgba(0,0,0,.45), 0 2px 10px rgba(0,0,0,.45), 0 6px 30px rgba(0,0,0,.6)',
        }}
      >
        {lines
          .filter((l) => l.length)
          .map((l, li) => {
            const big = keyIdx >= 0 && l[0] === page.ws[keyIdx]
            return (
              <div
                key={l[0].s}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: justify,
                  columnGap: '0.26em',
                  fontSize: big ? 100 : 58,
                  lineHeight: big ? 1.0 : 1.12,
                  letterSpacing: big ? '-0.045em' : '-0.02em',
                  color: big ? K.red : K.cream,
                  marginTop: big && li > 0 ? -2 : 0,
                }}
              >
                {l.map((w) => (
                  <span key={w.s} style={{ display: 'inline-block', ...rise(frame, f(w.s) - 1) }}>
                    {lower(w.w.replace(/[.,]$/, ''))}
                  </span>
                ))}
              </div>
            )
          })}
      </div>
    </AbsoluteFill>
  )
}

/** The Monad beat: Monad's purple, the chain's name, one real number. */
function MonadCard({ label, big, line }: { label: string; big: string; line: string }) {
  const frame = useCurrentFrame()
  const k = interpolate(frame, [0, 10], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })
  // one slow band of light across the card, once
  const sweep = interpolate(frame, [8, 30], [-40, 140], { ...clamp, easing: Easing.inOut(Easing.quad) })
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          position: 'relative',
          overflow: 'hidden',
          width: 1180,
          padding: '70px 84px 72px',
          borderRadius: 60,
          background: `linear-gradient(160deg, ${K.monad} 0%, ${K.monadDeep} 100%)`,
          color: '#fff',
          transform: `translateY(${(1 - k) * 24}px) scale(${0.97 + 0.03 * k})`,
          boxShadow: '0 40px 100px rgba(20, 8, 60, .4)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `linear-gradient(105deg, transparent ${sweep - 18}%, rgba(255,255,255,.16) ${sweep}%, transparent ${sweep + 18}%)`,
          }}
        />
        <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,.82)', ...rise(frame, 2) }}>{label}</div>
        <div style={{ marginTop: 6, fontSize: 210, fontWeight: 800, letterSpacing: '-0.05em', lineHeight: 1, ...rise(frame, 5, 22) }}>{big}</div>
        <div style={{ marginTop: 30, fontSize: 52, fontWeight: 700, lineHeight: 1.25, color: 'rgba(255,255,255,.92)', ...rise(frame, 9) }}>{line}</div>
      </div>
    </AbsoluteFill>
  )
}

/** The phone, big on the right at 0.9x the screen's own pixels so its text reads; the camera pans
 * to what he is talking about, with a hand-held drift (incommensurate sines). */
const SCALE = 0.9
const SW = Math.round(1179 * SCALE)
const SH = Math.round(2556 * SCALE)
const BEZEL = 22
function Phone({ shots, start }: { shots: Shot[]; start: number }) {
  const frame = useCurrentFrame()
  const t = frame / FPS
  const now = start + t
  const enter = interpolate(frame, [0, 9], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })
  const dx = 3 * Math.sin(2 * Math.PI * 0.37 * t) + 2 * Math.sin(2 * Math.PI * 0.91 * t + 1)
  const dy = 2.5 * Math.sin(2 * Math.PI * 0.53 * t + 2) + 1.5 * Math.sin(2 * Math.PI * 1.21 * t)
  const rot = 0.25 * Math.sin(2 * Math.PI * 0.29 * t + 0.5) + 0.15 * Math.sin(2 * Math.PI * 0.83 * t)
  const shot = [...shots].reverse().find((s) => now >= s.from) ?? shots[0]
  // where the camera looks: each look eases in over 0.5 s from the one before
  let look = shot.look[0].y
  for (let i = 1; i < shot.look.length; i++) {
    const k = interpolate(now, [shot.look[i].at, shot.look[i].at + 0.5], [0, 1], { ...clamp, easing: ease })
    look = look + (shot.look[i].y - look) * k
  }
  const top = Math.min(70, Math.max(HEIGHT - 70 - SH, HEIGHT / 2 - look * SCALE))
  const left = WIDTH - SW - 2 * BEZEL - 90
  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left,
          top: top - BEZEL,
          width: SW + 2 * BEZEL,
          height: SH + 2 * BEZEL,
          padding: BEZEL,
          borderRadius: 150,
          background: K.ink,
          boxShadow: '0 50px 120px rgba(0,0,0,.5)',
          transform: `translate(${dx + (1 - enter) * 900}px, ${dy}px) rotate(${rot}deg)`,
        }}
      >
        <div style={{ position: 'relative', width: SW, height: SH, borderRadius: 130, overflow: 'hidden', background: '#fff' }}>
          <Img src={staticFile(shot.src)} style={{ width: SW, height: SH, display: 'block' }} />
          {shot.tap ? <Tap at={shot.tap.at - now + t} x={shot.tap.x * SW} y={shot.tap.y * SH} t={t} /> : null}
        </div>
      </div>
    </AbsoluteFill>
  )
}

/** A tap: a soft dot that lands and fades (about 280 ms). */
function Tap({ at, x, y, t }: { at: number; x: number; y: number; t: number }) {
  const k = (t - at) / 0.28
  if (k < 0 || k > 1) return null
  return (
    <div
      style={{
        position: 'absolute',
        left: x - 50,
        top: y - 50,
        width: 100,
        height: 100,
        borderRadius: 50,
        background: 'rgba(11,26,29,.28)',
        border: '4px solid rgba(255,255,255,.9)',
        transform: `scale(${0.8 + 0.25 * k})`,
        opacity: 1 - k,
      }}
    />
  )
}

/** Two real payments, two brand-new addresses, one owner. Built on the words, left to right. */
function Diagram({ start }: { start: number }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const at = (s: number) => spring({ frame: frame - f(s - start), fps, config: { damping: 16, stiffness: 240, mass: 0.6 } })
  const ada = at(start)
  const c1 = at(14.96) // "new"
  const c2 = at(16.42) // "attached"
  const sam = at(17.44) // "receiver"
  const chip = (n: number, addr: string, p: number) => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: 680,
        padding: '28px 36px',
        borderRadius: 32,
        background: '#fff',
        border: `3px solid ${K.ink}`,
        transform: `scale(${0.85 + 0.15 * p}) translateY(${(1 - p) * 30}px)`,
        opacity: p,
      }}
    >
      <div>
        <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: '0.1em', color: K.teal }}>PAYMENT {n} · $0.50</div>
        <div style={{ marginTop: 6, fontSize: 66, fontWeight: 800, letterSpacing: '-0.03em', color: K.ink, fontVariantNumeric: 'tabular-nums' }}>{addr}</div>
      </div>
      <div style={{ fontSize: 30, fontWeight: 800, color: '#fff', background: K.coral, borderRadius: 999, padding: '10px 22px' }}>new</div>
    </div>
  )
  const person = (src: string, p: number) => (
    <Img src={staticFile(src)} style={{ width: 170, height: 170, borderRadius: 85, transform: `scale(${0.85 + 0.15 * p})`, opacity: p }} />
  )
  return (
    <AbsoluteFill style={{ alignItems: 'center' }}>
      <div
        style={{
          position: 'absolute',
          top: 90,
          width: 1760,
          height: 660,
          borderRadius: 60,
          background: K.surface,
          boxShadow: '0 40px 100px rgba(0,0,0,.45)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 70px',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, width: 300 }}>
          {person('founder/ada.png', ada)}
          <div style={{ fontSize: 54, fontWeight: 800, color: K.ink, opacity: ada }}>Ada pays</div>
          <div style={{ fontSize: 42, fontWeight: 700, color: K.muted, opacity: ada }}>twice</div>
        </div>
        <Arrow p={c1} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 34 }}>
          {chip(1, '0xd793…989b', c1)}
          {chip(2, '0x567a…5Fc4', c2)}
        </div>
        <Arrow p={sam} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, width: 300 }}>
          <div style={{ position: 'relative' }}>
            {person('founder/sam.png', sam)}
            <div
              style={{
                position: 'absolute',
                right: -12,
                bottom: -6,
                width: 72,
                height: 72,
                borderRadius: 36,
                background: K.coral,
                display: 'grid',
                placeItems: 'center',
                fontSize: 38,
                opacity: sam,
                transform: `scale(${sam})`,
              }}
            >
              🔒
            </div>
          </div>
          <div style={{ fontSize: 54, fontWeight: 800, color: K.ink, opacity: sam }}>Both Sam’s</div>
          <div style={{ fontSize: 36, fontWeight: 700, color: K.muted, opacity: sam, textAlign: 'center', lineHeight: 1.25 }}>Only his keys open them</div>
        </div>
      </div>
    </AbsoluteFill>
  )
}

function Arrow({ p }: { p: number }) {
  return (
    <svg width={110} height={40} viewBox="0 0 110 40" style={{ opacity: Math.min(1, p * 3) }}>
      <path d="M4 20 H96 M80 6 L98 20 L80 34" stroke={K.ink} strokeWidth={6} fill="none" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />
    </svg>
  )
}

/** The end: Kova, Kovi, and one thing to do. */
function EndCard() {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const pop = spring({ frame, fps, config: { damping: 14, stiffness: 200, mass: 0.6 } })
  return (
    <AbsoluteFill style={{ background: K.paper, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 90 }}>
      <Img src={staticFile('founder/kovi-cheer.png')} style={{ width: 420, height: 420, transform: `scale(${0.8 + 0.2 * pop})`, opacity: Math.min(1, pop * 2) }} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 34 }}>
        <Img src={staticFile('founder/kova-logo.png')} style={{ height: 130, ...rise(frame, 1) }} />
        <div style={{ fontSize: 76, fontWeight: 800, color: K.ink, letterSpacing: '-0.03em', ...rise(frame, 4) }}>Kova for iOS is in beta</div>
        <div style={{ fontSize: 52, fontWeight: 800, color: '#fff', background: K.ink, borderRadius: 999, padding: '22px 46px', ...rise(frame, 7) }}>mykova.app/waitlist</div>
      </div>
    </AbsoluteFill>
  )
}

/** Sound only on reveals and taps; the voice carries everything else. */
function Sfx() {
  const cues: { at: number; src: string; volume: number }[] = [
    { at: 5.06, src: 'audio/sfx/whoosh-real.wav', volume: 0.16 },
    { at: 6.45, src: 'audio/sfx/whoosh-real.wav', volume: 0.12 },
    { at: 7.5, src: 'audio/kenney/card-place-1.ogg', volume: 0.18 },
    { at: 12.53, src: 'audio/sfx/whoosh-real.wav', volume: 0.16 },
    { at: 13.9, src: 'audio/kenney/card-place-2.ogg', volume: 0.18 },
    { at: 14.96, src: 'audio/sfx/pop.mp3', volume: 0.14 },
    { at: 16.42, src: 'audio/sfx/pop.mp3', volume: 0.14 },
    { at: 17.44, src: 'private/sfx/lock.mp3', volume: 0.24 },
    { at: 20.78, src: 'audio/sfx/whoosh-real.wav', volume: 0.16 },
    { at: 26.08, src: 'audio/sfx/whoosh-real.wav', volume: 0.16 },
    { at: 27.86, src: 'audio/kenney/card-place-3.ogg', volume: 0.18 },
    { at: 31.8, src: 'audio/sfx/chime.mp3', volume: 0.26 },
  ]
  return (
    <>
      {cues.map((c) => (
        <Sequence key={`${c.at}${c.src}`} from={f(c.at)} durationInFrames={60}>
          <Html5Audio src={staticFile(c.src)} volume={c.volume} />
        </Sequence>
      ))}
    </>
  )
}
