import type { CSSProperties, ReactNode } from 'react'
import {
  AbsoluteFill,
  Easing,
  Html5Audio,
  Img,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
} from 'remotion'
import { Device, DEVICE } from '../ios-live-v2/Device'
import { Brand, Ground, V } from '../ios-live-v2/Still'
import { KoviRig } from '../KoviRig'

/**
 * "Stocks, in Kova." 13 seconds, 16:9, 30 fps, over the project's own score (wall/music/a.mp3).
 *
 * Every screen is a capture of the real app on 24 Oct 2026 (film/public/stocks, from the iOS
 * simulator against Kova's API): the list, Tesla, and the Buy sheet that says "Coming soon". The
 * market was closed, so the prices are the tokens' last prices and the screens say so.
 *
 *   0.0  the list, live prices. "Stocks, in Kova."      tap Tesla at 2.8 s
 *   3.0  Tesla pushes in. "A slice of Tesla, from $5."
 *   6.5  the Buy sheet rises. "Buying opens soon."
 *  10.0  Kova, "Stocks on Kova", mykova.app; Kovi waves.
 */

export const DURATION = 390
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const decel = Easing.bezier(0.16, 1, 0.3, 1)
const inOut = Easing.bezier(0.65, 0, 0.35, 1)
const ease = (f: number, a: number, b: number, e = decel) =>
  interpolate(f, [a, b], [0, 1], { ...clamp, easing: e })
const settle = (f: number, at: number) =>
  spring({ frame: f - at, fps: 30, config: { stiffness: 160, damping: 19 } })

const PHONE = { x: 1330, y: 548, h: 990 }
const TAP_TESLA = 84
const PUSH = 90
const SHEET = 195
const END = 300

/** Capture pixels (1179 × 2556) into the device screen's own units. */
const K = DEVICE.screen.w / DEVICE.image.w
const TOP = (DEVICE.screen.h - DEVICE.image.h * K) / 2

/** One capture, filling the screen, with the cutout the frame draws cleared. */
function Capture({ src, style, clip }: { src: string; style?: CSSProperties; clip?: string }) {
  return (
    <AbsoluteFill style={{ clipPath: clip, ...style }}>
      <Img
        src={staticFile(`stocks/${src}.png`)}
        style={{ position: 'absolute', left: 0, top: TOP, width: DEVICE.screen.w, height: DEVICE.image.h * K }}
      />
      <div
        style={{
          position: 'absolute',
          left: 392 * K,
          top: TOP + 25 * K,
          width: 400 * K,
          height: 127 * K,
          background: V.paper,
        }}
      />
    </AbsoluteFill>
  )
}

/** A coral ring around part of the screen, in capture pixels: where the eye should go. */
function Ring({ f, at, x, y, w, h, r = 40, out }: {
  f: number; at: number; x: number; y: number; w: number; h: number; r?: number; out?: number
}) {
  const p = ease(f, at, at + 12)
  const gone = out === undefined ? 0 : ease(f, out, out + 8)
  const grow = 1 + (1 - p) * 0.06
  return (
    <div
      style={{
        position: 'absolute',
        left: x * K - 14,
        top: TOP + y * K - 14,
        width: w * K + 28,
        height: h * K + 28,
        borderRadius: r * K + 14,
        border: `9px solid ${V.coral}`,
        opacity: p * (1 - gone),
        transform: `scale(${grow})`,
      }}
    />
  )
}

/** A finger's tap: a soft disc that presses and lets go. */
function Tap({ f, at, x, y }: { f: number; at: number; x: number; y: number }) {
  const d = f - at
  if (d < -4 || d > 14) return null
  const press = d < 0 ? (d + 4) / 4 : 1 - d / 14
  return (
    <div
      style={{
        position: 'absolute',
        left: x * K - 70,
        top: TOP + y * K - 70,
        width: 140,
        height: 140,
        borderRadius: 99,
        background: 'rgba(11,26,29,.18)',
        border: '4px solid rgba(255,255,255,.7)',
        opacity: Math.max(0, press),
        transform: `scale(${0.8 + press * 0.2})`,
      }}
    />
  )
}

function Screen({ f }: { f: number }) {
  // An iOS push: Tesla slides in from the right, the list drifts left under a shade.
  const push = ease(f, PUSH, PUSH + 16, Easing.bezier(0.2, 0.9, 0.25, 1))
  // The sheet rises over Tesla, which dims behind it.
  const sheet = ease(f, SHEET, SHEET + 18, Easing.bezier(0.2, 0.9, 0.25, 1))
  const SHEET_TOP = 628
  return (
    <AbsoluteFill style={{ background: V.paper, overflow: 'hidden' }}>
      {push < 1 ? (
        <Capture src="list" style={{ transform: `translateX(${-push * DEVICE.screen.w * 0.3}px)` }} />
      ) : null}
      {push < 1 ? <AbsoluteFill style={{ background: `rgba(11,26,29,${push * 0.12})` }} /> : null}
      {f >= PUSH ? (
        <Capture
          src="detail"
          style={{
            transform: `translateX(${(1 - push) * DEVICE.screen.w}px)`,
            boxShadow: '-30px 0 60px rgba(11,26,29,.12)',
          }}
        />
      ) : null}
      {f >= SHEET ? (
        <>
          <Capture src="buy" clip={`inset(0 0 ${DEVICE.screen.h - (TOP + SHEET_TOP * K)}px 0)`} style={{ opacity: sheet }} />
          <Capture
            src="buy"
            clip={`inset(${TOP + SHEET_TOP * K}px 0 0 0)`}
            style={{ transform: `translateY(${(1 - sheet) * (DEVICE.screen.h - SHEET_TOP * K)}px)` }}
          />
        </>
      ) : null}
      {f < PUSH ? (
        <>
          <Ring f={f} at={52} x={60} y={1305} w={1059} h={180} out={PUSH - 4} />
          <Tap f={f} at={TAP_TESLA} x={590} y={1395} />
        </>
      ) : null}
      {f >= PUSH && f < SHEET ? <Ring f={f} at={140} x={60} y={1380} w={1056} h={306} r={66} out={SHEET - 6} /> : null}
      {f >= SHEET + 10 ? <Ring f={f} at={248} x={60} y={1965} w={1053} h={150} r={75} /> : null}
    </AbsoluteFill>
  )
}

/** Large words rise through a mask; they leave the way they came. */
function Words({ f, at, leave, size, children, style, weight = 800 }: {
  f: number; at: number; leave?: number; size: number; children: ReactNode; style?: CSSProperties; weight?: number
}) {
  const e = ease(f, at, at + 20)
  const l = leave === undefined ? 0 : ease(f, leave, leave + 12, Easing.in(Easing.cubic))
  return (
    <div style={{ position: 'absolute', overflow: 'hidden', paddingBottom: size * 0.12, ...style }}>
      <div
        style={{
          fontSize: size,
          fontWeight: weight,
          lineHeight: 1,
          letterSpacing: -size * (weight === 800 ? 0.05 : 0.02),
          whiteSpace: 'nowrap',
          transform: `translateY(${(1 - e) * size * 1.3 - l * size * 1.3}px)`,
          opacity: 1 - l,
        }}
      >
        {children}
      </div>
    </div>
  )
}

const Dot = () => <span style={{ color: V.coral }}>.</span>

function Copy({ f }: { f: number }) {
  const muted = { color: '#566568' }
  return (
    <>
      {/* Frame 0 already says what this is: the thumbnail on X. */}
      <Words f={f} at={-20} leave={PUSH - 6} size={150} style={{ left: 128, top: 300 }}>Stocks,</Words>
      <Words f={f} at={-14} leave={PUSH - 4} size={150} style={{ left: 128, top: 462 }}>in Kova<Dot /></Words>
      <Words f={f} at={14} leave={PUSH - 2} size={38} weight={600} style={{ left: 134, top: 668, ...muted }}>
        Tesla, Nvidia, Apple, the S&amp;P 500.
      </Words>
      <Words f={f} at={22} leave={PUSH} size={38} weight={600} style={{ left: 134, top: 722, ...muted }}>
        Tokens on Monad, backed 1:1 by shares.
      </Words>

      <Words f={f} at={PUSH + 8} leave={SHEET - 6} size={128} style={{ left: 128, top: 330 }}>A slice of</Words>
      <Words f={f} at={PUSH + 14} leave={SHEET - 4} size={128} style={{ left: 128, top: 470 }}>Tesla<Dot /></Words>
      <Words f={f} at={PUSH + 40} leave={SHEET - 2} size={128} style={{ left: 128, top: 610, color: V.coral }}>From $5.</Words>

      <Words f={f} at={SHEET + 10} leave={END - 6} size={128} style={{ left: 128, top: 370 }}>Buying</Words>
      <Words f={f} at={SHEET + 16} leave={END - 4} size={128} style={{ left: 128, top: 510 }}>opens soon<Dot /></Words>
      <Words f={f} at={SHEET + 52} leave={END - 2} size={38} weight={600} style={{ left: 134, top: 690, ...muted }}>
        Ask to be told first, in the app.
      </Words>
    </>
  )
}

function Final({ f }: { f: number }) {
  const meta = ease(f, END + 4, END + 24)
  const url = settle(f, END + 40)
  return (
    <>
      <Brand x={128} y={92} opacity={meta} />
      <Words f={f} at={END + 6} size={44} weight={600} style={{ left: 134, top: 318 }}>xStocks on Monad.</Words>
      <Words f={f} at={END + 12} size={150} style={{ left: 128, top: 394 }}>Stocks</Words>
      <Words f={f} at={END + 18} size={150} style={{ left: 128, top: 556 }}>on Kova<Dot /></Words>
      <div
        style={{
          position: 'absolute',
          left: 134,
          top: 786,
          display: 'flex',
          alignItems: 'center',
          gap: 22,
          color: V.cream,
          background: V.ink,
          padding: '20px 30px',
          borderRadius: 99,
          fontWeight: 700,
          fontSize: 32,
          opacity: Math.min(1, Math.max(0, url)),
          transform: `translateY(${(1 - url) * 24}px)`,
        }}
      >
        mykova.app
      </div>
    </>
  )
}

function Kovi({ f }: { f: number }) {
  const at = END + 30
  if (f < at) return null
  const p = settle(f, at)
  const hop = -Math.sin(ease(f, at, at + 18, inOut) * Math.PI) * 30
  const wave = Math.sin((f - at - 18) * 0.27) * Math.max(0, 1 - (f - at - 18) / 60)
  return (
    <KoviRig
      x={1790}
      y={930 + (1 - p) * 60 + hop}
      size={150}
      style={{ opacity: Math.min(1, p) }}
      pose={{
        look: { x: -0.8, y: -0.3 },
        mouth: 'grin',
        armL: -5 - wave * 28,
        armR: 35,
        waveLines: Math.max(0, Math.min(1, (f - at - 14) / 8)) * Math.max(0, 1 - (f - at - 50) / 30),
        lean: -wave * 1.5,
        happy: 0.2,
      }}
    />
  )
}

/** One sound at one frame. */
const At = ({ at, src, volume }: { at: number; src: string; volume: number }) => (
  <Sequence from={at} layout="none">
    <Html5Audio src={staticFile(src)} volume={volume} />
  </Sequence>
)

export function StocksFilm() {
  const f = useCurrentFrame()
  // The phone breathes in once at the start and settles; it moves only for the ending.
  const enter = ease(f, -12, 18)
  const away = ease(f, END, END + 24, inOut)
  return (
    <AbsoluteFill style={{ fontFamily: 'Manrope', color: V.ink, overflow: 'hidden' }}>
      <Ground />
      <Copy f={f} />
      {f >= END ? <Final f={f} /> : null}
      <Device
        x={PHONE.x + away * 40}
        y={PHONE.y + (1 - enter) * 40}
        h={PHONE.h}
        screen={null}
      >
        <Screen f={f} />
      </Device>
      <Kovi f={f} />

      <Html5Audio
        src={staticFile('wall/music/a.mp3')}
        volume={(fr) => 0.55 * interpolate(fr, [DURATION - 20, DURATION], [1, 0], clamp)}
      />
      <At at={TAP_TESLA - 2} src="link/sfx/tap.mp3" volume={0.7} />
      <At at={PUSH - 1} src="link/sfx/swoosh.mp3" volume={0.35} />
      <At at={SHEET - 1} src="link/sfx/slide.mp3" volume={0.45} />
      <At at={END + 30} src="audio/sfx/pop.mp3" volume={0.4} />
      <At at={END + 40} src="link/sfx/logo.mp3" volume={0.5} />
    </AbsoluteFill>
  )
}
