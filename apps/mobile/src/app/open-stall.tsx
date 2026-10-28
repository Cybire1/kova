import * as Haptics from 'expo-haptics'
import { Redirect, router } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { usePrefs } from '@/lib/prefs'
import { type OpenStep, useStall } from '@/lib/stall'
import { useTerminal } from '@/lib/terminal'
import { colors, fonts } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Awning } from '@/ui/Awning'
import { Kovi, koviFeet } from '@/ui/art'
import { Icon, type IconName } from '@/ui/Icon'
import { Hop } from '@/ui/motion'
import { PillButton, RoundButton, Screen, Txt } from '@/ui/primitives'

/** Room above the sign for Kovi to stand on its roof. */
const ROOF = 92

const steps: Record<OpenStep, string> = {
  shop: 'Opening your shop',
  stall: 'Putting up your stall',
  till: 'Making this phone the till',
  done: 'Open',
}

/**
 * Open a stall from your wallet: name it, and Kova opens a shop that pays into this wallet,
 * puts up its stall, and makes this phone the till. The sign on top is painted as you type.
 */
export default function OpenStall() {
  const { width } = useWindowDimensions()
  const { profile } = useWallet()
  const terminal = useTerminal()
  const { owned, complete, open } = useStall()
  const { setMode } = usePrefs()
  const [name, setName] = useState(owned?.name ?? '')
  const [tagline, setTagline] = useState('')
  const [step, setStep] = useState<OpenStep | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  // Already runs a shop from this phone: go to it. Half set up (a dropped connection, or the
  // phone unpaired as its till), stay here and finish.
  const already = complete && !step
  useEffect(() => {
    if (!already) return
    setMode('terminal')
    if (router.canDismiss()) router.dismissAll()
    router.replace('/terminal/stall')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [already])

  if (already) return <View style={{ flex: 1, backgroundColor: colors.paper }} />
  if (!profile) return <Redirect href="/welcome" />

  const phone = `${profile.name.split(' ')[0]}’s phone`
  const elsewhere =
    terminal.paired && terminal.paired.merchantId !== owned?.merchantId ? terminal.paired : null
  const valid = name.trim().length >= 2
  const sign = width - 40

  const submit = async () => {
    setProblem(null)
    try {
      await open({ name: name.trim(), tagline, phone, settleTo: profile.address }, setStep)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setMode('terminal')
      // Leave the wallet behind entirely, so a swipe back can't land on it.
      if (router.canDismiss()) router.dismissAll()
      router.replace('/terminal/stall')
    } catch (error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setProblem(error instanceof Error ? error.message : 'That didn’t work. Try again.')
      setStep(null)
    }
  }

  return (
    <Screen bg={colors.paper}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {/* The sign, painted as you type, with Kovi up on its roof */}
          <View style={styles.signWrap}>
            <View style={styles.close}>
              <RoundButton
                icon="close"
                label="Close"
                onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
              />
            </View>
            <View style={[styles.sign, { width: sign }]}>
              <Awning width={sign} height={58} stripe={sign / 12} />
              <View style={styles.board}>
                <Txt
                  weight="bold"
                  size={26}
                  numberOfLines={2}
                  style={{
                    letterSpacing: -0.8,
                    textAlign: 'center',
                    color: name.trim() ? colors.ink : '#8C9799',
                  }}
                >
                  {name.trim() || 'Your stall'}
                </Txt>
                <Txt
                  size={14}
                  color={colors.muted}
                  numberOfLines={2}
                  style={{ textAlign: 'center', marginTop: 2 }}
                >
                  {tagline.trim() || 'Scan to order. Pay in dollars.'}
                </Txt>
              </View>
            </View>
            <Hop style={[styles.kovi, { top: ROOF + 1 - 96 * koviFeet('wave') }]}>
              <Kovi pose="wave" size={96} />
            </Hop>
          </View>

          <Txt weight="bold" size={32} style={{ letterSpacing: -1, marginTop: 22 }}>
            {owned ? 'Finish opening your stall' : 'Open a stall'}
          </Txt>
          <Txt size={16} color={colors.muted} style={{ marginTop: 6, lineHeight: 23 }}>
            Your menu on a link. People order from their own phones, from anywhere, and pay you in
            dollars.
          </Txt>

          <Txt weight="semi" size={14} color={colors.muted} style={styles.label}>
            Stall name
          </Txt>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Ada’s Bakery"
            placeholderTextColor="#8C9799"
            autoCapitalize="words"
            maxLength={60}
            editable={!step}
            style={styles.input}
          />
          <Txt weight="semi" size={14} color={colors.muted} style={styles.label}>
            A line about it{' '}
            <Txt size={13} color="#8C9799">
              optional
            </Txt>
          </Txt>
          <TextInput
            value={tagline}
            onChangeText={setTagline}
            placeholder="Fresh bread and coffee, round the corner"
            placeholderTextColor="#8C9799"
            maxLength={120}
            editable={!step}
            style={styles.input}
          />

          <View style={styles.facts}>
            <Fact
              icon="receive"
              text="Payments land in your wallet"
              hint={`${profile.address.slice(0, 6)}…${profile.address.slice(-4)}, in dollars`}
            />
            <Fact icon="terminal" text="This phone becomes its till" hint={`Named “${phone}”`} />
            <Fact icon="tag" text="No card fees" hint="And nothing to pay monthly" last />
          </View>

          {elsewhere ? (
            <View style={styles.notice}>
              <Icon name="info" size={18} />
              <Txt size={14} style={{ flex: 1, lineHeight: 20 }}>
                This phone is {elsewhere.name} at {elsewhere.merchantName}. Opening your own stall
                unpairs it from there.
              </Txt>
            </View>
          ) : null}
        </ScrollView>
        <View style={styles.footer}>
          {problem ? (
            <Txt
              weight="medium"
              size={14}
              color={colors.danger}
              style={{ marginBottom: 10, textAlign: 'center' }}
            >
              {problem}
            </Txt>
          ) : null}
          <PillButton
            label={step ? steps[step] : owned ? 'Finish setting up' : 'Open my stall'}
            icon="stall"
            disabled={!valid}
            loading={Boolean(step)}
            onPress={submit}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  )
}

function Fact({
  icon,
  text,
  hint,
  last,
}: {
  icon: IconName
  text: string
  hint: string
  last?: boolean
}) {
  return (
    <View style={[styles.fact, !last && styles.factRule]}>
      <View style={styles.factIcon}>
        <Icon name={icon} size={16} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt weight="semi" size={15}>
          {text}
        </Txt>
        <Txt size={13} color={colors.muted}>
          {hint}
        </Txt>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 24 },
  signWrap: { paddingTop: ROOF },
  close: { position: 'absolute', left: 0, top: 8 },
  sign: {
    borderRadius: 26,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  board: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 18,
    minHeight: 92,
    justifyContent: 'center',
  },
  kovi: { position: 'absolute', right: 18 },
  label: { marginTop: 20, marginBottom: 8, marginLeft: 4 },
  input: {
    height: 50,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: 18,
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.ink,
  },
  facts: {
    marginTop: 22,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
  },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  factRule: { borderBottomWidth: 1, borderColor: colors.sunken },
  factIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.tealSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    padding: 14,
    borderRadius: 20,
    backgroundColor: colors.coralSoft,
  },
  footer: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
})
