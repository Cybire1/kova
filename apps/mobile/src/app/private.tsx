import { useFocusEffect } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { usePrivate } from '@/lib/private'
import type { PrivateReceipt } from '@/lib/private-core'
import { colors } from '@/lib/theme'
import { Header, Rise, Screen, Txt } from '@/ui/primitives'
import { PrivateCard, PrivateFlow, PrivateRow, ReceivingCard } from '@/ui/Private'

/** "Today", "Yesterday", or the date: how private payments are grouped. */
function dayOf(at: number) {
  const d = new Date(at)
  if (d.toDateString() === new Date().toDateString()) return 'Today'
  if (d.toDateString() === new Date(Date.now() - 86_400_000).toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
}

/**
 * Private dollars: what people sent this wallet privately, waiting at one-time addresses only its
 * keys can open, with the move into the balance at the top, how it stays private in the middle,
 * every private payment below, and whether people can send to you privately at the bottom.
 */
export default function PrivateDollars() {
  const p = usePrivate()
  const [refreshing, setRefreshing] = useState(false)
  const { refresh } = p

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )

  const days = useMemo(() => {
    const groups: { day: string; receipts: PrivateReceipt[] }[] = []
    // Your own dollars gathered into one address aren't a payment to you.
    for (const r of p.receipts.filter((x) => x.kind !== 'change')) {
      const day = dayOf(r.at)
      const last = groups[groups.length - 1]
      if (last?.day === day) last.receipts.push(r)
      else groups.push({ day, receipts: [r] })
    }
    return groups
  }, [p.receipts])
  const payments = days.reduce((n, d) => n + d.receipts.length, 0)

  return (
    <Screen edges={['top']}>
      <Header title="Private dollars" subtitle={p.keysHere && p.published ? 'Only you can see these' : undefined} />
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
        {!p.ready ? (
          <ActivityIndicator color={colors.ink} style={{ marginTop: 60 }} />
        ) : (
          <>
            <Rise>
              <PrivateCard plain />
            </Rise>

            <Txt weight="bold" size={20} style={styles.section}>
              How it stays private
            </Txt>
            <View style={styles.explain}>
              <PrivateFlow receipt={p.receipts.find((r) => r.kind !== 'change')} />
              <Txt size={14} color={colors.onTint} style={{ marginTop: 14, lineHeight: 20 }}>
                Someone who sends you dollars privately pays an address made for that payment alone. Monad shows who sent it and how much,
                but only your keys can tell the address is yours, so nobody can add up what you receive.
              </Txt>
              <Txt size={13} color={colors.muted} style={{ marginTop: 8, lineHeight: 18 }}>
                Spend them where they are: pay shops and send privately straight from these addresses, and your wallet never shows. Moving
                them into your balance is public on Monad, like any payment to your wallet.
              </Txt>
            </View>

            <View style={styles.sectionRow}>
              <Txt weight="bold" size={20}>
                Every private payment
              </Txt>
              {days.length ? (
                <Txt size={14} color={colors.muted}>
                  {payments} {payments === 1 ? 'payment' : 'payments'}
                </Txt>
              ) : null}
            </View>
            {days.length === 0 ? (
              <View style={styles.none}>
                <Txt size={15} color={colors.muted} style={{ lineHeight: 21 }}>
                  {p.keysHere
                    ? 'Private payments show up here the moment they land, each with its own address.'
                    : 'Set up private receiving on this phone to see them.'}
                </Txt>
              </View>
            ) : (
              days.map((group) => (
                <View key={group.day} style={{ marginBottom: 14 }}>
                  <Txt weight="semi" size={13} color={colors.muted} style={styles.day}>
                    {group.day}
                  </Txt>
                  <View style={styles.list}>
                    {group.receipts.map((r, i) => (
                      <PrivateRow key={r.id} receipt={r} last={i === group.receipts.length - 1} />
                    ))}
                  </View>
                </View>
              ))
            )}

            <Txt weight="bold" size={20} style={styles.section}>
              Receiving privately
            </Txt>
            <ReceivingCard />
          </>
        )}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  section: { marginTop: 28, marginBottom: 12, letterSpacing: -0.4 },
  sectionRow: { marginTop: 28, marginBottom: 12, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  explain: { borderRadius: 24, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.surface, padding: 14 },
  none: { borderRadius: 22, borderWidth: 2, borderColor: colors.ink, borderStyle: 'dashed', padding: 16 },
  day: { marginBottom: 8, marginLeft: 4 },
  list: { borderRadius: 22, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.surface, overflow: 'hidden' },
})
