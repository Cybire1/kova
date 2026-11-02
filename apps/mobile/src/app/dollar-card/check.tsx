import { Image } from 'expo-image'
import { router, useLocalSearchParams } from 'expo-router'
import { type ReactNode, useState } from 'react'
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
import { type PhotoSource, takePhoto } from '@/lib/photos'
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

const PROOFS: Array<[CardCheck['address_proof']['type'], string]> = [
  ['utility_bill', 'Utility bill'],
  ['bank_statement', 'Bank statement'],
]

/** The national number Nuvion needs from some countries: a NIN or BVN in Nigeria, an SSN in the US. */
const NUMBERS = {
  nin: {
    label: 'NIN',
    digits: 11,
    hint: 'On your NIN slip and newer passports. Or dial *346# from the phone it’s linked to.',
  },
  bvn: { label: 'BVN', digits: 11, hint: 'Dial *565*0# from the phone number your bank has.' },
  ssn: { label: 'Social Security number', digits: 9, hint: 'The 9 digits on your card.' },
} as const

type Shot = { uri: string; base64: string }

/**
 * The dollar card's ID check, in three steps: your details exactly as on your ID, a photo of it,
 * then a bill or bank statement showing your address (Nuvion needs both documents before it will
 * check anyone). All of it goes to Nuvion, who issue the card; Kova keeps only whether you passed.
 */
export default function CardCheckScreen() {
  const { profile, signMessage } = useWallet()
  // Development only: ?step=photo or ?step=address opens that step, to look at it on a simulator.
  const { step: opened } = useLocalSearchParams<{ step?: string }>()
  const [step, setStep] = useState<'details' | 'photo' | 'address'>(
    __DEV__ && (opened === 'photo' || opened === 'address') ? opened : 'details',
  )
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
  const [numberType, setNumberType] = useState<'nin' | 'bvn'>('nin')
  const [number, setNumber] = useState('')
  const [photo, setPhoto] = useState<Shot | null>(null)
  const [proofType, setProofType] = useState<CardCheck['address_proof']['type']>('utility_bill')
  const [proof, setProof] = useState<Shot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const birth = isoDate(dob)
  const kind = country === 'NG' ? numberType : country === 'US' ? 'ssn' : null
  const digits = number.replace(/\D/g, '')
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
    idNumber.trim().length >= 4 &&
    (!kind || digits.length === NUMBERS[kind].digits)
  const idName = IDS.find(([t]) => t === idType)?.[1] ?? 'ID'

  const shoot = (keep: (shot: Shot) => void) => async (from: PhotoSource) => {
    setError(null)
    try {
      const shot = await takePhoto(from, 'id')
      if (shot?.base64) keep({ uri: shot.uri, base64: shot.base64 })
    } catch (e) {
      setError(problemOf(e))
    }
  }

  const send = async () => {
    if (!profile || !photo || !proof || !birth || !gender) return
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
        ...(kind ? { id_number: { type: kind, value: digits } } : {}),
        address_proof: { type: proofType, file: proof.base64, mime: 'image/jpeg' },
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
      <CameraStep
        step={2}
        label={`Step 2 of 3 · Photo of your ${idName.toLowerCase()}`}
        title={`Fit your ${idName.toLowerCase()}\nin the frame`}
        shot={photo}
        tips={[
          ['glare', 'No glare'],
          ['corners', 'All four corners'],
          ['type', 'Easy to read'],
        ]}
        error={error}
        onBack={() => (setError(null), setStep('details'))}
        onShoot={shoot(setPhoto)}
        next={{
          label: 'Continue',
          icon: 'arrow',
          onPress: () => (setError(null), setStep('address')),
        }}
      />
    )

  if (step === 'address')
    return (
      <CameraStep
        step={3}
        label="Step 3 of 3 · Proof of address"
        title={'A bill or statement\nwith your address'}
        lead={`From the last 3 months, with ${`${first.trim()} ${last.trim()}`.trim() || 'your name'} and ${line1.trim() || 'your address'} on it.`}
        choices={
          <View style={styles.darkChoices}>
            {PROOFS.map(([type, name]) => (
              <DarkChoice
                key={type}
                label={name}
                on={proofType === type}
                onPress={() => setProofType(type)}
              />
            ))}
          </View>
        }
        tall
        shot={proof}
        tips={[
          ['user', 'Your name'],
          ['home', 'This address'],
          ['calendar', 'Last 3 months'],
        ]}
        error={error}
        onBack={() => (setError(null), setStep('photo'))}
        onShoot={shoot(setProof)}
        next={{
          label: busy ? 'Sending to Nuvion…' : 'Send for checking',
          icon: 'check',
          busy,
          onPress: () => void send(),
        }}
      />
    )

  return (
    <Screen>
      <Header />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Progress step={1} label="Step 1 of 3 · Your details" />
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
          {country === 'NG' ? (
            <>
              <Label text="NIN or BVN" />
              <View style={styles.choices}>
                <Choice
                  label="NIN"
                  on={numberType === 'nin'}
                  onPress={() => setNumberType('nin')}
                />
                <Choice
                  label="BVN"
                  on={numberType === 'bvn'}
                  onPress={() => setNumberType('bvn')}
                />
              </View>
            </>
          ) : null}
          {kind ? (
            <View style={styles.stack}>
              <Field
                label={NUMBERS[kind].label}
                value={number}
                onChangeText={(t) => setNumber(t.replace(/[^\d -]/g, ''))}
                placeholder={`${NUMBERS[kind].digits} digits`}
                keyboardType="number-pad"
              />
              <Txt size={12} color={colors.muted} style={styles.hint}>
                {NUMBERS[kind].hint}
              </Txt>
            </View>
          ) : null}
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

/**
 * A step that takes a photo on the dark ground: the frame, three tips, what went wrong, and the
 * way on once there's a photo. Fixed white and cream rather than themed: the ground is always dark.
 */
function CameraStep({
  step,
  label,
  title,
  lead,
  choices,
  tall,
  shot,
  tips,
  error,
  onBack,
  onShoot,
  next,
}: {
  step: 2 | 3
  label: string
  title: string
  lead?: string
  choices?: ReactNode
  tall?: boolean
  shot: Shot | null
  tips: Array<[IconName, string]>
  error: string | null
  onBack: () => void
  onShoot: (from: PhotoSource) => Promise<void>
  next: { label: string; icon: IconName; busy?: boolean; onPress: () => void }
}) {
  return (
    <Screen bg={colors.dark}>
      <Header onBack={onBack} onDark />
      <ScrollView contentContainerStyle={styles.photoBody}>
        <Progress step={step} dark label={label} />
        <Txt weight="bold" size={24} color={colors.white} style={styles.photoTitle}>
          {title}
        </Txt>
        {lead ? (
          <Txt size={14} color={colors.onInk} style={styles.photoLead}>
            {lead}
          </Txt>
        ) : null}
        {choices}
        <View style={[styles.frame, tall && styles.frameTall]}>
          {shot ? (
            <Image source={{ uri: shot.uri }} style={styles.preview} contentFit="cover" />
          ) : (
            <View style={styles.placeholder}>
              <Icon name="camera" size={30} color={colors.white} strokeWidth={1.75} />
            </View>
          )}
          <Corner style={{ left: 12, top: 12, borderLeftWidth: 3, borderTopWidth: 3 }} />
          <Corner style={{ right: 12, top: 12, borderRightWidth: 3, borderTopWidth: 3 }} />
          <Corner style={{ left: 12, bottom: 12, borderLeftWidth: 3, borderBottomWidth: 3 }} />
          <Corner style={{ right: 12, bottom: 12, borderRightWidth: 3, borderBottomWidth: 3 }} />
        </View>
        <View style={styles.tips}>
          {tips.map(([icon, text]) => (
            <View key={text} style={styles.tip}>
              <Icon name={icon} size={20} color={colors.white} strokeWidth={1.75} />
              <Txt weight="semi" size={12} color={colors.onInk} style={{ textAlign: 'center' }}>
                {text}
              </Txt>
            </View>
          ))}
        </View>
        {error ? (
          <View style={styles.problem}>
            <Icon name="info" size={18} color={colors.white} />
            <Txt weight="medium" size={14} color={colors.white} style={styles.problemText}>
              {error}
            </Txt>
          </View>
        ) : null}
        <View style={styles.actions}>
          {shot ? (
            <>
              <PillButton
                label={next.label}
                icon={next.icon}
                tone="light"
                loading={next.busy}
                onPress={next.onPress}
              />
              <TextLink
                label="Take it again"
                color={colors.white}
                onPress={() => void onShoot('camera')}
              />
            </>
          ) : (
            <>
              <PillButton
                label="Take a photo"
                icon="camera"
                tone="light"
                onPress={() => void onShoot('camera')}
              />
              <TextLink
                label="Choose a photo instead"
                color={colors.white}
                onPress={() => void onShoot('library')}
              />
            </>
          )}
        </View>
      </ScrollView>
    </Screen>
  )
}

function Progress({ step, label, dark }: { step: 1 | 2 | 3; label: string; dark?: boolean }) {
  return (
    <View style={{ gap: 6 }}>
      <Txt weight="semi" size={12} color={dark ? colors.onInk : colors.muted}>
        {label}
      </Txt>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {[1, 2, 3].map((n) => (
          <View
            key={n}
            style={[
              styles.bar,
              {
                backgroundColor:
                  n <= step
                    ? dark
                      ? colors.white
                      : colors.ink
                    : dark
                      ? 'rgba(255,255,255,0.16)'
                      : colors.sunken,
              },
            ]}
          />
        ))}
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

/** A choice on the dark ground: an outline, filled cream once chosen. */
function DarkChoice({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[styles.darkChoice, on && styles.darkChoiceOn]}
    >
      <Txt weight="semi" size={14} color={on ? colors.dark : colors.white}>
        {label}
      </Txt>
    </Pressable>
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

// The camera steps are always on the dark ground, so their tints are fixed rather than themed.
const CREAM = '#F1EFEA'
const GLASS = 'rgba(255,255,255,0.07)'

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: 4 },
  title: { letterSpacing: -0.8, marginTop: 18, marginBottom: 6 },
  pair: { flexDirection: 'row', gap: 10, marginTop: 14 },
  stack: { gap: 14, marginTop: 14 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choices: { flexDirection: 'row', gap: 8 },
  hint: { lineHeight: 17, marginTop: -6, paddingHorizontal: 2 },
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
  photoBody: { flexGrow: 1, paddingHorizontal: 22, paddingBottom: 24 },
  photoTitle: { textAlign: 'center', marginTop: 24, letterSpacing: -0.6, lineHeight: 29 },
  photoLead: { textAlign: 'center', marginTop: 8, lineHeight: 20, paddingHorizontal: 8 },
  darkChoices: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 18 },
  darkChoice: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  darkChoiceOn: { backgroundColor: CREAM, borderColor: CREAM },
  frame: {
    marginTop: 22,
    height: 236,
    borderRadius: 22,
    backgroundColor: GLASS,
    overflow: 'hidden',
  },
  frameTall: { height: 250 },
  preview: { flex: 1 },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: 'rgba(255,255,255,0.92)',
    borderRadius: 8,
  },
  tips: { flexDirection: 'row', gap: 8, marginTop: 18 },
  tip: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderRadius: 18,
    backgroundColor: GLASS,
  },
  problem: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  problemText: { flex: 1, lineHeight: 20 },
  actions: { marginTop: 'auto', paddingTop: 20, gap: 14 },
})
