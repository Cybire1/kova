/**
 * "Everyone's watching": a 32-second announcement for private sends.
 *
 * On a city train, three strangers lean in to read Ada's phone: that's every payment on a public
 * blockchain. The camera dives into her phone (the one signature move) and the real app fills the
 * frame: she turns on "Send privately", it lands in 1.00 s, and when the strangers look again
 * there's nothing to read. Only Sam can open it, her note included, and he spends it straight from
 * there, so his own wallet never shows up.
 *
 * Higgsfield shots (public/private/hf) and the real Kova screens from one run on Monad testnet
 * (public/private/ada, sam; run.json). The screens are shown at their own resolution when the camera
 * is close (h 2556 is one screen pixel per film pixel), so they stay crisp; three camera moves in all
 * (pull back from the switch, push into Sam's note, push into Paid), each motivated by what's on
 * screen. Every line holds long enough to read: about 15 characters a second after it's complete,
 * and never under 1.5 s. Cues: src/private/watching-cues.json.
 *
 *   0.0  the train, everyone leaning in      On a blockchain, / everyone's watching.
 *   4.5  dive into her phone: the switch     Not anymore.
 *   9.0  pull back: slide, sent in 1.00 s    Sent privately. / Landed in 1.00 s on Monad.
 *  13.6  the train, they give up             Who got it? / Nobody knows.
 *  17.0  Sam's phone, push into the note     Only Sam / can open it. / Even Ada's note is sealed for him.
 *  22.4  he pays from private dollars        He spends it, / still private. / Paid from a one-time address.
 *  28.0  ink                                 Send privately. / Spend privately.  Kova
 */
import { loadFont } from '@remotion/fonts'
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

/** A filmed shot at its own size: no push, no zoom, so it stays as sharp as it was made. */
function Clip({ src, from, dur }: { src: string; from: number; dur: number }) {
  return (
    <Sequence from={Math.round(from * FPS)} durationInFrames={Math.round(dur * FPS)} layout="none">
      <OffthreadVideo src={staticFile(src)} muted style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
    </Sequence>
  )
}

/** The people in a shot, cut out, laid over the title so it sits behind them. */
function Cutout({ src, from, dur }: { src: string; from: number; dur: number }) {
  return (
    <Sequence from={Math.round(from * FPS)} durationInFrames={Math.round(dur * FPS)} layout="none">
      <OffthreadVideo src={staticFile(src)} transparent muted style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
    </Sequence>
  )
}

/** The bottom of a shot, darkened so a title reads over it while the faces above stay as filmed. */
function LowerShade() {
  return <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(13,15,14,0) 38%, rgba(13,15,14,0.55) 62%, rgba(13,15,14,0.88) 100%)' }} />
}

/** A held, softened frame of a shot behind the phone, so the film never drops to black. */
function Plate({ src, dark = 0.5, blur = 34 }: { src: string; dark?: number; blur?: number }) {
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <Img src={staticFile(src)} style={{ position: 'absolute', inset: -80, width: 'calc(100% + 160px)', height: 'calc(100% + 160px)', objectFit: 'cover', filter: `blur(${blur}px) saturate(1.1)` }} />
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(13,15,14,${dark}) 0%, rgba(13,15,14,${dark + 0.15}) 100%)` }} />
    </AbsoluteFill>
  )
}

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

function Note({ t, at, out, text, x, y, color = CREAM }: { t: number; at: number; out: number; text: string; x: number; y: number; color?: string }) {
  if (t < at || t >= out) return null
  return <div style={{ position: 'absolute', left: x, top: y, fontFamily: 'Manrope', fontWeight: 700, fontSize: 30, letterSpacing: '-0.01em', color, whiteSpace: 'nowrap', textShadow: '0 2px 20px rgba(0,0,0,.45)' }}>{text}</div>
}

const flash = (t: number, at: number) => (t >= at && t < at + 1 / FPS ? 1 : 0)

function frameAt(list: [number, string][], t: number): string {
  let pick = list[0]?.[1] ?? ''
  for (const [at, value] of list) if (t >= at) pick = value
  return pick
}

// ——— The camera on a phone ——————————————————————————————————————————————————————————————

const SCREEN_H = 2556

/** Where the camera is: the phone's screen height `h`, the screen point (fx, fy) it frames, where that point sits in the film (cx, cy), and the turn. */
interface Cam {
  at: number
  h: number
  fx: number
  fy: number
  cx: number
  cy: number
  ry: number
}

/** The camera at t: held at each key, eased from one key to the next. */
function camAt(keys: Cam[], t: number): Omit<Cam, 'at'> {
  const first = keys[0] as Cam
  if (t <= first.at) return first
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i] as Cam
    const b = keys[i + 1] as Cam
    if (t <= b.at) {
      const p = easeInOut(span(t, a.at, b.at))
      return { h: mix(a.h, b.h, p), fx: mix(a.fx, b.fx, p), fy: mix(a.fy, b.fy, p), cx: mix(a.cx, b.cx, p), cy: mix(a.cy, b.cy, p), ry: mix(a.ry, b.ry, p) }
    }
  }
  return keys[keys.length - 1] as Cam
}

/** The phone's centre so the framed screen point lands where the camera wants it. */
function placed(c: Omit<Cam, 'at'>) {
  const k = c.h / SCREEN_H
  return { h: c.h, x: c.cx - (c.fx - SCREEN_W / 2) * k, y: c.cy - (c.fy - SCREEN_H / 2) * k, ry: c.ry }
}

const FULL = { h: 1000, fx: SCREEN_W / 2, fy: SCREEN_H / 2, cx: 1250, cy: 540, ry: -6 }

// ——— On a screen (screenshot pixels) ——————————————————————————————————————————————————

function Tap({ t, at, x, y }: { t: number; at: number; x: number; y: number }) {
  const ring = span(t, at, at + 0.45)
  if (t < at - 0.25 || ring >= 1) return null
  return ring > 0 ? <div style={{ position: 'absolute', left: x - 70 - 110 * ring, top: y - 70 - 110 * ring, width: 140 + 220 * ring, height: 140 + 220 * ring, borderRadius: '50%', border: `16px solid ${RED}`, opacity: 1 - ring }} /> : null
}

function Ring({ t, at, box, out }: { t: number; at: number; box: number[]; out: number }) {
  const draw = hero(span(t, at, at + 0.4))
  if (draw <= 0 || t >= out) return null
  const pad = 22
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = box
  const w = x1 - x0 + pad * 2
  const h = y1 - y0 + pad * 2
  const perimeter = 2 * (w + h)
  return (
    <svg style={{ position: 'absolute', left: x0 - pad - 10, top: y0 - pad - 10 }} width={w + 20} height={h + 20}>
      <rect x={10} y={10} width={w} height={h} rx={Math.min(h / 2, 70)} fill="none" stroke={RED} strokeWidth={13} strokeDasharray={perimeter} strokeDashoffset={perimeter * (1 - draw)} strokeLinecap="round" />
    </svg>
  )
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

export function WatchingFilm({ sound = true, score = 'w4' }: { sound?: boolean; score?: string }) {
  const frame = useCurrentFrame()
  const t = frame / FPS
  const [handle] = useState(() => delayRender('Manrope'))
  useEffect(() => {
    manrope.then(() => continueRender(handle))
  }, [handle])

  const ada = frameAt(cues.ada as [number, string][], t)
  const sam = frameAt(cues.sam as [number, string][], t)
  const hw = cues.hookWords
  const ww = cues.whoWords
  const ow = cues.onlyWords
  const sw = cues.spendWords
  const ew = cues.endWords
  const g = geo

  // The dive: the shot rushes toward her phone, then the real screen is there, close.
  const dive = span(t, cues.dive[0], cues.dive[1])
  const diveScale = 1 + 1.9 * dive * dive * dive
  // Ada's phone: close on the switch (drifting in to one-to-one), then the pull back to the whole phone.
  const adaCam = placed(
    camAt(
      [
        { at: cues.turn, h: 2300, fx: SCREEN_W / 2, fy: g.switch?.[1] ?? 2001, cx: 1340, cy: 560, ry: 0 },
        { at: cues.pullBack[0], h: SCREEN_H, fx: SCREEN_W / 2, fy: g.switch?.[1] ?? 2001, cx: 1340, cy: 560, ry: 0 },
        { at: cues.pullBack[1], ...FULL },
      ],
      t,
    ),
  )
  // Sam's phone: it comes up whole, then the camera pushes into Ada's sealed note.
  const samRise = rise(t, cues.samIn[0], cues.samIn[1] - cues.samIn[0])
  const samCam = placed(
    camAt(
      [
        { at: cues.pushNote[0], ...FULL },
        { at: cues.pushNote[1], h: SCREEN_H, fx: SCREEN_W / 2, fy: ((g.note?.[1] ?? 1743) + (g.note?.[3] ?? 2031)) / 2, cx: 1340, cy: 600, ry: 0 },
      ],
      t,
    ),
  )
  // Paying: the whole phone, then the camera pushes into "Paid!".
  const payCam = placed(
    camAt(
      [
        { at: cues.pushPaid[0], ...FULL },
        { at: cues.pushPaid[1], h: 1800, fx: SCREEN_W / 2, fy: ((g.paid?.[1] ?? 1329) + (g.paid?.[3] ?? 1582)) / 2, cx: 1250, cy: 560, ry: -2 },
      ],
      t,
    ),
  )

  return (
    <AbsoluteFill style={{ background: NIGHT }}>
      {/* 1. The train: everyone leaning in to read her phone. Then the dive into it. */}
      {t < cues.turn ? (
        <AbsoluteFill style={{ transform: `scale(${diveScale})`, transformOrigin: '885px 600px', filter: dive > 0 ? `blur(${9 * dive * dive}px)` : undefined }}>
          <Clip src="private/hf/v1.mp4" from={0} dur={cues.turn} />
          {dive <= 0 ? (
            <>
              <LowerShade />
              <Title t={t} out={cues.dive[0]} x={78} y={640} width={900} lines={[{ text: 'On a blockchain,', at: hw.slice(0, 3) }, { text: 'everyone’s watching.', at: hw.slice(3) }]} />
            </>
          ) : null}
        </AbsoluteFill>
      ) : null}

      {/* 2. In her phone: the real switch, close; then the pull back, the slide, sent in 1.00 s. */}
      {t >= cues.turn && t < cues.payoff ? (
        <AbsoluteFill>
          <Plate src="private/hf/v1_end.jpg" dark={0.62} blur={40} />
          <IPhone src={`private/ada/${ada}.png`} h={adaCam.h} x={adaCam.x} y={adaCam.y} ry={adaCam.ry}>
            <Tap t={t} at={cues.switchTap} x={g.switch?.[0] ?? 1002} y={g.switch?.[1] ?? 2001} />
            <Slide t={t} />
            <Ring t={t} at={cues.sentRing} box={g.sent ?? [0, 0, 0, 0]} out={cues.payoff} />
          </IPhone>
          <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(13,15,14,0.82) 0%, rgba(13,15,14,0.5) 34%, rgba(13,15,14,0) 48%)', pointerEvents: 'none' }} />
          <Title t={t} out={cues.pullBack[0] - 0.05} x={84} y={430} width={560} size={96} lines={[{ text: 'Not anymore.', at: cues.notWords }]} />
          <Title t={t} out={cues.payoff} x={84} y={380} width={560} size={100} lines={[{ text: 'Sent', at: [cues.sentWords[0] ?? 11] }, { text: 'privately.', at: [cues.sentWords[1] ?? 11.2] }]} />
          <Note t={t} at={cues.sentNote} out={cues.payoff} x={90} y={640} color={CREAM} text={`Landed in ${cues.run.sent_s} s on Monad.`} />
        </AbsoluteFill>
      ) : null}

      {/* 3. The train again: they lean back. Nothing to read. */}
      {t >= cues.payoff && t < cues.cafe ? (
        <>
          <Clip src="private/hf/v1_rev.mp4" from={cues.payoff} dur={cues.cafe - cues.payoff} />
          <LowerShade />
          <Title t={t} out={cues.cafe} x={78} y={640} width={640} lines={[{ text: 'Who got it?', at: ww.slice(0, 3) }, { text: 'Nobody knows.', at: ww.slice(3) }]} />
        </>
      ) : null}

      {/* 4. Sam's phone: Ada's money and her note, and only he can open them. */}
      {t >= cues.cafe && t < cues.spend ? (
        <AbsoluteFill>
          <Plate src="private/hf/k3-2.png" dark={0.55} blur={40} />
          <IPhone src={`private/sam/${sam}.png`} h={samCam.h} x={samCam.x} y={samCam.y + 700 * (1 - samRise)} ry={samCam.ry}>
            <Ring t={t} at={cues.noteRing} box={g.note ?? [0, 0, 0, 0]} out={cues.spend} />
          </IPhone>
          <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(13,15,14,0.82) 0%, rgba(13,15,14,0.5) 34%, rgba(13,15,14,0) 48%)', pointerEvents: 'none' }} />
          <Title t={t} out={cues.spend} x={84} y={360} width={560} size={96} lines={[{ text: 'Only Sam', at: ow.slice(0, 2) }, { text: 'can open it.', at: ow.slice(2) }]} />
          <Note t={t} at={cues.onlyNote} out={cues.spend} x={90} y={640} text="Even Ada’s note is sealed for him." />
        </AbsoluteFill>
      ) : null}

      {/* 5. He pays the café straight from his private dollars. */}
      {t >= cues.spend && t < cues.end ? (
        <AbsoluteFill>
          <Plate src="private/hf/k3-2.png" dark={0.55} blur={40} />
          <IPhone src={`private/sam/${sam}.png`} h={payCam.h} x={payCam.x} y={payCam.y} ry={payCam.ry}>
            <Ring t={t} at={cues.fromRing} box={g.from ?? [0, 0, 0, 0]} out={cues.payTap - 0.05} />
            <Tap t={t} at={cues.payTap} x={g.pay?.[0] ?? 586} y={g.pay?.[1] ?? 2349} />
            <Ring t={t} at={cues.paidRing} box={g.paid ?? [0, 0, 0, 0]} out={cues.end} />
          </IPhone>
          <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(13,15,14,0.82) 0%, rgba(13,15,14,0.5) 34%, rgba(13,15,14,0) 48%)', pointerEvents: 'none' }} />
          <Title t={t} out={cues.end} x={84} y={360} width={560} size={104} lines={[{ text: 'He spends it,', at: sw.slice(0, 3) }, { text: 'still private.', at: sw.slice(3) }]} />
          <Note t={t} at={cues.spendNote} out={cues.end} x={90} y={640} text="Paid from a one-time address." />
        </AbsoluteFill>
      ) : null}

      {/* 6. The line, and Kova. */}
      {t >= cues.end ? (
        <AbsoluteFill>
          <Plate src="private/hf/v1_end.jpg" dark={0.62} blur={40} />
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
      <AbsoluteFill style={{ background: '#fff', opacity: Math.max(flash(t, cues.turn), flash(t, cues.payoff), flash(t, cues.cafe), flash(t, cues.end)), pointerEvents: 'none' }} />
      <AbsoluteFill style={{ background: '#000', opacity: span(t, cues.duration - 0.7, cues.duration), pointerEvents: 'none' }} />
      {sound ? <Html5Audio src={staticFile(`private/sound-${score}.wav`)} /> : null}
    </AbsoluteFill>
  )
}
