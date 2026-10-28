import { type ColorValue, StyleSheet, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { colors } from '@/lib/theme'
import { Coin, Plane } from './art'
import { Icon, type IconName } from './Icon'
import { Sticker, Txt } from './primitives'

/**
 * A small action tile that tells its own story: an icon in a solid disc, a dotted path, and
 * something travelling along it — the plane leaving on Send, a coin dropping in on Request.
 */
export function ActionTile({ kind, onPress }: { kind: 'send' | 'request'; onPress: () => void }) {
  const send = kind === 'send'
  const tone: {
    fill: ColorValue
    disc: ColorValue
    icon: IconName
    label: string
    caption: string
  } = send
    ? {
        fill: colors.coralSoft,
        disc: colors.coral,
        icon: 'send',
        label: 'Send',
        caption: 'Lands in seconds',
      }
    : {
        fill: colors.surface,
        disc: colors.teal,
        icon: 'receive',
        label: 'Request',
        caption: 'Get paid by link',
      }

  return (
    <Sticker
      fill={tone.fill}
      radius={26}
      style={{ flex: 1 }}
      onPress={onPress}
      accessibilityLabel={`${tone.label}. ${tone.caption}`}
    >
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width="100%" height="100%" viewBox="0 0 140 96" preserveAspectRatio="xMaxYMin meet">
          {send ? (
            <Path
              d="M40 30 C62 30 74 14 100 12"
              fill="none"
              stroke={colors.ink}
              strokeWidth={1.8}
              strokeDasharray="1 5"
              strokeLinecap="round"
              opacity={0.55}
            />
          ) : (
            <Path
              d="M112 4 C112 18 90 22 66 30"
              fill="none"
              stroke={colors.ink}
              strokeWidth={1.8}
              strokeDasharray="1 5"
              strokeLinecap="round"
              opacity={0.55}
            />
          )}
        </Svg>
      </View>
      <View style={send ? styles.plane : styles.coin} pointerEvents="none">
        {send ? <Plane size={46} /> : <Coin size={26} symbol="$" />}
      </View>
      <View style={styles.body}>
        <View style={[styles.disc, { backgroundColor: tone.disc }]}>
          <Icon name={tone.icon} size={18} color={colors.white} strokeWidth={2.2} />
        </View>
        <Txt weight="bold" size={17} style={{ letterSpacing: -0.3 }}>
          {tone.label}
        </Txt>
      </View>
    </Sticker>
  )
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: 12, paddingHorizontal: 14, justifyContent: 'space-between' },
  disc: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  plane: { position: 'absolute', right: -4, top: -8, transform: [{ rotate: '-8deg' }] },
  coin: { position: 'absolute', right: 30, top: 10, transform: [{ rotate: '-14deg' }] },
})
