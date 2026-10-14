/**
 * Kova's Metropolis demo: the real app and web, recorded while they made real payments on Monad
 * testnet on 14 Oct 2026, cut together with the explorer pages for those payments. Nothing here is
 * animated from screenshots: every phone is a screen recording (the iOS app on the simulator, the
 * web on a phone-sized Chrome), every explorer page is the live Monadscan page for that payment.
 *
 * Sources: demo/raw (takes), demo/prep.sh (cuts them into public/demo), demo/vo (voice).
 * Transactions: demo/txs.md.
 */
import { loadFont } from '@remotion/fonts'
import { useEffect, useState } from 'react'
import { AbsoluteFill, continueRender, delayRender, Html5Audio, Img, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion'
import { FPS } from '../motion'

const C = { paper: '#E7E5E0', surface: '#F1EFEA', ink: '#0B1A1D', coral: '#D46558', teal: '#2F6669', muted: '#4A5A5C' }

const manrope = Promise.all(
  [
    ['500', 'Manrope_500Medium'],
    ['600', 'Manrope_600SemiBold'],
    ['700', 'Manrope_700Bold'],
    ['800', 'Manrope_800ExtraBold'],
  ].map(([weight, file]) => loadFont({ family: 'Manrope', url: staticFile(`fonts/${file}.ttf`), weight })),
)

const s = (seconds: number) => Math.round(seconds * FPS)

/** The film, scene by scene, in seconds. */
export const DEMO_DURATION = 114

type Line = { at: number; file: string; text: string }
const VO: Line[] = [
  { at: 0.4, file: 'hook', text: 'This is Kova: a dollar account that works anywhere. With no signal, in private, across borders. Live on Monad.' },
  { at: 8.6, file: 'cafe', text: 'Sam orders a croissant from table three. One tap, and it is paid: $3.25 to Ada’s Bakery, settled on Monad. Kova pays the gas.' },
  { at: 27, file: 'link', text: 'Then he sends Lucía fifty cents by link. She’s abroad, with no wallet.' },
  { at: 37.5, file: 'claim', text: 'She sees it in euros, makes a wallet with Face ID, and claims it. It arrived in 0.7 seconds.' },
  { at: 54, file: 'offline', text: 'No signal? Sam still pays. His phone signs the payment and shows it as a code, and Lucía’s phone checks it on the spot.' },
  { at: 66.5, file: 'settle', text: 'As soon as either phone is back online, it settles on Monad, once.' },
  { at: 77, file: 'private', text: 'And when it’s private, Monad sees who paid, but not who got paid. Ada pays Sam at a one-time address only he can find, with a sealed note.' },
  { at: 97.8, file: 'arrival', text: 'Only Sam’s phone can open it.' },
  { at: 105.4, file: 'close', text: 'Kova is live on Monad mainnet today. Tap. Paid. Anywhere.' },
]

/** A phone: the screen recording at its own pixel size (394x854), in a dark bezel. */
function Phone({ src, x, label, startFrom = 0 }: { src: string; x: number; label?: string; startFrom?: number }) {
  return (
    <div style={{ position: 'absolute', left: x, top: 78, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <div style={{ background: C.ink, borderRadius: 66, padding: 12, boxShadow: '0 30px 60px rgba(11,26,29,0.22)' }}>
        <div style={{ width: 394, height: 854, borderRadius: 54, overflow: 'hidden', background: C.surface }}>
          <OffthreadVideo src={staticFile(`demo/${src}.mp4`)} startFrom={s(startFrom)} muted style={{ width: 394, height: 854, display: 'block' }} />
        </div>
      </div>
      {label ? <div style={{ fontFamily: 'Manrope', fontWeight: 700, fontSize: 26, color: C.muted, letterSpacing: 0.5 }}>{label}</div> : null}
    </div>
  )
}

/** The words for the scene: what it shows, the line being said, and the real numbers it produced. */
function Panel({ eyebrow, text, chips = [], left, width }: { eyebrow: string; text: string; chips?: string[]; left: number; width: number }) {
  const frame = useCurrentFrame()
  const fade = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' })
  return (
    <div style={{ position: 'absolute', left, top: 0, bottom: 0, width, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 28, opacity: fade, fontFamily: 'Manrope' }}>
      <div style={{ fontWeight: 800, fontSize: 26, letterSpacing: 3, textTransform: 'uppercase', color: C.teal }}>{eyebrow}</div>
      <div style={{ fontWeight: 700, fontSize: 50, lineHeight: 1.22, color: C.ink, letterSpacing: -0.5 }}>{text}</div>
      {chips.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          {chips.map((c) => (
            <div key={c} style={{ fontWeight: 800, fontSize: 30, color: C.ink, background: C.surface, border: `3px solid ${C.ink}`, borderRadius: 999, padding: '8px 24px' }}>{c}</div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** A live explorer page, as captured, with what it proves in plain words over its cookie banner. */
function Explorer({ src, caption, network = 'Monad testnet' }: { src: string; caption: string; network?: string }) {
  return (
    <AbsoluteFill style={{ background: '#FFFFFF' }}>
      <Img src={staticFile(`demo/${src}.png`)} style={{ width: 1920, height: 1080 }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 132, background: C.ink, display: 'flex', alignItems: 'center', gap: 28, padding: '0 64px', fontFamily: 'Manrope' }}>
        <div style={{ fontWeight: 800, fontSize: 26, letterSpacing: 2.5, textTransform: 'uppercase', color: C.coral, whiteSpace: 'nowrap' }}>Monadscan · {network}</div>
        <div style={{ fontWeight: 700, fontSize: 38, color: C.surface, lineHeight: 1.2 }}>{caption}</div>
      </div>
    </AbsoluteFill>
  )
}

function Scene({ from, to, children }: { from: number; to: number; children: React.ReactNode }) {
  return (
    <Sequence from={s(from)} durationInFrames={s(to - from)}>
      <AbsoluteFill style={{ background: C.paper }}>{children}</AbsoluteFill>
    </Sequence>
  )
}

function EndCard() {
  const frame = useCurrentFrame()
  const rise = interpolate(frame, [0, 12], [24, 0], { extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ background: C.paper, alignItems: 'center', justifyContent: 'center', gap: 44, fontFamily: 'Manrope', transform: `translateY(${rise}px)` }}>
      <Img src={staticFile('demo/kova-lockup.svg')} style={{ width: 400, height: 130 }} />
      <div style={{ fontWeight: 800, fontSize: 96, color: C.ink, letterSpacing: -3 }}>
        Tap<span style={{ color: C.coral }}>.</span> Paid<span style={{ color: C.coral }}>.</span> Anywhere<span style={{ color: C.coral }}>.</span>
      </div>
      <div style={{ display: 'flex', gap: 22 }}>
        <div style={{ fontWeight: 800, fontSize: 40, color: C.ink, background: C.coral, borderRadius: 999, padding: '14px 40px' }}>mykova.app/try</div>
        <div style={{ fontWeight: 700, fontSize: 40, color: C.ink, border: `3px solid ${C.ink}`, borderRadius: 999, padding: '11px 37px' }}>Live on Monad</div>
      </div>
    </AbsoluteFill>
  )
}

export function DemoFilm() {
  const [handle] = useState(() => delayRender('Manrope'))
  useEffect(() => {
    manrope.then(() => continueRender(handle))
  }, [handle])
  const line = (file: string) => VO.find((v) => v.file === file)?.text ?? ''

  return (
    <AbsoluteFill style={{ background: C.paper }}>
      {/* 1. Home */}
      <Scene from={0} to={8}>
        <Phone src="home" x={300} />
        <Panel left={860} width={880} eyebrow="Kova on Monad testnet" text={line('hook')} />
      </Scene>
      {/* 2. A café, from the table */}
      <Scene from={8} to={23}>
        <Phone src="cafe" x={300} label="Sam's phone" />
        <Panel left={860} width={880} eyebrow="Pay a shop" text={line('cafe')} chips={['Table 3', '$3.25', 'Paid']} />
      </Scene>
      <Scene from={23} to={26.5}>
        <Explorer src="scan-cafe" caption="Transfer 3.25 AUSD from Sam to Ada’s Bakery. Kova’s relayer paid the gas." />
      </Scene>
      {/* 3. Send by link, claimed with no wallet */}
      <Scene from={26.5} to={36}>
        <Phone src="link" x={300} label="Sam's phone" />
        <Panel left={860} width={880} eyebrow="Send by link" text={line('link')} chips={['$0.50', 'Coffee on me']} />
      </Scene>
      <Scene from={36} to={50}>
        <Phone src="link" x={150} label="Sam's phone" startFrom={9.5} />
        <Phone src="claim" x={640} label="Lucía's phone, no app" />
        <Panel left={1140} width={680} eyebrow="Claim with no wallet" text={line('claim')} chips={['about €0.44', 'Chainlink rate', '0.7 s']} />
      </Scene>
      <Scene from={50} to={53.5}>
        <Explorer src="scan-claim" caption="Transfer 0.50 AUSD from the link to Lucía’s new wallet." />
      </Scene>
      {/* 4. Pay with no signal */}
      <Scene from={53.5} to={66}>
        <Phone src="offline" x={150} label="Sam's phone, no signal" />
        <Sequence from={s(6)}>
          <Phone src="opage" x={640} label="Lucía's phone" />
        </Sequence>
        <Panel left={1140} width={680} eyebrow="Pay with no signal" text={line('offline')} chips={['$0.25', 'Signed offline']} />
      </Scene>
      <Scene from={66} to={73}>
        <Phone src="online" x={150} label="Sam's phone, back online" />
        <Phone src="settled" x={640} label="Lucía's phone" />
        <Panel left={1140} width={680} eyebrow="Back online" text={line('settle')} chips={['Settled on Monad', 'Paid once']} />
      </Scene>
      <Scene from={73} to={76.5}>
        <Explorer src="scan-offline" caption="Transfer 0.25 AUSD from Sam to Lucía, signed on his phone with no signal." />
      </Scene>
      {/* 5. Private */}
      <Scene from={76.5} to={90}>
        <Phone src="private" x={300} label="Ada's phone" />
        <Panel left={860} width={880} eyebrow="Send privately" text={line('private')} chips={['Sent privately', '1.10 s']} />
      </Scene>
      <Scene from={90} to={93.5}>
        <Explorer src="scan-private" caption="0.15 AUSD to 0xc8B1…FA5c, an address made for this payment. Sam isn’t on it." />
      </Scene>
      <Scene from={93.5} to={97}>
        <Explorer src="scan-announce" caption="Its ERC-5564 Announcement: the one-time address and a sealed note, no recipient." />
      </Scene>
      <Scene from={97} to={105}>
        <Phone src="arrival" x={300} label="Sam's phone" />
        <Panel left={860} width={880} eyebrow="Only Sam can open it" text={line('arrival')} chips={['+$0.15', 'From Ada', 'Sealed note']} />
      </Scene>
      {/* 6. Mainnet */}
      <Scene from={105} to={110}>
        <Explorer src="scan-mainnet-card" network="Monad mainnet" caption="The KovaCard contract, live on Monad mainnet: 0x9bee…325E." />
      </Scene>
      <Scene from={110} to={DEMO_DURATION}>
        <EndCard />
      </Scene>

      {VO.map((v) => (
        <Sequence key={v.file} from={s(v.at)}>
          <Html5Audio src={staticFile(`demo/${v.file}.mp3`)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}
