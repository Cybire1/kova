import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  useFonts,
} from '@expo-google-fonts/manrope'
import { router, Stack, useRootNavigationState } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { Platform, Settings } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { OfflineProvider } from '@/lib/offline'
import { PrefsProvider, usePrefs } from '@/lib/prefs'
import { PrivateProvider } from '@/lib/private'
import { useLiveRates } from '@/lib/rates'
import { StallProvider } from '@/lib/stall'
import { TakingsProvider } from '@/lib/takings'
import { TravelProvider } from '@/lib/travel'
import { TerminalProvider } from '@/lib/terminal'
import { colors } from '@/lib/theme'
import { useWallet, WalletProvider } from '@/lib/wallet'
import { OrderWatcher } from '@/lib/watch'

void SplashScreen.preventAutoHideAsync()

/**
 * Development only: `xcrun simctl launch <device> xyz.kova.pay.monad -KovaDevLink "name=Maya&fake=1&to=/"`
 * runs that dev link (app/dev.tsx) on launch. A kova:// link opened from outside asks "Open in
 * Kova?", which a simulator nobody is tapping can't answer; launch arguments ask nothing. Replacing
 * the root route remounts this layout, so "already ran" lives outside it.
 */
let devLaunched = false
function DevLaunch() {
  const navigation = useRootNavigationState()
  useEffect(() => {
    if (!__DEV__ || Platform.OS !== 'ios' || devLaunched || !navigation?.key) return
    devLaunched = true
    const link = Settings.get('KovaDevLink')
    if (typeof link === 'string' && link) router.replace(`/dev?${link}` as never)
  }, [navigation?.key])
  return null
}

/** When money arrives while the app is open, celebrate it. Terminal mode has its own screens. */
function ArrivalWatcher() {
  const { arrival, clearArrival } = useWallet()
  const { mode } = usePrefs()
  useEffect(() => {
    if (!arrival || mode === 'terminal') return
    router.push({
      pathname: '/received',
      params: {
        amount: arrival.amount.toString(),
        name: arrival.name,
        hash: arrival.hash,
        ...(arrival.note ? { note: arrival.note } : {}),
        // Arrived privately: the arrival screen says so, and offers to move it in.
        ...(arrival.privately ? { private: '1', ...(arrival.oneTime ? { oneTime: arrival.oneTime } : {}), ...(arrival.unconfirmed ? { unconfirmed: '1' } : {}) } : {}),
      },
    })
    clearArrival()
  }, [arrival, clearArrival, mode])
  return null
}

/** Send is one sheet over Home, sized to each step, so the balance stays in view behind it. */
const sendSheet = {
  presentation: 'formSheet',
  sheetAllowedDetents: 'fitToContents',
  sheetGrabberVisible: true,
  sheetCornerRadius: 34,
  contentStyle: { backgroundColor: colors.paper },
} as const

export default function RootLayout() {
  const [loaded] = useFonts({ Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold })
  // Local prices on the first screen should already use today's rates.
  const ratesReady = useLiveRates()

  useEffect(() => {
    if (loaded && ratesReady) void SplashScreen.hideAsync()
  }, [loaded, ratesReady])

  if (!loaded || !ratesReady) return null

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PrefsProvider>
          <TerminalProvider>
            <WalletProvider>
              <StallProvider>
                <TakingsProvider>
                <PrivateProvider>
                <OfflineProvider>
                <TravelProvider>
                <StatusBar style="dark" />
                <ArrivalWatcher />
                <OrderWatcher />
                <DevLaunch />
                <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}>
                  <Stack.Screen name="index" options={{ animation: 'none' }} />
                  <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
                  <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
                  <Stack.Screen name="received" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
                  <Stack.Screen name="ready/[id]" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
                  <Stack.Screen name="terminal" options={{ animation: 'fade' }} />
                  <Stack.Screen name="open-stall" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
                  <Stack.Screen name="cash-out" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
                  <Stack.Screen name="add-naira" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
                  <Stack.Screen name="card/link" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
                  <Stack.Screen name="card/pin" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
                  <Stack.Screen name="s/[slug]" options={{ animation: 'slide_from_bottom' }} />
                  <Stack.Screen name="travel" options={{ animation: 'slide_from_bottom' }} />
                  <Stack.Screen name="send/index" options={sendSheet} />
                  <Stack.Screen name="send/[to]" options={sendSheet} />
                  <Stack.Screen name="send/link" options={sendSheet} />
                  <Stack.Screen name="c/[id]" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
                  <Stack.Screen name="o" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
                  <Stack.Screen name="offline/[id]" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
                </Stack>
                </TravelProvider>
                </OfflineProvider>
                </PrivateProvider>
                </TakingsProvider>
              </StallProvider>
            </WalletProvider>
          </TerminalProvider>
        </PrefsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
