/**
 * Kova for iPhone: the user's own recording of the live app, framed for the beta.
 *
 * One governing idea: the tap. The Kova mark's waves pulse out like a tap-to-pay ripple, the
 * iPhone rises into the exact spot the recording starts from (a match cut), the recording plays
 * untouched with its own sound, and where it goes black Kovi dances to that same music, on its
 * beats, before the end card asks people to join the beta.
 *
 * Timeline (30 fps): intro 0-69 (2.3 s); the footage and its audio from frame 61 (an 8-frame
 * crossfade); the footage's black from its frame 880 (29.333 s) is replaced by the outro, which
 * runs to the end of their audio (frame 1141, 38.03 s).
 */
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
  random,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import { fontsReady } from '../theme'

export const FPS = 30
const PEACH = '#F0D3C1'
const K = { ink: '#0B1A1D', coral: '#D46558', teal: '#2F6669', surface: '#F1EFEA', muted: '#4A5A5C', cream: '#FBF6F2' }

export const INTRO = 69
const XF = 8
export const FOOT = INTRO - XF
const BLACK = 880
const FOOT_LEN = 1080
export const OUT = FOOT + BLACK
const OUT_LEN = FOOT_LEN - BLACK
export const IOS_DURATION = FOOT + FOOT_LEN

/** Beats of their music after the black, in outro frames (librosa, 136 bpm). */
const BEATS = [13, 26, 40, 54, 67, 81, 95, 108, 122, 135, 149, 162, 175, 188, 201]
const BIG = 108
const RIGHT_X = 1530

const ARCS = ['M92.6 74.3 A40 40 0 0 1 92.6 125.7', 'M115.6 55.0 A70 70 0 0 1 115.6 145.0', 'M138.6 35.7 A100 100 0 0 1 138.6 164.3']
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

function Mark({ size, waves }: { size: number; waves: number[] }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" style={{ display: 'block', overflow: 'visible' }}>
      <path d="M62 46 V154" stroke={K.ink} strokeWidth={19} strokeLinecap="round" />
      {ARCS.map((d, i) => (
        <path
          key={d}
          d={d}
          stroke={K.coral}
          strokeWidth={17}
          strokeLinecap="round"
          fill="none"
          style={{ opacity: waves[i] ?? 0, transform: `scale(${0.82 + 0.18 * (waves[i] ?? 0)})`, transformOrigin: '62px 100px' }}
        />
      ))}
    </svg>
  )
}

function Ring({ x, y, from, frame, max = 760, width = 6, opacity = 0.55, dur = 26 }: { x: number; y: number; from: number; frame: number; max?: number; width?: number; opacity?: number; dur?: number }) {
  if (frame < from || frame > from + dur) return null
  const t = (frame - from) / dur
  const r = interpolate(t, [0, 1], [60, max], { easing: Easing.out(Easing.cubic) })
  return (
    <div
      style={{
        position: 'absolute',
        left: x - r,
        top: y - r,
        width: r * 2,
        height: r * 2,
        borderRadius: '50%',
        border: `${width}px solid ${K.coral}`,
        opacity: opacity * (1 - t),
      }}
    />
  )
}

// ── Intro ─────────────────────────────────────────────────────────────────────────────────

function Intro() {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()

  // The mark: stem first, then its three waves, like a tap reaching a reader.
  const waves = ARCS.map((_, i) => spring({ frame: f - (2 + i * 3), fps, config: { damping: 12, stiffness: 180 } }))
  const pop = spring({ frame: f, fps, config: { damping: 11, stiffness: 160 } })
  // It travels into the lockup's mark position and hands over to it.
  const move = interpolate(f, [16, 32], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) })
  const size = 240 * (0.6 + 0.4 * pop) * interpolate(move, [0, 1], [1, 0.304])
  const cx = interpolate(move, [0, 1], [960, 1056])
  const cy = interpolate(move, [0, 1], [540, 372])
  const markOpacity = interpolate(f, [29, 34], [1, 0], clamp)

  // The phone rises into exactly where the recording's first frame has it.
  const rise = spring({ frame: f - 13, fps, config: { damping: 15, mass: 0.9, stiffness: 110 } })
  const phoneY = (1 - rise) * 1000
  const phoneRot = (1 - rise) * 5

  // The title, staggered, then out of the way for the recording's second phone.
  const enter = (at: number) => spring({ frame: f - at, fps, config: { damping: 16, stiffness: 140 } })
  const leave = interpolate(f, [50, 60], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) })
  const title = (at: number) => ({ opacity: enter(at) * (1 - leave), transform: `translateY(${(1 - enter(at)) * 26 - leave * 18}px)` })

  // The recording has black bars at its sides: they slide in so the cut lands on its framing.
  const bars = interpolate(f, [48, 61], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) })

  return (
    <AbsoluteFill style={{ background: PEACH, overflow: 'hidden' }}>
      <Ring x={960} y={540} from={5} frame={f} />
      <Ring x={960} y={540} from={11} frame={f} />
      <Ring x={960} y={540} from={17} frame={f} opacity={0.4} />

      <Img
        src={staticFile('ios/phone0.png')}
        style={{ position: 'absolute', left: 380, top: 84, width: 520, height: 972, transform: `translateY(${phoneY}px) rotate(${phoneRot}deg)`, transformOrigin: '50% 100%' }}
      />

      <div style={{ position: 'absolute', left: cx - size / 2, top: cy - size / 2, opacity: markOpacity }}>
        <Mark size={size} waves={waves} />
      </div>

      <div style={{ position: 'absolute', left: 1020, top: 330, width: 680, fontFamily: 'Manrope' }}>
        <div style={title(28)}>
          <Img src={staticFile('demo/kova-lockup.svg')} style={{ width: 260, height: 84.5, display: 'block' }} />
        </div>
        <div style={{ ...title(31), marginTop: 30, fontWeight: 800, fontSize: 104, lineHeight: 0.98, letterSpacing: -4, color: K.ink }}>
          Kova for
          <br />
          iOS<span style={{ color: K.coral }}>.</span>
        </div>
        <div style={{ ...title(35), marginTop: 30, display: 'flex', gap: 14, alignItems: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 30, color: K.cream, background: K.coral, borderRadius: 999, padding: '8px 22px' }}>Beta</div>
          <div style={{ fontWeight: 700, fontSize: 30, color: K.ink }}>on TestFlight</div>
        </div>
      </div>

      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 180 * bars, background: '#000' }} />
      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 158 * bars, background: '#000' }} />
    </AbsoluteFill>
  )
}

// ── Their recording ─────────────────────────────────────────────────────────────────────────

function Footage() {
  const f = useCurrentFrame()
  const opacity = interpolate(f, [0, XF], [0, 1], clamp)
  return (
    <AbsoluteFill style={{ opacity }}>
      <OffthreadVideo src={staticFile('ios/footage.mp4')} muted style={{ width: 1920, height: 1080 }} />
    </AbsoluteFill>
  )
}

// ── Kovi dancing ───────────────────────────────────────────────────────────────────────────

type Pose = 'ride' | 'cheer' | 'wave' | 'catch' | 'key'
const DANCE: Pose[] = ['cheer', 'wave', 'catch', 'key', 'cheer', 'wave', 'catch', 'cheer', 'wave', 'cheer', 'key', 'wave', 'cheer', 'wave', 'cheer']

function beatAt(L: number) {
  let i = -1
  for (let k = 0; k < BEATS.length; k++) if (L >= (BEATS[k] as number)) i = k
  return i
}

/** Where Kovi is and how he's shaped at outro frame L. */
function kovi(L: number) {
  // Entrance: riding the paper plane in, along an arc, like the welcome screen's flight.
  if (L < 11) {
    const t = interpolate(L, [1, 11], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })
    const x = (1 - t) ** 2 * -260 + 2 * (1 - t) * t * 520 + t ** 2 * 960
    const y = (1 - t) ** 2 * 940 + 2 * (1 - t) * t * 260 + t ** 2 * 560
    return { pose: 'ride' as Pose, x, y, sx: 1, sy: 1, rot: interpolate(t, [0, 1], [-14, 0]), scale: 0.9, base: 560 }
  }
  const i = beatAt(L + 2)
  const pose = DANCE[Math.max(0, i)] as Pose
  const b = BEATS[Math.max(0, beatAt(L))] as number
  const next = (BEATS[Math.max(0, beatAt(L)) + 1] as number) ?? b + 13
  const p = Math.min(1, Math.max(0, (L - b) / (next - b)))
  const since = L - b
  const strong = [40, 67, 95].includes(b)

  // The big hit: a crouch (anticipation), a launch, and a move to the end card's right side.
  if (L >= BIG - 6 && L < BEATS[8]!) {
    const crouch = interpolate(L, [BIG - 6, BIG - 2, BIG], [0, 1, 0], clamp)
    const air = interpolate(L, [BIG, BEATS[8]!], [0, 1], clamp)
    const x = interpolate(air, [0, 1], [960, RIGHT_X], { easing: Easing.inOut(Easing.cubic) })
    const scale = interpolate(air, [0, 1], [1, 0.62], { easing: Easing.inOut(Easing.cubic) })
    const y = 560 - Math.sin(Math.PI * air) * 300 + (1 - scale) * 160
    const sy = 1 - 0.18 * crouch + (air > 0 && air < 0.3 ? 0.08 : 0)
    return { pose: L < BIG - 1 ? pose : ('cheer' as Pose), x, y, sx: 1 / sy, sy, rot: Math.sin(air * Math.PI * 2) * 10, scale, base: 560 + (1 - scale) * 160 }
  }

  const after = L >= BEATS[8]!
  const scale = after ? 0.62 : 1
  const hop = (after ? 34 : strong ? 86 : 64) * scale
  const y0 = after ? 560 + (1 - scale) * 160 : 560
  const y = y0 - Math.sin(Math.PI * p) * hop
  // Squash on landing, stretch on the way up; volume kept (sx = 1 / sy).
  const squash = since < 4 ? 1 - 0.15 * (1 - since / 4) : 1
  const stretch = since >= 3 && since < 8 ? 1 + 0.06 * Math.sin(((since - 3) / 5) * Math.PI) : 1
  const sy = squash * stretch
  // Sway left and right on alternate beats, the turn trailing two frames behind (follow-through).
  const side = (Math.max(0, beatAt(L)) % 2 === 0 ? -1 : 1) * (after ? 0 : 1)
  const sway = interpolate(p, [0, 1], [-side, side], { easing: Easing.inOut(Easing.sin) })
  const lagP = Math.min(1, Math.max(0, (L - 2 - b) / (next - b)))
  const rot = interpolate(lagP, [0, 1], [-side * 7, side * 7], { easing: Easing.inOut(Easing.sin) }) * (after ? 0.6 : 1)
  const x = (after ? RIGHT_X : 960) + sway * 46 * scale
  return { pose, x, y, sx: 1 / sy, sy, rot, scale, base: y0 }
}

const POSE_SRC: Record<Pose, string> = {
  ride: 'art/kovi-ride.png',
  cheer: 'art/kovi-cheer.png',
  wave: 'art/kovi-wave.png',
  catch: 'art/kovi-catch.png',
  key: 'art/kovi-key.png',
}
const COINS = ['art/coin-usd.png', 'art/coin-eur.png', 'art/coin-gbp.png']
const SPARKS = ['art/sparkle-1.png', 'art/sparkle-4.png', 'art/sparkle-8.png', 'art/sparkle-11.png']

function Coins({ L, at, n, ox, oy, right = 0, life = 28 }: { L: number; at: number; n: number; ox: number; oy: number; right?: number; life?: number }) {
  if (L < at || L > at + life) return null
  const t = L - at
  return (
    <>
      {Array.from({ length: n }, (_, k) => {
        const seed = `coin-${at}-${k}`
        const ang = -Math.PI / 2 + (random(seed) - 0.5 + right) * Math.PI * (1.1 - right * 0.5)
        const speed = 20 + random(`${seed}s`) * 14
        const x = ox + Math.cos(ang) * speed * t
        const y = oy + Math.sin(ang) * speed * t + 0.9 * t * t
        const size = 70 + random(`${seed}z`) * 46
        const spin = (random(`${seed}r`) - 0.5) * 40 * t
        const pop = interpolate(t, [0, 4], [0.3, 1], clamp)
        const fade = interpolate(t, [life - 7, life], [1, 0], clamp)
        return (
          <Img
            key={seed}
            src={staticFile(COINS[k % 3] as string)}
            style={{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size, opacity: fade, transform: `rotate(${spin}deg) scale(${pop})` }}
          />
        )
      })}
    </>
  )
}

function Sparkles({ L, cx, cy, scale }: { L: number; cx: number; cy: number; scale: number }) {
  const spots = [
    [-330, -240, 74],
    [300, -270, 62],
    [-380, 40, 46],
    [360, 10, 54],
    [-220, -420, 40],
    [240, -440, 46],
  ] as const
  return (
    <>
      {spots.map(([dx, dy, s], k) => {
        // Twinkles on the off-beats, each one a little later than the last.
        const i = Math.max(0, beatAt(L))
        const b = BEATS[i] as number
        const next = (BEATS[i + 1] as number) ?? b + 13
        const mid = (b + next) / 2 + (k % 3) - 1
        const tw = Math.max(0, 1 - Math.abs(L - mid) / 6)
        const base = 0.35 + 0.65 * tw
        return (
          <Img
            key={`${dx}${dy}`}
            src={staticFile(SPARKS[k % 4] as string)}
            style={{
              position: 'absolute',
              left: cx + dx * scale - (s * scale) / 2,
              top: cy + dy * scale - (s * scale) / 2,
              width: s * scale,
              height: s * scale,
              opacity: L < 12 ? 0 : base,
              transform: `scale(${0.6 + 0.6 * tw}) rotate(${tw * 25}deg)`,
            }}
          />
        )
      })}
    </>
  )
}

function Outro() {
  const L = useCurrentFrame()
  const { fps } = useVideoConfig()
  const k = kovi(L)
  const size = 560 * k.scale

  // A tap ripple opens the stage over the recording's last frame.
  const wipe = interpolate(L, [0, 11], [0, 1220], { ...clamp, easing: Easing.out(Easing.cubic) })

  const enter = (at: number) => spring({ frame: L - at, fps, config: { damping: 16, stiffness: 140 } })
  const card = (at: number) => ({ opacity: enter(at), transform: `translateY(${(1 - enter(at)) * 34}px)` })

  // The ground sits under his feet at rest (the poses stand about 0.44 of their box below centre).
  const ground = k.base + 250 * k.scale
  const lift = Math.max(0, k.base - k.y)
  const shadowW = Math.max(80, 300 - lift * 0.9) * k.scale

  return (
    <AbsoluteFill style={{ clipPath: `circle(${wipe}px at 960px 540px)`, background: PEACH, overflow: 'hidden' }}>
      <Ring x={960} y={540} from={0} frame={L} max={1200} width={10} opacity={0.6} dur={14} />
      <Ring x={960} y={560} from={40} frame={L} max={640} />
      <Ring x={960} y={560} from={BIG} frame={L} max={900} />
      <Ring x={960} y={560} from={BIG + 6} frame={L} max={900} opacity={0.4} />

      <Sparkles L={L} cx={k.x} cy={k.y} scale={k.scale} />

      {/* The shadow stays on the ground and shrinks as he goes up. */}
      <div
        style={{
          position: 'absolute',
          left: k.x - shadowW / 2,
          top: ground - 18 * k.scale,
          width: shadowW,
          height: 36 * k.scale,
          borderRadius: '50%',
          background: 'rgba(11, 26, 29, 0.14)',
          opacity: L < 9 ? 0 : 1,
        }}
      />

      <Coins L={L} at={40} n={4} ox={960} oy={520} />
      <Coins L={L} at={67} n={4} ox={960} oy={520} />
      <Coins L={L} at={95} n={5} ox={960} oy={520} />
      <Coins L={L} at={BIG} n={10} ox={1080} oy={470} right={0.32} life={22} />

      <Img
        src={staticFile(POSE_SRC[k.pose])}
        style={{
          position: 'absolute',
          left: k.x - size / 2,
          top: k.y - size / 2,
          width: size,
          height: size,
          transform: `rotate(${k.rot}deg) scale(${k.sx}, ${k.sy})`,
          transformOrigin: '50% 88%',
        }}
      />

      {/* The end card: what it is, and where to join. */}
      <div style={{ position: 'absolute', left: 190, top: 270, width: 1060, fontFamily: 'Manrope' }}>
        <div style={card(BIG + 4)}>
          <Img src={staticFile('demo/kova-lockup.svg')} style={{ width: 300, height: 97.5, display: 'block' }} />
        </div>
        <div style={{ ...card(BIG + 7), marginTop: 34, fontWeight: 800, fontSize: 132, lineHeight: 0.96, letterSpacing: -5.5, color: K.ink }}>
          Kova for iOS<span style={{ color: K.coral }}>.</span>
        </div>
        <div style={{ ...card(BIG + 11), marginTop: 44, display: 'flex' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 18,
              fontWeight: 800,
              fontSize: 44,
              color: K.cream,
              background: K.coral,
              borderRadius: 999,
              padding: '24px 40px',
              boxShadow: '0 14px 30px rgba(212, 101, 88, 0.32)',
            }}
          >
            Join the beta
            <span style={{ fontSize: 44 }}>→</span>
            <span style={{ fontWeight: 700, opacity: 0.92 }}>mykova.app/waitlist</span>
          </div>
        </div>
        <div style={{ ...card(BIG + 15), marginTop: 34, display: 'flex' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontWeight: 700, fontSize: 30, color: K.ink, background: K.surface, borderRadius: 999, padding: '10px 24px' }}>
            <div style={{ width: 14, height: 14, borderRadius: 7, background: K.teal }} />
            Live on Monad
          </div>
        </div>
      </div>
    </AbsoluteFill>
  )
}

export function IosBetaFilm() {
  const [handle] = useState(() => delayRender('Manrope'))
  useEffect(() => {
    fontsReady.then(() => continueRender(handle))
  }, [handle])

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Sequence durationInFrames={INTRO}>
        <Intro />
      </Sequence>
      <Sequence from={FOOT} durationInFrames={BLACK}>
        <Footage />
      </Sequence>
      {/* The recording's last frame, held under the outro's opening ripple. */}
      <Sequence from={OUT} durationInFrames={14}>
        <Img src={staticFile('ios/last.png')} style={{ width: 1920, height: 1080 }} />
      </Sequence>
      <Sequence from={OUT} durationInFrames={OUT_LEN}>
        <Outro />
      </Sequence>

      {/* Their sound, untouched and in sync with their recording; the intro's own two quiet cues. */}
      <Sequence from={FOOT}>
        <Html5Audio src={staticFile('ios/audio.wav')} />
      </Sequence>
      <Sequence from={3}>
        <Html5Audio src={staticFile('audio/sfx/chime.mp3')} volume={0.9} />
      </Sequence>
      <Sequence from={12}>
        <Html5Audio src={staticFile('audio/sfx/whoosh-real.wav')} volume={0.6} />
      </Sequence>
    </AbsoluteFill>
  )
}
