/**
 * "Everyone's watching": a 21-second announcement for private sends.
 *
 * On a city train, three strangers lean in to read Ada's phone: that's every payment on a public
 * blockchain. She turns on "Send privately" (the real app), and when they look again there's nothing
 * to read. Only Sam can open what she sent, her note included, and he spends it straight from there,
 * so his own wallet never shows up.
 *
 * Filmed like the café film ("Every table is a counter"): Higgsfield Soul stills animated with
 * Seedance (public/private/hf), the real Kova screens from one run on Monad testnet
 * (public/private/ada, public/private/sam), and one typographic system held all film: Manrope, the
 * first line red and the rest cream, words popping on hard, the title behind the people
 * (Apple Vision cut-outs) when it's over them. Cues: src/private/watching-cues.json.
 *
 *   0.0  the train, everyone leaning in   On a blockchain, / everyone's watching.
 *   4.6  Ada's phone, the real switch     Not anymore.
 *   8.4  the train, they give up          Who got it? / Nobody knows.
 *  11.2  the café, Sam's phone            Only Sam / can open it.
 *  14.8  he pays from private dollars     He spends it, / still private.
 *  17.9  ink                              Send privately. / Spend privately.  Kova
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
  if (t < a - 0.3 || t >= 7.0) return null
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

export function WatchingFilm({ sound = true, score = 'w1' }: { sound?: boolean; score?: string }) {
  const frame = useCurrentFrame()
  const t = frame / FPS
  const [handle] = useState(() => delayRender('Manrope'))
  useEffect(() => {
    manrope.then(() => continueRender(handle))
  }, [handle])

  const adaIn = rise(t, cues.phoneIn[0], cues.phoneIn[1] - cues.phoneIn[0])
  const samIn = rise(t, cues.samIn[0], cues.samIn[1] - cues.samIn[0])
  const ada = frameAt(cues.ada as [number, string][], t)
  const sam = frameAt(cues.sam as [number, string][], t)
  const hw = cues.hookWords
  const ww = cues.whoWords
  const ow = cues.onlyWords
  const sw = cues.spendWords
  const ew = cues.endWords

  return (
    <AbsoluteFill style={{ background: NIGHT }}>
      {/* 1. The train: everyone leaning in to read her phone. The title sits behind them. */}
      {t < cues.turn ? (
        <>
          <Clip src="private/hf/v1.mp4" from={0} dur={cues.turn} />
          <LowerShade />
          <Title t={t} out={cues.turn} x={78} y={640} width={900} lines={[{ text: 'On a blockchain,', at: hw.slice(0, 3) }, { text: 'everyone’s watching.', at: hw.slice(3) }]} />
        </>
      ) : null}

      {/* 2. Her phone, over the train: the real switch, the slide, sent privately. */}
      {t >= cues.turn && t < cues.payoff ? (
        <AbsoluteFill>
          <Plate src="private/hf/v1_end.jpg" />
          <Title t={t} out={cues.payoff} x={110} y={330} width={760} size={128} lines={[{ text: 'Not anymore.', at: cues.notWords }]} />
          <Note t={t} at={cues.adaNote} out={cues.payoff} x={116} y={500} text="Send privately: Monad sees it leave," />
          <Note t={t} at={cues.adaNote + 0.35} out={cues.payoff} x={116} y={544} text="not who it’s for." />
          <Note t={t} at={cues.sentRing + 0.1} out={cues.payoff} x={116} y={612} color={RED} text={`Landed in ${cues.run.sent_s} s on Monad.`} />
          <IPhone src={`private/ada/${ada}.png`} h={880} x={mix(2300, 1380, adaIn)} y={540} rotate={mix(8, -3, adaIn)} ry={-10}>
            <Tap t={t} at={cues.switchTap} x={geo.switch?.[0] ?? 1005} y={geo.switch?.[1] ?? 2001} />
            <Slide t={t} />
            <Ring t={t} at={cues.sentRing} box={geo.sent ?? [0, 0, 0, 0]} out={cues.payoff} />
          </IPhone>
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

      {/* 4–5. The café: only Sam can open it, and he spends it from there. */}
      {t >= cues.cafe && t < cues.end ? (
        <AbsoluteFill>
          <Plate src="private/hf/k3-2.png" dark={0.45} blur={30} />
          <Title t={t} out={cues.spend} x={110} y={300} width={720} size={118} lines={[{ text: 'Only Sam', at: ow.slice(0, 2) }, { text: 'can open it.', at: ow.slice(2) }]} />
          <Note t={t} at={cues.onlyNote} out={cues.spend} x={116} y={600} text="Even Ada’s note is sealed for him." />
          <Title t={t} out={cues.end} x={110} y={300} width={720} size={118} lines={[{ text: 'He spends it,', at: sw.slice(0, 3) }, { text: 'still private.', at: sw.slice(3) }]} />
          <Note t={t} at={cues.spendNote} out={cues.end} x={116} y={600} text="Paid from a one-time address." />
          <Note t={t} at={cues.spendNote + 0.35} out={cues.end} x={116} y={644} text="His wallet never shows." />
          <IPhone src={`private/sam/${sam}.png`} h={880} x={mix(2300, 1380, samIn)} y={540} rotate={mix(8, -3, samIn)} ry={-10}>
            <Ring t={t} at={cues.noteRing} box={geo.note ?? [0, 0, 0, 0]} out={cues.spend} />
            <Ring t={t} at={cues.fromRing} box={geo.from ?? [0, 0, 0, 0]} out={cues.payTap - 0.05} />
            <Tap t={t} at={cues.payTap} x={geo.pay?.[0] ?? 585} y={geo.pay?.[1] ?? 2349} />
            <Ring t={t} at={cues.paidRing} box={geo.paid ?? [0, 0, 0, 0]} out={cues.end} />
          </IPhone>
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
