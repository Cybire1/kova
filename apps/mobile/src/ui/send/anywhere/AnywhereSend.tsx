import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import { FadeInLeft, FadeInRight } from 'react-native-reanimated'
import {
  AfterBurn,
  canCoverGas,
  crossChainSender,
  type Detected,
  detectAddress,
  type Network,
  type NetworkId,
  network,
  type Quote,
  rememberNetwork,
  type Sign,
  type Stage,
  useSendQuote,
} from '@/lib/crosschain'
import { formatUsd, toBase } from '@/lib/money'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import Animated from '@/ui/animated'
import { Header, PillButton, Screen, Txt } from '../../primitives'
import { SlideToSend } from '../SlideToSend'
import { AmountStep } from './AmountStep'
import { BoardingPass } from './BoardingPass'
import { duration, FlightStep, finished, LandedStep, type Timeline } from './FlightStep'
import { NetworkStep } from './NetworkStep'
import { InfoLine } from './parts'

type Step = 'network' | 'amount' | 'review' | 'flight' | 'landed'
const order: Step[] = ['network', 'amount', 'review', 'flight', 'landed']

const leave = () => (router.canGoBack() ? router.back() : router.replace('/'))

/**
 * Send to any network, one screen with five steps: which network (when the address leaves it
 * open), how much, the boarding pass, the flight, the receipt. Monad is one of the networks: picking
 * it hands over to the usual Send sheet, since that's an ordinary Kova send.
 */
export function AnywhereSend({
  address,
  preset,
  amount,
  autoSend,
}: {
  address: string
  preset?: NetworkId
  /** Dollars, like "250": starts at the boarding pass when the network is known too. */
  amount?: string
  /** Development only: slide by itself, so every state can be screenshotted on a simulator. */
  autoSend?: boolean
}) {
  const found = useMemo(() => detectAddress(address), [address])
  if (!found) return <Unreadable />
  return (
    <Flow
      found={found}
      preset={preset ? network(preset) : null}
      amount={amount}
      autoSend={autoSend}
    />
  )
}

function Flow({
  found,
  preset,
  amount: startAmount,
  autoSend,
}: {
  found: Detected
  preset: Network | null
  amount?: string
  autoSend?: boolean
}) {
  const { balance, refresh, approve, profile } = useWallet()
  const wrong =
    preset && (found.kind === 'unsupported' || preset.family !== found.kind) ? preset : null
  const startsPicked = preset && !wrong && preset.id !== 'monad' ? preset : null

  const [step, setStep] = useState<Step>(
    startsPicked ? (startAmount ? 'review' : 'amount') : 'network',
  )
  const [back, setBack] = useState(false)
  const [to, setTo] = useState<Network | null>(startsPicked)
  const [typed, setTyped] = useState(startAmount ?? '')
  const [cover, setCover] = useState(true)
  const [stage, setStage] = useState<Stage>('burn')
  const [timeline, setTimeline] = useState<Timeline>({ start: 0 })
  const [burnTx, setBurnTx] = useState<string | null>(null)
  const [mintTx, setMintTx] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  /** Said when the money has left Monad but is slow to land. */
  const [late, setLate] = useState<string | null>(null)
  const sending = useRef(false)

  /** The quote the person slid on: kept as it was, so a fee that changes after can't change it. */
  const [sent, setSent] = useState<Quote | null>(null)

  const sender = crossChainSender()
  const amount = typed ? toBase(typed) : 0n
  const covered = sender?.coverOptional ? cover : true
  const asked = useSendQuote(to, amount, covered)
  const fresh = asked.quote
  const q = step === 'flight' || step === 'landed' ? (sent ?? fresh) : fresh
  const issues = [...(fresh?.problems ?? []), ...(asked.problem ? [asked.problem] : [])]

  const go = (next: Step) => {
    setBack(order.indexOf(next) < order.indexOf(step))
    setStep(next)
  }

  const pick = (n: Network) => {
    if (n.id === 'monad') {
      router.replace({ pathname: '/send/[to]', params: { to: found.address } })
      return
    }
    setTo(n)
    setCover(sender?.coverOptional ? canCoverGas(n) : true)
    go('amount')
  }

  const onBack = () => {
    if (step === 'review') return go('amount')
    if (step === 'amount' && !startsPicked) return go('network')
    leave()
  }

  const send = async () => {
    if (!to || !q || sending.current) return
    if (!sender || !profile) {
      setProblem('Sending to other networks isn’t open yet.')
      setStep('review')
      return
    }
    sending.current = true
    setSent(q)
    setBusy(true)
    setProblem(null)
    setLate(null)
    const start = Date.now()
    setTimeline({ start })
    setStage('burn')
    // The wallet opens with Face ID for exactly this amount, then signs the one authorization.
    const sign = async (typedData: Parameters<Sign>[0]) =>
      (await approve(q.amount)).signTypedData(typedData as never)
    let left: string | null = null
    try {
      const result = await sender.send(
        { network: to.id, owner: profile.address, recipient: found.address, quote: q },
        sign,
        (update) => {
          if (update.burnTx) left = update.burnTx
          setStage(update.stage)
          setTimeline((t) => ({ ...t, [update.stage]: t[update.stage] ?? Date.now() }))
          if (update.burnTx) setBurnTx(update.burnTx)
          if (update.mintTx) setMintTx(update.mintTx)
        },
      )
      setStage(result.stage)
      setBurnTx(result.burnTx)
      setMintTx(result.mintTx)
      setTimeline((t) => ({ ...t, [result.stage]: t[result.stage] ?? Date.now() }))
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      if (__DEV__ && autoSend) setTimeout(() => setStep('landed'), 2500)
      void rememberNetwork(found.address, to.id)
      void refresh()
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : 'That didn’t go through.'
      const burned = e instanceof AfterBurn ? e.burnTx : left
      if (burned) {
        // It left Monad: it will land. Never offer to send it again.
        setBurnTx(burned)
        setLate(
          e instanceof AfterBurn
            ? message
            : 'It left Monad and Circle has it. Kova lost track of it here, but it will still land.',
        )
        void refresh()
      } else {
        setProblem(message)
        setStep('review')
      }
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  // The slide starts the flight at once; updates from the sender keep it moving.
  const slide = () => {
    setStep('flight')
    void send()
  }

  const autoSent = useRef(false)
  const slideRef = useRef(slide)
  slideRef.current = slide
  useEffect(() => {
    if (!__DEV__ || !autoSend || autoSent.current || step !== 'review') return
    const timer = setTimeout(() => {
      autoSent.current = true
      slideRef.current()
    }, 1600)
    return () => clearTimeout(timer)
  }, [autoSend, step])

  const end = timeline.landed ?? timeline.ready
  const took = end ? duration(end - timeline.start) : ''

  const title =
    step === 'review'
      ? 'Check and send'
      : step === 'flight' || step === 'landed'
        ? undefined
        : 'Send'
  const enter = back ? FadeInLeft.duration(220) : FadeInRight.duration(220)

  return (
    <Screen>
      <Header
        title={title}
        onBack={step === 'flight' && !finished(stage) ? leave : step === 'landed' ? null : onBack}
        backIcon={step === 'network' || step === 'flight' ? 'close' : 'back'}
      />
      <Animated.View
        key={step}
        entering={enter}
        style={{ flex: 1, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 8 }}
      >
        {step === 'network' ? (
          <NetworkStep found={found} wrong={wrong} onPick={pick} onChange={leave} />
        ) : null}
        {step === 'amount' && to ? (
          <AmountStep
            to={to}
            recipient={found.address}
            balance={balance}
            typed={typed}
            onTyped={setTyped}
            onNext={() => go('review')}
            minimum={sender?.minimum ?? 1_000_000n}
          />
        ) : null}
        {step === 'review' && to && q ? (
          <View style={{ flex: 1 }}>
            <BoardingPass
              to={to}
              recipient={found.address}
              quote={q}
              live={asked.exact}
              coverOptional={!!sender?.coverOptional}
              onCover={setCover}
            />
            <View style={{ marginTop: 14 }}>
              <InfoLine>{`Your AUSD goes as USDC through Circle, swapped at no less than 99.8%. A send can’t be undone, so check it’s ${to.name}.`}</InfoLine>
            </View>
            <View style={{ flex: 1 }} />
            {problem || issues.length ? (
              <Txt
                weight="medium"
                size={14}
                color={colors.danger}
                style={{ marginBottom: 10, textAlign: 'center', lineHeight: 20 }}
              >
                {problem ?? issues.join(' ')}
              </Txt>
            ) : !asked.exact && sender?.quote ? (
              <Txt
                weight="medium"
                size={13}
                color={colors.muted}
                style={{ marginBottom: 10, textAlign: 'center' }}
              >
                Getting the exact numbers…
              </Txt>
            ) : null}
            <SlideToSend
              label={`Slide to send ${formatUsd(q.amount)}`}
              busy={busy}
              disabled={
                !sender || q.amount === 0n || issues.length > 0 || (!!sender.quote && !asked.exact)
              }
              onSend={slide}
            />
          </View>
        ) : null}
        {step === 'flight' && to && q ? (
          <FlightStep
            to={to}
            recipient={found.address}
            quote={q}
            stage={stage}
            timeline={timeline}
            burnTx={burnTx}
            mintTx={mintTx}
            demo={!!sender?.demo}
            late={late}
            onReceipt={() => go('landed')}
          />
        ) : null}
        {step === 'landed' && to && q ? (
          <LandedStep
            to={to}
            recipient={found.address}
            quote={q}
            stage={stage}
            took={took}
            burnTx={burnTx}
            mintTx={mintTx}
            demo={!!sender?.demo}
            onDone={leave}
          />
        ) : null}
      </Animated.View>
    </Screen>
  )
}

function Unreadable() {
  return (
    <Screen>
      <Header title="Send" backIcon="close" />
      <View style={{ flex: 1, padding: 20, gap: 12 }}>
        <Txt weight="bold" size={22} style={{ letterSpacing: -0.6 }}>
          Kova can’t read that address
        </Txt>
        <Txt size={15} color={colors.muted} style={{ lineHeight: 22 }}>
          Check it was copied whole. Kova reads EVM (0x…), Solana, Sui and Aptos addresses.
        </Txt>
        <View style={{ flex: 1 }} />
        <PillButton label="Try another address" icon="back" onPress={leave} />
      </View>
    </Screen>
  )
}
