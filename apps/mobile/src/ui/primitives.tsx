import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { type ReactNode, useEffect } from 'react'
import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  type TextProps,
  View,
  type ViewStyle,
} from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, density, fonts } from '@/lib/theme'
import { Icon, type IconName } from './Icon'

type Weight = keyof typeof fonts

/**
 * Text in the app font (Manrope). Numbers always use tabular figures so amounts don't jitter as
 * they change. Sizes are scaled by the app's text density unless `exact` (text drawn onto art).
 */
export function Txt({
  weight = 'regular',
  size = 16,
  color = colors.ink,
  exact,
  style,
  ...rest
}: TextProps & { weight?: Weight; size?: number; color?: string; exact?: boolean }) {
  return (
    <Text
      {...rest}
      style={[
        {
          fontFamily: fonts[weight],
          fontSize: exact ? size : size * density.text,
          color,
          fontVariant: ['tabular-nums'],
        },
        style,
      ]}
    />
  )
}

const press = { damping: 18, stiffness: 420, mass: 0.6 }

/** A die-cut sticker: a flat surface with an ink outline that gives a little when pressed. */
export function Sticker({
  children,
  onPress,
  radius = 28,
  fill = colors.surface,
  outline = true,
  disabled,
  style,
  innerStyle,
  accessibilityLabel,
  haptic = true,
}: {
  children: ReactNode
  onPress?: () => void
  radius?: number
  fill?: string
  outline?: boolean
  disabled?: boolean
  style?: StyleProp<ViewStyle>
  innerStyle?: StyleProp<ViewStyle>
  accessibilityLabel?: string
  haptic?: boolean
}) {
  const scale = useSharedValue(1)
  const face = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  const body = (
    <Animated.View
      style={[
        {
          // A pressable sticker fills its Pressable, which carries the layout; a plain one
          // takes exactly the size its style or content gives it.
          flexGrow: onPress ? 1 : 0,
          borderRadius: radius,
          backgroundColor: fill,
          borderWidth: outline ? 2 : 0,
          borderColor: colors.ink,
          overflow: 'hidden',
        },
        onPress ? null : style,
        innerStyle,
        face,
      ]}
    >
      {children}
    </Animated.View>
  )
  if (!onPress) return body
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPressIn={() => {
        scale.value = withSpring(0.97, press)
      }}
      onPressOut={() => {
        scale.value = withSpring(1, press)
      }}
      onPress={() => {
        if (haptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        onPress()
      }}
      style={[style, { opacity: disabled ? 0.45 : 1 }]}
    >
      {body}
    </Pressable>
  )
}

/** The primary action: a black pill with its icon in a white disc on the right. */
export function PillButton({
  label,
  icon = 'arrow',
  onPress,
  disabled,
  loading,
  tone = 'ink',
}: {
  label: string
  icon?: IconName
  onPress: () => void
  disabled?: boolean
  loading?: boolean
  tone?: 'ink' | 'white'
}) {
  const scale = useSharedValue(1)
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  const bg = tone === 'ink' ? colors.ink : colors.surface
  const fg = tone === 'ink' ? colors.white : colors.ink
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      disabled={disabled || loading}
      onPressIn={() => {
        scale.value = withSpring(0.97, press)
      }}
      onPressOut={() => {
        scale.value = withSpring(1, press)
      }}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        onPress()
      }}
    >
      <Animated.View
        style={[
          styles.pill,
          { backgroundColor: bg, opacity: disabled ? 0.35 : 1 },
          tone === 'white' && { borderWidth: 2, borderColor: colors.ink },
          style,
        ]}
      >
        <Txt weight="medium" size={16} color={fg}>
          {label}
        </Txt>
        <View style={[styles.pillDisc, { backgroundColor: fg }]}>
          {loading ? <ActivityIndicator color={bg} /> : <Icon name={icon} color={bg} />}
        </View>
      </Animated.View>
    </Pressable>
  )
}

export function RoundButton({
  icon,
  label,
  onPress,
  fill,
  size = 36,
}: {
  icon: IconName
  label: string
  onPress: () => void
  fill?: string
  size?: number
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.round,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: fill ?? 'rgba(11,26,29,0.07)',
        },
        pressed && { transform: [{ scale: 0.92 }], opacity: 0.8 },
      ]}
    >
      <Icon name={icon} size={Math.round(size * 0.5)} strokeWidth={2.4} />
    </Pressable>
  )
}

export function TextLink({
  label,
  onPress,
  color = colors.ink,
}: {
  label: string
  onPress: () => void
  color?: string
}) {
  return (
    <Pressable accessibilityRole="link" onPress={onPress} hitSlop={10}>
      {({ pressed }) => (
        <Txt
          weight="medium"
          size={16}
          color={color}
          style={{ textDecorationLine: 'underline', opacity: pressed ? 0.6 : 1 }}
        >
          {label}
        </Txt>
      )}
    </Pressable>
  )
}

/** A full screen on a coloured ground, with the safe areas kept clear. */
export function Screen({
  children,
  bg = colors.paper,
  edges = ['top', 'bottom'],
  style,
}: {
  children: ReactNode
  bg?: string
  edges?: ('top' | 'bottom')[]
  style?: StyleProp<ViewStyle>
}) {
  // Padding from the insets hook rather than SafeAreaView: inside a native full-screen modal
  // SafeAreaView reports zero insets and the header slides under the status bar.
  const insets = useSafeAreaInsets()
  return (
    <View
      style={[
        {
          flex: 1,
          backgroundColor: bg,
          paddingTop: edges.includes('top') ? insets.top : 0,
          paddingBottom: edges.includes('bottom') ? insets.bottom : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  )
}

/** Back on the left, an optional title in the middle, an optional action on the right. */
export function Header({
  title,
  subtitle,
  right,
  onBack = () => (router.canGoBack() ? router.back() : router.replace('/')),
  backIcon = 'back',
}: {
  title?: string
  subtitle?: string
  right?: ReactNode
  onBack?: (() => void) | null
  backIcon?: IconName
}) {
  return (
    <View style={styles.header}>
      {onBack ? (
        <RoundButton
          icon={backIcon}
          label={backIcon === 'close' ? 'Close' : 'Back'}
          onPress={onBack}
        />
      ) : (
        <View style={{ width: 36 }} />
      )}
      <View style={{ alignItems: 'center', flexShrink: 1 }}>
        {title ? (
          <Txt weight="semi" size={18} numberOfLines={1}>
            {title}
          </Txt>
        ) : null}
        {subtitle ? (
          <Txt size={13} color={colors.onTint}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      <View style={{ minWidth: 36, alignItems: 'flex-end' }}>{right}</View>
    </View>
  )
}

/** A small black status chip, like "Settled" or "Frozen". */
export function Chip({ label, dot, icon }: { label: string; dot?: string; icon?: IconName }) {
  return (
    <View style={styles.chip}>
      {dot ? <View style={[styles.chipDot, { backgroundColor: dot }]} /> : null}
      {icon ? <Icon name={icon} size={14} color={colors.white} /> : null}
      <Txt weight="medium" size={13} color={colors.white}>
        {label}
      </Txt>
    </View>
  )
}

/** Fades and lifts content in once, when a screen first appears. */
export function Rise({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode
  delay?: number
  style?: StyleProp<ViewStyle>
}) {
  const shown = useSharedValue(0)
  useEffect(() => {
    shown.value = withTiming(1, { duration: 520 + delay })
  }, [shown, delay])
  const anim = useAnimatedStyle(() => {
    const t = Math.max(0, (shown.value * (520 + delay) - delay) / 520)
    const eased = 1 - (1 - t) ** 3
    return { opacity: eased, transform: [{ translateY: (1 - eased) * 14 }] }
  })
  return <Animated.View style={[anim, style]}>{children}</Animated.View>
}

const styles = StyleSheet.create({
  pill: {
    height: 48,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 20,
    paddingRight: 6,
  },
  pillDisc: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  round: { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 6,
    minHeight: 50,
  },
  chip: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipDot: { width: 7, height: 7, borderRadius: 4 },
})
