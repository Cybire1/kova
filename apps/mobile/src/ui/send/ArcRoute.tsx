import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  ZoomIn,
  ZoomOut,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Path } from 'react-native-svg'
import { colors } from '@/lib/theme'
import { Avatar, Flyer } from '../art'
import { Icon } from '../Icon'
import { Txt } from '../primitives'

const AnimatedPath = Animated.createAnimatedComponent(Path)

const FACE = 60
const KOVI = 70
const HEIGHT = 132
/** The faces sit on this line; the arc rises above it. */
const BASE = 104

export type Leg = 'waiting' | 'flying' | 'landed'

/**
 * You, Kovi's dotted arc, and them: the route the money takes, drawn the way Kova draws every
 * send. While waiting Kovi hovers at the top of the arc; on send he flies it, the dots marching
 * under him, and lands on their face, which gets a tick. Sent privately, their face wears a padlock.
 */
export function ArcRoute({
  width,
  you,
  them,
  leg,
  privately,
}: {
  width: number
  you: { name: string; id: string }
  them: { name: string; id: string }
  leg: Leg
  privately?: boolean
}) {
  const reduced = useReducedMotion()
  const from = { x: FACE / 2 + 4, y: BASE - FACE / 2 - 6 }
  const to = { x: width - FACE / 2 - 4, y: BASE - FACE / 2 - 6 }
  const via = { x: width / 2, y: -10 }
  const d = `M${from.x} ${from.y} Q${via.x} ${via.y} ${to.x} ${to.y}`

  const t = useSharedValue(0.5)
  const hover = useSharedValue(0)
  const march = useSharedValue(0)
  const tick = useSharedValue(0)

  useEffect(() => {
    if (reduced) {
      t.value = leg === 'landed' ? 1 : 0.5
      tick.value = leg === 'landed' ? 1 : 0
      return
    }
    if (leg === 'waiting') {
      t.value = withSpring(0.5, { damping: 16, stiffness: 120 })
      hover.value = withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.sin) }), -1, true)
      tick.value = 0
    } else if (leg === 'flying') {
      hover.value = withTiming(0, { duration: 200 })
      // Back to your side for a run-up, then most of the way across, waiting there for the chain.
      t.value = withSequence(withTiming(0.04, { duration: 260, easing: Easing.out(Easing.quad) }), withTiming(0.82, { duration: 1100, easing: Easing.bezier(0.3, 0, 0.2, 1) }))
      march.value = withRepeat(withTiming(1, { duration: 420, easing: Easing.linear }), -1)
    } else {
      t.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) })
      tick.value = withSequence(withTiming(0, { duration: 200 }), withSpring(1, { damping: 9, stiffness: 180 }))
      march.value = 0
    }
  }, [leg, reduced, t, hover, march, tick])

  const kovi = useAnimatedStyle(() => {
    const u = t.value
    const a = 1 - u
    const x = a * a * from.x + 2 * a * u * via.x + u * u * to.x
    const y = a * a * from.y + 2 * a * u * via.y + u * u * to.y - hover.value * 6
    const dx = 2 * a * (via.x - from.x) + 2 * u * (to.x - via.x)
    const dy = 2 * a * (via.y - from.y) + 2 * u * (to.y - via.y)
    // Shrinks into their face as he lands.
    const land = Math.max(0, (u - 0.9) / 0.1)
    return {
      opacity: 1 - land,
      transform: [{ translateX: x - KOVI / 2 }, { translateY: y - KOVI / 2 }, { rotate: `${Math.atan2(dy, dx) * 0.8}rad` }, { scale: 1 - land * 0.6 }],
    }
  })
  const dots = useAnimatedProps(() => ({ strokeDashoffset: -march.value * 14 }))
  const badge = useAnimatedStyle(() => ({ opacity: Math.min(1, tick.value * 2), transform: [{ scale: tick.value }] }))
  const theirFace = useAnimatedStyle(() => ({ transform: [{ scale: 1 + Math.sin(Math.min(1, tick.value) * Math.PI) * 0.12 }] }))

  return (
    <View style={{ width, height: HEIGHT }} accessibilityLabel={`From you to ${them.name}${privately ? ', privately' : ''}`}>
      <Svg width={width} height={BASE} style={StyleSheet.absoluteFill}>
        <AnimatedPath d={d} stroke={colors.ink} strokeWidth={3} strokeLinecap="round" strokeDasharray="0.1 14" fill="none" animatedProps={dots} />
      </Svg>
      <View style={[styles.person, { left: 0 }]}>
        <Avatar name={you.name} id={you.id} size={FACE} />
        <Txt weight="semi" size={13} numberOfLines={1}>
          You
        </Txt>
      </View>
      <View style={[styles.person, { right: 0 }]}>
        <Animated.View style={theirFace}>
          <Avatar name={them.name} id={them.id} size={FACE} />
          {privately ? (
            <Animated.View entering={ZoomIn.springify().damping(14)} exiting={ZoomOut.duration(160)} style={styles.lock}>
              <Icon name="lock" size={13} color={colors.white} strokeWidth={2.6} />
            </Animated.View>
          ) : null}
          <Animated.View style={[styles.tick, badge]}>
            <Icon name="check" size={14} color={colors.white} strokeWidth={3} />
          </Animated.View>
        </Animated.View>
        <Txt weight="semi" size={13} numberOfLines={1} style={{ maxWidth: 90 }}>
          {them.name.split(' ')[0]}
        </Txt>
      </View>
      <Animated.View pointerEvents="none" style={[styles.kovi, kovi]}>
        <Flyer size={KOVI} />
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  person: { position: 'absolute', top: BASE - FACE - 2, alignItems: 'center', gap: 4, width: FACE + 8 },
  tick: {
    position: 'absolute',
    right: -4,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.paper,
    backgroundColor: colors.positive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kovi: { position: 'absolute', left: 0, top: 0, width: KOVI, height: KOVI },
  lock: {
    position: 'absolute',
    right: -5,
    top: -4,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.paper,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
