/**
 * "Every table is a counter": a 34-second film. A café queue filmed like a commercial (Higgsfield
 * Soul stills animated with Seedance 2.0, public/queue/hf/), the real Kova screens from a real run
 * at Ada's Bakery on Monad testnet (public/spot/*.png, run.json), and one line at the end.
 *
 * Titles are one typographic system held all film: Kova's Manrope, sentence case, the first line red
 * and the rest cream, words popping on hard (no fades, no eases), and over people the title sits
 * behind them (Apple Vision cut-outs, *_cutout.webm). Cards sit on a softened frame of the café.
 *
 *   0.0  the buzzer goes dark          8:02 AM. / STILL WAITING.
 *   5.0  the queue, the empty tables   THE TABLES ARE EMPTY. / THE QUEUE ISN'T.
 *  10.0  ink                           WHAT IF EVERY TABLE / WAS THE COUNTER?
 *  12.5  table 3, behind her           0.76 SEC. / FROM TABLE 3.  then  ORDER READY. / AT YOUR TABLE.
 *  19.0  ink, the stamp card           BUY FIVE. / THE SIXTH IS FREE.
 *  24.0  the café, behind everyone     NO QUEUE. / NO BUZZER. / NO CARD MACHINE.
 *  29.5  ink                           EVERY TABLE / IS A COUNTER.  Kova
 */
import { loadFont } from '@remotion/fonts'
import type React from 'react'
import { useEffect, useState } from 'react'
import { AbsoluteFill, continueRender, delayRender, Html5Audio, Img, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion'
import run from '../../public/spot/run.json'
import { Mark } from '../atm/Textures'
import { IPhone } from '../iphone'
import { mix, span } from '../motion'
import { bounce, FPS, hero } from '../os/ui/kit'
import { Grain } from '../parts'

/** The film starts on the queue: the buzzer shot (0-5 s on this timeline) is cut. */
const START = 5
export const TABLE_DURATION = 29
const RED = '#E83425'
const CREAM = '#FAFAD8'
const NIGHT = '#0d0f0e'
const rise = (t: number, at: number, d = 0.5) => hero(span(t, at, at + d))

const manrope = loadFont({ family: 'Manrope', url: staticFile('fonts/Manrope_800ExtraBold.ttf'), weight: '800' })

/** The size at which a line of Manrope ExtraBold fills `width` (tracking -0.035em), measured in the browser. */
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
    <Sequence from={Math.round((from - START) * FPS)} durationInFrames={Math.round(dur * FPS)} layout="none">
      <OffthreadVideo src={staticFile(src)} muted style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
    </Sequence>
  )
}

/** A held, softened frame of a shot behind a card, so the film never drops to black. */
function Plate({ src, dark = 0.45 }: { src: string; dark?: number }) {
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <Img src={staticFile(src)} style={{ position: 'absolute', inset: -40, width: 'calc(100% + 80px)', height: 'calc(100% + 80px)', objectFit: 'cover', filter: 'blur(18px)' }} />
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(13,15,14,${dark}) 0%, rgba(13,15,14,${dark + 0.15}) 100%)` }} />
    </AbsoluteFill>
  )
}

/** The people in a shot, cut out, laid over the title so it sits behind them. */
function Cutout({ src, from, dur }: { src: string; from: number; dur: number }) {
  return (
    <Sequence from={Math.round((from - START) * FPS)} durationInFrames={Math.round(dur * FPS)} layout="none">
      <OffthreadVideo src={staticFile(src)} transparent muted style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
    </Sequence>
  )
}

interface Line {
  text: string
  /** When each word lands, in seconds: one per word. */
  at: number[]
}

/**
 * The title: Manrope, every line fitted to `width` so short lines go big, the first red and the rest cream. Each
 * word is on from its frame, at full size; nothing fades in. It leaves with the shot.
 */
function Title({ t, lines, x, y, width, out, align = 'left' }: { t: number; lines: Line[]; x: number; y: number; width: number; out: number; align?: 'left' | 'center' }) {
  if (t < (lines[0]?.at[0] ?? 0) || t >= out) return null
  let top = 0
  return (
    <div style={{ position: 'absolute', left: align === 'center' ? x - width / 2 : x, top: y, width }}>
      {lines.map((line, l) => {
        const fontSize = fitSize(line.text, width)
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
        // Manrope's capitals sit from about 0.2 to 0.92 of the size: stack the lines a hair apart.
        const next = lines[l + 1] ? fitSize(lines[l + 1]!.text, width) : 0
        top += fontSize * 1.08 - next * 0.2
        return row
      })}
    </div>
  )
}

/** A small label in the same voice, for a number from the real run. */
function Note({ t, at, out, text, x, y, color = CREAM }: { t: number; at: number; out: number; text: string; x: number; y: number; color?: string }) {
  if (t < at || t >= out) return null
  return <div style={{ position: 'absolute', left: x, top: y, fontFamily: 'Manrope', fontWeight: 700, fontSize: 30, letterSpacing: '-0.01em', color, whiteSpace: 'nowrap', textShadow: '0 2px 20px rgba(0,0,0,.45)' }}>{text}</div>
}

/** A white frame between two moments: one frame, then the next shot. */
const flash = (t: number, at: number) => (t >= at && t < at + 1 / FPS ? 1 : 0)

export function TableFilm({ sound = true }: { sound?: boolean }) {
  const frame = useCurrentFrame()
  const t = frame / FPS + START
  const [handle] = useState(() => delayRender('Manrope'))
  useEffect(() => {
    Promise.all([manrope]).then(() => continueRender(handle))
  }, [handle])

  // Table 3: the phone comes in over her shot and plays the real screens.
  const phone = rise(t, 13.0, 0.7) * (1 - span(t, 18.4, 19.0))
  const screen = t < 15.9 ? 'spot/stall-table.png' : 'spot/ready.png'
  const tap = span(t, 14.3, 14.7)
  const stamps = Array.from({ length: run.every }, (_, i) => 20.2 + i * 0.28)
  const free = rise(t, 21.9, 0.6)
  return (
    <AbsoluteFill style={{ background: NIGHT }}>
      {/* 1. The buzzer goes dark. */}
      {t < 5.0 ? (
        <>
          <Clip src="queue/hf/v1.mp4" from={0} dur={5.0} />
          <Title t={t} out={5.0} x={84} y={70} width={640} lines={[{ text: '8:02 am.', at: [0.7, 0.95] }, { text: 'Still waiting.', at: [1.4, 1.75] }]} />
        </>
      ) : null}

      {/* 2. The queue, and the tables nobody sits at. */}
      {t >= 5.0 && t < 10.0 ? (
        <>
          <Clip src="queue/hf/v2.mp4" from={5.0} dur={5.0} />
          <Title t={t} out={10.0} x={84} y={600} width={1000} lines={[{ text: 'The tables are empty.', at: [5.5, 5.72, 5.94, 6.2] }, { text: "The queue isn't.", at: [6.9, 7.15, 7.5] }]} />
        </>
      ) : null}

      {/* 3. The question, on ink. */}
      {t >= 10.0 && t < 12.5 ? (
        <AbsoluteFill>
          <Plate src="queue/hf/v2_end.jpg" />
          <Title t={t} out={12.5} x={960} y={300} width={1240} align="center" lines={[{ text: 'What if every table', at: [10.1, 10.3, 10.5, 10.7] }, { text: 'was the counter?', at: [11.0, 11.2, 11.5] }]} />
        </AbsoluteFill>
      ) : null}

      {/* 4. Table 3: she pays from her table; the title sits behind her. */}
      {t >= 12.5 && t < 19.0 ? (
        <>
          <Clip src="queue/hf/v3.mp4" from={12.5} dur={6.5} />
          <Title t={t} out={16.0} x={48} y={70} width={540} lines={[{ text: `Paid in ${run.seconds} s.`, at: [14.8, 14.95, 15.1, 15.2] }, { text: `From table ${run.table}.`, at: [15.25, 15.4, 15.55] }]} />
          <Title t={t} out={19.0} x={48} y={70} width={540} lines={[{ text: 'Order ready.', at: [16.1, 16.3] }, { text: 'At your table.', at: [16.6, 16.8, 17.0] }]} />
          <Cutout src="queue/hf/v3_cutout.webm" from={12.5} dur={6.5} />
          {phone > 0 ? (
            <IPhone src={screen} h={820} x={mix(2300, 1460, phone)} y={540} rotate={mix(8, -3, phone)} ry={-10}>
              {tap > 0 && tap < 1 ? <div style={{ position: 'absolute', left: 590 - 320 * tap, top: 1180 - 320 * tap, width: 640 * tap, height: 640 * tap, borderRadius: '50%', border: `18px solid ${RED}`, opacity: 1 - tap }} /> : null}
            </IPhone>
          ) : null}
          <Note t={t} at={14.8} out={16.0} text="Paid on Monad · $0.00 in fees" x={74} y={960} />
        </>
      ) : null}

      {/* 5. The stamp card, on ink. */}
      {t >= 19.0 && t < 24.0 ? (
        <AbsoluteFill>
          <Plate src="queue/hf/v3_end.jpg" dark={0.5} />
          <Title t={t} out={24.0} x={110} y={170} width={880} lines={[{ text: 'Buy five.', at: [19.15, 19.4] }, { text: 'The sixth is free.', at: [19.7, 19.85, 20.0, 20.15] }]} />
          <div style={{ position: 'absolute', left: 110, top: 700, display: 'flex', gap: 22 }}>
            {stamps.map((at, i) => (
              <div key={i} style={{ width: 118, height: 118, borderRadius: 59, border: `5px solid ${t >= at ? RED : 'rgba(250,250,216,0.35)'}`, background: t >= at ? RED : 'transparent', transform: `scale(${t >= at ? 0.75 + 0.25 * bounce(t, at) : 1})` }} />
            ))}
            <div style={{ width: 118, height: 118, borderRadius: 59, border: `5px solid ${CREAM}`, background: t >= 21.6 ? CREAM : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Manrope', fontWeight: 800, fontSize: 26, color: t >= 21.6 ? RED : CREAM, transform: `scale(${t >= 21.6 ? 0.8 + 0.2 * bounce(t, 21.6) : 1})` }}>Free</div>
          </div>
          <Note t={t} at={22.3} out={24.0} text="No sign-up. Your wallet is the card." x={112} y={850} />
          {free > 0 ? <IPhone src="spot/free.png" h={780} x={mix(2300, 1530, free)} y={540} rotate={mix(8, -3, free)} ry={-10} /> : null}
          <Note t={t} at={22.9} out={24.0} text="Paid $0.00 · still a receipt on Monad" x={1250} y={70} color={RED} />
        </AbsoluteFill>
      ) : null}

      {/* 6. The café, full and easy; the title behind everyone. */}
      {t >= 24.0 && t < 29.5 ? (
        <>
          <Clip src="queue/hf/v4.mp4" from={24.0} dur={5.6} />
          <Title t={t} out={29.5} x={960} y={30} width={760} align="center" lines={[{ text: 'No queue.', at: [24.5, 24.75] }, { text: 'No buzzer.', at: [25.3, 25.55] }, { text: 'No card machine.', at: [26.1, 26.35, 26.6] }]} />
          <Cutout src="queue/hf/v4_cutout.webm" from={24.0} dur={5.6} />
        </>
      ) : null}

      {/* 7. The line, and Kova. */}
      {t >= 29.5 ? (
        <AbsoluteFill>
          <Plate src="queue/hf/v4_end.jpg" dark={0.4} />
          <Title t={t} out={START + TABLE_DURATION} x={960} y={200} width={1180} align="center" lines={[{ text: 'Every table', at: [29.65, 29.9] }, { text: 'is a counter.', at: [30.25, 30.45, 30.7] }]} />
          <div style={{ position: 'absolute', left: 0, right: 0, top: 820, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 30, opacity: t >= 31.4 ? 1 : 0 }}>
            <Mark h={64} color={CREAM} accent={RED} />
            <span style={{ fontFamily: 'Manrope', fontWeight: 800, fontSize: 40, letterSpacing: '-0.02em', color: CREAM }}>mykova.app</span>
          </div>
        </AbsoluteFill>
      ) : null}

      <Grain frame={frame} />
      {/* One white frame at the turns: into the question, into the stamps, into the end. */}
      <AbsoluteFill style={{ background: '#fff', opacity: Math.max(flash(t, 10.0), flash(t, 19.0), flash(t, 29.5)), pointerEvents: 'none' }} />
      <AbsoluteFill style={{ background: '#000', opacity: 1 - span(t, START, START + 0.3) + span(t, START + TABLE_DURATION - 0.7, START + TABLE_DURATION), pointerEvents: 'none' }} />
      {sound ? <Html5Audio src={staticFile('queue/hf/sound-29.wav')} /> : null}
    </AbsoluteFill>
  )
}
