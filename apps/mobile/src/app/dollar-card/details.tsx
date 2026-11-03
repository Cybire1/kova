import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg'
import { type CardDetails, revealDollarCard } from '@/lib/partners'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { CardBrand } from '@/ui/CardBrand'
import { Icon } from '@/ui/Icon'
import { problemOf } from '@/ui/Money'
import { RoundButton, Screen, Txt } from '@/ui/primitives'

// Long enough to copy the number, expiry, CVV, name and each part of the address into a checkout.
const SHOWN_FOR = 60

/** The card itself, drawn: the same in light and dark, like the physical thing. */
const CORAL = '#D46558'
const CORAL_MARK = '#C3594D'
const PRINT = '#1B0E0B'
const PRINT_SOFT = 'rgba(27,14,11,0.68)'

/**
 * The card's details, read from Nuvion when this opens and gone a minute later; Kova never stores
 * them. They're printed on the card the way a physical card lays them out (ISO ID-1: chip and
 * contactless left, the number on its own line, valid thru, the name, the network bottom right),
 * and the security code is on the back: "Show CVV" turns the card over. Every value copies on tap,
 * and so does each part of the billing address (the card's own, which checkouts ask for).
 */
export default function CardDetailsScreen() {
  const { profile, signMessage } = useWallet()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const [details, setDetails] = useState<CardDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [left, setLeft] = useState(SHOWN_FOR)
  const [back, setBack] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const turn = useRef(new Animated.Value(0)).current
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

  // Opened straight from a link there may be nothing to go back to: the card screen, then.
  const close = () => (router.canGoBack() ? router.back() : router.replace('/dollar-card'))

  // biome-ignore lint/correctness/useExhaustiveDependencies: close only reads the router
  useEffect(() => {
    if (left <= 0) close()
  }, [left])

  const flip = () => {
    const next = !back
    setBack(next)
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    Animated.spring(turn, {
      toValue: next ? 1 : 0,
      useNativeDriver: true,
      friction: 9,
      tension: 50,
    }).start()
  }

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

  const cardW = Math.min(width - 36, 354)
  const s = cardW / 354
  const at = (n: number) => Math.round(n * s)
  const expiry = details ? `${details.exp_month}/${details.exp_year.slice(-2)}` : '··/··'
  const address = details?.billing_address ?? null
  const street = address ? [address.line1, address.line2].filter(Boolean).join(', ') : ''
  const front = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] })
  const rear = turn.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] })

  return (
    <Screen>
      <View style={styles.head}>
        <RoundButton icon="close" label="Close" onPress={close} />
        <Txt weight="bold" size={17}>
          Card details
        </Txt>
        <View style={[styles.chip, !details && { opacity: 0 }]}>
          <Icon name="clock" size={13} />
          <Txt weight="bold" size={12}>
            {left} s
          </Txt>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 72 }]}>
        <View style={{ width: cardW, height: at(223), alignSelf: 'center', marginTop: 8 }}>
          {/* The front. */}
          <Animated.View
            pointerEvents={back ? 'none' : 'auto'}
            style={[
              styles.face,
              { borderRadius: at(13), transform: [{ perspective: 1200 }, { rotateY: front }] },
            ]}
          >
            <Svg
              width={cardW}
              height={at(223)}
              viewBox="0 0 354 223"
              style={StyleSheet.absoluteFill}
            >
              <Path d="M236 44v136" stroke={CORAL_MARK} strokeWidth={20} strokeLinecap="round" />
              <Path
                d="M264 80a44 44 0 0 1 0 64M286 62a72 72 0 0 1 0 100M308 44a100 100 0 0 1 0 136"
                stroke={CORAL_MARK}
                strokeWidth={15}
                fill="none"
                strokeLinecap="round"
              />
            </Svg>
            <Txt
              exact
              weight="bold"
              size={at(21)}
              color={colors.dark}
              style={{ position: 'absolute', left: at(22), top: at(15), letterSpacing: -0.5 }}
            >
              kova
            </Txt>
            <Txt
              exact
              weight="bold"
              size={at(9)}
              color={PRINT_SOFT}
              style={{ position: 'absolute', right: at(22), top: at(24), letterSpacing: 1.6 }}
            >
              VIRTUAL
            </Txt>
            <Chip left={at(30)} top={at(68)} width={at(46)} />
            <Svg
              width={at(20)}
              height={at(24)}
              viewBox="0 0 20 24"
              style={{ position: 'absolute', left: at(88), top: at(74) }}
            >
              <Path
                d="M3 8a6 6 0 0 1 0 8M8 5a10 10 0 0 1 0 14M13 2a14 14 0 0 1 0 20"
                stroke={PRINT_SOFT}
                strokeWidth={2}
                fill="none"
                strokeLinecap="round"
              />
            </Svg>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy card number"
              disabled={!details}
              onPress={() => details && void copy('Card number', details.number)}
              style={({ pressed }) => [
                styles.onCard,
                { left: at(14), top: at(114), height: at(38), paddingHorizontal: at(8) },
                pressed && styles.pressedOnCard,
              ]}
            >
              <Txt
                exact
                weight="bold"
                size={at(22)}
                color={PRINT}
                style={{ letterSpacing: at(2.6), fontVariant: ['tabular-nums'] }}
              >
                {details ? group(details.number) : '•••• •••• •••• ••••'}
              </Txt>
              <Icon name="copy" size={at(16)} color={PRINT_SOFT} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Copy expiry ${expiry}`}
              disabled={!details}
              onPress={() => void copy('Expiry', expiry)}
              style={({ pressed }) => [
                styles.onCard,
                { left: at(124), top: at(152), height: at(28), paddingHorizontal: at(8) },
                pressed && styles.pressedOnCard,
              ]}
            >
              <Txt
                exact
                weight="bold"
                size={at(6.5)}
                color={PRINT_SOFT}
                style={{ lineHeight: at(7.5) }}
              >
                {'VALID\nTHRU'}
              </Txt>
              <Txt
                exact
                weight="bold"
                size={at(15)}
                color={PRINT}
                style={{ letterSpacing: 1.4, fontVariant: ['tabular-nums'] }}
              >
                {expiry}
              </Txt>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy name on card"
              disabled={!details}
              onPress={() => details && void copy('Name', details.name)}
              style={({ pressed }) => [
                styles.onCard,
                { left: at(14), bottom: at(13), height: at(28), paddingHorizontal: at(8) },
                pressed && styles.pressedOnCard,
              ]}
            >
              <Txt exact weight="bold" size={at(13)} color={PRINT} style={{ letterSpacing: 1.6 }}>
                {(details?.name ?? '').toUpperCase()}
              </Txt>
            </Pressable>
            <View style={{ position: 'absolute', right: at(20), bottom: at(16) }}>
              <CardBrand brand={details?.brand ?? 'mastercard'} width={at(48)} />
            </View>
          </Animated.View>

          {/* The back: the security code, where a card keeps it. */}
          <Animated.View
            pointerEvents={back ? 'auto' : 'none'}
            style={[
              styles.face,
              { borderRadius: at(13), transform: [{ perspective: 1200 }, { rotateY: rear }] },
            ]}
          >
            <View style={[styles.stripe, { top: at(22), height: at(42) }]} />
            <Txt
              exact
              weight="bold"
              size={at(8)}
              color={PRINT_SOFT}
              style={{ position: 'absolute', left: at(20), top: at(84), letterSpacing: 1.2 }}
            >
              SECURITY CODE
            </Txt>
            <View
              style={{
                position: 'absolute',
                left: at(20),
                right: at(20),
                top: at(100),
                height: at(38),
                flexDirection: 'row',
              }}
            >
              <Signature width={cardW - at(40) - at(86)} height={at(38)} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Copy CVV"
                disabled={!details}
                onPress={() => details && void copy('CVV', details.cvv)}
                style={({ pressed }) => [
                  styles.cvv,
                  { width: at(86) },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Txt
                  exact
                  weight="bold"
                  size={at(20)}
                  color={PRINT}
                  style={{ fontStyle: 'italic', letterSpacing: 1.5 }}
                >
                  {details?.cvv ?? '···'}
                </Txt>
                <Icon name="copy" size={at(14)} color={PRINT_SOFT} />
              </Pressable>
            </View>
            <Txt
              exact
              weight="semi"
              size={at(10)}
              color={PRINT_SOFT}
              style={{
                position: 'absolute',
                left: at(20),
                top: at(146),
                width: at(280),
                lineHeight: at(14),
              }}
            >
              For online and phone payments. Never share it.
            </Txt>
            <Txt
              exact
              weight="bold"
              size={at(15)}
              color={colors.dark}
              style={{ position: 'absolute', left: at(20), bottom: at(14), letterSpacing: -0.3 }}
            >
              kova
            </Txt>
            <View style={{ position: 'absolute', right: at(20), bottom: at(16) }}>
              <CardBrand brand={details?.brand ?? 'mastercard'} width={at(40)} />
            </View>
          </Animated.View>
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={flip}
            style={({ pressed }) => [styles.pill, styles.pillOutline, pressed && { opacity: 0.7 }]}
          >
            <Icon name="swap" size={15} />
            <Txt weight="bold" size={14}>
              {back ? 'Show front' : 'Show CVV'}
            </Txt>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={!details}
            onPress={() => details && void copy('Card number', details.number)}
            style={({ pressed }) => [styles.pill, styles.pillInk, pressed && { opacity: 0.8 }]}
          >
            <Icon name="copy" size={15} color={colors.white} />
            <Txt weight="bold" size={14} color={colors.white}>
              Copy number
            </Txt>
          </Pressable>
        </View>

        {error ? (
          <Txt weight="medium" size={15} color={colors.danger} style={{ marginTop: 18 }}>
            {error}
          </Txt>
        ) : null}

        {address ? (
          <>
            <View style={styles.sectionHead}>
              <Txt weight="bold" size={12} color={colors.muted}>
                Billing address
              </Txt>
              <Txt size={11} color={colors.muted}>
                The card’s, not your home
              </Txt>
            </View>
            <View style={styles.grid}>
              <Cell
                label="Street"
                value={street}
                wide
                rule
                onCopy={() => void copy('Street', street)}
              />
              <View style={styles.gridRow}>
                <Cell
                  label="City"
                  value={address.city}
                  rule
                  divide
                  onCopy={() => void copy('City', address.city)}
                />
                <Cell
                  label="State"
                  value={stateName(address.state)}
                  rule
                  onCopy={() => void copy('State', stateName(address.state))}
                />
              </View>
              <View style={styles.gridRow}>
                <Cell
                  label="ZIP code"
                  value={address.postal_code}
                  divide
                  onCopy={() => void copy('ZIP code', address.postal_code)}
                />
                <Cell
                  label="Country"
                  value={countryName(address.country)}
                  onCopy={() => void copy('Country', countryName(address.country))}
                />
              </View>
            </View>
          </>
        ) : null}

        <View style={styles.note}>
          <Icon name="lock" size={13} color={colors.teal} />
          <Txt size={11} color={colors.muted}>
            Only you can see this. Kova never stores your card number.
          </Txt>
        </View>
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

/** The EMV chip: gold, with its contact pads. */
function Chip({ left, top, width }: { left: number; top: number; width: number }) {
  return (
    <Svg
      width={width}
      height={(width * 35) / 46}
      viewBox="0 0 46 35"
      style={{ position: 'absolute', left, top }}
    >
      <Defs>
        <LinearGradient id="chipGold" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#F3DB9A" />
          <Stop offset="0.5" stopColor="#D9B866" />
          <Stop offset="1" stopColor="#C49A48" />
        </LinearGradient>
      </Defs>
      <Rect x={0.5} y={0.5} width={45} height={34} rx={6} fill="url(#chipGold)" stroke="#A8823A" />
      <Path
        d="M0.5 12h14M0.5 23h14M31.5 12h14M31.5 23h14M14.5 0.5v34M31.5 0.5v34M14.5 17.5h17"
        stroke="#A8823A"
        fill="none"
      />
    </Svg>
  )
}

/** The signature panel's printed stripes. */
function Signature({ width, height }: { width: number; height: number }) {
  const lines: string[] = []
  for (let x = -height; x < width; x += 9) lines.push(`M${x} ${height}L${x + height} 0`)
  return (
    <View style={[styles.signature, { width, height }]}>
      <Svg width={width} height={height}>
        <Path d={lines.join('')} stroke="#E2DED6" strokeWidth={4} />
      </Svg>
    </View>
  )
}

/** One part of the billing address: tap it to copy. */
function Cell({
  label,
  value,
  wide,
  rule,
  divide,
  onCopy,
}: {
  label: string
  value: string
  wide?: boolean
  rule?: boolean
  divide?: boolean
  onCopy: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}. Copy`}
      onPress={onCopy}
      style={({ pressed }) => [
        styles.cell,
        wide ? null : { flex: 1 },
        rule && styles.rule,
        divide && styles.divide,
        pressed && { backgroundColor: colors.sunken },
      ]}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Txt size={11} color={colors.muted}>
          {label}
        </Txt>
        <Txt weight="bold" size={15} numberOfLines={1}>
          {value}
        </Txt>
      </View>
      <Icon name="copy" size={14} color={colors.muted} />
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

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 4,
    height: 52,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: colors.sunken,
  },
  scroll: { paddingHorizontal: 18, paddingTop: 6 },
  face: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: CORAL,
    overflow: 'hidden',
    backfaceVisibility: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  onCard: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
  },
  pressedOnCard: { backgroundColor: 'rgba(27,14,11,0.08)' },
  stripe: { position: 'absolute', left: 0, right: 0, backgroundColor: PRINT },
  signature: {
    backgroundColor: '#F1EFEA',
    overflow: 'hidden',
    borderTopLeftRadius: 4,
    borderBottomLeftRadius: 4,
  },
  cvv: {
    backgroundColor: '#FFFFFF',
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 14 },
  pill: {
    height: 42,
    paddingHorizontal: 16,
    borderRadius: 21,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pillOutline: { borderWidth: 2, borderColor: colors.line, backgroundColor: colors.surface },
  pillInk: { backgroundColor: colors.fill },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 22,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  grid: {
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  gridRow: { flexDirection: 'row' },
  cell: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  rule: { borderBottomWidth: 1.5, borderColor: colors.sunken },
  divide: { borderRightWidth: 1.5, borderColor: colors.sunken },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 14,
  },
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
