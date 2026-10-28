import { cardPinProblem } from '@kova/monad'
import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native'
import { isCancelled, type KovaCard, linkCard } from '@/lib/card'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { CardArt } from '@/ui/art'
import { Icon, type IconName } from '@/ui/Icon'
import { Bob, Ping, PopIn } from '@/ui/motion'
import { PinEntry } from '@/ui/PinEntry'
import { Header, PillButton, Rise, Screen, Txt } from '@/ui/primitives'

type Step = 'intro' | 'limit' | 'pin' | 'confirm' | 'tap' | 'done'
const order: Step[] = ['limit', 'pin', 'confirm', 'tap']
const LIMITS = ['50', '100', '200', '500']

/**
 * Linking a Kova Card: choose what it may spend in a day, choose a PIN, hold the card to the
 * phone, approve with Face ID. The card proves it's there by signing; the wallet approves the
 * link. Nothing leaves the wallet until the card is tapped at a till.
 */
export default function LinkCard() {
  const { profile, signTypedData } = useWallet()
  const { width } = useWindowDimensions()
  const [step, setStep] = useState<Step>('intro')
  const [limit, setLimit] = useState('100')
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [linked, setLinked] = useState<KovaCard | null>(null)

  const back = () => {
    setProblem(null)
    if (step === 'intro' || step === 'done') return router.back()
    const at = order.indexOf(step)
    setStep(at <= 0 ? 'intro' : (order[at - 1] as Step))
    if (step === 'confirm') setAgain('')
    if (step === 'pin') setPin('')
  }

  const steps =
    step === 'intro' || step === 'done' ? null : (
      <View
        accessibilityLabel={`Step ${order.indexOf(step) + 1} of ${order.length}`}
        style={styles.steps}
      >
        {order.map((s) => (
          <View key={s} style={[styles.step, s === step && styles.stepOn]} />
        ))}
      </View>
    )

  const choosePin = (next: string) => {
    setProblem(null)
    setPin(next)
    if (next.length === 4) {
      const issue = cardPinProblem(next)
      if (issue) {
        setProblem(issue)
        setPin('')
      } else setStep('confirm')
    }
  }

  const confirmPin = (next: string) => {
    setProblem(null)
    setAgain(next)
    if (next.length === pin.length) {
      if (next === pin) setStep('tap')
      else {
        setProblem('Those PINs don’t match. Choose it again.')
        setPin('')
        setAgain('')
        setStep('pin')
      }
    }
  }

  const link = async () => {
    if (!profile) return
    setBusy(true)
    setProblem(null)
    try {
      const card = await linkCard(
        { holder: profile.address, dailyLimit: limit, pin },
        signTypedData,
      )
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setLinked(card)
      setStep('done')
    } catch (error) {
      if (!isCancelled(error))
        setProblem(error instanceof Error ? error.message : 'That didn’t work. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (step === 'done' && linked)
    return (
      <Screen bg={colors.tealSoft}>
        <Header backIcon="close" onBack={() => router.back()} />
        <View style={styles.center}>
          <PopIn>
            <CardArt width={width - 64} last4={linked.last_four} />
          </PopIn>
        </View>
        <Rise style={styles.copy}>
          <Txt weight="semi" size={36} style={styles.title}>
            Your card is ready.
          </Txt>
          <Txt size={17} color={colors.onTint} style={styles.body}>
            Tap it at any Kova till. It can spend up to ${linked.daily_limit} a day from your
            wallet, and asks for your PIN over ${linked.no_pin_limit}.
          </Txt>
        </Rise>
        <View style={styles.footer}>
          <PillButton label="Done" icon="check" onPress={() => router.back()} />
        </View>
      </Screen>
    )

  if (step === 'tap')
    return (
      <Screen bg={colors.tealSoft}>
        <Header onBack={back} right={steps} />
        <View style={styles.center}>
          <View style={styles.phone}>
            <View style={styles.antenna}>
              <Ping size={120} color={colors.ink} />
            </View>
            <Bob duration={2600}>
              <View style={{ transform: [{ rotate: '-8deg' }] }}>
                <CardArt width={Math.min(width - 120, 260)} last4="••••" />
              </View>
            </Bob>
          </View>
        </View>
        <Rise style={styles.copy}>
          <Txt weight="semi" size={34} style={styles.title}>
            Hold your card to the top of your iPhone.
          </Txt>
          <Txt size={17} color={colors.onTint} style={styles.body}>
            Keep it there until the phone says it’s read, about a second. Then Face ID approves the
            link.
          </Txt>
          {problem ? (
            <Txt weight="medium" size={15} color={colors.danger} style={{ marginTop: 12 }}>
              {problem}
            </Txt>
          ) : null}
        </Rise>
        <View style={styles.footer}>
          <PillButton
            label={problem ? 'Try again' : 'Read my card'}
            icon="tap"
            loading={busy}
            onPress={link}
          />
        </View>
      </Screen>
    )

  if (step === 'pin' || step === 'confirm')
    return (
      <Screen bg={colors.paper}>
        <Header onBack={back} right={steps} />
        <Rise style={[styles.copy, { marginTop: 8 }]}>
          <Txt weight="semi" size={32} style={styles.title}>
            {step === 'pin' ? 'Choose a card PIN.' : 'Once more, to be sure.'}
          </Txt>
          <Txt size={16} color={colors.muted} style={styles.body}>
            {step === 'pin'
              ? 'Four digits. You’ll enter it at the till for anything over $25. Kova checks it; it never goes on the card.'
              : 'Enter the same four digits again.'}
          </Txt>
        </Rise>
        <View style={{ marginTop: 'auto', paddingBottom: 16 }}>
          <PinEntry
            value={step === 'pin' ? pin : again}
            onChange={step === 'pin' ? choosePin : confirmPin}
            length={4}
            max={4}
            error={problem}
          />
        </View>
      </Screen>
    )

  if (step === 'limit')
    return (
      <Screen bg={colors.paper}>
        <Header onBack={back} right={steps} />
        <Rise style={[styles.copy, { marginTop: 8 }]}>
          <Txt weight="semi" size={32} style={styles.title}>
            How much can it spend in a day?
          </Txt>
          <Txt size={16} color={colors.muted} style={styles.body}>
            The card pays from your wallet, never more than this a day. It’s checked on every
            payment, and nobody but you can raise it. You can change it whenever you like.
          </Txt>
        </Rise>
        <View style={styles.limits} accessibilityRole="radiogroup">
          {LIMITS.map((l) => {
            const on = l === limit
            return (
              <Pressable
                key={l}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`$${l} a day`}
                onPress={() => {
                  void Haptics.selectionAsync()
                  setLimit(l)
                }}
                style={[styles.limit, on && styles.limitOn]}
              >
                <Txt
                  weight="bold"
                  size={30}
                  color={on ? colors.white : colors.ink}
                  style={{ letterSpacing: -1 }}
                >
                  ${l}
                </Txt>
                <Txt size={14} color={on ? colors.white : colors.muted}>
                  a day
                </Txt>
              </Pressable>
            )
          })}
        </View>
        <View style={styles.footer}>
          <PillButton label="Continue" onPress={() => setStep('pin')} />
        </View>
      </Screen>
    )

  return (
    <Screen bg={colors.tealSoft}>
      <Header backIcon="close" onBack={() => router.back()} />
      <View style={styles.center}>
        <Bob duration={3200}>
          <CardArt width={width - 64} last4="••••" />
        </Bob>
      </View>
      <Rise style={styles.copy}>
        <Txt weight="semi" size={36} style={styles.title}>
          Link your Kova Card.
        </Txt>
        <View style={{ gap: 12, marginTop: 14 }}>
          <Fact
            icon="tap"
            text="Tap it at a Kova till to pay. No phone, no data, no signal needed."
          />
          <Fact icon="card" text="It spends straight from your wallet. Nothing to top up." />
          <Fact
            icon="lock"
            text="A PIN over $25, a daily limit you choose, and a freeze that works at once."
          />
        </View>
      </Rise>
      <View style={styles.footer}>
        <PillButton label="Link my card" onPress={() => setStep('limit')} />
      </View>
    </Screen>
  )
}

function Fact({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.fact}>
      <View style={styles.factIcon}>
        <Icon name={icon} size={18} />
      </View>
      <Txt size={16} style={{ flex: 1, lineHeight: 22 }}>
        {text}
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  copy: { paddingHorizontal: 24 },
  title: { letterSpacing: -1.2, lineHeight: 40 },
  body: { marginTop: 10, lineHeight: 24 },
  footer: { paddingHorizontal: 20, paddingBottom: 16, paddingTop: 16 },
  steps: { flexDirection: 'row', gap: 6 },
  step: { width: 18, height: 6, borderRadius: 3, backgroundColor: colors.sunken },
  stepOn: { width: 28, backgroundColor: colors.ink },
  limits: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 20, marginTop: 28 },
  limit: {
    width: '47%',
    flexGrow: 1,
    height: 104,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  limitOn: { backgroundColor: colors.ink },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  factIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phone: { alignItems: 'center', justifyContent: 'center' },
  antenna: { position: 'absolute', top: -40 },
})
