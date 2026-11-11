/**
 * "Build cool stuff with AI" (ugc 1): his 2:43 talk to camera cut to 59 s at 16:9, his own grade
 * untouched. Native talker register with an award layer that only ever explains what he says.
 *
 * Footage: public/ugc1/aroll.mp4 (scripts/ugc1/aroll.py) from the 4K original: wides are the whole
 * frame (2x down), tights a 2880x1620 window on his face (1.5x down), alternating at every cut so the
 * jump cuts read as camera changes. Voice: the same cut. Words: words.json (his own timings, three
 * mis-hearings fixed: "steal", "Kleon", "test").
 *
 * Type: Manrope (house brand face), small letters, red #E83425 and cream #FAFAD8. The hook title
 * sits behind his head. Captions sit in the open wall beside his head (faces.json), small cream
 * narration with one key word big in red; words rise in as he says them.
 *
 * Inserts, each motivated by the line it sits on: "limits" struck through on "cut it"; "x10" on
 * "times by 10"; real screenshots flying into an agent on "references"; the ffmpeg command, his own
 * clip breaking into 24 frames and flicking back into motion on "videos are just moving pictures";
 * the book named on "a book I really like"; things joining into one on "join a lot of other things";
 * a Kova phone then mykova.app on "mobile apps to websites"; a user counter 10 -> 100; a message
 * bubble on "test your product"; follow. Music: ElevenLabs bed (100 BPM), ducked under his voice.
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
import DUCK from './duck.json'
import FACES from './faces.json'
import WORDS from './words.json'

export const FPS = 25
export const WIDTH = 1920
export const HEIGHT = 1080
const AROLL = 1486
const END = 45
export const UGC_DURATION = AROLL + END

const K = { ink: '#0B1A1D', red: '#E83425', cream: '#FAFAD8', paper: '#E7E5E0', teal: '#2F6669', coral: '#D46558' }
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const f = (s: number) => Math.round(s * FPS)
type Word = { w: string; s: number; e: number }
const WS = WORDS as Word[]
/** The start of the word nearest `near` that matches (so cues follow his actual timing). */
const at = (word: string, near: number) => {
  const c = WS.filter((w) => w.w.toLowerCase().replace(/[^a-z0-9]/g, '') === word)
  return c.reduce((a, b) => (Math.abs(b.s - near) < Math.abs(a.s - near) ? b : a)).s
}

// ── cues, all on his words ─────────────────────────────────────────────────────────────────
const C = {
  limits: at('limits', 6.2),
  cut: at('cut', 9.4),
  times: at('times', 13.9),
  ten: at('10', 14.9),
  refs: at('references', 17.5),
  shot: at('screenshot', 18.4),
  video: at('video', 19.2),
  process: at('process', 20.2),
  agents: at('agents', 21.5),
  ffmpeg: at('ffmpeg', 23.7),
  breaks: at('breaks', 25.4),
  videos: at('videos', 28.7),
  pictures: at('pictures', 30.5),
  book: at('book', 36.4),
  join: at('join', 41.1),
  newEnd: at('new', 43.4),
  from: at('from', 47.0),
  mobile: at('mobile', 47.2),
  websites: at('websites', 48.1),
  ten2: at('10', 52.7),
  hundred: at('100', 54.4),
  test: at('test', 56.9),
  follow: at('follow', 58.5),
}

type Insert = { id: string; from: number; to: number }
const INSERTS: Insert[] = [
  { id: 'refs', from: C.refs - 0.1, to: C.agents + 0.55 },
  { id: 'ffmpeg', from: C.ffmpeg - 0.12, to: C.pictures + 0.42 },
  { id: 'book', from: C.book - 0.1, to: C.book + 2.5 },
  { id: 'builds', from: C.from - 0.08, to: C.websites + 0.7 },
]
const insertAt = (t: number) => INSERTS.find((i) => t >= i.from && t < i.to)

// ── caption pages: the best split of his words into 1-3 word pages ───────────────────────────
const LITTLE = /^(a|an|the|to|of|and|is|on|in|with|for|as|we|it's|they|you|that|can|has|been|have|don't|their|this|such|it|i|i'll|your|which|what|or|if|by|be|at)$/i
const KEY = /^(imagine|build|ai|limits|cut|10|100|references|screenshot|video|agents|agent|ffmpeg|pictures|moving|videos|book|artist|kleon|new|sun|apps|websites|market|users|user|test|product|follow|join|engineer|stuff|stuffs|cool)$/i
const PAGES = (() => {
  const words = WS.filter((w) => w.s >= 2.3) // the hook title carries the first line
  const clean = (w: Word) => w.w.toLowerCase().replace(/[^a-z0-9']/g, '')
  const ends = (w: Word) => /[.,!?]$/.test(w.w)
  const cost = (i: number, j: number) => {
    const ws = words.slice(i, j)
    if (ws.slice(0, -1).some(ends) || ws.length > 4) return Number.POSITIVE_INFINITY
    if (ws[ws.length - 1].e - ws[0].s > 2.2) return 50 // a page shouldn't hang on through a long pause
    const chars = ws.map((w) => w.w).join(' ').length
    const last = ws[ws.length - 1]
    let c = ws.length === 4 ? 3 : 0
    if (chars > 18) c += 4
    else if (chars > 15) c += 1
    if (!ends(last) && LITTLE.test(clean(last))) c += 6
    if (ws.length === 1) c += LITTLE.test(clean(last)) ? 9 : 1.5
    return c
  }
  const best = [0]
  const from = [0]
  for (let j = 1; j <= words.length; j++) {
    best[j] = Number.POSITIVE_INFINITY
    for (let i = Math.max(0, j - 4); i < j; i++) {
      const c = best[i] + cost(i, j)
      if (c < best[j]) [best[j], from[j]] = [c, i]
    }
  }
  const pages: Word[][] = []
  for (let j = words.length; j > 0; j = from[j]) pages.unshift(words.slice(from[j], j))
  return pages.map((ws, i) => ({ ws, s: ws[0].s, until: Math.min(Math.max(ws[0].s + 0.4, pages[i + 1]?.[0].s ?? ws[ws.length - 1].e + 0.3), ws[ws.length - 1].e + 0.9) }))
})()

// ── caption placement: beside his head, on the side with room, clear of it all page long ──────
const FACE_ROWS = FACES as number[][]
const faceAt = (t: number) => FACE_ROWS.reduce((a, b) => (Math.abs(b[0] - t) < Math.abs(a[0] - t) ? b : a))
type Place = { left: number; top: number; width: number; align: 'left' | 'right' | 'center' }
function placeFor(s: number, e: number): Place {
  if (insertAt(s)) return { left: 260, top: 860, width: 1400, align: 'center' }
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
/** Where the caption on screen at t sits (the same rule the captions use). */
function captionSide(t: number): 'left' | 'right' | 'center' {
  const page = PAGES.find((p) => t >= p.s - 0.04 && t < p.until) ?? PAGES.reduce((a, b) => (Math.abs(b.s - t) < Math.abs(a.s - t) ? b : a))
  const inIns = insertAt(t)
  const s0 = inIns ? Math.max(page.s, inIns.from) : Math.max(page.s, ...INSERTS.filter((i) => i.to <= t + 1e-6).map((i) => i.to))
  const e0 = inIns ? Math.min(page.until, inIns.to) : Math.min(page.until, ...INSERTS.filter((i) => i.from > t).map((i) => i.from))
  return placeFor(s0, e0).align
}
/** Stickers go on the side opposite the captions, above eye height. */
function stickerSpot(t: number) {
  const [, cx, cy, w, h] = faceAt(t)
  const capRight = captionSide(t) === 'left' // captions left-aligned = they sit right of his head
  const x = capRight ? Math.max(140, (cx - 0.8 * w) * WIDTH - 520) : Math.min(WIDTH - 560, (cx + 0.8 * w) * WIDTH + 60)
  return { x, y: Math.max(120, (cy - 0.45 * h) * HEIGHT - 60) }
}

// ── the film ─────────────────────────────────────────────────────────────────────────────────
export function UgcFilm() {
  const [handle] = useState(() => delayRender('fonts'))
  useEffect(() => {
    fontsReady.then(() => continueRender(handle))
  }, [handle])
  return (
    <AbsoluteFill style={{ background: K.ink, fontFamily: 'Manrope' }}>
      <Sequence durationInFrames={AROLL}>
        <OffthreadVideo src={staticFile('ugc1/aroll.mp4')} muted />
      </Sequence>

      <Sequence durationInFrames={f(2.32)}>
        <HookTitle />
        <AbsoluteFill>
          <OffthreadVideo src={staticFile('ugc1/hook-cutout.webm')} transparent muted />
        </AbsoluteFill>
      </Sequence>

      {/* stickers on the face shots */}
      <Sequence from={f(C.cut - 0.6)} durationInFrames={f(C.cut + 0.9) - f(C.cut - 0.6)}>
        <Strike at={C.cut - 0.6} cut={C.cut} />
      </Sequence>
      <Sequence from={f(C.times - 0.06)} durationInFrames={f(C.ten + 0.75) - f(C.times - 0.06)}>
        <Times start={C.times - 0.06} ten={C.ten} />
      </Sequence>
      <Sequence from={f(C.join - 0.1)} durationInFrames={f(C.newEnd + 0.6) - f(C.join - 0.1)}>
        <Join start={C.join - 0.1} done={C.newEnd} />
      </Sequence>
      <Sequence from={f(C.ten2 - 0.3)} durationInFrames={f(C.hundred + 0.9) - f(C.ten2 - 0.3)}>
        <Counter start={C.ten2 - 0.3} ten={C.ten2} hundred={C.hundred} />
      </Sequence>
      <Sequence from={f(C.test - 0.1)} durationInFrames={f(C.follow - 0.15) - f(C.test - 0.1)}>
        <Bubble start={C.test - 0.1} />
      </Sequence>
      <Sequence from={f(C.follow - 0.1)} durationInFrames={AROLL - f(C.follow - 0.1)}>
        <Follow />
      </Sequence>

      {/* full-frame inserts */}
      {INSERTS.map((ins) => (
        <Sequence key={ins.id} from={f(ins.from)} durationInFrames={f(ins.to) - f(ins.from)}>
          <Dissolve frames={f(ins.to) - f(ins.from)}>
            <Blurred from={f(ins.from)} />
            {ins.id === 'refs' ? <Refs start={ins.from} /> : null}
            {ins.id === 'ffmpeg' ? <Ffmpeg start={ins.from} /> : null}
            {ins.id === 'book' ? <Book /> : null}
            {ins.id === 'builds' ? <Builds start={ins.from} /> : null}
          </Dissolve>
        </Sequence>
      ))}

      <Captions />

      <Sequence from={AROLL} durationInFrames={END}>
        <EndCard />
      </Sequence>

      <Html5Audio src={staticFile('ugc1/voice.wav')} />
      <Music />
      <Sfx />
    </AbsoluteFill>
  )
}

function Dissolve({ frames, children }: { frames: number; children: React.ReactNode }) {
  const frame = useCurrentFrame()
  const o = interpolate(frame, [0, 4, frames - 4, frames], [0, 1, 1, 0], { ...clamp, easing: Easing.inOut(Easing.quad) })
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>
}

/** His room, blurred and dimmed: the ground for every insert. */
function Blurred({ from }: { from: number }) {
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <OffthreadVideo src={staticFile('ugc1/aroll.mp4')} startFrom={from} muted style={{ transform: 'scale(1.12)', filter: 'blur(42px) brightness(0.42) saturate(0.85)' }} />
    </AbsoluteFill>
  )
}

/** Arriving: up, from a slight blur. */
const rise = (frame: number, at: number, dist = 16, dur = 7) => {
  const k = interpolate(frame - at, [0, dur], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })
  return { opacity: k, transform: `translateY(${(1 - k) * dist}px)`, filter: `blur(${(1 - k) * 6}px)` }
}
const pop = (frame: number, at: number, fps: number) => spring({ frame: frame - at, fps, config: { damping: 11, stiffness: 240, mass: 0.55 } })
const lower = (w: string) => w.toLowerCase().replace(/^ai$/, 'AI').replace(/^ffmpeg/, 'ffmpeg').replace(/^kleon/, 'Kleon').replace(/^austin/, 'Austin')

/** The title, behind his head: red line, cream line, words rising in on his voice. */
function HookTitle() {
  const frame = useCurrentFrame()
  const word = (text: string, s: number, color: string) => <span style={{ display: 'inline-block', whiteSpace: 'pre', color, ...rise(frame, f(s), 26) }}>{text}</span>
  const line = { position: 'absolute', left: 0, right: 0, textAlign: 'center', fontFamily: 'Manrope', fontWeight: 800, lineHeight: 0.92, letterSpacing: '-0.045em', textShadow: '0 4px 30px rgba(0,0,0,.3)' } as const
  // each line fitted to 1240 px (9.215 em / 7.07 em measured)
  return (
    <AbsoluteFill>
      <div style={{ ...line, top: 120, fontSize: 134 }}>
        {word('if you can ', 0.0, K.red)}
        {word('imagine it,', at('imagine', 0.4), K.red)}
      </div>
      <div style={{ ...line, top: 120 + 128, fontSize: 175 }}>
        {word('you can ', at('you', 1.0), K.cream)}
        {word('build it.', at('build', 1.7), K.cream)}
      </div>
    </AbsoluteFill>
  )
}

/** Captions: small cream narration, one key word big in red, beside his head. */
function Captions() {
  const frame = useCurrentFrame()
  const t = frame / FPS
  if (frame >= AROLL) return null
  if ((t >= C.times - 0.06 && t < C.ten + 0.75) || (t >= C.ten2 - 0.3 && t < C.hundred + 0.9)) return null // the sticker says it
  const page = PAGES.find((p) => t >= p.s - 0.04 && t < p.until)
  if (!page) return null
  const keyIdx = page.ws.map((w) => KEY.test(w.w.toLowerCase().replace(/[^a-z0-9]/g, ''))).lastIndexOf(true)
  const inIns = insertAt(t)
  const s0 = inIns ? Math.max(page.s, inIns.from) : Math.max(page.s, ...INSERTS.filter((i) => i.to <= t + 1e-6).map((i) => i.to))
  const e0 = inIns ? Math.min(page.until, inIns.to) : Math.min(page.until, ...INSERTS.filter((i) => i.from > t).map((i) => i.from))
  const pl = placeFor(s0, e0)
  const out = interpolate(frame, [f(page.until) - 3, f(page.until)], [1, 0], clamp)
  const lines: Word[][] = keyIdx >= 0 ? [page.ws.slice(0, keyIdx), [page.ws[keyIdx]], page.ws.slice(keyIdx + 1)] : [page.ws]
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
          .map((l) => {
            const big = keyIdx >= 0 && l[0] === page.ws[keyIdx]
            return (
              <div
                key={l[0].s}
                style={{ display: 'flex', flexWrap: 'wrap', justifyContent: justify, columnGap: '0.26em', fontSize: big ? 100 : 58, lineHeight: big ? 1.0 : 1.12, letterSpacing: big ? '-0.045em' : '-0.02em', color: big ? K.red : K.cream }}
              >
                {l.map((w) => (
                  <span key={w.s} style={{ display: 'inline-block', ...rise(frame, f(w.s) - 1) }}>
                    {lower(w.w.replace(/[.,?]$/, ''))}
                  </span>
                ))}
              </div>
            )
          })}
      </div>
    </AbsoluteFill>
  )
}

// ── stickers ────────────────────────────────────────────────────────────────────────────────
const pill = { display: 'inline-flex', alignItems: 'center', gap: 14, padding: '16px 30px', borderRadius: 999, background: 'rgba(250,250,216,.96)', color: K.ink, fontWeight: 800, fontSize: 46, letterSpacing: '-0.02em', boxShadow: '0 12px 36px rgba(0,0,0,.25)' } as const

/** "limits", struck through on "cut it". */
function Strike({ at: start, cut }: { at: number; cut: number }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const p = pop(frame, 0, fps)
  const line = interpolate(frame, [f(cut - start), f(cut - start) + 5], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })
  const { x, y } = stickerSpot(start + 1)
  return (
    <div style={{ position: 'absolute', left: x, top: y, transform: `scale(${0.7 + 0.3 * p}) rotate(-3deg)`, opacity: Math.min(1, p * 2) }}>
      <div style={{ ...pill, position: 'relative', fontSize: 60 }}>
        limits
        <div style={{ position: 'absolute', left: 18, right: 18, top: '50%', height: 9, borderRadius: 5, background: K.red, transform: `scaleX(${line})`, transformOrigin: 'left center' }} />
      </div>
    </div>
  )
}

/** "× 10": the sign on "times", the number on "10". */
function Times({ start, ten }: { start: number; ten: number }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const a = pop(frame, 0, fps)
  const b = pop(frame, f(ten - start), fps)
  const { x, y } = stickerSpot(start)
  return (
    <div style={{ position: 'absolute', left: x, top: y - 40, display: 'flex', alignItems: 'baseline', fontWeight: 800, letterSpacing: '-0.06em', textShadow: '0 8px 40px rgba(0,0,0,.45)' }}>
      <span style={{ fontSize: 170, color: K.cream, transform: `scale(${0.6 + 0.4 * a})`, opacity: Math.min(1, a * 2), display: 'inline-block' }}>×</span>
      <span style={{ fontSize: 240, color: K.red, transform: `scale(${0.5 + 0.5 * b})`, opacity: Math.min(1, b * 2), display: 'inline-block', marginLeft: 10 }}>10</span>
    </div>
  )
}

/** Three things move together and become one new thing. */
function Join({ start, done }: { start: number; done: number }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const k = interpolate(frame, [4, f(done - start)], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) })
  const merged = pop(frame, f(done - start), fps)
  const { x, y } = stickerSpot(start + 1)
  const items = [
    { c: K.red, a: -1 },
    { c: K.cream, a: 0 },
    { c: '#7FB8B0', a: 1 },
  ]
  const appear = (i: number) => pop(frame, i * 4, fps)
  return (
    <div style={{ position: 'absolute', left: x, top: y + 20, width: 460, height: 180 }}>
      {items.map((it, i) => (
        <div
          key={it.c}
          style={{
            position: 'absolute',
            left: 200 + it.a * 150 * (1 - k) - 40,
            top: 50,
            width: 80,
            height: 80,
            borderRadius: 40,
            background: it.c,
            opacity: (1 - merged) * Math.min(1, appear(i) * 2),
            transform: `scale(${appear(i)})`,
            boxShadow: '0 10px 30px rgba(0,0,0,.3)',
          }}
        />
      ))}
      <div style={{ position: 'absolute', left: 90, top: 40, opacity: merged, transform: `scale(${0.6 + 0.4 * merged})` }}>
        <div style={{ ...pill, fontSize: 62, background: K.red, color: K.cream }}>✦ new</div>
      </div>
    </div>
  )
}

/** A user counter: 0 → 10 on "10", → 100 on "100". */
function Counter({ start, ten, hundred }: { start: number; ten: number; hundred: number }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = start + frame / FPS
  const n1 = interpolate(t, [ten - 0.05, ten + 0.35], [0, 10], { ...clamp, easing: Easing.out(Easing.cubic) })
  const n2 = interpolate(t, [hundred - 0.05, hundred + 0.45], [0, 90], { ...clamp, easing: Easing.out(Easing.cubic) })
  const n = Math.round(n1 + n2)
  const p = pop(frame, 0, fps)
  const bump = t > hundred ? pop(frame, f(hundred - start), fps) : 1
  const { x, y } = stickerSpot(start)
  return (
    <div style={{ position: 'absolute', left: x, top: y - 20, transform: `scale(${(0.7 + 0.3 * p) * (0.92 + 0.08 * bump)})`, opacity: Math.min(1, p * 2), transformOrigin: 'left top' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '20px 34px', borderRadius: 34, background: 'rgba(11,26,29,.88)', boxShadow: '0 16px 50px rgba(0,0,0,.35)' }}>
        <div style={{ fontSize: 120, fontWeight: 800, color: K.cream, letterSpacing: '-0.05em', fontVariantNumeric: 'tabular-nums', minWidth: 210, textAlign: 'right' }}>{n}</div>
        <div style={{ fontSize: 46, fontWeight: 800, color: K.red, lineHeight: 1 }}>
          first
          <br />
          users
        </div>
      </div>
    </div>
  )
}

/** A message bubble: his offer, as a DM. */
function Bubble({ start }: { start: number }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const p = pop(frame, 0, fps)
  const { x, y } = stickerSpot(start)
  return (
    <div style={{ position: 'absolute', left: x, top: y, transform: `scale(${0.7 + 0.3 * p})`, opacity: Math.min(1, p * 2), transformOrigin: 'left bottom' }}>
      <div style={{ padding: '24px 34px', borderRadius: '34px 34px 34px 8px', background: '#2F80ED', color: '#fff', fontSize: 46, fontWeight: 700, letterSpacing: '-0.02em', boxShadow: '0 16px 50px rgba(0,0,0,.35)', maxWidth: 560, lineHeight: 1.2 }}>
        send me your product,
        <br />
        I'll test it 👀
      </div>
    </div>
  )
}

function Follow() {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const p = pop(frame, 0, fps)
  return (
    <AbsoluteFill style={{ alignItems: 'center' }}>
      <div style={{ position: 'absolute', bottom: 80, transform: `scale(${0.7 + 0.3 * p})`, opacity: Math.min(1, p * 2) }}>
        <div style={{ ...pill, background: K.red, color: K.cream, fontSize: 50 }}>+ follow for more</div>
      </div>
    </AbsoluteFill>
  )
}

// ── inserts ─────────────────────────────────────────────────────────────────────────────────
const card = { borderRadius: 26, overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,.5)', background: '#fff' } as const

/** References: real screenshots and a video, flying into an agent. */
function Refs({ start }: { start: number }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = start + frame / FPS
  const intoAgent = interpolate(t, [C.process, C.process + 0.6], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) })
  const agent = pop(frame, f(C.process - start), fps)
  const tiles = [
    { src: 'ugc1/web-home.png', at: C.refs + 0.15, x: 330, y: 230, w: 620, h: 388, r: -4 },
    { src: 'ugc1/02-pay-coffee.png', at: C.shot, x: 1010, y: 170, w: 250, h: 542, r: 3 },
    { src: 'ugc1/09-till-paid.png', at: C.shot + 0.2, x: 1300, y: 260, w: 250, h: 542, r: -2 },
  ]
  const vid = pop(frame, f(C.video - start), fps)
  const fly = (x: number, y: number) => ({ x: x + (860 - x) * intoAgent, y: y + (520 - y) * intoAgent, s: 1 - 0.75 * intoAgent })
  return (
    <AbsoluteFill>
      {tiles.map((tl) => {
        const p = pop(frame, f(tl.at - start), fps)
        const q = fly(tl.x, tl.y)
        return (
          <div key={tl.src} style={{ ...card, position: 'absolute', left: q.x, top: q.y, width: tl.w, height: tl.h, transform: `scale(${(0.6 + 0.4 * p) * q.s}) rotate(${tl.r}deg)`, opacity: Math.min(1, p * 2) * (1 - intoAgent * 0.9) }}>
            <Img src={staticFile(tl.src)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        )
      })}
      {(() => {
        const q = fly(470, 560)
        return (
          <div style={{ ...card, position: 'absolute', left: q.x, top: q.y, width: 480, height: 270, transform: `scale(${(0.6 + 0.4 * vid) * q.s}) rotate(2deg)`, opacity: Math.min(1, vid * 2) * (1 - intoAgent * 0.9), background: '#000' }}>
            <Img src={staticFile(`ugc1/frames/f_${String((Math.floor(frame / 3) % 24) + 1).padStart(2, '0')}.jpg`)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <div style={{ position: 'absolute', left: 16, top: 14, padding: '6px 14px', borderRadius: 999, background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 24, fontWeight: 800 }}>▶ video</div>
          </div>
        )
      })()}
      <div style={{ position: 'absolute', left: 760, top: 430, width: 400, height: 210, opacity: Math.min(1, agent * 2), transform: `scale(${0.7 + 0.3 * agent})` }}>
        <div style={{ width: '100%', height: '100%', borderRadius: 36, background: K.ink, border: '3px solid rgba(250,250,216,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 22, boxShadow: '0 30px 90px rgba(0,0,0,.55)' }}>
          <div style={{ width: 76, height: 76, borderRadius: 38, background: K.red, display: 'grid', placeItems: 'center', fontSize: 44 }}>✦</div>
          <div style={{ color: K.cream, fontSize: 54, fontWeight: 800, letterSpacing: '-0.03em' }}>AI agent</div>
        </div>
      </div>
    </AbsoluteFill>
  )
}

/** ffmpeg: the command, his clip breaking into 24 frames, then flicking back into motion. */
function Ffmpeg({ start }: { start: number }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = start + frame / FPS
  const cmd = 'ffmpeg -i video.mp4 frames/%04d.png'
  const typed = Math.floor(interpolate(t, [C.ffmpeg + 0.05, C.ffmpeg + 1.2], [0, cmd.length], clamp))
  const termOut = interpolate(t, [C.breaks - 0.25, C.breaks + 0.1], [0, 1], clamp)
  const grid = (i: number) => pop(frame, f(C.breaks - start) + i * 1.2, fps)
  const collapse = interpolate(t, [C.videos - 0.1, C.videos + 0.45], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) })
  const flip = Math.floor(frame / 3) % 24
  return (
    <AbsoluteFill>
      {/* the command */}
      <div style={{ position: 'absolute', left: 360, top: 400, width: 1200, opacity: 1 - termOut, transform: `translateY(${-termOut * 40}px)` }}>
        <div style={{ borderRadius: 24, background: '#0E1416', border: '2px solid rgba(250,250,216,.14)', boxShadow: '0 30px 90px rgba(0,0,0,.55)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: 10, padding: '18px 22px', borderBottom: '1px solid rgba(250,250,216,.1)' }}>
            {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
              <div key={c} style={{ width: 16, height: 16, borderRadius: 8, background: c }} />
            ))}
          </div>
          <div style={{ padding: '34px 40px 40px', fontFamily: 'Menlo, monospace', fontSize: 46, color: K.cream }}>
            <span style={{ color: '#7FB8B0' }}>$ </span>
            {cmd.slice(0, typed)}
            <span style={{ opacity: frame % 12 < 6 ? 1 : 0 }}>▍</span>
          </div>
        </div>
      </div>
      {/* the frames */}
      {t > C.breaks - 0.1
        ? Array.from({ length: 24 }, (_, i) => {
            const col = i % 6
            const row = Math.floor(i / 6)
            const g = grid(i)
            const gx = 150 + col * 275
            const gy = 150 + row * 165
            const x = gx + (560 - gx) * collapse
            const y = gy + (250 - gy) * collapse
            const w = 255 + (800 - 255) * collapse
            const h = 143 + (450 - 143) * collapse
            const src = collapse > 0.5 ? flip : i
            return (
              <div key={i} style={{ position: 'absolute', left: x, top: y, width: w, height: h, borderRadius: 12 + 12 * collapse, overflow: 'hidden', opacity: Math.min(1, g * 2) * (collapse > 0.5 && i > 0 ? 0 : 1), transform: `scale(${0.6 + 0.4 * g})`, boxShadow: '0 14px 40px rgba(0,0,0,.45)', border: '3px solid rgba(250,250,216,.85)' }}>
                <Img src={staticFile(`ugc1/frames/f_${String(src + 1).padStart(2, '0')}.jpg`)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                {collapse < 0.3 ? <div style={{ position: 'absolute', right: 8, bottom: 6, color: '#fff', fontSize: 20, fontWeight: 800, textShadow: '0 1px 4px rgba(0,0,0,.8)' }}>{String(i + 1).padStart(4, '0')}</div> : null}
              </div>
            )
          })
        : null}
    </AbsoluteFill>
  )
}

/** The book, named: title and author only. */
function Book() {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 50, marginTop: -120 }}>
        <div style={{ fontSize: 150, ...rise(frame, 1, 30, 9) }}>📖</div>
        <div>
          <div style={{ fontSize: 40, fontWeight: 700, color: 'rgba(250,250,216,.7)', letterSpacing: '0.02em', ...rise(frame, 3, 20) }}>a book I really like</div>
          <div style={{ fontSize: 108, fontWeight: 800, color: K.cream, letterSpacing: '-0.045em', lineHeight: 1, marginTop: 10, ...rise(frame, f(C.book + 0.75 - (C.book - 0.1)), 30, 9) }}>Steal Like an Artist</div>
          <div style={{ fontSize: 56, fontWeight: 800, color: K.red, letterSpacing: '-0.02em', marginTop: 16, ...rise(frame, f(C.book + 1.6 - (C.book - 0.1)), 20) }}>Austin Kleon</div>
        </div>
      </div>
    </AbsoluteFill>
  )
}

/** What he builds: a Kova phone on "mobile apps", then mykova.app on "websites". */
function Builds({ start }: { start: number }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ph = pop(frame, f(C.mobile - start) - 2, fps)
  const web = pop(frame, f(C.websites - start) - 2, fps)
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 300, top: 150, width: 300, height: 650, borderRadius: 48, padding: 12, background: K.ink, boxShadow: '0 30px 90px rgba(0,0,0,.55)', transform: `translateY(${(1 - ph) * 120}px) rotate(-4deg)`, opacity: Math.min(1, ph * 2) }}>
        <Img src={staticFile('ugc1/01-home-morning.png')} style={{ width: '100%', height: '100%', borderRadius: 38, objectFit: 'cover' }} />
      </div>
      <div style={{ position: 'absolute', left: 720, top: 210, width: 900, borderRadius: 22, overflow: 'hidden', boxShadow: '0 30px 90px rgba(0,0,0,.55)', transform: `translateX(${(1 - web) * 160}px) rotate(2deg)`, opacity: Math.min(1, web * 2), background: '#fff' }}>
        <div style={{ height: 44, background: '#E9E7E2', display: 'flex', alignItems: 'center', gap: 10, padding: '0 18px' }}>
          {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
            <div key={c} style={{ width: 14, height: 14, borderRadius: 7, background: c }} />
          ))}
          <div style={{ marginLeft: 20, padding: '4px 18px', borderRadius: 999, background: '#fff', fontSize: 20, color: '#4A5A5C', fontWeight: 600 }}>mykova.app</div>
        </div>
        <Img src={staticFile('ugc1/web-home.png')} style={{ width: '100%', display: 'block' }} />
      </div>
    </AbsoluteFill>
  )
}

function EndCard() {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill style={{ background: K.ink, alignItems: 'center', justifyContent: 'center', gap: 18 }}>
      <div style={{ fontSize: 120, fontWeight: 800, color: K.cream, letterSpacing: '-0.05em', ...rise(frame, 1, 30, 9) }}>build cool stuff</div>
      <div style={{ fontSize: 120, fontWeight: 800, color: K.red, letterSpacing: '-0.05em', marginTop: -30, ...rise(frame, 5, 30, 9) }}>with AI.</div>
      <div style={{ ...pill, marginTop: 30, ...rise(frame, 10, 20) }}>+ follow for more</div>
    </AbsoluteFill>
  )
}

// ── sound ───────────────────────────────────────────────────────────────────────────────────
function Music() {
  const duck = DUCK as number[]
  return (
    <Html5Audio
      src={staticFile('ugc1/music/a.mp3')}
      volume={(fr) => (fr < duck.length ? duck[fr] : interpolate(fr, [duck.length, duck.length + 8], [duck[duck.length - 1], 0.6], clamp))}
    />
  )
}

function Sfx() {
  const cues: { at: number; src: string; volume: number }[] = [
    { at: C.cut - 0.6, src: 'audio/sfx/pop.mp3', volume: 0.32 },
    { at: C.cut, src: 'audio/sfx/swish.mp3', volume: 1.6 },
    { at: C.times - 0.06, src: 'audio/sfx/pop.mp3', volume: 0.3 },
    { at: C.ten, src: 'audio/sfx/land.mp3', volume: 0.32 },
    { at: C.refs - 0.14, src: 'audio/sfx/whoosh-real.wav', volume: 0.22 },
    { at: C.shot, src: 'audio/kenney/card-place-1.ogg', volume: 0.26 },
    { at: C.video, src: 'audio/kenney/card-place-2.ogg', volume: 0.26 },
    { at: C.process, src: 'audio/sfx/swish.mp3', volume: 1.5 },
    { at: C.ffmpeg - 0.16, src: 'audio/sfx/whoosh-real.wav', volume: 0.22 },
    { at: C.breaks, src: 'audio/sfx/sparkle.mp3', volume: 0.5 },
    { at: C.videos, src: 'audio/sfx/swish.mp3', volume: 1.4 },
    { at: C.book - 0.14, src: 'audio/sfx/whoosh-real.wav', volume: 0.22 },
    { at: C.join, src: 'audio/sfx/pop.mp3', volume: 0.24 },
    { at: C.newEnd, src: 'audio/sfx/sparkle.mp3', volume: 0.45 },
    { at: C.from - 0.12, src: 'audio/sfx/whoosh-real.wav', volume: 0.22 },
    { at: C.websites - 0.08, src: 'audio/kenney/card-place-3.ogg', volume: 0.26 },
    { at: C.ten2 - 0.3, src: 'audio/sfx/pop.mp3', volume: 0.3 },
    { at: C.hundred, src: 'audio/sfx/land.mp3', volume: 0.3 },
    { at: C.test - 0.1, src: 'audio/sfx/pop.mp3', volume: 0.3 },
    { at: C.follow - 0.1, src: 'audio/sfx/pop.mp3', volume: 0.28 },
    { at: AROLL / FPS, src: 'audio/sfx/chime.mp3', volume: 0.3 },
  ]
  // ffmpeg typing: one soft key click per character
  const keys = Array.from({ length: 12 }, (_, i) => ({ at: C.ffmpeg + 0.05 + i * 0.095, src: 'audio/kenney/card-place-4.ogg', volume: 0.08 }))
  return (
    <>
      {[...cues, ...keys].map((c) => (
        <Sequence key={`${c.at}${c.src}`} from={f(c.at)} durationInFrames={50}>
          <Html5Audio src={staticFile(c.src)} volume={c.volume} />
        </Sequence>
      ))}
    </>
  )
}
