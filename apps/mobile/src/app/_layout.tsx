import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  useFonts,
} from '@expo-google-fonts/manrope'
import { router, Stack, usePathname, useRootNavigationState } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import * as SystemUI from 'expo-system-ui'
import { useEffect } from 'react'
import { Platform, Settings, useColorScheme } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GoogleWalletProvider } from '@/lib/google-wallet'
import { OfflineProvider } from '@/lib/offline'
import { AFTER_RELOAD_KEY, PrefsProvider, usePrefs } from '@/lib/prefs'
import { PrivateProvider } from '@/lib/private'
import { useLiveRates } from '@/lib/rates'
import { StallProvider } from '@/lib/stall'
import { TakingsProvider } from '@/lib/takings'
import { TerminalProvider } from '@/lib/terminal'
import { colors, palette } from '@/lib/theme'
import { takeTokenArrival, useTokenWatch, useWalletTokens } from '@/lib/tokens'
import { TravelProvider } from '@/lib/travel'
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

/**
 * After the app reloads in a new look (Appearance on You, lib/prefs.tsx), back to the screen that
 * changed it, once the start route has sent the wallet home.
 */
let resumed = false
function AfterReload() {
  const navigation = useRootNavigationState()
  const { status } = useWallet()
  const { ready, mode } = usePrefs()
  useEffect(() => {
    if (resumed || Platform.OS !== 'ios' || !navigation?.key || !ready) return
    if (status === 'loading') return
    resumed = true
    const to = Settings.get(AFTER_RELOAD_KEY)
    if (typeof to !== 'string' || !to) return
    Settings.set({ [AFTER_RELOAD_KEY]: '' })
    if (status !== 'none' && mode === 'pay') setTimeout(() => router.navigate(to as never), 300)
  }, [navigation?.key, status, ready, mode])
  return null
}

/** The window's own ground, which shows behind sheets as they open: paper, or black in the dark. */
function Ground() {
  const scheme = useColorScheme()
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(palette[scheme === 'dark' ? 'dark' : 'light'].paper)
  }, [scheme])
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
        ...(arrival.privately
          ? {
              private: '1',
              ...(arrival.oneTime ? { oneTime: arrival.oneTime } : {}),
              ...(arrival.unconfirmed ? { unconfirmed: '1' } : {}),
            }
          : {}),
      },
    })
    clearArrival()
  }, [arrival, clearArrival, mode])
  return null
}

/**
 * Other tokens arriving (USDT0, WETH…) get their moment too: a sheet with a way to make them
 * dollars, one at a time, never over another arrival.
 */
function TokenArrivalWatcher() {
  useTokenWatch()
  const { arrivals } = useWalletTokens()
  const { status } = useWallet()
  const { mode } = usePrefs()
  const path = usePathname()
  useEffect(() => {
    if (arrivals.length === 0 || status !== 'ready' || mode === 'terminal') return
    if (path === '/token-arrived' || path === '/received') return
    const next = takeTokenArrival()
    if (next)
      router.push({
        pathname: '/token-arrived',
        params: { token: next.token.address, amount: next.amount.toString() },
      })
  }, [arrivals, status, mode, path])
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
  const [loaded] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
  })
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
            <GoogleWalletProvider>
              <WalletProvider>
                <StallProvider>
                  <TakingsProvider>
                    <PrivateProvider>
                      <OfflineProvider>
                        <TravelProvider>
                          <StatusBar style="auto" />
                          <Ground />
                          <AfterReload />
                          <ArrivalWatcher />
                          <TokenArrivalWatcher />
                          <OrderWatcher />
                          <DevLaunch />
                          <Stack
                            screenOptions={{
                              headerShown: false,
                              contentStyle: { backgroundColor: colors.paper },
                            }}
                          >
                            <Stack.Screen name="index" options={{ animation: 'none' }} />
                            <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
                            <Stack.Screen
                              name="scan"
                              options={{
                                presentation: 'fullScreenModal',
                                animation: 'slide_from_bottom',
                              }}
                            />
                            <Stack.Screen
                              name="received"
                              options={{ presentation: 'fullScreenModal', animation: 'fade' }}
                            />
                            <Stack.Screen
                              name="ready/[id]"
                              options={{ presentation: 'fullScreenModal', animation: 'fade' }}
                            />
                            <Stack.Screen name="terminal" options={{ animation: 'fade' }} />
                            <Stack.Screen
                              name="open-stall"
                              options={{
                                presentation: 'fullScreenModal',
                                animation: 'slide_from_bottom',
                              }}
                            />
                            <Stack.Screen
                              name="cash-out"
                              options={{
                                presentation: 'fullScreenModal',
                                animation: 'slide_from_bottom',
                              }}
                            />
                            <Stack.Screen
                              name="add-naira"
                              options={{
                                presentation: 'fullScreenModal',
                                animation: 'slide_from_bottom',
                              }}
                            />
                            <Stack.Screen
                              name="card/link"
                              options={{
                                presentation: 'fullScreenModal',
                                animation: 'slide_from_bottom',
                              }}
                            />
                            <Stack.Screen
                              name="card/pin"
                              options={{
                                presentation: 'fullScreenModal',
                                animation: 'slide_from_bottom',
                              }}
                            />
                            <Stack.Screen
                              name="s/[slug]"
                              options={{ animation: 'slide_from_bottom' }}
                            />
                            <Stack.Screen
                              name="travel"
                              options={{ animation: 'slide_from_bottom' }}
                            />
                            <Stack.Screen name="send/index" options={sendSheet} />
                            <Stack.Screen
                              name="token-arrived"
                              options={{
                                ...sendSheet,
                                contentStyle: { backgroundColor: colors.surface },
                              }}
                            />
                            <Stack.Screen name="send/[to]" options={sendSheet} />
                            <Stack.Screen name="send/link" options={sendSheet} />
                            <Stack.Screen
                              name="stocks/buy"
                              options={{
                                ...sendSheet,
                                contentStyle: { backgroundColor: colors.surface },
                              }}
                            />
                            <Stack.Screen
                              name="send/phone"
                              options={{
                                presentation: 'fullScreenModal',
                                animation: 'slide_from_bottom',
                              }}
                            />
                            <Stack.Screen
                              name="phone/[id]"
                              options={{
                                presentation: 'fullScreenModal',
                                animation: 'slide_from_bottom',
                              }}
                            />
                            <Stack.Screen
                              name="c/[id]"
                              options={{
                                presentation: 'fullScreenModal',
                                animation: 'slide_from_bottom',
                              }}
                            />
                            <Stack.Screen
                              name="o"
                              options={{ presentation: 'fullScreenModal', animation: 'fade' }}
                            />
                            <Stack.Screen
                              name="offline/[id]"
                              options={{ presentation: 'fullScreenModal', animation: 'fade' }}
                            />
                          </Stack>
                        </TravelProvider>
                      </OfflineProvider>
                    </PrivateProvider>
                  </TakingsProvider>
                </StallProvider>
              </WalletProvider>
            </GoogleWalletProvider>
          </TerminalProvider>
        </PrefsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
