import * as Haptics from 'expo-haptics'
import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { colors } from '@/lib/theme'
import { Keypad } from './Keypad'
import { Txt } from './primitives'

/**
 * Four to six dots and a keypad. The dots fill as digits go in and shake when `error` changes, so
 * a wrong PIN is felt as well as read. `length` is how many the PIN has, when that's known.
 */
export function PinEntry({
  value,
  onChange,
  length = 4,
  max = 6,
  error,
  keySize = 60,
}: {
  value: string
  onChange: (next: string) => void
  length?: number
  max?: number
  error?: string | null
  keySize?: number
}) {
  const shake = useSharedValue(0)
  useEffect(() => {
    if (!error) return
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    shake.value = withSequence(
      withTiming(-10, { duration: 50 }),
      withTiming(10, { duration: 60 }),
      withTiming(-6, { duration: 60 }),
      withTiming(0, { duration: 50 }),
    )
  }, [error, shake])
  const shaken = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }))
  const dots = Math.max(length, value.length)

  return (
    <View style={{ gap: 22 }}>
      <Animated.View
        style={[styles.dots, shaken]}
        accessibilityLabel={`${value.length} digits entered`}
      >
        {Array.from({ length: dots }, (_, i) => (
          <View
            key={i}
            style={[styles.dot, i < value.length && styles.dotOn, error ? styles.dotError : null]}
          />
        ))}
      </Animated.View>
      <Txt
        size={14}
        color={error ? colors.danger : colors.muted}
        style={{ textAlign: 'center', minHeight: 20 }}
      >
        {error ?? ' '}
      </Txt>
      <Keypad
        decimals={false}
        size={keySize}
        onKey={(key) => {
          if (key === 'del') onChange(value.slice(0, -1))
          else if (key !== '.' && value.length < max) onChange(value + key)
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 16 },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.ink },
  dotOn: { backgroundColor: colors.ink },
  dotError: { borderColor: colors.danger },
})
