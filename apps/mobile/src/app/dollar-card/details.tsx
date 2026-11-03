import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Animated, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { type CardDetails, revealDollarCard } from '@/lib/partners'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { CardBrand } from '@/ui/CardBrand'
import { Icon } from '@/ui/Icon'
import { problemOf } from '@/ui/Money'
import { Header, Screen, Txt } from '@/ui/primitives'

const cardArt = require('../../../assets/cards/coral.png')
// Long enough to copy the number, expiry, CVV, name and each part of the address into a checkout.
const SHOWN_FOR = 60

/**
 * The card's number, expiry, CVV and billing address, read from Nuvion when this opens and gone a
 * minute later. Kova never stores them. The card shows its last four, as on the card screen; below,
 * each value is one row: tap it to copy, and a note says what was copied.
 * The billing address is the card's own (what a checkout asks for with it), in the parts a checkout
 * form asks for.
 */
export default function CardDetailsScreen() {
  const { profile, signMessage } = useWallet()
  const insets = useSafeAreaInsets()
  const [details, setDetails] = useState<CardDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [left, setLeft] = useState(SHOWN_FOR)
  const [copied, setCopied] = useState<string | null>(null)
  const toast = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!profile) return
    revealDollarCard(profile.address, signMessage)
      .then(setDetails)
      .catch((e) => setError(problemOf(e)))
  }, [profile, signMessage])

  useEffect(() => {
    if (!details) return
    const timer = setInterval(() => setLeft((s) => s - 1), 1000)
    return () => clearInterval(timer)
  }, [details])

  useEffect(() => {
    if (left <= 0) router.back()
  }, [left])

  const copy = async (label: string, value: string) => {
    await Clipboard.setStringAsync(value)
    setCopied(label)
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    toast.stopAnimation()
    toast.setValue(0)
    Animated.sequence([
      Animated.timing(toast, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.delay(1200),
      Animated.timing(toast, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start()
  }

  const address = details?.billing_address ?? null
  const street = address ? [address.line1, address.line2].filter(Boolean).join(', ') : ''
  const expiry = details ? `${details.exp_month}/${details.exp_year.slice(-2)}` : ''

  return (
    <Screen>
      <Header title="Card details" backIcon="close" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 72 }]}>
        <View style={styles.cardBox}>
          <Image source={cardArt} style={styles.card} contentFit="contain" />
          <View style={styles.numberOnCard}>
            <Txt weight="bold" size={12} color={colors.white} style={{ letterSpacing: 1 }}>
              •••• {details ? details.number.slice(-4) : '····'}
            </Txt>
          </View>
          <View style={styles.brandOnCard}>
            <CardBrand brand={details?.brand} width={36} />
          </View>
        </View>

        {details ? (
          <View style={styles.timer}>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${(left / SHOWN_FOR) * 100}%` }]} />
            </View>
            <Txt size={12} color={colors.muted}>
              Hides in {left} s
            </Txt>
          </View>
        ) : null}

        {error ? (
          <Txt weight="medium" size={15} color={colors.danger} style={{ marginTop: 18 }}>
            {error}
          </Txt>
        ) : (
          <>
            <Section title="Card">
              <Row
                label="Card number"
                value={details ? group(details.number) : 'Opening…'}
                mono
                rule
                onCopy={details ? () => void copy('Card number', details.number) : undefined}
              />
              <Pair rule>
                <Row
                  label="Expires"
                  value={expiry || '··/··'}
                  mono
                  onCopy={details ? () => void copy('Expiry', expiry) : undefined}
                />
                <Row
                  label="CVV"
                  value={details?.cvv ?? '···'}
                  mono
                  onCopy={details ? () => void copy('CVV', details.cvv) : undefined}
                />
              </Pair>
              <Row
                label="Name on card"
                value={details?.name ?? ''}
                onCopy={details ? () => void copy('Name', details.name) : undefined}
              />
            </Section>

            {address ? (
              <Section
                title="Billing address"
                note="For checkouts that ask for the card’s address. It’s the card’s, not your home."
              >
                <Row
                  label="Street"
                  value={street}
                  rule
                  onCopy={() => void copy('Street', street)}
                />
                <Pair rule>
                  <Row
                    label="City"
                    value={address.city}
                    onCopy={() => void copy('City', address.city)}
                  />
                  <Row
                    label="State"
                    value={stateName(address.state)}
                    onCopy={() => void copy('State', stateName(address.state))}
                  />
                </Pair>
                <Pair>
                  <Row
                    label="ZIP code"
                    value={address.postal_code}
                    mono
                    onCopy={() => void copy('ZIP code', address.postal_code)}
                  />
                  <Row
                    label="Country"
                    value={countryName(address.country)}
                    onCopy={() => void copy('Country', countryName(address.country))}
                  />
                </Pair>
              </Section>
            ) : null}

            <View style={styles.note}>
              <Icon name="lock" size={14} color={colors.teal} />
              <Txt size={12} color={colors.muted} style={{ flex: 1, lineHeight: 17 }}>
                Only you can see this. It comes straight from Nuvion, and Kova never stores your
                card number or CVV.
              </Txt>
            </View>
          </>
        )}
      </ScrollView>

      <Animated.View
        pointerEvents="none"
        accessibilityLiveRegion="polite"
        style={[
          styles.toast,
          {
            bottom: insets.bottom + 18,
            opacity: toast,
            transform: [
              { translateY: toast.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
            ],
          },
        ]}
      >
        <Icon name="check" size={16} color={colors.white} />
        <Txt weight="semi" size={14} color={colors.white}>
          {copied ? `${copied} copied` : ''}
        </Txt>
      </Animated.View>
    </Screen>
  )
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <View style={{ marginTop: 22 }}>
      <View style={styles.sectionHead}>
        <Txt weight="bold" size={15}>
          {title}
        </Txt>
        {note ? (
          <Txt size={12} color={colors.muted} style={{ lineHeight: 17 }}>
            {note}
          </Txt>
        ) : null}
      </View>
      <View style={styles.section}>{children}</View>
    </View>
  )
}

/** Two values side by side, split by a hairline. */
function Pair({ children, rule }: { children: [ReactNode, ReactNode]; rule?: boolean }) {
  return (
    <View style={[styles.pair, rule && styles.rule]}>
      <View style={[styles.half, styles.divider]}>{children[0]}</View>
      <View style={styles.half}>{children[1]}</View>
    </View>
  )
}

/** One value: tap anywhere on it to copy. */
function Row({
  label,
  value,
  mono,
  rule,
  onCopy,
}: {
  label: string
  value: string
  mono?: boolean
  rule?: boolean
  onCopy?: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}. Copy`}
      disabled={!onCopy}
      onPress={onCopy}
      style={({ pressed }) => [
        styles.row,
        rule && styles.rule,
        pressed && { backgroundColor: colors.sunken },
      ]}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Txt size={12} color={colors.muted}>
          {label}
        </Txt>
        <Txt
          weight="bold"
          size={mono ? 17 : 16}
          numberOfLines={1}
          adjustsFontSizeToFit
          style={mono ? { letterSpacing: 0.8, fontVariant: ['tabular-nums'] } : undefined}
        >
          {value}
        </Txt>
      </View>
      {onCopy ? <Icon name="copy" size={17} color={colors.muted} /> : null}
    </Pressable>
  )
}

const group = (number: string) => number.replace(/(\d{4})(?=\d)/g, '$1 ')

/** A US state's name from its code ("FL" → "Florida"), as checkout forms list them. */
const US_STATES: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  PR: 'Puerto Rico',
}
const stateName = (code: string) => US_STATES[code.trim().toUpperCase()] ?? code

/** "US" → "United States" (React Native has no Intl.DisplayNames). */
const COUNTRIES: Record<string, string> = {
  US: 'United States',
  GB: 'United Kingdom',
  CA: 'Canada',
  NG: 'Nigeria',
}
const countryName = (code: string) => COUNTRIES[code.toUpperCase()] ?? code

const CARD_W = 300
const CARD_H = Math.round(CARD_W * 0.63)

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20, paddingTop: 4 },
  cardBox: { width: CARD_W, height: CARD_H, alignSelf: 'center', marginTop: 6 },
  card: { width: CARD_W, height: CARD_H, borderRadius: 16 },
  numberOnCard: {
    position: 'absolute',
    left: 14,
    top: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.dark,
  },
  brandOnCard: { position: 'absolute', right: 12, top: 10 },
  timer: { width: CARD_W, alignSelf: 'center', marginTop: 12, gap: 6, alignItems: 'center' },
  track: {
    width: '100%',
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.sunken,
    overflow: 'hidden',
  },
  fill: { height: 3, borderRadius: 2, backgroundColor: colors.ink },
  sectionHead: { gap: 2, marginBottom: 8, paddingHorizontal: 4 },
  section: {
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  rule: { borderBottomWidth: 1.5, borderColor: colors.sunken },
  pair: { flexDirection: 'row' },
  half: { flex: 1 },
  divider: { borderRightWidth: 1.5, borderColor: colors.sunken },
  note: { flexDirection: 'row', gap: 8, marginTop: 18, paddingHorizontal: 4 },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.dark,
  },
})
