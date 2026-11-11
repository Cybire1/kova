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
 * "Kova is live on Monad mainnet", with the 2,000 MON giveaway. 13 seconds, 16:9, 30 fps, over the
 * project's own score (wall/music/b.mp3).
 *
 * Every screen is the real iOS app on mainnet, captured 27 Oct 2026 from a brand-new wallet
 * (film/public/launch): what someone sees right after they sign up. Nothing on screen is staged:
 * the balance is $0.00 because the wallet is new. Phone sends aren't on for mainnet yet, so the
 * words name only .nad names and links.
 *
 *   0.0  welcome. "Kova is live on Monad mainnet."   tap "Create with a passkey" at 2.4 s
 *   2.7  the new wallet. "A dollar wallet. Face ID, no seed phrase."
 *   5.3  the Send sheet rises. "Send to a .nad name or a link. Gas is on us."
 *   8.0  the giveaway: four Kova cards fan out. "2,000 MON. 100 each to the first 20."
 *  11.0  Kova, mykova.app; Kovi waves.
 */

export const DURATION = 390
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const decel = Easing.bezier(0.16, 1, 0.3, 1)
const inOut = Easing.bezier(0.65, 0, 0.35, 1)
const ios = Easing.bezier(0.2, 0.9, 0.25, 1)
const ease = (f: number, a: number, b: number, e = decel) =>
  interpolate(f, [a, b], [0, 1], { ...clamp, easing: e })
const settle = (f: number, at: number) =>
  spring({ frame: f - at, fps: 30, config: { stiffness: 160, damping: 19 } })

const TAP = 72
const PUSH = 80
const SHEET = 160
const GIFT = 240
const END = 330

const PALETTE = {
  teal: '#46878B',
  tealSoft: '#A9C9C9',
  coralSoft: '#EBB3AA',
  muted: '#566568',
}

/** Capture pixels (1179 × 2556) into the device screen's own units. */
const K = DEVICE.screen.w / DEVICE.image.w
const TOP = (DEVICE.screen.h - DEVICE.image.h * K) / 2

function Capture({ src, style, clip }: { src: string; style?: CSSProperties; clip?: string }) {
  return (
    <AbsoluteFill style={{ clipPath: clip, ...style }}>
      <Img
        src={staticFile(`launch/${src}.png`)}
        style={{ position: 'absolute', left: 0, top: TOP, width: DEVICE.screen.w, height: DEVICE.image.h * K }}
      />
      {/* The capture's own cutout; the frame draws the real one. */}
      <div style={{ position: 'absolute', left: 392 * K, top: TOP + 25 * K, width: 400 * K, height: 127 * K, background: V.paper }} />
    </AbsoluteFill>
  )
}

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
        border: '4px solid rgba(255,255,255,.75)',
        opacity: Math.max(0, press),
        transform: `scale(${0.8 + press * 0.2})`,
      }}
    />
  )
}

function Screen({ f }: { f: number }) {
  const push = ease(f, PUSH, PUSH + 16, ios)
  const sheet = ease(f, SHEET, SHEET + 18, ios)
  // In the send capture the sheet's grabber sits at y 1040; above it, Home under a shade.
  const SHEET_TOP = 1030
  return (
    <AbsoluteFill style={{ background: V.paper, overflow: 'hidden' }}>
      {push < 1 ? (
        <Capture src="welcome" style={{ transform: `translateX(${-push * DEVICE.screen.w * 0.3}px)` }} />
      ) : null}
      {push < 1 ? <AbsoluteFill style={{ background: `rgba(11,26,29,${push * 0.12})` }} /> : null}
      {f >= PUSH ? (
        <Capture
          src="home"
          style={{ transform: `translateX(${(1 - push) * DEVICE.screen.w}px)`, boxShadow: '-30px 0 60px rgba(11,26,29,.12)' }}
        />
      ) : null}
      {f >= SHEET ? (
        <>
          <Capture src="send" clip={`inset(0 0 ${DEVICE.screen.h - (TOP + SHEET_TOP * K)}px 0)`} style={{ opacity: sheet }} />
          <Capture
            src="send"
            clip={`inset(${TOP + SHEET_TOP * K}px 0 0 0)`}
            style={{ transform: `translateY(${(1 - sheet) * (DEVICE.screen.h - SHEET_TOP * K)}px)` }}
          />
        </>
      ) : null}
      {f < PUSH ? <Tap f={f} at={TAP} x={590} y={2195} /> : null}
    </AbsoluteFill>
  )
}

/** Large words rise through a mask, and leave the way they came. */
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
const muted = { color: PALETTE.muted }

function Copy({ f }: { f: number }) {
  return (
    <>
      {/* Frame 0 says what this is: the thumbnail on X. */}
      <Words f={f} at={-20} leave={PUSH - 6} size={140} style={{ left: 128, top: 300 }}>Kova is live</Words>
      <Words f={f} at={-14} leave={PUSH - 4} size={140} style={{ left: 128, top: 452 }}>on <span style={{ color: V.coral }}>mainnet</span><Dot /></Words>
      <Words f={f} at={14} leave={PUSH - 2} size={38} weight={600} style={{ left: 134, top: 650, ...muted }}>Monad, chain 143.</Words>

      <Words f={f} at={PUSH + 8} leave={SHEET - 6} size={128} style={{ left: 128, top: 330 }}>A dollar</Words>
      <Words f={f} at={PUSH + 14} leave={SHEET - 4} size={128} style={{ left: 128, top: 470 }}>wallet<Dot /></Words>
      <Words f={f} at={PUSH + 34} leave={SHEET - 2} size={40} weight={600} style={{ left: 134, top: 660, ...muted }}>Face ID. No seed phrase.</Words>

      <Words f={f} at={SHEET + 10} leave={GIFT - 6} size={112} style={{ left: 128, top: 330 }}>Send to</Words>
      <Words f={f} at={SHEET + 16} leave={GIFT - 4} size={112} style={{ left: 128, top: 454 }}>any .nad name<Dot /></Words>
      <Words f={f} at={SHEET + 40} leave={GIFT - 2} size={40} weight={600} style={{ left: 134, top: 640, ...muted }}>Or by link. Gas is on us.</Words>
    </>
  )
}

/** One of Kova's balance cards, as on the giveaway poster. */
function Card({ label, fill, ink, chip }: { label: string; fill: string; ink: string; chip?: string }) {
  const ring = ink === V.ink ? 'rgba(11,26,29,.1)' : 'rgba(255,255,255,.14)'
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: fill,
        color: ink,
        border: `5px solid ${V.ink}`,
        borderRadius: 46,
        padding: '34px 40px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        overflow: 'hidden',
      }}
    >
      {[0, 60, 120].map((inset) => (
        <div key={inset} style={{ position: 'absolute', right: -120 + inset, top: -120 + inset, width: 420 - inset * 2, height: 420 - inset * 2, borderRadius: '50%', border: `4px solid ${ring}` }} />
      ))}
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 28, fontWeight: 700 }}>{label}</span>
        {chip ? <span style={{ fontSize: 22, fontWeight: 800, border: '3px solid currentColor', borderRadius: 16, padding: '3px 12px' }}>{chip}</span> : null}
      </div>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'baseline', gap: 14 }}>
        <b style={{ fontSize: 132, fontWeight: 800, letterSpacing: -6, lineHeight: 1 }}>+100</b>
        <span style={{ fontSize: 44, fontWeight: 800, letterSpacing: -1 }}>MON</span>
      </div>
      <div style={{ position: 'relative', fontSize: 22, fontWeight: 600, opacity: 0.85 }}>Sent on Monad</div>
    </div>
  )
}

const HAND = [
  { label: 'User 04', fill: V.ink, ink: '#fff', rot: -19, dx: -70, dy: 10 },
  { label: 'User 03', fill: PALETTE.tealSoft, ink: V.ink, rot: -9, dx: -30, dy: 0 },
  { label: 'User 02', fill: V.coral, ink: '#fff', rot: 2, dx: 10, dy: -4 },
  { label: 'User 01', fill: PALETTE.teal, ink: '#fff', rot: 11, dx: 56, dy: -10, chip: 'Could be you' },
]

/** The giveaway: four cards deal out of the phone's place, then stay for the ending. */
function Giveaway({ f }: { f: number }) {
  if (f < GIFT - 4) return null
  return (
    <div style={{ position: 'absolute', left: 990, top: 240, width: 820, height: 720 }}>
      {HAND.map((card, i) => {
        const p = spring({ frame: f - (GIFT + 6 + i * 5), fps: 30, config: { stiffness: 120, damping: 15 } })
        const q = Math.min(1, Math.max(0, p))
        return (
          <div
            key={card.label}
            style={{
              position: 'absolute',
              left: 130,
              top: 190,
              width: 600,
              height: 370,
              transformOrigin: '50% 120%',
              opacity: q,
              transform: `translate(${card.dx * p}px, ${card.dy * p + (1 - q) * 260}px) rotate(${card.rot * p}deg)`,
            }}
          >
            <Card label={card.label} fill={card.fill} ink={card.ink} chip={card.chip} />
          </div>
        )
      })}
    </div>
  )
}

function GiftCopy({ f }: { f: number }) {
  if (f < GIFT) return null
  return (
    <>
      <Words f={f} at={GIFT + 4} leave={END - 6} size={40} weight={600} style={{ left: 134, top: 300, ...muted }}>To celebrate:</Words>
      <Words f={f} at={GIFT + 10} leave={END - 4} size={150} style={{ left: 128, top: 360 }}>2,000 MON<Dot /></Words>
      <Words f={f} at={GIFT + 30} leave={END - 2} size={64} style={{ left: 132, top: 560, color: V.coral }}>100 each to the first 20.</Words>
    </>
  )
}

function Final({ f }: { f: number }) {
  if (f < END) return null
  const meta = ease(f, END + 4, END + 24)
  const url = settle(f, END + 22)
  return (
    <>
      <Brand x={128} y={92} opacity={meta} />
      <Words f={f} at={END + 4} size={44} weight={600} style={{ left: 134, top: 330, ...muted }}>First 20 get 100 MON.</Words>
      <Words f={f} at={END + 10} size={150} style={{ left: 128, top: 404 }}>Make your</Words>
      <Words f={f} at={END + 16} size={150} style={{ left: 128, top: 566 }}>wallet<Dot /></Words>
      <div
        style={{
          position: 'absolute',
          left: 134,
          top: 796,
          color: V.cream,
          background: V.ink,
          padding: '20px 32px',
          borderRadius: 99,
          fontWeight: 700,
          fontSize: 34,
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
  const at = GIFT + 30
  if (f < at) return null
  const p = settle(f, at)
  const hop = -Math.sin(ease(f, at, at + 18, inOut) * Math.PI) * 30
  const wave = Math.sin((f - END - 10) * 0.27) * Math.max(0, Math.min(1, (f - END - 10) / 6)) * Math.max(0, 1 - (f - END - 10) / 60)
  return (
    <KoviRig
      x={1640}
      y={318 + (1 - p) * 60 + hop}
      size={150}
      style={{ opacity: Math.min(1, p) }}
      pose={{
        look: { x: -0.7, y: 0.4 },
        mouth: 'grin',
        armL: -5 - wave * 28,
        armR: 35,
        waveLines: Math.max(0, Math.min(1, (f - END - 14) / 8)) * Math.max(0, 1 - (f - END - 50) / 30),
        lean: -wave * 1.5,
        happy: 0.25,
      }}
    />
  )
}

const At = ({ at, src, volume }: { at: number; src: string; volume: number }) => (
  <Sequence from={at} layout="none">
    <Html5Audio src={staticFile(src)} volume={volume} />
  </Sequence>
)

export function LaunchFilm() {
  const f = useCurrentFrame()
  const enter = ease(f, -12, 18)
  // The phone steps aside for the giveaway, and stays gone: the cards hold the right side.
  const away = ease(f, GIFT - 6, GIFT + 14, inOut)
  return (
    <AbsoluteFill style={{ fontFamily: 'Manrope', color: V.ink, overflow: 'hidden' }}>
      <Ground />
      <Copy f={f} />
      <GiftCopy f={f} />
      <Final f={f} />
      {away < 1 ? (
        <Device x={1330 + away * 700} y={548 + (1 - enter) * 40} h={990} screen={null} style={{ opacity: 1 - away * 0.6 }}>
          <Screen f={f} />
        </Device>
      ) : null}
      <Giveaway f={f} />
      <Kovi f={f} />

      <Html5Audio
        src={staticFile('wall/music/b.mp3')}
        volume={(fr) => 0.55 * interpolate(fr, [DURATION - 20, DURATION], [1, 0], clamp)}
      />
      <At at={TAP - 2} src="link/sfx/tap.mp3" volume={0.7} />
      <At at={PUSH - 1} src="link/sfx/swoosh.mp3" volume={0.35} />
      <At at={SHEET - 1} src="link/sfx/slide.mp3" volume={0.45} />
      <At at={GIFT + 4} src="queue/sfx/coin.mp3" volume={0.5} />
      <At at={GIFT + 30} src="audio/sfx/pop.mp3" volume={0.4} />
      <At at={END + 22} src="link/sfx/logo.mp3" volume={0.5} />
    </AbsoluteFill>
  )
}
