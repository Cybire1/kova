import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { type ColorValue, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { SpendingCategory } from '@/lib/api'
import { categoryInfo, useSpendingCategories } from '@/lib/categories'
import { formatUsd } from '@/lib/money'
import { useOffline } from '@/lib/offline'
import { colors } from '@/lib/theme'
import { type Entry, useWallet } from '@/lib/wallet'
import Animated from '@/ui/animated'
import { Kovi } from '@/ui/art'
import { dockClearance } from '@/ui/Dock'
import { EntryRow } from '@/ui/EntryRow'
import { EnvelopeBadge } from '@/ui/LinkParts'
import { WaitingCard } from '@/ui/Offline'
import { Txt } from '@/ui/primitives'

const filters = [
  { key: 'all', label: 'All' },
  { key: 'out', label: 'Money out' },
  { key: 'in', label: 'Money in' },
] as const
type Filter = (typeof filters)[number]['key']

const incoming = (e: Entry) => e.kind === 'received' || e.kind === 'added'
const DAY = 86_400_000

function dayLabel(at: number) {
  const d = new Date(at)
  if (d.toDateString() === new Date().toDateString()) return 'Today'
  if (d.toDateString() === new Date(Date.now() - DAY).toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
}

/** Compact dollars for spoken chart labels: $1.2k, $3.4M. */
function short(base: bigint) {
  const n = Number(base) / 1e6
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`
  return `$${n.toFixed(2)}`
}

/**
 * Everything that moved. The month opens as a single card: the net, the split between money
 * in and out, and the last seven days as bars. Below, each day is its own card with its own
 * total, so a busy week still reads at a glance.
 */
export default function Activity() {
  const { activity } = useWallet()
  const { waiting } = useOffline()
  const insets = useSafeAreaInsets()
  const [filter, setFilter] = useState<Filter>('all')
  const [category, setCategory] = useState<SpendingCategory | null>(null)
  const cats = useSpendingCategories(activity)

  const month = useMemo(() => {
    const start = new Date()
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
    let out = 0n
    let got = 0n
    for (const e of activity) {
      if (e.at < start.getTime()) continue
      if (incoming(e)) got += BigInt(e.amount)
      else out += BigInt(e.amount)
    }
    return { out, got, net: got - out, name: start.toLocaleDateString([], { month: 'long' }) }
  }, [activity])

  const week = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const days = Array.from({ length: 7 }, (_, i) => {
      const start = today.getTime() - (6 - i) * DAY
      let got = 0n
      let out = 0n
      for (const e of activity) {
        if (e.at < start || e.at >= start + DAY) continue
        if (incoming(e)) got += BigInt(e.amount)
        else out += BigInt(e.amount)
      }
      return {
        start,
        got,
        out,
        label: new Date(start).toLocaleDateString([], { weekday: 'narrow' }),
      }
    })
    const max = days.reduce((m, d) => (d.got + d.out > m ? d.got + d.out : m), 0n)
    return { days, max }
  }, [activity])

  // Where this month's money went, by category, biggest first.
  const where = useMemo(() => {
    const start = new Date()
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
    const totals = new Map<SpendingCategory, bigint>()
    let unsorted = 0
    for (const e of activity) {
      if (e.at < start.getTime() || !cats.spending(e)) continue
      const c = cats.of(e)
      if (!c) {
        unsorted += 1
        continue
      }
      totals.set(c, (totals.get(c) ?? 0n) + BigInt(e.amount))
    }
    const list = [...totals.entries()].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    return { list, total: list.reduce((sum, [, v]) => sum + v, 0n), unsorted }
  }, [activity, cats])

  const groups = useMemo(() => {
    const shown = activity.filter((e) =>
      category
        ? cats.of(e) === category
        : filter === 'all'
          ? true
          : filter === 'in'
            ? incoming(e)
            : !incoming(e),
    )
    const map = new Map<string, Entry[]>()
    for (const e of shown) map.set(dayLabel(e.at), [...(map.get(dayLabel(e.at)) ?? []), e])
    return [...map.entries()].map(([title, entries]) => ({
      title,
      entries,
      net: entries.reduce(
        (sum, e) => sum + (incoming(e) ? BigInt(e.amount) : -BigInt(e.amount)),
        0n,
      ),
    }))
  }, [activity, filter, category, cats])

  const total = month.got + month.out
  const inShare = total > 0n ? Number((month.got * 1000n) / total) / 1000 : 0.5

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.paper }}
      contentContainerStyle={{
        paddingTop: insets.top + 8,
        paddingHorizontal: 20,
        paddingBottom: dockClearance + insets.bottom,
      }}
    >
      <View style={styles.titleRow}>
        <Txt weight="bold" size={32} style={{ letterSpacing: -1 }}>
          Activity
        </Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Your links"
          onPress={() => router.push('/links')}
          style={({ pressed }) => [styles.linksButton, pressed && { transform: [{ scale: 0.96 }] }]}
        >
          <EnvelopeBadge size={24} />
          <Txt weight="semi" size={14}>
            Your links
          </Txt>
        </Pressable>
      </View>

      {/* Offline payments signed but not yet settled: they become normal entries once they do. */}
      <WaitingCard items={waiting} />

      {/* The month */}
      <View style={styles.month}>
        <Txt weight="medium" size={14} color={colors.onInk}>
          {month.name}, net
        </Txt>
        <Txt
          weight="bold"
          size={40}
          color={month.net < 0n ? colors.coralSoft : colors.white}
          style={{ letterSpacing: -1.4 }}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {formatUsd(month.net, { sign: true })}
        </Txt>

        <View style={styles.split}>
          <View style={[styles.splitIn, { flex: Math.max(inShare, 0.02) }]} />
          <View style={[styles.splitOut, { flex: Math.max(1 - inShare, 0.02) }]} />
        </View>
        <View style={styles.legend}>
          <Legend color={colors.tealLight} label="In" value={formatUsd(month.got)} />
          <Legend color={colors.coral} label="Out" value={formatUsd(month.out)} align="right" />
        </View>

        <View style={styles.rule} />
        <Txt weight="medium" size={13} color={colors.onInk}>
          Last 7 days
        </Txt>
        <View style={styles.bars}>
          {week.days.map((d, i) => {
            const scale = week.max > 0n ? 88 / Number(week.max) : 0
            const hIn = Math.max(Number(d.got) * scale, d.got > 0n ? 4 : 0)
            const hOut = Math.max(Number(d.out) * scale, d.out > 0n ? 4 : 0)
            const today = i === 6
            return (
              <View
                key={d.start}
                style={styles.barCol}
                accessibilityLabel={`${d.label}: in ${short(d.got)}, out ${short(d.out)}`}
              >
                <View style={styles.barTrack}>
                  {hOut > 0 ? (
                    <View style={[styles.bar, { height: hOut, backgroundColor: colors.coral }]} />
                  ) : null}
                  {hIn > 0 ? (
                    <View
                      style={[styles.bar, { height: hIn, backgroundColor: colors.tealLight }]}
                    />
                  ) : null}
                  {hIn === 0 && hOut === 0 ? <View style={styles.barEmpty} /> : null}
                </View>
                <Txt
                  weight={today ? 'bold' : 'medium'}
                  size={12}
                  color={today ? colors.white : colors.onInk}
                >
                  {d.label}
                </Txt>
              </View>
            )
          })}
        </View>
      </View>

      {where.list.length > 0 ? (
        <View style={styles.where}>
          <View style={styles.whereHead}>
            <Txt weight="semi" size={17}>
              Where it went
            </Txt>
            <Txt size={13} color={colors.muted}>
              {where.unsorted ? `Sorting ${where.unsorted} more` : month.name}
            </Txt>
          </View>
          <View style={styles.whereBar}>
            {where.list.map(([c, v]) => (
              <View
                key={c}
                style={{
                  flex: Math.max(Number((v * 1000n) / (where.total || 1n)), 12),
                  backgroundColor: categoryInfo[c].color,
                  borderRadius: 5,
                }}
              />
            ))}
          </View>
          {where.list.map(([c, v]) => {
            const on = category === c
            const pct = Math.round(Number((v * 1000n) / (where.total || 1n)) / 10)
            return (
              <Pressable
                key={c}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${categoryInfo[c].label}, ${formatUsd(v)}, ${pct} percent. ${on ? 'Showing only these' : 'Show only these'}`}
                onPress={() => {
                  void Haptics.selectionAsync()
                  setCategory(on ? null : c)
                }}
                style={({ pressed }) => [
                  styles.whereRow,
                  on && styles.whereRowOn,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <View style={[styles.whereDot, { backgroundColor: categoryInfo[c].color }]} />
                <Txt weight={on ? 'bold' : 'medium'} size={15} style={{ flex: 1 }}>
                  {categoryInfo[c].label}
                </Txt>
                <Txt size={13} color={colors.muted}>
                  {pct}%
                </Txt>
                <Txt weight="semi" size={15} style={{ minWidth: 76, textAlign: 'right' }}>
                  {formatUsd(v)}
                </Txt>
              </Pressable>
            )
          })}
        </View>
      ) : null}

      {category ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setCategory(null)}
          style={styles.showing}
        >
          <View style={[styles.whereDot, { backgroundColor: categoryInfo[category].color }]} />
          <Txt weight="semi" size={15} style={{ flex: 1 }}>
            Only {categoryInfo[category].label.toLowerCase()}
          </Txt>
          <Txt weight="semi" size={15} style={{ textDecorationLine: 'underline' }}>
            Show all
          </Txt>
        </Pressable>
      ) : (
        <FilterSwitch value={filter} onChange={setFilter} />
      )}

      {groups.length === 0 ? (
        <View style={styles.empty}>
          <Kovi pose="wave" size={130} />
          <Txt weight="semi" size={20} style={{ marginTop: 8 }}>
            {activity.length === 0 ? 'Nothing here yet' : 'Nothing in this view'}
          </Txt>
          <Txt
            size={15}
            color={colors.muted}
            style={{ textAlign: 'center', marginTop: 4, lineHeight: 22 }}
          >
            {activity.length === 0
              ? 'Pay a shop or send money to a friend and it shows up here.'
              : 'Try another filter.'}
          </Txt>
        </View>
      ) : (
        groups.map((g) => (
          <View key={g.title} style={{ marginTop: 20 }}>
            <View style={styles.dayHead}>
              <Txt weight="semi" size={14} color={colors.muted}>
                {g.title}
              </Txt>
              <Txt weight="semi" size={14} color={g.net >= 0n ? colors.positive : colors.muted}>
                {formatUsd(g.net, { sign: true })}
              </Txt>
            </View>
            <View style={styles.day}>
              {g.entries.map((e, i) => (
                <View
                  key={e.id}
                  style={[styles.dayRow, i < g.entries.length - 1 && styles.dayRule]}
                >
                  <EntryRow entry={e} />
                </View>
              ))}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  )
}

function Legend({
  color,
  label,
  value,
  align,
}: {
  color: ColorValue
  label: string
  value: string
  align?: 'right'
}) {
  return (
    <View style={{ alignItems: align === 'right' ? 'flex-end' : 'flex-start' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
        <Txt size={12} color={colors.onInk}>
          {label}
        </Txt>
      </View>
      <Txt weight="semi" size={16} color={colors.white}>
        {value}
      </Txt>
    </View>
  )
}

/** All / Money out / Money in, with a thumb that slides to the choice. */
function FilterSwitch({ value, onChange }: { value: Filter; onChange: (f: Filter) => void }) {
  const [w, setW] = useState(0)
  const index = filters.findIndex((f) => f.key === value)
  const x = useSharedValue(index)
  useEffect(() => {
    x.value = withTiming(index, { duration: 280, easing: Easing.bezier(0.32, 0.72, 0, 1) })
  }, [index, x])
  const thumb = useAnimatedStyle(() => ({
    transform: [{ translateX: (x.value * w) / filters.length }],
  }))
  return (
    <View
      style={styles.filter}
      onLayout={(e) => setW(e.nativeEvent.layout.width - 10)}
      accessibilityRole="tablist"
    >
      <Animated.View style={[styles.filterThumb, { width: w / filters.length }, thumb]} />
      {filters.map((f) => {
        const on = f.key === value
        return (
          <Pressable
            key={f.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => {
              void Haptics.selectionAsync()
              onChange(f.key)
            }}
            style={styles.filterItem}
          >
            <Txt weight="semi" size={14} color={on ? colors.onChosen : colors.ink}>
              {f.label}
            </Txt>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  linksButton: {
    height: 36,
    paddingLeft: 8,
    paddingRight: 12,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  month: { marginTop: 16, borderRadius: 28, backgroundColor: colors.fill, padding: 18 },
  split: {
    flexDirection: 'row',
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
    gap: 3,
    marginTop: 14,
  },
  splitIn: { backgroundColor: colors.tealLight, borderRadius: 6 },
  splitOut: { backgroundColor: colors.coral, borderRadius: 6 },
  legend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  rule: { height: 1, backgroundColor: 'rgba(255,255,255,0.12)', marginVertical: 16 },
  bars: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 10,
    height: 112,
  },
  barCol: { alignItems: 'center', gap: 6, flex: 1 },
  barTrack: { height: 90, justifyContent: 'flex-end', alignItems: 'center', gap: 2 },
  bar: { width: 16, borderRadius: 5 },
  barEmpty: { width: 16, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.14)' },
  filter: {
    marginTop: 16,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    padding: 3,
  },
  filterThumb: {
    position: 'absolute',
    left: 3,
    top: 3,
    bottom: 3,
    borderRadius: 17,
    backgroundColor: colors.chosen,
  },
  filterItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dayHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  day: {
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
  },
  dayRow: { paddingVertical: 2 },
  dayRule: { borderBottomWidth: 1, borderColor: colors.sunken },
  empty: { alignItems: 'center', paddingTop: 36, paddingHorizontal: 20 },
  where: {
    marginTop: 16,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    padding: 14,
    paddingBottom: 8,
  },
  whereHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: 4,
  },
  whereBar: { flexDirection: 'row', height: 14, gap: 3, marginTop: 12, marginBottom: 6 },
  whereRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 6,
    borderRadius: 14,
  },
  whereRowOn: { backgroundColor: colors.paper },
  whereDot: { width: 10, height: 10, borderRadius: 5 },
  showing: {
    marginTop: 16,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
  },
})
