import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { useEffect } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated'
import { eta, type Network, shortAddress } from '@/lib/crosschain'
import { applyKey, formatUsd, groupTyped, toBase } from '@/lib/money'
import { colors } from '@/lib/theme'
import Animated from '@/ui/animated'
import { Icon } from '../../Icon'
import { Keypad } from '../../Keypad'
import { PillButton, Txt } from '../../primitives'
import { ChainLogo } from './ChainLogo'

/**
 * How much. Where it's going sits on top so it's never in doubt; over your balance, the amount
 * turns red and shakes, with a way to send it all or add money.
 */
export function AmountStep({
  to,
  recipient,
  balance,
  typed,
  onTyped,
  onNext,
  minimum,
}: {
  to: Network
  recipient: string
  balance: bigint | null
  typed: string
  onTyped: (value: string) => void
  onNext: () => void
  /** The smallest send the bridge takes. */
  minimum: bigint
}) {
  const amount = typed ? toBase(typed) : 0n
  const over = balance !== null && amount > balance
  const small = amount > 0n && amount < minimum
  const shake = useSharedValue(0)

  useEffect(() => {
    if (!over) return
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
    shake.value = withSequence(
      withTiming(-10, { duration: 60 }),
      withTiming(9, { duration: 70 }),
      withTiming(-6, { duration: 70 }),
      withTiming(4, { duration: 60 }),
      withTiming(0, { duration: 60 }),
    )
  }, [over, shake])
  const moved = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }))

  const all = balance ? (Number(balance / 10_000n) / 100).toFixed(2) : null

  return (
    <View style={{ flex: 1 }}>
      <View style={{ alignItems: 'center', marginTop: 4 }}>
        <View style={styles.to}>
          <ChainLogo name={to.id} size={28} />
          <Txt weight="bold" size={14}>
            {shortAddress(recipient)}
          </Txt>
          <Txt weight="medium" size={14} color={colors.muted}>
            on {to.name}
          </Txt>
        </View>
      </View>

      <View style={styles.middle}>
        <Animated.View style={moved}>
          <Txt
            weight="bold"
            size={groupTyped(typed).length > 8 ? 60 : 76}
            color={over ? colors.danger : colors.ink}
            style={{ letterSpacing: -3 }}
            accessibilityLabel={`$${typed || '0'}`}
          >
            ${groupTyped(typed)}
          </Txt>
        </Animated.View>
        {over && balance !== null ? (
          <View style={{ alignItems: 'center', gap: 12 }}>
            <Txt weight="bold" size={15} color={colors.danger}>
              You have {formatUsd(balance)}
            </Txt>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Chip
                label={`Send ${formatUsd(balance)}`}
                solid
                onPress={() => all && onTyped(all)}
              />
              <Chip label="Add money" onPress={() => router.push('/add-money')} />
            </View>
          </View>
        ) : (
          <View style={{ alignItems: 'center', gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Txt weight="medium" size={15} color={colors.muted}>
                {balance !== null ? `${formatUsd(balance)} available` : 'Checking your balance…'}
              </Txt>
              {all ? <Chip label="Max" small onPress={() => onTyped(all)} /> : null}
            </View>
            {small ? (
              <Txt weight="semi" size={14} color={colors.danger}>
                Sends to other networks start at {formatUsd(minimum)}.
              </Txt>
            ) : (
              <View style={styles.eta}>
                <Icon name="clock" size={14} color={colors.onTint} strokeWidth={2.6} />
                <Txt weight="semi" size={13} color={colors.onTint}>
                  Lands on {to.name} in about {eta(to.seconds)}
                </Txt>
              </View>
            )}
          </View>
        )}
      </View>

      <Keypad onKey={(key) => onTyped(applyKey(typed, key))} size={60} />
      <View style={{ marginTop: 12 }}>
        <PillButton label="Continue" disabled={over || small || amount === 0n} onPress={onNext} />
      </View>
    </View>
  )
}

function Chip({
  label,
  onPress,
  solid,
  small,
}: {
  label: string
  onPress: () => void
  solid?: boolean
  small?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.chip,
        small && styles.chipSmall,
        solid && { backgroundColor: colors.fill, borderColor: colors.fill },
        pressed && { transform: [{ scale: 0.96 }] },
      ]}
    >
      <Txt
        weight={small ? 'bold' : 'semi'}
        size={small ? 13 : 14}
        color={solid ? colors.white : colors.ink}
      >
        {label}
      </Txt>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  to: {
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 4,
    paddingRight: 14,
  },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  eta: {
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.tealSoft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  chip: {
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  chipSmall: {
    height: 28,
    borderRadius: 14,
    borderWidth: 0,
    backgroundColor: colors.sunken,
    paddingHorizontal: 10,
  },
})
