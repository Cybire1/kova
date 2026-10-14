import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, TextInput, type TextInputProps, View } from 'react-native'
import type { LineState, Reach } from '@/lib/business'
import { colors, fonts } from '@/lib/theme'
import { Icon, type IconName } from './Icon'
import { Txt } from './primitives'

/**
 * Kova for Business's pieces on the phone: the shop's cards (2px ink, surface), an avatar with
 * an initial, a pay button in the colour that spends, and a payment's line as it lands.
 */

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>
}

export function SectionTitle({ children, right }: { children: string; right?: ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Txt weight="bold" size={20}>
        {children}
      </Txt>
      {right}
    </View>
  )
}

export function Avatar({ name, tint = colors.tealSoft }: { name: string; tint?: string }) {
  return (
    <View style={[styles.avatar, { backgroundColor: tint }]}>
      <Txt weight="bold" size={16}>
        {name.trim().charAt(0).toUpperCase() || '·'}
      </Txt>
    </View>
  )
}

export function Field(props: TextInputProps & { label?: string }) {
  const { label, style, ...rest } = props
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Txt weight="semi" size={14}>
          {label}
        </Txt>
      ) : null}
      <TextInput placeholderTextColor={colors.muted} {...rest} style={[styles.input, style]} />
    </View>
  )
}

/** Paying: coral, ink text, the lock or the arrow in a white cap. */
export function PayButton({
  label,
  icon = 'lock',
  onPress,
  disabled,
  busy,
}: {
  label: string
  icon?: IconName
  onPress: () => void
  disabled?: boolean
  busy?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled), busy: Boolean(busy) }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [styles.pay, (disabled || busy) && styles.payOff, pressed && { transform: [{ scale: 0.98 }] }]}
    >
      <Txt weight="bold" size={16} numberOfLines={1} style={{ flexShrink: 1 }}>
        {label}
      </Txt>
      <View style={styles.payCap}>{busy ? <ActivityIndicator color={colors.coralDeep} /> : <Icon name={icon} size={18} color={colors.coralDeep} />}</View>
    </Pressable>
  )
}

export function ReachText({ reach }: { reach: Reach | undefined }) {
  if (!reach || reach === 'checking')
    return (
      <Txt size={13} color={colors.muted}>
        Checking…
      </Txt>
    )
  if (reach === 'private')
    return (
      <Txt weight="semi" size={13} color={colors.tealDeep}>
        Private
      </Txt>
    )
  return (
    <Txt weight="semi" size={13} color={colors.coralDeep}>
      Can’t receive privately yet
    </Txt>
  )
}

export function LineIcon({ state }: { state: LineState['state'] | 'pending' | undefined }) {
  if (state === 'paying') return <ActivityIndicator color={colors.ink} style={styles.lineIcon} />
  if (state === 'paid')
    return (
      <View style={[styles.lineIcon, { backgroundColor: colors.teal }]}>
        <Icon name="check" size={15} color={colors.white} />
      </View>
    )
  if (state === 'failed')
    return (
      <View style={[styles.lineIcon, { backgroundColor: colors.coralSoft }]}>
        <Icon name="close" size={15} color={colors.coralDeep} />
      </View>
    )
  return (
    <View style={[styles.lineIcon, { backgroundColor: colors.sunken }]}>
      <Icon name="clock" size={15} color={colors.muted} />
    </View>
  )
}

export function Problem({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <View style={styles.problem} accessibilityRole="alert">
      <Icon name="info" size={18} />
      <Txt weight="semi" size={14} style={{ flex: 1, lineHeight: 20 }}>
        {text}
      </Txt>
    </View>
  )
}

export const businessStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  rule: { borderTopWidth: 1, borderColor: colors.sunken },
  amount: {
    width: 104,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.paper,
    paddingHorizontal: 12,
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.ink,
    textAlign: 'right',
  },
})

const styles = StyleSheet.create({
  card: { borderRadius: 24, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.surface, overflow: 'hidden' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26, marginBottom: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  input: {
    height: 50,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.white,
    paddingHorizontal: 14,
    fontFamily: fonts.semi,
    fontSize: 16,
    color: colors.ink,
  },
  pay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    height: 56,
    borderRadius: 28,
    paddingLeft: 22,
    paddingRight: 6,
    backgroundColor: colors.coral,
  },
  payOff: { opacity: 0.45 },
  payCap: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  lineIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  problem: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: 16, backgroundColor: colors.coralSoft },
})
