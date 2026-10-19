import * as Haptics from 'expo-haptics'
import { Redirect, router } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { type ExtraBag, getFlightOffer, type Slice } from '@/lib/api'
import { formatLocal } from '@/lib/money'
import { colors } from '@/lib/theme'
import { clock, day, flightTotal, hours, useTravel } from '@/lib/travel'
import { useWallet } from '@/lib/wallet'
import { Icon } from '@/ui/Icon'
import { Header, PillButton, Screen, Txt } from '@/ui/primitives'
import { dollars, Stepper } from '@/ui/StallParts'
import { OfferCard } from './flights'

/** One fare, in full: every leg and layover, what's included, and the extras you can add. */
export default function Flight() {
  const insets = useSafeAreaInsets()
  const { profile } = useWallet()
  const { draft, setDraft } = useTravel()
  const [loading, setLoading] = useState(true)
  const [problem, setProblem] = useState<string | null>(null)
  const flight = draft.flight

  useEffect(() => {
    if (!flight) return
    getFlightOffer(flight.offer.id)
      .then((offer) => setDraft((d) => (d.flight ? { flight: { ...d.flight, offer } } : d)))
      .catch((error: Error) => setProblem(error.message))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flight?.offer.id])

  if (!flight) return <Redirect href="/travel" />
  const { offer } = flight
  const total = flightTotal(flight)
  const extras =
    Object.values(flight.bags).some((q) => q > 0) || Object.keys(flight.seats).length > 0
  const passengerName = (id: string) => {
    const i = offer.passengers.findIndex((p) => p.id === id)
    return i < 0 ? 'A traveller' : `Traveller ${i + 1}`
  }

  const setBag = (bag: ExtraBag, qty: number) =>
    setDraft((d) =>
      d.flight ? { flight: { ...d.flight, bags: { ...d.flight.bags, [bag.id]: qty } } } : d,
    )

  return (
    <Screen bg={colors.paper} edges={['top']}>
      <Header
        title={
          offer.slices[0]
            ? `${offer.slices[0].from.city} to ${offer.slices[0].to.city}`
            : 'Your flight'
        }
        subtitle={offer.owner.name}
      />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 150 }}>
        <OfferCard offer={offer} currency={profile?.currency ?? 'USD'} />

        {offer.slices.map((s, i) => (
          <Itinerary
            key={s.id}
            slice={s}
            label={offer.slices.length > 1 ? (i === 0 ? 'Outbound' : 'Return') : 'Your flight'}
          />
        ))}

        <Txt weight="bold" size={20} style={styles.section}>
          The fare
        </Txt>
        <View style={styles.box}>
          <Fact
            icon="bag"
            text={
              offer.bags.checked
                ? `${offer.bags.checked} checked bag included per person`
                : 'Hand luggage only'
            }
          />
          <Fact
            icon="swap"
            text={offer.changeable ? 'Changes allowed (the airline may charge)' : 'No changes'}
          />
          <Fact
            icon="receive"
            text={offer.refundable ? 'Refundable before departure' : 'Not refundable'}
          />
          <Fact
            icon="clock"
            text={
              offer.holdable && !extras
                ? `The airline holds this fare while it’s paid, until ${new Date(offer.hold_until ?? offer.expires_at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`
                : `This price lasts until ${new Date(offer.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Pay before then.`
            }
            last
          />
        </View>

        <Txt weight="bold" size={20} style={styles.section}>
          Extras
        </Txt>
        {loading ? (
          <ActivityIndicator color={colors.ink} style={{ marginTop: 12 }} />
        ) : (
          <View style={styles.box}>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/travel/seats')}
              style={({ pressed }) => [styles.extraRow, pressed && { opacity: 0.7 }]}
            >
              <View style={styles.extraIcon}>
                <Icon name="grid" size={18} />
              </View>
              <View style={{ flex: 1 }}>
                <Txt weight="semi" size={16}>
                  Seats
                </Txt>
                <Txt size={13} color={colors.muted} numberOfLines={2}>
                  {Object.keys(flight.seats).length
                    ? Object.values(flight.seats)
                        .map((s) => s.designator)
                        .join(', ')
                    : 'Choose where you sit, where the airline allows it'}
                </Txt>
              </View>
              <Icon name="arrow" size={20} />
            </Pressable>
            {(offer.extra_bags ?? []).length === 0 ? (
              <View style={[styles.extraRow, { borderBottomWidth: 0 }]}>
                <View style={styles.extraIcon}>
                  <Icon name="bag" size={18} />
                </View>
                <Txt size={14} color={colors.muted} style={{ flex: 1 }}>
                  This airline doesn’t sell extra bags here. You can add them later with the
                  airline.
                </Txt>
              </View>
            ) : (
              (offer.extra_bags ?? []).map((bag, i, all) => (
                <View
                  key={bag.id}
                  style={[styles.extraRow, i === all.length - 1 && { borderBottomWidth: 0 }]}
                >
                  <View style={styles.extraIcon}>
                    <Icon name="bag" size={18} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt weight="semi" size={15}>
                      {bag.kind === 'checked' ? 'Checked bag' : 'Cabin bag'}
                      {bag.weight_kg ? `, ${bag.weight_kg} kg` : ''}
                    </Txt>
                    <Txt size={13} color={colors.muted}>
                      {dollars(bag.price.usd)} each,{' '}
                      {bag.passenger_ids.map(passengerName).join(', ')}
                      {offer.slices.length > 1 &&
                      bag.segment_ids.length < offer.slices.flatMap((s) => s.segments).length
                        ? ', one way'
                        : ''}
                    </Txt>
                  </View>
                  {flight.bags[bag.id] ? (
                    <Stepper
                      small
                      value={flight.bags[bag.id] ?? 0}
                      name="bag"
                      max={bag.max}
                      onChange={(n) => setBag(bag, n)}
                    />
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Add this bag"
                      onPress={() => {
                        void Haptics.selectionAsync()
                        setBag(bag, 1)
                      }}
                      style={styles.add}
                    >
                      <Icon name="plus" size={18} strokeWidth={2.4} />
                    </Pressable>
                  )}
                </View>
              ))
            )}
          </View>
        )}
        {extras && offer.holdable ? (
          <Txt
            size={13}
            color={colors.muted}
            style={{ marginTop: 8, marginLeft: 4, lineHeight: 19 }}
          >
            With seats or bags added, the fare can’t be held: pay before it expires.
          </Txt>
        ) : null}
        {problem ? (
          <Txt weight="medium" size={14} color={colors.danger} style={{ marginTop: 12 }}>
            {problem}
          </Txt>
        ) : null}
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={{ flex: 1 }}>
          <Txt size={13} color={colors.muted}>
            Total for {offer.passengers.length}{' '}
            {offer.passengers.length === 1 ? 'traveller' : 'travellers'}
          </Txt>
          <Txt weight="bold" size={24} style={{ letterSpacing: -0.6 }}>
            {dollars(total)}
          </Txt>
          {profile && profile.currency !== 'USD' ? (
            <Txt size={12} color={colors.muted}>
              about {formatLocal(total, profile.currency)}
            </Txt>
          ) : null}
        </View>
        <View style={{ width: 190 }}>
          <PillButton label="Continue" icon="arrow" onPress={() => router.push('/travel/book')} />
        </View>
      </View>
    </Screen>
  )
}

function Itinerary({ slice, label }: { slice: Slice; label: string }) {
  return (
    <>
      <Txt weight="bold" size={20} style={styles.section}>
        {label}, {day(slice.departs)}
      </Txt>
      <View style={styles.box}>
        {slice.segments.map((g, i) => {
          const next = slice.segments[i + 1]
          const layover = next
            ? Math.round((Date.parse(`${next.departs}Z`) - Date.parse(`${g.arrives}Z`)) / 60000)
            : 0
          return (
            <View key={g.id}>
              <View style={styles.leg}>
                <View style={styles.legLine}>
                  <View style={styles.legDot} />
                  <View style={styles.legRule} />
                  <View style={styles.legDot} />
                </View>
                <View style={{ flex: 1, gap: 10 }}>
                  <View style={styles.legStop}>
                    <Txt weight="bold" size={17}>
                      {clock(g.departs)}
                    </Txt>
                    <Txt weight="medium" size={15} style={{ flex: 1 }} numberOfLines={1}>
                      {g.from.city} ({g.from.iata})
                    </Txt>
                  </View>
                  <Txt size={13} color={colors.muted}>
                    {g.carrier.name} {g.flight}
                    {g.aircraft ? `, ${g.aircraft}` : ''}
                    {g.operated_by ? `, operated by ${g.operated_by}` : ''}
                    {g.minutes ? `, ${hours(g.minutes)}` : ''}
                  </Txt>
                  <View style={styles.legStop}>
                    <Txt weight="bold" size={17}>
                      {clock(g.arrives)}
                    </Txt>
                    <Txt weight="medium" size={15} style={{ flex: 1 }} numberOfLines={1}>
                      {g.to.city} ({g.to.iata})
                    </Txt>
                  </View>
                </View>
              </View>
              {next ? (
                <View style={styles.layover}>
                  <Icon name="clock" size={15} />
                  <Txt weight="semi" size={13}>
                    {hours(layover)} in {g.to.city}
                    {next.from.iata !== g.to.iata ? `, change to ${next.from.iata}` : ''}
                  </Txt>
                </View>
              ) : null}
            </View>
          )
        })}
      </View>
    </>
  )
}

function Fact({
  icon,
  text,
  last,
}: {
  icon: 'bag' | 'swap' | 'receive' | 'clock'
  text: string
  last?: boolean
}) {
  return (
    <View style={[styles.extraRow, last && { borderBottomWidth: 0 }]}>
      <View style={styles.extraIcon}>
        <Icon name={icon} size={18} />
      </View>
      <Txt weight="medium" size={15} style={{ flex: 1, lineHeight: 21 }}>
        {text}
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  section: { letterSpacing: -0.4, marginTop: 24, marginBottom: 10 },
  box: {
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
  },
  leg: { flexDirection: 'row', gap: 12, paddingVertical: 14 },
  legLine: { width: 12, alignItems: 'center', paddingVertical: 6 },
  legDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  legRule: { flex: 1, width: 2, backgroundColor: colors.ink },
  legStop: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  layover: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 24,
    marginBottom: 4,
    padding: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: colors.coralSoft,
    alignSelf: 'flex-start',
  },
  extraRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: colors.sunken,
  },
  extraIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.tealSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  add: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
    borderColor: colors.ink,
  },
})
