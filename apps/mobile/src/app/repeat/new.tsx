import { DAY, REPEAT_EVERY, repeatEveryLabel } from '@kova/monad'
import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { FadeIn, FadeInLeft, FadeInRight } from 'react-native-reanimated'
import { type Address, isAddressEqual } from 'viem'
import { notSwitchedOn, type RepeatPayment } from '@/lib/api'
import { applyKey, formatUsd, groupTyped, toBase } from '@/lib/money'
import { repeatsSwitchedOn, shortAddress, startRepeatPlan } from '@/lib/programs'
import { colors, fonts, pair } from '@/lib/theme'
import { isUnnamed, useWallet } from '@/lib/wallet'
import Animated from '@/ui/animated'
import { Avatar } from '@/ui/art'
import { Icon, type IconName } from '@/ui/Icon'
import { Keypad } from '@/ui/Keypad'
import { Burst } from '@/ui/motion'
import { PersonPicker, type Picked } from '@/ui/PersonPicker'
import { ComingSoon, shortDate } from '@/ui/Programs'
import { Header, PillButton, Screen, Txt } from '@/ui/primitives'
import { Stage } from '@/ui/Stage'
import { DateSheet } from '@/ui/travel/DateSheet'

type Step = 'who' | 'amount' | 'often' | 'start' | 'times' | 'review' | 'done'
const order: Step[] = ['who', 'amount', 'often', 'start', 'times', 'review', 'done']
/** The steps with a dot in the progress row. */
const counted = order.slice(0, 6)

/** Each payment can be at most this (the API's own cap), and a plan at most this many payments. */
const MAX_EACH = 10_000_000_000n
const MAX_TIMES = 520

/** Quick picks for how many times, by how often: about a month, a quarter, half a year, a year. */
const quick: Record<number, number[]> = {
  [7 * DAY]: [4, 13, 26, 52],
  [14 * DAY]: [2, 6, 13, 26],
  [30 * DAY]: [3, 6, 12, 24],
}

/** Roughly how long a plan runs, said plainly. */
function lasts(every: number, times: number) {
  const days = (every * (times - 1)) / DAY
  if (times <= 1) return 'just once'
  if (days < 45) return `about ${Math.round(days / 7)} weeks`
  if (days < 340) return `about ${Math.round(days / 30)} months`
  const years = Math.round((days / 365) * 2) / 2
  return `about ${years} ${years === 1 ? 'year' : 'years'}`
}

/**
 * A new repeat payment, one question at a time: who, how much, how often, from when, how many
 * times, then a review. Face ID signs the plan and a cap of exactly the most it can ever take.
 */
export default function NewRepeat() {
  const { profile, balance, contacts, signTypedData, rememberContact } = useWallet()
  const { width } = useWindowDimensions()
  const [on, setOn] = useState<boolean | null>(null)
  const [step, setStep] = useState<Step>('who')
  const [back, setBack] = useState(false)
  const [to, setTo] = useState<Picked | null>(null)
  const [typed, setTyped] = useState('')
  const [label, setLabel] = useState('')
  const [every, setEvery] = useState<number>(REPEAT_EVERY[0].seconds)
  /** YYYY-MM-DD of the first payment, or null for today. */
  const [startDay, setStartDay] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [times, setTimes] = useState(12)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [made, setMade] = useState<RepeatPayment | null>(null)

  const address = profile?.address
  useEffect(() => {
    if (!address) return
    let live = true
    void repeatsSwitchedOn(address as Address).then((yes) => live && setOn(yes))
    return () => {
      live = false
    }
  }, [address])

  const moveTo = (next: Step) => {
    setBack(order.indexOf(next) < order.indexOf(step))
    setProblem(null)
    setStep(next)
  }
  const previous = () => {
    const i = order.indexOf(step)
    const prev = order[i - 1]
    if (i <= 0 || !prev || step === 'done') return router.back()
    moveTo(prev)
  }

  const saved = to ? contacts.find((c) => isAddressEqual(c.address, to.address))?.name : undefined
  const name = to
    ? ((saved && !isUnnamed(saved) ? saved : to.name && !isUnnamed(to.name) ? to.name : null) ??
      shortAddress(to.address))
    : ''
  const first = name.startsWith('0x') ? name : (name.split(' ')[0] ?? name)
  const amount = Number(typed) > 0 ? toBase(Number(typed).toFixed(2)) : 0n
  const tooMuch = amount > MAX_EACH
  const most = amount * BigInt(times)
  const everyLabel = repeatEveryLabel(every)
  const everyWords = everyLabel.charAt(0).toLowerCase() + everyLabel.slice(1)

  /** Unix seconds of the first payment: now, or 9am on the chosen day (now, if that's passed). */
  const startAt = () => {
    const now = Math.floor(Date.now() / 1000)
    if (!startDay) return now
    const [y = 2026, m = 1, d = 1] = startDay.split('-').map(Number)
    return Math.max(now, Math.floor(new Date(y, m - 1, d, 9).getTime() / 1000))
  }
  const firstAt = startAt() * 1000
  const dateAt = (n: number) => new Date(firstAt + n * every * 1000)
  const lastAt = dateAt(times - 1)
  const today = !startDay || startAt() - Math.floor(Date.now() / 1000) < 3600
  const shortNow = today && balance !== null && amount > balance

  const start = async () => {
    if (!profile || !to) return
    setBusy(true)
    setProblem(null)
    try {
      const plan = await startRepeatPlan(
        profile.address as Address,
        {
          payee: to.address,
          amount: Number(typed).toFixed(2),
          every,
          start: startAt(),
          times,
          ...(label.trim() ? { label: label.trim() } : {}),
        },
        signTypedData,
      )
      // Someone you pay on repeat is one of your people from now on.
      if (!saved && to.name && !isUnnamed(to.name))
        void rememberContact({ address: to.address, name: to.name }).catch(() => null)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setMade(plan)
      moveTo('done')
    } catch (e) {
      if (notSwitchedOn(e)) {
        setOn(false)
        return
      }
      const text = e instanceof Error ? e.message : 'The plan didn’t start. No money moved.'
      if (!/cancel/i.test(text)) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
        setProblem(text)
      }
    } finally {
      setBusy(false)
    }
  }

  const enter = back ? FadeInLeft.duration(240) : FadeInRight.duration(260)
  const dot = counted.indexOf(step)

  if (on === false)
    return (
      <Screen>
        <Header title="Repeat payments" />
        <ScrollView contentContainerStyle={styles.body}>
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
        </ScrollView>
      </Screen>
    )

  return (
    <Screen>
      <Header
        title={step === 'done' ? undefined : 'New repeat payment'}
        backIcon={step === 'who' || step === 'done' ? 'close' : 'back'}
        onBack={busy ? null : step === 'done' ? () => router.back() : previous}
      />
      {step !== 'done' ? (
        <View style={styles.dots} accessibilityLabel={`Step ${dot + 1} of ${counted.length}`}>
          {counted.map((s, i) => (
            <View
              key={s}
              style={[
                styles.dot,
                i <= dot && { backgroundColor: colors.chosen },
                i === dot && { width: 22 },
              ]}
            />
          ))}
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {step === 'who' ? (
          <Animated.View key="who" entering={enter}>
            <PersonPicker
              title="Who do you pay?"
              lead="Someone you pay again and again: your landlord, a school, someone who works for you."
              refuse={(a) =>
                profile && isAddressEqual(a, profile.address as Address)
                  ? 'That’s your own wallet. A repeat payment goes to someone else.'
                  : null
              }
              onPick={(p) => {
                setTo(p)
                moveTo('amount')
              }}
            />
          </Animated.View>
        ) : null}

        {step === 'amount' && to ? (
          <Animated.View key="amount" entering={enter}>
            <WhoRow name={name} address={to.address} line="Each payment" />
            <View style={styles.entry}>
              <Txt
                weight="semi"
                size={64}
                style={[styles.big, typed === '' && { color: pair('#B4B9B8', '#4A4744') }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                ${groupTyped(typed)}
              </Txt>
              <View style={[styles.pill, tooMuch && { backgroundColor: colors.coralSoft }]}>
                <Txt weight="medium" size={14} color={tooMuch ? colors.danger : colors.onTint}>
                  {tooMuch ? 'Up to $10,000 each time' : 'Each time it pays'}
                </Txt>
              </View>
              <View style={styles.labelField}>
                <Icon name="tag" size={15} color={colors.muted} />
                <TextInput
                  value={label}
                  onChangeText={setLabel}
                  placeholder="What it’s for: rent, fees, wages"
                  placeholderTextColor="#8C9799"
                  maxLength={40}
                  autoCapitalize="sentences"
                  accessibilityLabel="What it’s for"
                  style={styles.labelInput}
                />
              </View>
            </View>
            <Keypad onKey={(key) => setTyped((v) => applyKey(v, key))} size={56} />
            <View style={{ marginTop: 14 }}>
              <PillButton
                label={tooMuch ? 'Up to $10,000 each time' : 'Next'}
                disabled={amount === 0n || tooMuch}
                onPress={() => moveTo('often')}
              />
            </View>
          </Animated.View>
        ) : null}

        {step === 'often' ? (
          <Animated.View key="often" entering={enter} style={{ gap: 12 }}>
            <Question title="How often?" lead={`${formatUsd(amount)} to ${first}, each time.`} />
            {REPEAT_EVERY.map((e) => (
              <Choice
                key={e.id}
                icon="clock"
                title={e.label}
                sub={
                  e.id === 'week'
                    ? 'Wages, pocket money, a weekly bill'
                    : e.id === 'fortnight'
                      ? 'Paydays, allowances'
                      : 'Rent, school fees, monthly bills'
                }
                chosen={every === e.seconds}
                onPress={() => {
                  setEvery(e.seconds)
                  setTimes(quick[e.seconds]?.[2] ?? 12)
                  setTimeout(() => moveTo('start'), 160)
                }}
              />
            ))}
          </Animated.View>
        ) : null}

        {step === 'start' ? (
          <Animated.View key="start" entering={enter} style={{ gap: 12 }}>
            <Question title="When does it start?" lead="The first payment goes out on this day." />
            <Choice
              icon="bolt"
              title="Today"
              sub="The first payment goes out now"
              chosen={!startDay}
              onPress={() => setStartDay(null)}
            />
            <Choice
              icon="clock"
              title={startDay ? shortDate(firstAt) : 'Pick a day'}
              sub={startDay ? 'Tap to change the day' : 'Within the next year'}
              chosen={!!startDay}
              onPress={() => setPicking(true)}
            />
            <View style={styles.preview}>
              <Txt weight="semi" size={13} color={colors.muted}>
                The first few
              </Txt>
              <View style={styles.previewRow}>
                {[0, 1, 2, 3].map((n) => (
                  <View key={n} style={[styles.previewDay, n === 0 && styles.previewFirst]}>
                    <Txt
                      weight="bold"
                      size={13}
                      color={n === 0 ? colors.onChosen : colors.ink}
                      numberOfLines={1}
                    >
                      {n === 0 && !startDay ? 'Today' : shortDate(dateAt(n)).replace(/^\w+ /, '')}
                    </Txt>
                  </View>
                ))}
              </View>
            </View>
            <View style={{ marginTop: 6 }}>
              <PillButton label="Next" onPress={() => moveTo('times')} />
            </View>
            <DateSheet
              visible={picking}
              onClose={() => setPicking(false)}
              onDone={(d) => {
                setPicking(false)
                setStartDay(d)
              }}
              start={startDay}
              end={null}
              labels={{ start: 'The first payment', end: 'The first payment' }}
              oneWay
            />
          </Animated.View>
        ) : null}

        {step === 'times' ? (
          <Animated.View key="times" entering={enter} style={{ gap: 14 }}>
            <Question
              title="How many times?"
              lead="It stops by itself after this many. You can stop it sooner."
            />
            <View style={styles.stepper}>
              <StepButton
                icon="minus"
                label="One fewer"
                disabled={times <= 1}
                onPress={() => setTimes((t) => Math.max(1, t - 1))}
              />
              <View style={{ alignItems: 'center', flex: 1 }}>
                <Txt weight="bold" size={56} style={styles.big}>
                  {times}
                </Txt>
                <Txt weight="semi" size={14} color={colors.muted}>
                  {times === 1 ? 'payment' : 'payments'}, {lasts(every, times)}
                </Txt>
              </View>
              <StepButton
                icon="plus"
                label="One more"
                disabled={times >= MAX_TIMES}
                onPress={() => setTimes((t) => Math.min(MAX_TIMES, t + 1))}
              />
            </View>
            <View style={styles.chips}>
              {(quick[every] ?? [3, 6, 12, 24]).map((n) => (
                <Pressable
                  key={n}
                  accessibilityRole="button"
                  accessibilityState={{ selected: times === n }}
                  onPress={() => {
                    void Haptics.selectionAsync()
                    setTimes(n)
                  }}
                  style={[styles.chip, times === n && styles.chipOn]}
                >
                  <Txt weight="bold" size={15} color={times === n ? colors.onChosen : colors.ink}>
                    {n}
                  </Txt>
                  <Txt size={11} color={times === n ? colors.onChosen : colors.muted}>
                    {lasts(every, n).replace('about ', '≈ ')}
                  </Txt>
                </Pressable>
              ))}
            </View>
            <View style={styles.cap}>
              <View style={{ flex: 1 }}>
                <Txt size={13} color={colors.muted}>
                  The most it can ever take
                </Txt>
                <Txt weight="bold" size={22} style={{ letterSpacing: -0.5 }}>
                  {formatUsd(most)}
                </Txt>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Txt size={13} color={colors.muted}>
                  Last payment
                </Txt>
                <Txt weight="semi" size={15}>
                  {shortDate(lastAt)}
                </Txt>
              </View>
            </View>
            <PillButton label="Review" onPress={() => moveTo('review')} />
          </Animated.View>
        ) : null}

        {step === 'review' && to ? (
          <Animated.View key="review" entering={enter} style={{ gap: 14 }}>
            <Question title="Check and start" />
            <View style={styles.summary}>
              <View style={styles.summaryTop}>
                <Avatar name={name} id={to.address} size={52} />
                <View style={{ flex: 1 }}>
                  <Txt weight="semi" size={13} color={colors.onInk}>
                    {label.trim() || 'Repeat payment'}
                  </Txt>
                  <Txt weight="bold" size={17} color={colors.white} numberOfLines={1}>
                    To {name}
                  </Txt>
                </View>
              </View>
              <Txt weight="bold" size={24} color={colors.white} style={styles.sentence}>
                Pays {first} {formatUsd(amount)} {everyWords},{' '}
                {times === 1 ? 'once' : `${times} times`}.
              </Txt>
              <View style={styles.mostChip}>
                <Icon name="lock" size={14} color={colors.dark} />
                <Txt weight="bold" size={14} color={colors.dark}>
                  {formatUsd(most)} at most.
                </Txt>
              </View>
            </View>

            <View style={styles.facts}>
              <Fact label="First payment" value={today ? 'Today' : shortDate(firstAt)} />
              <Fact label="Last payment" value={times === 1 ? 'The same day' : shortDate(lastAt)} />
              <Fact label="Fee" value="$0.00, Kova covers it" />
              <Fact label="Stop it" value="Any time, from Repeat payments" last />
            </View>

            {shortNow ? (
              <View style={styles.warn}>
                <Icon name="info" size={16} color={colors.danger} />
                <Txt size={13} style={{ flex: 1, lineHeight: 18 }}>
                  You have {formatUsd(balance ?? 0n)}. Add money before the first payment, or it
                  can’t go out today.
                </Txt>
              </View>
            ) : null}

            {problem ? (
              <Animated.View entering={FadeIn} style={styles.problem}>
                <Icon name="info" size={18} color={colors.danger} />
                <Txt weight="medium" size={14} color={colors.danger} style={{ flex: 1 }}>
                  {problem}
                </Txt>
              </Animated.View>
            ) : null}

            <PillButton
              label={busy ? 'Starting…' : problem ? 'Try again' : 'Start with Face ID'}
              icon="face"
              tone="coral"
              loading={busy}
              onPress={() => void start()}
            />
            <Txt size={12} color={colors.muted} style={styles.fine}>
              You sign the plan, and a cap of {formatUsd(most)} it can never go past. Each payment
              is collected when it’s due, never early.
            </Txt>
          </Animated.View>
        ) : null}

        {step === 'done' && to ? (
          <Animated.View key="done" entering={FadeIn.duration(320)} style={styles.done}>
            <Stage pose="cheer" size={150} />
            <Burst
              spots={[
                { x: width / 2 - 130, y: 40, size: 24, fill: colors.yellow, delay: 0 },
                { x: width / 2 + 85, y: 24, size: 30, fill: colors.tealSoft, delay: 140 },
                { x: width / 2 + 64, y: 140, size: 18, fill: colors.yellow, delay: 280 },
                { x: width / 2 - 110, y: 150, size: 20, fill: colors.tealSoft, delay: 420 },
              ]}
            />
            <Txt weight="bold" size={44} style={[styles.big, { marginTop: 10 }]}>
              All set
            </Txt>
            <Txt weight="medium" size={18} style={styles.doneLine}>
              {formatUsd(amount)} goes to {first} {everyWords},{' '}
              {times === 1 ? 'once' : `${times} times`}.
            </Txt>
            <View style={styles.time}>
              <Icon
                name={made && made.paid > 0 ? 'bolt' : 'clock'}
                size={16}
                color={colors.white}
              />
              <Txt weight="semi" size={14} color={colors.white}>
                {made && made.paid > 0
                  ? 'First payment sent'
                  : made?.next_at
                    ? `First payment ${shortDate(made.next_at)}`
                    : `First payment ${today ? 'today' : shortDate(firstAt)}`}
              </Txt>
            </View>
            <View style={{ alignSelf: 'stretch', marginTop: 28 }}>
              <PillButton label="Done" icon="check" onPress={() => router.back()} />
            </View>
          </Animated.View>
        ) : null}
      </ScrollView>
    </Screen>
  )
}

function WhoRow({ name, address, line }: { name: string; address: string; line: string }) {
  return (
    <View style={styles.whoRow}>
      <Avatar name={name} id={address} size={44} />
      <View style={{ flex: 1 }}>
        <Txt weight="semi" size={17} numberOfLines={1}>
          To {name}
        </Txt>
        <Txt size={13} color={colors.muted} numberOfLines={1}>
          {line} · {shortAddress(address)}
        </Txt>
      </View>
    </View>
  )
}

function Question({ title, lead }: { title: string; lead?: string }) {
  return (
    <View style={{ marginTop: 8, marginBottom: 4 }}>
      <Txt weight="bold" size={30} style={{ letterSpacing: -0.8 }}>
        {title}
      </Txt>
      {lead ? (
        <Txt size={15} color={colors.onTint} style={{ marginTop: 4, lineHeight: 21 }}>
          {lead}
        </Txt>
      ) : null}
    </View>
  )
}

function Choice({
  icon,
  title,
  sub,
  chosen,
  onPress,
}: {
  icon: IconName
  title: string
  sub: string
  chosen: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: chosen }}
      accessibilityLabel={`${title}. ${sub}`}
      onPress={() => {
        void Haptics.selectionAsync()
        onPress()
      }}
      style={({ pressed }) => [
        styles.choice,
        chosen && styles.choiceOn,
        pressed && { transform: [{ scale: 0.98 }] },
      ]}
    >
      <View style={[styles.choiceIcon, chosen && { backgroundColor: colors.coral }]}>
        <Icon name={icon} size={19} color={chosen ? colors.white : colors.ink} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt weight="bold" size={17} color={chosen ? colors.onChosen : colors.ink}>
          {title}
        </Txt>
        <Txt size={13} color={chosen ? colors.onChosen : colors.muted} style={{ opacity: 0.85 }}>
          {sub}
        </Txt>
      </View>
      <View style={[styles.radio, chosen && styles.radioOn]}>
        {chosen ? <Icon name="check" size={14} color={colors.dark} /> : null}
      </View>
    </Pressable>
  )
}

function StepButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: IconName
  label: string
  disabled?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => {
        void Haptics.selectionAsync()
        onPress()
      }}
      style={({ pressed }) => [
        styles.stepButton,
        disabled && { opacity: 0.35 },
        pressed && { transform: [{ scale: 0.92 }], backgroundColor: colors.sunken },
      ]}
    >
      <Icon name={icon} size={24} />
    </Pressable>
  )
}

function Fact({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.fact, !last && styles.factRule]}>
      <Txt size={15} color={colors.muted}>
        {label}
      </Txt>
      <Txt weight="semi" size={15} style={{ flexShrink: 1, textAlign: 'right' }} numberOfLines={1}>
        {value}
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  body: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 32, paddingTop: 8 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingTop: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.sunken },
  big: { letterSpacing: -2 },
  whoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8 },
  entry: { alignItems: 'center', paddingTop: 16, paddingBottom: 16, gap: 6 },
  pill: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    backgroundColor: colors.sunken,
    justifyContent: 'center',
  },
  labelField: {
    marginTop: 8,
    width: 290,
    maxWidth: '100%',
    height: 42,
    borderRadius: 21,
    paddingLeft: 14,
    paddingRight: 16,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  labelInput: {
    flex: 1,
    height: '100%',
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.ink,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  choiceOn: { backgroundColor: colors.chosen, borderColor: colors.chosen },
  choiceIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.tealSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radio: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.edge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { backgroundColor: colors.yellow, borderColor: colors.yellow },
  preview: {
    marginTop: 6,
    gap: 8,
    padding: 14,
    borderRadius: 20,
    backgroundColor: colors.sunken,
  },
  previewRow: { flexDirection: 'row', gap: 6 },
  previewDay: {
    flex: 1,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  previewFirst: { backgroundColor: colors.chosen },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 18,
    paddingHorizontal: 14,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  stepButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.chosen, borderColor: colors.chosen },
  cap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 20,
    backgroundColor: colors.tealSoft,
  },
  summary: { borderRadius: 28, backgroundColor: colors.fill, padding: 18, gap: 14 },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sentence: { letterSpacing: -0.6, lineHeight: 31 },
  mostChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: colors.yellow,
  },
  facts: {
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  fact: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
  },
  factRule: { borderBottomWidth: 1, borderColor: colors.sunken },
  warn: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 16,
    backgroundColor: colors.coralSoft,
  },
  problem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 16,
    backgroundColor: colors.coralSoft,
  },
  fine: { textAlign: 'center', lineHeight: 17 },
  done: { alignItems: 'center', paddingTop: 30 },
  doneLine: { textAlign: 'center', marginTop: 4, lineHeight: 25, paddingHorizontal: 10 },
  time: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: colors.fill,
  },
})
