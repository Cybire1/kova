import * as Haptics from 'expo-haptics'
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { colors } from '@/lib/theme'
import { Txt } from './primitives'

/**
 * The sign-in buttons, as one matched pair: the same height and shape, a mark beside a centred
 * label, and no wider than a thumb's comfortable reach. `ink` leads (Face ID, fingerprint);
 * `outline` follows (Google).
 */
export function AuthButton({
  label,
  mark,
  tone,
  onPress,
  loading,
  disabled,
}: {
  label: string
  mark: ReactNode
  tone: 'ink' | 'outline'
  onPress: () => void
  loading?: boolean
  disabled?: boolean
}) {
  const ink = tone === 'ink'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
      disabled={disabled || loading}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        onPress()
      }}
      style={({ pressed }) => [
        styles.button,
        ink ? styles.ink : styles.outline,
        (disabled || loading) && { opacity: 0.6 },
        pressed && { transform: [{ scale: 0.98 }] },
      ]}
    >
      <View style={styles.mark}>
        {loading ? <ActivityIndicator color={ink ? colors.white : colors.ink} /> : mark}
      </View>
      <Txt weight="semi" size={16} color={ink ? colors.white : colors.ink}>
        {label}
      </Txt>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    width: '100%',
    maxWidth: 340,
    alignSelf: 'center',
    height: 52,
    borderRadius: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  ink: { backgroundColor: colors.fill },
  outline: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.line },
  mark: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
})
