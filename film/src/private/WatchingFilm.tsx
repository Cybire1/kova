/**
 * "Everyone's watching": a 36-second announcement for private sends.
 *
 * On a city train, three strangers lean in to read Ada's phone: that's every payment on a public
 * blockchain. She turns on "Send privately" in the real app, it lands in 1.00 s, and when they look
 * again there's nothing to read. Only Sam can open it, her note included, and he spends it straight
 * from there, so his own wallet never shows up.
 *
 * Higgsfield shots (public/private/hf) and the real Kova screens from one run on Monad testnet
 * (public/private/ada, sam; run.json). The phone stays a calm size in the scene and barely moves; the
 * one thing on its screen that matters lifts out toward you, at the screenshot's own resolution, while
 * the phone falls back behind it. No zooms, no flashes: the train racks out of focus into the phone
 * and back. Every line holds long enough to read (about 15 characters a second after it lands, never
 * under 1.5 s); each lifted card holds 2 to 3.5 s. Cues: src/private/watching-cues.json.
 *
 *   0.0  the train, everyone leaning in      On a blockchain, / everyone's watching.
 *   5.0  her phone: the switch, lifted       Not anymore.
 *  10.0  the slide; "Sent privately" lifted   Sent privately.
 *  15.0  the train, they give up             Who got it? / Nobody knows.
 *  18.4  Sam's phone: the note, lifted       Only Sam / can open it.
 *  23.8  Pay from private dollars; Paid      He spends it, / still private.
 *  31.8  ink                                 Send privately. / Spend privately.  Kova
 */
import { loadFont } from '@remotion/fonts'
import type React from 'react'
import { useEffect, useState } from 'react'
import { AbsoluteFill, continueRender, delayRender, Html5Audio, Img, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion'
import { Mark } from '../atm/Textures'
import { IPhone } from '../iphone'
import { easeInOut, mix, span } from '../motion'
import { bounce, FPS, hero } from '../os/ui/kit'
import { Grain } from '../parts'
import cues from './watching-cues.json'

export const WATCHING_DURATION = cues.duration
const RED = '#E83425'
const CREAM = '#FAFAD8'
const NIGHT = '#0d0f0e'
const SCREEN_W = 1179
const SCREEN_H = 2556
const rise = (t: number, at: number, d = 0.5) => hero(span(t, at, at + d))
const ease = (t: number, a: number, b: number) => easeInOut(span(t, a, b))
const geo = cues.geo as Record<string, number[]>

const manrope = Promise.all(
  [
    ['700', 'Manrope_700Bold'],
    ['800', 'Manrope_800ExtraBold'],
  ].map(([weight, file]) => loadFont({ family: 'Manrope', url: staticFile(`fonts/${file}.ttf`), weight })),
)

function fitSize(text: string, width: number) {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return 100
  ctx.font = '800 100px Manrope'
  const at100 = ctx.measureText(text).width - (text.length - 1) * 3.5
  return (width / at100) * 100
}

/** A filmed shot at its own size, with an optional focus pull (blur in film pixels). */
function Clip({ src, from, dur, blur = 0 }: { src: string; from: number; dur: number; blur?: number }) {
  return (
    <Sequence from={Math.round(from * FPS)} durationInFrames={Math.round(dur * FPS)} layout="none">
      <OffthreadVideo src={staticFile(src)} muted style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: blur > 0.05 ? `blur(${blur}px)` : undefined }} />
    </Sequence>
  )
}

/** The bottom of a shot, darkened so a title reads over it while the faces above stay as filmed. */
function LowerShade() {
  return <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(13,15,14,0) 38%, rgba(13,15,14,0.55) 62%, rgba(13,15,14,0.88) 100%)' }} />
}

/** The scene behind the phone, out of focus: the train or the café it's in. */
function Plate({ src, dark = 0.58, blur = 36 }: { src: string; dark?: number; blur?: number }) {
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <Img src={staticFile(src)} style={{ position: 'absolute', inset: -80, width: 'calc(100% + 160px)', height: 'calc(100% + 160px)', objectFit: 'cover', filter: `blur(${blur}px) saturate(1.1)` }} />
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(13,15,14,${dark}) 0%, rgba(13,15,14,${dark + 0.12}) 100%)` }} />
    </AbsoluteFill>
  )
}

/** The left of the frame, deepened so the words sit on calm ground beside the phone. */
const LeftShade = () => <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(13,15,14,0.78) 0%, rgba(13,15,14,0.45) 34%, rgba(13,15,14,0) 52%)', pointerEvents: 'none' }} />

interface Line {
  text: string
  at: number[]
}

/** The title: every line Manrope ExtraBold, fitted to `width` unless `size` is given; the first red, the rest cream. */
function Title({ t, lines, x, y, width, out, align = 'left', size }: { t: number; lines: Line[]; x: number; y: number; width: number; out: number; align?: 'left' | 'center'; size?: number }) {
  const sizeOf = (text: string) => size ?? fitSize(text, width)
  if (t < (lines[0]?.at[0] ?? 0) || t >= out) return null
  let top = 0
  return (
    <div style={{ position: 'absolute', left: align === 'center' ? x - width / 2 : x, top: y, width }}>
      {lines.map((line, l) => {
        const fontSize = sizeOf(line.text)
        const words = line.text.split(' ')
        const row = (
          <div key={l} style={{ position: 'absolute', top, left: 0, width, display: 'flex', justifyContent: align === 'center' ? 'center' : 'flex-start', fontFamily: 'Manrope', fontWeight: 800, fontSize, lineHeight: 1, letterSpacing: '-0.035em', color: l === 0 ? RED : CREAM, whiteSpace: 'pre', textShadow: '0 2px 6px rgba(0,0,0,.35), 0 4px 28px rgba(0,0,0,.45)' }}>
            {words.map((w, i) => (
              <span key={i} style={{ opacity: t >= (line.at[i] ?? line.at[line.at.length - 1] ?? 0) ? 1 : 0 }}>
                {w}
                {i < words.length - 1 ? ' ' : ''}
              </span>
            ))}
          </div>
        )
        const next = lines[l + 1] ? sizeOf(lines[l + 1]!.text) : 0
        top += fontSize * 1.16 - next * 0.2
        return row
      })}
    </div>
  )
}

function frameAt(list: [number, string][], t: number): string {
  let pick = list[0]?.[1] ?? ''
  for (const [at, value] of list) if (t >= at) pick = value
  return pick
}

// ——— The phone, and what lifts out of it ———————————————————————————————————————————————

interface Placement {
  h: number
  x: number
  y: number
}

/** Where the phone sits: a calm size on the right, drifting in by 2% over a scene, no more. */
function phoneAt(t: number, from: number, to: number): Placement {
  return { h: 940 * (1 + 0.02 * span(t, from, to)), x: 1290, y: 540 }
}

/** A point on the phone's screen (screenshot pixels) in the frame. */
function onScreen(p: Placement, sx: number, sy: number): [number, number] {
  const k = p.h / SCREEN_H
  return [p.x + (sx - SCREEN_W / 2) * k, p.y + (sy - SCREEN_H / 2) * k]
}

interface LiftSpec {
  screen: string
  box: number[]
  radius: number
}

/** How far a lift is out of the phone at t: 0 in the screen, 1 held in front of it. */
function liftAmount(t: number, s: number[]) {
  const [a = 0, b = 0] = s
  return hero(span(t, a, a + 0.6)) * (1 - ease(t, b - 0.35, b))
}

/**
 * One piece of the screen coming forward: it leaves its place on the phone and settles larger, in
 * front of it and a little to the left, with a soft shadow. Drawn from the same screenshot, never
 * past one screenshot pixel per film pixel, so its words stay crisp.
 */
function Lift({ t, spec, phone, span: s, width = 860 }: { t: number; spec: LiftSpec; phone: Placement; span: number[]; width?: number }) {
  const p = liftAmount(t, s)
  if (p <= 0) return null
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = spec.box
  const k = phone.h / SCREEN_H
  const [sx, sy] = onScreen(phone, x0, y0)
  const endScale = Math.min(1, width / (x1 - x0))
  const endW = (x1 - x0) * endScale
  const endH = (y1 - y0) * endScale
  const endX = 1180 - endW / 2
  const endY = Math.min(Math.max(sy + ((y1 - y0) * k) / 2 - endH / 2, 120), 1080 - 90 - endH)
  return (
    <div
      style={{
        position: 'absolute',
        left: mix(sx, endX, p),
        top: mix(sy, endY, p),
        width: x1 - x0,
        height: y1 - y0,
        transform: `scale(${mix(k, endScale, p)})`,
        transformOrigin: '0 0',
        borderRadius: spec.radius,
        overflow: 'hidden',
        boxShadow: `0 ${mix(4, 40, p)}px ${mix(10, 90, p)}px rgba(0,0,0,${mix(0.1, 0.5, p)})`,
      }}
    >
      <Img src={staticFile(`private/${spec.screen}.png`)} style={{ position: 'absolute', left: -x0, top: -y0, width: SCREEN_W, height: SCREEN_H }} />
    </div>
  )
}

/** The phone, a little see-through at rest, falling back while something lifts out of it. */
function Phone({ src, phone, back, children }: { src: string; phone: Placement; back: number; children?: React.ReactNode }) {
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: mix(0.9, 0.42, back), filter: back > 0.02 ? `blur(${2 * back}px)` : undefined, transform: `scale(${1 - 0.02 * back})`, transformOrigin: `${phone.x}px ${phone.y}px` }}>
      <IPhone src={src} h={phone.h} x={phone.x} y={phone.y} ry={-5}>
        {children}
      </IPhone>
    </div>
  )
}

// ——— On a screen (screenshot pixels) ——————————————————————————————————————————————————

function Tap({ t, at, x, y }: { t: number; at: number; x: number; y: number }) {
  const ring = span(t, at, at + 0.45)
  if (t < at - 0.25 || ring >= 1) return null
  return ring > 0 ? <div style={{ position: 'absolute', left: x - 70 - 110 * ring, top: y - 70 - 110 * ring, width: 140 + 220 * ring, height: 140 + 220 * ring, borderRadius: '50%', border: `16px solid ${RED}`, opacity: 1 - ring }} /> : null
}

/** Ada's slide: the knob travels the track and red fills behind it. */
function Slide({ t }: { t: number }) {
  const [a, b] = cues.slide as [number, number]
  if (t < a - 0.3 || t >= Number((cues.ada as [number, string][])[2]?.[0] ?? b + 0.1)) return null
  const p = ease(t, a, b)
  const x = mix(147, 1030, p)
  const y = geo.slideY?.[0] ?? 2238
  return (
    <>
      <div style={{ position: 'absolute', left: 52, top: y - 102, width: x + 98 - 52, height: 204, borderRadius: 102, background: RED }} />
      <div style={{ position: 'absolute', left: x - 92, top: y - 92, width: 184, height: 184, borderRadius: '50%', background: CREAM, border: `18px solid ${RED}`, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width={70} height={70} viewBox="0 0 24 24" fill="none" stroke={NIGHT} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </div>
    </>
  )
}

// ——— The film ——————————————————————————————————————————————————————————————————————————

export function WatchingFilm({ sound = true, score = 'w5' }: { sound?: boolean; score?: string }) {
  const frame = useCurrentFrame()
  const t = frame / FPS
  const [handle] = useState(() => delayRender('Manrope'))
  useEffect(() => {
    manrope.then(() => continueRender(handle))
  }, [handle])

  const ada = frameAt(cues.ada as [number, string][], t)
  const sam = frameAt(cues.sam as [number, string][], t)
  const lifts = cues.lifts as Record<string, LiftSpec>
  const hw = cues.hookWords
  const ww = cues.whoWords
  const ow = cues.onlyWords
  const sw = cues.spendWords
  const ew = cues.endWords

  const adaPhone = phoneAt(t, cues.turn, cues.payoff)
  const samPhone = phoneAt(t, cues.cafe, cues.end)
  const adaIn = rise(t, cues.adaIn[0], cues.adaIn[1] - cues.adaIn[0])
  const samIn = rise(t, cues.samIn[0], cues.samIn[1] - cues.samIn[0])
  const adaBack = Math.max(liftAmount(t, cues.lift1), liftAmount(t, cues.lift2))
  const samBack = Math.max(liftAmount(t, cues.lift3), liftAmount(t, cues.lift4), liftAmount(t, cues.lift5))
  const focusOut = span(t, cues.focusOut[0], cues.focusOut[1])
  const focusIn = 1 - span(t, cues.focusIn[0], cues.focusIn[1])

  return (
    <AbsoluteFill style={{ background: NIGHT }}>
      {/* 1. The train: everyone leaning in to read her phone; then it racks out of focus. */}
      {t < cues.turn ? (
        <>
          <Clip src="private/hf/v1.mp4" from={0} dur={cues.turn} blur={36 * focusOut * focusOut} />
          <AbsoluteFill style={{ background: NIGHT, opacity: 0.58 * focusOut }} />
          <LowerShade />
          <Title t={t} out={cues.focusOut[0] + 0.15} x={78} y={640} width={900} lines={[{ text: 'On a blockchain,', at: hw.slice(0, 3) }, { text: 'everyone’s watching.', at: hw.slice(3) }]} />
        </>
      ) : null}

      {/* 2. Her phone: the switch, and what it means, lifted out; the slide; sent privately. */}
      {t >= cues.turn && t < cues.payoff ? (
        <AbsoluteFill>
          <Plate src="private/hf/v1_end.jpg" />
          <div style={{ position: 'absolute', inset: 0, opacity: adaIn, transform: `translateY(${40 * (1 - adaIn)}px)` }}>
            <Phone src={`private/ada/${ada}.png`} phone={adaPhone} back={adaBack}>
              <Tap t={t} at={cues.switchTap} x={geo.switch?.[0] ?? 1002} y={geo.switch?.[1] ?? 2001} />
              <Slide t={t} />
            </Phone>
          </div>
          <LeftShade />
          <Lift t={t} spec={lifts.lift1 as LiftSpec} phone={adaPhone} span={cues.lift1} />
          <Lift t={t} spec={lifts.lift2 as LiftSpec} phone={adaPhone} span={cues.lift2} width={820} />
          <Title t={t} out={cues.slide[0] - 0.1} x={84} y={180} width={560} size={96} lines={[{ text: 'Not anymore.', at: cues.notWords }]} />
          <Title t={t} out={cues.payoff} x={84} y={150} width={560} size={96} lines={[{ text: 'Sent', at: [cues.sentWords[0] ?? 11] }, { text: 'privately.', at: [cues.sentWords[1] ?? 11.2] }]} />
        </AbsoluteFill>
      ) : null}

      {/* 3. The train again, coming back into focus: they lean back. Nothing to read. */}
      {t >= cues.payoff && t < cues.cafe ? (
        <>
          <Clip src="private/hf/v1_rev.mp4" from={cues.payoff} dur={cues.cafe - cues.payoff} blur={30 * focusIn * focusIn} />
          <AbsoluteFill style={{ background: NIGHT, opacity: 0.5 * focusIn }} />
          <LowerShade />
          <Title t={t} out={cues.cafe} x={78} y={640} width={640} lines={[{ text: 'Who got it?', at: ww.slice(0, 3) }, { text: 'Nobody knows.', at: ww.slice(3) }]} />
        </>
      ) : null}

      {/* 4–5. Sam's phone: the note only he can open; then he pays from his private dollars. */}
      {t >= cues.cafe && t < cues.end ? (
        <AbsoluteFill>
          <Plate src="private/hf/k3-2.png" />
          <div style={{ position: 'absolute', inset: 0, opacity: samIn, transform: `translateY(${40 * (1 - samIn)}px)` }}>
            <Phone src={`private/sam/${sam}.png`} phone={samPhone} back={samBack}>
              <Tap t={t} at={cues.payTap} x={geo.pay?.[0] ?? 586} y={geo.pay?.[1] ?? 2349} />
            </Phone>
          </div>
          <LeftShade />
          <Lift t={t} spec={lifts.lift3 as LiftSpec} phone={samPhone} span={cues.lift3} />
          <Lift t={t} spec={lifts.lift4 as LiftSpec} phone={samPhone} span={cues.lift4} />
          <Lift t={t} spec={lifts.lift5 as LiftSpec} phone={samPhone} span={cues.lift5} width={640} />
          <Title t={t} out={cues.spend} x={84} y={150} width={560} size={96} lines={[{ text: 'Only Sam', at: ow.slice(0, 2) }, { text: 'can open it.', at: ow.slice(2) }]} />
          <Title t={t} out={cues.end} x={84} y={150} width={560} size={96} lines={[{ text: 'He spends it,', at: sw.slice(0, 3) }, { text: 'still private.', at: sw.slice(3) }]} />
        </AbsoluteFill>
      ) : null}

      {/* 6. The line, and Kova. */}
      {t >= cues.end ? (
        <AbsoluteFill>
          <Plate src="private/hf/v1_end.jpg" dark={0.64} blur={40} />
          <Title t={t} out={cues.duration} x={960} y={300} width={1400} align="center" size={120} lines={[{ text: 'Send privately.', at: ew.slice(0, 2) }, { text: 'Spend privately.', at: ew.slice(2) }]} />
          {t >= cues.mark ? (
            <div style={{ position: 'absolute', left: 0, right: 0, top: 680, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 30, transform: `scale(${0.88 + 0.12 * bounce(t, cues.mark)})` }}>
              <Mark h={64} color={CREAM} accent={RED} />
              <span style={{ fontFamily: 'Manrope', fontWeight: 800, fontSize: 40, letterSpacing: '-0.02em', color: CREAM }}>mykova.app</span>
            </div>
          ) : null}
          {t >= cues.proof ? (
            <div style={{ position: 'absolute', left: 0, right: 0, top: 790, textAlign: 'center', fontFamily: 'Manrope', fontWeight: 700, fontSize: 28, color: 'rgba(250,250,216,0.72)' }}>A real run on Monad testnet · announced with ERC-5564 · {cues.run.tx}</div>
          ) : null}
        </AbsoluteFill>
      ) : null}

      <Grain frame={frame} />
      <AbsoluteFill style={{ background: '#000', opacity: span(t, cues.duration - 0.7, cues.duration), pointerEvents: 'none' }} />
      {sound ? <Html5Audio src={staticFile(`private/sound-${score}.wav`)} /> : null}
    </AbsoluteFill>
  )
}
