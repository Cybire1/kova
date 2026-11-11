import { AbsoluteFill, Audio, Img, staticFile, useCurrentFrame } from 'remotion'
import { accel, decel, mix, span } from '../motion'
import rects from '../../public/chrome/rects.json'

/**
 * Kova for Chrome, the announcement: 25.4 s, 16:9, 60 fps, no voice.
 *
 * The name, then each thing it does with the extension's own window for it, then the waitlist.
 * Every window is the shipped extension in that state (scripts/chrome/capture.cjs).
 *
 * Motion: words sharpen out of a blur; a panel rises 50 px with its window; exits fade with a short
 * rise; one cursor, one tap a feature.
 * Layout: headline one side, the window on a tinted panel the other; the sides and the tint swap
 * with every feature. The name is centred; the end is the waitlist card from mykova.app/chrome.
 */
export const FPS = 60
export const DURATION = 25.4

const INK = '#0b1a1d'
const PAPER = '#e7e5e0'
const WIN = '#f4f2ee'
const CORAL = '#d46558'
const MUTED = '#5f6b6e'
const font = 'Manrope'
const img = (n: string) => staticFile(`chrome/${n}.png`)
const KS = 1.32

const LEN = 3.0
const FEATURES = [
  { head: ['Connect.', 'Nothing more.'], sub: 'A site sees your address. It can’t move a cent.', shot: 'connect', w: 400, h: 612, tint: '#f0d5cf', tap: rects.connect.go },
  { head: ['A budget,', 'not your wallet.'], sub: '$5, $20 or $50. A day or a week. You choose.', shot: 'budget-20', w: 400, h: 612, tint: '#cfe0df', tap: rects.budget.go },
  { head: ['Pages that', 'cost a cent.'], sub: 'Paid from that site’s budget, and the page opens.', shot: 'cent', w: 400, h: 612, tint: '#d9e4ee', tap: rects.cent.go },
  { head: ['It can’t', 'take more.'], sub: 'Every limit is enforced on Monad. A hacked site gets its budget, never your balance.', shot: 'over', w: 400, h: 612, tint: '#f0d5cf', mark: rects.over.err },
  { head: ['Freeze one site.', 'Or all of them.'], sub: 'One switch. Only your passkey turns it back on.', shot: 'sites', after: 'sites-frozen', w: 360, h: 600, tint: '#cfe0df', tap: rects.sites.all },
]
export const T = {
  first: 2.4,
  trio: 2.4 + LEN * 5,
  end: 2.4 + LEN * 6,
}

const blurIn = (t: number, at: number, len = 0.55) => {
  const e = decel(span(t, at, at + len))
  return { opacity: e, filter: e < 0.98 ? `blur(${12 * (1 - e)}px)` : undefined }
}
const fadeOut = (t: number, at: number, len = 0.28) => 1 - accel(span(t, at, at + len))

function Cursor({ x, y, press }: { x: number; y: number; press: number }) {
  return (
    <svg width="60" height="60" viewBox="0 0 32 32" style={{ position: 'absolute', left: x - 8, top: y - 6, transform: `scale(${1 - 0.14 * press})`, transformOrigin: '8px 6px' }}>
      <path d="M5 3 L5 25 L11 19.5 L15 28.5 L19 26.6 L15 17.8 L23 17.2 Z" fill={INK} stroke="#fff" strokeWidth="2.2" strokeLinejoin="round" />
    </svg>
  )
}

function Feature({ t, i }: { t: number; i: number }) {
  const f = FEATURES[i]
  const at = T.first + i * LEN
  const o = fadeOut(t, at + LEN - 0.3)
  if (t < at - 0.05 || o <= 0) return null
  const flip = i % 2 === 1
  const PW = 800
  const PH = 940
  const px = flip ? 90 : 1920 - 90 - PW
  const tx = flip ? 90 + PW + 90 : 100
  const e = decel(span(t, at, at + 0.6))
  const wx = px + (PW - f.w * KS) / 2
  const wy = 70 + (PH - f.h * KS) / 2
  const tapAt = at + 1.75
  const tap = f.tap ? { x: wx + (f.tap.x + f.tap.w * 0.6) * KS, y: wy + (f.tap.y + f.tap.h / 2) * KS } : null
  const cur = decel(span(t, at + 0.7, tapAt - 0.1))
  const press = span(t, tapAt - 0.08, tapAt) * (1 - span(t, tapAt, tapAt + 0.16))
  const done = span(t, tapAt + 0.04, tapAt + 0.24)
  const mark = decel(span(t, at + 1.3, at + 1.7))
  return (
    <div style={{ opacity: o, transform: `translateY(${-8 * (1 - o)}px)` }}>
      <div style={{ position: 'absolute', left: tx, top: 250, width: 800 }}>
        <div style={{ fontWeight: 700, fontSize: 30, color: CORAL, marginBottom: 26, ...blurIn(t, at) }}>
          {i + 1} / {FEATURES.length}
        </div>
        <div style={{ fontWeight: 800, fontSize: 112, letterSpacing: -5.6, lineHeight: 1.0, color: INK }}>
          <div style={blurIn(t, at + 0.05)}>{f.head[0]}</div>
          <div style={blurIn(t, at + 0.2)}>{f.head[1]}</div>
        </div>
        <div style={{ marginTop: 36, width: 640, fontWeight: 500, fontSize: 40, letterSpacing: -1, lineHeight: 1.3, color: MUTED, ...blurIn(t, at + 0.55) }}>{f.sub}</div>
      </div>
      <div style={{ position: 'absolute', left: px, top: 70 + (1 - e) * 50, width: PW, height: PH, borderRadius: 56, backgroundColor: f.tint, opacity: e }} />
      <div style={{ position: 'absolute', left: wx, top: wy + (1 - e) * 80, width: f.w * KS, height: f.h * KS, borderRadius: 24 * KS, overflow: 'hidden', backgroundColor: WIN, opacity: e, boxShadow: '0 40px 80px -44px rgba(11,26,29,.45)' }}>
        <Img src={img(f.shot)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
        {f.after ? <Img src={img(f.after)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: done }} /> : null}
        {f.mark ? <div style={{ position: 'absolute', left: (f.mark.x - 8) * KS, top: (f.mark.y - 8) * KS, width: (f.mark.w + 16) * KS, height: (f.mark.h + 16) * KS, borderRadius: 10 * KS, boxShadow: `0 0 0 ${3.5 * mark}px ${CORAL}`, opacity: mark }} /> : null}
      </div>
      {tap ? (
        <div style={{ opacity: Math.min(1, cur * 3) }}>
          <Cursor x={mix(tap.x + 260, tap.x, cur)} y={mix(tap.y + 330, tap.y, cur)} press={press} />
        </div>
      ) : null}
    </div>
  )
}

export function Film() {
  const t = useCurrentFrame() / FPS
  const introOut = fadeOut(t, T.first - 0.3)
  const trioOut = fadeOut(t, T.end - 0.3)
  // the site's own waitlist card, an email typed into it, one click
  const CS = 1.5
  const CX = (1920 - 1144 * CS) / 2
  const CY = 120
  const EMAIL = 'mia@example.com'
  const card = decel(span(t, T.end + 0.1, T.end + 0.8))
  const typed = Math.round(EMAIL.length * span(t, T.end + 1.5, T.end + 2.7))
  const endCur = decel(span(t, T.end + 2.6, T.end + 3.45))
  const TRIO = ['No seed phrase.', 'No gas to buy.', 'No endless approvals.']
  return (
    <AbsoluteFill style={{ backgroundColor: PAPER, fontFamily: font, overflow: 'hidden' }}>
      <Audio src={staticFile('chrome/mix.wav')} />

      {/* the name */}
      {introOut > 0 ? (
        <div style={{ opacity: introOut, transform: `translateY(${-8 * (1 - introOut)}px)` }}>
          <div style={{ position: 'absolute', left: 0, width: 1920, top: 250, textAlign: 'center', fontWeight: 700, fontSize: 44, letterSpacing: -1.2, color: CORAL, ...blurIn(t, 0.1) }}>Introducing</div>
          <div style={{ position: 'absolute', left: 0, width: 1920, top: 330, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 44, ...blurIn(t, 0.3, 0.8) }}>
            <Img src={img('icon')} style={{ width: 190, height: 190, borderRadius: 44 }} />
            <span style={{ fontWeight: 800, fontSize: 190, letterSpacing: -10, color: INK, lineHeight: 1 }}>Kova for Chrome</span>
          </div>
          <div style={{ position: 'absolute', left: 0, width: 1920, top: 610, textAlign: 'center', fontWeight: 500, fontSize: 56, letterSpacing: -1.8, color: MUTED, ...blurIn(t, 1.0) }}>A wallet for websites that can’t be drained.</div>
        </div>
      ) : null}

      {FEATURES.map((_, i) => (
        <Feature key={i} t={t} i={i} />
      ))}

      {/* three more, in words */}
      {t >= T.trio - 0.05 && trioOut > 0 ? (
        <div style={{ position: 'absolute', left: 0, width: 1920, top: 250, textAlign: 'center', fontWeight: 800, fontSize: 150, letterSpacing: -7.6, lineHeight: 1.08, opacity: trioOut }}>
          {TRIO.map((s, i) => (
            <div key={s} style={{ color: i === 2 ? CORAL : INK, ...blurIn(t, T.trio + 0.1 + i * 0.75) }}>{s}</div>
          ))}
        </div>
      ) : null}

      {/* the end: the waitlist, as it is on mykova.app/chrome */}
      {t >= T.end ? (
        <>
          <div style={{ position: 'absolute', left: CX, top: CY + (1 - card) * 60, width: 1144 * CS, height: 481.84 * CS, borderRadius: 36 * CS, overflow: 'hidden', opacity: card }}>
            <Img src={img('waitlist')} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
            {typed ? (
              <div style={{ position: 'absolute', left: (56 + 3) * CS, top: (361.84 + 3) * CS, width: (421 - 6) * CS, height: 50 * CS, borderRadius: 25 * CS, backgroundColor: '#fff', display: 'flex', alignItems: 'center', paddingLeft: 17 * CS, fontWeight: 500, fontSize: 17 * CS, color: INK }}>
                {EMAIL.slice(0, typed)}
                <span style={{ width: 2.5, height: 22 * CS, marginLeft: 3, backgroundColor: INK, opacity: Math.floor(t * 2.4) % 2 ? 0 : 1 }} />
              </div>
            ) : null}
          </div>
          <div style={{ position: 'absolute', left: 0, width: 1920, top: 896, textAlign: 'center', fontWeight: 800, fontSize: 76, letterSpacing: -3.4, color: INK, ...blurIn(t, T.end + 0.9) }}>mykova.app/chrome</div>
          <div style={{ opacity: Math.min(1, endCur * 3) }}>
            <Cursor x={mix(1500, CX + (491 + 205 * 0.6) * CS, endCur)} y={mix(1180, CY + (361.84 + 30) * CS, endCur)} press={span(t, T.end + 3.5, T.end + 3.58) * (1 - span(t, T.end + 3.58, T.end + 3.75))} />
          </div>
        </>
      ) : null}
    </AbsoluteFill>
  )
}
