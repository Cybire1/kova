import * as Haptics from 'expo-haptics'
import { Image } from 'expo-image'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { FlatList, Pressable, StyleSheet, View } from 'react-native'
import { type StayResult, type StaySearch, searchStays } from '@/lib/api'
import { formatLocal } from '@/lib/money'
import { colors } from '@/lib/theme'
import { day, nights } from '@/lib/travel'
import { useWallet } from '@/lib/wallet'
import { Kovi } from '@/ui/art'
import { Icon } from '@/ui/Icon'
import { Bob } from '@/ui/motion'
import { Header, Screen, Txt } from '@/ui/primitives'
import { Stage as KoviStage } from '@/ui/Stage'
import { dollars } from '@/ui/StallParts'

export function reviewWord(score: number | null) {
  if (score == null) return null
  return score >= 9
    ? 'Superb'
    : score >= 8.5
      ? 'Excellent'
      : score >= 8
        ? 'Very good'
        : score >= 7
          ? 'Good'
          : 'Fair'
}

/** Places to stay for the dates, best match first when you said what matters. */
export default function Stays() {
  const p = useLocalSearchParams<Record<string, string>>()
  const { profile } = useWallet()
  const [results, setResults] = useState<StayResult[] | null>(null)
  const [best, setBest] = useState<string | null>(null)
  const [testMode, setTestMode] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const search: StaySearch = useMemo(
    () => ({
      latitude: p.latitude ? Number(p.latitude) : null,
      longitude: p.longitude ? Number(p.longitude) : null,
      check_in: p.checkIn ?? '',
      check_out: p.checkOut ?? '',
      adults: Number(p.adults ?? 1),
      children: Number(p.children ?? 0),
      rooms: Number(p.rooms ?? 1),
      wishes: p.wishes || null,
    }),
    [p.latitude, p.longitude, p.checkIn, p.checkOut, p.adults, p.children, p.rooms, p.wishes],
  )

  useEffect(() => {
    let live = true
    searchStays(search)
      .then((r) => {
        if (!live) return
        setTestMode(r.test_mode)
        setBest(r.best)
        const list = [...r.data].sort(
          (a, b) => Number(a.from_price?.usd ?? Infinity) - Number(b.from_price?.usd ?? Infinity),
        )
        if (r.best) {
          const i = list.findIndex((x) => x.id === r.best)
          if (i > 0) list.unshift(...list.splice(i, 1))
        }
        setResults(list)
      })
      .catch((error: Error) => live && setProblem(error.message))
    return () => {
      live = false
    }
  }, [search])

  const n = nights(search.check_in, search.check_out)
  const guests = search.adults + search.children
  const subtitle = `${day(search.check_in)} to ${day(search.check_out)}, ${n} ${n === 1 ? 'night' : 'nights'}, ${guests} ${guests === 1 ? 'guest' : 'guests'}`

  return (
    <Screen bg={colors.paper}>
      <Header title={p.city ?? 'Hotels'} subtitle={subtitle} />
      {results === null && !problem ? (
        <View style={styles.center}>
          <Bob distance={8}>
            <Kovi pose="sleep" size={150} />
          </Bob>
          <Txt weight="semi" size={20} style={{ marginTop: 10 }}>
            Finding you a room
          </Txt>
        </View>
      ) : problem ? (
        <View style={styles.center}>
          <KoviStage pose="oops" size={140} motion="bob" />
          <Txt
            size={15}
            color={colors.muted}
            style={{ marginTop: 10, textAlign: 'center', lineHeight: 21 }}
          >
            {problem}
          </Txt>
        </View>
      ) : (
        <FlatList
          data={results ?? []}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, gap: 14 }}
          ListHeaderComponent={
            testMode ? (
              <View style={styles.test}>
                <Icon name="info" size={16} />
                <Txt size={13} style={{ flex: 1, lineHeight: 19 }}>
                  Test mode: these are Duffel’s sample hotels, not real ones in{' '}
                  {p.city ?? 'this city'}. Nothing real is booked.
                </Txt>
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            const a = item.accommodation
            const local =
              profile && profile.currency !== 'USD' && item.from_price
                ? formatLocal(Number(item.from_price.usd), profile.currency)
                : null
            const word = reviewWord(a.review_score)
            const isBest = item.id === best
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${a.name}${item.from_price ? `, from ${dollars(item.from_price.usd)}` : ''}`}
                onPress={() => {
                  void Haptics.selectionAsync()
                  router.push({ pathname: '/travel/stay', params: { id: item.id, ...p } })
                }}
                style={({ pressed }) => [
                  styles.card,
                  isBest && styles.cardBest,
                  pressed && { transform: [{ scale: 0.99 }] },
                ]}
              >
                <View style={styles.photo}>
                  {a.photos[0] ? (
                    <Image
                      source={{ uri: a.photos[0] }}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                      transition={200}
                    />
                  ) : (
                    <Kovi pose="sleep" size={90} />
                  )}
                  {isBest ? (
                    <View style={styles.best}>
                      <Icon name="sparkle" size={14} />
                      <Txt weight="bold" size={12}>
                        Best match
                      </Txt>
                    </View>
                  ) : null}
                </View>
                <View style={{ padding: 14, gap: 6 }}>
                  <Txt weight="bold" size={18} numberOfLines={1} style={{ letterSpacing: -0.3 }}>
                    {a.name}
                  </Txt>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {a.stars ? (
                      <Txt weight="semi" size={13} color={colors.coralDeep}>
                        {'★'.repeat(a.stars)}
                      </Txt>
                    ) : null}
                    {a.review_score != null ? (
                      <View style={styles.score}>
                        <Txt weight="bold" size={12} color={colors.white}>
                          {a.review_score.toFixed(1)}
                        </Txt>
                      </View>
                    ) : null}
                    {word ? (
                      <Txt size={13} color={colors.muted}>
                        {word}
                        {a.review_count ? `, ${a.review_count} reviews` : ''}
                      </Txt>
                    ) : null}
                  </View>
                  <Txt size={13} color={colors.muted} numberOfLines={1}>
                    {a.address}
                  </Txt>
                  <View style={styles.priceRow}>
                    <View style={{ flex: 1 }}>
                      {a.amenities.length ? (
                        <Txt size={12} color={colors.muted} numberOfLines={1}>
                          {a.amenities.slice(0, 3).join(', ')}
                        </Txt>
                      ) : null}
                    </View>
                    {item.from_price ? (
                      <View style={{ alignItems: 'flex-end' }}>
                        <Txt weight="bold" size={20}>
                          {dollars(item.from_price.usd)}
                        </Txt>
                        <Txt size={12} color={colors.muted}>
                          {n} {n === 1 ? 'night' : 'nights'}
                          {local ? `, about ${local}` : ''}
                        </Txt>
                      </View>
                    ) : null}
                  </View>
                </View>
              </Pressable>
            )
          }}
          ListEmptyComponent={
            <View style={[styles.center, { paddingTop: 40 }]}>
              <KoviStage pose="oops" size={120} motion="bob" />
              <Txt weight="semi" size={18} style={{ marginTop: 8 }}>
                Nothing free on those dates
              </Txt>
              <Txt size={15} color={colors.muted} style={{ marginTop: 4, textAlign: 'center' }}>
                Try other dates or a different area.
              </Txt>
            </View>
          }
        />
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  test: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    padding: 12,
    borderRadius: 18,
    backgroundColor: colors.coralSoft,
    marginTop: 6,
  },
  card: {
    borderRadius: 26,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  cardBest: { borderColor: colors.coral, borderWidth: 3 },
  photo: {
    height: 170,
    backgroundColor: colors.sunken,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderColor: colors.line,
  },
  best: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: colors.coral,
    borderWidth: 2,
    borderColor: colors.line,
  },
  score: {
    height: 22,
    paddingHorizontal: 7,
    borderRadius: 7,
    backgroundColor: colors.tealDeep,
    justifyContent: 'center',
  },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 4 },
})
