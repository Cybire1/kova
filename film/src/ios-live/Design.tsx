import { AbsoluteFill, Easing, interpolate } from 'remotion'
import { Phone } from './Phone'

export const COLORS = { paper: '#F0D3C1', ink: '#0B1A1D', coral: '#D46558', cream: '#FBF6F2' }
const { paper, ink, coral, cream } = COLORS

export function Logo({ white = false, style }: { white?: boolean; style?: React.CSSProperties }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 11, ...style }}>
    <svg viewBox="0 0 200 200" width={50} height={50}>
      <path d="M62 46V154" stroke={white ? cream : ink} strokeWidth={19} strokeLinecap="round" />
      {['M92.6 74.3A40 40 0 0 1 92.6 125.7', 'M115.6 55A70 70 0 0 1 115.6 145', 'M138.6 35.7A100 100 0 0 1 138.6 164.3'].map((d) => <path key={d} d={d} fill="none" stroke={white ? cream : coral} strokeWidth={17} strokeLinecap="round" />)}
    </svg>
    <span style={{ fontSize: 49, fontWeight: 800, letterSpacing: -3, lineHeight: 1 }}>kova</span>
  </div>
}

export function Rings({ x = 1378, y = 520, color = coral, opacity = 0.2 }: { x?: number; y?: number; color?: string; opacity?: number }) {
  return <>{[560, 800, 1040, 1280].map((size) => <div key={size} style={{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size, border: `1.4px solid ${color}`, borderRadius: '50%', opacity }} />)}</>
}

export function EndCopy({ opacity = 1, dy = 0, frame = 360 }: { opacity?: number; dy?: number; frame?: number }) {
  const enter = (at: number, duration = 23) => interpolate(frame, [at, at + duration], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1) })
  const object = (at: number) => ({ opacity: enter(at), transform: `translateY(${(1 - enter(at)) * 24}px)` })
  return <div style={{ position: 'absolute', left: 128, top: 132, opacity, transform: `translateY(${dy}px)` }}>
    <Logo style={object(174)} />
    <div style={{ marginTop: 110, fontSize: 144, fontWeight: 800, lineHeight: 1.02, letterSpacing: -8.8 }}>
      <div style={{ overflow: 'hidden', paddingBottom: 6 }}><div style={{ transform: `translateY(${(1 - enter(184, 30)) * 158}px)` }}>Kova for iOS</div></div>
      <div style={{ overflow: 'hidden', paddingBottom: 6, marginTop: -6 }}><div style={{ color: coral, transform: `translateY(${(1 - enter(197, 28)) * 158}px)` }}>is live.</div></div>
    </div>
    <div style={{ ...object(212), fontSize: 31, fontWeight: 500, marginTop: 29, letterSpacing: -0.6 }}>Your dollars. In your hands.</div>
    <div style={{ ...object(228), marginTop: 68, display: 'flex', alignItems: 'center', gap: 22 }}>
      <div style={{ background: ink, color: cream, borderRadius: 99, padding: '23px 32px', fontSize: 30, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 32 }}>
        Join the public beta <span style={{ fontSize: 38, lineHeight: 0.8 }}>↗</span>
      </div>
    </div>
    <div style={{ ...object(237), marginTop: 23, color: '#536263', fontSize: 23, fontWeight: 600 }}>On TestFlight · Link in post</div>
  </div>
}

export function Design({ shot }: { shot: 'opening' | 'impact' | 'end' }) {
  return <AbsoluteFill style={{ background: shot === 'impact' ? coral : paper, color: shot === 'impact' ? cream : ink, fontFamily: 'Manrope', overflow: 'hidden' }}>
    {shot === 'opening' ? <>
      <Logo style={{ position: 'absolute', left: 128, top: 110 }} />
      <div style={{ position: 'absolute', right: 128, top: 126, display: 'flex', alignItems: 'center', gap: 13, fontSize: 25, fontWeight: 650 }}><div style={{ width: 12, height: 12, background: coral, borderRadius: '50%' }} />PUBLIC BETA</div>
      <div style={{ position: 'absolute', left: 390, top: 174, fontSize: 620, fontWeight: 800, letterSpacing: -40, lineHeight: 1 }}>iOS<span style={{ color: coral }}>.</span></div>
      <div style={{ position: 'absolute', left: 136, bottom: 100, fontSize: 27, fontWeight: 600 }}>Ready when you are.</div>
      <div style={{ position: 'absolute', right: 130, bottom: 104, fontSize: 23, fontWeight: 600 }}>Tap. Paid. Anywhere.</div>
    </> : null}
    {shot === 'impact' ? <>
      <Logo white style={{ position: 'absolute', left: 128, top: 110 }} />
      <div style={{ position: 'absolute', left: 144, top: 280, fontSize: 360, lineHeight: 1, letterSpacing: -27, fontWeight: 800 }}>LIVE<span style={{ color: ink }}>.</span></div>
      <div style={{ position: 'absolute', left: 156, bottom: 180, fontSize: 31, fontWeight: 600 }}>Kova for iOS.</div>
      <Phone pose={{ x: 3.0, y: 0, scale: 1.15, rx: -0.11, ry: -0.45, rz: -0.12 }} />
    </> : null}
    {shot === 'end' ? <>
      <Rings />
      <div style={{ position: 'absolute', left: 1195, top: 980, width: 400, height: 40, background: 'rgba(11,26,29,.17)', borderRadius: '50%', filter: 'blur(30px)' }} />
      <EndCopy />
      <Phone pose={{ x: 2.76, y: 0.04, scale: 1.0, rx: 0, ry: -0.075, rz: 0 }} />
      <div style={{ position: 'absolute', left: 128, bottom: 49, right: 128, borderTop: '1px solid rgba(11,26,29,.14)', paddingTop: 20, display: 'flex', justifyContent: 'space-between', fontSize: 19, fontWeight: 600 }}><span>mykova.app</span><span>Built on Monad</span></div>
    </> : null}
  </AbsoluteFill>
}
