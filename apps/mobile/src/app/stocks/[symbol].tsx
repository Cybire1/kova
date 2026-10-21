import {
  CHART_RANGES,
  type ChartRange,
  type StockChart,
  type StockQuote,
  shareLabel,
  shareOfDollars,
} from '@kova/monad'
import * as Haptics from 'expo-haptics'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { usePrefs } from '@/lib/prefs'
import { getStock, getStockChart, stockUsd, useStockHoldings } from '@/lib/stocks'
import { colors } from '@/lib/theme'
import { RoundButton, Txt } from '@/ui/primitives'
import { MarketPill, PriceChart, ShareRing, StockLogo } from '@/ui/Stocks'

const RANGE_WORDS: Record<ChartRange, string> = {
  '1D': 'today',
  '1W': 'this week',
  '1M': 'this month',
  '1Y': 'this year',
}

/** One stock: its live price, its chart, what you own of it, and Buy, which opens with a partner. */
export default function StockScreen() {
  // Development only: `buy=1` opens the Buy sheet over it, for screenshots.
  const { symbol, buy } = useLocalSearchParams<{ symbol: string; buy?: string }>()
  const insets = useSafeAreaInsets()
  const { hideBalance } = usePrefs()
  const { holdings } = useStockHoldings()
  const [stock, setStock] = useState<StockQuote | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [range, setRange] = useState<ChartRange>('1W')
  const [chart, setChart] = useState<StockChart | null>(null)
  const [chartFailed, setChartFailed] = useState(false)
  const [scrub, setScrub] = useState<[number, number] | null>(null)
  const held = holdings?.data.find((h) => h.symbol === stock?.symbol)

  useFocusEffect(
    useCallback(() => {
      let live = true
      const load = () =>
        getStock(symbol)
          .then((s) => {
            if (!live) return
            setStock(s)
            setProblem(null)
          })
          .catch((e: Error) => live && setProblem(e.message))
      void load()
      const timer = setInterval(load, 30_000)
      return () => {
        live = false
        clearInterval(timer)
      }
    }, [symbol]),
  )

  useEffect(() => {
    if (__DEV__ && buy === '1')
      setTimeout(() => router.push({ pathname: '/stocks/buy', params: { symbol } }), 600)
  }, [buy, symbol])

  useEffect(() => {
    let live = true
    setChartFailed(false)
    getStockChart(symbol, range)
      .then((c) => live && setChart(c))
      .catch(() => live && setChartFailed(true))
    return () => {
      live = false
    }
  }, [symbol, range])

  if (!stock)
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        {problem ? (
          <>
            <Txt size={15} color={colors.muted} style={{ textAlign: 'center' }}>
              {problem}
            </Txt>
            <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={10}>
              <Txt weight="semi" size={15} style={{ textDecorationLine: 'underline' }}>
                Back to stocks
              </Txt>
            </Pressable>
          </>
        ) : (
          <ActivityIndicator color={colors.ink} />
        )}
      </View>
    )

  const points = chart?.range === range ? chart.points : []
  // The chart's last point can lag the quote by minutes; the price shown is always xStocks' own.
  const price = scrub?.[1] ?? stock.price
  const first = points[0]?.[1]
  const change = first && stock.price ? (stock.price - first) / first : null
  const [whole, cents] = price === null ? ['—', ''] : stockUsd(price).split('.')

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, gap: 14 }}
        scrollEnabled={scrub === null}
      >
        <View style={styles.head}>
          <RoundButton icon="back" label="Back" onPress={() => router.back()} />
          <StockLogo uri={stock.logo} size={44} />
          <View style={{ flex: 1 }}>
            <Txt weight="bold" size={22} numberOfLines={1} style={{ letterSpacing: -0.5 }}>
              {stock.name}
            </Txt>
            <Txt size={12} weight="semi" color={colors.muted} numberOfLines={1}>
              {stock.symbol}
              {stock.exchange ? ` · ${stock.exchange}` : ''} · on Monad
            </Txt>
          </View>
        </View>

        <View>
          <View style={styles.price}>
            <Txt weight="bold" size={52} style={{ letterSpacing: -2.2 }}>
              {whole}
            </Txt>
            {cents ? (
              <Txt weight="bold" size={26} style={{ marginBottom: 6 }}>
                .{cents}
              </Txt>
            ) : null}
            <View style={{ flex: 1 }} />
            <View style={{ marginBottom: 12 }}>
              <MarketPill period={stock.period} halted={stock.halted} />
            </View>
          </View>
          <Txt
            size={13}
            weight="bold"
            color={
              scrub || change === null
                ? colors.muted
                : change >= 0
                  ? colors.tealDeep
                  : colors.coralDeep
            }
          >
            {scrub
              ? when(scrub[0], range)
              : change === null
                ? 'A share, from xStocks'
                : `${change >= 0 ? '▲' : '▼'} ${Math.abs(change * 100).toFixed(2)}% ${RANGE_WORDS[range]}`}
          </Txt>
        </View>

        <View style={styles.chartCard}>
          {points.length >= 2 ? (
            <PriceChart points={points} onScrub={setScrub} />
          ) : (
            <View style={[styles.center, { height: 150, flex: 0 }]}>
              {chartFailed || chart?.range === range ? (
                <Txt size={13} color={colors.muted}>
                  No chart for {stock.name} right now
                </Txt>
              ) : (
                <ActivityIndicator color={colors.ink} />
              )}
            </View>
          )}
          <View style={styles.ranges} accessibilityRole="tablist">
            {CHART_RANGES.map((r) => (
              <Pressable
                key={r}
                accessibilityRole="tab"
                accessibilityState={{ selected: r === range }}
                onPress={() => {
                  void Haptics.selectionAsync()
                  setRange(r)
                }}
                style={[styles.range, r === range && { backgroundColor: colors.ink }]}
              >
                <Txt weight="bold" size={13} color={r === range ? colors.white : colors.ink}>
                  {r}
                </Txt>
              </Pressable>
            ))}
          </View>
        </View>

        {held ? (
          <View style={styles.own}>
            <ShareRing
              shares={held.shares}
              size={96}
              stroke={13}
              track="#24363A"
              fill={colors.coral}
            />
            <View style={styles.ownRing} pointerEvents="none">
              <Txt weight="bold" size={held.shares < 1 ? 15 : 17} color={colors.white}>
                {held.shares < 1 ? shareLabel(held.shares).replace(' of a share', '') : held.shares}
              </Txt>
              <Txt size={10} weight="semi" color={colors.onInk}>
                {held.shares < 1 ? 'of a share' : held.shares === 1 ? 'share' : 'shares'}
              </Txt>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt size={13} weight="semi" color={colors.onInk}>
                You own
              </Txt>
              <Txt weight="bold" size={28} color={colors.white} style={{ letterSpacing: -1 }}>
                {hideBalance ? '••••' : held.value === null ? '—' : stockUsd(held.value)}
              </Txt>
              <Txt size={12} color={colors.onInk}>
                {held.shares} {stock.symbol}, in your wallet
              </Txt>
            </View>
          </View>
        ) : stock.price ? (
          <View style={styles.own}>
            <ShareRing
              shares={5 / stock.price}
              logo={stock.logo}
              size={72}
              stroke={9}
              track="#24363A"
              fill={colors.coral}
            />
            <View style={{ flex: 1, gap: 4 }}>
              <Txt weight="bold" size={17} color={colors.white} style={{ letterSpacing: -0.3 }}>
                $5 buys {shareOfDollars(5, stock.price)}
              </Txt>
              <Txt size={12} color={colors.onInk} style={{ lineHeight: 17 }}>
                Own a slice of {stock.name}, from a dollar. Buying opens soon.
              </Txt>
            </View>
          </View>
        ) : null}

        <View style={styles.facts}>
          <View style={styles.fact}>
            <Txt size={11} weight="bold" color={colors.muted}>
              BACKED BY
            </Txt>
            <Txt size={13} weight="bold">
              {stock.ticker} shares, 1:1
            </Txt>
          </View>
          <View style={styles.fact}>
            <Txt size={11} weight="bold" color={colors.muted}>
              TRADES
            </Txt>
            <Txt size={13} weight="bold">
              24 hours, 5 days
            </Txt>
          </View>
        </View>
        <Txt size={11} color={colors.muted}>
          Price from xStocks{points.length ? ', chart from CoinGecko' : ''}.
        </Txt>
      </ScrollView>

      <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: insets.bottom + 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Buy ${stock.name}. Coming soon`}
          onPress={() => router.push({ pathname: '/stocks/buy', params: { symbol: stock.symbol } })}
          style={({ pressed }) => [styles.buy, pressed && { transform: [{ scale: 0.98 }] }]}
        >
          <Txt weight="bold" size={17} color={colors.white}>
            Buy {stock.name}
          </Txt>
          <View style={styles.soon}>
            <Txt weight="bold" size={11}>
              Coming soon
            </Txt>
          </View>
        </Pressable>
      </View>
    </View>
  )
}

/** When a scrubbed point was: a time today, a day this week, a date beyond. */
function when(ms: number, range: ChartRange): string {
  const date = new Date(ms)
  if (range === '1D')
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (range === '1W')
    return date.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 46 },
  price: { flexDirection: 'row', alignItems: 'flex-end' },
  chartCard: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: 26,
    padding: 12,
    paddingBottom: 10,
    gap: 10,
  },
  ranges: { flexDirection: 'row', gap: 6 },
  range: {
    flex: 1,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  own: {
    backgroundColor: colors.ink,
    borderRadius: 26,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  ownRing: {
    position: 'absolute',
    left: 16,
    width: 96,
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  facts: { flexDirection: 'row', gap: 10 },
  fact: { flex: 1, backgroundColor: colors.surface, borderRadius: 18, padding: 12, gap: 2 },
  buy: {
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.coral,
    borderWidth: 2,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  soon: {
    position: 'absolute',
    right: 12,
    top: -12,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    transform: [{ rotate: '4deg' }],
  },
})
