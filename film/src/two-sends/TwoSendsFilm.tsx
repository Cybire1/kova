/**
 * Two private sends, two addresses: the X cut of the user's own recording (film/kovaa.mp4) of Ada
 * paying Sam $0.50 privately, twice, on Monad testnet. The one thing to see is where each payment
 * lands: 0xd793…989b the first time, 0x567a…5Fc4 the second, and Sam's own address in neither.
 *
 * The footage arrives pre-cut and cleaned in public/two-sends/edit.mp4: the Mac around the two
 * simulators (striped margins, desktop icons, menu bar, Dock) is painted out in the wallpaper's own
 * peach along the screen recorder's camera track, and edit.json gives every frame's source frame and
 * camera (scale s, pan tx, ty from the unzoomed desktop). Over it: Ada and Sam named where the
 * simulator title bars were (they follow every zoom), a ring on each address while its frame holds,
 * a caption band that says which payment it is, and a marker whenever the footage runs faster than
 * real time. Then both addresses side by side, and the end card.
 *
 * On chain (Monad testnet, read back from the RPC):
 *   payment 1  tx 0x2228b2af…7ce9f8  block 71,316,641  0.5 AUSD Ada → 0xd793F5E1…A254D989b
 *   payment 2  tx 0x7dbf7484…794fbd  block 71,316,786  0.5 AUSD Ada → 0x567a859d…4DeB5Fc4
 * Sam's own address (0xcBE3dE…18ED26) is in neither transfer and neither ERC-5564 announcement.
 */
import { type ReactNode, useEffect, useState } from 'react'
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  Easing,
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
import { fontsReady } from '../theme'
import edit from './edit.json'
import vo from './vo.json'

export const FPS = 30
const K = {
  ink: '#0B1A1D',
  coral: '#D46558',
  teal: '#2F6669',
  surface: '#F1EFEA',
  muted: '#4A5A5C',
  cream: '#FBF6F2',
  peach: '#F3D6C3',
}
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

/** The footage sits this far up, so the caption band covers only rows that held the Dock. */
const SHIFT = 40
const BAND = 116

type Seg = { name: string; kind: string; from: number; frames: number; src: number; rate: number }
const SEGS = edit.segments as Seg[]
const CAM = edit.frames as [number, number, number, number][]
const seg = (name: string) => SEGS.find((x) => x.name === name) as Seg
const at = (name: string) => seg(name).from
const endOf = (name: string) => seg(name).from + seg(name).frames

export const FOOT = CAM.length
const REVEAL = 225
const END = 105
/** The two addresses fade in over the footage's last 12 frames. */
const REVEAL_AT = FOOT - 12
const END_AT = REVEAL_AT + REVEAL
export const TWO_SENDS_DURATION = END_AT + END

// ── Words ───────────────────────────────────────────────────────────────────────────────────
// *…* is coral. About 15 characters a second, never under two.

const CAPTIONS: { from: number; to: number; text: string }[] = [
  { from: 0, to: 62, text: 'Ada pays Sam privately. *Twice.*' },
  { from: 62, to: 130, text: 'Watch where each *$0.50* lands.' },
  { from: 160, to: 262, text: 'One switch: *Send privately*.' },
  { from: 288, to: 372, text: 'Sent. Arrived in *1.09 s* on Monad.' },
  { from: 372, to: 445, text: 'Sam’s phone: “Ada paid you privately.”' },
  { from: 445, to: 522, text: 'But on Monad, it went to *0xd793…989b*.' },
  { from: 522, to: 600, text: 'An address made for this payment alone.' },
  { from: 600, to: 680, text: 'Monadscan: Ada → *0xd793…989b*. No Sam.' },
  { from: 680, to: endOf('addr1-hold'), text: 'Only Sam’s keys can open this address.' },
  { from: at('start2'), to: 835, text: 'Payment 2. Same Ada, same Sam.' },
  { from: 835, to: 896, text: 'Same switch, same $0.50.' },
  { from: 896, to: 988, text: 'Sent. Arrived in *0.93 s*.' },
  { from: 988, to: 1063, text: 'This time it went to *0x567a…5Fc4*.' },
  { from: 1063, to: 1138, text: 'A different address. Still only Sam’s.' },
  { from: 1138, to: FOOT, text: 'Sam’s phone finds it through *ERC-5564*.' },
]

/** Where the footage runs faster than it happened. */
const FAST = [
  { from: at('sending1'), to: endOf('sending1'), label: '×4' },
  { from: at('start2'), to: endOf('review2'), label: '×2' },
  { from: at('sending2'), to: endOf('sending2'), label: '×4' },
]

/** A highlighter swipe over each address: in the held frame's own pixels, or (ref) on the desktop, following the camera. */
const MARKS: { from: number; to: number; box: [number, number, number, number]; ref?: boolean }[] =
  [
    { from: at('card1-hold'), to: endOf('card1-hold'), box: [772, 545, 907, 575] },
    { from: at('scan1-hold'), to: endOf('scan1-hold'), box: [511, 513, 763, 543] },
    { from: at('addr1-hold'), to: endOf('addr1-hold'), box: [484, 580, 1007, 616] },
    { from: at('card2-hold'), to: endOf('card2-hold'), box: [772, 541, 901, 571] },
    // "Announce" on the ERC-5564 announcement's Monadscan page, while the camera follows the cursor.
    { from: at('announce2') + 55, to: FOOT - 4, box: [583, 483, 652, 509], ref: true },
  ]

// ── Footage ─────────────────────────────────────────────────────────────────────────────────

function cam(f: number) {
  const c = CAM[Math.min(Math.max(f, 0), CAM.length - 1)] as [number, number, number, number]
  return { s: c[1], tx: c[2], ty: c[3] }
}

/** A layer in the unzoomed desktop's pixels, moved and scaled with the recorder's camera. */
function OnDesktop({
  f,
  blend = false,
  children,
}: {
  f: number
  blend?: boolean
  children: ReactNode
}) {
  const { s, tx, ty } = cam(f)
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: 1920,
        height: 1080,
        transformOrigin: '0 0',
        transform: `translate(${tx}px, ${ty - SHIFT}px) scale(${s})`,
        mixBlendMode: blend ? 'multiply' : undefined,
      }}
    >
      {children}
    </div>
  )
}

/** Ada and Sam, named over the simulator title bars ("Kova Keys iPhone 16", "Kova iPhone 16"). */
function NameTag({
  x,
  y,
  w,
  h,
  name,
  role,
  avatar,
}: {
  x: number
  y: number
  w: number
  h: number
  name: string
  role: string
  avatar: string
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x - 2,
        top: y - 2,
        width: w + 4,
        height: h + 4,
        borderRadius: 13,
        background: K.ink,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        fontFamily: 'Manrope',
      }}
    >
      <Img src={staticFile(avatar)} style={{ width: 36, height: 36, borderRadius: 18 }} />
      <span style={{ fontWeight: 800, fontSize: 25, color: K.cream, letterSpacing: -0.3 }}>
        {name}
      </span>
      <span style={{ fontWeight: 600, fontSize: 21, color: 'rgba(251, 246, 242, 0.62)' }}>
        {role}
      </span>
    </div>
  )
}

function Mark({
  f,
  from,
  to,
  box,
}: {
  f: number
  from: number
  to: number
  box: [number, number, number, number]
}) {
  if (f < from || f >= to) return null
  const [x0, y0, x1, y1] = box
  const sweep = interpolate(f - from, [0, 9], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  })
  const fade = interpolate(f, [to - 5, to], [1, 0], clamp)
  return (
    <div
      style={{
        position: 'absolute',
        left: x0,
        top: y0,
        width: (x1 - x0) * sweep,
        height: y1 - y0,
        borderRadius: 7,
        background: '#F5AFA4',
        opacity: fade,
      }}
    />
  )
}

function Footage() {
  const f = useCurrentFrame()
  const tags = (
    <OnDesktop f={f}>
      <NameTag x={330} y={48} w={435} h={52} name="Ada" role="sends" avatar="two-sends/ada.png" />
      <NameTag
        x={995}
        y={57}
        w={435}
        h={53}
        name="Sam"
        role="receives"
        avatar="two-sends/sam.png"
      />
    </OnDesktop>
  )
  return (
    <AbsoluteFill style={{ background: K.peach, overflow: 'hidden' }}>
      <OffthreadVideo
        src={staticFile('two-sends/edit.mp4')}
        muted
        style={{ position: 'absolute', left: 0, top: -SHIFT, width: 1920, height: 1080 }}
      />
      {tags}
      {/* Multiplied at the layer itself: it has to blend with the footage behind it, not inside its own group. */}
      {MARKS.map((m) =>
        m.ref ? (
          <OnDesktop key={m.from} f={f} blend>
            <Mark f={f} from={m.from} to={m.to} box={m.box} />
          </OnDesktop>
        ) : (
          <div
            key={m.from}
            style={{
              position: 'absolute',
              left: 0,
              top: -SHIFT,
              width: 1920,
              height: 1080,
              mixBlendMode: 'multiply',
            }}
          >
            <Mark f={f} from={m.from} to={m.to} box={m.box} />
          </div>
        ),
      )}
    </AbsoluteFill>
  )
}

// ── The caption band ────────────────────────────────────────────────────────────────────────

function Words({ text }: { text: string }) {
  return (
    <span style={{ whiteSpace: 'pre' }}>
      {text.split('*').map((part, i) => (
        <span key={`${i}${part}`} style={{ color: i % 2 ? '#F08A7E' : K.cream }}>
          {part}
        </span>
      ))}
    </span>
  )
}

function FastForward({ size, pulse }: { size: number; pulse: number }) {
  return (
    <svg width={size * 1.5} height={size} viewBox="0 0 30 20" style={{ display: 'block' }}>
      <path d="M2 2 L13 10 L2 18 Z" fill={K.cream} opacity={0.55 + 0.45 * pulse} />
      <path d="M14 2 L25 10 L14 18 Z" fill={K.cream} opacity={1 - 0.45 * pulse} />
    </svg>
  )
}

function Band() {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const leave = interpolate(f, [FOOT - 9, FOOT], [0, 1], {
    ...clamp,
    easing: Easing.in(Easing.cubic),
  })

  const two = f >= at('start2')
  const chipSwap = interpolate(f, [at('start2') - 4, at('start2') + 4], [0, 1], clamp)

  const fast = FAST.find((x) => f >= x.from && f < x.to)
  const fastIn = fast
    ? spring({ frame: f - fast.from, fps, config: { damping: 14, stiffness: 220 } })
    : 0
  const fastOut = fast ? interpolate(f, [fast.to - 4, fast.to], [1, 0], clamp) : 0

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: BAND,
        transform: `translateY(${leave * BAND}px)`,
        background: K.ink,
        fontFamily: 'Manrope',
      }}
    >
      {/* Which payment this is. */}
      <div
        style={{
          position: 'absolute',
          left: 56,
          top: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ width: 14, height: 14, borderRadius: 7, background: K.coral }} />
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 7,
              background: two ? K.coral : 'rgba(251, 246, 242, 0.22)',
            }}
          />
        </div>
        <div style={{ position: 'relative', height: 30, width: 220 }}>
          <div
            style={{
              position: 'absolute',
              fontWeight: 800,
              fontSize: 24,
              letterSpacing: 3.5,
              color: K.coral,
              opacity: 1 - chipSwap,
              transform: `translateY(${-chipSwap * 10}px)`,
            }}
          >
            PAYMENT 1
          </div>
          <div
            style={{
              position: 'absolute',
              fontWeight: 800,
              fontSize: 24,
              letterSpacing: 3.5,
              color: K.coral,
              opacity: chipSwap,
              transform: `translateY(${(1 - chipSwap) * 10}px)`,
            }}
          >
            PAYMENT 2
          </div>
        </div>
      </div>

      {/* The words. */}
      {CAPTIONS.map((c, i) => {
        if (f < c.from - 1 || f >= c.to) return null
        const enter =
          i === 0
            ? 1
            : interpolate(f, [c.from, c.from + 6], [0, 1], {
                ...clamp,
                easing: Easing.out(Easing.cubic),
              })
        const exit = interpolate(f, [c.to - 5, c.to], [1, 0], clamp)
        return (
          <div
            key={c.text}
            style={{
              position: 'absolute',
              left: 360,
              right: 360,
              top: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              fontWeight: 700,
              fontSize: 46,
              letterSpacing: -0.6,
              whiteSpace: 'nowrap',
              opacity: Math.min(enter, exit),
              transform: `translateY(${(1 - enter) * 14}px)`,
            }}
          >
            <Words text={c.text} />
          </div>
        )
      })}

      {/* Faster than real time, said plainly. */}
      {fast ? (
        <div
          style={{
            position: 'absolute',
            right: 56,
            top: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            opacity: fastOut,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: K.coral,
              borderRadius: 999,
              padding: '10px 24px 10px 20px',
              transform: `scale(${0.6 + 0.4 * fastIn})`,
            }}
          >
            <FastForward
              size={22}
              pulse={(Math.sin(((f - fast.from) / fps) * Math.PI * 4) + 1) / 2}
            />
            <span style={{ fontWeight: 800, fontSize: 32, color: K.cream }}>{fast.label}</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ── Both addresses ──────────────────────────────────────────────────────────────────────────

const PAYMENTS = [
  {
    label: 'PAYMENT 1 · $0.50',
    address: '0xd793…989b',
    meta: 'tx 0x2228…e9f8 · block 71,316,641',
    y: 446,
  },
  {
    label: 'PAYMENT 2 · $0.50',
    address: '0x567a…5Fc4',
    meta: 'tx 0x7dbf…4fbd · block 71,316,786',
    y: 676,
  },
]
const ADA = { x: 300, y: 560 }
const SAM = { x: 1620, y: 560 }
const LOCK = { x: 1440, y: 561 }
const CHIP = { x0: 690, x1: 1230, h: 168 }

function Person({
  x,
  y,
  name,
  address,
  note,
  noteIn = 0,
  pop,
}: {
  x: number
  y: number
  name: string
  address: string
  note?: string
  noteIn?: number
  pop: number
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x - 140,
        top: y - 80,
        width: 280,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        fontFamily: 'Manrope',
        opacity: Math.min(1, pop * 1.4),
        transform: `scale(${0.7 + 0.3 * pop})`,
      }}
    >
      <Img
        src={staticFile(name === 'Ada' ? 'two-sends/ada.png' : 'two-sends/sam.png')}
        style={{
          width: 160,
          height: 160,
          borderRadius: 80,
          boxShadow: '0 16px 34px rgba(11, 26, 29, 0.16)',
        }}
      />
      <div
        style={{ marginTop: 16, fontWeight: 800, fontSize: 38, color: K.ink, letterSpacing: -0.5 }}
      >
        {name}
      </div>
      <div style={{ marginTop: 2, fontWeight: 600, fontSize: 23, color: K.muted }}>{address}</div>
      {note ? (
        <div
          style={{
            marginTop: 8,
            fontWeight: 700,
            fontSize: 21,
            color: K.coral,
            textAlign: 'center',
            lineHeight: 1.3,
            opacity: noteIn,
          }}
        >
          {note}
        </div>
      ) : null}
    </div>
  )
}

function Reveal() {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const pop = (from: number, stiffness = 170) =>
    spring({ frame: f - from, fps, config: { damping: 15, stiffness } })
  const fadeUp = (from: number) => ({
    opacity: interpolate(f, [from, from + 10], [0, 1], clamp),
    transform: `translateY(${interpolate(f, [from, from + 12], [18, 0], { ...clamp, easing: Easing.out(Easing.cubic) })}px)`,
  })
  const draw = (from: number, len = 14) =>
    interpolate(f, [from, from + len], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) })

  const words = ['Two payments.', 'Two addresses.', 'Both Sam’s.']

  // Public: Ada to each one-time address. Private: each address to Sam, through Sam's keys.
  const pub = [
    `M ${ADA.x + 92} ${ADA.y - 30} C ${ADA.x + 230} ${ADA.y - 30}, ${CHIP.x0 - 150} ${PAYMENTS[0]!.y}, ${CHIP.x0 - 14} ${PAYMENTS[0]!.y}`,
    `M ${ADA.x + 92} ${ADA.y + 30} C ${ADA.x + 230} ${ADA.y + 30}, ${CHIP.x0 - 150} ${PAYMENTS[1]!.y}, ${CHIP.x0 - 14} ${PAYMENTS[1]!.y}`,
  ]
  const priv = [
    `M ${CHIP.x1 + 10} ${PAYMENTS[0]!.y} C ${CHIP.x1 + 120} ${PAYMENTS[0]!.y}, ${LOCK.x - 110} ${LOCK.y - 4}, ${LOCK.x - 34} ${LOCK.y - 4}`,
    `M ${CHIP.x1 + 10} ${PAYMENTS[1]!.y} C ${CHIP.x1 + 120} ${PAYMENTS[1]!.y}, ${LOCK.x - 110} ${LOCK.y + 4}, ${LOCK.x - 34} ${LOCK.y + 4}`,
  ]
  const lockPop = pop(88, 200)

  return (
    <AbsoluteFill style={{ background: K.peach, fontFamily: 'Manrope', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 104,
          display: 'flex',
          justifyContent: 'center',
          gap: 22,
          fontWeight: 800,
          fontSize: 80,
          letterSpacing: -3,
          color: K.ink,
        }}
      >
        {words.map((w, i) => (
          <span key={w} style={fadeUp(4 + i * 7)}>
            {w.slice(0, -1)}
            <span style={{ color: K.coral }}>.</span>
          </span>
        ))}
      </div>

      <svg width={1920} height={1080} style={{ position: 'absolute', left: 0, top: 0 }}>
        <defs>
          <marker
            id="ink-arrow"
            viewBox="0 0 10 10"
            refX="6"
            refY="5"
            markerWidth="4.5"
            markerHeight="4.5"
            orient="auto"
          >
            <path d="M0 0 L10 5 L0 10 Z" fill={K.ink} />
          </marker>
          <marker
            id="coral-arrow"
            viewBox="0 0 10 10"
            refX="6"
            refY="5"
            markerWidth="4.5"
            markerHeight="4.5"
            orient="auto"
          >
            <path d="M0 0 L10 5 L0 10 Z" fill={K.coral} />
          </marker>
        </defs>
        {pub.map((d, i) => {
          const t = draw(26 + i * 18)
          return (
            <path
              key={d}
              d={d}
              fill="none"
              stroke={K.ink}
              strokeWidth={5}
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - t}
              markerEnd={t > 0.96 ? 'url(#ink-arrow)' : undefined}
            />
          )
        })}
        {priv.map((d, i) => {
          const t = draw(70 + i * 6, 16)
          return (
            <g key={d}>
              <mask
                id={`priv-${i}`}
                maskUnits="userSpaceOnUse"
                x={0}
                y={0}
                width={1920}
                height={1080}
              >
                <path
                  d={d}
                  fill="none"
                  stroke="#fff"
                  strokeWidth={14}
                  strokeLinecap="round"
                  pathLength={1}
                  strokeDasharray={1}
                  strokeDashoffset={1 - t}
                />
              </mask>
              <path
                d={d}
                fill="none"
                stroke={K.coral}
                strokeWidth={5}
                strokeLinecap="round"
                strokeDasharray="2 14"
                mask={`url(#priv-${i})`}
              />
            </g>
          )
        })}
        {(() => {
          const t = draw(96, 10)
          return (
            <path
              d={`M ${LOCK.x + 34} ${LOCK.y} L ${SAM.x - 96} ${SAM.y}`}
              fill="none"
              stroke={K.coral}
              strokeWidth={5}
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - t}
              markerEnd={t > 0.96 ? 'url(#coral-arrow)' : undefined}
            />
          )
        })()}
      </svg>

      {/* What everyone sees, and what only Sam can. */}
      <div
        style={{
          position: 'absolute',
          left: 392,
          top: 314,
          width: 300,
          textAlign: 'center',
          fontWeight: 800,
          fontSize: 21,
          letterSpacing: 3,
          color: K.muted,
          ...fadeUp(40),
        }}
      >
        PUBLIC ON MONAD
      </div>
      <div
        style={{
          position: 'absolute',
          left: 1268,
          top: 314,
          width: 340,
          textAlign: 'center',
          fontWeight: 800,
          fontSize: 21,
          letterSpacing: 3,
          color: K.coral,
          ...fadeUp(92),
        }}
      >
        ONLY SAM’S KEYS
      </div>

      <Person x={ADA.x} y={ADA.y} name="Ada" address="0x51C8…0700" pop={pop(12)} />
      <Person
        x={SAM.x}
        y={SAM.y}
        name="Sam"
        address="0xcBE3…ED26"
        note="in neither payment"
        noteIn={interpolate(f, [100, 110], [0, 1], clamp)}
        pop={pop(16)}
      />

      {PAYMENTS.map((p, i) => {
        const k = pop(36 + i * 18, 200)
        return (
          <div
            key={p.address}
            style={{
              position: 'absolute',
              left: CHIP.x0,
              top: p.y - CHIP.h / 2,
              width: CHIP.x1 - CHIP.x0,
              height: CHIP.h,
              borderRadius: 30,
              background: K.surface,
              boxShadow: '0 18px 40px rgba(11, 26, 29, 0.12)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              padding: '0 40px',
              opacity: Math.min(1, k * 1.5),
              transform: `translateY(${(1 - k) * 26}px) scale(${0.92 + 0.08 * k})`,
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 21, letterSpacing: 3, color: K.teal }}>
              {p.label}
            </div>
            <div
              style={{
                marginTop: 4,
                fontWeight: 800,
                fontSize: 60,
                letterSpacing: -1.5,
                color: K.ink,
                lineHeight: 1.1,
              }}
            >
              {p.address}
            </div>
            <div style={{ marginTop: 6, fontWeight: 600, fontSize: 21, color: K.muted }}>
              {p.meta}
            </div>
          </div>
        )
      })}

      {/* Sam's keys: the only thing that ties the two addresses to Sam. */}
      <div
        style={{
          position: 'absolute',
          left: LOCK.x - 34,
          top: LOCK.y - 34,
          width: 68,
          height: 68,
          borderRadius: 34,
          background: K.coral,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 10px 24px rgba(212, 101, 88, 0.35)',
          opacity: Math.min(1, lockPop * 1.5),
          transform: `scale(${lockPop})`,
        }}
      >
        <svg width={30} height={34} viewBox="0 0 30 34">
          <path
            d="M8 15 V10 a7 7 0 0 1 14 0 V15"
            fill="none"
            stroke={K.cream}
            strokeWidth={3.6}
            strokeLinecap="round"
          />
          <rect x={3} y={14} width={24} height={18} rx={5} fill={K.cream} />
        </svg>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 878,
          display: 'flex',
          justifyContent: 'center',
          ...fadeUp(112),
        }}
      >
        <div
          style={{
            width: 1600,
            textAlign: 'center',
            fontWeight: 600,
            fontSize: 31,
            lineHeight: 1.45,
            color: 'rgba(11, 26, 29, 0.8)',
          }}
        >
          Each payment gets a new address, made from Sam’s public keys and a one-time key
          (ERC-5564).
          <br />
          <span style={{ fontWeight: 800, color: K.ink }}>
            Only Sam can find it, and only Sam can move it.
          </span>
        </div>
      </div>
    </AbsoluteFill>
  )
}

// ── End card ────────────────────────────────────────────────────────────────────────────────

function EndCard() {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const enter = (from: number) =>
    spring({ frame: f - from, fps, config: { damping: 16, stiffness: 140 } })
  const card = (from: number) => ({
    opacity: enter(from),
    transform: `translateY(${(1 - enter(from)) * 30}px)`,
  })
  const kovi = spring({ frame: f - 4, fps, config: { damping: 11, stiffness: 120 } })
  const bob = Math.sin((f / fps) * Math.PI * 1.55) * 10 * kovi
  return (
    <AbsoluteFill style={{ background: K.peach, fontFamily: 'Manrope', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 190, top: 268, width: 1080 }}>
        <div style={card(2)}>
          <Img
            src={staticFile('demo/kova-lockup.svg')}
            style={{ width: 290, height: 94.25, display: 'block' }}
          />
        </div>
        <div
          style={{
            ...card(5),
            marginTop: 34,
            fontWeight: 800,
            fontSize: 132,
            lineHeight: 0.96,
            letterSpacing: -5.5,
            color: K.ink,
          }}
        >
          Send privately<span style={{ color: K.coral }}>.</span>
        </div>
        <div style={{ ...card(9), marginTop: 44, display: 'flex' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 18,
              fontWeight: 800,
              fontSize: 42,
              color: K.cream,
              background: K.coral,
              borderRadius: 999,
              padding: '22px 40px',
              boxShadow: '0 14px 30px rgba(212, 101, 88, 0.32)',
            }}
          >
            Join the iOS beta
            <span>→</span>
            <span style={{ fontWeight: 700, opacity: 0.92 }}>mykova.app/waitlist</span>
          </div>
        </div>
        <div style={{ ...card(13), marginTop: 30, display: 'flex' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              fontWeight: 700,
              fontSize: 29,
              color: K.ink,
              background: K.surface,
              borderRadius: 999,
              padding: '10px 24px',
            }}
          >
            <div style={{ width: 14, height: 14, borderRadius: 7, background: K.teal }} />
            Private sends · on Monad testnet
          </div>
        </div>
      </div>
      <Img
        src={staticFile('art/kovi-cheer.png')}
        style={{
          position: 'absolute',
          left: 1240,
          top: 250 + bob,
          width: 560,
          height: 560,
          opacity: Math.min(1, kovi * 1.4),
          transform: `scale(${0.75 + 0.25 * kovi})`,
        }}
      />
    </AbsoluteFill>
  )
}

// ── Sound ───────────────────────────────────────────────────────────────────────────────────

/** Soft UI sounds where something happens on screen (frames on the film's timeline). */
const SFX: { at: number; src: string; volume: number }[] = [
  { at: 4, src: 'audio/kenney/card-place-1.ogg', volume: 0.3 }, // Send
  { at: 78, src: 'audio/kenney/card-place-2.ogg', volume: 0.3 }, // Sam's address pasted
  { at: 116, src: 'audio/kenney/card-place-3.ogg', volume: 0.3 }, // Sam picked
  { at: at('review1') + 33, src: 'audio/kenney/card-place-4.ogg', volume: 0.3 }, // Review
  { at: at('review1') + 102, src: 'private/sfx/lock.mp3', volume: 0.42 }, // slid to send, privately
  { at: at('sending1'), src: 'audio/sfx/whoosh-real.wav', volume: 0.3 },
  { at: at('sent1') + 3, src: 'audio/sfx/chime.mp3', volume: 0.26 }, // Sent
  { at: at('sent1') + 86, src: 'audio/sfx/sparkle.mp3', volume: 0.3 }, // Sam's phone: paid
  { at: at('card1-hold'), src: 'audio/sfx/pop.mp3', volume: 0.28 },
  { at: at('card1-tap') + 12, src: 'audio/kenney/card-place-1.ogg', volume: 0.3 }, // See it on Monadscan
  { at: at('scan1-hold'), src: 'audio/sfx/pop.mp3', volume: 0.28 },
  { at: at('addr1-hold'), src: 'audio/sfx/pop.mp3', volume: 0.28 },
  { at: at('start2'), src: 'audio/sfx/whoosh-real.wav', volume: 0.3 },
  { at: at('review2') + 70, src: 'private/sfx/lock.mp3', volume: 0.42 }, // slid to send, privately
  { at: at('sending2'), src: 'audio/sfx/whoosh-real.wav', volume: 0.3 },
  { at: at('sending2') + 19, src: 'audio/sfx/chime.mp3', volume: 0.22 }, // Sent
  { at: at('arrive2') + 12, src: 'audio/sfx/sparkle.mp3', volume: 0.3 }, // Sam's phone: paid again
  { at: at('card2-hold'), src: 'audio/sfx/pop.mp3', volume: 0.28 },
  { at: at('card2-tap') + 6, src: 'audio/kenney/card-place-2.ogg', volume: 0.3 }, // Announced on Monad
  { at: REVEAL_AT + 36, src: 'audio/kenney/card-place-3.ogg', volume: 0.36 }, // address 1 lands
  { at: REVEAL_AT + 54, src: 'audio/kenney/card-place-4.ogg', volume: 0.36 }, // address 2 lands
  { at: REVEAL_AT + 88, src: 'private/sfx/lock.mp3', volume: 0.45 }, // Sam's keys
  { at: END_AT + 2, src: 'audio/sfx/chime.mp3', volume: 0.3 },
]

/** The demo's score, started so its warm lift (at 105.05 s) lands on the end card. */
const SCORE_FROM = Math.round((105.05 - END_AT / FPS) * FPS)

/**
 * The narrator (scripts/two-sends/vo.mjs: Eleven v4, the demo film's voice), one line per caption
 * beat. With the voice, the score sits 6 dB lower throughout; under a line it dips about 12 dB more
 * and the effects about 4 dB, easing in over 6 frames and back out over 12. Measured: the voice
 * clears the score by about 15 dB under speech and by about 5 dB between lines.
 */
const VO = (vo as { id: string; at: number; dur: number }[]).map((v) => ({
  ...v,
  frames: Math.ceil(v.dur * FPS),
}))

function under(f: number, depth: number) {
  let gain = 1
  for (const v of VO) {
    const g = interpolate(
      f,
      [v.at - 6, v.at, v.at + v.frames, v.at + v.frames + 12],
      [1, depth, depth, 1],
      clamp,
    )
    gain = Math.min(gain, g)
  }
  return gain
}

/** `stem` renders one layer of the voiced mix on its own, to check levels: the voice, or the bed under it. */
export function TwoSendsFilm({ voice = false, stem }: { voice?: boolean; stem?: 'voice' | 'bed' }) {
  const [handle] = useState(() => delayRender('Manrope'))
  useEffect(() => {
    fontsReady.then(() => continueRender(handle))
  }, [handle])
  const total = TWO_SENDS_DURATION

  return (
    <AbsoluteFill style={{ background: K.peach }}>
      <Sequence durationInFrames={FOOT}>
        <Footage />
      </Sequence>
      {/* Held 9 frames longer, under the end card's fade, so the cut never dips to an empty frame. */}
      <Sequence from={REVEAL_AT} durationInFrames={REVEAL + 9}>
        <FadeIn frames={12}>
          <Reveal />
        </FadeIn>
      </Sequence>
      <Sequence from={END_AT} durationInFrames={END}>
        <FadeIn frames={9}>
          <EndCard />
        </FadeIn>
      </Sequence>
      <Sequence durationInFrames={FOOT + 2}>
        <Band />
      </Sequence>

      {stem === 'voice' ? null : (
        <Html5Audio
          src={staticFile('demo/score.mp3')}
          trimBefore={SCORE_FROM}
          volume={(f) =>
            0.5 *
            interpolate(f, [0, 8], [0, 1], clamp) *
            interpolate(f, [total - 36, total - 1], [1, 0], clamp) *
            (voice ? 0.5 * under(f, 0.25) : 1)
          }
        />
      )}
      {stem === 'voice'
        ? null
        : SFX.map((s) => (
            <Sequence key={`${s.at}${s.src}`} from={s.at} durationInFrames={90}>
              <Html5Audio
                src={staticFile(s.src)}
                volume={(f) => s.volume * (voice ? under(s.at + f, 0.63) : 1)}
              />
            </Sequence>
          ))}
      {voice && stem !== 'bed'
        ? VO.map((v) => (
            <Sequence key={v.id} from={v.at} durationInFrames={v.frames + 2}>
              <Html5Audio src={staticFile(`two-sends/vo/${v.id}.mp3`)} />
            </Sequence>
          ))
        : null}
    </AbsoluteFill>
  )
}

function FadeIn({ frames, children }: { frames: number; children: ReactNode }) {
  const f = useCurrentFrame()
  return (
    <AbsoluteFill style={{ opacity: interpolate(f, [0, frames], [0, 1], clamp) }}>
      {children}
    </AbsoluteFill>
  )
}
