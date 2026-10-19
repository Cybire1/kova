import * as Haptics from 'expo-haptics'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { type Place, travelStatus, understandTrip } from '@/lib/api'
import { colors, fonts } from '@/lib/theme'
import { addDays, day, today, useTravel } from '@/lib/travel'
import { CitiesScene, Flyer, sendScene } from '@/ui/art'
import { Icon, type IconName } from '@/ui/Icon'
import { Flight } from '@/ui/motion'
import { PillButton, RoundButton, Txt } from '@/ui/primitives'
import { DateSheet } from '@/ui/travel/DateSheet'
import { type People, PeopleSheet, peopleText } from '@/ui/travel/PeopleSheet'
import { PlaceSheet } from '@/ui/travel/PlaceSheet'

type Kind = 'flight' | 'stay'
type Picking = 'from' | 'to' | 'city' | 'dates' | 'people' | null

/**
 * Kova Travel: where to, when, and who. Type the trip the way you'd say it and Kova fills the
 * form in, or fill it yourself. Nothing is searched until you've seen what Kova understood.
 */
export default function Travel() {
  const { width } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const { trips } = useTravel()
  const [status, setStatus] = useState<{
    ready: boolean
    test_mode: boolean
    understands: boolean
  } | null>(null)
  const [kind, setKind] = useState<Kind>('flight')
  const [from, setFrom] = useState<Place | null>(null)
  const [to, setTo] = useState<Place | null>(null)
  const [city, setCity] = useState<Place | null>(null)
  const [start, setStart] = useState<string | null>(addDays(today(), 14))
  const [end, setEnd] = useState<string | null>(addDays(today(), 17))
  const [oneWay, setOneWay] = useState(false)
  const [people, setPeople] = useState<People>({
    adults: 1,
    children: 0,
    infants: 0,
    cabin: 'economy',
    rooms: 1,
  })
  const [wishes, setWishes] = useState('')
  const [sentence, setSentence] = useState('')
  const [reading, setReading] = useState(false)
  const [understood, setUnderstood] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [picking, setPicking] = useState<Picking>(null)

  useEffect(() => {
    travelStatus()
      .then(setStatus)
      .catch(() => setStatus({ ready: false, test_mode: true, understands: false }))
  }, [])

  const read = async () => {
    const text = sentence.trim()
    if (text.length < 3) return
    Keyboard.dismiss()
    setReading(true)
    setProblem(null)
    try {
      const t = await understandTrip(text)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setKind(t.kind)
      if (t.kind === 'flight') {
        if (t.from_place) setFrom(t.from_place)
        if (t.to_place) setTo(t.to_place)
        if (t.depart) setStart(t.depart)
        setOneWay(!t.return)
        setEnd(t.return)
      } else {
        if (t.city_place) setCity(t.city_place)
        if (t.check_in) setStart(t.check_in)
        if (t.check_out) setEnd(t.check_out)
        else if (t.check_in) setEnd(addDays(t.check_in, 1))
      }
      setPeople({
        adults: t.adults,
        children: t.children,
        infants: t.infants,
        cabin: t.cabin,
        rooms: t.rooms,
      })
      setWishes(t.wishes ?? '')
      const missing =
        t.kind === 'flight'
          ? [!t.from_place && 'where from', !t.to_place && 'where to', !t.depart && 'when'].filter(
              Boolean,
            )
          : [!t.city_place && 'where', !t.check_in && 'when'].filter(Boolean)
      setUnderstood(
        missing.length
          ? `Got most of it. Add ${missing.join(' and ')} below.`
          : 'Here’s what Kova understood. Check it, then search.',
      )
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : 'Couldn’t read that. Try saying where and when.',
      )
    } finally {
      setReading(false)
    }
  }

  const canSearch =
    kind === 'flight'
      ? Boolean(from && to && start && (oneWay || end))
      : Boolean(city && start && end)
  const search = () => {
    if (!canSearch) return
    if (kind === 'flight' && from && to && start)
      router.push({
        pathname: '/travel/flights',
        params: {
          from: from.iata,
          to: to.iata,
          fromCity: from.city,
          toCity: to.city,
          depart: start,
          return: oneWay ? '' : (end ?? ''),
          adults: String(people.adults),
          children: String(people.children),
          infants: String(people.infants),
          cabin: people.cabin,
          wishes: wishes.trim(),
        },
      })
    else if (city && start && end)
      router.push({
        pathname: '/travel/stays',
        params: {
          city: city.city,
          latitude: String(city.latitude ?? ''),
          longitude: String(city.longitude ?? ''),
          checkIn: start,
          checkOut: end,
          adults: String(people.adults),
          children: String(people.children),
          rooms: String(people.rooms),
          wishes: wishes.trim(),
        },
      })
  }

  const scene = width - 40
  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <RoundButton
            icon="close"
            label="Close"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          />
          {status?.test_mode ? (
            <View style={styles.test}>
              <View style={styles.testDot} />
              <Txt weight="semi" size={12}>
                Test mode
              </Txt>
            </View>
          ) : null}
        </View>

        {/* Two cities and Kovi flying between them */}
        <View style={{ height: scene * sendScene.aspect, marginTop: 4 }}>
          <View style={{ position: 'absolute', left: 20, top: 0 }}>
            <CitiesScene width={scene} />
          </View>
          <Flight {...sendScene.route(scene, 20, 0)} size={96} duration={5200}>
            <Flyer size={96} />
          </Flight>
        </View>

        <View style={{ paddingHorizontal: 20 }}>
          <Txt weight="bold" size={36} style={{ letterSpacing: -1.2, marginTop: 6 }}>
            Where to?
          </Txt>
          <Txt size={16} color={colors.muted} style={{ marginTop: 2, lineHeight: 22 }}>
            Flights and hotels, paid in dollars from your wallet.
          </Txt>

          {status?.understands ? (
            <View style={styles.sentence}>
              <TextInput
                value={sentence}
                onChangeText={setSentence}
                placeholder="Lisbon to London next Friday, back Sunday"
                placeholderTextColor="#8C9799"
                multiline
                returnKeyType="go"
                blurOnSubmit
                onSubmitEditing={read}
                style={styles.sentenceInput}
                accessibilityLabel="Describe your trip"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Fill in the search"
                disabled={reading || sentence.trim().length < 3}
                onPress={read}
                style={[styles.go, sentence.trim().length < 3 && { opacity: 0.35 }]}
              >
                {reading ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Icon name="arrow" color={colors.white} strokeWidth={2.4} />
                )}
              </Pressable>
            </View>
          ) : null}
          {understood ? (
            <View style={styles.understood}>
              <Icon name="sparkle" size={16} />
              <Txt weight="medium" size={14} style={{ flex: 1, lineHeight: 20 }}>
                {understood}
              </Txt>
            </View>
          ) : null}

          <View style={styles.kinds} accessibilityRole="tablist">
            {(
              [
                { id: 'flight', label: 'Flights', icon: 'send' },
                { id: 'stay', label: 'Hotels', icon: 'home' },
              ] as { id: Kind; label: string; icon: IconName }[]
            ).map((k) => {
              const on = k.id === kind
              return (
                <Pressable
                  key={k.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    void Haptics.selectionAsync()
                    setKind(k.id)
                    setUnderstood(null)
                    if (k.id === 'stay' && !end) setEnd(start ? addDays(start, 2) : null)
                  }}
                  style={[styles.kind, on && styles.kindOn]}
                >
                  <Icon name={k.icon} size={18} color={on ? colors.white : colors.ink} />
                  <Txt weight="semi" size={15} color={on ? colors.white : colors.ink}>
                    {k.label}
                  </Txt>
                </Pressable>
              )
            })}
          </View>

          <View style={styles.form}>
            {kind === 'flight' ? (
              <>
                <Field
                  icon="send"
                  label="From"
                  value={from ? `${from.city} (${from.iata})` : null}
                  placeholder="Where are you flying from?"
                  onPress={() => setPicking('from')}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Swap from and to"
                  onPress={() => {
                    void Haptics.selectionAsync()
                    setFrom(to)
                    setTo(from)
                  }}
                  style={styles.swap}
                >
                  <Icon name="swap" size={18} />
                </Pressable>
                <Field
                  icon="down"
                  label="To"
                  value={to ? `${to.city} (${to.iata})` : null}
                  placeholder="Where to?"
                  onPress={() => setPicking('to')}
                />
                <Field
                  icon="clock"
                  label={oneWay ? 'Depart' : 'Depart and return'}
                  value={
                    start ? (oneWay || !end ? day(start) : `${day(start)} to ${day(end)}`) : null
                  }
                  placeholder="When?"
                  onPress={() => setPicking('dates')}
                />
                <Field
                  icon="user"
                  label="Who"
                  value={peopleText(people, 'flight')}
                  onPress={() => setPicking('people')}
                  last
                />
              </>
            ) : (
              <>
                <Field
                  icon="home"
                  label="Where"
                  value={city ? city.city : null}
                  placeholder="City or area"
                  onPress={() => setPicking('city')}
                />
                <Field
                  icon="clock"
                  label="Check in and out"
                  value={start && end ? `${day(start)} to ${day(end)}` : null}
                  placeholder="When?"
                  onPress={() => setPicking('dates')}
                />
                <Field
                  icon="user"
                  label="Who"
                  value={peopleText(people, 'stay')}
                  onPress={() => setPicking('people')}
                  last
                />
              </>
            )}
          </View>

          <View style={styles.wishes}>
            <Icon name="sparkle" size={18} color={colors.muted} />
            <TextInput
              value={wishes}
              onChangeText={setWishes}
              placeholder={
                kind === 'flight'
                  ? 'Anything that matters? Non-stop, arrive by 6pm…'
                  : 'Anything that matters? Breakfast, a pool…'
              }
              placeholderTextColor="#8C9799"
              maxLength={200}
              style={styles.wishesInput}
              accessibilityLabel="What matters to you"
            />
          </View>
          {wishes.trim() ? (
            <Txt size={13} color={colors.muted} style={{ marginTop: 6, marginLeft: 6 }}>
              Kova marks the {kind === 'flight' ? 'flight' : 'hotel'} that fits this best.
            </Txt>
          ) : null}

          {problem ? (
            <Txt weight="medium" size={14} color={colors.danger} style={{ marginTop: 12 }}>
              {problem}
            </Txt>
          ) : null}
          {status && !status.ready ? (
            <View style={styles.notReady}>
              <Txt weight="semi" size={15}>
                Booking isn’t switched on yet
              </Txt>
              <Txt size={14} color={colors.muted} style={{ marginTop: 2, lineHeight: 20 }}>
                This Kova server doesn’t have its travel supplier connected yet. Searches will work
                once it does.
              </Txt>
            </View>
          ) : null}

          <View style={{ marginTop: 18 }}>
            <PillButton
              label={kind === 'flight' ? 'Search flights' : 'Search hotels'}
              icon="arrow"
              disabled={!canSearch}
              onPress={search}
            />
          </View>

          {trips.length ? (
            <>
              <Txt
                weight="bold"
                size={22}
                style={{ letterSpacing: -0.5, marginTop: 30, marginBottom: 10 }}
              >
                Your trips
              </Txt>
              {trips.map((t) => (
                <Pressable
                  key={t.id}
                  accessibilityRole="button"
                  onPress={() =>
                    router.push({ pathname: '/travel/trip/[id]', params: { id: t.id } })
                  }
                  style={({ pressed }) => [styles.trip, pressed && { opacity: 0.8 }]}
                >
                  <View style={styles.tripArt}>
                    {t.image ? (
                      <Image
                        source={{ uri: t.image }}
                        style={{ width: '100%', height: '100%' }}
                        contentFit={t.kind === 'flight' ? 'contain' : 'cover'}
                      />
                    ) : (
                      <Icon name={t.kind === 'flight' ? 'send' : 'home'} />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt weight="semi" size={16} numberOfLines={1}>
                      {t.title}
                    </Txt>
                    <Txt size={13} color={colors.muted} numberOfLines={1}>
                      {t.subtitle}
                    </Txt>
                  </View>
                  <Icon name="arrow" size={20} />
                </Pressable>
              ))}
            </>
          ) : null}
        </View>
      </ScrollView>

      <PlaceSheet
        visible={picking === 'from' || picking === 'to' || picking === 'city'}
        title={picking === 'from' ? 'Flying from' : picking === 'to' ? 'Flying to' : 'Staying in'}
        onClose={() => setPicking(null)}
        onPick={(p) => {
          if (picking === 'from') setFrom(p)
          else if (picking === 'to') setTo(p)
          else setCity(p)
          setPicking(null)
        }}
      />
      <DateSheet
        visible={picking === 'dates'}
        onClose={() => setPicking(null)}
        start={start}
        end={end}
        labels={
          kind === 'flight'
            ? { start: 'Depart', end: 'Return' }
            : { start: 'Check in', end: 'Check out' }
        }
        oneWay={kind === 'flight' ? oneWay : undefined}
        onOneWay={kind === 'flight' ? setOneWay : undefined}
        onDone={(a, b) => {
          setStart(a)
          setEnd(b)
          setPicking(null)
        }}
      />
      <PeopleSheet
        visible={picking === 'people'}
        kind={kind}
        value={people}
        onClose={() => setPicking(null)}
        onDone={(p) => {
          setPeople(p)
          setPicking(null)
        }}
      />
    </View>
  )
}

function Field({
  icon,
  label,
  value,
  placeholder,
  onPress,
  last,
}: {
  icon: IconName
  label: string
  value: string | null
  placeholder?: string
  onPress: () => void
  last?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value ?? placeholder}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.field,
        !last && styles.fieldRule,
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={styles.fieldIcon}>
        <Icon name={icon} size={18} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt size={12} color={colors.muted}>
          {label}
        </Txt>
        <Txt weight="semi" size={17} color={value ? colors.ink : '#8C9799'} numberOfLines={1}>
          {value ?? placeholder}
        </Txt>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  test: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    backgroundColor: colors.coralSoft,
  },
  testDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.coral },
  sentence: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    padding: 8,
    paddingLeft: 18,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  sentenceInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 110,
    paddingTop: 11,
    paddingBottom: 11,
    fontFamily: fonts.semi,
    fontSize: 17,
    color: colors.ink,
  },
  go: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.coral,
    borderWidth: 2,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  understood: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    marginTop: 10,
    padding: 12,
    borderRadius: 18,
    backgroundColor: colors.tealSoft,
  },
  kinds: { flexDirection: 'row', gap: 8, marginTop: 18 },
  kind: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  kindOn: { backgroundColor: colors.ink },
  form: {
    marginTop: 12,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
  },
  field: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  fieldRule: { borderBottomWidth: 1, borderColor: colors.sunken },
  fieldIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.tealSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swap: {
    position: 'absolute',
    right: 14,
    top: 46,
    zIndex: 2,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wishes: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 46,
    paddingHorizontal: 16,
    borderRadius: 23,
    backgroundColor: colors.sunken,
  },
  wishesInput: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: colors.ink },
  notReady: { marginTop: 14, padding: 14, borderRadius: 20, backgroundColor: colors.coralSoft },
  trip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    paddingRight: 14,
    marginBottom: 10,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  tripArt: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: colors.paper,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
