import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { type CardDetails, revealDollarCard } from '@/lib/partners'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { CardBrand } from '@/ui/CardBrand'
import { Icon } from '@/ui/Icon'
import { problemOf } from '@/ui/Money'
import { RoundButton, Screen, Txt } from '@/ui/primitives'

const cardArt = require('../../../assets/cards/coral.png')
// Long enough to copy the number, expiry, CVV, name and each part of the address into a checkout.
const SHOWN_FOR = 60

/**
 * The card's number, expiry, CVV and billing address, read from Nuvion when you open this and gone
 * a minute later. Kova never stores them; copying puts one value on the clipboard. The address is
 * the card's own (what a checkout asks for with it), shown in the parts a checkout form asks for.
 */
export default function CardDetailsScreen() {
  const { profile, signMessage } = useWallet()
  const [details, setDetails] = useState<CardDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [left, setLeft] = useState(SHOWN_FOR)
  const [copied, setCopied] = useState<string | null>(null)

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

  const address = details?.billing_address ?? null

  const copy = async (what: string, value: string) => {
    await Clipboard.setStringAsync(value)
    setCopied(what)
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.head}>
          <Txt weight="bold" size={28} style={{ letterSpacing: -0.8 }}>
            Card details
          </Txt>
          <RoundButton icon="close" label="Hide details" onPress={() => router.back()} />
        </View>
        <View style={styles.cardBox}>
          <Image source={cardArt} style={styles.card} contentFit="contain" />
          <View style={styles.brandOnCard}>
            <CardBrand brand={details?.brand} width={32} />
          </View>
        </View>
        {error ? (
          <Txt weight="medium" size={15} color={colors.danger} style={{ margin: 20 }}>
            {error}
          </Txt>
        ) : (
          <View style={styles.section}>
            <Row
              label="Card number"
              value={details ? group(details.number) : 'Opening…'}
              big
              copied={copied === 'number'}
              onCopy={details ? () => void copy('number', details.number) : undefined}
            />
            <View style={[styles.split, styles.rule]}>
              <View style={[styles.half, styles.divider]}>
                <Row
                  label="Expires"
                  value={details ? `${details.exp_month}/${details.exp_year.slice(-2)}` : '··/··'}
                  big
                />
              </View>
              <View style={styles.half}>
                <Row
                  label="CVV"
                  value={details?.cvv ?? '···'}
                  big
                  copied={copied === 'cvv'}
                  onCopy={details ? () => void copy('cvv', details.cvv) : undefined}
                />
              </View>
            </View>
            <View style={styles.rule}>
              <Row
                label="Name on card"
                value={details?.name ?? ''}
                copied={copied === 'name'}
                onCopy={details ? () => void copy('name', details.name) : undefined}
              />
            </View>
          </View>
        )}
        {address && !error ? (
          <>
            <View style={styles.billingHead}>
              <Txt weight="bold" size={17}>
                Billing address
              </Txt>
              <Txt size={13} color={colors.muted} style={{ lineHeight: 18 }}>
                When a checkout asks for the card’s billing address, use this. It’s the card’s
                address, not your home.
              </Txt>
            </View>
            <View style={[styles.section, { marginTop: 10 }]}>
              <Row
                label="Street"
                value={[address.line1, address.line2].filter(Boolean).join(', ')}
                copied={copied === 'street'}
                onCopy={() =>
                  void copy('street', [address.line1, address.line2].filter(Boolean).join(', '))
                }
              />
              <View style={[styles.split, styles.rule]}>
                <View style={[styles.half, styles.divider]}>
                  <Row
                    label="City"
                    value={address.city}
                    copied={copied === 'city'}
                    onCopy={() => void copy('city', address.city)}
                  />
                </View>
                <View style={styles.half}>
                  <Row
                    label="State"
                    value={stateName(address.state)}
                    copied={copied === 'state'}
                    onCopy={() => void copy('state', stateName(address.state))}
                  />
                </View>
              </View>
              <View style={[styles.split, styles.rule]}>
                <View style={[styles.half, styles.divider]}>
                  <Row
                    label="ZIP code"
                    value={address.postal_code}
                    copied={copied === 'zip'}
                    onCopy={() => void copy('zip', address.postal_code)}
                  />
                </View>
                <View style={styles.half}>
                  <Row label="Country" value={countryName(address.country)} />
                </View>
              </View>
            </View>
          </>
        ) : null}
        {details ? (
          <View style={styles.timer}>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${(left / SHOWN_FOR) * 100}%` }]} />
            </View>
            <View style={styles.timerFoot}>
              <Txt size={13} color={colors.muted}>
                Hides by itself
              </Txt>
              <Txt weight="bold" size={13}>
                {left} s
              </Txt>
            </View>
          </View>
        ) : null}
        <View style={styles.note}>
          <Icon name="lock" size={15} color={colors.teal} />
          <Txt size={13} color={colors.muted} style={{ flex: 1, lineHeight: 19 }}>
            Only you can see this. It comes straight from Nuvion, and Kova never stores your card
            number or CVV.
          </Txt>
        </View>
      </ScrollView>
    </Screen>
  )
}

function Row({
  label,
  value,
  big,
  copied,
  onCopy,
}: {
  label: string
  value: string
  big?: boolean
  copied?: boolean
  onCopy?: () => void
}) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt size={13} color={colors.muted}>
          {label}
        </Txt>
        <Txt weight="bold" size={big ? 19 : 17} style={big ? { letterSpacing: 0.6 } : undefined}>
          {value}
        </Txt>
      </View>
      {onCopy ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Copy ${label.toLowerCase()}`}
          onPress={onCopy}
          style={({ pressed }) => [styles.copy, pressed && { opacity: 0.6 }]}
        >
          <Txt weight="semi" size={14}>
            {copied ? 'Copied' : 'Copy'}
          </Txt>
        </Pressable>
      ) : null}
    </View>
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

/** "US" → "United States", for the country field of a checkout (React Native has no Intl.DisplayNames). */
const COUNTRIES: Record<string, string> = {
  US: 'United States',
  GB: 'United Kingdom',
  CA: 'Canada',
  NG: 'Nigeria',
}
const countryName = (code: string) => COUNTRIES[code.toUpperCase()] ?? code

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, paddingBottom: 12 },
  billingHead: { marginTop: 22, marginHorizontal: 24, gap: 3 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  // Smaller than on the card screen: here the numbers and the address are what count.
  cardBox: { width: 230, height: 145, alignSelf: 'center', marginTop: 14 },
  card: { width: 230, height: 145, borderRadius: 13 },
  brandOnCard: { position: 'absolute', right: 10, top: 8 },
  section: {
    marginTop: 18,
    marginHorizontal: 20,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rule: { borderTopWidth: 2, borderColor: colors.sunken },
  split: { flexDirection: 'row' },
  half: { flex: 1 },
  divider: { borderRightWidth: 2, borderColor: colors.sunken },
  copy: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timer: { marginTop: 18, marginHorizontal: 24, gap: 8 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.sunken, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.ink },
  timerFoot: { flexDirection: 'row', justifyContent: 'space-between' },
  note: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 24,
    marginHorizontal: 24,
    marginBottom: 20,
  },
})
