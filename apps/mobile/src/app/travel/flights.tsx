import * as Haptics from 'expo-haptics'
import { Image } from 'expo-image'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { FlatList, Pressable, StyleSheet, View } from 'react-native'
import { type FlightOffer, type FlightSearch, type Slice, searchFlights } from '@/lib/api'
import { formatLocal } from '@/lib/money'
import { colors } from '@/lib/theme'
import { clock, day, hours, useTravel } from '@/lib/travel'
import { useWallet } from '@/lib/wallet'
import { Flyer } from '@/ui/art'
import { Icon } from '@/ui/Icon'
import { Bob } from '@/ui/motion'
import { Header, Screen, Txt } from '@/ui/primitives'
import { Stage as KoviStage } from '@/ui/Stage'
import { dollars } from '@/ui/StallParts'

type Sort = 'best' | 'cheapest' | 'fastest'

const totalMinutes = (o: FlightOffer) => o.slices.reduce((sum, s) => sum + (s.minutes ?? 9999), 0)

/** Every fare for the search, best match first when you said what matters. */
export default function Flights() {
  const p = useLocalSearchParams<Record<string, string>>()
  const { profile } = useWallet()
  const { setDraft } = useTravel()
  const [offers, setOffers] = useState<FlightOffer[] | null>(null)
  const [best, setBest] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort>('cheapest')
  const [nonstop, setNonstop] = useState(false)

  const search: FlightSearch = useMemo(
    () => ({
      from: p.from ?? '',
      to: p.to ?? '',
      depart: p.depart ?? '',
      return: p.return || null,
      adults: Number(p.adults ?? 1),
      children: Number(p.children ?? 0),
      infants: Number(p.infants ?? 0),
      cabin: (p.cabin as FlightSearch['cabin']) ?? 'economy',
      wishes: p.wishes || null,
    }),
    [p.from, p.to, p.depart, p.return, p.adults, p.children, p.infants, p.cabin, p.wishes],
  )

  useEffect(() => {
    let live = true
    searchFlights(search)
      .then((r) => {
        if (!live) return
        setOffers(r.data)
        setBest(r.best)
        if (r.best) setSort('best')
      })
      .catch((error: Error) => live && setProblem(error.message))
    return () => {
      live = false
    }
  }, [search])

  const shown = useMemo(() => {
    let list = [...(offers ?? [])]
    if (nonstop) list = list.filter((o) => o.slices.every((s) => s.stops === 0))
    if (sort === 'fastest') list.sort((a, b) => totalMinutes(a) - totalMinutes(b))
    else list.sort((a, b) => Number(a.price.usd) - Number(b.price.usd))
    if (sort === 'best' && best) {
      const i = list.findIndex((o) => o.id === best)
      if (i > 0) list.unshift(...list.splice(i, 1))
    }
    return list
  }, [offers, sort, nonstop, best])

  const people = search.adults + search.children + search.infants
  const subtitle = `${day(search.depart)}${search.return ? ` to ${day(search.return)}` : ', one way'}, ${people} ${people === 1 ? 'traveller' : 'travellers'}`

  const open = (offer: FlightOffer) => {
    void Haptics.selectionAsync()
    setDraft({ flight: { search, offer, bags: {}, seats: {} } })
    router.push('/travel/flight')
  }

  return (
    <Screen bg={colors.paper}>
      <Header
        title={`${p.fromCity ?? search.from} to ${p.toCity ?? search.to}`}
        subtitle={subtitle}
      />
      {offers === null && !problem ? (
        <View style={styles.center}>
          <Bob distance={10}>
            <Flyer size={150} />
          </Bob>
          <Txt weight="semi" size={20} style={{ marginTop: 10 }}>
            Asking the airlines
          </Txt>
          <Txt size={15} color={colors.muted} style={{ marginTop: 4 }}>
            Fares land here in a few seconds.
          </Txt>
        </View>
      ) : problem ? (
        <View style={styles.center}>
          <KoviStage pose="oops" size={140} motion="bob" />
          <Txt weight="semi" size={20} style={{ marginTop: 10 }}>
            No fares this time
          </Txt>
          <Txt
            size={15}
            color={colors.muted}
            style={{ marginTop: 4, textAlign: 'center', lineHeight: 21 }}
          >
            {problem}
          </Txt>
        </View>
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, gap: 12 }}
          ListHeaderComponent={
            <View style={styles.sorts}>
              {best ? (
                <Chip
                  label="Best match"
                  on={sort === 'best'}
                  onPress={() => setSort('best')}
                  icon
                />
              ) : null}
              <Chip label="Cheapest" on={sort === 'cheapest'} onPress={() => setSort('cheapest')} />
              <Chip label="Fastest" on={sort === 'fastest'} onPress={() => setSort('fastest')} />
              <Chip label="Non-stop" on={nonstop} onPress={() => setNonstop((n) => !n)} />
            </View>
          }
          renderItem={({ item }) => (
            <OfferCard
              offer={item}
              best={item.id === best}
              currency={profile?.currency ?? 'USD'}
              onPress={() => open(item)}
            />
          )}
          ListEmptyComponent={
            <View style={[styles.center, { paddingTop: 40 }]}>
              <KoviStage pose="oops" size={120} motion="bob" />
              <Txt weight="semi" size={18} style={{ marginTop: 8 }}>
                {offers?.length ? 'No non-stop fares' : 'No fares on that day'}
              </Txt>
              <Txt size={15} color={colors.muted} style={{ marginTop: 4, textAlign: 'center' }}>
                {offers?.length
                  ? 'Allow a stop to see the rest.'
                  : 'Try another date or a nearby airport.'}
              </Txt>
            </View>
          }
        />
      )}
    </Screen>
  )
}

function Chip({
  label,
  on,
  onPress,
  icon,
}: {
  label: string
  on: boolean
  onPress: () => void
  icon?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={() => {
        void Haptics.selectionAsync()
        onPress()
      }}
      style={[styles.chip, on && styles.chipOn, icon && !on && { borderColor: colors.coral }]}
    >
      {icon ? <Icon name="sparkle" size={14} color={on ? colors.white : colors.coralDeep} /> : null}
      <Txt weight="semi" size={14} color={on ? colors.white : colors.ink}>
        {label}
      </Txt>
    </Pressable>
  )
}

export function OfferCard({
  offer,
  best,
  currency,
  onPress,
}: {
  offer: FlightOffer
  best?: boolean
  currency: string
  onPress?: () => void
}) {
  const local = currency !== 'USD' ? formatLocal(Number(offer.price.usd), currency as never) : null
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${offer.owner.name}, ${dollars(offer.price.usd)}`}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        best && styles.cardBest,
        pressed && { transform: [{ scale: 0.99 }] },
      ]}
    >
      <View style={styles.cardTop}>
        <View style={styles.logo}>
          {offer.owner.logo ? (
            <Image
              source={{ uri: offer.owner.logo }}
              style={{ width: 26, height: 26 }}
              contentFit="contain"
            />
          ) : (
            <Icon name="send" size={16} />
          )}
        </View>
        <Txt weight="semi" size={15} style={{ flex: 1 }} numberOfLines={1}>
          {offer.owner.name}
        </Txt>
        <View style={{ alignItems: 'flex-end' }}>
          <Txt weight="bold" size={20}>
            {dollars(offer.price.usd)}
          </Txt>
          {local ? (
            <Txt size={12} color={colors.muted}>
              about {local}
            </Txt>
          ) : null}
        </View>
      </View>
      {offer.slices.map((s) => (
        <SliceLine key={s.id} slice={s} />
      ))}
      <View style={styles.tags}>
        {best ? <Tag label="Best match" tone={colors.coral} light /> : null}
        {offer.holdable ? <Tag label="Can be paid later" tone={colors.tealSoft} /> : null}
        <Tag
          label={offer.bags.checked ? `${offer.bags.checked} checked bag` : 'Hand luggage only'}
          tone={colors.sunken}
        />
        {offer.refundable ? <Tag label="Refundable" tone={colors.sunken} /> : null}
      </View>
    </Pressable>
  )
}

export function SliceLine({ slice }: { slice: Slice }) {
  return (
    <View style={styles.slice}>
      <View style={{ alignItems: 'flex-start', minWidth: 58 }}>
        <Txt weight="bold" size={22} style={{ letterSpacing: -0.5 }}>
          {clock(slice.departs)}
        </Txt>
        <Txt weight="semi" size={13} color={colors.muted}>
          {slice.from.iata}
        </Txt>
      </View>
      <View style={styles.track}>
        <Txt size={12} color={colors.muted}>
          {hours(slice.minutes)}
        </Txt>
        <View style={styles.trackLine}>
          <View style={styles.trackDot} />
          <View style={styles.trackRule} />
          {Array.from({ length: slice.stops }, (_, i) => (
            <View
              key={i}
              style={[styles.stopDot, { left: `${((i + 1) / (slice.stops + 1)) * 100}%` }]}
            />
          ))}
          <Icon name="send" size={14} />
        </View>
        <Txt size={12} color={slice.stops ? colors.coralDeep : colors.tealDeep} weight="semi">
          {slice.stops === 0
            ? 'Non-stop'
            : `${slice.stops} stop${slice.stops > 1 ? 's' : ''}, ${slice.segments
                .slice(0, -1)
                .map((g) => g.to.iata)
                .join(', ')}`}
        </Txt>
      </View>
      <View style={{ alignItems: 'flex-end', minWidth: 58 }}>
        <Txt weight="bold" size={22} style={{ letterSpacing: -0.5 }}>
          {clock(slice.arrives)}
        </Txt>
        <Txt weight="semi" size={13} color={colors.muted}>
          {slice.to.iata}
        </Txt>
      </View>
    </View>
  )
}

function Tag({ label, tone, light }: { label: string; tone: string; light?: boolean }) {
  return (
    <View style={[styles.tag, { backgroundColor: tone }]}>
      <Txt weight="semi" size={12} color={light ? colors.white : colors.ink}>
        {label}
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  sorts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 8, paddingBottom: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: colors.ink,
  },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  card: {
    padding: 14,
    gap: 12,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  cardBest: { borderColor: colors.coral, borderWidth: 3, backgroundColor: colors.white },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slice: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  track: { flex: 1, alignItems: 'center', gap: 3 },
  trackLine: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 4 },
  trackDot: { width: 7, height: 7, borderRadius: 4, borderWidth: 2, borderColor: colors.ink },
  trackRule: { flex: 1, height: 2, borderRadius: 1, backgroundColor: colors.ink },
  stopDot: {
    position: 'absolute',
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.coral,
    borderWidth: 2,
    borderColor: colors.surface,
    marginLeft: -4,
  },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { height: 26, paddingHorizontal: 10, borderRadius: 13, justifyContent: 'center' },
})
