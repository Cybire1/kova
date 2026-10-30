import { parseAmount, repeatEveryLabel } from '@kova/monad'
import * as Haptics from 'expo-haptics'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native'
import { FadeIn } from 'react-native-reanimated'
import type { Address } from 'viem'
import { listRepeats, type RepeatPayment } from '@/lib/api'
import { formatUsd } from '@/lib/money'
import { repeatsSwitchedOn, stopRepeatPlan } from '@/lib/programs'
import { colors, pair } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import Animated from '@/ui/animated'
import { Avatar, Kovi } from '@/ui/art'
import { Icon } from '@/ui/Icon'
import { Bob } from '@/ui/motion'
import { ComingSoon, shortDate, useNames } from '@/ui/Programs'
import { Header, PillButton, RoundButton, Screen, Txt } from '@/ui/primitives'

/**
 * Repeat payments: rent, school fees, a wage every Friday. You sign a plan once (who, how much,
 * how often, how many times at most) and each payment is collected when it's due, never early and
 * never more. Plans you pay, and plans paying you; any plan you pay stops with one signature.
 */
export default function RepeatPayments() {
  const { profile, signTypedData } = useWallet()
  const [list, setList] = useState<RepeatPayment[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [on, setOn] = useState<boolean | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [asking, setAsking] = useState<string | null>(null)
  const [stopping, setStopping] = useState<string | null>(null)
  const [stopProblem, setStopProblem] = useState<{ id: string; text: string } | null>(null)
  const [stopped, setStopped] = useState<string | null>(null)
  const address = profile?.address

  const load = useCallback(async () => {
    if (!address) return
    const [plans, live] = await Promise.all([
      listRepeats(address).then(
        (data) => ({ data, error: null }),
        (e: unknown) => ({
          data: null,
          error: e instanceof Error ? e.message : 'Kova is unreachable. Try again.',
        }),
      ),
      repeatsSwitchedOn(address as Address),
    ])
    if (plans.data) setList(plans.data)
    setProblem(plans.error)
    if (live !== null) setOn(live)
  }, [address])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const names = useNames(list?.map((r) => (r.role === 'paying' ? r.payee : r.payer)) ?? [])

  const stop = async (plan: RepeatPayment) => {
    if (!address) return
    setStopping(plan.id)
    setStopProblem(null)
    try {
      await stopRepeatPlan(address as Address, plan, signTypedData)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setAsking(null)
      setStopped(`Stopped. No more payments go to ${names(plan.payee)}.`)
      await load()
    } catch (e) {
      const text = e instanceof Error ? e.message : 'It didn’t stop. Try again.'
      if (!/cancel/i.test(text)) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
        setStopProblem({ id: plan.id, text })
      }
    } finally {
      setStopping(null)
    }
  }

  const paying = list?.filter((r) => r.role === 'paying') ?? []
  const getting = list?.filter((r) => r.role === 'getting') ?? []
  const next = paying
    .filter((r) => r.status === 'active' && r.next_at)
    .sort((a, b) => Date.parse(a.next_at ?? '') - Date.parse(b.next_at ?? ''))[0]
  const canStart = on !== false

  return (
    <Screen>
      <Header
        title="Repeat payments"
        right={
          canStart && list && list.length > 0 ? (
            <RoundButton
              icon="plus"
              label="New repeat payment"
              onPress={() => router.push('/repeat/new')}
            />
          ) : null
        }
      />
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.ink}
            onRefresh={() => {
              setRefreshing(true)
              void load().finally(() => setRefreshing(false))
            }}
          />
        }
      >
        {!list ? (
          problem ? (
            <View style={styles.center}>
              <Kovi pose="oops" size={120} />
              <Txt weight="semi" size={18} style={{ marginTop: 6 }}>
                Couldn’t load your repeat payments
              </Txt>
              <Txt size={14} color={colors.muted} style={styles.centerText}>
                {problem}
              </Txt>
              <View style={{ alignSelf: 'stretch', marginTop: 16 }}>
                <PillButton
                  label="Try again"
                  icon="swap"
                  tone="white"
                  onPress={() => void load()}
                />
              </View>
            </View>
          ) : (
            <View style={styles.center}>
              <ActivityIndicator color={colors.ink} />
              <Txt size={15} color={colors.muted} style={{ marginTop: 10 }}>
                Opening…
              </Txt>
            </View>
          )
        ) : list.length === 0 && on === false ? (
          <ComingSoon
            title="Pay on repeat"
            lead="Rent, school fees, a wage every Friday. Set it up once, and each payment goes out when it’s due."
            facts={[
              ['How often', 'Every week, 2 weeks or 30 days'],
              ['Most it can take', 'Set by you, signed by you'],
              ['Stop it', 'Any time, with one tap'],
            ]}
            note="Repeat payments aren’t switched on yet. They’re coming soon."
          />
        ) : list.length === 0 ? (
          <Empty />
        ) : (
          <View style={{ gap: 14, paddingTop: 6 }}>
            {next ? (
              <Animated.View entering={FadeIn.duration(300)} style={styles.hero}>
                <View style={styles.heroTop}>
                  <View style={styles.heroIcon}>
                    <Icon name="clock" size={18} color={colors.dark} />
                  </View>
                  <Txt weight="semi" size={14} color={colors.onInk}>
                    Next to go out
                  </Txt>
                </View>
                <Txt weight="bold" size={40} color={colors.white} style={styles.big}>
                  {formatUsd(parseAmount(next.amount))}
                </Txt>
                <Txt size={15} color={colors.onInk}>
                  To {names(next.payee)} on {shortDate(next.next_at ?? '')}
                </Txt>
              </Animated.View>
            ) : null}

            {problem ? (
              <Txt size={14} weight="medium" color={colors.danger}>
                {problem}
              </Txt>
            ) : null}
            {stopped ? (
              <View style={styles.stopped}>
                <Icon name="check" size={18} />
                <Txt weight="semi" size={14} style={{ flex: 1 }}>
                  {stopped}
                </Txt>
              </View>
            ) : null}

            {paying.length > 0 ? (
              <View style={styles.section}>
                <Txt weight="bold" size={20}>
                  You pay
                </Txt>
                {paying.map((plan) => (
                  <Plan
                    key={plan.id}
                    plan={plan}
                    name={names(plan.payee)}
                    asking={asking === plan.id}
                    busy={stopping === plan.id}
                    problem={stopProblem?.id === plan.id ? stopProblem.text : null}
                    onAsk={() => {
                      setStopped(null)
                      setStopProblem(null)
                      setAsking(asking === plan.id ? null : plan.id)
                    }}
                    onStop={() => void stop(plan)}
                  />
                ))}
              </View>
            ) : null}

            {getting.length > 0 ? (
              <View style={styles.section}>
                <Txt weight="bold" size={20}>
                  Paying you
                </Txt>
                {getting.map((plan) => (
                  <Plan key={plan.id} plan={plan} name={names(plan.payer)} />
                ))}
              </View>
            ) : null}

            {canStart ? (
              <View style={{ marginTop: 8 }}>
                <PillButton
                  label="New repeat payment"
                  icon="plus"
                  onPress={() => router.push('/repeat/new')}
                />
              </View>
            ) : (
              <Txt size={13} color={colors.muted} style={{ textAlign: 'center' }}>
                New repeat payments are coming soon.
              </Txt>
            )}
            <Txt size={13} color={colors.muted} style={styles.fine}>
              Each payment is collected when it’s due, never early and never more than you signed
              for. Kova covers the fee, and never holds your dollars.
            </Txt>
          </View>
        )}
      </ScrollView>
    </Screen>
  )
}

/** Nothing set up yet: what it's for, and the way in. */
function Empty() {
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.emptyArt}>
        <Bob>
          <Kovi pose="wave" size={150} />
        </Bob>
      </View>
      <Txt weight="semi" size={30} style={styles.emptyTitle}>
        Pay on repeat
      </Txt>
      <Txt size={16} color={colors.onTint} style={styles.emptyLead}>
        Set up a payment once, and it goes out by itself when it’s due. Stop it any time.
      </Txt>
      <View style={styles.ideas}>
        {(
          [
            ['Rent', 'Every 30 days'],
            ['School fees', 'Every 30 days'],
            ['A wage', 'Every week'],
            ['Pocket money', 'Every 2 weeks'],
          ] as const
        ).map(([what, when]) => (
          <View key={what} style={styles.idea}>
            <Txt weight="bold" size={14}>
              {what}
            </Txt>
            <Txt size={12} color={colors.muted}>
              {when}
            </Txt>
          </View>
        ))}
      </View>
      <View style={{ marginTop: 'auto', paddingTop: 24, gap: 10 }}>
        <PillButton
          label="Set up a repeat payment"
          icon="plus"
          onPress={() => router.push('/repeat/new')}
        />
        <Txt size={12} color={colors.muted} style={{ textAlign: 'center' }}>
          You choose who, how much, how often and how many times.
        </Txt>
      </View>
    </View>
  )
}

function Plan({
  plan,
  name,
  asking,
  busy,
  problem,
  onAsk,
  onStop,
}: {
  plan: RepeatPayment
  name: string
  asking?: boolean
  busy?: boolean
  problem?: string | null
  onAsk?: () => void
  onStop?: () => void
}) {
  const mine = plan.role === 'paying'
  const other = mine ? plan.payee : plan.payer
  const active = plan.status === 'active'
  const amount = formatUsd(parseAmount(plan.amount))
  const done = plan.times > 0 ? Math.min(1, plan.paid / plan.times) : 0
  const when = active
    ? plan.next_at
      ? `Next ${shortDate(plan.next_at)}`
      : 'Due now'
    : plan.status === 'finished'
      ? 'Finished'
      : 'Stopped'
  return (
    <View style={[styles.plan, !active && styles.ended]}>
      <View style={styles.planTop}>
        <Avatar name={name} id={other} size={44} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt weight="bold" size={16} numberOfLines={1}>
            {plan.label || name}
          </Txt>
          <Txt size={13} color={colors.muted} numberOfLines={1}>
            {plan.label ? `${mine ? 'To' : 'From'} ${name}` : mine ? 'You pay them' : 'Pays you'}
          </Txt>
        </View>
        <Txt weight="bold" size={18} style={{ letterSpacing: -0.4 }}>
          {mine ? '' : '+'}
          {amount}
        </Txt>
      </View>

      <View style={styles.meta}>
        <View style={styles.metaChip}>
          <Icon name="clock" size={13} color={colors.ink} />
          <Txt weight="semi" size={12}>
            {repeatEveryLabel(plan.every)}
          </Txt>
        </View>
        <View style={[styles.metaChip, !active && { backgroundColor: colors.sunken }]}>
          <Txt weight="semi" size={12} color={active ? colors.ink : colors.muted}>
            {when}
          </Txt>
        </View>
      </View>

      <View style={styles.progressRow}>
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              { width: `${done * 100}%`, backgroundColor: mine ? colors.coral : colors.teal },
            ]}
          />
        </View>
        <Txt weight="semi" size={12} color={colors.muted}>
          {plan.paid} of {plan.times} paid
        </Txt>
      </View>

      {plan.problem && active ? (
        <View style={styles.short}>
          <Icon name="info" size={15} color={colors.danger} />
          <Txt size={13} style={{ flex: 1, lineHeight: 18 }}>
            <Txt weight="bold" size={13} color={colors.danger}>
              Short last time.{' '}
            </Txt>
            {mine
              ? 'Your wallet didn’t have enough for the last one. Add money before the next.'
              : plan.problem}
          </Txt>
        </View>
      ) : null}

      {mine && active && onAsk ? (
        asking ? (
          <Animated.View entering={FadeIn.duration(200)} style={styles.confirm}>
            <Txt weight="semi" size={15}>
              Stop paying {name}?
            </Txt>
            <Txt size={13} color={colors.muted} style={{ lineHeight: 18 }}>
              No more payments go out.{' '}
              {plan.paid > 0
                ? `The ${plan.paid} already paid stay paid.`
                : 'Nothing has been paid yet.'}{' '}
              One Face ID tap.
            </Txt>
            {problem ? (
              <Txt weight="medium" size={13} color={colors.danger}>
                {problem}
              </Txt>
            ) : null}
            <View style={styles.confirmRow}>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={onAsk}
                style={[styles.small, { backgroundColor: colors.surface }]}
              >
                <Txt weight="semi" size={14}>
                  Keep paying
                </Txt>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ busy: !!busy }}
                disabled={busy}
                onPress={onStop}
                style={[
                  styles.small,
                  { backgroundColor: colors.danger, borderColor: colors.danger },
                ]}
              >
                {busy ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Txt weight="semi" size={14} color={colors.white}>
                    Stop it
                  </Txt>
                )}
              </Pressable>
            </View>
          </Animated.View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Stop paying ${name}`}
            onPress={onAsk}
            style={({ pressed }) => [styles.stop, pressed && { opacity: 0.7 }]}
          >
            <Icon name="close" size={14} />
            <Txt weight="bold" size={13}>
              Stop
            </Txt>
          </Pressable>
        )
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  body: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  centerText: { textAlign: 'center', marginTop: 4, lineHeight: 20 },
  hero: {
    borderRadius: 28,
    backgroundColor: colors.fill,
    padding: 18,
    gap: 2,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  heroIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  big: { letterSpacing: -1.6 },
  stopped: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 16,
    backgroundColor: colors.tealSoft,
  },
  section: { gap: 10, marginTop: 6 },
  plan: {
    gap: 12,
    padding: 14,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  ended: { opacity: 0.66, borderStyle: 'dashed' },
  planTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: colors.tealSoft,
  },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  track: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.sunken,
    overflow: 'hidden',
  },
  fill: { height: 8, borderRadius: 4 },
  short: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 10,
    borderRadius: 14,
    backgroundColor: colors.coralSoft,
  },
  stop: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.raised,
  },
  confirm: {
    gap: 6,
    padding: 12,
    borderRadius: 16,
    backgroundColor: pair('#FBEDEA', '#2A1714'),
  },
  confirmRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
  small: {
    flex: 1,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fine: { marginTop: 6, lineHeight: 18, textAlign: 'center' },
  emptyArt: { alignItems: 'center', marginTop: 8, height: 160 },
  emptyTitle: { letterSpacing: -0.8, textAlign: 'center' },
  emptyLead: { lineHeight: 23, marginTop: 8, textAlign: 'center', paddingHorizontal: 8 },
  ideas: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 22 },
  idea: {
    flexBasis: '47%',
    flexGrow: 1,
    padding: 14,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    gap: 2,
  },
})
