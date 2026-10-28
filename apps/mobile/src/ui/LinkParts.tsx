import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useAnimatedStyle, useSharedValue, withDelay, withSpring } from 'react-native-reanimated'
import Svg, { Path } from 'react-native-svg'
import { colors, pair } from '@/lib/theme'
import Animated from '@/ui/animated'
import { Coin } from './art'
import { Txt } from './primitives'

/**
 * A link, drawn as what it is: an envelope with the dollars inside. The card with the amount sits
 * in the pocket; `open` lifts it out (claimed, or handed over), with a little spring.
 */
export function Envelope({
  width = 250,
  amount,
  caption,
  open = false,
  delay = 0,
  tone = 'coral',
}: {
  width?: number
  amount: string
  caption?: string
  open?: boolean
  delay?: number
  /** Coral while the dollars wait in it; teal once they've been claimed or came back. */
  tone?: 'coral' | 'teal' | 'muted'
}) {
  const height = Math.round(width * 0.6)
  const rise = Math.round(height * 0.42)
  const lift = useSharedValue(0)
  useEffect(() => {
    lift.value = withDelay(
      delay,
      withSpring(open ? 1 : 0, { damping: 13, stiffness: 120, mass: 0.9 }),
    )
  }, [open, delay, lift])
  const card = useAnimatedStyle(() => ({
    transform: [{ translateY: -lift.value * rise }, { rotate: `${-lift.value * 2.5}deg` }],
  }))

  const back =
    tone === 'coral' ? colors.coralDeep : tone === 'teal' ? colors.tealDeep : colors.muted
  const front = tone === 'coral' ? colors.coral : tone === 'teal' ? colors.teal : '#8A9596'
  const pocket = Math.round(height * 0.68)
  const notch = Math.round(pocket * 0.5)
  const r = 18
  const w = width - 2
  const h = pocket - 2
  // The pocket's top is the V where the side flaps meet; its bottom keeps the envelope's corners.
  const path = `M1 1 L${width / 2} ${notch} L${w + 1} 1 V${h + 1 - r} Q${w + 1} ${h + 1} ${w + 1 - r} ${h + 1} H${1 + r} Q1 ${h + 1} 1 ${h + 1 - r} Z`

  return (
    <View
      style={{ width, height: height + rise, justifyContent: 'flex-end' }}
      accessible
      accessibilityLabel={`An envelope with ${amount} in it`}
    >
      <View style={[styles.back, { height, backgroundColor: back }]} />
      <Animated.View
        style={[
          styles.card,
          { left: width * 0.09, right: width * 0.09, height: height * 0.86, bottom: height * 0.08 },
          card,
        ]}
      >
        {caption ? (
          <Txt weight="semi" size={13} color={colors.muted}>
            {caption}
          </Txt>
        ) : null}
        <Txt
          weight="bold"
          size={Math.round(width * 0.17)}
          style={{ letterSpacing: -1.5 }}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {amount}
        </Txt>
      </Animated.View>
      <View style={{ position: 'absolute', bottom: 0, width, height: pocket }} pointerEvents="none">
        <Svg width={width} height={pocket}>
          <Path d={path} fill={front} stroke={colors.ink} strokeWidth={2} strokeLinejoin="round" />
        </Svg>
        <View style={[styles.seal, { top: notch - 22, left: width / 2 - 22 }]}>
          <Coin size={44} />
        </View>
      </View>
    </View>
  )
}

/** A small envelope for list rows, in the colour of where the link stands. */
export function EnvelopeBadge({
  size = 40,
  tone = 'coral',
}: {
  size?: number
  tone?: 'coral' | 'teal' | 'muted'
}) {
  const h = Math.round(size * 0.72)
  const fill = tone === 'coral' ? colors.coral : tone === 'teal' ? colors.tealSoft : colors.sunken
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={h}>
        <Path
          d={`M1 4 Q1 1 4 1 H${size - 4} Q${size - 1} 1 ${size - 1} 4 V${h - 4} Q${size - 1} ${h - 1} ${size - 4} ${h - 1} H4 Q1 ${h - 1} 1 ${h - 4} Z`}
          fill={fill}
          stroke={colors.ink}
          strokeWidth={2}
        />
        <Path
          d={`M2 3 L${size / 2} ${h * 0.58} L${size - 2} 3`}
          fill="none"
          stroke={colors.ink}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </Svg>
    </View>
  )
}

/** The sender's note on a link: a slip of paper taped down. Unlike a private note, it isn't sealed. */
export function NoteSlip({ text, caption }: { text: string; caption?: string }) {
  return (
    <View
      style={styles.slipWrap}
      accessible
      accessibilityLabel={`Note: ${text}${caption ? `. ${caption}` : ''}`}
    >
      <View style={styles.slip}>
        <View style={styles.tape} />
        <Txt weight="semi" size={20} style={{ lineHeight: 26 }}>
          “{text}”
        </Txt>
        {caption ? (
          <Txt size={13} color={colors.onTint}>
            {caption}
          </Txt>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  back: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.line,
  },
  card: {
    position: 'absolute',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: 'center',
    paddingTop: 12,
    paddingHorizontal: 12,
  },
  seal: { position: 'absolute' },
  slipWrap: { paddingHorizontal: 28, paddingTop: 10 },
  slip: {
    transform: [{ rotate: '-1.5deg' }],
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: 18,
    backgroundColor: pair('#F6E7C8', '#1F1A12'),
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 14,
    gap: 6,
  },
  tape: {
    position: 'absolute',
    top: -11,
    alignSelf: 'center',
    width: 74,
    height: 20,
    borderRadius: 3,
    backgroundColor: pair('rgba(169, 201, 201, 0.85)', 'rgba(95, 165, 169, 0.6)'),
    transform: [{ rotate: '3deg' }],
  },
})
