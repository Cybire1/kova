/**
 * Kova for Agora's bounty (Best Cross-Border Payments App on Monad): cross-border dollars in AUSD
 * only. A friend abroad gets $0.50 by link and claims it with no wallet; a shop is paid from anywhere;
 * and with no signal, AUSD's EIP-3009 lets the phone sign the payment offline. The same real clips,
 * scene parts and voice as the demo (demo/DemoFilm2); new lines in demo/vo2.
 */
import { useEffect, useState } from 'react'
import { AbsoluteFill, continueRender, delayRender, Html5Audio, Img, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion'
import { C, Explorer, Lines, manrope, Panel, Phone, Scene, s } from '../demo/parts'

export const AGORA_DURATION = 59

const T = {
  hook: '$0.50 to a friend abroad, in about a second, in AUSD on Monad.',
  claim: 'She sees it in euros, makes a wallet with Face ID, and claims it. It arrived in 0.7 seconds.',
  cafe: 'Sam orders a croissant from table three. One tap, and it is paid: $3.25 to Ada’s Bakery, settled on Monad. Kova pays the gas.',
  offline: 'And with no signal, AUSD’s EIP-3009 lets the phone sign the payment offline. It settles on Monad once either phone is back online.',
  settle: 'As soon as either phone is back online, it settles on Monad, once.',
}

const VO = [
  { at: 0.3, file: 'agora-hook' },
  { at: 5.2, file: 'claim' },
  { at: 18.3, file: 'cafe' },
  { at: 34.8, file: 'agora-offline' },
  { at: 47.3, file: 'settle' },
  { at: 55.0, file: 'agora-close2' },
]

function AusdEnd() {
  const frame = useCurrentFrame()
  const rise = interpolate(frame, [0, 12], [24, 0], { extrapolateRight: 'clamp' })
  const row = (label: string, address: string) => (
    <div style={{ display: 'flex', gap: 18, alignItems: 'baseline' }}>
      <div style={{ fontWeight: 800, fontSize: 24, letterSpacing: 2, textTransform: 'uppercase', color: C.teal, width: 330 }}>{label}</div>
      <div style={{ fontFamily: 'Menlo, monospace', fontWeight: 600, fontSize: 30, color: C.ink }}>{address}</div>
    </div>
  )
  return (
    <AbsoluteFill style={{ background: C.paper, alignItems: 'center', justifyContent: 'center', gap: 40, fontFamily: 'Manrope', transform: `translateY(${rise}px)` }}>
      <Img src={staticFile('demo/kova-lockup.svg')} style={{ width: 340, height: 110 }} />
      <div style={{ fontWeight: 800, fontSize: 80, color: C.ink, letterSpacing: -3, textAlign: 'center', lineHeight: 1.05 }}>
        Every balance and every payment here is AUSD<span style={{ color: C.coral }}>.</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, background: C.surface, borderRadius: 28, padding: '28px 40px' }}>
        {row('AUSD · Monad testnet', '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC')}
        {row('AUSD · Monad mainnet', '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a')}
      </div>
      <div style={{ fontWeight: 800, fontSize: 40, color: C.ink, background: C.coral, borderRadius: 999, padding: '14px 40px' }}>mykova.app/try</div>
    </AbsoluteFill>
  )
}

export function AgoraFilm() {
  const [handle] = useState(() => delayRender('Manrope'))
  useEffect(() => {
    manrope.then(() => continueRender(handle))
  }, [handle])

  return (
    <AbsoluteFill style={{ background: C.paper }}>
      <Scene from={0} to={14.5}>
        <Phone src="link" x={150} label="Sam's phone" hold={0.2} />
        <Phone src="claim" x={640} label="Lucía's phone, abroad, no app" />
        <Lines
          left={1140}
          width={680}
          items={[
            { at: 0, eyebrow: 'Cross-border, in AUSD', text: T.hook, chips: ['$0.50 AUSD'] },
            { at: 4.9, eyebrow: 'Claimed with no wallet', text: T.claim, chips: ['about €0.44', 'Chainlink rate', '0.7 s'] },
          ]}
        />
      </Scene>
      <Scene from={14.5} to={18}>
        <Explorer src="scan-claim" caption="Transfer 0.50 AUSD from the link to Lucía’s new wallet, on Monad." />
      </Scene>
      <Scene from={18} to={31}>
        <Phone src="cafe" x={300} label="Sam's phone" />
        <Panel left={860} width={880} eyebrow="Pay a shop from anywhere" text={T.cafe} chips={['$3.25 AUSD', 'Paid', 'Gas paid by Kova']} />
      </Scene>
      <Scene from={31} to={34.5}>
        <Explorer src="scan-cafe" caption="Transfer 3.25 AUSD from Sam to Ada’s Bakery. Kova’s relayer paid the gas." />
      </Scene>
      <Scene from={34.5} to={47}>
        <Phone src="offline" x={150} label="Sam's phone, no signal" />
        <Sequence from={s(4)}>
          <Phone src="opage" x={640} label="Lucía's phone" />
        </Sequence>
        <Panel left={1140} width={680} eyebrow="No signal, still AUSD" text={T.offline} chips={['$0.25 AUSD', 'EIP-3009', 'Signed offline']} />
      </Scene>
      <Scene from={47} to={52}>
        <Phone src="online" x={150} label="Sam's phone, back online" startFrom={1} />
        <Phone src="settled" x={640} label="Lucía's phone" startFrom={1} />
        <Panel left={1140} width={680} eyebrow="Back online" text={T.settle} chips={['Settled on Monad', 'Paid once']} />
      </Scene>
      <Scene from={52} to={56}>
        <Explorer src="scan-offline" caption="Transfer 0.25 AUSD from Sam to Lucía, signed on his phone with no signal." />
      </Scene>
      <Scene from={56} to={AGORA_DURATION}>
        <AusdEnd />
      </Scene>

      {VO.map((v) => (
        <Sequence key={v.file} from={s(v.at)}>
          <Html5Audio src={staticFile(`demo/${v.file}.mp3`)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}
