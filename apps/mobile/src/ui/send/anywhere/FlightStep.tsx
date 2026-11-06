import * as WebBrowser from 'expo-web-browser'
import { useEffect, useState } from 'react'
import { Pressable, Share, StyleSheet, useWindowDimensions, View } from 'react-native'
import { FadeIn, ZoomIn } from 'react-native-reanimated'
import { type Network, network, type Quote, type Stage, shortAddress } from '@/lib/crosschain'
import { formatUsd } from '@/lib/money'
import { colors } from '@/lib/theme'
import Animated from '@/ui/animated'
import { Kovi, Sparkle } from '../../art'
import { Icon } from '../../Icon'
import { PillButton, Txt } from '../../primitives'
import { ChainLogo } from './ChainLogo'
import { FlightRoute } from './FlightRoute'

const usdc = (base: bigint) => formatUsd(base).replace('$', '')
const order: Stage[] = ['burn', 'attest', 'mint', 'landed']
/** How long something took: "4.6 s", "2 min 14 s". */
export const duration = (ms: number) => {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)} min ${s % 60} s`
}
/** The running clock: "12.3 s", then "2:14". */
const clockText = (ms: number) => {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export type Timeline = Partial<Record<Stage, number>> & { start: number }

/** Whether the send has finished, landed or waiting for them to collect it. */
export const finished = (stage: Stage) => stage === 'landed' || stage === 'ready'

/**
 * In flight: the route card with a running clock, and the three things that happen, each ticking
 * off with how long it took. Burned on Monad, signed by Circle, minted on their network (or ready
 * for them to collect, when their gas isn't covered).
 */
export function FlightStep({
  to,
  recipient,
  quote,
  stage,
  timeline,
  burnTx,
  mintTx,
  demo,
  late,
  onReceipt,
}: {
  to: Network
  recipient: string
  quote: Quote
  stage: Stage
  timeline: Timeline
  burnTx: string | null
  mintTx: string | null
  demo: boolean
  /** Said once the money has left Monad but is slow to land: it will still arrive. */
  late: string | null
  onReceipt: () => void
}) {
  const { width } = useWindowDimensions()
  const [now, setNow] = useState(Date.now())
  const done = finished(stage)
  useEffect(() => {
    if (done) return
    const timer = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(timer)
  }, [done])
  const end = timeline.landed ?? timeline.ready
  const clock = clockText((end ?? now) - timeline.start)

  const at = (s: Stage) => (s === 'ready' ? 3 : order.indexOf(s))
  const position = at(stage)
  const state = (i: number) => (position > i || done ? 'done' : position === i ? 'now' : 'wait')
  const took = (from: number | undefined, until: number | undefined) =>
    from !== undefined && until !== undefined ? duration(until - from) : ''
  const finalAt = timeline.landed ?? timeline.ready

  const steps = [
    {
      title: 'Left Monad',
      now: `Burning ${formatUsd(quote.amount)} on Monad`,
      done: burnTx ? `Burned · ${shortAddress(burnTx)}` : 'Burned',
      wait: '',
      took: took(timeline.start, timeline.attest),
    },
    {
      title: 'Circle signed off',
      now: 'Circle is checking the burn',
      done: 'Checked and signed',
      wait: 'Circle checks the burn',
      took: took(timeline.attest, timeline.mint ?? timeline.ready),
    },
    quote.coverGas
      ? {
          title: stage === 'landed' ? `Landed on ${to.name}` : `Lands on ${to.name}`,
          now: `Minting ${usdc(quote.receive)} USDC`,
          done: mintTx
            ? `${usdc(quote.receive)} USDC · ${shortAddress(mintTx)}`
            : `${usdc(quote.receive)} USDC`,
          wait: `${usdc(quote.receive)} USDC to ${shortAddress(recipient)}`,
          took: took(timeline.mint, finalAt),
        }
      : {
          title: 'Ready for them',
          now: '',
          done: `They collect it on ${to.name} with a little ${to.gasToken}`,
          wait: `They collect it on ${to.name}`,
          took: '',
        },
  ]

  return (
    <View style={{ flex: 1 }}>
      <View style={{ gap: 4 }} accessibilityLiveRegion="polite">
        <Txt weight="bold" size={34} style={{ letterSpacing: -1.2 }}>
          {stage === 'landed' ? 'Landed' : stage === 'ready' ? 'Signed and waiting' : 'On its way'}
        </Txt>
        <Txt weight="medium" size={15} color={colors.muted}>
          {formatUsd(quote.amount)} to {shortAddress(recipient)} on {to.name}
        </Txt>
      </View>

      <View style={{ marginTop: 16 }}>
        <FlightRoute width={width - 40} to={to} stage={stage} clock={clock} />
      </View>

      <View style={{ marginTop: 18 }}>
        {steps.map((s, i) => {
          const st = state(i)
          const last = i === steps.length - 1
          return (
            <View key={s.title} style={{ flexDirection: 'row', gap: 14 }}>
              <View style={{ width: 28, alignItems: 'center' }}>
                <Dot state={st} />
                {last ? null : (
                  <View
                    style={[
                      styles.line,
                      { backgroundColor: st === 'done' ? colors.teal : colors.rule },
                    ]}
                  />
                )}
              </View>
              <View style={styles.stepBody}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt weight="bold" size={16} color={st === 'wait' ? colors.muted : colors.ink}>
                    {s.title}
                  </Txt>
                  {(st === 'done' ? s.done : st === 'now' ? s.now : s.wait) ? (
                    <Txt size={13} color={colors.muted}>
                      {st === 'done' ? s.done : st === 'now' ? s.now : s.wait}
                    </Txt>
                  ) : null}
                </View>
                {st === 'done' && s.took ? (
                  <Txt weight="bold" size={14} color={colors.muted}>
                    {s.took}
                  </Txt>
                ) : null}
              </View>
            </View>
          )
        })}
      </View>

      <View style={{ flex: 1 }} />
      {demo ? <DemoNote /> : null}
      {late ? (
        <View style={styles.demo}>
          <Icon name="clock" size={14} color={colors.onTint} strokeWidth={2.6} />
          <Txt weight="semi" size={12} color={colors.onTint} style={{ flex: 1 }}>
            {late}
          </Txt>
        </View>
      ) : null}
      {done ? (
        <Animated.View entering={FadeIn.duration(250)}>
          <PillButton label="See receipt" onPress={onReceipt} />
        </Animated.View>
      ) : (
        <Txt size={13} color={colors.muted} style={styles.leave}>
          {burnTx
            ? 'It has left Monad. You can leave this screen: it keeps going.'
            : 'Sending it from Monad…'}
        </Txt>
      )}
    </View>
  )
}

function Dot({ state }: { state: 'done' | 'now' | 'wait' }) {
  if (state === 'done')
    return (
      <Animated.View entering={ZoomIn.springify().damping(12)} style={[styles.dot, styles.dotDone]}>
        <Icon name="check" size={14} color={colors.white} strokeWidth={3.2} />
      </Animated.View>
    )
  if (state === 'now')
    return (
      <View style={[styles.dot, styles.dotNow]}>
        <View style={styles.dotCore} />
      </View>
    )
  return <View style={[styles.dot, styles.dotWait]} />
}

/** On testnet, where the bridge doesn't run: say plainly that the stand-in moved nothing. */
export function DemoNote() {
  return (
    <View style={styles.demo}>
      <Icon name="info" size={14} color={colors.onTint} strokeWidth={2.6} />
      <Txt weight="semi" size={12} color={colors.onTint} style={{ flex: 1 }}>
        Demo: nothing moved. The bridge only runs on mainnet.
      </Txt>
    </View>
  )
}

/**
 * The receipt. Kovi cheers from the top of it (his one appearance in this flow); below, what
 * landed and where, and the proof on both networks: the burn on Monad and the mint on theirs.
 */
export function LandedStep({
  to,
  recipient,
  quote,
  stage,
  took,
  burnTx,
  mintTx,
  demo,
  onDone,
}: {
  to: Network
  recipient: string
  quote: Quote
  stage: Stage
  took: string
  burnTx: string | null
  mintTx: string | null
  demo: boolean
  onDone: () => void
}) {
  const monad = network('monad')
  const landed = stage === 'landed'
  const share = () =>
    void Share.share({
      message: `Sent ${formatUsd(quote.amount)} to ${shortAddress(recipient)} on ${to.name} with Kova.${
        mintTx && to.explorer
          ? ` ${to.explorer.tx(mintTx)}`
          : burnTx && monad.explorer
            ? ` ${monad.explorer.tx(burnTx)}`
            : ''
      }`,
    })
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.kovi}>
        <View style={[styles.spark, { left: '22%', top: 20 }]}>
          <Sparkle size={26} fill={colors.coral} />
        </View>
        <View style={[styles.spark, { right: '24%', top: 8 }]}>
          <Sparkle size={22} fill={colors.white} />
        </View>
        <Animated.View entering={ZoomIn.springify().damping(11)}>
          <Kovi pose="cheer" size={124} />
        </Animated.View>
      </View>
      <View style={styles.receipt}>
        <View style={{ alignItems: 'center', paddingTop: 24, paddingHorizontal: 20 }}>
          <Txt weight="bold" size={15} color={colors.muted}>
            {landed ? `Landed on ${to.name}` : `Ready for them on ${to.name}`}
          </Txt>
          <Txt weight="bold" size={46} style={{ letterSpacing: -1.8, marginTop: 2 }}>
            {formatUsd(quote.amount)}
          </Txt>
          <View style={styles.took}>
            <Icon name="clock" size={13} color={colors.onTint} strokeWidth={2.8} />
            <Txt weight="bold" size={13} color={colors.onTint}>
              Took {took}
            </Txt>
          </View>
        </View>
        <View style={{ paddingHorizontal: 20, marginTop: 12 }}>
          <Row label="To" value={shortAddress(recipient)} />
          <Row label="Network" value={to.name} logo={to} />
          <Row label={landed ? 'They got' : 'They’ll get'} value={`${usdc(quote.receive)} USDC`} />
          <Row
            label="Fee"
            value={quote.fee === 0n ? 'Free' : formatUsd(quote.fee)}
            hint={quote.fee === 0n ? undefined : 'their gas'}
          />
        </View>
        <View style={styles.tear}>
          <View style={[styles.notch, { left: -15 }]} />
          <View style={[styles.notchCover, { left: -19 }]} />
          <View style={[styles.notch, { right: -15 }]} />
          <View style={[styles.notchCover, { right: -19 }]} />
        </View>
        <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
          <Txt weight="bold" size={12} color={colors.muted} style={styles.proof}>
            PROOF ON BOTH NETWORKS
          </Txt>
          <Proof n={monad} title="Left Monad" tx={burnTx} demo={demo} />
          <Proof
            n={to}
            title={landed ? `Landed on ${to.name}` : `Waiting on ${to.name}`}
            tx={mintTx}
            demo={demo}
          />
        </View>
      </View>
      <View style={{ flex: 1 }} />
      {demo ? <DemoNote /> : null}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <PillButton tone="white" label="Share" icon="share" onPress={share} />
        </View>
        <View style={{ flex: 1 }}>
          <PillButton label="Done" icon="check" onPress={onDone} />
        </View>
      </View>
    </View>
  )
}

function Row({
  label,
  value,
  hint,
  logo,
}: {
  label: string
  value: string
  hint?: string
  logo?: Network
}) {
  return (
    <View style={styles.row}>
      <Txt size={14} color={colors.muted}>
        {label}
      </Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {logo ? <ChainLogo name={logo.id} size={20} /> : null}
        <Txt weight="bold" size={15}>
          {value}
          {hint ? (
            <Txt weight="medium" size={15} color={colors.muted}>
              {` ${hint}`}
            </Txt>
          ) : null}
        </Txt>
      </View>
    </View>
  )
}

function Proof({
  n,
  title,
  tx,
  demo,
}: {
  n: Network
  title: string
  tx: string | null
  demo: boolean
}) {
  const explorer = n.explorer
  const open =
    tx && explorer && !demo ? () => void WebBrowser.openBrowserAsync(explorer.tx(tx)) : undefined
  return (
    <Pressable
      accessibilityRole={open ? 'link' : undefined}
      disabled={!open}
      onPress={open}
      style={({ pressed }) => [styles.proofRow, pressed && { backgroundColor: colors.wash }]}
    >
      <ChainLogo name={n.id} size={32} />
      <View style={{ flex: 1 }}>
        <Txt weight="bold" size={15}>
          {title}
        </Txt>
        <Txt size={13} color={colors.muted}>
          {tx
            ? `${explorer ? `${explorer.name} · ` : ''}${shortAddress(tx)}`
            : 'When they collect it'}
        </Txt>
      </View>
      {open ? <Icon name="web" size={18} strokeWidth={2.2} /> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  line: { flex: 1, width: 2, minHeight: 18, borderRadius: 1 },
  stepBody: { flex: 1, flexDirection: 'row', gap: 8, paddingTop: 3, paddingBottom: 18 },
  dot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  dotDone: { backgroundColor: colors.teal, borderWidth: 2, borderColor: colors.line },
  dotNow: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.edge },
  dotCore: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.coral },
  dotWait: { borderWidth: 2, borderStyle: 'dashed', borderColor: colors.rule },
  leave: { textAlign: 'center', lineHeight: 18, paddingVertical: 14 },
  demo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 16,
    backgroundColor: colors.sunken,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  kovi: { height: 112, alignItems: 'center', justifyContent: 'flex-end', zIndex: 2 },
  spark: { position: 'absolute' },
  receipt: {
    marginTop: -18,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  took: {
    marginTop: 8,
    height: 28,
    borderRadius: 14,
    paddingHorizontal: 10,
    backgroundColor: colors.tealSoft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  row: { height: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tear: { height: 26, marginTop: 8 },
  notch: {
    position: 'absolute',
    top: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.paper,
  },
  notchCover: {
    position: 'absolute',
    top: -2,
    width: 18,
    height: 32,
    backgroundColor: colors.paper,
  },
  proof: { letterSpacing: 1.2, paddingHorizontal: 8, paddingBottom: 6 },
  proofRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 8,
    borderRadius: 16,
  },
})
