import { router } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { useStall } from '@/lib/stall'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { AuthButton } from './AuthButton'
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
      <AuthButton
        tone="outline"
        label={working ? 'Opening your wallet…' : 'Continue with Google'}
        mark={<GoogleLogo size={20} />}
        loading={working}
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
      />
      {error ? (
        <Txt
          size={13}
          color={colors.danger}
          accessibilityLiveRegion="polite"
          style={{ textAlign: 'center' }}
        >
          {error}
        </Txt>
      ) : null}
    </View>
  )
}

/** Google's own four-colour G, as Google's sign-in branding asks (the same paths as the web's). */
function GoogleLogo({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <Path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.24 1.06-3.71 1.06-2.87 0-5.3-1.94-6.17-4.54H2.15v2.84C3.96 20.53 7.69 23 12 23z"
      />
      <Path
        fill="#FBBC05"
        d="M5.83 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.15A10.9 10.9 0 001 12c0 1.78.43 3.45 1.15 4.93l3.68-2.84z"
      />
      <Path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.16-3.16C17.45 2.08 14.97 1 12 1 7.69 1 3.96 3.47 2.15 7.07l3.68 2.84c.87-2.6 3.3-4.53 6.17-4.53z"
      />
    </Svg>
  )
}
