/**
 * "Send by link": a 20-second announcement. Ada sends Lucía $20 as a link, the envelope flies from
 * her phone to Lucía's, and Lucía, with no app and no wallet, claims it with Face ID: it's hers in
 * 0.6 s on Monad.
 *
 * Every screen is real, from one run on Monad testnet on 12 October 2026: Ada's from the Kova app
 * (public/link/ada), Lucía's from the claim page (public/link/lucia, with an iOS status bar drawn
 * over the browser capture). Link lnk_06gk1mw7y1ypvd3ft3e3s0g524, claimed in 0.6 s by a new wallet,
 * transaction 0x88a132159c2284f7ff2a658aeed4309980b9d279cc601360013c3387cb081622.
 *
 * One idea held all film: the envelope travels. Words pop on whole (no fades), phones move on one
 * ease, the flight is the one signature move. Cues: src/link/link-cues.json (the sound reads them).
 */
import { loadFont } from '@remotion/fonts'
import type React from 'react'
import { useEffect, useState } from 'react'
import { AbsoluteFill, continueRender, delayRender, Html5Audio, Img, staticFile, useCurrentFrame } from 'remotion'
import { Mark } from '../atm/Textures'
import { IPhone } from '../iphone'
import { easeInOut, mix, span } from '../motion'
import { bounce, CORAL, FPS, hero, INK, MUTED, TEAL } from '../os/ui/kit'
import { Grain } from '../parts'
import cues from './link-cues.json'

export const LINK_DURATION = cues.duration
const PAPER = '#e7e5e0'
const CREAM = '#f7f5f0'
const GOLD = '#edc354'
const SCREEN_W = 1179
const SCREEN_H = 2556
const rise = (t: number, at: number, d = 0.5) => hero(span(t, at, at + d))
const ease = (t: number, a: number, b: number) => easeInOut(span(t, a, b))
const ui: React.CSSProperties = { fontFamily: 'Manrope' }

const fonts = Promise.all(
  [
    ['500', 'Manrope_500Medium'],
    ['600', 'Manrope_600SemiBold'],
    ['700', 'Manrope_700Bold'],
    ['800', 'Manrope_800ExtraBold'],
  ].map(([weight, file]) => loadFont({ family: 'Manrope', url: staticFile(`fonts/${file}.ttf`), weight })),
)

// ——— Where the phones are ——————————————————————————————————————————————————————————————

interface Phone {
  x: number
  y: number
  h: number
}

function adaPhone(t: number): Phone {
  const [a, b] = cues.move1
  const p = ease(t, a, b)
  const out = ease(t, cues.move2[0], cues.move2[1])
  return { x: mix(mix(660, 500, p), -460, out), y: mix(540, 515, p), h: mix(980, 860, p) }
}

function luciaPhone(t: number): Phone {
  const inP = hero(span(t, cues.luciaIn[0], cues.luciaIn[1]))
  const hero2 = ease(t, cues.move2[0], cues.move2[1])
  const out = ease(t, cues.end, cues.end + 0.6)
  return { x: mix(mix(mix(2380, 1420, inP), 1330, hero2), 2450, out), y: mix(515, 540, hero2), h: mix(860, 990, hero2) }
}

/** A point on a phone's screen (screenshot pixels) in the frame. */
function onScreen(phone: Phone, sx: number, sy: number): [number, number] {
  const k = phone.h / SCREEN_H
  const w = (phone.h * SCREEN_W) / SCREEN_H
  return [phone.x - w / 2 + sx * k, phone.y - phone.h / 2 + sy * k]
}

function frameAt<T>(list: [number, T][], t: number): T {
  let pick = list[0]?.[1] as T
  for (const [at, value] of list) if (t >= at) pick = value
  return pick
}

// ——— Words ——————————————————————————————————————————————————————————————————————————————

interface Line {
  text: string
  /** When each word lands; a word before its time isn't there at all. */
  at: number[]
  color?: string
  size?: number
}

/** Lines that build a word at a time, each word on in one frame, and leave together. */
function Caption({ t, lines, x, y, size = 96, align = 'left', out }: { t: number; lines: Line[]; x: number; y: number; size?: number; align?: 'left' | 'center'; out?: number }) {
  const leave = out === undefined ? 0 : span(t, out, out + 0.25)
  if (leave >= 1 || t < (lines[0]?.at[0] ?? 0)) return null
  return (
    <div style={{ position: 'absolute', left: align === 'center' ? x - 900 : x, top: y, width: align === 'center' ? 1800 : 'auto', textAlign: align, opacity: 1 - leave, transform: `translateY(${-18 * leave}px)` }}>
      {lines.map((line, l) => {
        const s = line.size ?? size
        return (
          <div key={l} style={{ ...ui, fontWeight: 800, fontSize: s, lineHeight: 1.04, letterSpacing: '-0.04em', color: line.color ?? INK, whiteSpace: 'nowrap' }}>
            {line.text.split(' ').map((word, i) => (
              <span key={i} style={{ opacity: t >= (line.at[i] ?? line.at[line.at.length - 1] ?? 0) ? 1 : 0 }}>
                {word}
                {i < line.text.split(' ').length - 1 ? ' ' : ''}
              </span>
            ))}
          </div>
        )
      })}
    </div>
  )
}

function Sub({ t, at, out, text, x, y, align = 'left' }: { t: number; at: number; out?: number; text: string; x: number; y: number; align?: 'left' | 'center' }) {
  const leave = out === undefined ? 0 : span(t, out, out + 0.25)
  if (t < at || leave >= 1) return null
  return (
    <div style={{ ...ui, position: 'absolute', left: align === 'center' ? x - 900 : x, width: align === 'center' ? 1800 : 'auto', textAlign: align, top: y, fontWeight: 600, fontSize: 32, color: MUTED, letterSpacing: '-0.01em', opacity: 1 - leave }}>
      {text}
    </div>
  )
}

// ——— On a screen (screenshot pixels) ——————————————————————————————————————————————————

/** A fingertip that lands, presses and lifts, with a coral ring spreading from it. */
function Tap({ t, at, x, y }: { t: number; at: number; x: number; y: number }) {
  const before = span(t, at - 0.3, at)
  const after = 1 - span(t, at + 0.2, at + 0.45)
  const ring = span(t, at, at + 0.45)
  if (before <= 0 || (after <= 0 && ring >= 1)) return null
  const press = t >= at && t < at + 0.15 ? 0.86 : 1
  return (
    <>
      {ring > 0 && ring < 1 ? (
        <div style={{ position: 'absolute', left: x - 70 - 110 * ring, top: y - 70 - 110 * ring, width: 140 + 220 * ring, height: 140 + 220 * ring, borderRadius: '50%', border: `14px solid ${CORAL}`, opacity: 1 - ring }} />
      ) : null}
      <div style={{ position: 'absolute', left: x - 62, top: y - 62, width: 124, height: 124, borderRadius: '50%', background: 'rgba(255,255,255,0.7)', border: '7px solid rgba(11,26,29,0.5)', boxShadow: '0 10px 30px rgba(0,0,0,0.22)', opacity: Math.min(before, after), transform: `scale(${press})` }} />
    </>
  )
}

/** A coral outline drawn round something on the screen, to point at it. */
function Ring({ t, at, box, out }: { t: number; at: number; box: [number, number, number, number]; out?: number }) {
  const draw = hero(span(t, at, at + 0.4))
  const leave = out === undefined ? 0 : span(t, out, out + 0.2)
  if (draw <= 0 || leave >= 1) return null
  const pad = 22
  const [x0, y0, x1, y1] = box
  const w = x1 - x0 + pad * 2
  const h = y1 - y0 + pad * 2
  const perimeter = 2 * (w + h)
  return (
    <svg style={{ position: 'absolute', left: x0 - pad - 10, top: y0 - pad - 10, opacity: 1 - leave }} width={w + 20} height={h + 20}>
      <rect x={10} y={10} width={w} height={h} rx={h / 2} fill="none" stroke={CORAL} strokeWidth={12} strokeDasharray={perimeter} strokeDashoffset={perimeter * (1 - draw)} strokeLinecap="round" />
    </svg>
  )
}

/** Ada's slide to make the link: the knob travels the track and the coral fills behind it. */
function Slide({ t }: { t: number }) {
  const [a, b] = cues.slide
  if (t < a - 0.35 || t >= Number(cues.ada[1]?.[0] ?? 1.9)) return null
  const p = ease(t, a, b)
  const x = mix(147, 1030, p)
  const y = 2240
  const show = span(t, a - 0.35, a - 0.05)
  return (
    <>
      <div style={{ position: 'absolute', left: 52, top: 2138, width: x + 98 - 52, height: 204, borderRadius: 102, background: CORAL }} />
      <div style={{ position: 'absolute', left: x - 92, top: y - 92, width: 184, height: 184, borderRadius: '50%', background: CREAM, border: `18px solid ${CORAL}`, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width={70} height={70} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </div>
      <div style={{ position: 'absolute', left: x - 62, top: y - 62, width: 124, height: 124, borderRadius: '50%', background: 'rgba(255,255,255,0.5)', border: '6px solid rgba(11,26,29,0.35)', opacity: show * (1 - span(t, b, b + 0.2)) }} />
    </>
  )
}

/** Lucía's phone before the link: her lock screen, then Ada's message on it. */
function LockScreen({ t }: { t: number }) {
  const banner = hero(span(t, cues.banner, cues.banner + 0.45))
  return (
    <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(170deg, ${TEAL} 0%, #c9dcda 45%, ${PAPER} 100%)` }}>
      <div style={{ ...ui, position: 'absolute', top: 360, width: SCREEN_W, textAlign: 'center', fontWeight: 600, fontSize: 64, color: 'rgba(11,26,29,0.75)' }}>Monday 12 October</div>
      <div style={{ ...ui, position: 'absolute', top: 430, width: SCREEN_W, textAlign: 'center', fontWeight: 700, fontSize: 300, letterSpacing: '-0.04em', color: 'rgba(11,26,29,0.85)' }}>9:41</div>
      {banner > 0 ? (
        <div style={{ position: 'absolute', left: 40, top: mix(1150, 820, banner), opacity: banner, width: SCREEN_W - 80, padding: '40px 44px', borderRadius: 64, background: 'rgba(255,255,255,0.9)', boxShadow: '0 30px 80px rgba(11,26,29,0.18)', display: 'flex', gap: 34, alignItems: 'flex-start' }}>
          <div style={{ width: 120, height: 120, flexShrink: 0, borderRadius: 30, background: INK, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width={66} height={66} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinejoin="round">
              <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5z" />
            </svg>
          </div>
          <div style={{ ...ui, flex: 1, color: INK }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 46, fontWeight: 700 }}>
              <span>Ada</span>
              <span style={{ fontSize: 38, fontWeight: 500, color: MUTED }}>now</span>
            </div>
            <div style={{ fontSize: 44, fontWeight: 500, lineHeight: 1.3, marginTop: 6 }}>Ada sent you $20 on Kova (Birthday coffee 🎂). Tap to claim it.</div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** Face ID: the glyph scans, then becomes a tick. */
function FaceId({ t }: { t: number }) {
  const [a, b] = cues.faceid
  const show = span(t, a, a + 0.15) * (1 - span(t, b - 0.12, b))
  if (show <= 0) return null
  const ok = span(t, a + 0.5, a + 0.68)
  const breathe = 1 - 0.05 * Math.sin(Math.PI * span(t, a + 0.15, a + 0.5))
  const line = { stroke: '#fff', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' }
  return (
    <div style={{ position: 'absolute', left: SCREEN_W / 2 - 230, top: 1050, width: 460, height: 460, borderRadius: 96, background: 'rgba(24,26,27,0.86)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: show, transform: `scale(${mix(0.9, 1, show)})` }}>
      <svg width={260} height={260} viewBox="0 0 24 24" style={{ transform: `scale(${ok > 0 ? 1 : breathe})` }}>
        {ok <= 0 ? (
          <>
            <path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16" {...line} />
            <path d="M8.5 9v1.5M15.5 9v1.5M12 9v4h-1M9 16c1.6 1.4 4.4 1.4 6 0" {...line} />
          </>
        ) : (
          <path d="M6 12.5l4 4 8-9" {...line} strokeWidth={2} strokeDasharray={20} strokeDashoffset={20 * (1 - ok)} />
        )}
      </svg>
    </div>
  )
}

// ——— The envelope ————————————————————————————————————————————————————————————————————

function Envelope({ width = 230 }: { width?: number }) {
  return (
    <svg width={width} height={(width * 190) / 240} viewBox="0 0 240 190">
      <rect x={10} y={58} width={220} height={122} rx={16} fill="#a94b40" stroke={INK} strokeWidth={4} />
      <g transform="rotate(-4 120 70)">
        <rect x={40} y={12} width={160} height={100} rx={8} fill={CREAM} stroke={INK} strokeWidth={4} />
        <text x={120} y={34} textAnchor="middle" fontFamily="Manrope" fontWeight={600} fontSize={9.5} fill={MUTED}>
          For anyone with the link
        </text>
        <text x={120} y={78} textAnchor="middle" fontFamily="Manrope" fontWeight={800} fontSize={36} letterSpacing={-1} fill={INK}>
          $20.00
        </text>
      </g>
      <path d="M10,96 L120,146 L230,96 L230,164 Q230,180 214,180 L26,180 Q10,180 10,164 Z" fill={CORAL} stroke={INK} strokeWidth={4} strokeLinejoin="round" />
      <circle cx={120} cy={146} r={17} fill={GOLD} stroke={INK} strokeWidth={4} />
      <text x={120} y={153} textAnchor="middle" fontFamily="Manrope" fontWeight={800} fontSize={20} fill={INK}>
        $
      </text>
    </svg>
  )
}

/** The envelope's flight from Ada's phone to Lucía's, over a dotted arc that stays behind it. */
function Flight({ t }: { t: number }) {
  const [a, b] = cues.flight
  if (t < a || t > cues.linkOut + 0.3) return null
  const from = onScreen(adaPhone(a), 590, 1030)
  const to = onScreen(luciaPhone(b), 590, 1150)
  const ctrl: [number, number] = [(from[0] + to[0]) / 2, Math.min(from[1], to[1]) - 430]
  const at = (e: number): [number, number] => [
    (1 - e) ** 2 * from[0] + 2 * (1 - e) * e * ctrl[0] + e * e * to[0],
    (1 - e) ** 2 * from[1] + 2 * (1 - e) * e * ctrl[1] + e * e * to[1],
  ]
  const e = ease(t, a, b)
  const [x, y] = at(e)
  const [nx, ny] = at(Math.min(1, e + 0.01))
  const angle = (Math.atan2(ny - y, nx - x) * 180) / Math.PI
  const scale = mix(1, 0.42, span(e, 0.7, 1)) * (1 + 0.12 * Math.sin(Math.PI * e))
  const landed = t >= b
  const trailFade = 1 - span(t, b + 0.3, cues.linkOut)
  // Dots at even steps along the path, up to where the envelope is.
  const dots: [number, number][] = []
  let last = at(0)
  let walked = 0
  for (let i = 1; i <= 400; i++) {
    const p = at(i / 400)
    walked += Math.hypot(p[0] - last[0], p[1] - last[1])
    last = p
    if (i / 400 > e) break
    if (walked >= 26) {
      dots.push(p)
      walked = 0
    }
  }
  const burst = span(t, b, b + 0.45)
  return (
    <>
      {dots.map(([dx, dy], i) => (
        <div key={i} style={{ position: 'absolute', left: dx - 5, top: dy - 5, width: 10, height: 10, borderRadius: 5, background: INK, opacity: 0.55 * trailFade }} />
      ))}
      {!landed ? (
        <div style={{ position: 'absolute', left: x - 115, top: y - 91, transform: `rotate(${angle * 0.35}deg) scale(${scale})`, filter: 'drop-shadow(0 18px 24px rgba(11,26,29,0.22))' }}>
          <Envelope />
        </div>
      ) : burst < 1 ? (
        <div style={{ position: 'absolute', left: to[0] - 40 - 90 * burst, top: to[1] - 40 - 90 * burst, width: 80 + 180 * burst, height: 80 + 180 * burst, borderRadius: '50%', border: `8px solid ${CORAL}`, opacity: 1 - burst }} />
      ) : null}
    </>
  )
}

// ——— The film ——————————————————————————————————————————————————————————————————————————

export function LinkFilm({ sound = true, score = 'd' }: { sound?: boolean; score?: string }) {
  const frame = useCurrentFrame()
  const t = frame / FPS
  const [handle] = useState(() => delayRender('Manrope'))
  useEffect(() => {
    fonts.then(() => continueRender(handle))
  }, [handle])

  const ada = adaPhone(t)
  const lucia = luciaPhone(t)
  const adaScreen = frameAt(cues.ada as unknown as [number, string][], t)
  const luciaScreen = frameAt(cues.lucia as unknown as [number, string][], t)
  const opened = span(t, cues.open, cues.open + 0.22)
  const [adaLabel, luciaLabel] = [onScreen(ada, 590, SCREEN_H + 120), onScreen(lucia, 590, SCREEN_H + 120)]
  const labels = span(t, cues.luciaIn[1] - 0.1, cues.luciaIn[1] + 0.2) * (1 - span(t, cues.move2[0], cues.move2[0] + 0.2))
  const ew = cues.endWords

  return (
    <AbsoluteFill style={{ background: PAPER }}>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse 70% 60% at 50% 40%, rgba(255,255,255,0.55), rgba(255,255,255,0) 70%)' }} />

      {/* Ada, with her link. */}
      {ada.x > -400 ? (
        <IPhone src={`link/ada/${adaScreen}.jpg`} h={ada.h} x={ada.x} y={ada.y}>
          <Slide t={t} />
          <Tap t={t} at={cues.shareTap} x={1047} y={2075} />
        </IPhone>
      ) : null}

      {/* Lucía, in Madrid: her lock screen, Ada's message, then the link itself. */}
      {lucia.x < 2300 ? (
        <IPhone h={lucia.h} x={lucia.x} y={lucia.y}>
          {t >= cues.open ? (
            <Img src={staticFile(`link/lucia/${luciaScreen}.jpg`)} style={{ position: 'absolute', left: 0, top: 0, width: SCREEN_W, height: SCREEN_H, opacity: opened, transform: `scale(${mix(0.94, 1, hero(opened))})`, transformOrigin: '50% 30%' }} />
          ) : null}
          {opened < 1 ? (
            <div style={{ position: 'absolute', inset: 0, opacity: 1 - opened }}>
              <LockScreen t={t} />
            </div>
          ) : null}
          <Tap t={t} at={cues.bannerTap} x={590} y={980} />
          <Ring t={t} at={cues.euro} box={[314, 780, 865, 864]} out={cues.s3bOut} />
          <Tap t={t} at={cues.faceTap} x={860} y={1533} />
          <Tap t={t} at={cues.makeTap} x={860} y={1832} />
          <FaceId t={t} />
          <Ring t={t} at={cues.ring} box={[287, 1839, 892, 1934]} out={cues.s5Out} />
        </IPhone>
      ) : null}

      {labels > 0 ? (
        <>
          <div style={{ ...ui, position: 'absolute', left: adaLabel[0] - 200, top: adaLabel[1] - 10, width: 400, textAlign: 'center', fontWeight: 700, fontSize: 28, color: INK, opacity: labels }}>Ada, in London</div>
          <div style={{ ...ui, position: 'absolute', left: luciaLabel[0] - 200, top: luciaLabel[1] - 10, width: 400, textAlign: 'center', fontWeight: 700, fontSize: 28, color: INK, opacity: labels }}>Lucía, in Madrid</div>
        </>
      ) : null}

      <Flight t={t} />

      {/* 1. The promise, there from the first frame. */}
      <Caption t={t} x={1060} y={360} size={116} out={cues.move1[0]} lines={[{ text: 'Send $20', at: [-1, -1] }, { text: 'to anyone.', at: [-1, -1], color: CORAL }]} />
      {/* 2. While it flies. */}
      <Caption t={t} x={960} y={600} size={76} align="center" out={cues.linkOut} lines={[{ text: 'with a link.', at: cues.linkWords, color: CORAL }]} />
      {/* 3. Lucía has nothing installed. */}
      <Caption t={t} x={150} y={360} out={cues.s3Out} lines={[{ text: 'No app.', at: cues.s3Words.slice(0, 2) }, { text: 'No wallet yet.', at: cues.s3Words.slice(2), color: CORAL }]} />
      <Caption t={t} x={150} y={360} out={cues.s3bOut} lines={[{ text: 'She sees', at: cues.s3bWords.slice(0, 2) }, { text: '€17.71.', at: cues.s3bWords.slice(2), color: CORAL }]} />
      <Sub t={t} at={cues.s3bSub} out={cues.s3bOut} x={154} y={580} text="Approximate, at the Chainlink rate." />
      {/* 4. Face ID. */}
      <Caption t={t} x={150} y={360} out={cues.s4Out} lines={[{ text: 'Face ID makes', at: cues.s4Words.slice(0, 3) }, { text: 'her a wallet.', at: cues.s4Words.slice(3), color: CORAL }]} />
      {/* 5. The moment. */}
      <Caption t={t} x={150} y={330} out={cues.s5Out} lines={[{ text: 'Hers in', at: cues.s5Words.slice(0, 2) }, { text: '0.6 s.', at: cues.s5Words.slice(2), color: CORAL, size: 150 }]} />
      <Sub t={t} at={cues.s5Sub} out={cues.s5Out} x={154} y={640} text="On Monad. Kova paid the fee." />

      {/* 6. The line, and Kova. */}
      <Caption t={t} x={960} y={330} size={104} align="center" lines={[{ text: 'Send dollars to anyone.', at: ew.slice(0, 4) }, { text: 'Just send a link.', at: ew.slice(4), color: CORAL }]} />
      {t >= cues.mark ? (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 620, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 28, transform: `scale(${0.85 + 0.15 * bounce(t, cues.mark)})` }}>
          <Mark h={70} />
          <span style={{ ...ui, fontWeight: 800, fontSize: 40, color: INK, padding: '10px 30px', borderRadius: 999, border: `4px solid ${INK}`, background: CREAM }}>mykova.app</span>
        </div>
      ) : null}
      <Sub t={t} at={cues.proof} x={960} y={760} align="center" text="A real run on Monad testnet · claim 0x88a13215…cb081622" />

      <Grain frame={frame} />
      <AbsoluteFill style={{ background: '#000', opacity: span(t, cues.fadeOut, cues.duration), pointerEvents: 'none' }} />
      {sound ? <Html5Audio src={staticFile(`link/sound-${score}.wav`)} /> : null}
    </AbsoluteFill>
  )
}
