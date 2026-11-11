/**
 * "Dollars for every phone", two payments (KovaOfflineFilm, 16:9, ~61 s), in the style of Kova's
 * Metropolis demo: the real run, cut tight, in time order, then both transactions on Monadscan.
 *
 * Footage: Downloads/demokovaoffline.mp4, one unzoomed screen recording on Monad testnet with
 * Africa's Talking's USSD simulator. Both phones sit still in it, so each is a straight crop at its
 * own pixels (app.mp4 336x718 from 322,146; sim.mp4 292x604 from 1009,286), shown ~1.1-1.3x.
 *
 * Payment 1: $3.00 with the note "Chill" (tx 0xe7957e6d…d257, 16:56:31 UTC); their text reads
 * Balance $8.25. Payment 2: $1.00, arrived in 1.37 s (tx 0xa77fb146…4368, 16:56:58 UTC); their text
 * reads Balance $9.25, and dialling *384*53916# shows Pocket: $9.25. Both go to the USSD pocket
 * 0x628e…7090 and Kova's relayer paid the gas.
 *
 * Voice: ElevenLabs eleven_v4 (vo.json), shown as subtitles. Music: ElevenLabs, under the voice.
 */
import { useEffect, useState } from 'react'
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  Freeze,
  Html5Audio,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
} from 'remotion'
import { C, EndCard, Lines, manrope } from '../demo/parts'
import { decel, FPS } from '../motion'
import VO from './vo.json'

export const WIDTH = 1920
export const HEIGHT = 1080
export const DURATION = Math.round(61.5 * FPS)
const f = (s: number) => Math.round(s * FPS)
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

const APP = { src: 'kovaoffline/app.mp4', w: 336, h: 718 }
const SIM = { src: 'kovaoffline/sim.mp4', w: 292, h: 604 }
const PH = 800

/** Scene starts (seconds). */
const T = { send1: 6.0, text1: 17.0, send2: 23.5, text2: 32.6, dial: 37.6, scan1: 47.5, scan2: 51.0, end: 54.5 }
/** Where each voice line starts. */
const VOICE: Record<string, number> = {
  hook: 0.3,
  send1: 6.1,
  text1: 17.4,
  send2: 24.0,
  text2: 33.0,
  dial: 37.8,
  proof: 47.8,
  close: 54.8,
}

/** What a phone shows: a run of its source from second `t` (at `rate`), or one held source frame. */
type Seg = { from: number; to: number } & ({ t: number; rate?: number } | { hold: number })
const APP_SEGS: Seg[] = [
  { from: 0, to: T.send1, hold: 12.0 }, // Home, $6.00
  // Payment 1: $3.00 with a note
  { from: 6.0, to: 9.0, t: 37.0, rate: 1.5 }, // the number, typed: Send to +234…
  { from: 9.0, to: 10.5, t: 42.75 }, // Send to a phone: the form
  { from: 10.5, to: 11.5, t: 49.75 }, // $3
  { from: 11.5, to: 13.0, t: 54.0 }, // the note, "Chill"
  { from: 13.0, to: 13.6, t: 59.8 }, // Review transfer
  { from: 13.6, to: 15.6, t: 62.0 }, // $3.00 to +234…, goes directly to their USSD balance: slide
  { from: 15.6, to: 17.0, t: 64.0, rate: 2.36 }, // Sending… Receipt
  { from: 17.0, to: T.send2, hold: 68.0 }, // Receipt: -$3.00, took 1.6 s, fee $0.00
  // Payment 2: $1.00
  { from: 23.5, to: 25.2, t: 81.0, rate: 1.5 }, // Home $3.00, Send
  { from: 25.2, to: 26.7, t: 85.0, rate: 1.33 }, // their number, the keypad
  { from: 26.7, to: 28.3, t: 88.0, rate: 1.5 }, // $1
  { from: 28.3, to: 30.0, t: 90.5 }, // Check and send: slide
  { from: 30.0, to: 31.2, t: 92.2, rate: 2 }, // Sending…
  { from: 31.2, to: 32.6, t: 94.6 }, // Sent: arrived in 1.37 s on Monad
  { from: 32.6, to: T.scan1, hold: 96.0 },
]
const SIM_SEGS: Seg[] = [
  { from: 0, to: T.text1, hold: 30.0 }, // their phone, quiet
  { from: 17.0, to: 18.2, t: 68.0 }, // 1 unread message
  { from: 18.2, to: 20.2, t: 70.75 }, // Messages, the text
  { from: 20.2, to: T.send2, hold: 74.0 }, // $3.00 arrived in your USSD pocket. Balance $8.25
  { from: 23.5, to: T.text2, hold: 78.6 }, // quiet again
  { from: 32.6, to: 33.6, t: 95.2 }, // 1 unread message
  { from: 33.6, to: 35.6, t: 102.4 }, // the thread: $1.00 arrived. Balance $9.25
  { from: 35.6, to: T.dial, hold: 105.0 },
  { from: 37.6, to: 39.9, t: 119.0, rate: 1.5 }, // dial *384*53916#
  { from: 39.9, to: 42.2, t: 122.75, rate: 2 }, // Kova: 1 Balance…
  { from: 42.2, to: 44.5, t: 127.25, rate: 2 }, // the PIN
  { from: 44.5, to: T.scan1, hold: 132.4 }, // Pocket: $9.25
]

const PANEL = [
  { at: 0, eyebrow: 'Kova on Monad', text: 'Dollars to a phone with no apps and no internet.' },
  { at: T.send1, eyebrow: 'Payment 1 · your phone', text: '$3.00 to a phone number, with a note.', chips: ['$3.00', 'Note: “Chill”', 'Fee $0.00'] },
  { at: T.text1, eyebrow: 'Their phone', text: 'A text: $3.00 arrived in their USSD pocket.', chips: ['Balance $8.25'] },
  { at: T.send2, eyebrow: 'Payment 2 · your phone', text: '$1.00 more, from the keypad.', chips: ['$1.00', 'Arrived in 1.37 s', 'Fee $0.00'] },
  { at: T.text2, eyebrow: 'Their phone', text: 'Another text.', chips: ['$1.00 arrived', 'Balance $9.25'] },
  { at: T.dial, eyebrow: 'Their phone, no app', text: 'Dial *384*53916#, choose Balance, enter the PIN.', chips: ['Pocket: $9.25'] },
]

export function KovaOfflineFilm() {
  const [handle] = useState(() => delayRender('fonts'))
  useEffect(() => {
    manrope.then(() => continueRender(handle))
  }, [handle])
  return (
    <AbsoluteFill style={{ background: C.paper, fontFamily: 'Manrope' }}>
      <Sequence durationInFrames={f(T.scan1)}>
        <AbsoluteFill>
          <PhoneTrack phone={APP} segs={APP_SEGS} x={120} label="Your phone · Kova" />
          <PhoneTrack phone={SIM} segs={SIM_SEGS} x={570} label="Their phone · no apps, no data" />
          <Lines items={PANEL} left={1080} width={740} />
        </AbsoluteFill>
      </Sequence>
      <Sequence from={f(T.scan1)} durationInFrames={f(T.scan2 - T.scan1)}>
        <Scan src="kovaoffline/scan-1.png" n={1} caption="Payment 1: Transfer 3 AUSD to their USSD pocket, 0x628e…7090. Kova paid the gas." />
      </Sequence>
      <Sequence from={f(T.scan2)} durationInFrames={f(T.end - T.scan2)}>
        <Scan src="kovaoffline/scan-2.png" n={2} caption="Payment 2: Transfer 1 AUSD to the same pocket, 27 seconds later. Kova paid the gas." />
      </Sequence>
      <Sequence from={f(T.end)}>
        <EndCard title="Dollars for every phone." foot="Recorded on Monad testnet with Africa’s Talking’s USSD simulator." />
      </Sequence>
      <Subtitles />
      <Sound />
    </AbsoluteFill>
  )
}

function PhoneTrack({ phone, segs, x, label }: { phone: { src: string; w: number; h: number }; segs: Seg[]; x: number; label: string }) {
  const w = (phone.w * PH) / phone.h
  return (
    <div style={{ position: 'absolute', left: x, top: 56, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div style={{ position: 'relative', width: w, height: PH, borderRadius: 56, overflow: 'hidden', boxShadow: '0 30px 60px rgba(11,26,29,0.22)' }}>
        {segs.map((g) => (
          <Sequence key={g.from} from={f(g.from)} durationInFrames={Math.max(1, f(g.to) - f(g.from))} layout="none">
            <Screen phone={phone} seg={g} w={w} h={PH} />
          </Sequence>
        ))}
      </div>
      <div style={{ fontWeight: 700, fontSize: 24, color: C.muted }}>{label}</div>
    </div>
  )
}

function Screen({ phone, seg, w, h }: { phone: { src: string }; seg: Seg; w: number; h: number }) {
  const style = { position: 'absolute' as const, inset: 0, width: w, height: h, display: 'block' as const }
  const start = 't' in seg ? seg.t : seg.hold
  const video = <OffthreadVideo src={staticFile(phone.src)} startFrom={f(start)} playbackRate={'t' in seg ? (seg.rate ?? 1) : 1} muted style={style} />
  return 'hold' in seg ? <Freeze frame={0}>{video}</Freeze> : video
}

/** A transaction on Monadscan, as captured, with the rows that prove it outlined, then the bar. */
function Scan({ src, n, caption }: { src: string; n: number; caption: string }) {
  const frame = useCurrentFrame()
  const box = (at: number, x: number, y: number, w: number, h: number) => {
    const k = interpolate(frame - at, [0, 8], [0, 1], { ...clamp, easing: decel })
    return (
      <div
        style={{
          position: 'absolute',
          left: x - 8 * (1 - k),
          top: y - 8 * (1 - k),
          width: w + 16 * (1 - k),
          height: h + 16 * (1 - k),
          border: `4px solid ${C.coral}`,
          borderRadius: 14,
          opacity: k,
        }}
      />
    )
  }
  return (
    <AbsoluteFill style={{ background: '#fff' }}>
      <Img src={staticFile(src)} style={{ width: 1920, height: 1080 }} />
      {box(6, 286, 232, 600, 62)}
      {box(16, 628, 418, 96, 30)}
      {box(24, 628, 706, 700, 40)}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 132,
          background: C.ink,
          display: 'flex',
          alignItems: 'center',
          gap: 28,
          padding: '0 64px',
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 26, letterSpacing: 2.5, textTransform: 'uppercase', color: C.coral, whiteSpace: 'nowrap' }}>
          Monadscan · {n} of 2
        </div>
        <div style={{ fontWeight: 700, fontSize: 34, color: C.surface, lineHeight: 1.2 }}>{caption}</div>
      </div>
    </AbsoluteFill>
  )
}

/** The voice as subtitles: the whole line, each word lighting as it is said. */
function Subtitles() {
  const frame = useCurrentFrame()
  const s = frame / FPS
  const lines = VO.lines as { id: string; words: { text: string; start: number; end: number }[] }[]
  const line = lines.find((l) => s >= VOICE[l.id]! - 0.15 && s < VOICE[l.id]! + l.words[l.words.length - 1]!.end + 0.45)
  if (!line) return null
  const t = s - VOICE[line.id]!
  const onExplorer = s >= T.scan1 && s < T.end
  const onEnd = s >= T.end
  const fade = interpolate(t, [-0.15, 0.05], [0, 1], clamp) * interpolate(t, [line.words[line.words.length - 1]!.end + 0.25, line.words[line.words.length - 1]!.end + 0.45], [1, 0], clamp)
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: onExplorer ? 156 : onEnd ? 70 : 34, display: 'flex', justifyContent: 'center', opacity: fade }}>
      <div
        style={{
          maxWidth: 1500,
          background: 'rgba(11,26,29,0.88)',
          borderRadius: 18,
          padding: '12px 28px',
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          columnGap: 11,
          fontSize: 38,
          fontWeight: 700,
          letterSpacing: -0.4,
          lineHeight: 1.3,
        }}
      >
        {line.words.map((w) => (
          <span key={w.start} style={{ color: t >= w.start - 0.04 ? C.surface : 'rgba(241,239,234,0.38)' }}>
            {w.text}
          </span>
        ))}
      </div>
    </div>
  )
}

function Sound() {
  const lines = VO.lines as { id: string; duration: number }[]
  const voiceOn = (s: number) => lines.some((l) => s >= VOICE[l.id]! - 0.1 && s <= VOICE[l.id]! + l.duration + 0.15)
  const cue = (at: number, src: string, volume: number) => (
    <Sequence key={`${at}${src}`} from={f(at)} durationInFrames={f(3)}>
      <Html5Audio src={staticFile(src)} volume={volume} />
    </Sequence>
  )
  return (
    <>
      <Html5Audio
        src={staticFile('kovaoffline/music.mp3')}
        loop
        volume={(fr) => {
          const s = fr / FPS
          return (voiceOn(s) ? 0.13 : 0.28) * interpolate(s, [0, 0.6, 59.5, 61.5], [0, 1, 1, 0], clamp)
        }}
      />
      {lines.map((l) => (
        <Sequence key={l.id} from={f(VOICE[l.id]!)}>
          <Html5Audio src={staticFile(`kovaoffline/vo-${l.id}.mp3`)} />
        </Sequence>
      ))}
      {cue(15.2, 'audio/sfx/swish.mp3', 0.7)}
      {cue(17.25, 'kovaphone/sms.wav', 0.3)}
      {cue(29.8, 'audio/sfx/swish.mp3', 0.7)}
      {cue(32.85, 'kovaphone/sms.wav', 0.3)}
      {cue(38.5, 'kovaphone/dtmf.wav', 0.12)}
      {cue(44.5, 'audio/sfx/chime.mp3', 0.22)}
      {cue(T.scan1, 'audio/sfx/whoosh-real.wav', 0.18)}
      {cue(T.scan2, 'audio/sfx/whoosh-real.wav', 0.16)}
      {cue(T.end, 'audio/sfx/whoosh-real.wav', 0.16)}
    </>
  )
}
