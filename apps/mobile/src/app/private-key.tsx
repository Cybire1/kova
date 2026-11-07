import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { useEffect, useRef, useState } from 'react'
import { AppState, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Icon, type IconName } from '@/ui/Icon'
import { Header, PillButton, Screen, Txt } from '@/ui/primitives'

/** How long a copied key stays on the clipboard. */
const CLEAR_AFTER = 60

/**
 * Export the private key: the same wallet in another app (MetaMask, Rabby, Phantom…). Shown after
 * Face ID, kept only in this screen's memory, and hidden the moment Kova leaves the screen. A copy
 * is wiped from the clipboard after a minute. Passkey and recovery-word wallets only; a Google
 * wallet's key lives with Privy, which doesn't hand it out in the app.
 */
export default function PrivateKey() {
  const { revealPrivateKey, hasWords } = useWallet()
  const [key, setKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [copiedFor, setCopiedFor] = useState(0)
  const clearTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Leaving Kova, even for a second, hides the key.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') setKey(null)
    })
    return () => sub.remove()
  }, [])

  // On the way out, the key goes with the screen; a copy still on the clipboard is cleared now.
  useEffect(
    () => () => {
      if (clearTimer.current) {
        clearInterval(clearTimer.current)
        void Clipboard.setStringAsync('')
      }
    },
    [],
  )

  const show = async () => {
    setBusy(true)
    setProblem(null)
    try {
      setKey(await revealPrivateKey())
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Your key didn’t open. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!key) return
    await Clipboard.setStringAsync(key)
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    if (clearTimer.current) clearInterval(clearTimer.current)
    setCopiedFor(CLEAR_AFTER)
    clearTimer.current = setInterval(() => {
      setCopiedFor((left) => {
        if (left > 1) return left - 1
        if (clearTimer.current) clearInterval(clearTimer.current)
        clearTimer.current = null
        void Clipboard.setStringAsync('')
        return 0
      })
    }, 1000)
  }

  if (!hasWords)
    return (
      <Screen>
        <Header title="Private key" />
        <View style={styles.pad}>
          <Txt weight="bold" size={28} style={styles.title}>
            This wallet’s key stays with Google sign-in.
          </Txt>
          <Txt size={16} color={colors.muted} style={styles.lead}>
            Wallets opened with Google are kept by Privy, and the app can’t show their key. To use
            your dollars elsewhere, send them to that wallet’s address.
          </Txt>
        </View>
      </Screen>
    )

  if (key)
    return (
      <Screen>
        <Header title="Your private key" onBack={() => setKey(null)} />
        <ScrollView contentContainerStyle={styles.pad}>
          <Txt size={15} color={colors.muted} style={{ lineHeight: 22 }}>
            Paste it into another wallet app to open this same wallet there. Don’t share it or take
            a screenshot.
          </Txt>
          <View style={styles.keyBox}>
            <Txt
              selectable
              weight="semi"
              size={17}
              style={styles.keyText}
              accessibilityLabel="Your private key"
            >
              {key}
            </Txt>
          </View>
          <View style={styles.warn}>
            <Icon name="lock" size={16} color={colors.danger} />
            <Txt size={13} color={colors.ink} style={{ flex: 1, lineHeight: 19 }}>
              Anyone with this key can take your money. Kova will never ask for it.
            </Txt>
          </View>
          <View style={{ marginTop: 18, gap: 10 }}>
            <PillButton
              label={copiedFor > 0 ? `Copied · cleared in ${copiedFor}s` : 'Copy key'}
              icon={copiedFor > 0 ? 'check' : 'copy'}
              onPress={() => void copy()}
            />
            <PillButton label="Hide it" icon="eyeOff" tone="white" onPress={() => setKey(null)} />
          </View>
        </ScrollView>
      </Screen>
    )

  return (
    <Screen>
      <Header title="Private key" />
      <ScrollView contentContainerStyle={styles.pad}>
        <Txt weight="bold" size={30} style={styles.title}>
          Take your wallet to another app.
        </Txt>
        <Txt size={16} color={colors.muted} style={styles.lead}>
          Your private key opens this same wallet in apps like MetaMask, Rabby or Phantom. Your
          dollars don’t move: it’s one wallet, open in two places.
        </Txt>
        <View style={styles.rules}>
          <Rule
            icon="lock"
            text="Anyone with it can take your money. Kova will never ask for it."
          />
          <Rule icon="close" text="Don’t screenshot it or paste it into a chat, note or email." />
          <Rule icon="pen" text="Your 24 recovery words do the same, and work in more apps." />
        </View>
        {problem ? (
          <Txt weight="medium" size={14} color={colors.danger} style={{ marginTop: 14 }}>
            {problem}
          </Txt>
        ) : null}
        <View style={{ marginTop: 22 }}>
          <PillButton
            label="Show my private key"
            icon={Platform.OS === 'ios' ? 'face' : 'fingerprint'}
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
  title: { letterSpacing: -1, lineHeight: 34 },
  lead: { marginTop: 10, lineHeight: 23 },
  keyBox: {
    marginTop: 16,
    padding: 18,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  keyText: {
    lineHeight: 26,
    letterSpacing: 0.4,
    fontVariant: ['tabular-nums'],
  },
  warn: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.sunken,
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
})
