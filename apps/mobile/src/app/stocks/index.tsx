import type { StockQuote } from '@kova/monad'
import { router } from 'expo-router'
import { useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { usePrefs } from '@/lib/prefs'
import { stockUsd, useStockHoldings, useStockQuotes } from '@/lib/stocks'
import { colors, fonts } from '@/lib/theme'
import { KoviPeek, peekEdge } from '@/ui/art'
import { Icon } from '@/ui/Icon'
import { RoundButton, Txt } from '@/ui/primitives'
import { HoldingTile, MarketPill, StockLogo } from '@/ui/Stocks'

/**
 * Stocks: what you own, and live prices for the rest. Every stock here is an xStock on Monad,
 * backed 1:1 by the share; holdings are read on Monad mainnet. Buying opens with a partner.
 */
export default function Stocks() {
  const insets = useSafeAreaInsets()
  const [q, setQ] = useState('')
  const { holdings, failed: holdingsFailed, refresh } = useStockHoldings()
  const [refreshing, setRefreshing] = useState(false)
  const { stocks, failed } = useStockQuotes(q)
  const { hideBalance } = usePrefs()
  const held = holdings?.data ?? []
  const market = stocks?.[0] ?? held[0]
  const open = (symbol: string) => router.push({ pathname: '/stocks/[symbol]', params: { symbol } })

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.paper }}
      contentContainerStyle={{
        paddingTop: insets.top + 8,
        paddingBottom: insets.bottom + 32,
        paddingHorizontal: 20,
      }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true)
            await refresh()
            setRefreshing(false)
          }}
        />
      }
    >
      <View style={styles.head}>
        <RoundButton icon="back" label="Back" onPress={() => router.back()} />
        <Txt weight="bold" size={30} style={{ flex: 1, letterSpacing: -1 }}>
          Stocks
        </Txt>
        {market ? <MarketPill period={market.period} halted={market.halted} /> : null}
      </View>

      <View style={styles.mine}>
        <View style={styles.peek} pointerEvents="none">
          <KoviPeek width={120} />
        </View>
        <Txt size={13} weight="semi" color={colors.onInk}>
          Your stocks
        </Txt>
        {holdings === null ? (
          <View style={{ height: 44, justifyContent: 'center', alignItems: 'flex-start' }}>
            {holdingsFailed ? (
              <Txt size={14} color={colors.onInk}>
                Can’t reach Monad right now. Pull to try again.
              </Txt>
            ) : (
              <ActivityIndicator color={colors.white} />
            )}
          </View>
        ) : (
          <Txt weight="bold" size={38} color={colors.white} style={{ letterSpacing: -1.4 }}>
            {hideBalance ? '••••' : stockUsd(holdings.total)}
          </Txt>
        )}
        {held.length > 0 ? (
          <>
            <Txt size={12} color={colors.onInk}>
              In your wallet on Monad. Not part of your dollars.
            </Txt>
            <View style={styles.tiles}>
              {held.slice(0, 4).map((h, i) => (
                <HoldingTile
                  key={h.symbol}
                  holding={h}
                  tone={i % 2 ? 'teal' : 'coral'}
                  hidden={hideBalance}
                  onPress={() => open(h.symbol)}
                />
              ))}
            </View>
          </>
        ) : holdings ? (
          <Txt size={13} color={colors.onInk} style={{ lineHeight: 19 }}>
            You don’t own any stocks yet. Any xStocks you hold on Monad show up here, a slice of a
            share at a time.
          </Txt>
        ) : null}
      </View>

      <View style={styles.search}>
        <Icon name="search" size={18} color={colors.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search Tesla, Apple, S&P 500…"
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel="Search stocks"
          style={styles.input}
        />
      </View>

      <View style={styles.listHead}>
        <Txt weight="bold" size={18}>
          {q.trim() ? 'Results' : 'Popular'}
        </Txt>
        <Txt size={12} weight="semi" color={colors.muted}>
          Live from xStocks
        </Txt>
      </View>

      {stocks === null ? (
        failed ? (
          <Txt size={14} color={colors.muted} style={{ marginTop: 8 }}>
            Prices are unreachable right now. They’ll be back in a moment.
          </Txt>
        ) : (
          <ActivityIndicator style={{ marginTop: 20 }} color={colors.ink} />
        )
      ) : stocks.length === 0 ? (
        <Txt size={14} color={colors.muted} style={{ marginTop: 8 }}>
          No stock called “{q.trim()}” on Monad yet.
        </Txt>
      ) : (
        <View style={{ gap: 8 }}>
          {stocks.map((s) => (
            <StockRow key={s.symbol} stock={s} onPress={() => open(s.symbol)} />
          ))}
        </View>
      )}

      <Txt size={11} color={colors.muted} style={styles.fine}>
        Stocks in Kova are xStocks: tokens on Monad backed 1:1 by shares. Not available in the US
        and some other countries.
      </Txt>
    </ScrollView>
  )
}

function StockRow({ stock, onPress }: { stock: StockQuote; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${stock.name}, ${stock.price === null ? 'no price' : stockUsd(stock.price)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { transform: [{ scale: 0.98 }] }]}
    >
      <StockLogo uri={stock.logo} size={42} outline={null} />
      <View style={{ flex: 1 }}>
        <Txt weight="bold" size={15} numberOfLines={1}>
          {stock.name}
        </Txt>
        <Txt size={12} weight="semi" color={colors.muted}>
          {stock.ticker}
          {stock.exchange ? ` · ${stock.exchange}` : ''}
        </Txt>
      </View>
      <Txt weight="bold" size={16}>
        {stock.price === null ? '—' : stockUsd(stock.price)}
      </Txt>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 46 },
  mine: {
    marginTop: 54,
    backgroundColor: colors.ink,
    borderRadius: 28,
    padding: 18,
    gap: 4,
  },
  peek: { position: 'absolute', right: 16, top: -120 * 0.5 * peekEdge },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  search: {
    marginTop: 18,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 10,
  },
  input: { flex: 1, fontFamily: fonts.semi, fontSize: 15, color: colors.ink, height: '100%' },
  listHead: {
    marginTop: 22,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    paddingRight: 14,
    borderRadius: 20,
    backgroundColor: colors.surface,
  },
  fine: { marginTop: 20, lineHeight: 16, textAlign: 'center' },
})
