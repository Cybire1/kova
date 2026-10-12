import { useFocusEffect } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { useShop } from '@/lib/shop'
import { useTakings } from '@/lib/takings'
import type { PrivateSale } from '@/lib/takings-core'
import { colors } from '@/lib/theme'
import { Kovi } from '@/ui/art'
import { Header, Rise, Screen, Txt } from '@/ui/primitives'
import { AccountantCard, freshMove, PrivateSaleRow, SalesFlow, TakingsCard, TakingsInvite, TakingsState } from '@/ui/Takings'

/** "Today", "Yesterday", or the date: how the private sales are grouped. */
function dayOf(at: string | null) {
  if (!at) return 'Earlier'
  const d = new Date(at)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
}

/**
 * Every private sale the shop has had: each at an address of its own, waiting or already home,
 * with the move into the wallet at the top and the accountant's read-only view at the bottom.
 */
export default function PrivateTakings() {
  const t = useTakings()
  const shop = useShop()
  const [refreshing, setRefreshing] = useState(false)
  const { refresh } = t

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )

  const days = useMemo(() => {
    const groups: { day: string; sales: PrivateSale[] }[] = []
    for (const sale of t.sales) {
      const day = dayOf(sale.paid_at)
      const last = groups[groups.length - 1]
      if (last?.day === day) last.sales.push(sale)
      else groups.push({ day, sales: [sale] })
    }
    return groups
  }, [t.sales])

  const quiet = !t.enabled && t.sales.length === 0 && t.unopened === 0 && !freshMove(t.moved)

  return (
    <Screen edges={['top']}>
      <Header title="Private takings" subtitle={shop.name} right={t.owner && t.ready ? <TakingsState /> : null} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.ink}
            onRefresh={async () => {
              setRefreshing(true)
              await refresh()
              setRefreshing(false)
            }}
          />
        }
      >
        {!t.owner ? (
          <View style={styles.empty}>
            <Kovi pose="key" size={130} />
            <Txt size={15} color={colors.muted} style={{ textAlign: 'center', lineHeight: 21 }}>
              Private takings belong to the shop’s owner. Open them on the phone whose wallet owns {shop.name}.
            </Txt>
          </View>
        ) : !t.ready ? (
          <ActivityIndicator color={colors.ink} style={{ marginTop: 60 }} />
        ) : (
          <>
            <Rise>{quiet ? <TakingsInvite /> : <TakingsCard plain />}</Rise>

            <Txt weight="bold" size={20} style={styles.section}>
              How it stays private
            </Txt>
            <View style={styles.explain}>
              <SalesFlow sales={t.sales} />
              <Txt size={14} color={colors.onTint} style={{ marginTop: 14, lineHeight: 20 }}>
                Each sale is paid to an address made for that sale alone. Customers pay exactly as before. Only your shop’s keys can tell
                these addresses are yours, so nobody reading Monad can add up what you take.
              </Txt>
            </View>

            <View style={styles.sectionRow}>
              <Txt weight="bold" size={20}>
                Every private sale
              </Txt>
              {t.sales.length ? (
                <Txt size={14} color={colors.muted}>
                  {t.sales.length} {t.sales.length === 1 ? 'sale' : 'sales'}
                </Txt>
              ) : null}
            </View>
            {t.sales.length === 0 ? (
              <View style={styles.none}>
                <Txt size={15} color={colors.muted} style={{ lineHeight: 21 }}>
                  {t.keysHere
                    ? t.enabled
                      ? 'Private sales show up here the moment they’re paid, each with its own address.'
                      : 'No private sales yet. Turn private takings on and they show up here.'
                    : 'Open private takings on this phone to see them.'}
                </Txt>
              </View>
            ) : (
              days.map((group) => (
                <View key={group.day} style={{ marginBottom: 14 }}>
                  <Txt weight="semi" size={13} color={colors.muted} style={styles.day}>
                    {group.day}
                  </Txt>
                  <View style={styles.list}>
                    {group.sales.map((sale, i) => (
                      <PrivateSaleRow key={sale.stealth_address} sale={sale} last={i === group.sales.length - 1} />
                    ))}
                  </View>
                </View>
              ))
            )}

            <Txt weight="bold" size={20} style={styles.section}>
              For your accountant
            </Txt>
            <AccountantCard shopName={shop.name} />
          </>
        )}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', gap: 12, paddingTop: 60, paddingHorizontal: 12 },
  section: { marginTop: 28, marginBottom: 12, letterSpacing: -0.4 },
  sectionRow: { marginTop: 28, marginBottom: 12, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  explain: { borderRadius: 24, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.surface, padding: 14 },
  none: { borderRadius: 22, borderWidth: 2, borderColor: colors.ink, borderStyle: 'dashed', padding: 16 },
  day: { marginBottom: 8, marginLeft: 4 },
  list: { borderRadius: 22, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.surface, overflow: 'hidden' },
})
