/**
 * "Dollars for every phone", in the style of Kova's Metropolis demo (DemoFilm2): the real run, cut
 * tight, in time order. Your phone sends $1 to a phone number; their phone (no apps, no data) gets
 * the text, dials Kova's USSD code and sees the pocket; then the transaction on Monadscan.
 *
 * Footage: Downloads/kovaphone.mp4, recorded on Monad testnet with Africa's Talking's USSD
 * simulator. The recording's macOS zoom is undone frame by frame (scripts/kovaphone/register.py,
 * extract.py), so each phone is its own steady track (app.mp4, sim.mp4; track second 0 = 146 s in
 * the recording). Nothing is covered: the number and PIN are test values. The transaction is
 * 0x499b3e20…bc188 (Transfer 1 AUSD to the pocket 0x628e…7090, 2026-10-19 16:58:08 UTC).
 * Voice: ElevenLabs eleven_v4 (vo.json). Music: ElevenLabs (music-b), under the voice.
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
import { FPS } from '../motion'
import VO from './vo.json'

export const DEMO_DURATION = Math.round(39.5 * FPS)
const f = (s: number) => Math.round(s * FPS)
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

const APP = { src: 'kovaphone/app.mp4', w: 512, h: 1070 }
const SIM = { src: 'kovaphone/sim.mp4', w: 436, h: 904 }
const PH = 860

/** Where each voice line starts (seconds). */
const VOICE: Record<string, number> = { hook: 0.3, send: 5.1, slide: 8.2, text: 15.3, dial: 21.2, close: 33.3 }
const PROOF = 30.0
const END = 33.3

/** What a phone shows: a run of its track from track second `t` (at `rate`), a held frame, or an image. */
type Seg = { from: number; to: number } & ({ t: number; rate?: number } | { hold: number } | { img: string })
const APP_SEGS: Seg[] = [
  { from: 0, to: 4.6, hold: 3.6 }, // Home, $2.00
  { from: 4.6, to: 6.2, t: 3.7 }, // tap Send
  { from: 6.2, to: 7.3, t: 9.8 }, // Send to: a phone number
  // track 11.0-12.0 was filmed mid-zoom and can't be steadied: hold the last clean frame instead
  { from: 7.3, to: 8.0, hold: 10.9 },
  { from: 8.0, to: 10.0, t: 11.9 }, // the number, then $1
  { from: 10.0, to: 12.3, t: 14.0 }, // Check and send: slide
  { from: 12.3, to: 15.0, t: 16.3 }, // Sending… Sent, arrived in 1.31 s on Monad
  { from: 15.0, to: PROOF, hold: 19.2 },
]
const SIM_SEGS: Seg[] = [
  { from: 0, to: 15.2, img: 'kovaphone/sim-lock.png' }, // their phone, before the money
  { from: 15.2, to: 18.7, t: 24.0 }, // 1 unread message, Messages, the text
  { from: 18.7, to: 21.0, hold: 27.4 }, // $1.00 arrived in your USSD pocket. Balance $10.25
  { from: 21.0, to: 22.5, t: 41.5 }, // dial *384*53916#
  { from: 22.5, to: 24.75, t: 43.25 }, // Kova: 1 Balance, 2 Pay a till…
  { from: 24.75, to: 25.35, t: 45.6 }, // USSD code running
  { from: 25.35, to: 28.0, t: 46.5, rate: 1.5 }, // the PIN
  { from: 28.0, to: PROOF, hold: 51.5 }, // Pocket: $10.25
]

/**
 * The recording was zoomed in on the keypad and the slide button here, so the top of the phone was
 * never filmed: show it as the recording did, the lower part, rather than inventing the top.
 */
const appPush = (s: number) =>
  interpolate(s, [7.75, 8.0, 12.3, 12.55], [1, 1.22, 1.22, 1], clamp)

const PANEL = [
  { at: VOICE.hook, eyebrow: 'Kova on Monad', text: 'This phone has no apps, and no internet. Watch it get paid.' },
  { at: VOICE.send, eyebrow: 'Your phone', text: 'With Kova, you send dollars to a phone number.' },
  {
    at: VOICE.slide,
    eyebrow: 'Your phone',
    text: 'Pick the number, pick the amount, slide to send. It settles on Monad in about a second.',
    chips: ['$1.00', 'Fee $0.00', 'Arrived in 1.31 s'],
  },
  { at: VOICE.text, eyebrow: 'Their phone', text: 'A text: the dollars are in their Kova pocket.', chips: ['$1.00 arrived', 'Balance $10.25'] },
  {
    at: VOICE.dial,
    eyebrow: 'Their phone, no app',
    text: 'To spend it, they dial a short code, and enter their PIN.',
    chips: ['*384*53916#', 'Pocket: $10.25'],
  },
]

export function KovaPhoneDemo() {
  const [handle] = useState(() => delayRender('fonts'))
  useEffect(() => {
    manrope.then(() => continueRender(handle))
  }, [handle])

  return (
    <AbsoluteFill style={{ background: C.paper, fontFamily: 'Manrope' }}>
      <Sequence durationInFrames={f(PROOF)}>
        <AbsoluteFill>
          <PhoneTrack phone={APP} segs={APP_SEGS} x={110} label="Your phone · Kova" push={appPush} />
          <PhoneTrack phone={SIM} segs={SIM_SEGS} x={590} label="Their phone · no apps, no data" />
          <Lines items={PANEL} left={1110} width={700} />
        </AbsoluteFill>
      </Sequence>
      <Sequence from={f(PROOF)} durationInFrames={f(END - PROOF)}>
        <ExplorerScene />
      </Sequence>
      <Sequence from={f(END)}>
        <EndCard title="Dollars for every phone." foot="Recorded on Monad testnet with Africa’s Talking’s USSD simulator." />
      </Sequence>
      <Sound />
    </AbsoluteFill>
  )
}

/** The Monadscan page, as captured (scripts/kovaphone/scan.mjs), with what it proves in the bar. */
function ExplorerScene() {
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: '#fff' }}>
        <Img src={staticFile('kovaphone/scan-send.png')} style={{ width: 1920, height: 1080 }} />
      </AbsoluteFill>
      <div style={{ position: 'absolute', inset: 0 }}>
        <ExplorerBar />
      </div>
    </AbsoluteFill>
  )
}
function ExplorerBar() {
  return (
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
        fontFamily: 'Manrope',
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 26, letterSpacing: 2.5, textTransform: 'uppercase', color: C.coral, whiteSpace: 'nowrap' }}>
        Monadscan · Monad testnet
      </div>
      <div style={{ fontWeight: 700, fontSize: 36, color: C.surface, lineHeight: 1.2 }}>
        Transfer 1 AUSD to their USSD pocket, 0x628e…7090. Kova’s relayer paid the gas.
      </div>
    </div>
  )
}

/** A phone: its steady track at a fixed height, with a soft shadow and a label, like the demo's. */
function PhoneTrack({
  phone,
  segs,
  x,
  label,
  push,
}: { phone: { src: string; w: number; h: number }; segs: Seg[]; x: number; label: string; push?: (s: number) => number }) {
  const frame = useCurrentFrame()
  const zoom = push ? push(frame / FPS) : 1
  const w = (phone.w * PH) / phone.h
  return (
    <div style={{ position: 'absolute', left: x, top: 70, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <div style={{ position: 'relative', width: w, height: PH, borderRadius: 58, overflow: 'hidden', boxShadow: '0 30px 60px rgba(11,26,29,0.22)' }}>
        <div style={{ position: 'absolute', inset: 0, transform: `scale(${zoom})`, transformOrigin: '50% 100%' }}>
          {segs.map((g) => (
            <Sequence key={g.from} from={f(g.from)} durationInFrames={Math.max(1, f(g.to) - f(g.from))} layout="none">
              <Screen phone={phone} seg={g} w={w} h={PH} />
            </Sequence>
          ))}
        </div>
      </div>
      <div style={{ fontWeight: 700, fontSize: 26, color: C.muted }}>{label}</div>
    </div>
  )
}

function Screen({ phone, seg, w, h }: { phone: { src: string }; seg: Seg; w: number; h: number }) {
  const style = { position: 'absolute' as const, inset: 0, width: w, height: h, display: 'block' as const }
  if ('img' in seg) return <Img src={staticFile(seg.img)} style={style} />
  const start = 't' in seg ? seg.t : seg.hold
  const video = <OffthreadVideo src={staticFile(phone.src)} startFrom={f(start)} playbackRate={'t' in seg ? (seg.rate ?? 1) : 1} muted style={style} />
  return 'hold' in seg ? <Freeze frame={0}>{video}</Freeze> : video
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
        src={staticFile('kovaphone/music-b.mp3')}
        volume={(fr) => {
          const s = fr / FPS
          return (voiceOn(s) ? 0.14 : 0.3) * interpolate(s, [0, 0.6, 37.5, 39.5], [0, 1, 1, 0], clamp)
        }}
      />
      {lines.map((l) => (
        <Sequence key={l.id} from={f(VOICE[l.id]!)}>
          <Html5Audio src={staticFile(`kovaphone/vo-${l.id}.mp3`)} />
        </Sequence>
      ))}
      {cue(11.6, 'audio/sfx/swish.mp3', 0.7)}
      {cue(15.2, 'kovaphone/sms.wav', 0.3)}
      {cue(21.05, 'kovaphone/dtmf.wav', 0.12)}
      {cue(28.0, 'audio/sfx/chime.mp3', 0.22)}
      {cue(PROOF, 'audio/sfx/whoosh-real.wav', 0.18)}
      {cue(END, 'audio/sfx/whoosh-real.wav', 0.16)}
    </>
  )
}
