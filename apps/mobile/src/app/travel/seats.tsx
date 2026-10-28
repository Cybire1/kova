import * as Haptics from 'expo-haptics'
import { Redirect, router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getSeatMaps, type SeatCell, type SeatMap } from '@/lib/api'
import { colors } from '@/lib/theme'
import { useTravel } from '@/lib/travel'
import { Kovi } from '@/ui/art'
import { Header, PillButton, Txt } from '@/ui/primitives'
import { dollars } from '@/ui/StallParts'

type Seat = Extract<SeatCell, { kind: 'seat' }>

/** The cabin, seat by seat, for each flight and each traveller. */
export default function Seats() {
  const insets = useSafeAreaInsets()
  const { draft, setDraft } = useTravel()
  const [maps, setMaps] = useState<SeatMap[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [segment, setSegment] = useState(0)
  const [traveller, setTraveller] = useState(0)
  const flight = draft.flight

  useEffect(() => {
    if (!flight) return
    getSeatMaps(flight.offer.id)
      .then(setMaps)
      .catch((error: Error) => setProblem(error.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flight?.offer.id])

  const segments = useMemo(
    () => flight?.offer.slices.flatMap((s) => s.segments) ?? [],
    [flight?.offer.slices],
  )
  if (!flight) return <Redirect href="/travel" />

  const map = maps?.[segment]
  const seg = segments.find((g) => g.id === map?.segment_id)
  const passenger = flight.offer.passengers[traveller]
  const key = passenger && map ? `${passenger.id}:${map.segment_id}` : ''
  const mine = flight.seats[key]
  const takenBy = (designator: string) =>
    Object.entries(flight.seats).find(
      ([k, s]) => k.endsWith(`:${map?.segment_id}`) && s.designator === designator && k !== key,
    )

  const pick = (seat: Seat) => {
    if (!passenger || !map) return
    const service = seat.services.find((s) => s.passenger_id === passenger.id)
    if (!service || takenBy(seat.designator)) return
    void Haptics.selectionAsync()
    setDraft((d) => {
      if (!d.flight) return d
      const seats = { ...d.flight.seats }
      if (seats[key]?.designator === seat.designator) delete seats[key]
      else
        seats[key] = {
          serviceId: service.id,
          designator: seat.designator,
          passengerId: passenger.id,
          segmentId: map.segment_id,
          price: service.price,
        }
      return { flight: { ...d.flight, seats } }
    })
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper, paddingTop: 8 }}>
      <Header
        title="Choose seats"
        subtitle={seg ? `${seg.from.iata} to ${seg.to.iata}, ${seg.flight}` : undefined}
        backIcon="close"
      />
      {maps === null && !problem ? (
        <ActivityIndicator color={colors.ink} style={{ marginTop: 40 }} />
      ) : !maps?.length ? (
        <View style={styles.center}>
          <Kovi pose="oops" size={120} />
          <Txt weight="semi" size={18} style={{ marginTop: 8 }}>
            No seat map for this flight
          </Txt>
          <Txt
            size={15}
            color={colors.muted}
            style={{ textAlign: 'center', marginTop: 4, lineHeight: 21 }}
          >
            {problem ?? 'The airline gives out seats at check-in instead.'}
          </Txt>
        </View>
      ) : (
        <>
          {maps.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tabs}
            >
              {maps.map((m, i) => {
                const g = segments.find((x) => x.id === m.segment_id)
                return (
                  <Pressable
                    key={m.id}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: i === segment }}
                    onPress={() => setSegment(i)}
                    style={[styles.tab, i === segment && styles.tabOn]}
                  >
                    <Txt
                      weight="semi"
                      size={14}
                      color={i === segment ? colors.onChosen : colors.ink}
                    >
                      {g ? `${g.from.iata} to ${g.to.iata}` : `Flight ${i + 1}`}
                    </Txt>
                  </Pressable>
                )
              })}
            </ScrollView>
          ) : null}
          {flight.offer.passengers.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tabs}
            >
              {flight.offer.passengers.map((p, i) => {
                const chosen = map ? flight.seats[`${p.id}:${map.segment_id}`] : undefined
                return (
                  <Pressable
                    key={p.id}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: i === traveller }}
                    onPress={() => setTraveller(i)}
                    style={[styles.tab, i === traveller && styles.tabOn]}
                  >
                    <Txt
                      weight="semi"
                      size={14}
                      color={i === traveller ? colors.onChosen : colors.ink}
                    >
                      Traveller {i + 1}
                      {chosen ? `, ${chosen.designator}` : ''}
                    </Txt>
                  </Pressable>
                )
              })}
            </ScrollView>
          ) : null}

          <View style={styles.legend}>
            <Legend style={styles.seatFree} label="Free" />
            <Legend style={styles.seatPaid} label="Extra cost" />
            <Legend style={styles.seatMine} label="Yours" />
            <Legend style={styles.seatTaken} label="Taken" />
          </View>

          <ScrollView
            contentContainerStyle={{ alignItems: 'center', paddingBottom: 140, paddingTop: 8 }}
          >
            <View style={styles.fuselage}>
              {map?.rows.map((row, r) => {
                const number = row
                  .flat()
                  .find((c): c is Seat => c.kind === 'seat')
                  ?.designator.replace(/[A-Z]+$/, '')
                const exit = row.every((section) => section.every((c) => c.kind !== 'seat'))
                if (exit) return <View key={`r${r}`} style={styles.exitRow} />
                return (
                  <View key={`r${r}`} style={styles.row}>
                    <Txt weight="semi" size={11} color={colors.muted} style={styles.rowNo}>
                      {number ?? ''}
                    </Txt>
                    {row.map((section, s) => (
                      <View
                        key={`s${s}`}
                        style={[styles.section, s < row.length - 1 && styles.aisle]}
                      >
                        {section.map((cell, c) => {
                          if (cell.kind !== 'seat')
                            return <View key={`c${c}`} style={styles.cell} />
                          const service = passenger
                            ? cell.services.find((x) => x.passenger_id === passenger.id)
                            : undefined
                          const other = takenBy(cell.designator)
                          const on = mine?.designator === cell.designator
                          const free = service && Number(service.price.usd) === 0
                          const style = on
                            ? styles.seatMine
                            : !service || other
                              ? styles.seatTaken
                              : free
                                ? styles.seatFree
                                : styles.seatPaid
                          return (
                            <Pressable
                              key={cell.designator}
                              accessibilityRole="button"
                              accessibilityLabel={`Seat ${cell.designator}${service ? `, ${free ? 'free' : dollars(service.price.usd)}` : ', taken'}`}
                              accessibilityState={{
                                selected: on,
                                disabled: !service || Boolean(other),
                              }}
                              disabled={!service || Boolean(other)}
                              onPress={() => pick(cell)}
                              style={[styles.cell, styles.seat, style]}
                            >
                              <Txt weight="bold" size={11}>
                                {cell.designator.replace(/^\d+/, '')}
                              </Txt>
                            </Pressable>
                          )
                        })}
                      </View>
                    ))}
                  </View>
                )
              })}
            </View>
          </ScrollView>
        </>
      )}

      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={{ flex: 1 }}>
          <Txt size={13} color={colors.muted}>
            {passenger ? `Traveller ${traveller + 1}` : 'Seats'}
          </Txt>
          <Txt weight="bold" size={20}>
            {mine
              ? `${mine.designator}, ${Number(mine.price.usd) === 0 ? 'free' : dollars(mine.price.usd)}`
              : 'No seat yet'}
          </Txt>
        </View>
        <View style={{ width: 150 }}>
          <PillButton label="Done" icon="check" onPress={() => router.back()} />
        </View>
      </View>
    </View>
  )
}

function Legend({ style, label }: { style: object; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={[styles.legendSwatch, style]} />
      <Txt size={12} color={colors.muted}>
        {label}
      </Txt>
    </View>
  )
}

const CELL = 34

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  tabs: { gap: 8, paddingHorizontal: 20, paddingVertical: 6 },
  tab: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.line,
    justifyContent: 'center',
  },
  tabOn: { backgroundColor: colors.chosen },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: 14, paddingVertical: 10 },
  legendSwatch: { width: 16, height: 16, borderRadius: 5, borderWidth: 2 },
  fuselage: {
    paddingVertical: 18,
    paddingHorizontal: 14,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  row: { flexDirection: 'row', alignItems: 'center', marginVertical: 3 },
  rowNo: { width: 22, textAlign: 'center' },
  exitRow: { height: 14 },
  section: { flexDirection: 'row', gap: 4 },
  aisle: { marginRight: 22 },
  cell: { width: CELL, height: CELL },
  seat: { borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  seatFree: { backgroundColor: colors.raised, borderColor: colors.line },
  seatPaid: { backgroundColor: colors.tealSoft, borderColor: colors.line },
  seatMine: { backgroundColor: colors.coral, borderColor: colors.line },
  seatTaken: { backgroundColor: colors.sunken, borderColor: colors.sunken },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 14,
    backgroundColor: colors.paper,
    borderTopWidth: 2,
    borderColor: colors.line,
  },
})
