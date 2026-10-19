import { router } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native'
import { isTestnet } from '@/lib/config'
import { type DisplayCurrency, guessCurrency } from '@/lib/money'
import { useStall } from '@/lib/stall'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { KeyScene } from '@/ui/art'
import { GoogleSignInButton } from '@/ui/GoogleSignInButton'
import { Bob } from '@/ui/motion'
import { ProfileForm } from '@/ui/ProfileForm'
import { Header, PillButton, Rise, Screen, TextLink, Txt } from '@/ui/primitives'

/**
 * A wallet coming back: on a new phone, or this one after it was removed. The passkey from
 * iCloud Keychain is all it takes; the same wallet, with its money, opens after one Face ID.
 */
export default function Restore() {
  const { restore, setName, setCurrency, balance, googleBusy, googleEnabled } = useWallet()
  const stall = useStall()
  const [step, setStep] = useState<'passkey' | 'name'>('passkey')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [name, setNameText] = useState('')
  const [currency, setCurrencyChoice] = useState<DisplayCurrency>(guessCurrency)

  const usePasskey = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const profile = await restore()
      // A shop this wallet owns comes back too, in the background: the wallet opens either way.
      void stall.recover().catch(() => {})
      if (profile.name) router.replace('/(tabs)')
      else setStep('name')
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The passkey didn’t open. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const finish = async () => {
    await setName(name)
    await setCurrency(currency)
    router.replace('/(tabs)')
  }

  if (step === 'name')
    return (
      <Screen bg={colors.paper}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Header />
          <ProfileForm
            heading="Your wallet is back."
            note="Give it the name people see when you pay them or ask them for money."
            name={name}
            onName={setNameText}
            currency={currency}
            onCurrency={setCurrencyChoice}
            onSubmit={() => name.trim().length >= 2 && void finish()}
            balance={balance}
          />
          <View style={styles.footer}>
            <PillButton label="Open my wallet" disabled={name.trim().length < 2} onPress={finish} />
          </View>
        </KeyboardAvoidingView>
      </Screen>
    )

  return (
    <Screen bg={colors.tealSoft}>
      <Header />
      <View style={styles.center}>
        <Bob duration={3000}>
          <KeyScene size={320} />
        </Bob>
      </View>
      <Rise style={styles.copy}>
        <Txt weight="semi" size={38} style={styles.title}>
          Welcome back.
        </Txt>
        <Txt size={17} color={colors.onTint} style={styles.body}>
          {googleEnabled
            ? 'Sign in the same way you opened your wallet: with Google, or with your saved Kova passkey.'
            : 'Use your saved Kova passkey. iCloud Keychain brings it to this phone, and your wallet comes with it.'}
        </Txt>
        {problem ? (
          <Txt weight="medium" size={15} color={colors.danger} style={{ marginTop: 12 }}>
            {problem}
          </Txt>
        ) : null}
      </Rise>
      <View style={styles.footer}>
        <View style={{ marginBottom: 12 }}>
          <GoogleSignInButton />
        </View>
        <PillButton
          label="Use my passkey"
          icon="face"
          loading={busy}
          disabled={googleBusy}
          onPress={usePasskey}
        />
        {isTestnet ? (
          <View style={{ alignItems: 'center', marginTop: 14 }}>
            <TextLink label="Sign in with a demo account" onPress={() => router.push('/demo')} />
          </View>
        ) : null}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  copy: { paddingHorizontal: 28, paddingBottom: 12 },
  title: { letterSpacing: -1, lineHeight: 40 },
  body: { lineHeight: 25, marginTop: 12 },
  footer: { paddingHorizontal: 20, paddingBottom: 12, paddingTop: 8 },
})
