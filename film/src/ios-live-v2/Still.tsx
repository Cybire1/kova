import { AbsoluteFill, Img, staticFile } from 'remotion'
import { KoviRig } from '../KoviRig'
import { Device } from './Device'

export const V = { ink: '#0b1a1d', paper: '#e7e5e0', cream: '#f7f3e9', coral: '#d46558' }

export function Brand({ light = false, x = 120, y = 80, opacity = 1 }: { light?: boolean; x?: number; y?: number; opacity?: number }) {
  return <Img src={staticFile(`ios-live-v2/lockup${light ? '-light' : ''}.svg`)} style={{ position: 'absolute', left: x, top: y, width: 190, height: 61.75, opacity }} />
}

export function Ground() {
  return <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 43%, #fcfaf5 0%, #f2e7dc 45%, #e7e5e0 100%)' }} />
}

export function FinalText({ opacity = 1 }: { opacity?: number }) {
  return <AbsoluteFill style={{ opacity }}>
    <Brand />
    <div style={{ position: 'absolute', right: 120, top: 99, display: 'flex', gap: 11, alignItems: 'center', fontSize: 21, fontWeight: 700, letterSpacing: 1 }}><span style={{ background: V.coral, width: 9, height: 9, borderRadius: 99 }} />PUBLIC BETA</div>
    <div style={{ position: 'absolute', left: 126, top: 302, fontSize: 39, fontWeight: 600, letterSpacing: -1.1 }}>Kova for iOS.</div>
    <div style={{ position: 'absolute', left: 116, top: 410, fontSize: 190, fontWeight: 800, letterSpacing: -10, lineHeight: 1 }}>Now</div>
    <div style={{ position: 'absolute', left: 1311, top: 410, fontSize: 190, fontWeight: 800, letterSpacing: -10, lineHeight: 1, color: V.coral }}>live.</div>
    <div style={{ position: 'absolute', left: 1322, top: 666, fontSize: 27, fontWeight: 500 }}>Open to everyone.</div>
    <div style={{ position: 'absolute', left: 1312, top: 729, display: 'flex', alignItems: 'center', gap: 29, color: V.cream, background: V.ink, padding: '22px 28px', borderRadius: 99, fontWeight: 700, fontSize: 27 }}>Join on TestFlight <span style={{ fontSize: 35, lineHeight: 0.7 }}>↗</span></div>
    <div style={{ position: 'absolute', left: 1322, top: 831, fontSize: 20, fontWeight: 600, color: '#687371' }}>Link in post</div>
  </AbsoluteFill>
}

export function LaunchStill({ shot }: { shot: 'device' | 'opening' | 'ending' }) {
  if (shot === 'device') return <AbsoluteFill style={{ background: V.paper }}><Device x={960} y={540} h={1000} /></AbsoluteFill>
  return <AbsoluteFill style={{ fontFamily: 'Manrope', color: V.ink, overflow: 'hidden' }}>
    {shot === 'opening' ? <>
      <AbsoluteFill style={{ background: V.ink }} />
      <Brand light />
      <div style={{ position: 'absolute', left: 126, top: 258, color: V.cream, fontWeight: 800, fontSize: 236, letterSpacing: -12, lineHeight: 0.98 }}>Hello,<br />iOS<span style={{ color: V.coral }}>.</span></div>
      <div style={{ position: 'absolute', left: 1225, top: 365, width: 330, height: 330, overflow: 'hidden', borderRadius: 75, boxShadow: '0 36px 80px rgba(0,0,0,.36), inset 0 1px 1px rgba(255,255,255,.2)' }}>
        <Img src={staticFile('ios-live-v2/app-icon.png')} style={{ width: 330, height: 330 }} />
      </div>
      <div style={{ position: 'absolute', left: 136, bottom: 112, color: '#c3cbc6', fontWeight: 600, fontSize: 28 }}>Your dollars. Anywhere.</div>
    </> : <>
      <Ground />
      <FinalText />
      <Device x={960} y={540} h={870} />
      <KoviRig x={433} y={852} size={185} pose={{ look: { x: 1, y: -0.3 }, armR: 5, armL: -35, mouth: 'grin', waveLines: 1, happy: 0.2 }} />
    </>}
  </AbsoluteFill>
}
