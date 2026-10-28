import * as Haptics from 'expo-haptics'
import { Redirect, router } from 'expo-router'
import { useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { createFlightTrip, createStayTrip, type TravellerInput } from '@/lib/api'
import { formatLocal } from '@/lib/money'
import { colors, fonts } from '@/lib/theme'
import { day, flightTotal, nights, useTravel } from '@/lib/travel'
import { useWallet } from '@/lib/wallet'
import { Icon, type IconName } from '@/ui/Icon'
import { Header, PillButton, Screen, Txt } from '@/ui/primitives'
import { dollars } from '@/ui/StallParts'

type Payer = 'me' | 'someone' | 'split'
type Title = NonNullable<TravellerInput['title']>

const titles: { id: Title; label: string }[] = [
  { id: 'mr', label: 'Mr' },
  { id: 'ms', label: 'Ms' },
  { id: 'mrs', label: 'Mrs' },
  { id: 'miss', label: 'Miss' },
  { id: 'dr', label: 'Dr' },
]

/** "03/10/1990" as typed → "1990-10-03", or null while it isn't a real date. */
function birthDate(typed: string) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(typed)
  if (!m) return null
  const iso = `${m[3]}-${m[2]}-${m[1]}`
  const t = Date.parse(`${iso}T00:00:00Z`)
  return Number.isNaN(t) || t > Date.now() || new Date(t).toISOString().slice(0, 10) !== iso
    ? null
    : iso
}

/** Types a date of birth with the slashes put in for you. */
const withSlashes = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 8)
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('/')
}

interface Person {
  title: Title
  given: string
  family: string
  born: string
  gender: 'm' | 'f' | null
}

/**
 * Who's travelling and who's paying. The fare becomes one payment, a link for someone else
 * (family abroad pays it from wherever they are), or a share per friend.
 */
export default function Book() {
  const insets = useSafeAreaInsets()
  const { profile } = useWallet()
  const { draft, remember } = useTravel()
  const flight = draft.flight
  const stay = draft.stay
  const count = flight ? flight.offer.passengers.length : stay ? stay.search.adults : 1
  const [first, ...last] = (profile?.name ?? '').split(' ')
  const [people, setPeople] = useState<Person[]>(() =>
    Array.from({ length: count }, (_, i) => ({
      title: 'mr',
      given: i === 0 ? (first ?? '') : '',
      family: i === 0 ? last.join(' ') : '',
      born: '',
      gender: null,
    })),
  )
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('+234')
  const [payer, setPayer] = useState<Payer>('me')
  const [someone, setSomeone] = useState('')
  const [friends, setFriends] = useState<string[]>([''])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  if (!flight && !stay) return <Redirect href="/travel" />

  const total = flight ? flightTotal(flight) : Number(stay?.rate.price.usd ?? 0)
  const set = (i: number, patch: Partial<Person>) =>
    setPeople((list) => list.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  const payers =
    payer === 'me'
      ? ['You']
      : payer === 'someone'
        ? [someone.trim()]
        : ['You', ...friends.map((f) => f.trim())]
  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim())
  const phoneOk = /^\+[1-9]\d{6,14}$/.test(phone.replace(/\s/g, ''))
  const peopleOk = people.every(
    (p) => p.given.trim() && p.family.trim() && (!flight || (birthDate(p.born) && p.gender)),
  )
  const payersOk = payers.every((p) => p.length > 0) && new Set(payers).size === payers.length
  const ready = peopleOk && emailOk && phoneOk && payersOk

  const submit = async () => {
    if (!ready) return
    setBusy(true)
    setProblem(null)
    try {
      const bookedBy = profile?.name ?? 'A Kova user'
      const trip = flight
        ? await createFlightTrip({
            offer_id: flight.offer.id,
            travellers: people.map((p, i) => ({
              title: p.title,
              given_name: p.given.trim(),
              family_name: p.family.trim(),
              born_on: birthDate(p.born) ?? undefined,
              gender: p.gender ?? undefined,
              email: email.trim(),
              phone_number: phone.replace(/\s/g, ''),
              passenger_id: flight.offer.passengers[i]?.id,
            })),
            services: [
              ...Object.entries(flight.bags)
                .filter(([, q]) => q > 0)
                .map(([id, quantity]) => ({ id, quantity })),
              ...Object.values(flight.seats).map((s) => ({ id: s.serviceId, quantity: 1 })),
            ],
            extras: [
              ...Object.entries(flight.bags)
                .filter(([, q]) => q > 0)
                .map(([id, q]) => {
                  const bag = flight.offer.extra_bags?.find((b) => b.id === id)
                  return `${q} extra ${bag?.kind === 'carry_on' ? 'cabin' : 'checked'} bag${q > 1 ? 's' : ''}`
                }),
              ...Object.values(flight.seats).map((s) => `Seat ${s.designator}`),
            ],
            payers,
            booked_by: bookedBy,
          })
        : await createStayTrip({
            rate_id: stay?.rate.id ?? '',
            guests: people.map((p) => ({
              given_name: p.given.trim(),
              family_name: p.family.trim(),
            })),
            email: email.trim(),
            phone_number: phone.replace(/\s/g, ''),
            payers,
            booked_by: bookedBy,
          })
      await remember(trip)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      // Paying it yourself goes straight to Face ID; anything else lands on the trip, with its links.
      const own = trip.shares.find((s) => s.label === 'You')
      router.dismissAll()
      router.replace({ pathname: '/travel/trip/[id]', params: { id: trip.id } })
      if (payer === 'me' && own?.link)
        router.push({ pathname: '/pay/[id]', params: { id: own.checkout ?? '' } })
    } catch (error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setProblem(error instanceof Error ? error.message : 'That didn’t work. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const title = flight
    ? `${flight.offer.slices[0]?.from.city} to ${flight.offer.slices[0]?.to.city}`
    : (stay?.detail.accommodation.name ?? '')
  const subtitle = flight
    ? `${flight.offer.owner.name}, ${day(flight.offer.slices[0]?.departs)}`
    : stay
      ? `${stay.room}, ${nights(stay.detail.check_in, stay.detail.check_out)} nights`
      : ''
  const share = payer === 'split' ? Math.floor((total * 100) / payers.length) / 100 : total

  return (
    <Screen bg={colors.paper}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Header title={title} subtitle={subtitle} />
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <Txt weight="bold" size={24} style={styles.h}>
            {flight ? 'Who’s flying' : 'Who’s staying'}
          </Txt>
          <Txt size={14} color={colors.muted} style={{ marginBottom: 10, lineHeight: 20 }}>
            {flight
              ? 'Names exactly as on each passport.'
              : 'The names the hotel will have on the booking.'}
          </Txt>
          {people.map((p, i) => (
            <View key={i} style={styles.card}>
              <Txt weight="semi" size={14} color={colors.muted}>
                {flight
                  ? `Traveller ${i + 1}${flight.offer.passengers[i]?.type && flight.offer.passengers[i]?.type !== 'adult' ? `, ${flight.offer.passengers[i]?.type.replace(/_/g, ' ')}` : ''}`
                  : `Guest ${i + 1}`}
              </Txt>
              {flight ? (
                <View style={styles.chips}>
                  {titles.map((t) => (
                    <Pressable
                      key={t.id}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: p.title === t.id }}
                      onPress={() => set(i, { title: t.id })}
                      style={[styles.chip, p.title === t.id && styles.chipOn]}
                    >
                      <Txt
                        weight="semi"
                        size={13}
                        color={p.title === t.id ? colors.onChosen : colors.ink}
                      >
                        {t.label}
                      </Txt>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <View style={styles.twoCol}>
                <Input
                  value={p.given}
                  onChange={(v) => set(i, { given: v })}
                  placeholder="First name"
                  style={{ flex: 1 }}
                  words
                />
                <Input
                  value={p.family}
                  onChange={(v) => set(i, { family: v })}
                  placeholder="Last name"
                  style={{ flex: 1 }}
                  words
                />
              </View>
              {flight ? (
                <View style={styles.twoCol}>
                  <Input
                    value={p.born}
                    onChange={(v) => set(i, { born: withSlashes(v) })}
                    placeholder="Born DD/MM/YYYY"
                    style={{ flex: 1.3 }}
                    numeric
                  />
                  <View
                    style={[styles.chips, { flex: 1, marginTop: 0 }]}
                    accessibilityLabel="As on the passport"
                  >
                    {(
                      [
                        { id: 'f', label: 'F' },
                        { id: 'm', label: 'M' },
                      ] as { id: 'm' | 'f'; label: string }[]
                    ).map((g) => (
                      <Pressable
                        key={g.id}
                        accessibilityRole="radio"
                        accessibilityLabel={
                          g.id === 'f' ? 'Female, as on the passport' : 'Male, as on the passport'
                        }
                        accessibilityState={{ selected: p.gender === g.id }}
                        onPress={() => set(i, { gender: g.id })}
                        style={[styles.chip, styles.gender, p.gender === g.id && styles.chipOn]}
                      >
                        <Txt
                          weight="semi"
                          size={14}
                          color={p.gender === g.id ? colors.onChosen : colors.ink}
                        >
                          {g.label}
                        </Txt>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}
              {p.born.length === 10 && !birthDate(p.born) ? (
                <Txt size={12} color={colors.danger}>
                  That date doesn’t exist.
                </Txt>
              ) : null}
            </View>
          ))}

          <Txt weight="semi" size={14} color={colors.muted} style={styles.label}>
            Where the {flight ? 'airline' : 'hotel'} can reach you
          </Txt>
          <View style={styles.twoCol}>
            <Input
              value={email}
              onChange={setEmail}
              placeholder="Email"
              style={{ flex: 1.4 }}
              email
            />
            <Input
              value={phone}
              onChange={setPhone}
              placeholder="+2348030000000"
              style={{ flex: 1 }}
              phone
            />
          </View>

          <Txt weight="bold" size={24} style={[styles.h, { marginTop: 26 }]}>
            Who’s paying
          </Txt>
          <View style={{ gap: 10 }}>
            <Choice
              icon="face"
              title="I’ll pay"
              text={`${dollars(total)} from your wallet, with Face ID`}
              on={payer === 'me'}
              onPress={() => setPayer('me')}
            />
            <Choice
              icon="send"
              title="Ask someone to pay"
              text={
                flight &&
                flight.offer.holdable &&
                !Object.keys(flight.seats).length &&
                !Object.values(flight.bags).some(Boolean)
                  ? 'Family abroad pays by link. The airline holds the fare meanwhile.'
                  : 'Send the fare as a link to whoever’s paying. It has to be paid before the price runs out.'
              }
              on={payer === 'someone'}
              onPress={() => setPayer('someone')}
            />
            {stay ? (
              <Choice
                icon="user"
                title="Split it"
                text="Each friend pays their share. The room is booked once everyone has."
                on={payer === 'split'}
                onPress={() => setPayer('split')}
              />
            ) : null}
          </View>
          {payer === 'someone' ? (
            <View style={{ marginTop: 10 }}>
              <Input
                value={someone}
                onChange={setSomeone}
                placeholder="Who? Like Mum or Uncle Tunde"
                words
              />
            </View>
          ) : null}
          {payer === 'split' ? (
            <View style={[styles.card, { marginTop: 10 }]}>
              <Txt weight="semi" size={14} color={colors.muted}>
                Splitting {dollars(total)} {payers.length} ways: {dollars(share)} each
              </Txt>
              <View style={styles.friend}>
                <Icon name="user" size={18} />
                <Txt weight="semi" size={15} style={{ flex: 1 }}>
                  You
                </Txt>
              </View>
              {friends.map((f, i) => (
                <View key={i} style={styles.friendRow}>
                  <Input
                    value={f}
                    onChange={(v) => setFriends((list) => list.map((x, j) => (j === i ? v : x)))}
                    placeholder={`Friend ${i + 1}’s name`}
                    style={{ flex: 1 }}
                    words
                  />
                  {friends.length > 1 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Remove"
                      hitSlop={8}
                      onPress={() => setFriends((list) => list.filter((_, j) => j !== i))}
                    >
                      <Icon name="close" size={20} />
                    </Pressable>
                  ) : null}
                </View>
              ))}
              {friends.length < 7 ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setFriends((list) => [...list, ''])}
                  style={styles.addFriend}
                >
                  <Icon name="plus" size={16} />
                  <Txt weight="semi" size={14}>
                    Add a friend
                  </Txt>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {problem ? (
            <Txt weight="medium" size={14} color={colors.danger} style={{ marginTop: 14 }}>
              {problem}
            </Txt>
          ) : null}
        </ScrollView>
        <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={{ flex: 1 }}>
            <Txt size={13} color={colors.muted}>
              {payer === 'split' ? 'Your share' : 'Total'}
            </Txt>
            <Txt weight="bold" size={24} style={{ letterSpacing: -0.6 }}>
              {dollars(payer === 'split' ? share : total)}
            </Txt>
            {profile && profile.currency !== 'USD' ? (
              <Txt size={12} color={colors.muted}>
                about {formatLocal(payer === 'split' ? share : total, profile.currency)}
              </Txt>
            ) : null}
          </View>
          <View style={{ width: 200 }}>
            <PillButton
              label={
                payer === 'me' ? 'Book and pay' : payer === 'someone' ? 'Make the link' : 'Split it'
              }
              icon={payer === 'me' ? 'face' : 'send'}
              disabled={!ready}
              loading={busy}
              onPress={submit}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  )
}

function Input({
  value,
  onChange,
  placeholder,
  style,
  words,
  numeric,
  email,
  phone,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  style?: object
  words?: boolean
  numeric?: boolean
  email?: boolean
  phone?: boolean
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor="#8C9799"
      autoCapitalize={words ? 'words' : 'none'}
      autoCorrect={false}
      keyboardType={
        numeric ? 'number-pad' : email ? 'email-address' : phone ? 'phone-pad' : 'default'
      }
      textContentType={email ? 'emailAddress' : phone ? 'telephoneNumber' : undefined}
      accessibilityLabel={placeholder}
      style={[styles.input, style]}
    />
  )
}

function Choice({
  icon,
  title,
  text,
  on,
  onPress,
}: {
  icon: IconName
  title: string
  text: string
  on: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      onPress={() => {
        void Haptics.selectionAsync()
        onPress()
      }}
      style={[styles.choice, on && styles.choiceOn]}
    >
      <View style={[styles.choiceIcon, on && { backgroundColor: colors.coral }]}>
        <Icon name={icon} size={18} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt weight="semi" size={16}>
          {title}
        </Txt>
        <Txt size={13} color={colors.muted} style={{ lineHeight: 18 }}>
          {text}
        </Txt>
      </View>
      <View style={[styles.radio, on && styles.radioOn]}>
        {on ? <View style={styles.radioDot} /> : null}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  h: { letterSpacing: -0.6, marginTop: 8 },
  label: { marginTop: 20, marginBottom: 8, marginLeft: 4 },
  card: {
    marginBottom: 12,
    padding: 14,
    gap: 10,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.line,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.chosen },
  gender: { flex: 1, alignItems: 'center', height: 44 },
  twoCol: { flexDirection: 'row', gap: 8 },
  input: {
    height: 44,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    paddingHorizontal: 14,
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.ink,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  choiceOn: { backgroundColor: colors.raised, borderWidth: 3 },
  choiceIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.tealSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: colors.line },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.fill },
  friend: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 44 },
  friendRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  addFriend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 19,
    backgroundColor: colors.sunken,
  },
  bar: {
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
