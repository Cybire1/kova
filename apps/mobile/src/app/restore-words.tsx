import { router } from 'expo-router'
import { useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { type DisplayCurrency, guessCurrency } from '@/lib/money'
import { WORD_COUNT } from '@/lib/recovery'
import { useStall } from '@/lib/stall'
import { colors, fonts, pair } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Icon } from '@/ui/Icon'
import { ProfileForm } from '@/ui/ProfileForm'
import { Header, PillButton, Screen, Txt } from '@/ui/primitives'

/**
 * A wallet back from its 24 recovery words, when the passkey is gone: the same wallet and its money,
 * kept on this phone behind Face ID. The words never leave the phone.
 */
export default function RestoreWithWords() {
  const { restoreWithWords, setName, setCurrency, balance } = useWallet()
  const stall = useStall()
  const [step, setStep] = useState<'words' | 'name'>('words')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [name, setNameText] = useState('')
  const [currency, setCurrencyChoice] = useState<DisplayCurrency>(guessCurrency)
  const count = text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean).length

  const go = async () => {
    setBusy(true)
    setProblem(null)
    try {
      await restoreWithWords(text)
      setText('')
      void stall.recover().catch(() => {})
      setStep('name')
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Those words didn’t open a wallet. Try again.')
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
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Header title="Recovery words" />
        <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
          <Txt weight="bold" size={30} style={{ letterSpacing: -1, lineHeight: 34 }}>
            Type your 24 words.
          </Txt>
          <Txt size={16} color={colors.muted} style={{ marginTop: 10, lineHeight: 23 }}>
            In order, with spaces between them. Your wallet and its money come back to this phone.
          </Txt>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            textAlignVertical="top"
            accessibilityLabel="Your recovery words"
            placeholder="word word word …"
            placeholderTextColor={pair('rgba(31,52,56,0.38)', 'rgba(233,229,221,0.38)')}
            style={styles.input}
          />
          <Txt
            weight="semi"
            size={13}
            color={count === WORD_COUNT ? colors.positive : colors.muted}
            style={{ marginTop: 8, textAlign: 'right' }}
          >
            {count} of {WORD_COUNT}
          </Txt>
          {problem ? (
            <Txt weight="medium" size={14} color={colors.danger} style={{ marginTop: 8 }}>
              {problem}
            </Txt>
          ) : null}
          <View style={styles.note}>
            <Icon name="lock" size={15} color={colors.teal} />
            <Txt size={13} color={colors.muted} style={{ flex: 1, lineHeight: 19 }}>
              Your words stay on this phone. Kova never sees them.
            </Txt>
          </View>
          <View style={{ marginTop: 18 }}>
            <PillButton
              label="Restore my wallet"
              icon="face"
              loading={busy}
              disabled={count !== WORD_COUNT}
              onPress={() => void go()}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 },
  input: {
    marginTop: 20,
    minHeight: 168,
    padding: 16,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontFamily: fonts.semi,
    fontSize: 17,
    lineHeight: 26,
  },
  note: { flexDirection: 'row', gap: 10, marginTop: 14 },
  footer: { paddingHorizontal: 20, paddingBottom: 12, paddingTop: 8 },
})
