import type { BottomTabBarProps } from '@react-navigation/bottom-tabs'
import * as Haptics from 'expo-haptics'
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useOrders } from '@/lib/orders'
import { useShop } from '@/lib/shop'
import { colors } from '@/lib/theme'
import { ShopBadge } from './art'
import { Icon } from './Icon'
import { NavIcon, type NavIconName } from './NavIcons'
import { Txt } from './primitives'

/** Wide screens (a counter tablet or a big terminal) run the shop as an OS: a rail down the side. */
export const WIDE = 900
export const RAIL = 112
export const useWide = () => useWindowDimensions().width >= WIDE

const items: { name: string; label: string; icon: NavIconName | 'shop' }[] = [
  { name: 'index', label: 'Sell', icon: 'charge' },
  { name: 'orders', label: 'Orders', icon: 'orders' },
  { name: 'products', label: 'Products', icon: 'stall' },
  { name: 'today', label: 'Reports', icon: 'today' },
  { name: 'stall', label: 'Online', icon: 'stall' },
  { name: 'shop', label: 'Settings', icon: 'shop' },
]

/**
 * The shop OS's rail: Sell, Orders, Products, Reports and the shop itself, with the paid orders
 * waiting to be handed over counted on Orders. It's the phone dock, stood on its side.
 */
export function ShopRail({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets()
  const { toHand } = useOrders()
  const shop = useShop()
  return (
    <View style={[styles.rail, { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 18 }]}>
      <View style={styles.mark} accessibilityLabel={shop.name}>
        <ShopBadge size={44} />
      </View>
      <View style={{ gap: 6, marginTop: 22 }}>
        {items.map((item) => {
          const index = state.routes.findIndex((r) => r.name === item.name)
          const route = state.routes[index]
          if (!route) return null
          const focused = state.index === index
          const count = item.name === 'orders' ? toHand.length : 0
          const color = focused ? colors.dark : colors.onInk
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityLabel={count ? `${item.label}, ${count} to hand over` : item.label}
              accessibilityState={{ selected: focused }}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                })
                if (!focused && !event.defaultPrevented) {
                  void Haptics.selectionAsync()
                  navigation.navigate(route.name)
                }
              }}
              style={({ pressed }) => [
                styles.item,
                focused && styles.itemOn,
                pressed && !focused && { backgroundColor: 'rgba(255,255,255,0.08)' },
              ]}
            >
              {item.icon === 'shop' ? (
                <Icon name="info" size={24} color={color} />
              ) : (
                <NavIcon name={item.icon} active={focused} size={26} color={color} />
              )}
              <Txt weight="semi" size={12} color={color}>
                {item.label}
              </Txt>
              {count ? (
                <View style={styles.count} pointerEvents="none">
                  <Txt weight="bold" size={12} color={colors.white}>
                    {count}
                  </Txt>
                </View>
              ) : null}
            </Pressable>
          )
        })}
      </View>
      <View style={{ flex: 1 }} />
      <Txt
        weight="semi"
        size={11}
        color={colors.onInk}
        style={{ textAlign: 'center' }}
        numberOfLines={2}
      >
        {shop.terminal}
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  rail: { width: RAIL, backgroundColor: colors.fill, alignItems: 'center', paddingHorizontal: 12 },
  mark: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  item: {
    width: 88,
    height: 66,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  itemOn: { backgroundColor: colors.onFill },
  count: {
    position: 'absolute',
    top: 6,
    right: 12,
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
})

/** What the phone dock covers at the bottom of a screen; nothing on a wide screen, where the rail is beside it. */
export function useDockClearance(phone: number) {
  return useWide() ? 24 : phone
}
