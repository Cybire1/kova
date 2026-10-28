import * as Haptics from 'expo-haptics'
import { Image } from 'expo-image'
import { Pressable, StyleSheet, View } from 'react-native'
import { type DisplayCurrency, formatLocal } from '@/lib/money'
import { colors, pair } from '@/lib/theme'
import { Icon } from './Icon'
import { Txt } from './primitives'

/** A catalogue price ("4.50") as the till and the stall show it. */
export const dollars = (price: string | number) =>
  `$${Number(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** "about ₦6,188" beside a dollar price, for people who think in another currency. */
export const about = (price: string | number, currency: DisplayCurrency) =>
  currency === 'USD' ? null : `about ${formatLocal(Number(price), currency)}`

const tones = [colors.tealSoft, colors.coralSoft, colors.sunken, pair('#F3D6D0', '#2A1D1A')]

/** What an item looks like everywhere: its photo, or its first letter on a tone picked from its name. */
export function ItemFace({
  item,
  size = 56,
  radius,
}: {
  item: { name: string; image_url: string | null }
  size?: number
  radius?: number
}) {
  const r = radius ?? Math.round(size * 0.3)
  if (item.image_url)
    return (
      <Image
        source={{ uri: item.image_url }}
        style={{ width: size, height: size, borderRadius: r, backgroundColor: colors.sunken }}
        contentFit="cover"
        transition={180}
        accessible={false}
      />
    )
  const tone = tones[[...item.name].reduce((n, c) => n + c.charCodeAt(0), 0) % tones.length]
  return (
    <View
      style={[styles.letter, { width: size, height: size, borderRadius: r, backgroundColor: tone }]}
    >
      <Txt weight="bold" size={Math.round(size * 0.4)}>
        {item.name.trim().charAt(0).toUpperCase()}
      </Txt>
    </View>
  )
}

/** One fewer, how many, one more. */
export function Stepper({
  value,
  onChange,
  name,
  max = 99,
  small,
}: {
  value: number
  onChange: (n: number) => void
  name: string
  max?: number
  small?: boolean
}) {
  const size = small ? 32 : 38
  const step = (n: number) => {
    void Haptics.selectionAsync()
    onChange(Math.max(0, Math.min(max, n)))
  }
  return (
    <View style={[styles.stepper, { height: size + 4, borderRadius: (size + 4) / 2 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`One less ${name}`}
        hitSlop={6}
        onPress={() => step(value - 1)}
        style={[styles.stepKey, { width: size, height: size }]}
      >
        <Icon name={value === 1 ? 'trash' : 'minus'} size={small ? 15 : 17} strokeWidth={2.2} />
      </Pressable>
      <Txt
        weight="bold"
        size={small ? 15 : 17}
        style={{ minWidth: 22, textAlign: 'center' }}
        accessibilityLiveRegion="polite"
      >
        {value}
      </Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`One more ${name}`}
        hitSlop={6}
        onPress={() => step(value + 1)}
        style={[styles.stepKey, { width: size, height: size }]}
      >
        <Icon name="plus" size={small ? 15 : 17} strokeWidth={2.2} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  letter: { alignItems: 'center', justifyContent: 'center' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 1,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  stepKey: { alignItems: 'center', justifyContent: 'center' },
})
