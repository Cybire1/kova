import * as Haptics from 'expo-haptics'
import { Image } from 'expo-image'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getStay, type StayDetail, type StayRate } from '@/lib/api'
import { formatLocal } from '@/lib/money'
import { colors } from '@/lib/theme'
import { day, nights, useTravel } from '@/lib/travel'
import { useWallet } from '@/lib/wallet'
import { Kovi } from '@/ui/art'
import { Icon } from '@/ui/Icon'
import { RoundButton, Txt } from '@/ui/primitives'
import { dollars } from '@/ui/StallParts'
import { reviewWord } from './stays'

/** One hotel: its photos, what it has, and every room and rate Kova can book. */
export default function Stay() {
  const p = useLocalSearchParams<Record<string, string>>()
  const { width } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const { profile } = useWallet()
  const { setDraft } = useTravel()
  const [stay, setStay] = useState<StayDetail | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [photo, setPhoto] = useState(0)

  useEffect(() => {
    if (!p.id) return
    getStay(p.id)
      .then(setStay)
      .catch((error: Error) => setProblem(error.message))
  }, [p.id])

  const choose = (rate: StayRate, room: string) => {
    if (!stay) return
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setDraft({
      stay: {
        search: {
          latitude: p.latitude ? Number(p.latitude) : null,
          longitude: p.longitude ? Number(p.longitude) : null,
          check_in: stay.check_in,
          check_out: stay.check_out,
          adults: Number(p.adults ?? 1),
          children: Number(p.children ?? 0),
          rooms: stay.rooms,
          wishes: p.wishes || null,
        },
        detail: stay,
        rate,
        room,
      },
    })
    router.push('/travel/book')
  }

  if (!stay)
    return (
      <View style={[styles.center, { backgroundColor: colors.paper, paddingTop: insets.top }]}>
        {problem ? (
          <>
            <Kovi pose="oops" size={120} />
            <Txt size={15} color={colors.muted} style={{ textAlign: 'center', marginTop: 8 }}>
              {problem}
            </Txt>
          </>
        ) : (
          <ActivityIndicator color={colors.ink} />
        )}
        <View style={[styles.floatingBack, { top: insets.top + 8 }]}>
          <RoundButton
            icon="back"
            label="Back"
            fill={colors.surface}
            onPress={() => router.back()}
          />
        </View>
      </View>
    )

  const a = stay.accommodation
  const n = nights(stay.check_in, stay.check_out)
  const word = reviewWord(a.review_score)
  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
        <View style={{ height: 300, backgroundColor: colors.sunken }}>
          {a.photos.length ? (
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) =>
                setPhoto(Math.round(e.nativeEvent.contentOffset.x / width))
              }
            >
              {a.photos.map((url) => (
                <Image
                  key={url}
                  source={{ uri: url }}
                  style={{ width, height: 300 }}
                  contentFit="cover"
                  transition={200}
                />
              ))}
            </ScrollView>
          ) : (
            <View style={styles.center}>
              <Kovi pose="sleep" size={120} />
            </View>
          )}
          {a.photos.length > 1 ? (
            <View style={styles.dots}>
              {a.photos.map((url, i) => (
                <View key={url} style={[styles.dot, i === photo && styles.dotOn]} />
              ))}
            </View>
          ) : null}
        </View>

        <View style={{ padding: 20, gap: 6 }}>
          <Txt weight="bold" size={28} style={{ letterSpacing: -0.8, lineHeight: 32 }}>
            {a.name}
          </Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {a.stars ? (
              <Txt weight="semi" size={14} color={colors.coralDeep}>
                {'★'.repeat(a.stars)}
              </Txt>
            ) : null}
            {a.review_score != null ? (
              <View style={styles.score}>
                <Txt weight="bold" size={13} color={colors.white}>
                  {a.review_score.toFixed(1)}
                </Txt>
              </View>
            ) : null}
            {word ? (
              <Txt size={14} color={colors.muted}>
                {word}
                {a.review_count ? `, ${a.review_count} reviews` : ''}
              </Txt>
            ) : null}
          </View>
          <Txt size={14} color={colors.muted}>
            {a.address}
          </Txt>
          <View style={styles.dates}>
            <Icon name="clock" size={16} />
            <Txt weight="semi" size={14}>
              {day(stay.check_in)} to {day(stay.check_out)}, {n} {n === 1 ? 'night' : 'nights'}
            </Txt>
          </View>
          {a.check_in_after || a.check_out_before ? (
            <Txt size={13} color={colors.muted}>
              {a.check_in_after ? `Check in from ${a.check_in_after.slice(0, 5)}` : ''}
              {a.check_in_after && a.check_out_before ? ', ' : ''}
              {a.check_out_before ? `check out by ${a.check_out_before.slice(0, 5)}` : ''}
            </Txt>
          ) : null}
          {a.amenities.length ? (
            <View style={styles.amenities}>
              {a.amenities.map((m) => (
                <View key={m} style={styles.amenity}>
                  <Txt weight="medium" size={13}>
                    {m}
                  </Txt>
                </View>
              ))}
            </View>
          ) : null}
          {a.description ? (
            <Txt
              size={15}
              color={colors.muted}
              style={{ marginTop: 8, lineHeight: 22 }}
              numberOfLines={6}
            >
              {a.description}
            </Txt>
          ) : null}
        </View>

        <View style={{ paddingHorizontal: 20 }}>
          <Txt weight="bold" size={22} style={{ letterSpacing: -0.5, marginBottom: 10 }}>
            Rooms
          </Txt>
          {stay.rooms_available.every((r) => r.rates.length === 0) ? (
            <Txt size={15} color={colors.muted}>
              No rooms Kova can book here for these dates.
            </Txt>
          ) : (
            stay.rooms_available
              .filter((room) => room.rates.length)
              .map((room) => (
                <View key={room.name} style={styles.room}>
                  <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                    {room.photos[0] ? (
                      <Image
                        source={{ uri: room.photos[0] }}
                        style={styles.roomPhoto}
                        contentFit="cover"
                      />
                    ) : null}
                    <View style={{ flex: 1 }}>
                      <Txt weight="bold" size={17}>
                        {room.name}
                      </Txt>
                      {room.beds ? (
                        <Txt size={13} color={colors.muted}>
                          {room.beds} bed{room.beds.startsWith('1 ') ? '' : 's'}
                        </Txt>
                      ) : null}
                    </View>
                  </View>
                  {room.rates.map((rate) => (
                    <View key={rate.id} style={styles.rate}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Txt weight="semi" size={15}>
                          {rate.board}
                        </Txt>
                        <Txt
                          size={13}
                          color={
                            rate.cancellation.startsWith('Free') ? colors.tealDeep : colors.muted
                          }
                          weight={rate.cancellation.startsWith('Free') ? 'semi' : 'regular'}
                        >
                          {rate.cancellation}
                        </Txt>
                        {rate.pay_at_hotel ? (
                          <Txt size={12} color={colors.muted}>
                            Plus {rate.pay_at_hotel} at the hotel
                          </Txt>
                        ) : null}
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 6 }}>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Txt weight="bold" size={18}>
                            {dollars(rate.price.usd)}
                          </Txt>
                          {profile && profile.currency !== 'USD' ? (
                            <Txt size={11} color={colors.muted}>
                              about {formatLocal(Number(rate.price.usd), profile.currency)}
                            </Txt>
                          ) : null}
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Choose ${room.name}, ${rate.board}`}
                          onPress={() => choose(rate, room.name)}
                          style={styles.choose}
                        >
                          <Txt weight="semi" size={14} color={colors.white}>
                            Choose
                          </Txt>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
              ))
          )}
        </View>
      </ScrollView>
      <View style={[styles.floatingBack, { top: insets.top + 8 }]}>
        <RoundButton icon="back" label="Back" fill={colors.surface} onPress={() => router.back()} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  floatingBack: { position: 'absolute', left: 20 },
  dots: { position: 'absolute', bottom: 12, alignSelf: 'center', flexDirection: 'row', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.6)' },
  dotOn: { backgroundColor: colors.white, width: 18 },
  score: {
    height: 24,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: colors.tealDeep,
    justifyContent: 'center',
  },
  dates: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    alignSelf: 'flex-start',
    padding: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: colors.tealSoft,
  },
  amenities: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  amenity: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.sunken,
    justifyContent: 'center',
  },
  room: {
    marginBottom: 14,
    padding: 14,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    gap: 4,
  },
  roomPhoto: { width: 56, height: 56, borderRadius: 14, backgroundColor: colors.sunken },
  rate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 12,
    marginTop: 8,
    borderTopWidth: 1,
    borderColor: colors.sunken,
  },
  choose: {
    height: 38,
    paddingHorizontal: 18,
    borderRadius: 19,
    backgroundColor: colors.ink,
    justifyContent: 'center',
  },
})
