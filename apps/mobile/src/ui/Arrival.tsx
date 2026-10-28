import * as Haptics from 'expo-haptics'
import { type ReactNode, useEffect, useState } from 'react'
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native'
import {
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Path } from 'react-native-svg'
import { colors, pair } from '@/lib/theme'
import Animated from '@/ui/animated'
import { KoviPeek, peekEdge } from './art'
import { Icon } from './Icon'
import { Burst } from './motion'
import { Txt } from './primitives'

/**
 * A private payment arriving, drawn as what it is: a letter sealed for one person. The envelope
 * breaks its seal and opens, the card with the amount rises out, and the sender's note decodes in
 * front of you, because it really was sealed for you and opened on this phone. With Reduce Motion
 * on, everything is simply there, already open.
 */

/** When each beat lands, in ms from the screen appearing. */
export const beats = {
  seal: 380,
  open: 760,
  letter: 1020,
  copy: 1180,
  note: 1420,
  kovi: 1500,
} as const

/**
 * The envelope, teal (money arriving), with a coral seal over its flap. `amount` and `from` are on
 * the card inside. The seal pulses and breaks with a ripple, the flap folds up behind the card, and
 * the card rises out with a few sparkles.
 */
export function SealedEnvelope({
  width,
  amount,
  from,
  to,
}: {
  width: number
  amount: string
  from: string
  to?: string
}) {
  const still = useReducedMotion()
  const height = Math.round(width * 0.62)
  const flapH = Math.round(height * 0.56)
  const rise = Math.round(height * 0.52)
  /** Room above the envelope for the open flap and the risen card. */
  const head = Math.max(flapH, rise) + 8

  const seal = useSharedValue(still ? 0 : 1)
  const flap = useSharedValue(still ? 1 : 0)
  const lift = useSharedValue(still ? 1 : 0)
  const drop = useSharedValue(still ? 1 : 0)
  const ripple = useSharedValue(still ? 1 : 0)

  useEffect(() => {
    if (still) return
    drop.value = withSpring(1, { damping: 14, stiffness: 140 })
    seal.value = withDelay(
      beats.seal,
      withSequence(
        withTiming(1.16, { duration: 150 }),
        withTiming(1, { duration: 130 }),
        withDelay(60, withTiming(0, { duration: 170 })),
      ),
    )
    ripple.value = withDelay(
      beats.seal + 300,
      withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }),
    )
    flap.value = withDelay(
      beats.open,
      withTiming(1, { duration: 380, easing: Easing.inOut(Easing.cubic) }),
    )
    lift.value = withDelay(beats.letter, withSpring(1, { damping: 12, stiffness: 105, mass: 0.9 }))
    const tap = setTimeout(
      () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
      beats.seal,
    )
    return () => clearTimeout(tap)
  }, [still, drop, seal, ripple, flap, lift])

  const whole = useAnimatedStyle(() => ({
    opacity: drop.value,
    transform: [{ translateY: (1 - drop.value) * -24 }, { scale: 0.9 + drop.value * 0.1 }],
  }))
  const flapFront = useFlap(flap, flapH, true)
  const flapBack = useFlap(flap, flapH, false)
  const card = useAnimatedStyle(() => ({
    transform: [{ translateY: -lift.value * rise }, { rotate: `${-lift.value * 2}deg` }],
  }))
  const sealStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, seal.value * 1.4),
    transform: [{ scale: seal.value }],
  }))
  const labelStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, flap.value * 2) }))
  const rippleStyle = useAnimatedStyle(() => ({
    opacity: ripple.value > 0 && ripple.value < 1 ? 0.8 * (1 - ripple.value) : 0,
    transform: [{ scale: 0.5 + ripple.value * 2.6 }],
  }))

  const r = 18
  const w = width - 2
  // The front: side and bottom flaps meeting in a V under the top flap's tip, so the card can't be
  // seen until the envelope opens.
  const notch = Math.round(height * 0.5)
  const frontPath = `M1 1 L${width / 2} ${notch} L${w + 1} 1 V${height - 1 - r} Q${w + 1} ${height - 1} ${w + 1 - r} ${height - 1} H${1 + r} Q1 ${height - 1} 1 ${height - 1 - r} Z`
  const flapPath = `M1 1 H${w + 1} L${width / 2 + 14} ${flapH - 6} Q${width / 2} ${flapH + 4} ${width / 2 - 14} ${flapH - 6} Z`
  const sealTop = head + flapH - 30
  const cardTop = head + height * 0.08

  return (
    <Animated.View
      style={[{ width, height: head + height }, whole]}
      accessible
      accessibilityLabel={`A sealed envelope from ${from}, opening. ${amount} inside.`}
    >
      {/* The back of the envelope. */}
      <View style={[styles.back, { top: head, height }]} />
      {/* The flap, opened: folded up behind the card. */}
      <Animated.View
        style={[styles.flap, { top: head, height: flapH }, flapBack]}
        pointerEvents="none"
      >
        <Svg width={width} height={flapH + 6}>
          <Path
            d={flapPath}
            fill={colors.tealDeep}
            stroke={colors.ink}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        </Svg>
      </Animated.View>
      {/* The card inside. */}
      <Animated.View
        style={[
          styles.card,
          { top: cardTop, left: width * 0.08, right: width * 0.08, height: height * 0.84 },
          card,
        ]}
      >
        <Txt weight="semi" size={13} color={colors.muted} numberOfLines={1}>
          From {from}
        </Txt>
        <Txt
          weight="bold"
          size={Math.round(width * 0.16)}
          style={{ letterSpacing: -1.5 }}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {amount}
        </Txt>
        <View style={styles.cardLock}>
          <Icon name="lock" size={12} color={colors.muted} strokeWidth={2.4} />
          <Txt weight="semi" size={11} color={colors.muted}>
            Sealed for you
          </Txt>
        </View>
      </Animated.View>
      {/* The front. */}
      <View
        style={{ position: 'absolute', left: 0, top: head, width, height }}
        pointerEvents="none"
      >
        <Svg width={width} height={height}>
          <Path
            d={frontPath}
            fill={colors.teal}
            stroke={colors.ink}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        </Svg>
      </View>
      {/* Addressed to you, and opened here: your keys are the only ones that open it. It shows once
          the seal over it has broken. */}
      <Animated.View
        style={[styles.label, { top: head + height * 0.66, width }, labelStyle]}
        pointerEvents="none"
      >
        {to ? (
          <Txt weight="bold" size={16} color={colors.white} numberOfLines={1}>
            For {to}
          </Txt>
        ) : null}
        <Txt weight="medium" size={12} color="#DCEBEA" numberOfLines={1}>
          Opened on this phone, with your keys
        </Txt>
      </Animated.View>
      {/* The flap, shut, with the seal on its tip. */}
      <Animated.View
        style={[styles.flap, { top: head, height: flapH }, flapFront]}
        pointerEvents="none"
      >
        <Svg width={width} height={flapH + 6}>
          <Path
            d={flapPath}
            fill={colors.tealLight}
            stroke={colors.ink}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        </Svg>
      </Animated.View>
      <Animated.View
        style={[styles.ripple, { top: sealTop, left: width / 2 - 26 }, rippleStyle]}
        pointerEvents="none"
      />
      <Animated.View
        style={[styles.seal, { top: sealTop, left: width / 2 - 26 }, sealStyle]}
        pointerEvents="none"
      >
        <Icon name="lock" size={22} color={colors.white} strokeWidth={2.4} />
      </Animated.View>
      {still ? null : (
        <Burst
          spots={[
            {
              x: width * 0.06,
              y: head - rise * 0.55,
              size: 22,
              fill: colors.yellow,
              delay: beats.letter + 160,
            },
            {
              x: width * 0.95,
              y: head - rise * 0.8,
              size: 26,
              fill: colors.white,
              delay: beats.letter + 260,
            },
            {
              x: width * 0.9,
              y: head + height * 0.2,
              size: 16,
              fill: colors.yellow,
              delay: beats.letter + 380,
            },
            {
              x: width * 0.03,
              y: head + height * 0.12,
              size: 14,
              fill: colors.white,
              delay: beats.letter + 470,
            },
          ]}
        />
      )}
    </Animated.View>
  )
}

/**
 * The flap folds about its top edge, flat, as paper does: shut, it covers the card; past halfway,
 * it's behind it, pointing up.
 */
function useFlap(flap: SharedValue<number>, height: number, front: boolean) {
  return useAnimatedStyle(() => ({
    opacity: front ? (flap.value < 0.5 ? 1 : 0) : flap.value >= 0.5 ? 1 : 0,
    transform: [
      { translateY: -height / 2 },
      { scaleY: 1 - 2 * flap.value },
      { translateY: height / 2 },
    ],
  }))
}

const CIPHER = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&'

/**
 * `text` as it's decrypted: scrambled characters settling into the real ones, left to right, over
 * `ms`, starting after `delay`. Spaces stay spaces, so the shape of the words shows first.
 */
export function useDecoded(text: string, delay: number, ms = 700) {
  const still = useReducedMotion()
  const scramble = (keep: number) =>
    [...text]
      .map((c, i) =>
        i < keep || c === ' ' ? c : (CIPHER[Math.floor(Math.random() * CIPHER.length)] ?? c),
      )
      .join('')
  const [shown, setShown] = useState(() => (still ? text : scramble(0)))
  useEffect(() => {
    if (still) return setShown(text)
    let frame = 0
    let began = 0
    let last = 0
    const step = (now: number) => {
      if (!began) began = now
      const p = Math.min(1, (now - began) / ms)
      // A new scramble every few frames, not every one: it reads as decoding, not noise.
      if (now - last > 45 || p === 1) {
        last = now
        setShown(p === 1 ? text : scramble(Math.floor(p * text.length)))
      }
      if (p < 1) frame = requestAnimationFrame(step)
    }
    const timer = setTimeout(() => {
      frame = requestAnimationFrame(step)
    }, delay)
    return () => {
      clearTimeout(timer)
      cancelAnimationFrame(frame)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, delay, ms, still])
  return shown
}

/** The sender's note, sealed in the payment, decoding as it's opened: a slip of paper taped down, with a lock. */
export function DecodedNote({
  text,
  caption,
  delay,
}: {
  text: string
  caption: string
  delay: number
}) {
  const shown = useDecoded(text, delay)
  return (
    <View
      style={styles.slipWrap}
      accessible
      accessibilityLabel={`Private note: ${text}. ${caption}`}
    >
      <View style={styles.slip}>
        <View style={styles.tape} />
        <View style={styles.slipLock}>
          <Icon name="lock" size={12} color={colors.white} strokeWidth={2.4} />
          <Txt weight="semi" size={11} color={colors.white}>
            Private note
          </Txt>
        </View>
        <Txt weight="semi" size={20} style={{ lineHeight: 26, letterSpacing: -0.3 }}>
          “{shown}”
        </Txt>
        <Txt size={12} color={colors.onTint}>
          {caption}
        </Txt>
      </View>
    </View>
  )
}

/**
 * Kovi, peeking over the edge of the sheet below him with a whisper. Put him just before that
 * sheet, so it hides him until he rises, and the sheet's top edge is the edge he holds.
 */
export function PeekingKovi({
  width = 150,
  whisper,
  style,
}: {
  width?: number
  whisper: string
  style?: StyleProp<ViewStyle>
}) {
  const still = useReducedMotion()
  const up = useSharedValue(still ? 1 : 0)
  const said = useSharedValue(still ? 1 : 0)
  useEffect(() => {
    if (still) return
    up.value = withDelay(beats.kovi, withSpring(1, { damping: 11, stiffness: 120 }))
    said.value = withDelay(beats.kovi + 420, withSpring(1, { damping: 10, stiffness: 170 }))
  }, [still, up, said])
  const edge = Math.round((width / 2) * peekEdge)
  // Two points low, so the edge drawn under his hands stays behind the sheet's own edge.
  const rising = useAnimatedStyle(() => ({
    opacity: up.value > 0.02 ? 1 : 0,
    transform: [{ translateY: 2 + (1 - up.value) * edge * 1.1 }],
  }))
  const bubble = useAnimatedStyle(() => ({
    opacity: Math.min(1, said.value * 1.4),
    transform: [{ scale: 0.6 + said.value * 0.4 }],
  }))
  return (
    <View pointerEvents="none" style={[{ height: edge, width, alignSelf: 'center' }, style]}>
      <Animated.View style={[{ position: 'absolute', top: 0, left: 0 }, rising]}>
        <KoviPeek width={width} />
      </Animated.View>
      <Animated.View style={[styles.whisper, { left: width * 0.72, top: -6 }, bubble]}>
        <Txt weight="semi" size={13} numberOfLines={1}>
          {whisper}
        </Txt>
        <View style={styles.whisperTail} />
      </Animated.View>
    </View>
  )
}

/** The sheet under the moment, sliding up from below as the envelope opens; there already with Reduce Motion on. */
export function SlideUp({
  at,
  children,
  style,
}: {
  at: number
  children: ReactNode
  style?: StyleProp<ViewStyle>
}) {
  const still = useReducedMotion()
  const v = useSharedValue(still ? 1 : 0)
  useEffect(() => {
    if (still) return
    v.value = withDelay(at, withSpring(1, { damping: 17, stiffness: 120, mass: 0.9 }))
  }, [still, at, v])
  const anim = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - v.value) * 460 }] }))
  return <Animated.View style={[style, anim]}>{children}</Animated.View>
}

/** Content that rises in on a beat, or is simply there with Reduce Motion on. */
export function OnBeat({
  at,
  children,
  style,
}: {
  at: number
  children: ReactNode
  style?: StyleProp<ViewStyle>
}) {
  const still = useReducedMotion()
  const v = useSharedValue(still ? 1 : 0)
  useEffect(() => {
    if (still) return
    v.value = withDelay(at, withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }))
  }, [still, at, v])
  const anim = useAnimatedStyle(() => ({
    opacity: v.value,
    transform: [{ translateY: (1 - v.value) * 14 }],
  }))
  return <Animated.View style={[anim, style]}>{children}</Animated.View>
}

const styles = StyleSheet.create({
  back: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.tealDeep,
  },
  flap: { position: 'absolute', left: 0, right: 0 },
  label: { position: 'absolute', left: 0, alignItems: 'center', gap: 1, paddingHorizontal: 16 },
  card: {
    position: 'absolute',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: 'center',
    paddingTop: 12,
    paddingHorizontal: 12,
    gap: 2,
  },
  cardLock: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ripple: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: colors.coral,
  },
  seal: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.coral,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slipWrap: { paddingTop: 10 },
  slip: {
    transform: [{ rotate: '-1.2deg' }],
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: 18,
    backgroundColor: pair('#F6E7C8', '#1F1A12'),
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 12,
    gap: 4,
  },
  tape: {
    position: 'absolute',
    top: -11,
    alignSelf: 'center',
    width: 70,
    height: 20,
    borderRadius: 3,
    backgroundColor: pair('rgba(169, 201, 201, 0.85)', 'rgba(95, 165, 169, 0.6)'),
    transform: [{ rotate: '3deg' }],
  },
  slipLock: {
    position: 'absolute',
    top: -12,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 24,
    paddingHorizontal: 9,
    borderRadius: 12,
    backgroundColor: colors.fill,
  },
  whisper: {
    position: 'absolute',
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.line,
    justifyContent: 'center',
  },
  whisperTail: {
    position: 'absolute',
    bottom: -6,
    left: 12,
    width: 10,
    height: 10,
    backgroundColor: colors.surface,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: colors.line,
    transform: [{ rotate: '45deg' }],
  },
})
