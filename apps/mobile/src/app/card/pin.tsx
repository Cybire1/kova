import { cardPinProblem } from '@kova/monad'
import * as Haptics from 'expo-haptics'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { changePin, type KovaCard, listCards } from '@/lib/card'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Kovi } from '@/ui/art'
import { PinEntry } from '@/ui/PinEntry'
import { Header, PillButton, Rise, Screen, Txt } from '@/ui/primitives'

/** A new PIN for a card: twice, then Face ID approves it. The old PIN stops working at once. */
export default function ChangePin() {
  const { address } = useLocalSearchParams<{ address: string }>()
  const { profile, signMessage } = useWallet()
  const [card, setCard] = useState<KovaCard | null>(null)
  const [step, setStep] = useState<'new' | 'confirm' | 'saving' | 'done'>('new')
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (!profile) return
    void listCards(profile.address)
      .then((list) =>
        setCard(list.data.find((c) => c.address.toLowerCase() === address?.toLowerCase()) ?? null),
      )
      .catch(() => setProblem('Kova is unreachable. Try again in a moment.'))
  }, [profile, address])

  const save = async (next: string) => {
    if (!card) return
    setStep('saving')
    try {
      await changePin(card, next, signMessage)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setStep('done')
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That didn’t work. Try again.')
      setPin('')
      setAgain('')
      setStep('new')
    }
  }

  if (step === 'done')
    return (
      <Screen bg={colors.tealSoft}>
        <Header backIcon="close" onBack={() => router.back()} />
        <View style={styles.center}>
          <Kovi pose="cheer" size={170} />
        </View>
        <Rise style={styles.copy}>
          <Txt weight="semi" size={34} style={styles.title}>
            New PIN set.
          </Txt>
          <Txt size={17} color={colors.onTint} style={styles.body}>
            Use it at the till from now on. The old one no longer works.
          </Txt>
        </Rise>
        <View style={styles.footer}>
          <PillButton label="Done" icon="check" onPress={() => router.back()} />
        </View>
      </Screen>
    )

  return (
    <Screen bg={colors.paper}>
      <Header
        title={card ? `Card •••• ${card.last_four}` : 'Card PIN'}
        backIcon="close"
        onBack={() => router.back()}
      />
      <Rise style={[styles.copy, { marginTop: 8 }]}>
        <Txt weight="semi" size={32} style={styles.title}>
          {step === 'confirm' ? 'Once more, to be sure.' : 'Choose a new PIN.'}
        </Txt>
        <Txt size={16} color={colors.muted} style={styles.body}>
          {step === 'confirm'
            ? 'Enter the same four digits again.'
            : 'Four digits, not a run and not one digit repeated.'}
        </Txt>
      </Rise>
      <View style={{ marginTop: 'auto', paddingBottom: 16 }}>
        {step === 'saving' || !card ? (
          <View style={{ height: 380, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            {problem && !card ? (
              <Txt color={colors.danger}>{problem}</Txt>
            ) : (
              <ActivityIndicator color={colors.ink} />
            )}
          </View>
        ) : (
          <PinEntry
            value={step === 'new' ? pin : again}
            length={4}
            max={4}
            error={problem}
            onChange={(next) => {
              setProblem(null)
              if (step === 'new') {
                setPin(next)
                if (next.length === 4) {
                  const issue = cardPinProblem(next)
                  if (issue) {
                    setProblem(issue)
                    setPin('')
                  } else setStep('confirm')
                }
              } else {
                setAgain(next)
                if (next.length === 4) {
                  if (next === pin) void save(next)
                  else {
                    setProblem('Those PINs don’t match. Choose it again.')
                    setPin('')
                    setAgain('')
                    setStep('new')
                  }
                }
              }
            }}
          />
        )}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  copy: { paddingHorizontal: 24 },
  title: { letterSpacing: -1.2, lineHeight: 40 },
  body: { marginTop: 10, lineHeight: 24 },
  footer: { paddingHorizontal: 20, paddingBottom: 16, paddingTop: 16 },
})
