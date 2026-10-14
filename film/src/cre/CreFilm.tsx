/**
 * Kova rates on Chainlink CRE: the bounty's demo, from one real CRE CLI run on 14 Oct 2026.
 *
 * Every frame is real: the terminal is the run's own output and timing (recorded with
 * scripts/record-cast.py, rendered with agg; the engine's log lines are picked out by
 * scripts/cre-steps.jq, shown in the command), the explorer pages are Monadscan's for that run's
 * transaction, the API call is a real call made after it, and the phone is the demo film's real
 * recording of the link page using the rate. The only edit to time: the run holds on its last line
 * so it can be read, marked "paused".
 *
 * Run: cre workflow simulate kova-rates --target staging-settings --broadcast (Monad testnet)
 * Report tx: 0xb5f7efae050b65bb84c8a54d67b430cfb44ca3247bf66ae0ef6e830bb9004130 (block 70,829,073)
 */
import { loadFont } from '@remotion/fonts'
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
import { FPS } from '../motion'

const C = { paper: '#E7E5E0', surface: '#F1EFEA', ink: '#0B1A1D', ink2: '#13272B', coral: '#D46558', teal: '#2F6669', muted: '#4A5A5C', mist: '#A9B8B8' }

const manrope = Promise.all(
  [
    ['500', 'Manrope_500Medium'],
    ['600', 'Manrope_600SemiBold'],
    ['700', 'Manrope_700Bold'],
    ['800', 'Manrope_800ExtraBold'],
  ].map(([weight, file]) => loadFont({ family: 'Manrope', url: staticFile(`fonts/${file}.ttf`), weight })),
)

const s = (seconds: number) => Math.round(seconds * FPS)

export const CRE_DURATION = 58

const TX = '0xb5f7efae050b65bb84c8a54d67b430cfb44ca3247bf66ae0ef6e830bb9004130'
const RATES = '0xb5322DC6d6AA938C50859f0f0e2DF7b6Da4C9e8e'

/** Voice lines and where they start (seconds); captions show the same words. */
const VO = [
  { id: 'hook', at: 3.0, text: 'This is Kova’s exchange-rate workflow on Chainlink CRE. Every 15 minutes, it writes the rates Kova shows people to Monad.' },
  { id: 'how', at: -1, text: 'Each node fetches two independent rate sources, and drops any currency where they disagree by more than 2%. The network agrees on the median, signs it into a report, and writes it to our KovaRates contract.' },
  { id: 'run', at: -1, text: 'Here’s a real run with the CRE CLI, broadcasting to Monad testnet.' },
  { id: 'steps', at: 11.5, text: 'The cron trigger fires. Both sources answer. Consensus takes the median of every rate. Then the signed report is written on Monad.' },
  { id: 'scan', at: 24.4, text: 'On Monadscan, the transaction succeeded: Chainlink’s forwarder delivered the report to KovaRates.' },
  { id: 'logs', at: 31.9, text: 'KovaRates logged the new rates, and the forwarder confirms the report was processed.' },
  { id: 'api', at: 38.0, text: 'Kova’s API reads the contract, and serves the same rates, from that same report.' },
  { id: 'app', at: 44.5, text: 'In the app, Lucía sees $0.50 as about €0.44, at the Chainlink rate.' },
  { id: 'close', at: 52.0, text: 'Kova rates: Chainlink CRE, on Monad. Try Kova at mykova.app.' },
] as const
const line = (id: (typeof VO)[number]['id']) => VO.find((v) => v.id === id)?.text ?? ''

function Scene({ from, to, bg = C.paper, children }: { from: number; to: number; bg?: string; children: React.ReactNode }) {
  return (
    <Sequence from={s(from)} durationInFrames={s(to - from)}>
      <AbsoluteFill style={{ background: bg }}>{children}</AbsoluteFill>
    </Sequence>
  )
}

function Fade({ children, rise = 18 }: { children: React.ReactNode; rise?: number }) {
  const frame = useCurrentFrame()
  const t = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' })
  return <div style={{ opacity: t, transform: `translateY(${(1 - t) * rise}px)` }}>{children}</div>
}

/** The spoken line, as a subtitle on the dark band under a terminal or explorer page. */
function Band({ eyebrow, text, children }: { eyebrow: string; text: string; children?: React.ReactNode }) {
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 150, background: C.ink, borderTop: `2px solid ${C.ink2}`, display: 'flex', alignItems: 'center', gap: 30, padding: '0 64px', fontFamily: 'Manrope' }}>
      <div style={{ fontWeight: 800, fontSize: 24, letterSpacing: 2.5, textTransform: 'uppercase', color: C.coral, whiteSpace: 'nowrap' }}>{eyebrow}</div>
      {children ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 28, lineHeight: 1.25, color: C.surface }}>{text}</div>
          {children}
        </div>
      ) : (
        <div style={{ flex: 1, fontWeight: 700, fontSize: 34, lineHeight: 1.25, color: C.surface }}>{text}</div>
      )}
    </div>
  )
}

/** The steps of the run, lit in turn as the voice reaches them (seconds into the steps line). */
const STEPS: Array<[number, string]> = [
  [0.0, 'Cron trigger'],
  [1.8, 'Both sources: 200'],
  [3.5, 'Median consensus'],
  [6.3, 'Signed report on Monad'],
]

function Steps({ from }: { from: number }) {
  const frame = useCurrentFrame()
  const t = frame / FPS - from
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      {STEPS.map(([at, label]) => {
        const on = t >= at
        return (
          <div key={label} style={{ fontWeight: 800, fontSize: 22, whiteSpace: 'nowrap', color: on ? C.ink : C.mist, background: on ? C.coral : 'transparent', border: `2px solid ${on ? C.coral : C.muted}`, borderRadius: 999, padding: '4px 16px' }}>
            {label}
          </div>
        )
      })}
    </div>
  )
}

/** A terminal recording at its own pixel size, scaled to sit above the band. */
function Terminal({ src, startFrom = 0, height = 1058 }: { src: string; startFrom?: number; height?: number }) {
  const scale = 0.86
  return (
    <div style={{ position: 'absolute', left: (1920 - 2056 * scale) / 2, top: 22, width: 2056 * scale, height: height * scale, borderRadius: 18, overflow: 'hidden', background: C.ink }}>
      <OffthreadVideo src={staticFile(`cre/${src}.mp4`)} startFrom={s(startFrom)} muted style={{ width: 2056 * scale, height: height * scale, display: 'block' }} />
    </div>
  )
}

function Chip({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <div style={{ fontWeight: 800, fontSize: 26, whiteSpace: 'nowrap', color: dark ? C.surface : C.ink, background: dark ? C.ink : C.surface, border: `3px solid ${C.ink}`, borderRadius: 999, padding: '8px 22px' }}>{children}</div>
  )
}

function Title() {
  return (
    <AbsoluteFill style={{ padding: '120px 150px', justifyContent: 'center', gap: 40, fontFamily: 'Manrope' }}>
      <Fade>
        <Img src={staticFile('demo/kova-lockup.svg')} style={{ width: 300, height: 98 }} />
      </Fade>
      <Fade>
        <div style={{ fontWeight: 800, fontSize: 26, letterSpacing: 3, textTransform: 'uppercase', color: C.teal }}>Chainlink CRE · Monad testnet</div>
      </Fade>
      <Fade>
        <div style={{ fontWeight: 800, fontSize: 120, lineHeight: 0.98, letterSpacing: -5, color: C.ink }}>
          Kova rates<span style={{ color: C.coral }}>.</span>
        </div>
      </Fade>
      <Fade>
        <div style={{ display: 'flex', gap: 14 }}>
          <Chip>Real run · 14 Oct 2026</Chip>
          <Chip>CRE CLI --broadcast</Chip>
        </div>
      </Fade>
    </AbsoluteFill>
  )
}

function How() {
  const cards: Array<[string, string, string]> = [
    ['1', 'Fetch', 'Two independent sources: open.er-api.com and the fawazahmed0 currency API.'],
    ['2', 'Cross-check and agree', 'Drop any currency where they differ by more than 2%. The DON takes the median, field by field.'],
    ['3', 'Sign and write', 'A signed report, written to KovaRates on Monad through Chainlink’s forwarder.'],
  ]
  return (
    <AbsoluteFill style={{ padding: '110px 128px 0', gap: 56, fontFamily: 'Manrope' }}>
      <Fade>
        <div style={{ fontWeight: 800, fontSize: 26, letterSpacing: 3, textTransform: 'uppercase', color: C.teal }}>What the workflow does</div>
        <div style={{ fontWeight: 800, fontSize: 72, letterSpacing: -2.5, color: C.ink, marginTop: 16 }}>
          Every 15 minutes, on every node<span style={{ color: C.coral }}>.</span>
        </div>
      </Fade>
      <div style={{ display: 'flex', gap: 28 }}>
        {cards.map(([n, h, p]) => (
          <div key={n} style={{ flex: 1 }}>
            <Fade>
              <div style={{ background: C.surface, borderRadius: 32, padding: 40, display: 'flex', flexDirection: 'column', gap: 18, height: 360 }}>
                <div style={{ width: 64, height: 64, borderRadius: 32, background: C.ink, color: C.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 32 }}>{n}</div>
                <div style={{ fontWeight: 800, fontSize: 44, lineHeight: 1.15, color: C.ink }}>{h}</div>
                <div style={{ fontWeight: 600, fontSize: 30, lineHeight: 1.4, color: C.muted }}>{p}</div>
              </div>
            </Fade>
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', left: 128, right: 128, bottom: 70, fontWeight: 700, fontSize: 32, lineHeight: 1.35, color: C.ink }}>{line('how')}</div>
    </AbsoluteFill>
  )
}

function Explorer({ src, caption }: { src: string; caption: string }) {
  return (
    <AbsoluteFill style={{ background: '#FFFFFF' }}>
      <Img src={staticFile(`cre/${src}.png`)} style={{ width: 1920, height: 1080 }} />
      <Band eyebrow="Monadscan · Monad testnet" text={caption} />
    </AbsoluteFill>
  )
}

function Phone({ src, x }: { src: string; x: number }) {
  return (
    <div style={{ position: 'absolute', left: x, top: 78, background: C.ink, borderRadius: 66, padding: 12, boxShadow: '0 30px 60px rgba(11,26,29,0.22)' }}>
      <div style={{ width: 394, height: 854, borderRadius: 54, overflow: 'hidden', background: C.surface }}>
        <OffthreadVideo src={staticFile(`demo/${src}.mp4`)} muted style={{ width: 394, height: 854, display: 'block' }} />
      </div>
    </div>
  )
}

function End() {
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 36, fontFamily: 'Manrope' }}>
      <Fade>
        <Img src={staticFile('demo/kova-lockup.svg')} style={{ width: 340, height: 110 }} />
      </Fade>
      <Fade>
        <div style={{ fontWeight: 800, fontSize: 84, letterSpacing: -3, color: C.ink, textAlign: 'center' }}>
          Chainlink CRE<span style={{ color: C.coral }}>,</span> on Monad<span style={{ color: C.coral }}>.</span>
        </div>
      </Fade>
      <Fade>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, fontWeight: 700, fontSize: 30, color: C.muted }}>
          <div>KovaRates {RATES} · Monad testnet</div>
          <div>Report tx {TX.slice(0, 18)}…{TX.slice(-8)} · block 70,829,073</div>
        </div>
      </Fade>
      <Fade>
        <div style={{ fontWeight: 800, fontSize: 40, color: C.ink, background: C.coral, borderRadius: 999, padding: '14px 40px' }}>mykova.app</div>
      </Fade>
    </AbsoluteFill>
  )
}

export function CreFilm() {
  const [handle] = useState(() => delayRender('Manrope'))
  useEffect(() => {
    manrope.then(() => continueRender(handle))
  }, [handle])

  return (
    <AbsoluteFill style={{ background: C.paper }}>
      <Scene from={0} to={2.5}>
        <Title />
      </Scene>

      {/* The real run, at its own pace, holding (paused) on the line where the report is written. */}
      <Scene from={2.5} to={21} bg={C.ink}>
        <Terminal src="run-to-write" />
        <Sequence from={s(8.9)}>
          <div style={{ position: 'absolute', right: 100, top: 44, fontFamily: 'Manrope', fontWeight: 800, fontSize: 22, color: C.ink, background: C.coral, borderRadius: 999, padding: '6px 16px' }}>Paused to read</div>
        </Sequence>
        <Sequence durationInFrames={s(9)}>
          <Band eyebrow="Real run · CRE CLI" text={line('hook')} />
        </Sequence>
        <Sequence from={s(9)}>
          <Band eyebrow="CRE CLI" text={line('steps')}>
            <Steps from={0} />
          </Band>
        </Sequence>
      </Scene>
      {/* The end of the same run: its result is the transaction hash. */}
      <Scene from={21} to={24} bg={C.ink}>
        <Terminal src="broadcast-steps" startFrom={9} />
        <Band eyebrow="Result" text={`The workflow returns the transaction: ${TX.slice(0, 10)}…${TX.slice(-8)}`} />
      </Scene>

      <Scene from={24} to={31.5}>
        <Explorer src="scan-tx" caption={`${line('scan')} Block 70,829,073.`} />
      </Scene>
      <Scene from={31.5} to={37.5}>
        <Explorer src="scan-logs" caption={line('logs')} />
      </Scene>

      <Scene from={37.5} to={44} bg={C.ink}>
        <Terminal src="api" height={902} />
        <Band eyebrow="Kova API" text={line('api')} />
      </Scene>

      <Scene from={44} to={51.5}>
        {/* The link page plays, then holds on its rate line while the voice reads it. */}
        <Sequence durationInFrames={s(3.4)}>
          <Phone src="claim" x={300} />
        </Sequence>
        <Sequence from={s(3.4)}>
          <Freeze frame={s(3.4)}>
            <Phone src="claim" x={300} />
          </Freeze>
        </Sequence>
        <div style={{ position: 'absolute', left: 860, top: 0, bottom: 0, width: 900, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 28, fontFamily: 'Manrope' }}>
          <Fade>
            <div style={{ fontWeight: 800, fontSize: 26, letterSpacing: 3, textTransform: 'uppercase', color: C.teal }}>In the app</div>
          </Fade>
          <Fade>
            <div style={{ fontWeight: 700, fontSize: 50, lineHeight: 1.22, color: C.ink, letterSpacing: -0.5 }}>{line('app')}</div>
          </Fade>
          <Fade>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <Chip>$0.50</Chip>
              <Chip>about €0.44</Chip>
              <Chip dark>Chainlink rate</Chip>
            </div>
          </Fade>
        </div>
      </Scene>

      <Scene from={51.5} to={CRE_DURATION}>
        <End />
      </Scene>

      {VO.filter((v) => v.at >= 0).map((v) => (
        <Sequence key={v.id} from={s(v.at)}>
          <Html5Audio src={staticFile(`cre/vo-${v.id}.mp3`)} />
        </Sequence>
      ))}
      <Html5Audio src={staticFile('demo/score.mp3')} volume={(f) => 0.1 * interpolate(f, [s(CRE_DURATION - 2), s(CRE_DURATION)], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} />
    </AbsoluteFill>
  )
}
