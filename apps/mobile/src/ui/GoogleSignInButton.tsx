import { AntDesign } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { useStall } from '@/lib/stall'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Txt } from './primitives'

/** The same Google account reopens the same embedded wallet on a replacement phone. */
export function GoogleSignInButton() {
  const { signInGoogle, googleEnabled, googleBusy } = useWallet()
  const stall = useStall()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!googleEnabled) return null
  const working = busy || googleBusy
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Continue with Google"
        accessibilityState={{ disabled: working, busy: working }}
        disabled={working}
        style={({ pressed }) => [styles.button, (pressed || working) && { opacity: 0.65 }]}
        onPress={() => {
          setBusy(true)
          setError(null)
          void signInGoogle()
            .then(() => {
              void stall.recover().catch(() => {})
              router.replace('/(tabs)')
            })
            .catch((error: unknown) => {
              setError(error instanceof Error ? error.message : 'Google sign-in failed. Try again.')
            })
            .finally(() => setBusy(false))
        }}
      >
        {working ? (
          <ActivityIndicator color={colors.ink} />
        ) : (
          <AntDesign name="google" size={20} color="#4285F4" />
        )}
        <Txt weight="semi" size={16}>
          {working ? 'Opening your wallet…' : 'Continue with Google'}
        </Txt>
      </Pressable>
      {error ? (
        <Txt size={13} color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Txt>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  button: {
    minHeight: 56,
    borderRadius: 30,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 20,
  },
})
