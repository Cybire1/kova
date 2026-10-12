import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getSummary, listCharges, type PaymentIntent, type Summary } from '@/lib/api'
import { formatLocal } from '@/lib/money'
import { useShop } from '@/lib/shop'
import { useTakings } from '@/lib/takings'
import { colors } from '@/lib/theme'
import { Avatar, Kovi, ShopBadge } from '@/ui/art'
import { Icon } from '@/ui/Icon'
import { Txt } from '@/ui/primitives'
import { shopDockClearance } from '@/ui/ShopDock'
import { freshMove, PrivateSaleRow, TakingsCard, TakingsInvite } from '@/ui/Takings'
import { WalletBack } from '@/ui/WalletBack'

const labels: Record<PaymentIntent['status'], { text: string; color: string }> = {
  paid: { text: 'Paid', color: colors.positive },
  requires_payment: { text: 'Waiting', color: '#8A6A1F' },
  processing: { text: 'Confirming', color: '#8A6A1F' },
  held: { text: 'Held', color: colors.danger },
  failed: { text: 'Failed', color: colors.danger },
  canceled: { text: 'Canceled', color: colors.muted },
  expired: { text: 'Expired', color: colors.muted },
}

/** Where a sale came from, the way the counter talks about it. */
function source(c: PaymentIntent) {
  if (c.order?.stall) return c.order.customer_name ? `${c.order.stall.name}, for ${c.order.customer_name}` : c.order.stall.name
  if (c.order) return c.terminal ? `Till, ${c.terminal.name}` : 'Till'
  return c.terminal?.name ?? 'Online'
}

/** The day at a glance: what came in, how many sales, and each one as it settled. */
export default function Today() {
  const shop = useShop()
  const insets = useSafeAreaInsets()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [charges, setCharges] = useState<PaymentIntent[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const takings = useTakings()
  const { refresh: refreshTakings } = takings

  const load = useCallback(async () => {
    void refreshTakings()
    const [s, c] = await Promise.all([getSummary(), listCharges(60)]).catch(() => [null, []] as const)
    if (s) setSummary(s)
    const midnight = new Date()
    midnight.setHours(0, 0, 0, 0)
    setCharges(c.filter((x) => new Date(x.created_at) >= midnight))
  }, [refreshTakings])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const total = summary?.today?.total ?? '0.00'
  const paid = charges.filter((c) => c.status === 'paid')
  // The owner's phone shows where the money is: at the sales' own addresses, or home already.
  // Off, with nothing waiting, it offers to turn them on instead.
  const showTakings = takings.owner && takings.ready
  const card = showTakings && (takings.enabled || takings.waitingCount > 0 || takings.unopened > 0 || freshMove(takings.moved) !== null)
  const recent = showTakings ? takings.sales.slice(0, 3) : []

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.paper }}
      data={charges}
      keyExtractor={(c) => c.id}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: shopDockClearance + insets.bottom }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true)
            await load()
            setRefreshing(false)
          }}
        />
      }
      ListHeaderComponent={
        <>
          <View style={{ marginBottom: 10 }}>
            <WalletBack />
          </View>
          <Txt weight="bold" size={32} style={{ letterSpacing: -1 }}>
            Today
          </Txt>
          <View style={styles.hero}>
            <Txt size={15}>Taken today</Txt>
            <Txt weight="bold" size={52} style={{ letterSpacing: -2 }} numberOfLines={1} adjustsFontSizeToFit>
              ${Number(total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Txt>
            <Txt size={15} color={colors.onTint}>
              {shop.currency !== 'USD' ? `About ${formatLocal(Number(total), shop.currency)}. ` : ''}
              {summary?.today?.count ?? paid.length} {(summary?.today?.count ?? paid.length) === 1 ? 'sale' : 'sales'}, $0.00 in card fees
            </Txt>
            <View style={styles.kovi} pointerEvents="none">
              <Kovi pose="cheer" size={96} />
            </View>
          </View>
          {card ? <TakingsCard onOpen={() => router.push('/terminal/takings')} /> : showTakings ? <TakingsInvite /> : null}
          {recent.length ? (
            <>
              <View style={styles.sectionRow}>
                <Txt weight="bold" size={18} style={{ letterSpacing: -0.3 }}>
                  Private sales
                </Txt>
                <Pressable accessibilityRole="link" hitSlop={10} onPress={() => router.push('/terminal/takings')}>
                  <Txt size={14} color={colors.muted} style={{ textDecorationLine: 'underline' }}>
                    {takings.sales.length > recent.length ? `See all ${takings.sales.length}` : 'See all'}
                  </Txt>
                </Pressable>
              </View>
              <View style={styles.privateList}>
                {recent.map((sale, i) => (
                  <PrivateSaleRow key={sale.stealth_address} sale={sale} last={i === recent.length - 1} />
                ))}
              </View>
            </>
          ) : null}
          {showTakings ? (
            <Txt weight="bold" size={18} style={{ marginTop: 24, marginBottom: 4, letterSpacing: -0.3 }}>
              Today’s sales
            </Txt>
          ) : null}
        </>
      }
      renderItem={({ item }) => {
        // A charge nobody paid stays open until the API's expiry sweep runs; show it as expired.
        const lapsed = item.status === 'requires_payment' && item.expires_at && new Date(item.expires_at) < new Date()
        const label = labels[lapsed ? 'expired' : item.status]
        const price = item.metadata?.price && item.metadata.price_currency ? `${item.metadata.price} ${item.metadata.price_currency}` : null
        const buyer = item.order?.customer_name
        const privately = takings.isPrivate(item.pay_to)
        return (
          <View style={styles.row}>
            {buyer ? <Avatar name={buyer} size={40} /> : item.order ? <View style={styles.tillIcon}><Icon name="barcode" size={18} /></View> : <ShopBadge size={40} />}
            <View style={{ flex: 1 }}>
              <Txt weight="semi" size={16} numberOfLines={1}>
                {item.reference ?? (price ? `Sale, ${price}` : 'Sale')}
              </Txt>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                {privately ? <Icon name="lock" size={12} color={colors.muted} /> : null}
                <Txt size={13} color={colors.muted} numberOfLines={1} style={{ flexShrink: 1 }}>
                  {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, {source(item)}, {label.text}
                  {privately ? ', private' : ''}
                </Txt>
              </View>
            </View>
            <Txt weight="semi" size={16} color={label.color}>
              ${item.amount}
            </Txt>
          </View>
        )
      }}
      ListEmptyComponent={
        <Txt size={15} color={colors.muted} style={{ marginTop: 20 }}>
          No sales yet today.
        </Txt>
      }
    />
  )
}

const styles = StyleSheet.create({
  hero: {
    marginTop: 14,
    marginBottom: 12,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.tealSoft,
    padding: 20,
    paddingRight: 100,
    overflow: 'hidden',
  },
  kovi: { position: 'absolute', right: 6, bottom: -10 },
  sectionRow: { marginTop: 22, marginBottom: 8, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  privateList: { borderRadius: 22, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.surface, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
  tillIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.tealSoft, borderWidth: 2, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
})
