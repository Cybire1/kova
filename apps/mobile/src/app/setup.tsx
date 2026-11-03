import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native'
import { type DisplayCurrency, guessCurrency } from '@/lib/money'
import { colors, pair } from '@/lib/theme'
import { useUnlock } from '@/lib/unlock'
import { useWallet } from '@/lib/wallet'
import { KeyScene } from '@/ui/art'
import { Bob } from '@/ui/motion'
import { ProfileForm } from '@/ui/ProfileForm'
import { Header, PillButton, Rise, Screen, Txt } from '@/ui/primitives'

/**
 * Two steps: who you are, then one Face ID (or fingerprint) makes your wallet. Under the hood it is
 * a passkey; the screen says what the person does, and warns that the phone will ask to save one.
 */
export default function Setup() {
  const { create } = useWallet()
  const unlock = useUnlock()
  // Development only: `?step=2` opens the second step, for screenshots.
  const dev = useLocalSearchParams<{ step?: string }>()
  const [step, setStep] = useState<1 | 2>(__DEV__ && dev.step === '2' ? 2 : 1)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState<DisplayCurrency>(guessCurrency)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const finish = async () => {
    setBusy(true)
    setProblem(null)
    try {
      await create(name, currency)
      router.replace('/(tabs)')
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const steps = (
    <View accessibilityLabel={`Step ${step} of 2`} style={styles.steps}>
      <View style={[styles.step, step === 1 && styles.stepOn]} />
      <View style={[styles.step, step === 2 && styles.stepOn]} />
    </View>
  )

  if (step === 2)
    return (
      <Screen bg={colors.tealSoft}>
        <Header onBack={() => setStep(1)} right={steps} />
        <View style={styles.center}>
          <Bob duration={3000}>
            <KeyScene size={320} />
          </Bob>
        </View>
        <Rise style={styles.copy}>
          <Txt weight="semi" size={38} style={styles.title}>
            {unlock.gesture} opens your wallet.
          </Txt>
          <Txt size={17} color={colors.onTint} style={styles.body}>
            Kova locks it with {unlock.your}, and {unlock.keychain} keeps it, so it comes back on
            your next phone too. No password, no seed phrase, nothing for Kova to hold.
          </Txt>
          <Txt weight="semi" size={14} color={colors.onTint} style={styles.hint}>
            Your phone will ask to save a passkey for Kova. Tap Continue.
          </Txt>
          {problem ? (
            <Txt weight="medium" size={15} color={colors.danger} style={{ marginTop: 12 }}>
              {problem}
            </Txt>
          ) : null}
        </Rise>
        <View style={styles.footer}>
          <PillButton label="Create my wallet" icon={unlock.icon} loading={busy} onPress={finish} />
        </View>
      </Screen>
    )

  return (
    <Screen bg={colors.paper}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Header right={steps} />
        <ProfileForm
          heading={'What should people\ncall you?'}
          note="This is how you show up when you pay someone or ask them for money."
          name={name}
          onName={setName}
          currency={currency}
          onCurrency={setCurrency}
          onSubmit={() => name.trim().length >= 2 && setStep(2)}
        />
        <View style={styles.footer}>
          <PillButton
            label="Continue"
            disabled={name.trim().length < 2}
            onPress={() => setStep(2)}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  steps: { flexDirection: 'row', gap: 6, marginRight: 4 },
  step: {
    width: 18,
    height: 8,
    borderRadius: 4,
    backgroundColor: pair('rgba(13,13,18,0.2)', 'rgba(236,232,223,0.2)'),
  },
  stepOn: { width: 36, backgroundColor: colors.chosen },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  copy: { paddingHorizontal: 28, paddingBottom: 12 },
  title: { letterSpacing: -1, lineHeight: 40 },
  body: { lineHeight: 25, marginTop: 12 },
  hint: { marginTop: 14, opacity: 0.85 },
  footer: { paddingHorizontal: 20, paddingBottom: 12, paddingTop: 8 },
})
