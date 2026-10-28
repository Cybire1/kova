import * as Haptics from 'expo-haptics'
import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { colors } from '@/lib/theme'
import Animated from '@/ui/animated'
import { Icon } from '../Icon'
import { Txt } from '../primitives'

const HEIGHT = 60
const KNOB = 50
const PAD = (HEIGHT - KNOB) / 2
/** How far along the track counts as a decision. */
const COMMIT = 0.86
const spring = { damping: 20, stiffness: 260, mass: 0.7 }

/**
 * Slide to send: the one deliberate gesture between a review and money leaving. A tap can happen
 * by accident; a slide can't. The track fills coral (the colour of spending) behind the knob, a
 * tick marks the point of no return, and letting go short of it springs the knob home.
 * VoiceOver users get a plain "activate" action.
 */
export function SlideToSend({
  label,
  busy,
  disabled,
  onSend,
}: {
  label: string
  /** The money is moving: the knob waits at the end with a spinner. */
  busy: boolean
  disabled?: boolean
  onSend: () => void
}) {
  const [width, setWidth] = useState(0)
  const max = Math.max(0, width - KNOB - PAD * 2)
  const x = useSharedValue(0)
  const start = useSharedValue(0)
  const armed = useSharedValue(false)

  // At the end while the money moves (however the send began: a slide, or VoiceOver's activate),
  // and back home whenever it stops without finishing (Face ID cancelled, or a problem).
  useEffect(() => {
    x.value = withSpring(busy ? max : 0, spring)
  }, [busy, max, x])

  const tick = () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid)
  const commit = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
    onSend()
  }

  const pan = Gesture.Pan()
    .enabled(!disabled && !busy && max > 0)
    .activeOffsetX([-6, 6])
    .onBegin(() => {
      start.value = x.value
    })
    .onUpdate((e) => {
      const next = Math.min(max, Math.max(0, start.value + e.translationX))
      x.value = next
      const past = next >= max * COMMIT
      if (past !== armed.value) {
        armed.value = past
        if (past) scheduleOnRN(tick)
      }
    })
    .onEnd(() => {
      if (x.value >= max * COMMIT) {
        x.value = withSpring(max, spring)
        scheduleOnRN(commit)
      } else {
        x.value = withSpring(0, spring)
      }
      armed.value = false
    })

  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }))
  // Coral grows behind the knob as it moves, a pad wider so it rings it evenly; at rest it fades
  // away rather than sitting as a rim.
  const fill = useAnimatedStyle(() => ({
    width: x.value + KNOB + PAD * 2,
    opacity: interpolate(x.value, [0, 12], [0, 1], 'clamp'),
  }))
  const words = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [0, (max || 1) * 0.5], [1, 0], 'clamp'),
  }))

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityHint="Slide right to send, or double-tap"
      accessibilityState={{ disabled: !!disabled, busy }}
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={() => !disabled && !busy && commit()}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[styles.track, disabled && { opacity: 0.4 }]}
    >
      <Animated.View style={[styles.fill, fill]} />
      <Animated.View style={[styles.words, words, busy && { opacity: 0 }]} pointerEvents="none">
        <Txt weight="semi" size={17} color={colors.white}>
          {label}
        </Txt>
        <Chevrons />
      </Animated.View>
      {busy ? (
        <View style={styles.words} pointerEvents="none">
          <Txt weight="semi" size={17} color={colors.white} style={{ marginRight: KNOB }}>
            Sending
          </Txt>
        </View>
      ) : null}
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.knob, knob]} hitSlop={12}>
          {busy ? <ActivityIndicator color={colors.ink} /> : <Icon name="arrow" size={26} />}
        </Animated.View>
      </GestureDetector>
    </View>
  )
}

/** Three chevrons that light up left to right, pointing the way. */
function Chevrons() {
  return (
    <View style={{ flexDirection: 'row', marginLeft: 8 }}>
      {[0, 1, 2].map((i) => (
        <Chevron key={i} i={i} />
      ))}
    </View>
  )
}

function Chevron({ i }: { i: number }) {
  const reduced = useReducedMotion()
  const v = useSharedValue(0.35)
  useEffect(() => {
    if (reduced) return
    const ease = Easing.inOut(Easing.quad)
    v.value = withDelay(
      i * 140,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 360, easing: ease }),
          withTiming(0.35, { duration: 520, easing: ease }),
          withTiming(0.35, { duration: 400 }),
        ),
        -1,
      ),
    )
  }, [reduced, i, v])
  const style = useAnimatedStyle(() => ({ opacity: v.value }))
  return (
    <Animated.View style={[{ marginLeft: -6, transform: [{ rotate: '-90deg' }] }, style]}>
      <Icon name="chevronDown" size={18} color={colors.white} strokeWidth={2.5} />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  track: {
    height: HEIGHT,
    borderRadius: HEIGHT / 2,
    backgroundColor: colors.fill,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: HEIGHT / 2,
    backgroundColor: colors.coral,
  },
  words: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: KNOB,
  },
  knob: {
    position: 'absolute',
    left: PAD,
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
