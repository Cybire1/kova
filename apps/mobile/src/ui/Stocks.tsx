import {
  type MarketPeriod,
  marketLabel,
  ringFill,
  type StockHolding,
  shareLabel,
} from '@kova/monad'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native'
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg'
import { usePrefs } from '@/lib/prefs'
import { stockUsd, useStockHoldings } from '@/lib/stocks'
import { colors } from '@/lib/theme'
import { Icon } from './Icon'
import { Txt } from './primitives'

/**
 * The parts Stocks is drawn from. A share is a ring: what you own of one fills it, so "1/20 of a
 * share" reads at a glance, with the company's logo in the middle.
 */

const LOGOS = 'https://xstocks-metadata.backed.fi/logos/tokens'

/** The company's mark, from xStocks, cut round or square. */
export function StockLogo({
  uri,
  size = 42,
  round,
  outline = colors.ink,
}: {
  uri: string
  size?: number
  round?: boolean
  outline?: string | null
}) {
  return (
    <Image
      source={{ uri }}
      style={{
        width: size,
        height: size,
        borderRadius: round ? size / 2 : size * 0.3,
        borderWidth: outline ? 2 : 0,
        borderColor: outline ?? undefined,
        backgroundColor: colors.sunken,
      }}
      contentFit="cover"
      transition={150}
      accessible={false}
    />
  )
}

/** How much of a share is owned, as a ring around the logo. */
export function ShareRing({
  shares,
  logo,
  size = 52,
  stroke = 6,
  track = 'rgba(11,26,29,0.12)',
  fill = colors.coral,
}: {
  shares: number
  logo?: string
  size?: number
  stroke?: number
  track?: string
  fill?: string
}) {
  const r = (size - stroke) / 2
  const length = 2 * Math.PI * r
  const part = ringFill(shares)
  const inner = size - stroke * 2 - 6
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={fill}
          strokeWidth={stroke}
          strokeLinecap="round"
          // A sliver too thin to see still shows as a dot.
          strokeDasharray={`${Math.max(part * length, 0.5)} ${length}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {logo ? <StockLogo uri={logo} size={inner} round outline={null} /> : null}
    </View>
  )
}

/** Whether the market behind a stock is open, with a live dot when it is. */
export function MarketPill({ period, halted }: { period: MarketPeriod; halted: boolean }) {
  const live = !halted && period !== 'closed'
  return (
    <View style={styles.pill}>
      <View
        style={[
          styles.pillDot,
          live
            ? { backgroundColor: colors.teal, borderColor: colors.tealSoft }
            : { backgroundColor: colors.muted, borderColor: colors.sunken },
        ]}
      />
      <Txt weight="bold" size={12}>
        {marketLabel(period, halted)}
      </Txt>
    </View>
  )
}

/**
 * A price line with a soft fill under it. Touching it scrubs: `onScrub` gets the point under the
 * finger, and null when it lifts.
 */
export function PriceChart({
  points,
  height = 150,
  onScrub,
}: {
  points: [number, number][]
  height?: number
  onScrub?: (point: [number, number] | null) => void
}) {
  const [width, setWidth] = useState(0)
  const [at, setAt] = useState<number | null>(null)
  const up = points.length < 2 || (points.at(-1)?.[1] ?? 0) >= (points[0]?.[1] ?? 0)
  const tone = up ? colors.tealDeep : colors.coralDeep
  const area = up ? colors.teal : colors.coral

  const shape = useMemo(() => {
    if (width === 0 || points.length < 2) return null
    const prices = points.map((p) => p[1])
    const lo = Math.min(...prices)
    const hi = Math.max(...prices)
    const pad = (hi - lo) * 0.12 || hi * 0.01 || 1
    const top = hi + pad
    const span = top - (lo - pad)
    const xy = points.map(
      (p, i) => [(i / (points.length - 1)) * width, ((top - p[1]) / span) * height] as const,
    )
    const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('')
    return {
      xy,
      line,
      fill: `${line}L${width} ${height}L0 ${height}Z`,
      open: ((top - (points[0]?.[1] ?? 0)) / span) * height,
    }
  }, [points, width, height])

  const scrub = (x: number) => {
    if (!shape) return
    const i = Math.max(
      0,
      Math.min(points.length - 1, Math.round((x / width) * (points.length - 1))),
    )
    setAt(i)
    onScrub?.(points[i] ?? null)
  }
  const release = () => {
    setAt(null)
    onScrub?.(null)
  }
  const dot = shape ? shape.xy[at ?? shape.xy.length - 1] : null

  return (
    <View
      style={{ height }}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => scrub(e.nativeEvent.locationX)}
      onResponderMove={(e) => scrub(e.nativeEvent.locationX)}
      onResponderRelease={release}
      onResponderTerminate={release}
      accessible
      accessibilityLabel={
        points.length >= 2
          ? `Price chart, ${up ? 'up' : 'down'} from ${stockUsd(points[0]?.[1] ?? 0)} to ${stockUsd(points.at(-1)?.[1] ?? 0)}`
          : 'Price chart'
      }
    >
      {shape && dot ? (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="stock-area" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={area} stopOpacity={0.32} />
              <Stop offset="1" stopColor={area} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Line
            x1={0}
            x2={width}
            y1={shape.open}
            y2={shape.open}
            stroke="#B9B7B2"
            strokeWidth={1}
            strokeDasharray="3 5"
          />
          <Path d={shape.fill} fill="url(#stock-area)" />
          <Path
            d={shape.line}
            fill="none"
            stroke={tone}
            strokeWidth={2.6}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {at !== null ? (
            <Line
              x1={dot[0]}
              x2={dot[0]}
              y1={0}
              y2={height}
              stroke={colors.ink}
              strokeWidth={1.5}
            />
          ) : null}
          <Circle
            cx={Math.min(Math.max(dot[0], 6), width - 6)}
            cy={dot[1]}
            r={6}
            fill={colors.coral}
            stroke={colors.ink}
            strokeWidth={2}
          />
        </Svg>
      ) : null}
    </View>
  )
}

/** One holding as a tile: its ring, its value, and how much of a share that is. */
export function HoldingTile({
  holding,
  tone,
  hidden,
  onPress,
}: {
  holding: StockHolding
  tone: 'coral' | 'teal'
  hidden?: boolean
  onPress: () => void
}) {
  const fill = tone === 'coral' ? colors.coral : colors.teal
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${holding.name}, ${hidden ? 'hidden' : stockUsd(holding.value ?? 0)}, ${shareLabel(holding.shares)}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: fill },
        pressed && { transform: [{ scale: 0.97 }] },
      ]}
    >
      <View style={styles.tileTop}>
        <Txt weight="bold" size={15} color={colors.white} numberOfLines={1} style={{ flex: 1 }}>
          {holding.name}
        </Txt>
        <ShareRing
          shares={holding.shares}
          logo={holding.logo}
          size={40}
          stroke={5}
          track="rgba(255,255,255,0.3)"
          fill={colors.white}
        />
      </View>
      <View>
        <Txt weight="bold" size={20} color={colors.white} style={{ letterSpacing: -0.4 }}>
          {hidden ? '••••' : holding.value === null ? '—' : stockUsd(holding.value)}
        </Txt>
        <Txt size={12} color="rgba(255,255,255,0.85)" numberOfLines={1}>
          {shareLabel(holding.shares)}
        </Txt>
      </View>
    </Pressable>
  )
}

/**
 * Stocks on Home. With stocks it's what they're worth and the two biggest; without, the way in.
 * Stocks are never added to the balance above it: that's dollars you can spend.
 */
export function StocksCard() {
  const { holdings } = useStockHoldings()
  const { hideBalance } = usePrefs()
  const held = holdings?.data ?? []
  const open = () => router.push('/stocks')

  if (held.length === 0)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Stocks. Tesla, Nvidia, Apple and more, live prices"
        onPress={open}
        style={({ pressed }) => [styles.card, pressed && { transform: [{ scale: 0.98 }] }]}
      >
        <View style={styles.stack}>
          {['TSLAx', 'NVDAx', 'AAPLx'].map((symbol, i) => (
            <View key={symbol} style={{ marginLeft: i ? -12 : 0, zIndex: 3 - i }}>
              <StockLogo uri={`${LOGOS}/${symbol}.png`} size={34} round />
            </View>
          ))}
        </View>
        <View style={{ flex: 1 }}>
          <Txt weight="bold" size={18} style={{ letterSpacing: -0.3 }}>
            Stocks
          </Txt>
          <Txt
            size={12}
            color={colors.onTint}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
          >
            Tesla, Nvidia, Apple and more, live
          </Txt>
        </View>
        <Icon name="arrow" size={18} />
      </Pressable>
    )

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Your stocks, ${hideBalance ? 'hidden' : stockUsd(holdings?.total ?? 0)}`}
      onPress={open}
      style={({ pressed }) => [styles.owned, pressed && { transform: [{ scale: 0.98 }] }]}
    >
      <View style={styles.ownedHead}>
        <View style={{ flex: 1 }}>
          <Txt size={12} weight="semi" color={colors.onTint}>
            Your stocks
          </Txt>
          <Txt weight="bold" size={24} style={{ letterSpacing: -0.6 }}>
            {hideBalance ? '••••' : stockUsd(holdings?.total ?? 0)}
          </Txt>
        </View>
        <View style={styles.go}>
          <Icon name="arrow" color={colors.white} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {held.slice(0, 2).map((h, i) => (
          <View key={h.symbol} style={styles.mini}>
            <ShareRing
              shares={h.shares}
              logo={h.logo}
              size={44}
              stroke={5}
              fill={i ? colors.teal : colors.coral}
            />
            <View style={{ flex: 1 }}>
              <Txt weight="bold" size={14} numberOfLines={1}>
                {h.name}
              </Txt>
              <Txt size={12} color={colors.onTint} numberOfLines={1}>
                {shareLabel(h.shares)}
              </Txt>
            </View>
          </View>
        ))}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pillDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2.5 },
  tile: { flexGrow: 1, flexBasis: '40%', borderRadius: 20, padding: 12, gap: 10 },
  tileTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  card: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  stack: { flexDirection: 'row' },
  owned: {
    marginTop: 12,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.tealSoft,
    padding: 14,
    gap: 12,
  },
  ownedHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  go: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mini: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 8,
  },
})
