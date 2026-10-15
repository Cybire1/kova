import { type ReactNode, useEffect } from 'react'
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { colors } from '@/lib/theme'
import { Coin, Flake, Sparkle } from './art'

type Point = { x: number; y: number }

/**
 * Carries its child along a quadratic curve from `from` to `to`, turning to face the way it
 * travels. Used for Kovi's flights: the route is the same curve the scene draws dotted.
 * `size` is the child's box; the curve is followed by the box's centre.
 */
export function Flight({
  from,
  via,
  to,
  size,
  duration = 5000,
  loop = true,
  children,
}: {
  from: Point
  via: Point
  to: Point
  size: number
  duration?: number
  loop?: boolean
  children: ReactNode
}) {
  const reduced = useReducedMotion()
  const t = useSharedValue(reduced ? 0.5 : 0)
  useEffect(() => {
    if (reduced) return
    const run = withTiming(1, { duration, easing: Easing.bezier(0.45, 0, 0.3, 1) })
    t.value = loop
      ? withRepeat(
          withSequence(withTiming(0, { duration: 0 }), run, withTiming(1, { duration: 700 })),
          -1,
        )
      : run
  }, [reduced, duration, loop, t])

  const style = useAnimatedStyle(() => {
    const u = t.value
    const a = 1 - u
    const x = a * a * from.x + 2 * a * u * via.x + u * u * to.x
    const y = a * a * from.y + 2 * a * u * via.y + u * u * to.y
    const dx = 2 * a * (via.x - from.x) + 2 * u * (to.x - via.x)
    const dy = 2 * a * (via.y - from.y) + 2 * u * (to.y - via.y)
    const angle = Math.atan2(dy, dx)
    const fade = loop ? Math.min(1, u / 0.08, (1 - u) / 0.1) : 1
    return {
      opacity: fade,
      transform: [
        { translateX: x - size / 2 },
        { translateY: y - size / 2 },
        { rotate: `${angle}rad` },
      ],
    }
  })
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left: 0, top: 0, width: size, height: size }, style]}
    >
      {children}
    </Animated.View>
  )
}

/** A gentle up-and-down float. */
export function Bob({
  children,
  distance = 6,
  duration = 2600,
  delay = 0,
  style,
}: {
  children: ReactNode
  distance?: number
  duration?: number
  delay?: number
  style?: StyleProp<ViewStyle>
}) {
  const reduced = useReducedMotion()
  const v = useSharedValue(0)
  useEffect(() => {
    if (reduced) return
    v.value = withDelay(
      delay,
      withRepeat(
        withTiming(1, { duration: duration / 2, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      ),
    )
  }, [reduced, duration, delay, v])
  const anim = useAnimatedStyle(() => ({ transform: [{ translateY: -v.value * distance }] }))
  return <Animated.View style={[anim, style]}>{children}</Animated.View>
}

/** A hop, like a cheer: up quickly, down, a rest, repeat. */
export function Hop({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion()
  const v = useSharedValue(0)
  useEffect(() => {
    if (reduced) return
    v.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 280, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 320, easing: Easing.bounce }),
        withTiming(0, { duration: 900 }),
      ),
      -1,
    )
  }, [reduced, v])
  const anim = useAnimatedStyle(() => ({ transform: [{ translateY: -v.value * 14 }] }))
  return <Animated.View style={[anim, style]}>{children}</Animated.View>
}

/** Rings that ripple out from a round button, like a contactless tap signal. */
export function Ping({
  size,
  color = colors.coral,
  delay = 0,
}: {
  size: number
  color?: string
  delay?: number
}) {
  const reduced = useReducedMotion()
  const v = useSharedValue(0)
  useEffect(() => {
    if (reduced) return
    v.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: 2400, easing: Easing.bezier(0.2, 0.7, 0.3, 1) }), -1),
    )
  }, [reduced, delay, v])
  const anim = useAnimatedStyle(() => ({
    opacity: 0.9 * (1 - v.value),
    transform: [{ scale: 1 + v.value * 0.6 }],
  }))
  if (reduced) return null
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { borderRadius: size / 2, borderWidth: 2, borderColor: color },
        anim,
      ]}
    />
  )
}

/**
 * Coins falling, for money arriving: single coins in every currency, each dropping on its own
 * timing with a spin and a sway, fading in and out so none are ever sliced by an edge.
 */
export function CoinRain({ width, height = 240 }: { width: number; height?: number }) {
  const coins = [
    { x: 0.1, size: 40, symbol: '$', delay: 0, dur: 2600, spin: 1 },
    { x: 0.3, size: 30, symbol: '€', delay: 900, dur: 2300, spin: -1 },
    { x: 0.52, size: 46, symbol: '$', delay: 400, dur: 2900, spin: 1 },
    { x: 0.74, size: 34, symbol: '£', delay: 1500, dur: 2500, spin: -1 },
    { x: 0.9, size: 42, symbol: '$', delay: 700, dur: 2700, spin: 1 },
    { x: 0.2, size: 28, symbol: '$', delay: 1900, dur: 2200, spin: -1 },
    { x: 0.64, size: 32, symbol: '€', delay: 2300, dur: 2400, spin: 1 },
    { x: 0.42, size: 26, symbol: '£', delay: 1200, dur: 2100, spin: -1 },
  ]
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width, height }}>
      {coins.map((c) => (
        <Tumbling
          key={`${c.x}`}
          x={c.x * width - c.size / 2}
          size={c.size}
          delay={c.delay}
          duration={c.dur}
          spin={c.spin}
          height={height}
        >
          <Coin size={c.size} symbol={c.symbol} />
        </Tumbling>
      ))}
    </View>
  )
}

function Tumbling({
  x,
  size,
  delay,
  duration,
  spin,
  height,
  children,
}: {
  x: number
  size: number
  delay: number
  duration: number
  spin: number
  height: number
  children: ReactNode
}) {
  const reduced = useReducedMotion()
  const v = useSharedValue(reduced ? 0.5 : 0)
  useEffect(() => {
    if (reduced) return
    v.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration, easing: Easing.in(Easing.quad) }), -1),
    )
  }, [reduced, delay, duration, v])
  const anim = useAnimatedStyle(() => {
    const p = v.value
    return {
      opacity: p < 0.15 ? p / 0.15 : p > 0.75 ? Math.max(0, (1 - p) / 0.25) : 1,
      transform: [
        { translateY: -size + p * (height + size * 0.2) },
        { translateX: Math.sin(p * Math.PI * 2) * 10 },
        { rotate: `${spin * p * 300}deg` },
        { scale: 0.85 + Math.sin(p * Math.PI) * 0.2 },
      ],
    }
  })
  return (
    <Animated.View style={[{ position: 'absolute', left: x, top: 0 }, anim]}>
      {children}
    </Animated.View>
  )
}

/** A hop that lands with a squash, like catching something heavy and happy. */
export function Bounce({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion()
  const v = useSharedValue(0)
  useEffect(() => {
    if (reduced) return
    v.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 320, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 300, easing: Easing.in(Easing.quad) }),
        withTiming(-1, { duration: 120 }),
        withTiming(0, { duration: 260, easing: Easing.out(Easing.back(3)) }),
        withTiming(0, { duration: 700 }),
      ),
      -1,
    )
  }, [reduced, v])
  const anim = useAnimatedStyle(() => {
    const up = Math.max(0, v.value)
    const squash = Math.max(0, -v.value)
    return {
      transform: [
        { translateY: -up * 22 + squash * 6 },
        { scaleX: 1 + squash * 0.12 - up * 0.04 },
        { scaleY: 1 - squash * 0.12 + up * 0.05 },
      ],
    }
  })
  return <Animated.View style={[anim, style]}>{children}</Animated.View>
}

/** Snow drifting down over a frozen thing: single flakes, each on its own speed and sway. */
export function Snowfall({ width, height }: { width: number; height: number }) {
  const flakes = [
    { x: 0.08, size: 16, delay: 0, dur: 6200 },
    { x: 0.22, size: 22, delay: 2400, dur: 7400 },
    { x: 0.38, size: 14, delay: 1200, dur: 5600 },
    { x: 0.55, size: 20, delay: 3600, dur: 6800 },
    { x: 0.7, size: 15, delay: 600, dur: 6000 },
    { x: 0.84, size: 24, delay: 3000, dur: 8000 },
    { x: 0.94, size: 13, delay: 4600, dur: 5800 },
  ]
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: 0, top: 0, width, height, overflow: 'hidden' }}
    >
      {flakes.map((f, i) => (
        <Falling
          key={f.x}
          x={f.x * width - f.size / 2}
          size={f.size}
          delay={f.delay}
          duration={f.dur}
          height={height}
        >
          <Flake i={i} size={f.size} />
        </Falling>
      ))}
    </View>
  )
}

function Falling({
  x,
  size,
  delay,
  duration,
  height,
  children,
}: {
  x: number
  size: number
  delay: number
  duration: number
  height: number
  children: ReactNode
}) {
  const reduced = useReducedMotion()
  const v = useSharedValue(reduced ? 0.4 : 0)
  useEffect(() => {
    if (reduced) return
    v.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1))
  }, [reduced, delay, duration, v])
  const anim = useAnimatedStyle(() => {
    const p = v.value
    return {
      opacity: p < 0.1 ? p / 0.1 : p > 0.85 ? (1 - p) / 0.15 : 0.75,
      transform: [
        { translateY: -size + p * (height + size) },
        { translateX: Math.sin(p * Math.PI * 3) * 8 },
        { rotate: `${p * 180}deg` },
      ],
    }
  })
  return (
    <Animated.View style={[{ position: 'absolute', left: x, top: 0 }, anim]}>
      {children}
    </Animated.View>
  )
}

/** Sparkles that burst in once, like confetti, when something succeeds. */
export function Burst({
  spots,
}: {
  spots: { x: number; y: number; size: number; fill: string; delay: number }[]
}) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {spots.map((spot) => (
        <PopIn
          key={`${spot.x},${spot.y}`}
          delay={spot.delay}
          style={{
            position: 'absolute',
            left: spot.x - spot.size / 2,
            top: spot.y - spot.size / 2,
          }}
        >
          <Sparkle size={spot.size} fill={spot.fill} />
        </PopIn>
      ))}
    </View>
  )
}

export function PopIn({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode
  delay?: number
  style?: StyleProp<ViewStyle>
}) {
  const reduced = useReducedMotion()
  const v = useSharedValue(reduced ? 1 : 0)
  useEffect(() => {
    if (reduced) return
    v.value = withDelay(delay, withSpring(1, { damping: 9, stiffness: 160 }))
  }, [reduced, delay, v])
  const anim = useAnimatedStyle(() => ({
    opacity: Math.min(1, v.value * 1.5),
    transform: [{ scale: v.value }, { rotate: `${(1 - v.value) * -30}deg` }],
  }))
  return <Animated.View style={[anim, style]}>{children}</Animated.View>
}
