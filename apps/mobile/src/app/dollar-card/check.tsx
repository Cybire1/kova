import { Image } from 'expo-image'
import { router } from 'expo-router'
import { useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native'
import { type CardCheck, startCardCheck } from '@/lib/partners'
import { takePhoto } from '@/lib/photos'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Icon, type IconName } from '@/ui/Icon'
import { problemOf } from '@/ui/Money'
import { Header, PillButton, Screen, TextLink, Txt } from '@/ui/primitives'

const COUNTRIES = [
  ['NG', 'Nigeria'],
  ['GH', 'Ghana'],
  ['KE', 'Kenya'],
  ['ZA', 'South Africa'],
  ['GB', 'United Kingdom'],
  ['US', 'United States'],
] as const

const IDS: Array<[CardCheck['document']['type'], string]> = [
  ['international_passport', 'Passport'],
  ['national_id', 'National ID'],
  ['drivers_license', 'Licence'],
]

/**
 * The dollar card's ID check, in two steps: your details exactly as on your ID, then a photo of
 * it. Both go to Nuvion, who issue the card; Kova keeps only whether you passed.
 */
export default function CardCheckScreen() {
  const { profile, signMessage } = useWallet()
  const [step, setStep] = useState<'details' | 'photo'>('details')
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [dob, setDob] = useState('')
  const [country, setCountry] = useState<string>('NG')
  const [gender, setGender] = useState<'f' | 'm' | null>(null)
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('+234')
  const [line1, setLine1] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [postal, setPostal] = useState('')
  const [idType, setIdType] = useState<CardCheck['document']['type']>('international_passport')
  const [idNumber, setIdNumber] = useState('')
  const [photo, setPhoto] = useState<{ uri: string; base64: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const birth = isoDate(dob)
  const ready =
    first.trim() &&
    last.trim() &&
    birth &&
    gender &&
    /^\S+@\S+\.\S+$/.test(email.trim()) &&
    /^\+\d{8,15}$/.test(phone.replace(/\s/g, '')) &&
    line1.trim().length >= 3 &&
    city.trim().length >= 2 &&
    state.trim().length >= 2 &&
    postal.trim().length >= 2 &&
    idNumber.trim().length >= 4
  const idName = IDS.find(([t]) => t === idType)?.[1] ?? 'ID'

  const pick = async (from: 'camera' | 'library') => {
    setError(null)
    try {
      const shot = await takePhoto(from, 'id')
      if (shot?.base64) setPhoto({ uri: shot.uri, base64: shot.base64 })
    } catch (e) {
      setError(problemOf(e))
    }
  }

  const send = async () => {
    if (!profile || !photo || !birth || !gender) return
    setBusy(true)
    setError(null)
    try {
      await startCardCheck(profile.address, signMessage, {
        first_name: first.trim(),
        last_name: last.trim(),
        date_of_birth: birth,
        email: email.trim(),
        phone: phone.replace(/\s/g, ''),
        nationality: country,
        gender,
        address: {
          line1: line1.trim(),
          city: city.trim(),
          state: state.trim(),
          postal_code: postal.trim(),
          country,
        },
        document: { type: idType, number: idNumber.trim(), file: photo.base64, mime: 'image/jpeg' },
      })
      router.replace('/dollar-card')
    } catch (e) {
      setError(problemOf(e))
    } finally {
      setBusy(false)
    }
  }

  if (step === 'photo')
    return (
      <Screen bg={colors.dark}>
        <Header onBack={() => setStep('details')} />
        <View style={styles.photoBody}>
          <Progress step={2} dark label={`Step 2 of 2 · Photo of your ${idName.toLowerCase()}`} />
          <Txt weight="bold" size={24} color={colors.white} style={styles.photoTitle}>
            {`Fit your ${idName.toLowerCase()}\nin the frame`}
          </Txt>
          <View style={styles.frame}>
            {photo ? (
              <Image source={{ uri: photo.uri }} style={styles.preview} contentFit="cover" />
            ) : (
              <View style={styles.placeholder}>
                <Icon name="camera" size={34} color={colors.onInk} />
              </View>
            )}
            <Corner style={{ left: 10, top: 10, borderLeftWidth: 4, borderTopWidth: 4 }} />
            <Corner style={{ right: 10, top: 10, borderRightWidth: 4, borderTopWidth: 4 }} />
            <Corner style={{ left: 10, bottom: 10, borderLeftWidth: 4, borderBottomWidth: 4 }} />
            <Corner style={{ right: 10, bottom: 10, borderRightWidth: 4, borderBottomWidth: 4 }} />
          </View>
          <View style={styles.tips}>
            <Tip icon="sparkle" label="No glare" />
            <Tip icon="grid" label="All four corners" />
            <Tip icon="list" label="Words easy to read" />
          </View>
          {error ? (
            <Txt weight="medium" size={14} color={colors.blush} style={{ marginTop: 14 }}>
              {error}
            </Txt>
          ) : null}
          <View style={{ marginTop: 'auto', gap: 14 }}>
            {photo ? (
              <>
                <PillButton
                  label={busy ? 'Sending to Nuvion…' : 'Send for checking'}
                  icon="check"
                  tone="coral"
                  loading={busy}
                  onPress={() => void send()}
                />
                <TextLink
                  label="Take it again"
                  color={colors.white}
                  onPress={() => void pick('camera')}
                />
              </>
            ) : (
              <>
                <PillButton
                  label="Take a photo"
                  icon="camera"
                  tone="coral"
                  onPress={() => void pick('camera')}
                />
                <TextLink
                  label="Choose a photo instead"
                  color={colors.white}
                  onPress={() => void pick('library')}
                />
              </>
            )}
          </View>
        </View>
      </Screen>
    )

  return (
    <Screen>
      <Header />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Progress step={1} label="Step 1 of 2 · Your details" />
          <Txt weight="bold" size={28} style={styles.title}>
            {'Exactly as it’s\nwritten on your ID'}
          </Txt>
          <View style={styles.pair}>
            <Field
              label="First name"
              value={first}
              onChangeText={setFirst}
              autoComplete="given-name"
            />
            <Field
              label="Last name"
              value={last}
              onChangeText={setLast}
              autoComplete="family-name"
            />
          </View>
          <View style={styles.pair}>
            <Field
              label="Date of birth"
              value={dob}
              onChangeText={(t) => setDob(maskDate(t))}
              placeholder="DD / MM / YYYY"
              keyboardType="number-pad"
            />
            <View style={{ flex: 1, gap: 6 }}>
              <Txt weight="semi" size={13} color={colors.muted}>
                Gender
              </Txt>
              <View style={styles.choices}>
                <Choice label="Female" on={gender === 'f'} onPress={() => setGender('f')} />
                <Choice label="Male" on={gender === 'm'} onPress={() => setGender('m')} />
              </View>
            </View>
          </View>
          <Label text="Nationality" />
          <View style={styles.wrap}>
            {COUNTRIES.map(([code, name]) => (
              <Choice
                key={code}
                label={name}
                on={country === code}
                onPress={() => setCountry(code)}
              />
            ))}
          </View>
          <View style={styles.stack}>
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
            <Field
              label="Phone"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoComplete="tel"
            />
            <Field
              label="Home address"
              value={line1}
              onChangeText={setLine1}
              placeholder="House number and street"
              autoComplete="street-address"
            />
          </View>
          <View style={styles.pair}>
            <Field label="City" value={city} onChangeText={setCity} />
            <Field label="State" value={state} onChangeText={setState} />
          </View>
          <View style={styles.pair}>
            <Field
              label="Postcode"
              value={postal}
              onChangeText={setPostal}
              autoComplete="postal-code"
            />
            <View style={{ flex: 1 }} />
          </View>
          <Label text="ID type" />
          <View style={styles.choices}>
            {IDS.map(([type, name]) => (
              <Choice
                key={type}
                label={name}
                on={idType === type}
                onPress={() => setIdType(type)}
              />
            ))}
          </View>
          <View style={styles.stack}>
            <Field
              label={`${idName} number`}
              value={idNumber}
              onChangeText={setIdNumber}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          </View>
          <View style={styles.note}>
            <Icon name="lock" size={15} color={colors.teal} />
            <Txt size={12} color={colors.muted} style={{ flex: 1, lineHeight: 17 }}>
              Sent straight to Nuvion, who issue the card. Kova keeps only whether you passed.
            </Txt>
          </View>
          <PillButton label="Continue" disabled={!ready} onPress={() => setStep('photo')} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}

function Progress({ step, label, dark }: { step: 1 | 2; label: string; dark?: boolean }) {
  return (
    <View style={{ gap: 6 }}>
      <Txt weight="semi" size={12} color={dark ? colors.onInk : colors.muted}>
        {label}
      </Txt>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <View style={[styles.bar, { backgroundColor: dark ? colors.teal : colors.ink }]} />
        <View
          style={[
            styles.bar,
            {
              backgroundColor:
                step === 2 ? colors.white : dark ? 'rgba(255,255,255,0.16)' : colors.sunken,
            },
          ]}
        />
      </View>
    </View>
  )
}

function Label({ text }: { text: string }) {
  return (
    <Txt weight="semi" size={13} color={colors.muted} style={{ marginTop: 14, marginBottom: 6 }}>
      {text}
    </Txt>
  )
}

function Field(props: TextInputProps & { label: string }) {
  const { label, style, ...rest } = props
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <Txt weight="semi" size={13} color={colors.muted}>
        {label}
      </Txt>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        {...rest}
        style={[styles.input, style]}
      />
    </View>
  )
}

function Choice({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[styles.choice, on && styles.choiceOn]}
    >
      <Txt weight="semi" size={14} color={on ? colors.onChosen : colors.ink}>
        {label}
      </Txt>
    </Pressable>
  )
}

function Tip({ icon, label }: { icon: IconName; label: string }) {
  return (
    <View style={styles.tip}>
      <Icon name={icon} size={20} color={colors.blush} />
      <Txt weight="semi" size={12} color={colors.white} style={{ textAlign: 'center' }}>
        {label}
      </Txt>
    </View>
  )
}

function Corner({ style }: { style: object }) {
  return <View style={[styles.corner, style]} />
}

/** "14031996" → "14 / 03 / 1996" as it's typed. */
function maskDate(text: string) {
  const d = text.replace(/\D/g, '').slice(0, 8)
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join(' / ')
}

/** "14 / 03 / 1996" → "1996-03-14", or null unless it's a real date of someone 18 or over. */
function isoDate(text: string) {
  const m = text.match(/^(\d{2}) \/ (\d{2}) \/ (\d{4})$/)
  if (!m) return null
  const [, dd, mm, yyyy] = m
  const date = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.getUTCDate() !== Number(dd)) return null
  const adult = new Date()
  adult.setUTCFullYear(adult.getUTCFullYear() - 18)
  if (date > adult || date.getUTCFullYear() < 1900) return null
  return `${yyyy}-${mm}-${dd}`
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: 4 },
  title: { letterSpacing: -0.8, marginTop: 18, marginBottom: 6 },
  pair: { flexDirection: 'row', gap: 10, marginTop: 14 },
  stack: { gap: 14, marginTop: 14 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choices: { flexDirection: 'row', gap: 8 },
  input: {
    height: 48,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.raised,
    paddingHorizontal: 14,
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 15,
    color: colors.ink,
  },
  choice: {
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceOn: { backgroundColor: colors.chosen, borderColor: colors.chosen },
  note: { flexDirection: 'row', gap: 10, marginTop: 22, marginBottom: 14, paddingHorizontal: 4 },
  bar: { flex: 1, height: 6, borderRadius: 3 },
  photoBody: { flex: 1, paddingHorizontal: 22, paddingBottom: 24 },
  photoTitle: { textAlign: 'center', marginTop: 24, letterSpacing: -0.6, lineHeight: 29 },
  frame: {
    marginTop: 26,
    height: 236,
    borderRadius: 22,
    // The photo step is always on the dark ground, so its tints are fixed rather than themed.
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  preview: { flex: 1 },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  corner: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderColor: colors.blush,
    borderRadius: 6,
  },
  tips: { flexDirection: 'row', gap: 8, marginTop: 20 },
  tip: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
})
