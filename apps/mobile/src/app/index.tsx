import { Redirect } from 'expo-router'
import { View } from 'react-native'
import { usePrefs } from '@/lib/prefs'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'

/** Sends each launch to the right place: onboarding, the wallet, or the merchant terminal. */
export default function Gate() {
  const { status } = useWallet()
  const { ready, mode } = usePrefs()
  if (status === 'loading' || !ready)
    return <View style={{ flex: 1, backgroundColor: colors.paper }} />
  if (mode === 'terminal') return <Redirect href="/terminal" />
  if (status === 'none') return <Redirect href="/welcome" />
  return <Redirect href="/(tabs)" />
}
