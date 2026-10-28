import type { BottomTabBarProps } from '@react-navigation/bottom-tabs'
import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Avatar } from './art'
import { NavIcon, type NavIconName } from './NavIcons'
import { Txt } from './primitives'

const tabs: Record<string, { label: string; icon: NavIconName }> = {
  index: { label: 'Home', icon: 'home' },
  card: { label: 'Card', icon: 'card' },
  activity: { label: 'Activity', icon: 'activity' },
  profile: { label: 'Profile', icon: 'profile' },
}

const H = 58

/**
 * A floating ink pill. Pay is a coral capsule in the middle, one tap from anywhere and never
 * overlapping the page; the four tabs share the rest in equal slots, and the active one sits in
 * a light circle. The Profile tab is your own face. Names are read out by screen readers rather than squeezed under the icons.
 */
export function Dock({ state, navigation }: BottomTabBarProps) {
  const { width } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const { profile } = useWallet()
  const bottom = Math.max(insets.bottom - 6, 16)

  const slots = state.routes.map((route, index) => {
    const tab = tabs[route.name]
    if (!tab) return null
    const focused = state.index === index
    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        accessibilityLabel={tab.label}
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
        style={styles.slot}
      >
        <View style={[styles.tab, focused && styles.tabOn]}>
          {tab.icon === 'profile' && profile ? (
            <View
              style={[
                styles.face,
                { borderColor: focused ? colors.yellow : 'rgba(255,255,255,0.45)' },
              ]}
            >
              <Avatar name={profile.name} id={profile.address} size={focused ? 28 : 26} />
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
      </Pressable>
    )
  })

  return (
    <View
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, { top: undefined, height: H + bottom + 60 }]}
    >
      <Svg
        pointerEvents="none"
        width={width}
        height={H + bottom + 60}
        style={StyleSheet.absoluteFill}
      >
        <Defs>
          <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.paper} stopOpacity={0} />
            <Stop offset="0.5" stopColor={colors.paper} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={H + bottom + 60} fill="url(#fade)" />
      </Svg>
      <View style={[styles.dock, { bottom }]}>
        {slots.slice(0, 2)}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Pay"
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
            router.push('/scan')
          }}
          style={({ pressed }) => [styles.pay, pressed && { transform: [{ scale: 0.95 }] }]}
          hitSlop={4}
        >
          <NavIcon name="pay" size={22} color={colors.white} />
          <Txt weight="bold" size={15} color={colors.white}>
            Pay
          </Txt>
        </Pressable>
        {slots.slice(2)}
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
  /** You, on the Profile tab: your own face in a ring that lights up yellow when you're there. */
  face: { borderRadius: 18, borderWidth: 2, padding: 1 },
  pay: {
    height: 44,
    marginHorizontal: 6,
    paddingHorizontal: 18,
    borderRadius: 22,
    backgroundColor: colors.coral,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
})

/** Space to leave under scrolling content so the last row clears the dock. */
export const dockClearance = H + 56
