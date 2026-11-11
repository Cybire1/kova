import type { CSSProperties } from 'react'
import { AbsoluteFill, Easing, Freeze, Img, interpolate, OffthreadVideo, staticFile, useCurrentFrame } from 'remotion'
import vo from '../../public/credit-alert/audio/vo.json'
import takeA from '../../public/credit-alert/take-a.json'
import { Device } from '../ios-live-v2/Device'
import { Grain, Kovi, Logo } from '../parts'

/**
 * "Credit alert." Kova's cash-out to naira: 36.5 s, 16:9, 30 fps.
 *
 * Claim: dollars in a Kova wallet reach any Nigerian bank in seconds. The film opens on the proof (the
 * bank's own alert) and goes back eleven seconds to show how it got there, in one continuous take of
 * the app.
 *
 * Everything is real, from one cash-out on Monad mainnet, 27 Oct 2026 (cash-out 01a17fb8, tx
 * 0x5646c1d0…be2d): $2.00 → ₦2,752.94 at ₦1,376.47, Kova's fee none, to an OPay account; the Monad
 * transaction at 23:36:22 UTC and PAJ paying at 23:36:32.7 ("Done in 11 seconds"). The OPay alert is
 * the account holder's own screenshot. The phone plays Kova's web app, recorded at phone size
 * (scripts/credit-alert/record.cjs) with that cash-out's answers; the holder's name is blurred.
 *
 * Motion (one vocabulary): words rise into place as they're said; objects Rise (decelerated); exits
 * are an accelerated fade with a short rise. Camera: three moves (the phone rising in, the push into
 * "Done in 11 seconds", the phone leaving for the end card). Signature, once: the coral underline on
 * the alert's ₦2,752.94.
 *
 * Layout ledger (no archetype twice in a row, none more than twice):
 *   0.0  the alert   Centred hero (the bank's banner, the two words under it)
 *   2.2  the app     Split (words left, the phone large and cropped right)
 *   26.5 done        Extreme scale contrast (a huge "11 seconds", the phone pushed in)
 *   29.4 end         Baseline anchor (mark, line and address on one low axis)
 *
 * Audit: enter styles 2 · runs without a ≥1.5 s hold 0 · every exit animated · bouncy springs: none ·
 * camera moves 3 · accent: coral only · texture: grain only · depth: the phone over the paper.
 */

export const FPS = 30
export const DURATION = Math.round(36.5 * FPS)

/** When each voiceover line starts, in film seconds. */
export const VO = { alert: 0.3, before: 2.6, amount: 7.42, bank: 10.4, send: 16.35, moves: 20.3, done: 26.9, end: 29.7 }
/** Take A (Home → review) on the film's clock: its Cash out tap lands at 6.70 s. */
const A0 = 6.7 - takeA.taps[0].t
/** The review waits on its line, then Send. */
const HOLD = { at: 12.3, from: A0 + 12.3, until: 19.4 }
/** Take B (sending → done): "Done" shows at B 6.53 s = 26.48 s, on a beat of the score. */
const B0 = 19.95
const END = 29.4

const K = { paper: '#e7e5e0', page: '#e6e5e0', ink: '#0b1a1d', coral: '#d46558', muted: '#566568' }
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const decel = Easing.bezier(0.16, 1, 0.3, 1)
const accel = Easing.bezier(0.7, 0, 0.84, 0)
const inOut = Easing.bezier(0.65, 0, 0.35, 1)
const ease = (t: number, a: number, b: number, e = decel) => interpolate(t, [a, b], [0, 1], { ...clamp, easing: e })

/** The phone: an iPhone 16 Pro, large and cropped by the frame's bottom edge. */
const PHONE = { h: 1340, x: 1400, top: 34 }
const S = PHONE.h / 2708
/** Frame pixels per CSS pixel of the recording (393 CSS px across the screen's 1204 units). */
const PX = (1204 / 393) * S
const SCREEN_AT = { x: PHONE.x - (1311 * S) / 2 + 54 * S, y: PHONE.top + 44 * S }
/** Where a point of the page (CSS px, below the 54 px status bar) lands in the frame. */
const onPhone = (x: number, y: number) => ({ x: SCREEN_AT.x + x * PX, y: SCREEN_AT.y + (y + 54) * PX })
/** "Done in 11 seconds" on the done screen. */
const DONE_CHIP = onPhone(196, 321)

/** The banner from the OPay alert (opay-banner.png, 1233x216), and its ₦2,752.94. */
const BANNER = { w: 1233, h: 216, scale: 1.3, y: 300, naira: { x: 497, w: 182, y: 133 } }

type Word = { text: string; start: number; end: number }
const lines = Object.fromEntries((vo.lines as { id: string; words: Word[] }[]).map((l) => [l.id, l.words]))

export function CreditAlert() {
  const frame = useCurrentFrame()
  const t = frame / FPS
  return (
    <AbsoluteFill style={{ background: K.paper, fontFamily: 'Manrope', color: K.ink, overflow: 'hidden' }}>
      <Alert t={t} />
      <Phone t={t} />
      <Words t={t} />
      <EndCard t={t} />
      <Grain frame={frame} />
    </AbsoluteFill>
  )
}

/** 0–2.4 s: the bank's own alert and its two words (on screen from frame 0: X's thumbnail), then
 * both leave as the film goes back eleven seconds. */
function Alert({ t }: { t: number }) {
  if (t > 2.5) return null
  const out = ease(t, 2.05, 2.4, accel)
  const drift = BANNER.scale * (1 + 0.02 * ease(t, 0, 2.05, inOut))
  const draw = ease(t, 0.95, 1.45)
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: 1 - out, transform: `translateY(${-70 * out}px)` }}>
      <div
        style={{
          position: 'absolute',
          left: (1920 - BANNER.w) / 2,
          top: BANNER.y - BANNER.h / 2,
          width: BANNER.w,
          height: BANNER.h,
          transform: `scale(${drift})`,
          filter: 'drop-shadow(0 26px 40px rgba(24,28,25,0.22))',
        }}
      >
        <Img src={staticFile('credit-alert/opay-banner.png')} style={{ width: BANNER.w, height: BANNER.h }} />
        <div
          style={{
            position: 'absolute',
            left: BANNER.naira.x,
            top: BANNER.naira.y,
            width: BANNER.naira.w * draw,
            height: 7,
            borderRadius: 4,
            background: K.coral,
          }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 600,
          textAlign: 'center',
          fontWeight: 800,
          fontSize: 150,
          lineHeight: 1,
          letterSpacing: '-0.045em',
        }}
      >
        Credit alert.
      </div>
    </div>
  )
}

/** Which frame of which take the phone shows at film time `t`. */
function takeAt(t: number): { src: string; frame: number } {
  if (t >= B0) return { src: 'credit-alert/take-b.mp4', frame: Math.round(Math.min(t - B0, 11.6) * FPS) }
  let a = 0
  if (t < A0) a = 0
  else if (t < HOLD.from) a = t - A0
  else if (t < HOLD.until) a = HOLD.at
  else a = Math.min(HOLD.at + (t - HOLD.until), 12.75)
  return { src: 'credit-alert/take-a.mp4', frame: Math.round(a * FPS) }
}

/** Take A's taps on the film's clock (Send waits with the review). */
const TAPS = takeA.taps.map((p) => ({
  ...p,
  at: p.label === 'send' ? HOLD.until + (p.t - HOLD.at) : A0 + p.t,
}))

function Phone({ t }: { t: number }) {
  if (t < 2.25 || t > END + 0.8) return null
  const rise = ease(t, 2.3, 3.2)
  const leave = ease(t, END, END + 0.55, accel)
  const push = ease(t, 26.95, 28.35, inOut) * (1 - leave)
  const scale = 1 + 0.25 * push
  const { src, frame } = takeAt(t)
  const style: CSSProperties = {
    position: 'absolute',
    inset: 0,
    transform: `translate(${110 * push}px, ${1080 * (1 - rise) + 860 * leave}px) scale(${scale})`,
    transformOrigin: `${DONE_CHIP.x}px ${DONE_CHIP.y}px`,
  }
  return (
    <div style={style}>
      <Device x={PHONE.x} y={PHONE.top + PHONE.h / 2} h={PHONE.h} screen={null}>
        <div style={{ position: 'absolute', inset: 0, background: K.page }}>
          <div style={{ width: 393, height: 852, transform: `scale(${1204 / 393})`, transformOrigin: 'top left' }}>
            <StatusBar />
            <div style={{ position: 'absolute', top: 54, left: 0, width: 393, height: 798 }}>
              <Freeze frame={frame}>
                <OffthreadVideo src={staticFile(src)} muted style={{ width: 393, height: 798 }} />
              </Freeze>
            </div>
          </div>
        </div>
      </Device>
      {TAPS.map((p) => (
        <TapRing key={p.label + p.at} t={t} at={p.at} {...onPhone(p.x, p.y)} />
      ))}
    </div>
  )
}

/** iOS's status bar at the time of the cash-out (00:36 in Lagos), as a Home Screen app shows it. */
function StatusBar() {
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: 393, height: 54, color: K.ink }}>
      <span
        style={{
          position: 'absolute',
          left: 0,
          width: 142,
          top: 17,
          textAlign: 'center',
          fontFamily: '-apple-system, system-ui',
          fontWeight: 600,
          fontSize: 17,
          letterSpacing: -0.3,
        }}
      >
        00:36
      </span>
      <svg style={{ position: 'absolute', left: 285, top: 20 }} width={78} height={14} viewBox="0 0 78 14">
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={i * 5} y={9 - i * 2.6} width={3.2} height={3.4 + i * 2.6} rx={0.8} fill={K.ink} />
        ))}
        <path d="M31 4.6a10 10 0 0 1 14 0" stroke={K.ink} strokeWidth={2} fill="none" strokeLinecap="round" />
        <path d="M33.5 7.4a6.2 6.2 0 0 1 9 0" stroke={K.ink} strokeWidth={2} fill="none" strokeLinecap="round" />
        <circle cx={38} cy={10.6} r={1.6} fill={K.ink} />
        <rect x={52} y={1.2} width={22} height={11.6} rx={3.4} stroke={K.ink} strokeOpacity={0.4} strokeWidth={1} fill="none" />
        <rect x={54} y={3.2} width={15} height={7.6} rx={1.8} fill={K.ink} />
        <path d="M75.6 5.2v3.6a2 2 0 0 0 0-3.6z" fill={K.ink} fillOpacity={0.4} />
      </svg>
    </div>
  )
}

/** A thumb's tap: a soft press, and a ring that opens and fades. White with an ink edge, so it
 * shows on coral, ink and paper alike. */
function TapRing({ t, at, x, y }: { t: number; at: number; x: number; y: number }) {
  const p = (t - at) / 0.5
  if (p < 0 || p > 1) return null
  const r = 18 + 40 * decel(p)
  const press = 1 - Math.min(1, p / 0.4)
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: x - 24,
          top: y - 24,
          width: 48,
          height: 48,
          borderRadius: 24,
          background: 'rgba(255,255,255,0.5)',
          boxShadow: '0 0 0 1.5px rgba(11,26,29,0.35)',
          opacity: press,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: x - r,
          top: y - r,
          width: r * 2,
          height: r * 2,
          borderRadius: r,
          border: '3px solid rgba(255,255,255,0.95)',
          boxShadow: '0 0 0 1.5px rgba(11,26,29,0.45), inset 0 0 0 1.5px rgba(11,26,29,0.25)',
          opacity: 1 - p,
        }}
      />
    </>
  )
}

/** Each line, as it's said: words rise into place on the voice; the line leaves before the next. */
const SHOWN: { id: keyof typeof VO; until: number; accent: string[] }[] = [
  { id: 'before', until: 7.3, accent: ['11', '$2'] },
  { id: 'amount', until: 10.2, accent: ['naira.'] },
  { id: 'bank', until: 16.05, accent: ['name.'] },
  { id: 'send', until: 20.0, accent: ['fees.'] },
  { id: 'moves', until: 26.45, accent: [] },
  { id: 'done', until: END, accent: ['11', 'seconds.'] },
]

function Words({ t }: { t: number }) {
  return (
    <>
      {SHOWN.map(({ id, until, accent }) => {
        const start = VO[id]
        if (t < start - 0.2 || t > until + 0.35) return null
        const out = ease(t, until, until + 0.3, accel)
        const words = lines[id]
        const done = id === 'done'
        const rise = (w: Word) => ease(t, start + w.start - 0.08, start + w.start + 0.32)
        const word = (w: Word, i: number, style?: CSSProperties) => (
          <span key={`${w.text}${i}`} style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'bottom', marginRight: '0.24em' }}>
            <span
              style={{
                display: 'inline-block',
                transform: `translateY(${(1 - rise(w)) * 105}%)`,
                color: accent.includes(w.text) ? K.coral : K.ink,
                ...style,
              }}
            >
              {w.text}
            </span>
          </span>
        )
        return (
          <div
            key={id}
            style={{
              position: 'absolute',
              left: 130,
              width: done ? 860 : 830,
              top: 120,
              height: 840,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              fontWeight: 800,
              lineHeight: 1.06,
              letterSpacing: '-0.04em',
              fontSize: done ? 104 : words.length > 7 ? 88 : 104,
              opacity: 1 - out,
              transform: `translateY(${-10 * out}px)`,
            }}
          >
            {done ? (
              // "Done in" over an enormous 11: the one number this film is about.
              <>
                <div>{words.slice(0, 2).map((w, i) => word(w, i))}</div>
                <div style={{ display: 'flex', alignItems: 'baseline' }}>
                  {word(words[2], 2, { fontSize: 330, lineHeight: 0.9, letterSpacing: '-0.06em' })}
                  {word(words[3], 3)}
                </div>
              </>
            ) : (
              <div>{words.map((w, i) => word(w, i))}</div>
            )}
          </div>
        )
      })}
    </>
  )
}

/** The end: Kova, the line, the address, each as it's said; Kovi cheers beside the address. */
function EndCard({ t }: { t: number }) {
  if (t < END) return null
  const words = lines.end
  const at = (text: string) => VO.end + (words.find((w) => w.text.startsWith(text))?.start ?? 0)
  const mark = ease(t, at('Kova') - 0.05, at('Kova') + 0.6)
  const line = ease(t, at('Dollars') - 0.05, at('Dollars') + 0.6)
  const soon = ease(t, at('Dollars') + 1.1, at('Dollars') + 1.7)
  const url = ease(t, at('mykova') - 0.15, at('mykova') + 0.5)
  const rise = (p: number): CSSProperties => ({ opacity: p, transform: `translateY(${44 * (1 - p)}px)` })
  return (
    <>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 300, display: 'flex', justifyContent: 'center', ...rise(mark) }}>
        <Logo h={150} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 520,
          textAlign: 'center',
          fontWeight: 800,
          fontSize: 76,
          letterSpacing: '-0.035em',
          ...rise(line),
        }}
      >
        Off-ramp your tokens to naira.
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 622,
          textAlign: 'center',
          fontWeight: 700,
          fontSize: 44,
          letterSpacing: '-0.02em',
          color: K.muted,
          ...rise(soon),
        }}
      >
        More countries coming soon.
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 730, display: 'flex', justifyContent: 'center', ...rise(url) }}>
        <div
          style={{
            padding: '18px 44px',
            borderRadius: 999,
            background: K.ink,
            color: '#fff',
            fontWeight: 800,
            fontSize: 52,
            letterSpacing: '-0.02em',
          }}
        >
          mykova.app
        </div>
      </div>
      <Kovi pose="cheer" size={170} x={1290} y={760 + 30 * (1 - url)} style={{ opacity: url }} />
    </>
  )
}
