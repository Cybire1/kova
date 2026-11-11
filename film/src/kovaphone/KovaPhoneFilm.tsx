/**
 * "Dollars for every phone" (KovaPhoneFilm, 16:9, ~37.5 s): a real Kova send to a phone number,
 * recorded on Monad testnet with Africa's Talking's USSD simulator (Downloads/kovaphone.mp4).
 *
 * Governing idea: two phones. Your phone (Kova) on the left, theirs (no apps, no data) on the right,
 * one path between them that Kovi flies when the money moves. The film opens on the end (their
 * phone lighting up with the money), then shows how.
 *
 * Footage: the recording's macOS zoom is undone frame by frame (scripts/kovaphone/register.py,
 * extract.py), so each phone is its own steady track at 1.5x its unzoomed size (app.mp4 512x1070,
 * sim.mp4 436x904, starting at the recording's 146 s). The recipient's phone number and the PIN are
 * covered wherever OCR found them (masks.json). Voice: ElevenLabs eleven_v4 (vo.json). Music:
 * ElevenLabs (music-b, 120 BPM, beats at 0.11 + 0.5k s; its lift at 15.9 s is Kovi's landing).
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
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import { C, manrope } from '../demo/parts'
import { decel, easeInOut, FPS } from '../motion'
import { bezier, type Curve, Grain, Kovi } from '../parts'
import VO from './vo.json'

export const WIDTH = 1920
export const HEIGHT = 1080
export const DURATION = Math.round(37.5 * FPS)
const f = (s: number) => Math.round(s * FPS)
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

// ── the two phones ───────────────────────────────────────────────────────────────────────────
const APP = { src: 'kovaphone/app.mp4', w: 512, h: 1070 }
const SIM = { src: 'kovaphone/sim.mp4', w: 436, h: 904 }
const PH = 860 // both phones the same height on stage
const LAYOUT = { app: { cx: 610, top: 92 }, sim: { cx: 1310, top: 92 } }
/** Your phone once the money has landed: stepped left and back. Callouts use the space it leaves. */
const APP_BACK = { cx: 330, h: 700 }
const GAP = 800 // the middle of the space between the phones after that

/**
 * The camera pushes in on the keypad and the slide button while the voice names them. It also keeps
 * the top of the screen out of shot there: those rows were off-screen under the recording's zoom.
 */
function appPush(s: number) {
  return interpolate(s, [8.2, 8.7, 12.5, 13.0], [1, 1.24, 1.24, 1], { ...clamp, easing: easeInOut })
}

/** What a phone shows: a run of its track (from track second `t`, at `rate`), a held track frame, or an image. */
type Seg = { from: number; to: number } & ({ t: number; rate?: number } | { hold: number } | { img: string })
const VOICE: Record<string, number> = { hook: 0.25, send: 5.3, slide: 8.6, text: 16.5, dial: 21.5, close: 28.6 }
const T = {
  twoPhones: 5.0, // the app slides in beside their phone
  sent: 14.1, // "Sent", arrived in 1.31 s on Monad
  fly: 15.1, // Kovi leaves the app...
  land: 16.11, // ...and lands on their phone on the music's lift
  result: 27.61, // "Pocket: $10.25"
  end: 30.8, // the end card, on "Dollars"
}
const APP_SEGS: Seg[] = [
  { from: 0, to: 5.0, t: 3.6 }, // (off stage until it slides in)
  { from: 5.0, to: 6.6, t: 3.7 }, // Home, $2.00: tap Send
  { from: 6.6, to: 8.4, t: 9.8 }, // Send to: a phone number
  { from: 8.4, to: 10.4, t: 11.9 }, // the number, then $1
  { from: 10.4, to: 12.7, t: 14.0 }, // Check and send: slide
  { from: 12.7, to: T.sent, t: 16.3, rate: 1.5 }, // Sending… Sent
  { from: T.sent, to: 37.5, hold: 19.2 }, // Sent: arrived in 1.31 s on Monad
]
const SIM_SEGS: Seg[] = [
  { from: 0, to: 0.55, img: 'kovaphone/sim-lock.png' }, // their phone, quiet
  { from: 0.55, to: 1.5, hold: 24.3 }, // it lights up: 1 unread message
  { from: 1.5, to: 2.1, t: 25.5 }, // Messages
  { from: 2.1, to: 5.0, hold: 27.0 }, // the texts: $1.00 arrived in your USSD pocket
  { from: 5.0, to: T.land, img: 'kovaphone/sim-lock.png' }, // rewind: before the money
  { from: T.land, to: 17.4, hold: 24.3 }, // it lights up again
  { from: 17.4, to: 18.0, t: 25.5 },
  { from: 18.0, to: 21.3, hold: 27.0 },
  { from: 21.3, to: 22.8, t: 41.5 }, // dial *384*53916#
  { from: 22.8, to: 25.0, t: 43.25 }, // Kova: 1 Balance, 2 Pay a till…
  { from: 25.0, to: 25.6, t: 45.6 }, // USSD code running
  { from: 25.6, to: T.result, t: 46.5, rate: 2 }, // the PIN (covered)
  { from: T.result, to: 37.5, hold: 51.5 }, // Pocket: $10.25
]
/** Nothing is covered: the number and PIN are test values, shown as recorded. */
const NO_MASKS = (_tt: number): number[][] => []
const segAt = (segs: Seg[], s: number) => segs.find((g) => s >= g.from && s < g.to) ?? segs[segs.length - 1]
const trackSecond = (g: Seg, s: number) => ('t' in g ? g.t + (s - g.from) * (g.rate ?? 1) : 'hold' in g ? g.hold : null)

export function KovaPhoneFilm() {
  const [handle] = useState(() => delayRender('fonts'))
  useEffect(() => {
    manrope.then(() => continueRender(handle))
  }, [handle])
  const frame = useCurrentFrame()
  const s = frame / FPS

  // the stage: their phone alone and big, then both side by side
  const k = interpolate(s, [T.twoPhones, T.twoPhones + 0.7], [0, 1], { ...clamp, easing: easeInOut })
  const simH = PH + (900 - PH) * (1 - k)
  const simCx = 960 + (LAYOUT.sim.cx - 960) * k
  const simTop = 90 + (LAYOUT.sim.top - 90) * k
  const back = interpolate(s, [T.land + 0.1, T.land + 0.8], [0, 1], { ...clamp, easing: easeInOut })
  const appX = LAYOUT.app.cx + (-700 - LAYOUT.app.cx) * (1 - k) + (APP_BACK.cx - LAYOUT.app.cx) * back
  const appH = PH + (APP_BACK.h - PH) * back
  const appTop = LAYOUT.app.top + (PH - appH) / 2
  const ending = interpolate(s, [T.end - 0.35, T.end], [0, 1], { ...clamp, easing: easeInOut })
  // the buzz when money lands
  const buzz = (at: number) => (s > at && s < at + 0.5 ? Math.sin((s - at) * 140) * 5 * (1 - (s - at) / 0.5) : 0)
  const shake = buzz(0.55) + buzz(T.land)

  return (
    <AbsoluteFill style={{ background: C.paper, fontFamily: 'Manrope', overflow: 'hidden' }}>
      <AbsoluteFill style={{ opacity: 1 - ending, transform: `scale(${1 - 0.04 * ending})` }}>
        <Path s={s} />
        <PhoneOnStage phone={APP} segs={APP_SEGS} masks={NO_MASKS} cx={appX} top={appTop} h={appH} s={s} dim={focus(s, 'app')} label="Your phone · Kova" labelAt={5.6} push={appPush(s)} />
        <PhoneOnStage phone={SIM} segs={SIM_SEGS} masks={NO_MASKS} cx={simCx + shake} top={simTop} h={simH} s={s} dim={focus(s, 'sim')} label="Their phone · no apps, no data" labelAt={5.6} />
        <Callouts s={s} />
        <KoviFlight s={s} />
      </AbsoluteFill>
      <Sequence from={f(T.end)}>
        <EndCard />
      </Sequence>
      <Captions s={s} />
      <Grain frame={frame} />
      <Sound />
    </AbsoluteFill>
  )
}

/** Which phone the story is on: the other one steps back a little. */
function focus(s: number, who: 'app' | 'sim') {
  const onApp = s >= 5.0 && s < T.land - 0.4
  const active = who === 'app' ? onApp : !onApp
  return active ? 0 : s < T.twoPhones ? 0 : 1
}

function PhoneOnStage({
  phone,
  segs,
  masks,
  cx,
  top,
  h,
  s,
  dim,
  label,
  labelAt,
  push = 1,
}: {
  push?: number
  phone: { src: string; w: number; h: number }
  segs: Seg[]
  masks: (tt: number) => number[][]
  cx: number
  top: number
  h: number
  s: number
  dim: number
  label: string
  labelAt: number
}) {
  const scale = h / phone.h
  const w = phone.w * scale
  const g = segAt(segs, s)
  const tt = trackSecond(g, s)
  const fade = interpolate(dim, [0, 1], [1, 0.55])
  const lab = interpolate(s, [labelAt, labelAt + 0.4], [0, 1], { ...clamp, easing: decel })
  return (
    <div style={{ position: 'absolute', left: cx - w / 2, top, width: w, height: h }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 54 * scale * 1.2,
          boxShadow: `0 ${36 * (1 - dim * 0.5)}px 70px rgba(11,26,29,${0.22 - dim * 0.1})`,
          filter: `saturate(${1 - 0.3 * dim})`,
          opacity: fade,
          transform: `scale(${1 - 0.03 * dim})`,
        }}
      >
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 46 * scale * 1.2 }}>
        <div style={{ position: 'absolute', inset: 0, transform: `scale(${push})`, transformOrigin: '50% 100%' }}>
        {segs.map((sg) => (
          <Sequence key={`${sg.from}`} from={f(sg.from)} durationInFrames={Math.max(1, f(sg.to) - f(sg.from))} layout="none">
            <Screen phone={phone} seg={sg} w={w} h={h} />
          </Sequence>
        ))}
        {tt === null
          ? null
          : masks(tt).map((box, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: masks never reorder
                key={i}
                style={{
                  position: 'absolute',
                  left: box[0]! * w,
                  top: box[1]! * h,
                  width: box[2]! * w,
                  height: box[3]! * h,
                  borderRadius: 6,
                  backdropFilter: 'blur(7px)',
                  WebkitBackdropFilter: 'blur(7px)',
                  background: 'rgba(200,200,200,0.35)',
                }}
              />
            ))}
        </div>
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          top: h + 22,
          left: -100,
          right: -100,
          textAlign: 'center',
          fontSize: 26,
          fontWeight: 700,
          color: C.muted,
          letterSpacing: -0.3,
          opacity: lab * fade,
          transform: `translateY(${(1 - lab) * 10}px)`,
        }}
      >
        {label}
      </div>
    </div>
  )
}

function Screen({ phone, seg, w, h }: { phone: { src: string }; seg: Seg; w: number; h: number }) {
  const style = { width: w, height: h, display: 'block' as const }
  if ('img' in seg) return <Img src={staticFile(seg.img)} style={{ ...style, position: 'absolute' }} />
  const video = <OffthreadVideo src={staticFile(phone.src)} startFrom={f('t' in seg ? seg.t : seg.hold)} playbackRate={'t' in seg ? (seg.rate ?? 1) : 1} muted style={style} />
  return <div style={{ position: 'absolute', inset: 0 }}>{'hold' in seg ? <Freeze frame={0}>{video}</Freeze> : video}</div>
}

/** The path between the phones: dotted, faint, there all along; Kovi flies it when the money moves. */
const FLIGHT: Curve = [
  { x: 790, y: 470 },
  { x: 900, y: 150 },
  { x: 1020, y: 150 },
  { x: 1130, y: 470 },
]
function Path({ s }: { s: number }) {
  const show = interpolate(s, [5.6, 6.2], [0, 1], clamp) * interpolate(s, [T.land + 0.3, T.land + 0.8], [1, 0], clamp)
  const dots = Array.from({ length: 31 }, (_, i) => bezier(FLIGHT, i / 30))
  const p = interpolate(s, [T.fly, T.land], [0, 1], { ...clamp, easing: easeInOut })
  return (
    <>
      {dots.map((d, i) => {
        const lit = i / 30 <= p && s >= T.fly
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed dots
            key={i}
            style={{
              position: 'absolute',
              left: d.x - 4,
              top: d.y - 4,
              width: 8,
              height: 8,
              borderRadius: 4,
              background: lit ? C.coral : C.ink,
              opacity: show * (lit ? 0.95 : 0.18),
            }}
          />
        )
      })}
    </>
  )
}

function KoviFlight({ s }: { s: number }) {
  if (s < T.fly - 0.3 || s > T.land + 0.6) return null
  const p = interpolate(s, [T.fly, T.land], [0, 1], { ...clamp, easing: easeInOut })
  const at = bezier(FLIGHT, p)
  const ahead = bezier(FLIGHT, Math.min(1, p + 0.02))
  const angle = (Math.atan2(ahead.y - at.y, ahead.x - at.x) * 180) / Math.PI
  const appear = interpolate(s, [T.fly - 0.3, T.fly], [0, 1], clamp)
  const gone = interpolate(s, [T.land, T.land + 0.35], [1, 0], clamp)
  return (
    <>
      <Kovi pose="ride" size={150} x={at.x} y={at.y} rotate={angle * 0.35} style={{ opacity: appear * gone }} />
      {s > T.land ? <Ripple s={s - T.land} x={1130} y={470} /> : null}
    </>
  )
}

function Ripple({ s, x, y }: { s: number; x: number; y: number }) {
  const r = 30 + s * 260
  return (
    <div
      style={{
        position: 'absolute',
        left: x - r,
        top: y - r,
        width: r * 2,
        height: r * 2,
        borderRadius: r,
        border: `5px solid ${C.coral}`,
        opacity: Math.max(0, 0.8 - s * 1.4),
      }}
    />
  )
}

/** Words on top of the screens, each pinned to what the screen proves. */
function Callouts({ s }: { s: number }) {
  const { fps } = useVideoConfig()
  const frame = Math.round(s * FPS)
  const pop = (at: number) => spring({ frame: frame - f(at), fps, config: { damping: 14, stiffness: 220, mass: 0.6 } })
  const out = (at: number) => interpolate(s, [at, at + 0.25], [1, 0], clamp)
  const chip = (text: string, at: number, until: number, x: number, y: number, tone: 'ink' | 'coral' = 'ink') =>
    s >= at && s < until + 0.25 ? (
      <div
        style={{
          position: 'absolute',
          left: x,
          top: y,
          transform: `translate(-50%, -50%) scale(${0.85 + 0.15 * pop(at)})`,
          opacity: Math.min(1, pop(at) * 1.5) * out(until),
          background: tone === 'coral' ? C.coral : C.ink,
          color: tone === 'coral' ? C.ink : C.paper,
          borderRadius: 999,
          padding: '14px 30px',
          fontSize: 34,
          fontWeight: 800,
          letterSpacing: -0.6,
          whiteSpace: 'nowrap',
          boxShadow: '0 14px 30px rgba(11,26,29,0.18)',
        }}
      >
        {text}
      </div>
    ) : null
  // the pocket going up, on the result
  const tick = interpolate(s, [T.result + 0.25, T.result + 1.0], [9.25, 10.25], { ...clamp, easing: decel })
  return (
    <>
      {chip('no apps', 1.0 + VOICE.hook - 0.25, 4.9, 960 - 330, 380)}
      {chip('no internet', 2.32 + VOICE.hook - 0.25, 4.9, 960 + 340, 470)}
      {chip('arrived in 1.31 s on Monad', T.sent + 0.15, T.fly - 0.2, LAYOUT.app.cx, 52, 'coral')}
      {chip('in their Kova pocket', VOICE.text + 2.9, 21.2, GAP, 400, 'coral')}
      {chip('*384*53916#', VOICE.dial + 1.6, 24.9, GAP, 400)}
      {chip('enter your PIN', 25.7, T.result - 0.1, GAP, 400)}
      {s >= T.result && s < T.end ? (
        <div
          style={{
            position: 'absolute',
            left: GAP,
            top: 400,
            transform: `translate(-50%, -50%) scale(${0.85 + 0.15 * pop(T.result)})`,
            opacity: Math.min(1, pop(T.result) * 1.5),
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 30, fontWeight: 700, color: C.muted }}>their pocket</div>
          <div style={{ fontSize: 112, fontWeight: 800, color: C.ink, letterSpacing: -4, fontVariantNumeric: 'tabular-nums', lineHeight: 1.05 }}>
            ${tick.toFixed(2)}
          </div>
          <div style={{ fontSize: 30, fontWeight: 800, color: C.coral }}>+$1.00</div>
        </div>
      ) : null}
      {chip('no app', VOICE.close, T.end - 0.1, GAP - 110, 610)}
      {chip('no data', VOICE.close + 1.04, T.end - 0.1, GAP + 110, 610)}
    </>
  )
}

/** The voice, as words lighting up under the phones; the key word in coral. */
const KEY = /^(paid|phone|number|send|Monad|second|pocket|code|PIN|Dollars|Kova)$/i
function Captions({ s }: { s: number }) {
  const line = (VO.lines as { id: string; words: { text: string; start: number; end: number }[] }[]).find(
    (l) => s >= VOICE[l.id] - 0.1 && s < VOICE[l.id] + l.words[l.words.length - 1]!.end + 0.5,
  )
  if (!line || s >= T.end) return null
  const t = s - VOICE[line.id]
  return (
    <div
      style={{
        position: 'absolute',
        left: 160,
        right: 160,
        bottom: 24,
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        columnGap: 12,
        fontSize: 38,
        fontWeight: 800,
        letterSpacing: -0.6,
      }}
    >
      {line.words.map((w) => {
        const on = t >= w.start - 0.05
        const key = KEY.test(w.text.replace(/[^A-Za-z]/g, ''))
        return (
          <span key={`${w.start}`} style={{ color: on ? (key ? C.coral : C.ink) : 'rgba(11,26,29,0.22)', transition: 'none' }}>
            {w.text.replace(/[,.]$/, '').replace('’', '’')}
          </span>
        )
      })}
    </div>
  )
}

function EndCard() {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const r = (at: number) => interpolate(frame - at, [0, 10], [0, 1], { ...clamp, easing: decel })
  const kovi = spring({ frame: frame - 6, fps, config: { damping: 12, stiffness: 170, mass: 0.7 } })
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: 'Manrope' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 60 }}>
        <Img src={staticFile('art/kovi-cheer.png')} style={{ width: 300, height: 300, transform: `scale(${0.7 + 0.3 * kovi})`, opacity: Math.min(1, kovi * 2) }} />
        <div>
          <Img src={staticFile('demo/kova-lockup.svg')} style={{ width: 300, height: 98, opacity: r(0), transform: `translateY(${(1 - r(0)) * 20}px)` }} />
          <div style={{ fontWeight: 800, fontSize: 104, color: C.ink, letterSpacing: -4, lineHeight: 1, marginTop: 18, opacity: r(3), transform: `translateY(${(1 - r(3)) * 24}px)` }}>
            Dollars for
            <br />
            <span style={{ color: C.coral }}>every phone.</span>
          </div>
          <div style={{ display: 'flex', gap: 18, marginTop: 34, opacity: r(9), transform: `translateY(${(1 - r(9)) * 16}px)` }}>
            <div style={{ fontWeight: 800, fontSize: 36, color: C.ink, background: C.coral, borderRadius: 999, padding: '12px 34px' }}>mykova.app</div>
            <div style={{ fontWeight: 700, fontSize: 36, color: C.ink, border: `3px solid ${C.ink}`, borderRadius: 999, padding: '9px 31px' }}>on Monad</div>
          </div>
        </div>
      </div>
      <div style={{ position: 'absolute', bottom: 40, fontSize: 24, fontWeight: 600, color: C.muted, opacity: r(14) }}>
        Recorded on Monad testnet with Africa’s Talking’s USSD simulator.
      </div>
    </AbsoluteFill>
  )
}

// ── sound ────────────────────────────────────────────────────────────────────────────────────
function Sound() {
  const cue = (at: number, src: string, volume: number, key?: string) => (
    <Sequence key={key ?? `${at}${src}`} from={f(at)} durationInFrames={f(3)}>
      <Html5Audio src={staticFile(src)} volume={volume} />
    </Sequence>
  )
  const voiceOn = (s: number) =>
    (VO.lines as { id: string; duration: number }[]).some((l) => s >= VOICE[l.id] - 0.1 && s <= VOICE[l.id] + l.duration + 0.15)
  return (
    <>
      <Html5Audio
        src={staticFile('kovaphone/music-b.mp3')}
        volume={(fr) => {
          const s = fr / FPS
          const base = voiceOn(s) ? 0.16 : 0.34
          return base * interpolate(s, [0, 0.6, 35.5, 37.5], [0, 1, 1, 0], clamp)
        }}
      />
      {(VO.lines as { id: string }[]).map((l) => (
        <Sequence key={l.id} from={f(VOICE[l.id])}>
          <Html5Audio src={staticFile(`kovaphone/vo-${l.id}.mp3`)} volume={1} />
        </Sequence>
      ))}
      {cue(0.55, 'kovaphone/buzz.wav', 0.5)}
      {cue(0.62, 'kovaphone/sms.wav', 0.35)}
      {cue(T.twoPhones, 'audio/sfx/whoosh-real.wav', 0.22)}
      {cue(5.6, 'audio/kenney/card-place-1.ogg', 0.18)}
      {cue(6.6, 'audio/kenney/card-place-2.ogg', 0.16)}
      {cue(8.4, 'audio/kenney/card-place-3.ogg', 0.16)}
      {cue(11.6, 'audio/sfx/swish.mp3', 0.9)}
      {cue(T.sent, 'audio/sfx/pop.mp3', 0.25)}
      {cue(T.fly - 0.1, 'audio/sfx/whoosh-real.wav', 0.28)}
      {cue(T.land - 0.02, 'audio/sfx/land.mp3', 0.25)}
      {cue(T.land, 'kovaphone/buzz.wav', 0.5)}
      {cue(T.land + 0.07, 'kovaphone/sms.wav', 0.35)}
      {cue(21.4, 'kovaphone/dtmf.wav', 0.14)}
      {cue(22.8, 'audio/kenney/card-place-4.ogg', 0.16)}
      {cue(T.result, 'audio/sfx/chime.mp3', 0.3)}
      {cue(T.result + 0.3, 'audio/sfx/sparkle.mp3', 0.35)}
      {cue(T.end, 'audio/sfx/whoosh-real.wav', 0.2)}
      {cue(T.end + 0.25, 'audio/sfx/pop.mp3', 0.22)}
    </>
  )
}
