import * as Haptics from 'expo-haptics'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { usePrefs } from '@/lib/prefs'
import { useStall } from '@/lib/stall'
import { useTerminal } from '@/lib/terminal'
import { colors, fonts } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Kovi, ShopBadge } from '@/ui/art'
import { Icon, type IconName } from '@/ui/Icon'
import { Bob } from '@/ui/motion'
import { Header, PillButton, Screen, Txt } from '@/ui/primitives'

const LENGTH = 6
const clean = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, LENGTH)

/**
 * Turns this phone into a shop's terminal. The owner opens the Kova dashboard, taps
 * "Add a terminal" and reads out (or shows the QR of) a six-character code; this phone
 * redeems it once for its own key. It can switch back to a wallet any time.
 */
export default function TerminalSetup() {
  const params = useLocalSearchParams<{ code?: string }>()
  const { setMode } = usePrefs()
  const { paired, pair } = useTerminal()
  const stall = useStall()
  const { profile } = useWallet()
  const [code, setCode] = useState(clean(params.code ?? ''))
  const [name, setName] = useState('Front counter')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const input = useRef<TextInput>(null)

  useEffect(() => {
    if (params.code) setCode(clean(params.code))
  }, [params.code])

  const start = () => {
    setMode('terminal')
    router.replace('/terminal')
  }

  const submit = async () => {
    setBusy(true)
    setProblem(null)
    try {
      await pair(code, name.trim() || 'Terminal')
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      start()
    } catch (error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setProblem(error instanceof Error ? error.message : 'That didn’t work. Try the code again.')
    } finally {
      setBusy(false)
    }
  }

  if (paired)
    return (
      <Screen bg={colors.paper}>
        <Header />
        <View style={styles.center}>
          <View style={styles.pairedArt}>
            <Bob>
              <ShopBadge size={132} />
            </Bob>
            <View style={styles.pairedKovi}>
              <Kovi pose="cheer" size={92} />
            </View>
          </View>
          <Txt
            weight="bold"
            size={32}
            style={{ marginTop: 18, letterSpacing: -1, textAlign: 'center' }}
          >
            {paired.name}
          </Txt>
          <Txt size={16} color={colors.muted} style={{ marginTop: 4 }}>
            Paired to {paired.merchantName}
          </Txt>
          <View style={styles.facts}>
            <Fact icon="tap" text={`Takes payments for ${paired.merchantName}`} />
            <Fact icon="check" text="Settles in dollars, in about a second" />
            <Fact
              icon="lock"
              text="Only this phone's key. Remove it from the dashboard any time"
              last
            />
          </View>
        </View>
        <View style={styles.footer}>
          <PillButton label="Open the terminal" icon="terminal" onPress={start} />
        </View>
      </Screen>
    )

  return (
    <Screen bg={colors.paper}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Header />
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.art}>
            <ShopBadge size={96} />
            <View style={styles.kovi}>
              <Kovi pose="wave" size={96} />
            </View>
          </View>
          {stall.owned ? (
            <View style={styles.own}>
              <Txt weight="semi" size={17}>
                {stall.owned.name} is yours
              </Txt>
              <Txt
                size={14}
                color={colors.muted}
                style={{ marginTop: 2, marginBottom: 12, lineHeight: 20 }}
              >
                This phone opened it. Make it the till again with one tap, no code needed.
              </Txt>
              <PillButton
                label={busy ? 'Pairing' : `Make it ${stall.owned.name}’s till`}
                icon="terminal"
                loading={busy}
                onPress={async () => {
                  setBusy(true)
                  setProblem(null)
                  try {
                    await stall.open({
                      name: stall.owned?.name ?? 'My stall',
                      phone: `${profile?.name.split(' ')[0] ?? 'My'}’s phone`,
                      settleTo: profile?.address ?? '',
                    })
                    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
                    start()
                  } catch (error) {
                    setProblem(
                      error instanceof Error ? error.message : 'That didn’t work. Try again.',
                    )
                  } finally {
                    setBusy(false)
                  }
                }}
              />
            </View>
          ) : (
            // No dashboard, no code: a shop opens straight from a Kova wallet, with this phone as its till.
            <View style={styles.own}>
              <Txt weight="semi" size={17}>
                No shop yet?
              </Txt>
              <Txt
                size={14}
                color={colors.muted}
                style={{ marginTop: 2, marginBottom: 12, lineHeight: 20 }}
              >
                {profile
                  ? 'Open one from your wallet in a minute. Payments land in your wallet, and this phone becomes the till.'
                  : 'Make a Kova wallet first: your shop’s money lands in it. Then open your shop from Home.'}
              </Txt>
              <PillButton
                label={profile ? 'Open my own shop' : 'Make my wallet'}
                icon={profile ? 'stall' : 'arrow'}
                onPress={() => router.push(profile ? '/open-stall' : '/setup')}
              />
            </View>
          )}
          <Txt weight="bold" size={32} style={{ letterSpacing: -1, lineHeight: 36 }}>
            Or pair with a shop
          </Txt>
          <Txt size={16} color={colors.muted} style={{ marginTop: 8, lineHeight: 23 }}>
            In your Kova dashboard, tap Add a terminal. Type the code it shows, or scan it.
          </Txt>

          {/* The code, as six boxes over one hidden input */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Pairing code"
            onPress={() => input.current?.focus()}
            style={styles.boxes}
          >
            {Array.from({ length: LENGTH }, (_, i) => {
              const ch = code[i] ?? ''
              const active = i === code.length
              return (
                <View
                  key={i}
                  style={[
                    styles.box,
                    ch ? styles.boxFilled : null,
                    active ? styles.boxActive : null,
                    i === 2 ? { marginRight: 12 } : null,
                  ]}
                >
                  <Txt weight="bold" size={26} color={ch ? colors.ink : colors.muted}>
                    {ch}
                  </Txt>
                </View>
              )
            })}
          </Pressable>
          <TextInput
            ref={input}
            value={code}
            onChangeText={(v) => {
              setCode(clean(v))
              setProblem(null)
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus={false}
            maxLength={LENGTH + 2}
            style={styles.hidden}
          />
          {problem ? (
            <Txt weight="medium" size={14} color={colors.danger} style={{ marginTop: 10 }}>
              {problem}
            </Txt>
          ) : null}

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/scan')}
            style={styles.scan}
          >
            <Icon name="scan" size={18} />
            <Txt weight="semi" size={15}>
              Scan the code instead
            </Txt>
          </Pressable>

          <Txt
            weight="semi"
            size={14}
            color={colors.muted}
            style={{ marginTop: 26, marginBottom: 8, marginLeft: 4 }}
          >
            Name this terminal
          </Txt>
          <TextInput
            value={name}
            onChangeText={setName}
            maxLength={40}
            placeholder="Front counter"
            placeholderTextColor="#8C9799"
            style={styles.name}
          />
        </ScrollView>
        <View style={styles.footer}>
          <PillButton
            label="Pair this phone"
            icon="terminal"
            disabled={code.length < LENGTH}
            loading={busy}
            onPress={submit}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  )
}

function Fact({ icon, text, last }: { icon: IconName; text: string; last?: boolean }) {
  return (
    <View style={[styles.fact, !last && styles.factRule]}>
      <View style={styles.factIcon}>
        <Icon name={icon} size={16} />
      </View>
      <Txt weight="medium" size={15} style={{ flex: 1 }}>
        {text}
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 24, paddingBottom: 24 },
  own: {
    marginBottom: 26,
    padding: 16,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.tealSoft,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  pairedArt: { width: 200, height: 150, alignItems: 'center', justifyContent: 'flex-end' },
  pairedKovi: { position: 'absolute', right: -6, top: -18 },
  facts: {
    alignSelf: 'stretch',
    marginTop: 28,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
  },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  factRule: { borderBottomWidth: 1, borderColor: colors.sunken },
  factIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.tealSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  art: { height: 120, justifyContent: 'center', marginBottom: 12 },
  kovi: { position: 'absolute', left: 64, top: 8 },
  boxes: { flexDirection: 'row', gap: 8, marginTop: 26 },
  box: {
    flex: 1,
    height: 56,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'rgba(11,26,29,0.18)',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxFilled: { borderColor: colors.ink },
  boxActive: { borderColor: colors.coral },
  hidden: { position: 'absolute', opacity: 0, height: 1, width: 1 },
  scan: {
    marginTop: 16,
    alignSelf: 'flex-start',
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: 'rgba(11,26,29,0.07)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    height: 50,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    paddingHorizontal: 18,
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.ink,
  },
  footer: { paddingHorizontal: 20, paddingBottom: 12, paddingTop: 8 },
})
