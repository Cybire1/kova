/**
 * The Claude Ultra clip's ending (square, 4.2 s): the real Kova card that paid (•••• 3421, cut from
 * the app) drops in, Kovi peeks over its top edge, the app's own "ANTHROPIC* CLAUDE SUB −$119.96" row
 * rises under it, Kovi hops onto the card with "Paid!", and the line and link settle.
 *
 * One motion vocabulary: objects rise or drop on a decelerating ease, words sharpen in, and one
 * bouncy moment, Kovi's hop (the signature). Paper ground, the coral card, Kovi's yellow: one accent.
 */
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion'
import { decel, FPS, hero, hop, mix, presenceStyle, rise, span } from '../motion'

export const END_DURATION = 4.2

const GROUND = '#0b1a1d'
const PAPER = '#f1efea'
const INK = '#0b1a1d'
const CORAL = '#d46558'
const CARD_W = 600
const CARD_H = Math.round((CARD_W * 499) / 785)
const CX = 540
const CY = 440
/** Kovi's sticker cut-outs: the 1024 px art with a 40 px white border all round, so 1104 px. */
const STICKER = 1104 / 1024
const PAD = 40 / 1024
const LAND = 0.45
const PEEK = 0.75
const JUMP = 1.55

export function End() {
  const t = useCurrentFrame() / FPS
  // The card: drops from above, rotating into a slight tilt.
  const drop = decel(span(t, 0, LAND))
  const cardY = mix(-420, CY, drop)
  const tilt = mix(-14, -4, drop)
  // Kovi behind the card: rises until the face clears the top edge.
  const peek = decel(span(t, PEEK, PEEK + 0.45))
  const jumped = t >= JUMP
  const kovSize = 240
  const edgeY = CY - CARD_H / 2
  const peekY = mix(edgeY + 60, edgeY - kovSize * 0.42, peek)
  // Then the hop: up and onto the card's top edge, standing.
  const air = decel(span(t, JUMP, JUMP + 0.35))
  // The card tilts 4° up to the right, so its top edge sits higher where Kovi stands.
  const standY = edgeY - kovSize + 48 - Math.tan((4 * Math.PI) / 180) * 160
  // Once landed, a small happy bounce (the one idle behaviour, 10 px).
  const happy = t > JUMP + 0.8 ? -Math.abs(Math.sin((t - JUMP - 0.8) * 5.2)) * 10 : 0
  const hopY = jumped ? mix(peekY, standY, air) + hop(t, JUMP + 0.35, 46) - Math.sin(Math.PI * span(t, JUMP, JUMP + 0.35)) * 90 + happy : peekY
  const kx = CX + 160
  const bubble = decel(span(t, JUMP + 0.45, JUMP + 0.75))
  const sparkles = [
    { x: kx - 165, y: standY + 70, at: JUMP + 0.4, s: 54, img: 'sparkle-1' },
    { x: kx - 120, y: standY - 10, at: JUMP + 0.55, s: 38, img: 'sparkle-8' },
    { x: kx + 175, y: standY + 150, at: JUMP + 0.5, s: 44, img: 'sparkle-4' },
  ]
  return (
    <AbsoluteFill style={{ background: GROUND, overflow: 'hidden' }}>
      {/* Kovi, behind the card while peeking. */}
      {!jumped ? (
        <Img
          src={staticFile('claudeultra/kovi-wave-sticker.png')}
          style={{ position: 'absolute', width: kovSize * STICKER, height: kovSize * STICKER, left: kx - (kovSize * STICKER) / 2, top: peekY - kovSize * PAD, opacity: span(t, PEEK, PEEK + 0.1) }}
        />
      ) : null}
      {/* The card. */}
      <div style={{ position: 'absolute', left: CX - CARD_W / 2, top: cardY - CARD_H / 2, width: CARD_W, height: CARD_H, transform: `rotate(${tilt}deg)`, transformOrigin: '50% 50%' }}>
        <Img src={staticFile('claudeultra/card-3421.png')} style={{ width: CARD_W, height: CARD_H, display: 'block' }} />
      </div>
      {/* Kovi, on top of the card after the hop. */}
      {jumped ? (
        <Img src={staticFile('claudeultra/kovi-cheer-sticker.png')} style={{ position: 'absolute', width: kovSize * STICKER, height: kovSize * STICKER, left: kx - (kovSize * STICKER) / 2, top: hopY - kovSize * PAD, transform: `rotate(${mix(0, -4, air)}deg)` }} />
      ) : null}
      {sparkles.map((s) => {
        const p = decel(span(t, s.at, s.at + 0.35))
        const fade = 1 - span(t, s.at + 1.4, s.at + 1.9)
        return p > 0 ? (
          <Img key={s.img} src={staticFile(`art/${s.img}.png`)} style={{ position: 'absolute', width: s.s, height: s.s, left: s.x - s.s / 2, top: s.y - s.s / 2, opacity: p * fade, transform: `scale(${0.4 + 0.6 * p}) rotate(${p * 30}deg)` }} />
        ) : null
      })}
      {/* "Paid!" */}
      {bubble > 0 ? (
        <div style={{ position: 'absolute', left: kx + 92, top: standY - 6, transform: `scale(${0.6 + 0.4 * bubble})`, transformOrigin: '0% 100%', opacity: bubble }}>
          <div style={{ position: 'relative', background: '#ffffff', border: `4px solid ${INK}`, borderRadius: 34, padding: '10px 26px 14px', fontFamily: 'Caveat', fontWeight: 700, fontSize: 64, color: INK, lineHeight: 1 }}>
            Paid!
            <svg width="34" height="30" viewBox="0 0 34 30" style={{ position: 'absolute', left: 10, bottom: -27 }} aria-hidden="true">
              <path d="M2 0 L14 26 L30 0" fill="#ffffff" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
              <rect x="0" y="-6" width="34" height="8" fill="#ffffff" />
            </svg>
          </div>
        </div>
      ) : null}
      {/* The receipt: the charge as the Kova app shows it. */}
      <div style={{ position: 'absolute', left: 130, width: 820, top: 676, height: 97, borderRadius: 28, overflow: 'hidden', border: '2px solid #263c3f', ...presenceStyle(rise(t, 1.0)) }}>
        <Img src={staticFile('claudeultra/row-claude.png')} style={{ width: 820, height: 97, display: 'block' }} />
      </div>
      {/* The line and the link. */}
      <p style={{ position: 'absolute', left: 0, right: 0, top: 818, margin: 0, textAlign: 'center', fontFamily: 'Manrope', fontWeight: 800, fontSize: 68, letterSpacing: '-0.035em', color: PAPER, ...presenceStyle(hero(t, 1.05)) }}>
        Paid with a Kova card.
      </p>
      <p style={{ position: 'absolute', left: 0, right: 0, top: 912, margin: 0, textAlign: 'center', fontFamily: 'Manrope', fontWeight: 700, fontSize: 46, color: CORAL, ...presenceStyle(rise(t, 1.45)) }}>
        mykova.app
      </p>
    </AbsoluteFill>
  )
}
