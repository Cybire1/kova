import { router } from 'expo-router'
import { useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native'
import { isTestnet } from '@/lib/config'
import { useStall } from '@/lib/stall'
import { colors, fonts } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Kovi } from '@/ui/art'
import { Header, PillButton, Rise, Screen, Txt } from '@/ui/primitives'

/**
 * The demo account, on testnet: a username and password open a shared test wallet that's
 * already lived in, with money, people, a shop and a Kova Card. It's for App Review and for
 * anyone trying Kova without making a passkey. Real wallets are always passkeys.
 */
export default function DemoSignIn() {
  const { signInDemo } = useWallet()
  const stall = useStall()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const passwordField = useRef<TextInput>(null)

  if (!isTestnet) {
    router.replace('/welcome')
    return null
  }

  const ready = username.trim().length > 2 && password.length > 0
  const signIn = async () => {
    if (!ready || busy) return
    setBusy(true)
    setProblem(null)
    try {
      await signInDemo(username, password)
      // The demo wallet's shop, with this phone as its till. The wallet opens even if this fails.
      await stall.recover().catch(() => false)
      router.replace('/(tabs)')
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That didn’t work. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen bg={colors.paper}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Header />
        <Rise style={styles.copy}>
          <Kovi pose="key" size={110} />
          <Txt weight="semi" size={34} style={styles.title}>
            Demo account
          </Txt>
          <Txt size={16} color={colors.muted} style={styles.body}>
            A test wallet with test dollars, a shop and a Kova Card, so you can try everything. Your
            own wallet is a passkey: create one from the start screen.
          </Txt>
        </Rise>
        <View style={styles.form}>
          <TextInput
            value={username}
            onChangeText={setUsername}
            placeholder="Username"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            keyboardType="email-address"
            returnKeyType="next"
            onSubmitEditing={() => passwordField.current?.focus()}
            style={styles.input}
            accessibilityLabel="Username"
          />
          <TextInput
            ref={passwordField}
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={colors.muted}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => void signIn()}
            style={styles.input}
            accessibilityLabel="Password"
          />
          {problem ? (
            <Txt weight="medium" size={15} color={colors.danger}>
              {problem}
            </Txt>
          ) : null}
        </View>
        <View style={styles.footer}>
          <PillButton
            label="Sign in"
            disabled={!ready}
            loading={busy}
            onPress={() => void signIn()}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  copy: { paddingHorizontal: 24, marginTop: 4 },
  title: { letterSpacing: -1.2, lineHeight: 40, marginTop: 8 },
  body: { marginTop: 8, lineHeight: 23 },
  form: { paddingHorizontal: 20, marginTop: 24, gap: 12 },
  input: {
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    paddingHorizontal: 22,
    fontSize: 17,
    fontFamily: fonts.medium,
    color: colors.ink,
  },
  footer: { paddingHorizontal: 20, paddingBottom: 12, paddingTop: 16, marginTop: 'auto' },
})
