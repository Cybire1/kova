import { AbsoluteFill, Easing, Html5Audio, interpolate, useCurrentFrame } from 'remotion'
import { staticFile } from 'remotion'
import { COLORS, EndCopy, Logo } from './Design'
import { Phone, type PhonePose } from './Phone'

export const IOS_LIVE_FRAMES = 360
const { paper, coral, ink, cream } = COLORS
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const out = Easing.bezier(0.16, 1, 0.3, 1)
const inOut = Easing.bezier(0.65, 0, 0.35, 1)
const lerp = (a: number, b: number, p: number) => a + (b - a) * p
const progress = (frame: number, a: number, b: number, ease = out) => interpolate(frame, [a, b], [0, 1], { ...clamp, easing: ease })

function phoneAt(f: number): PhonePose {
  if (f < 152) {
    const p = progress(f, 78, 123)
    const settle = progress(f, 123, 151, inOut)
    return {
      x: lerp(5.7, 2.9, p) - settle * 0.04,
      y: lerp(-0.22, 0.03, p), scale: lerp(0.86, 1.04, p),
      rx: lerp(-0.18, -0.07, p), ry: lerp(-1.34, -0.34, p) + settle * 0.025,
      rz: lerp(-0.18, -0.045, p),
    }
  }
  const p = progress(f, 152, 210, inOut)
  const swing = Math.sin(Math.PI * p)
  const drift = progress(f, 260, 359, Easing.inOut(Easing.sin))
  return {
    x: lerp(2.86, 2.76, p) - swing * 0.28,
    y: lerp(0.03, 0.04, p), scale: lerp(1.04, 1, p),
    rx: lerp(-0.07, 0, p) - swing * 0.025,
    ry: lerp(-0.315, -0.075, p) + swing * 0.44 + drift * 0.025,
    rz: lerp(-0.045, 0, p) + swing * 0.025,
  }
}

function Opening({ frame: f }: { frame: number }) {
  const leave = progress(f, 44, 62, inOut)
  const pulse = [17, 32, 47].reduce((v, at) => v + Math.max(0, 1 - Math.abs(f - at) / 10), 0)
  const enter = progress(f, 0, 22)
  return <AbsoluteFill style={{ background: paper, overflow: 'hidden' }}>
    <Logo style={{ position: 'absolute', left: 128, top: 110, opacity: 1 - leave }} />
    <div style={{ position: 'absolute', right: 128, top: 126, display: 'flex', alignItems: 'center', gap: 13, fontSize: 25, fontWeight: 650, opacity: 1 - leave }}>
      <div style={{ width: 12, height: 12, borderRadius: 99, background: coral, transform: `scale(${1 + pulse * 0.22})` }} />PUBLIC BETA
    </div>
    <div style={{ position: 'absolute', left: 390, top: 174, display: 'flex', fontSize: 620, fontWeight: 800, letterSpacing: -40, lineHeight: 1, transformOrigin: '570px 340px', transform: `scale(${lerp(1.035, 1, enter) + leave * 0.05})` }}>
      {['i', 'O', 'S'].map((letter, i) => {
        const p = progress(f, i * 3 - 6, 18 + i * 3)
        return <div key={letter} style={{ transform: `translate(${[-220, -40, 140][i]! * leave}px, ${(1 - p) * [40, -45, 55][i]! + leave * [95, -90, 130][i]!}px) rotate(${leave * [-7, -3, 6][i]!}deg)` }}>{letter}</div>
      })}
    </div>
    <div style={{ position: 'absolute', left: 1381, top: 637, width: 84, height: 84, borderRadius: 99, background: coral, transform: `scale(${1 + pulse * 0.085})` }} />
    {[17, 32, 47].map((at) => {
      const p = progress(f, at, at + 26, Easing.out(Easing.quad))
      const r = 44 + p * 94
      return <div key={at} style={{ position: 'absolute', left: 1423 - r, top: 679 - r, width: r * 2, height: r * 2, border: `2px solid ${coral}`, borderRadius: '50%', opacity: f < at ? 0 : (1 - p) * 0.4 }} />
    })}
    <div style={{ position: 'absolute', left: 136, bottom: 100, fontSize: 27, fontWeight: 600, opacity: 1 - leave }}>Ready when you are.</div>
    <div style={{ position: 'absolute', right: 130, bottom: 104, fontSize: 23, fontWeight: 600, opacity: 1 - leave }}>Tap. Paid. Anywhere.</div>
  </AbsoluteFill>
}

function Impact({ frame: f }: { frame: number }) {
  const reveal = progress(f, 47, 62, Easing.in(Easing.cubic))
  const retreat = progress(f, 152, 177, inOut)
  const radius = f < 100 ? lerp(42, 2300, reveal) : lerp(2300, 0, retreat)
  const centerX = lerp(1423, 1410, retreat)
  const centerY = lerp(679, 533, retreat)
  return <AbsoluteFill style={{ background: coral, clipPath: `circle(${radius}px at ${centerX}px ${centerY}px)`, overflow: 'hidden', color: cream }}>
    <Logo white style={{ position: 'absolute', left: 128, top: 110, opacity: 1 - progress(f, 145, 159) }} />
    <div style={{ position: 'absolute', left: 144, top: 280, display: 'flex', fontSize: 360, lineHeight: 1, letterSpacing: -22, fontWeight: 800, overflow: 'hidden', paddingBottom: 30 }}>
      {['L', 'I', 'V', 'E', '.'].map((letter, i) => {
        const e = progress(f, 62 + i * 3, 80 + i * 3)
        const l = progress(f, 143 + i * 2, 159 + i * 2, Easing.in(Easing.cubic))
        return <div key={i} style={{ color: letter === '.' ? ink : cream, transform: `translateY(${(1 - e) * 360 - l * 430}px)`, opacity: 1 - l }}>{letter}</div>
      })}
    </div>
    <div style={{ position: 'absolute', left: 156, bottom: 180, fontSize: 31, fontWeight: 600, opacity: progress(f, 78, 94) * (1 - progress(f, 143, 157)), transform: `translateY(${(1 - progress(f, 78, 94)) * 18}px)` }}>Kova for iOS.</div>
  </AbsoluteFill>
}

function LiveRings({ frame: f }: { frame: number }) {
  const fade = progress(f, 162, 202)
  const breathe = Math.sin((f - 175) * Math.PI / 70) * 5
  return <>{[560, 800, 1040, 1280].map((size, i) => {
    const p = progress(f, 160 + i * 7, 200 + i * 7)
    const s = size * lerp(0.65, 1, p) + breathe
    return <div key={size} style={{ position: 'absolute', left: 1378 - s / 2, top: 520 - s / 2, width: s, height: s, border: `1.4px solid ${coral}`, borderRadius: '50%', opacity: fade * 0.2 }} />
  })}</>
}

export function IosLiveFilm() {
  const f = useCurrentFrame()
  const ending = progress(f, 165, 200)
  return <AbsoluteFill style={{ background: paper, color: ink, fontFamily: 'Manrope', overflow: 'hidden' }}>
    {f < 63 ? <Opening frame={f} /> : null}
    {f >= 47 && f < 178 ? <Impact frame={f} /> : null}
    <LiveRings frame={f} />
    <div style={{ position: 'absolute', left: 1195, top: 980, width: 400, height: 40, background: `rgba(11,26,29,${ending * 0.17})`, borderRadius: '50%', filter: 'blur(30px)' }} />
    {f >= 173 ? <EndCopy frame={f} /> : null}
    {f >= 78 ? <Phone pose={phoneAt(f)} /> : null}
    <div style={{ position: 'absolute', left: 128, bottom: 49, right: 128, borderTop: '1px solid rgba(11,26,29,.14)', paddingTop: 20, display: 'flex', justifyContent: 'space-between', fontSize: 19, fontWeight: 600, opacity: progress(f, 241, 262) }}>
      <span>mykova.app</span><span>Built on Monad</span>
    </div>
    <Html5Audio src={staticFile('ios-live/score.wav')} />
  </AbsoluteFill>
}
