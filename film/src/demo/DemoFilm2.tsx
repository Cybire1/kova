/**
 * Kova's Metropolis demo, hook first: the phone with no signal paying in the first seconds, then the
 * problem in one line, then a few things done well (a shop, a friend abroad, private, an AI agent with
 * limits), each with its Monadscan page. Every phone is a real screen recording (one real frame held
 * for the sender's link step), the agent is Claude Code really paying through Kova's MCP server on
 * Monad testnet, recorded in a terminal with its own timing (film/scripts/agent-film.mjs,
 * film/scripts/claude-steps.jq). Voice: demo/vo (v1 lines) and demo/vo2. Transactions: demo/txs.md.
 */
import { useEffect, useState } from 'react'
import { AbsoluteFill, continueRender, delayRender, Html5Audio, Sequence, staticFile } from 'remotion'
import { Band, ChatTake, EndCard, Explorer, Lines, manrope, Panel, Phone, Scene, s, C } from './parts'

export const DEMO2_DURATION = 117

const T = {
  hook2: 'This phone has no signal. Watch it pay.',
  offline: 'No signal? Sam still pays. His phone signs the payment and shows it as a code, and Lucía’s phone checks it on the spot.',
  settle: 'As soon as either phone is back online, it settles on Monad, once.',
  problemA: 'People want dollars. But wallets stop with no signal, show everything in public, and ask for gas and seed phrases.',
  problemB: 'Kova is a dollar account that works anywhere, on Monad.',
  cafe: 'Sam orders a croissant from table three. One tap, and it is paid: $3.25 to Ada’s Bakery, settled on Monad. Kova pays the gas.',
  link: 'Then he sends Lucía fifty cents by link. She’s abroad, with no wallet.',
  claim: 'She sees it in euros, makes a wallet with Face ID, and claims it. It arrived in 0.7 seconds.',
  private: 'And when it’s private, Monad sees who paid, but not who got paid. Ada pays Sam at a one-time address only he can find, with a sealed note.',
  arrival: 'Only Sam’s phone can open it.',
  agentA: 'Sam can also give his AI agent its own key.',
  agentB: 'Claude pays Ada’s Bakery $0.20 on its own, but anything over $0.50 waits for Sam to approve it.',
  agentC: 'Monad enforces the limit.',
}

/** Voice: where each line starts (seconds). */
const VO = [
  { at: 0.3, file: 'hook2' },
  { at: 3.2, file: 'offline' },
  { at: 12.0, file: 'settle' },
  { at: 20.3, file: 'problem' },
  { at: 32.6, file: 'cafe' },
  { at: 51.1, file: 'link' },
  { at: 55.9, file: 'claim' },
  { at: 67.8, file: 'private' },
  { at: 88.3, file: 'arrival' },
  { at: 92.5, file: 'agent' },
  { at: 111.6, file: 'close2' },
]

export function DemoFilm2() {
  const [handle] = useState(() => delayRender('Manrope'))
  useEffect(() => {
    manrope.then(() => continueRender(handle))
  }, [handle])

  return (
    <AbsoluteFill style={{ background: C.paper }}>
      {/* 1. The hook: no signal, and it pays. */}
      <Scene from={0} to={11.8}>
        <Phone src="offline" x={150} label="Sam's phone, no signal" />
        <Sequence from={s(5)}>
          <Phone src="opage" x={640} label="Lucía's phone" />
        </Sequence>
        <Lines
          left={1140}
          width={680}
          items={[
            { at: 0, eyebrow: 'No signal', text: T.hook2 },
            { at: 2.9, eyebrow: 'Pay with no signal', text: T.offline, chips: ['$0.25', 'Signed offline'] },
          ]}
        />
      </Scene>
      <Scene from={11.8} to={17}>
        <Phone src="online" x={150} label="Sam's phone, back online" startFrom={1} />
        <Phone src="settled" x={640} label="Lucía's phone" startFrom={1} />
        <Panel left={1140} width={680} eyebrow="Back online" text={T.settle} chips={['Settled on Monad', 'Paid once']} />
      </Scene>
      <Scene from={17} to={20}>
        <Explorer src="scan-offline" caption="Transfer 0.25 AUSD from Sam to Lucía, signed on his phone with no signal." />
      </Scene>

      {/* 2. The problem, and Kova, in one breath. */}
      <Scene from={20} to={32.3}>
        <Phone src="home" x={300} rate={0.9} />
        <Lines
          left={860}
          width={880}
          items={[
            { at: 0.3, eyebrow: 'The problem', text: T.problemA },
            { at: 8.3, eyebrow: 'Kova on Monad', text: T.problemB, chips: ['Face ID', 'No gas token', 'No seed phrase'] },
          ]}
        />
      </Scene>

      {/* 3. A café, from the table. */}
      <Scene from={32.3} to={47.3}>
        <Phone src="cafe" x={300} label="Sam's phone" />
        <Panel left={860} width={880} eyebrow="Pay a shop" text={T.cafe} chips={['Table 3', '$3.25', 'Paid']} />
      </Scene>
      <Scene from={47.3} to={50.8}>
        <Explorer src="scan-cafe" caption="Transfer 3.25 AUSD from Sam to Ada’s Bakery. Kova’s relayer paid the gas." />
      </Scene>

      {/* 4. A friend abroad, by link, with no wallet. */}
      <Scene from={50.8} to={64}>
        <Phone src="link" x={150} label="Sam's phone" hold={0.2} />
        <Phone src="claim" x={640} label="Lucía's phone, no app" startFrom={2} />
        <Lines
          left={1140}
          width={680}
          items={[
            { at: 0.3, eyebrow: 'Send by link', text: T.link, chips: ['$0.50', 'Coffee on me'] },
            { at: 5.1, eyebrow: 'Claim with no wallet', text: T.claim, chips: ['about €0.44', 'Chainlink rate', '0.7 s'] },
          ]}
        />
      </Scene>
      <Scene from={64} to={67.5}>
        <Explorer src="scan-claim" caption="Transfer 0.50 AUSD from the link to Lucía’s new wallet." />
      </Scene>

      {/* 5. Private. */}
      <Scene from={67.5} to={81}>
        <Phone src="private" x={300} label="Ada's phone" />
        <Panel left={860} width={880} eyebrow="Send privately" text={T.private} chips={['Sent privately', '1.10 s']} />
      </Scene>
      <Scene from={81} to={84.5}>
        <Explorer src="scan-private" caption="0.15 AUSD to 0xc8B1…FA5c, an address made for this payment. Sam isn’t on it." />
      </Scene>
      <Scene from={84.5} to={88}>
        <Explorer src="scan-announce" caption="Its ERC-5564 Announcement: the one-time address and a sealed note, no recipient." />
      </Scene>
      <Scene from={88} to={92}>
        <Phone src="arrival" x={300} label="Sam's phone" />
        <Panel left={860} width={880} eyebrow="Only Sam can open it" text={T.arrival} chips={['+$0.15', 'From Ada', 'Sealed note']} />
      </Scene>

      {/* 6. An AI agent with its own key: a real Claude Code run through Kova's MCP server, as its conversation. */}
      <Scene from={92} to={107.5}>
        <ChatTake
          note="connected to Kova over MCP · real run on Monad testnet, 14 Oct 2026"
          prompt="Pay Ada’s Bakery $0.20 for a croissant, then $0.55 for a cake. Their Kova address is 0x36Ba…E7d. Just pay, one short line each."
          rows={[
            { at: 6.98, kind: 'call', text: 'Kova · pay $0.20 to Ada’s Bakery, croissant' },
            { at: 8.56, kind: 'paid', text: 'Paid $0.20 to Ada’s Bakery on Monad. Transaction 0xf7659c…e5d2.' },
            { at: 10.82, kind: 'call', text: 'Kova · pay $0.55 to Ada’s Bakery, cake' },
            { at: 11.23, kind: 'held', text: '$0.55 is over what this key pays without asking, so it’s waiting for its owner to approve it in Kova.' },
            { at: 13.4, kind: 'claude', text: 'Croissant: paid $0.20. Cake: $0.55 hasn’t been paid yet. It’s over this key’s limit for paying without approval, so you need to approve it in Kova.' },
          ]}
        />
        <Sequence durationInFrames={s(4)}>
          <Band eyebrow="AI agent" text={T.agentA} />
        </Sequence>
        <Sequence from={s(4)} durationInFrames={s(6.6)}>
          <Band eyebrow="AI agent" text={T.agentB} chips={['Paid $0.20', '$0.55 waits for Sam']} />
        </Sequence>
        <Sequence from={s(10.6)}>
          <Band eyebrow="Limits on Monad" text={T.agentC} chips={['$2 a day', 'Asks above $0.50', 'KovaCard contract']} />
        </Sequence>
      </Scene>
      <Scene from={107.5} to={111}>
        <Explorer src="scan-agent" caption="Transfer 0.2 AUSD from Sam to Ada’s Bakery: Claude’s payment, through the KovaCard contract." />
      </Scene>

      {/* 7. Mainnet, and the close. */}
      <Scene from={111} to={113.9}>
        <Explorer src="scan-mainnet-card" network="Monad mainnet" caption="Kova is live on Monad mainnet today: the KovaCard contract, 0x9bee…325E." />
      </Scene>
      <Scene from={113.9} to={DEMO2_DURATION}>
        <EndCard
          title={
            <>
              Kova<span style={{ color: C.coral }}>.</span> Dollars that work anywhere<span style={{ color: C.coral }}>.</span>
            </>
          }
        />
      </Scene>

      {VO.map((v) => (
        <Sequence key={v.file} from={s(v.at)}>
          <Html5Audio src={staticFile(`demo/${v.file}.mp3`)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}
