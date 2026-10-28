import type { BottomTabBarProps } from '@react-navigation/bottom-tabs'
import * as Haptics from 'expo-haptics'
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { useOrders } from '@/lib/orders'
import { colors } from '@/lib/theme'
import { ShopBadge } from './art'
import { NavIcon, type NavIconName } from './NavIcons'
import { Txt } from './primitives'

const tabs: Record<string, { label: string; icon: NavIconName | 'shop' }> = {
  orders: { label: 'Orders', icon: 'orders' },
  stall: { label: 'Stall', icon: 'stall' },
  today: { label: 'Today', icon: 'today' },
  shop: { label: 'Shop', icon: 'shop' },
}

const H = 58

/**
 * The shop side's dock: the wallet's floating ink pill, with Charge where the wallet keeps Pay.
 * Orders carries a coral count of what's paid and waiting to be handed over; the shop tab is
 * the shop's own little storefront, as the wallet's is your face.
 */
export function ShopDock({ state, navigation }: BottomTabBarProps) {
  const { width } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const { toHand } = useOrders()
  const bottom = Math.max(insets.bottom - 6, 16)

  const go = (name: string, key: string, focused: boolean) => {
    const event = navigation.emit({ type: 'tabPress', target: key, canPreventDefault: true })
    if (!focused && !event.defaultPrevented) {
      void Haptics.selectionAsync()
      navigation.navigate(name)
    }
  }

  const slot = (name: string) => {
    const index = state.routes.findIndex((r) => r.name === name)
    const route = state.routes[index]
    const tab = tabs[name]
    if (!route || !tab) return null
    const focused = state.index === index
    const count = name === 'orders' ? toHand.length : 0
    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        accessibilityLabel={count ? `${tab.label}, ${count} to hand over` : tab.label}
        accessibilityState={{ selected: focused }}
        onPress={() => go(name, route.key, focused)}
        style={styles.slot}
      >
        <View style={[styles.tab, focused && styles.tabOn]}>
          {tab.icon === 'shop' ? (
            <View
              style={[
                styles.badgeRing,
                { borderColor: focused ? colors.yellow : 'rgba(255,255,255,0.45)' },
              ]}
            >
              <ShopBadge size={focused ? 28 : 26} />
            </View>
          ) : (
            <NavIcon
              name={tab.icon}
              active={focused}
              size={26}
              color={focused ? colors.dark : 'rgba(255,255,255,0.66)'}
            />
          )}
        </View>
        {count ? (
          <View style={styles.count} pointerEvents="none">
            <Txt weight="bold" size={12} color={colors.ink}>
              {count > 9 ? '9+' : count}
            </Txt>
          </View>
        ) : null}
      </Pressable>
    )
  }

  const till = state.routes.findIndex((r) => r.name === 'index')
  const onTill = state.index === till
  return (
    <View
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, { top: undefined, height: H + bottom + 40 }]}
    >
      <Svg
        pointerEvents="none"
        width={width}
        height={H + bottom + 40}
        style={StyleSheet.absoluteFill}
      >
        <Defs>
          <LinearGradient id="shopfade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.paper} stopOpacity={0} />
            <Stop offset="0.5" stopColor={colors.paper} stopOpacity={onTill ? 0 : 1} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={H + bottom + 40} fill="url(#shopfade)" />
      </Svg>
      <View style={[styles.dock, { bottom }]}>
        {slot('orders')}
        {slot('stall')}
        <Pressable
          accessibilityRole="tab"
          accessibilityLabel="Charge"
          accessibilityState={{ selected: onTill }}
          onPress={() => {
            const route = state.routes[till]
            if (!route) return
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
            go('index', route.key, onTill)
          }}
          style={({ pressed }) => [
            styles.charge,
            onTill && styles.chargeOn,
            pressed && { transform: [{ scale: 0.95 }] },
          ]}
          hitSlop={4}
        >
          <NavIcon name="charge" size={22} color={colors.white} />
          <Txt weight="bold" size={15} color={colors.white}>
            Charge
          </Txt>
        </Pressable>
        {slot('today')}
        {slot('shop')}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    left: 20,
    right: 20,
    height: H,
    borderRadius: H / 2,
    backgroundColor: colors.fill,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  slot: { flex: 1, height: H, alignItems: 'center', justifyContent: 'center' },
  tab: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: colors.onFill },
  badgeRing: { borderRadius: 18, borderWidth: 2, padding: 1 },
  count: {
    position: 'absolute',
    top: 6,
    right: 2,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: 11,
    backgroundColor: colors.coral,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  charge: {
    height: 44,
    marginHorizontal: 6,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: colors.coral,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  chargeOn: { borderWidth: 2, borderColor: colors.white, paddingHorizontal: 14 },
})

/** Space to leave under scrolling content so the last row clears the dock. */
export const shopDockClearance = H + 56
