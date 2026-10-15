import * as Haptics from 'expo-haptics'
import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { colors } from '@/lib/theme'
import { day, nights, today } from '@/lib/travel'
import { PillButton, Txt } from '../primitives'
import { Sheet } from './Sheet'

const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/** YYYY-MM-DD for a UTC calendar day. */
const iso = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10)

/**
 * A year of months to pick dates from. Range mode takes two taps (out and back, or check in
 * and check out); a flight can switch to one way and take a single date.
 */
export function DateSheet({
  visible,
  onClose,
  onDone,
  start,
  end,
  labels,
  oneWay,
  onOneWay,
}: {
  visible: boolean
  onClose: () => void
  onDone: (start: string, end: string | null) => void
  start: string | null
  end: string | null
  labels: { start: string; end: string }
  /** Flights only: whether the trip is one way. */
  oneWay?: boolean
  onOneWay?: (oneWay: boolean) => void
}) {
  const [a, setA] = useState<string | null>(start)
  const [b, setB] = useState<string | null>(end)
  const single = Boolean(oneWay)
  const first = today()

  useEffect(() => {
    if (visible) {
      setA(start)
      setB(end)
    }
  }, [visible, start, end])

  const months = useMemo(() => {
    const now = new Date()
    return Array.from({ length: 12 }, (_, i) => {
      const y = now.getUTCFullYear() + Math.floor((now.getUTCMonth() + i) / 12)
      const m = (now.getUTCMonth() + i) % 12
      const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
      const lead = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7
      return {
        y,
        m,
        days,
        lead,
        title: new Date(Date.UTC(y, m, 1)).toLocaleDateString('en-GB', {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        }),
      }
    })
  }, [])

  const tap = (date: string) => {
    void Haptics.selectionAsync()
    if (single) return setA(date)
    if (!a || b || date <= a) {
      setA(date)
      setB(null)
    } else setB(date)
  }

  const ready = single ? Boolean(a) : Boolean(a && b)
  const summary = !a
    ? `Pick ${labels.start.toLowerCase()}`
    : single
      ? day(a)
      : b
        ? `${day(a)} to ${day(b)}`
        : `${day(a)}, now pick ${labels.end.toLowerCase()}`

  return (
    <Sheet visible={visible} onClose={onClose} tall>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Txt weight="bold" size={22} style={{ letterSpacing: -0.5 }}>
            {summary}
          </Txt>
          {a && b && !single ? (
            <Txt size={13} color={colors.muted}>
              {labels.end === 'Check out'
                ? `${nights(a, b)} ${nights(a, b) === 1 ? 'night' : 'nights'}`
                : `${nights(a, b)} days away`}
            </Txt>
          ) : null}
        </View>
        {onOneWay ? (
          <View style={styles.toggle} accessibilityRole="radiogroup">
            {[
              { v: false, label: 'Return' },
              { v: true, label: 'One way' },
            ].map((o) => (
              <Pressable
                key={o.label}
                accessibilityRole="radio"
                accessibilityState={{ selected: single === o.v }}
                onPress={() => {
                  onOneWay(o.v)
                  if (o.v) setB(null)
                }}
                style={[styles.toggleItem, single === o.v && { backgroundColor: colors.ink }]}
              >
                <Txt weight="semi" size={13} color={single === o.v ? colors.white : colors.ink}>
                  {o.label}
                </Txt>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      <View style={styles.week}>
        {WEEK.map((d, i) => (
          <Txt key={`${d}${i}`} weight="semi" size={12} color={colors.muted} style={styles.weekDay}>
            {d}
          </Txt>
        ))}
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }}>
        {months.map((mo) => (
          <View key={mo.title} style={{ marginTop: 14 }}>
            <Txt weight="bold" size={16} style={{ marginBottom: 8, marginLeft: 4 }}>
              {mo.title}
            </Txt>
            <View style={styles.grid}>
              {Array.from({ length: mo.lead }, (_, i) => (
                <View key={`lead${i}`} style={styles.cell} />
              ))}
              {Array.from({ length: mo.days }, (_, i) => {
                const date = iso(mo.y, mo.m, i + 1)
                const past = date < first
                const edge = date === a || date === b
                const inside = Boolean(a && b && date > a && date < b)
                return (
                  <Pressable
                    key={date}
                    accessibilityRole="button"
                    accessibilityLabel={day(date)}
                    accessibilityState={{ disabled: past, selected: edge }}
                    disabled={past}
                    onPress={() => tap(date)}
                    style={[
                      styles.cell,
                      inside && styles.inside,
                      date === a && b && styles.rangeStart,
                      date === b && styles.rangeEnd,
                    ]}
                  >
                    <View style={[styles.dayDisc, edge && styles.dayOn]}>
                      <Txt
                        weight={edge ? 'bold' : 'medium'}
                        size={15}
                        color={edge ? colors.white : past ? '#B9B6AF' : colors.ink}
                      >
                        {i + 1}
                      </Txt>
                    </View>
                  </Pressable>
                )
              })}
            </View>
          </View>
        ))}
      </ScrollView>
      <PillButton
        label={ready ? 'Done' : summary}
        icon="check"
        disabled={!ready}
        onPress={() => a && onDone(a, single ? null : b)}
      />
    </Sheet>
  )
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  toggle: {
    flexDirection: 'row',
    padding: 3,
    gap: 2,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  toggleItem: { height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center' },
  week: {
    flexDirection: 'row',
    marginTop: 14,
    borderBottomWidth: 1,
    borderColor: colors.sunken,
    paddingBottom: 8,
  },
  weekDay: { width: `${100 / 7}%`, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, height: 46, alignItems: 'center', justifyContent: 'center' },
  inside: { backgroundColor: colors.tealSoft },
  rangeStart: {
    backgroundColor: colors.tealSoft,
    borderTopLeftRadius: 23,
    borderBottomLeftRadius: 23,
  },
  rangeEnd: {
    backgroundColor: colors.tealSoft,
    borderTopRightRadius: 23,
    borderBottomRightRadius: 23,
  },
  dayDisc: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayOn: { backgroundColor: colors.ink },
})
