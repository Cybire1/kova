import { router, Stack, usePathname } from 'expo-router'
import { useEffect } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { OrdersProvider, useOrders } from '@/lib/orders'
import { ShopProvider } from '@/lib/shop'
import { colors } from '@/lib/theme'
import { Avatar } from '@/ui/art'
import { Txt } from '@/ui/primitives'
import { dollars } from '@/ui/StallParts'

export default function TerminalLayout() {
  return (
    <ShopProvider>
      <OrdersProvider>
        <Stack
          screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.tealSoft } }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="[id]" options={{ animation: 'fade', gestureEnabled: false }} />
          <Stack.Screen name="setup" />
          <Stack.Screen
            name="item"
            options={{ presentation: 'modal', contentStyle: { backgroundColor: colors.paper } }}
          />
          <Stack.Screen
            name="share"
            options={{ presentation: 'modal', contentStyle: { backgroundColor: colors.paper } }}
          />
          <Stack.Screen
            name="takings"
            options={{ contentStyle: { backgroundColor: colors.paper } }}
          />
          <Stack.Screen
            name="business"
            options={{ contentStyle: { backgroundColor: colors.paper } }}
          />
          <Stack.Screen
            name="payroll"
            options={{ contentStyle: { backgroundColor: colors.paper } }}
          />
          <Stack.Screen
            name="payroll-run"
            options={{ contentStyle: { backgroundColor: colors.paper } }}
          />
          <Stack.Screen
            name="suppliers"
            options={{ contentStyle: { backgroundColor: colors.paper } }}
          />
          <Stack.Screen name="team" options={{ contentStyle: { backgroundColor: colors.paper } }} />
          <Stack.Screen
            name="snap"
            options={{
              presentation: 'fullScreenModal',
              contentStyle: { backgroundColor: colors.paper },
            }}
          />
        </Stack>
        <NewOrderBanner />
      </OrdersProvider>
    </ShopProvider>
  )
}

/** A paid stall order, announced wherever the phone is, until someone looks at it. */
function NewOrderBanner() {
  const { fresh, dismissFresh } = useOrders()
  const path = usePathname()
  const insets = useSafeAreaInsets()
  const onOrders = path === '/terminal/orders'
  // The customer display belongs to the customer: never cover it.
  const hidden = /^\/terminal\/(pi_|setup|item|share|snap)/.test(path)

  useEffect(() => {
    if (fresh && onOrders) dismissFresh()
  }, [fresh, onOrders, dismissFresh])

  useEffect(() => {
    if (!fresh) return
    const id = setTimeout(dismissFresh, 9000)
    return () => clearTimeout(id)
  }, [fresh, dismissFresh])

  if (!fresh || onOrders || hidden) return null
  const who = fresh.customer_name ?? 'Someone'
  const what = fresh.lines
    .map((l) => (l.quantity > 1 ? `${l.quantity} × ${l.name}` : l.name))
    .join(', ')
  return (
    <Animated.View
      entering={FadeInUp.springify().damping(16)}
      exiting={FadeOutUp}
      style={[styles.wrap, { top: insets.top + 6 }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`New order from ${who}, ${dollars(fresh.amount ?? 0)}. Open orders`}
        onPress={() => {
          dismissFresh()
          router.navigate('/terminal/orders')
        }}
        style={({ pressed }) => [styles.banner, pressed && { transform: [{ scale: 0.98 }] }]}
      >
        <Avatar name={who} size={40} />
        <View style={{ flex: 1 }}>
          <Txt weight="bold" size={15} color={colors.white} numberOfLines={1}>
            {who} paid {dollars(fresh.amount ?? 0)}
          </Txt>
          <Txt size={13} color={colors.onInk} numberOfLines={1}>
            {fresh.table ? `Table ${fresh.table}: ${what}` : what}
          </Txt>
        </View>
        <View style={styles.see}>
          <Txt weight="bold" size={13}>
            See
          </Txt>
        </View>
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 14, right: 14 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    paddingRight: 12,
    borderRadius: 26,
    backgroundColor: colors.ink,
  },
  see: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: colors.coral,
    justifyContent: 'center',
  },
})
