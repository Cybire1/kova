import type { CSSProperties } from 'react'
import { AbsoluteFill, Easing, Html5Audio, Img, interpolate, spring, staticFile, useCurrentFrame } from 'remotion'
import { KoviRig } from '../KoviRig'
import { Device, DEVICE } from './Device'
import { Brand, Ground, V } from './Still'

export const DURATION = 270
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const decel = Easing.bezier(0.16, 1, 0.3, 1)
const inOut = Easing.bezier(0.65, 0, 0.35, 1)
const ease = (f: number, a: number, b: number, e = decel) => interpolate(f, [a, b], [0, 1], { ...clamp, easing: e })
const mix = (a: number, b: number, p: number) => a + (b - a) * p
const settle = (f: number, at: number, heavy = false) => spring({ frame: f - at, fps: 30, config: heavy ? { mass: 1.2, stiffness: 110, damping: 24 } : { stiffness: 160, damping: 19 } })

/** Large words travel through a mask. They retain the same letter spacing at all times. */
function Word({ children, frame, at, leave, size, style, distance = 1.03 }: {
  children: React.ReactNode; frame: number; at: number; leave?: number; size: number; style?: CSSProperties; distance?: number
}) {
  const e = ease(frame, at, at + 22)
  const l = leave === undefined ? 0 : ease(frame, leave, leave + 15, Easing.in(Easing.cubic))
  return <div style={{ position: 'absolute', overflow: 'hidden', paddingBottom: size * 0.08, ...style }}>
    <div style={{ fontSize: size, fontWeight: 800, lineHeight: 0.98, letterSpacing: -size * 0.052, whiteSpace: 'nowrap', transform: `translateY(${(1 - e) * size * distance - l * size * 1.2}px)`, opacity: 1 - l }}>{children}</div>
  </div>
}

function Intro({ frame: f }: { frame: number }) {
  const leave = ease(f, 43, 64, inOut)
  return <>
    <Brand light opacity={1 - leave} />
    <Word frame={f} at={-22} leave={44} size={236} distance={0.05} style={{ left: 126, top: 258, color: V.cream }}>Hello,</Word>
    <Word frame={f} at={-5} leave={48} size={236} style={{ left: 126, top: 491, color: V.cream }}>iOS<span style={{ color: V.coral }}>.</span></Word>
    <div style={{ position: 'absolute', left: 136, bottom: 112, color: '#c3cbc6', fontWeight: 600, fontSize: 28, opacity: 1 - leave, transform: `translateY(${-leave * 16}px)` }}>Your dollars. Anywhere.</div>
  </>
}

function Final({ frame: f }: { frame: number }) {
  const meta = ease(f, 108, 131)
  const label = ease(f, 120, 143)
  const button = settle(f, 145)
  return <>
    <Brand opacity={meta} />
    <div style={{ position: 'absolute', right: 120, top: 99, display: 'flex', gap: 11, alignItems: 'center', fontSize: 21, fontWeight: 700, letterSpacing: 1, opacity: label }}>
      <span style={{ background: V.coral, width: 9, height: 9, borderRadius: 99 }} />PUBLIC BETA
    </div>
    <div style={{ position: 'absolute', left: 126, top: 302, fontSize: 39, fontWeight: 600, letterSpacing: -1.1, opacity: meta, transform: `translateY(${(1 - meta) * 20}px)` }}>Kova for iOS.</div>
    <Word frame={f} at={108} size={190} style={{ left: 116, top: 410 }}>Now</Word>
    <Word frame={f} at={120} size={190} style={{ left: 1311, top: 410, color: V.coral }}>live.</Word>
    <div style={{ position: 'absolute', left: 1322, top: 666, fontSize: 27, fontWeight: 500, opacity: label }}>Open to everyone.</div>
    <div style={{ position: 'absolute', left: 1312, top: 729, display: 'flex', alignItems: 'center', gap: 29, color: V.cream, background: V.ink, padding: '22px 28px', borderRadius: 99, fontWeight: 700, fontSize: 27, opacity: Math.min(1, Math.max(0, button)), transform: `translateY(${(1 - button) * 24}px)` }}>
      Join on TestFlight <span style={{ fontSize: 35, lineHeight: 0.7 }}>↗</span>
    </div>
    <div style={{ position: 'absolute', left: 1322, top: 831, fontSize: 20, fontWeight: 600, color: '#687371', opacity: ease(f, 153, 169) }}>Link in post</div>
  </>
}

function AppIcon({ frame: f }: { frame: number }) {
  const travel = ease(f, 43, 80, inOut)
  const tap = Math.sin(ease(f, 35, 44, inOut) * Math.PI)
  const fade = 1 - ease(f, 91, 102)
  const bob = Math.sin(f / 30 * 2.1) * 5 * (1 - travel)
  const x = mix(1390, 960, travel)
  const y = mix(530 + bob, 540, travel)
  const size = mix(330, 96, travel) * (1 - tap * 0.055)
  return <div style={{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size, borderRadius: size * 0.225, overflow: 'hidden', opacity: fade, transform: `rotate(${(1 - travel) * Math.sin(f / 42) * 1.4}deg)`, boxShadow: `0 ${18 * (1 - travel)}px ${50 * (1 - travel)}px rgba(0,0,0,.34), 0 0 0 1px rgba(255,255,255,${(1 - travel) * 0.08})` }}>
    <Img src={staticFile('ios-live-v2/app-icon.png')} style={{ width: size, height: size }} />
    <div style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', boxShadow: 'inset 0 1.5px 1px rgba(255,255,255,.18)', background: 'linear-gradient(135deg, rgba(255,255,255,.045), transparent 48%)' }} />
  </div>
}

/** The real capture opens inside the physical screen, on the same point as the travelling icon. */
function AppOpening({ frame: f }: { frame: number }) {
  const p = ease(f, 82, 113, inOut)
  const w = mix(300, DEVICE.screen.w, p)
  const h = mix(300, DEVICE.screen.h, p)
  const r = mix(68, DEVICE.screen.r, p)
  const offsetX = (DEVICE.screen.w - w) / 2
  const offsetY = (DEVICE.screen.h - h) / 2
  const innerScale = DEVICE.screen.w / DEVICE.image.w
  const innerH = DEVICE.image.h * innerScale
  return <>
    <AbsoluteFill style={{ background: V.ink }} />
    <AbsoluteFill style={{ clipPath: `inset(${offsetY}px ${offsetX}px round ${r}px)`, opacity: ease(f, 85, 96) }}>
      <AbsoluteFill style={{ background: '#e7e5e0' }} />
      <Img src={staticFile('private/sam/01-home-before.png')} style={{ position: 'absolute', left: 0, top: (DEVICE.screen.h - innerH) / 2, width: DEVICE.screen.w, height: innerH }} />
      <div style={{ position: 'absolute', left: 392 * innerScale, top: (DEVICE.screen.h - innerH) / 2 + 25 * innerScale, width: 400 * innerScale, height: 127 * innerScale, background: '#e7e5e0' }} />
    </AbsoluteFill>
  </>
}

function Kovi({ frame: f }: { frame: number }) {
  if (f < 132) return null
  const p = settle(f, 132)
  const hop = -Math.sin(ease(f, 132, 152, inOut) * Math.PI) * 36
  const wave = Math.sin((f - 166) * 0.27) * Math.max(0, 1 - (f - 166) / 80)
  const blink = Math.max(0, 1 - Math.abs(f - 218) / 3)
  return <KoviRig x={433} y={852 + (1 - p) * 70 + hop} size={185} style={{ opacity: Math.min(1, p) }} pose={{
    look: { x: 0.8, y: -0.2 }, mouth: 'grin', armR: 5 + wave * 28, armL: -35,
    waveLines: Math.max(0, Math.min(1, (f - 160) / 8)) * Math.max(0, 1 - (f - 190) / 35),
    blink, lean: wave * 1.5, happy: 0.2,
  }} />
}

export function Film() {
  const f = useCurrentFrame()
  const arrival = ease(f, 51, 86, decel)
  const paperReveal = ease(f, 57, 86, inOut)
  const cx = mix(1260, 960, paperReveal)
  const cy = 540
  const paperRadius = mix(0, 1800, paperReveal)
  // A breath of motion remains on the paper, while the captured screen stays perfectly sharp.
  return <AbsoluteFill style={{ background: V.ink, overflow: 'hidden', color: V.ink, fontFamily: 'Manrope' }}>
    <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 72% 43%, #173e3c 0%, #0b1a1d 52%)' }} />
    {f < 67 ? <Intro frame={f} /> : null}
    {f >= 57 ? <AbsoluteFill style={{ clipPath: `circle(${paperRadius}px at ${cx}px ${cy}px)` }}><Ground /></AbsoluteFill> : null}
    {f >= 51 ? <Device x={960} y={mix(790, 540, arrival)} h={mix(770, 870, arrival)} screen={f >= 113 ? 'ios-live-v2/screen-master.png' : null} style={{ opacity: arrival }}>{f < 113 ? <AppOpening frame={f} /> : null}</Device> : null}
    {f < 103 ? <AppIcon frame={f} /> : null}
    {f >= 106 ? <Final frame={f} /> : null}
    <Kovi frame={f} />
    <Html5Audio src={staticFile('ios-live-v2/score.wav')} />
  </AbsoluteFill>
}
