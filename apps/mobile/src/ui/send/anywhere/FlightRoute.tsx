import { useEffect, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import {
  cancelAnimation,
  Easing,
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
import type { Network, Stage } from '@/lib/crosschain'
import { colors } from '@/lib/theme'
import Animated, { plain, useLook } from '@/ui/animated'
import { Plane } from '../../art'
import { Icon } from '../../Icon'
import { Txt } from '../../primitives'
import { ChainLogo } from './ChainLogo'

const AnimatedPath = Animated.createAnimatedComponent(Path)

const HEIGHT = 232
const STAMP = 52
const NODE = 30
const PLANE = 42
const GROUND = 158

/**
 * The flight, in a card: Monad on the left, their network on the right, Circle at the top of the
 * arc where it checks the burn. The plane takes off on the burn, climbs to Circle and waits there
 * while Circle signs, then comes down on their network; the route fills in coral behind it. If
 * they collect it themselves, it lands on a clock instead of a tick.
 */
export function FlightRoute({
  width,
  to,
  stage,
  clock,
}: {
  width: number
  to: Network
  stage: Stage
  clock: string
}) {
  const look = useLook()
  const reduced = useReducedMotion()
  const from = { x: 56, y: GROUND }
  const end = { x: width - 56, y: GROUND }
  const via = { x: width / 2, y: 12 }
  const d = `M${from.x} ${from.y} Q${via.x} ${via.y} ${end.x} ${end.y}`
  const apex = { x: width / 2, y: (from.y + 2 * via.y + end.y) / 4 }
  const length = useMemo(() => {
    let total = 0
    let px = from.x
    let py = from.y
    for (let i = 1; i <= 40; i++) {
      const u = i / 40
      const a = 1 - u
      const x = a * a * from.x + 2 * a * u * via.x + u * u * end.x
      const y = a * a * from.y + 2 * a * u * via.y + u * u * end.y
      total += Math.hypot(x - px, y - py)
      px = x
      py = y
    }
    return total
  }, [from.x, from.y, via.x, via.y, end.x, end.y])

  const t = useSharedValue(0)
  const hover = useSharedValue(0)
  const done = useSharedValue(0)
  const pulse = useSharedValue(0)

  useEffect(() => {
    const target = { burn: 0.15, attest: 0.5, mint: 1, landed: 1, ready: 1 }[stage]
    if (reduced) {
      t.value = target
      done.value = stage === 'landed' || stage === 'ready' ? 1 : 0
      return
    }
    pulse.value = 0
    pulse.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) }), -1)
    if (stage === 'burn') {
      t.value = withTiming(target, { duration: 850, easing: Easing.inOut(Easing.cubic) })
    } else if (stage === 'attest') {
      t.value = withTiming(target, { duration: 1500, easing: Easing.out(Easing.cubic) })
      hover.value = withRepeat(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      )
    } else {
      cancelAnimation(hover)
      hover.value = withTiming(0, { duration: 150 })
      t.value = withTiming(1, {
        duration: stage === 'mint' ? 1150 : 600,
        easing: Easing.inOut(Easing.cubic),
      })
      if (stage !== 'mint') {
        cancelAnimation(pulse)
        pulse.value = 0
        done.value = withSequence(withTiming(0, { duration: 500 }), withSpring(1, { damping: 9 }))
      }
    }
  }, [stage, reduced, t, hover, done, pulse])

  const plane = useAnimatedStyle(() => {
    const u = t.value
    const a = 1 - u
    const x = a * a * from.x + 2 * a * u * via.x + u * u * end.x
    const y = a * a * from.y + 2 * a * u * via.y + u * u * end.y - hover.value * 5
    const dx = 2 * a * (via.x - from.x) + 2 * u * (end.x - via.x)
    const dy = 2 * a * (via.y - from.y) + 2 * u * (end.y - via.y)
    const land = Math.max(0, (u - 0.92) / 0.08)
    return {
      opacity: 1 - land,
      transform: [
        { translateX: x - PLANE / 2 },
        { translateY: y - PLANE / 2 },
        // The painted plane points a little above the horizon; turn it onto the route.
        { rotate: `${Math.atan2(dy, dx) + 0.35}rad` },
        { scale: 1 - land * 0.5 },
      ],
    }
  })
  const trail = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - t.value) }))
  const ring = useAnimatedStyle(() => ({
    opacity: 0.5 * (1 - pulse.value),
    transform: [{ scale: 1 + pulse.value * 0.9 }],
  }))
  const badge = useAnimatedStyle(() => ({
    opacity: Math.min(1, done.value * 2),
    transform: [{ scale: done.value }],
  }))

  const atCircle = stage === 'attest'
  const atThem = stage === 'mint'
  const collect = stage === 'ready'

  return (
    <View
      style={[styles.card, { width, height: HEIGHT }]}
      accessibilityLabel={`From Monad to ${to.name}`}
    >
      <View style={styles.clock}>
        <Txt weight="bold" size={30} style={{ letterSpacing: -1 }}>
          {clock}
        </Txt>
      </View>
      <Svg width={width} height={HEIGHT} style={StyleSheet.absoluteFill}>
        <Path
          d={d}
          stroke={plain(colors.ink, look) as string}
          strokeOpacity={0.4}
          strokeWidth={2.5}
          strokeDasharray="0.1 8"
          strokeLinecap="round"
          fill="none"
        />
        <AnimatedPath
          d={d}
          stroke={plain(colors.coral, look) as string}
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeDasharray={`${length} ${length}`}
          fill="none"
          animatedProps={trail}
        />
      </Svg>

      <View style={[styles.stamp, { left: from.x - STAMP / 2, top: GROUND - STAMP / 2 }]}>
        <ChainLogo name="monad" size={STAMP} />
      </View>
      <Txt weight="bold" size={13} style={[styles.label, { left: from.x - 50 }]}>
        Monad
      </Txt>

      <View style={[styles.node, { left: apex.x - NODE / 2, top: apex.y - NODE / 2 }]}>
        {atCircle ? <Animated.View style={[styles.ring, ring]} /> : null}
        <ChainLogo name="usdc" size={NODE} />
      </View>
      <Txt
        weight="bold"
        size={12}
        color={colors.muted}
        style={[styles.label, { left: apex.x - 50, top: apex.y + NODE / 2 + 4 }]}
      >
        Circle
      </Txt>

      <View style={[styles.stamp, { left: end.x - STAMP / 2, top: GROUND - STAMP / 2 }]}>
        {atThem ? <Animated.View style={[styles.ring, ring]} /> : null}
        <ChainLogo name={to.id} size={STAMP} />
        <Animated.View
          style={[styles.badge, { backgroundColor: collect ? colors.coral : colors.teal }, badge]}
        >
          <Icon
            name={collect ? 'clock' : 'check'}
            size={12}
            color={collect ? colors.dark : colors.white}
            strokeWidth={3}
          />
        </Animated.View>
      </View>
      <Txt weight="bold" size={13} style={[styles.label, { left: end.x - 50 }]}>
        {to.name}
      </Txt>

      <Animated.View pointerEvents="none" style={[styles.plane, plane]}>
        <Plane size={PLANE} />
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 28,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  clock: { position: 'absolute', left: 0, right: 0, top: 16, alignItems: 'center' },
  stamp: { position: 'absolute', width: STAMP, height: STAMP },
  node: { position: 'absolute', width: NODE, height: NODE },
  ring: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    backgroundColor: colors.coral,
  },
  label: { position: 'absolute', width: 100, top: GROUND + STAMP / 2 + 6, textAlign: 'center' },
  badge: {
    position: 'absolute',
    right: -6,
    top: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plane: { position: 'absolute', left: 0, top: 0, width: PLANE, height: PLANE },
})
