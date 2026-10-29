import { type StockQuote, shareOfDollars } from '@kova/monad'
import * as Haptics from 'expo-haptics'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { formatUsd } from '@/lib/money'
import { askStockAlert, getStock, getStockAlerts, useStockHoldings } from '@/lib/stocks'
import { getStockAccess, keptAccess, type StockAccess, type TradeSide } from '@/lib/stocks-trade'
import { colors, pair } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Icon } from '@/ui/Icon'
import { Txt } from '@/ui/primitives'
import { StockLogo } from '@/ui/Stocks'
import { TradeFlow } from '@/ui/StockTrade'

const AMOUNTS = [1, 2, 5, 10]

/**
 * Buy and Sell: where Kova's API says stock tokens are live, the flow in ui/StockTrade.tsx (where
 * you are, the one-time confirmation, the amount, the live quote, Face ID). Until then, and if Kova
 * can't say, the Coming soon sheet below.
 */
export default function BuyStock() {
  const { symbol, side } = useLocalSearchParams<{ symbol: string; side?: string }>()
  const { profile } = useWallet()
  const { holdings } = useStockHoldings()
  const [access, setAccess] = useState<StockAccess | null>(() =>
    profile ? (keptAccess.get(profile.address) ?? null) : null,
  )
  const [failed, setFailed] = useState(false)
  const [stock, setStock] = useState<StockQuote | null>(null)

  useEffect(() => {
    if (!profile) return
    let live = true
    getStockAccess(profile.address)
      .then((a) => {
        keptAccess.set(profile.address, a)
        if (live) setAccess(a)
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [profile])

  useEffect(() => {
    void getStock(symbol)
      .then(setStock)
      .catch(() => setFailed(true))
  }, [symbol])

  if (!profile || failed || access?.live === false) return <ComingSoon />
  if (!access || !stock)
    return (
      <View style={[styles.sheet, { minHeight: 300, justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.ink} />
      </View>
    )
  const trade: TradeSide = side === 'sell' ? 'sell' : 'buy'
  return (
    <>
      {/* The flow sits on paper, its cards on surface; Coming soon keeps the surface sheet. */}
      <Stack.Screen options={{ contentStyle: { backgroundColor: colors.paper } }} />
      <TradeFlow
        stock={stock}
        side={trade}
        held={holdings?.data.find((h) => h.symbol === stock.symbol)}
        access={access}
        onAccess={(a) => {
          keptAccess.set(profile.address, a)
          setAccess(a)
        }}
      />
    </>
  )
}

/**
 * Buying a stock, as it will work: a few dollars from what you can spend, a slice of a share,
 * on Monad in about a second. It isn't open yet (xStocks are issued only through approved
 * partners), so the button is shown off, and "Tell me" keeps your place for the day it opens.
 */
function ComingSoon() {
  const { symbol } = useLocalSearchParams<{ symbol: string }>()
  const insets = useSafeAreaInsets()
  const { profile, balance } = useWallet()
  const [stock, setStock] = useState<StockQuote | null>(null)
  const [amount, setAmount] = useState(5)
  const [asked, setAsked] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    void getStock(symbol)
      .then(setStock)
      .catch((e: Error) => setProblem(e.message))
  }, [symbol])

  useEffect(() => {
    if (!profile) return
    void getStockAlerts(profile.address)
      .then((symbols) => setAsked(symbols.some((s) => s.toLowerCase() === symbol.toLowerCase())))
      .catch(() => setAsked(false))
  }, [profile, symbol])

  const ask = async () => {
    if (!profile || !stock) return
    setBusy(true)
    setProblem(null)
    try {
      await askStockAlert(profile.address, stock.symbol)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setAsked(true)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'That didn’t go through. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!stock)
    return (
      <View style={[styles.sheet, { minHeight: 300, justifyContent: 'center' }]}>
        {problem ? (
          <Txt size={15} color={colors.muted} style={{ textAlign: 'center' }}>
            {problem}
          </Txt>
        ) : (
          <ActivityIndicator color={colors.ink} />
        )}
      </View>
    )

  return (
    <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.head}>
        <StockLogo uri={stock.logo} size={44} />
        <View style={{ flex: 1 }}>
          <Txt weight="bold" size={20}>
            Buy {stock.name}
          </Txt>
          <Txt size={12} weight="semi" color={colors.muted}>
            From Available to spend, {balance === null ? '—' : formatUsd(balance)}
          </Txt>
        </View>
      </View>

      <View style={styles.amount}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <Txt weight="bold" size={30} style={{ marginTop: 10 }}>
            $
          </Txt>
          <Txt weight="bold" size={72} style={{ letterSpacing: -3, lineHeight: 80 }}>
            {amount}
          </Txt>
        </View>
        {stock.price ? (
          <View style={styles.slice}>
            <Txt weight="bold" size={15}>
              That’s {shareOfDollars(amount, stock.price)}
            </Txt>
          </View>
        ) : null}
      </View>

      <View style={styles.chips} accessibilityRole="radiogroup">
        {AMOUNTS.map((n) => (
          <Pressable
            key={n}
            accessibilityRole="radio"
            accessibilityState={{ checked: n === amount }}
            onPress={() => {
              void Haptics.selectionAsync()
              setAmount(n)
            }}
            style={[styles.chip, n === amount && { backgroundColor: colors.chosen }]}
          >
            <Txt weight="bold" size={15} color={n === amount ? colors.onChosen : colors.ink}>
              ${n}
            </Txt>
          </Pressable>
        ))}
      </View>

      <View style={styles.rows}>
        <View style={[styles.rowLine, { borderBottomWidth: 1, borderBottomColor: colors.sunken }]}>
          <Txt size={13} color={colors.muted}>
            Fee
          </Txt>
          <Txt size={13} weight="bold">
            Set with our partner
          </Txt>
        </View>
        <View style={styles.rowLine}>
          <Txt size={13} color={colors.muted}>
            Lands in
          </Txt>
          <Txt size={13} weight="bold">
            About a second
          </Txt>
        </View>
      </View>

      <View
        accessible
        accessibilityLabel="Buy. Coming soon"
        accessibilityState={{ disabled: true }}
      >
        <View style={styles.slide}>
          <View style={styles.knob}>
            <Icon name="arrow" color={colors.white} size={20} />
          </View>
          <Txt weight="bold" size={16} color={colors.muted}>
            Slide to buy
          </Txt>
        </View>
        <View style={styles.soon}>
          <Txt weight="bold" size={13} color={colors.white}>
            Coming soon
          </Txt>
        </View>
      </View>

      {asked ? (
        <View style={styles.told} accessibilityRole="text">
          <Icon name="check" color={colors.white} size={18} />
          <Txt weight="bold" size={15} color={colors.white}>
            We’ll tell you here the day it opens
          </Txt>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          disabled={busy || asked === null || !profile}
          onPress={ask}
          style={({ pressed }) => [
            styles.tell,
            pressed && { transform: [{ scale: 0.98 }] },
            (busy || asked === null) && { opacity: 0.6 },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Txt weight="bold" size={15} color={colors.white}>
              Tell me when I can buy {stock.name}
            </Txt>
          )}
        </Pressable>
      )}
      {problem ? (
        <Txt size={13} color={colors.danger} style={{ textAlign: 'center' }}>
          {problem}
        </Txt>
      ) : null}

      <Txt size={11} color={colors.muted} style={styles.fine}>
        Stocks in Kova are xStocks: tokens backed 1:1 by shares. Not available in the US and some
        other countries. Prices move outside market hours.
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.surface,
    paddingHorizontal: 20,
    paddingTop: 26,
    gap: 14,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  amount: { alignItems: 'center', gap: 4, paddingTop: 4 },
  slice: {
    backgroundColor: colors.tealSoft,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rows: { backgroundColor: colors.paper, borderRadius: 18 },
  rowLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  slide: {
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.sunken,
    borderWidth: 2,
    borderColor: pair('#8E9A9C', '#4A4A4A'),
    borderStyle: 'dashed',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 6,
  },
  knob: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: pair('#B9B7B2', '#3A3A3A'),
    alignItems: 'center',
    justifyContent: 'center',
  },
  soon: {
    position: 'absolute',
    right: 14,
    top: 14,
    backgroundColor: colors.coral,
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    transform: [{ rotate: '-5deg' }],
  },
  tell: {
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  told: {
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.teal,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  fine: { lineHeight: 16, textAlign: 'center' },
})
