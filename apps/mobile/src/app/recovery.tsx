import * as Haptics from 'expo-haptics'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { checkPositions } from '@/lib/recovery'
import { colors, fonts, pair } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Icon, type IconName } from '@/ui/Icon'
import { Header, PillButton, Screen, TextLink, Txt } from '@/ui/primitives'

type Step = 'intro' | 'words' | 'check' | 'done'

/**
 * Recovery words: the wallet's 24 words, shown after Face ID, written on paper, then two of them
 * asked back. They bring the same wallet back on any phone if the passkey is ever lost. The words
 * live only in this screen's memory while it's open; Kova never stores or sends them.
 */
export default function RecoveryWords() {
  const { revealWords, markWordsSaved, profile } = useWallet()
  const [step, setStep] = useState<Step>('intro')
  const [words, setWords] = useState<string[]>([])
  const [ask, setAsk] = useState<[number, number]>(checkPositions)
  const [answers, setAnswers] = useState(['', ''])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // Development only: `?step=words` or `?step=check` opens that step, for screenshots.
  const { step: preview } = useLocalSearchParams<{ step?: string }>()

  const show = async (then: Step = 'words') => {
    setBusy(true)
    setProblem(null)
    try {
      setWords(await revealWords())
      setStep(then)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Your words didn’t open. Try again.')
    } finally {
      setBusy(false)
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: once, for a development preview
  useEffect(() => {
    if (__DEV__ && (preview === 'words' || preview === 'check')) void show(preview)
  }, [])

  const check = async () => {
    const wrong = ask.findIndex((at, i) => answers[i]?.trim().toLowerCase() !== words[at])
    if (wrong !== -1) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setProblem(`That isn’t word ${(ask[wrong] as number) + 1}. Look at your paper again.`)
      return
    }
    await markWordsSaved()
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setWords([])
    setProblem(null)
    setStep('done')
  }

  if (step === 'words')
    return (
      <Screen>
        <Header title="Your recovery words" onBack={() => (setWords([]), setStep('intro'))} />
        <ScrollView contentContainerStyle={styles.pad}>
          <Txt size={15} color={colors.muted} style={{ lineHeight: 22 }}>
            Write all 24 on paper, in this order. Don’t take a screenshot.
          </Txt>
          <View style={styles.grid}>
            {words.map((word, i) => (
              <View key={`${i}-${word}`} style={styles.word}>
                <Txt weight="semi" size={13} color={colors.muted} style={styles.number}>
                  {i + 1}
                </Txt>
                <Txt weight="bold" size={17}>
                  {word}
                </Txt>
              </View>
            ))}
          </View>
          <View style={styles.warn}>
            <Icon name="lock" size={16} color={colors.danger} />
            <Txt size={13} color={colors.ink} style={{ flex: 1, lineHeight: 19 }}>
              Anyone with these words can take your money. Kova will never ask for them.
            </Txt>
          </View>
          <View style={{ marginTop: 18 }}>
            <PillButton
              label="I wrote them down"
              icon="check"
              onPress={() => {
                setAsk(checkPositions())
                setAnswers(['', ''])
                setProblem(null)
                setStep('check')
              }}
            />
          </View>
        </ScrollView>
      </Screen>
    )

  if (step === 'check')
    return (
      <Screen>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Header title="Check your words" onBack={() => setStep('words')} />
          <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
            <Txt size={15} color={colors.muted} style={{ lineHeight: 22 }}>
              From your paper, type these two words.
            </Txt>
            {ask.map((at, i) => (
              <View key={at} style={styles.field}>
                <Txt weight="semi" size={13} color={colors.muted}>
                  Word {at + 1}
                </Txt>
                <TextInput
                  value={answers[i]}
                  onChangeText={(text) =>
                    setAnswers((prev) => prev.map((a, j) => (j === i ? text : a)))
                  }
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus={i === 0}
                  returnKeyType={i === 0 ? 'next' : 'done'}
                  accessibilityLabel={`Word ${at + 1}`}
                  placeholder="word"
                  placeholderTextColor={pair('rgba(31,52,56,0.38)', 'rgba(233,229,221,0.38)')}
                  style={styles.input}
                />
              </View>
            ))}
            {problem ? (
              <Txt weight="medium" size={14} color={colors.danger} style={{ marginTop: 12 }}>
                {problem}
              </Txt>
            ) : null}
            <View style={{ marginTop: 20 }}>
              <PillButton
                label="Check"
                disabled={answers.some((a) => !a.trim())}
                onPress={() => void check()}
              />
            </View>
            <View style={{ alignItems: 'center', marginTop: 14 }}>
              <TextLink label="Show my words again" onPress={() => setStep('words')} />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Screen>
    )

  if (step === 'done')
    return (
      <Screen>
        <Header title="" />
        <View style={styles.doneBody}>
          <View style={styles.doneMark}>
            <Icon name="check" size={34} color={colors.white} />
          </View>
          <Txt weight="bold" size={30} style={{ letterSpacing: -1, textAlign: 'center' }}>
            Your words are saved.
          </Txt>
          <Txt size={16} color={colors.muted} style={styles.doneText}>
            Keep the paper somewhere safe. If you lose your phone or can’t sign in, choose “I
            already have Kova”, then “Use recovery words”.
          </Txt>
        </View>
        <View style={styles.footer}>
          <PillButton label="Done" onPress={() => router.back()} />
        </View>
      </Screen>
    )

  return (
    <Screen>
      <Header title="Recovery words" />
      <ScrollView contentContainerStyle={styles.pad}>
        <Txt weight="bold" size={30} style={{ letterSpacing: -1, lineHeight: 34 }}>
          {profile?.wordsSaved ? 'Your words are saved.' : 'Save your recovery words.'}
        </Txt>
        <Txt size={16} color={colors.muted} style={{ marginTop: 10, lineHeight: 23 }}>
          24 words that bring your wallet back if you ever lose your phone or can’t sign in. Without
          them, nobody can get it back for you, not even Kova.
        </Txt>
        <View style={styles.rules}>
          <Rule icon="pen" text="Write them on paper, in order." />
          <Rule
            icon="lock"
            text="Anyone with them can take your money. Kova will never ask for them."
          />
          <Rule icon="close" text="Don’t screenshot them or keep them in your notes or email." />
        </View>
        {problem ? (
          <Txt weight="medium" size={14} color={colors.danger} style={{ marginTop: 14 }}>
            {problem}
          </Txt>
        ) : null}
        <View style={{ marginTop: 22 }}>
          <PillButton
            label={profile?.wordsSaved ? 'Show my words again' : 'Show my words'}
            icon="face"
            loading={busy}
            onPress={() => void show()}
          />
        </View>
      </ScrollView>
    </Screen>
  )
}

function Rule({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.rule}>
      <View style={styles.ruleIcon}>
        <Icon name={icon} size={16} />
      </View>
      <Txt size={15} style={{ flex: 1, lineHeight: 21 }}>
        {text}
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  word: {
    width: '48.6%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  number: { width: 20, textAlign: 'right' },
  warn: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.sunken,
  },
  field: { marginTop: 16, gap: 6 },
  input: {
    height: 52,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontFamily: fonts.semi,
    fontSize: 17,
  },
  rules: {
    marginTop: 20,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingVertical: 6,
  },
  rule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  ruleIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 12,
  },
  doneMark: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.positive,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  doneText: { textAlign: 'center', lineHeight: 23 },
  footer: { paddingHorizontal: 20, paddingBottom: 12 },
})
