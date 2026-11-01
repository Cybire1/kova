import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { type CardDetails, revealDollarCard } from '@/lib/partners'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Icon } from '@/ui/Icon'
import { problemOf } from '@/ui/Money'
import { RoundButton, Screen, Txt } from '@/ui/primitives'

const cardArt = require('../../../assets/cards/coral.png')
const SHOWN_FOR = 30

/**
 * The card's number, expiry and CVV, read from Nuvion when you open this and gone 30 seconds later.
 * Kova never stores them; copying puts one value on the clipboard.
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

  const copy = async (what: string, value: string) => {
    await Clipboard.setStringAsync(value)
    setCopied(what)
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  }

  return (
    <Screen>
      <View style={styles.head}>
        <Txt weight="bold" size={32} style={{ letterSpacing: -1 }}>
          Card details
        </Txt>
        <RoundButton icon="close" label="Hide details" onPress={() => router.back()} />
      </View>
      <Image source={cardArt} style={styles.card} contentFit="contain" />
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

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  card: { width: 333, height: 210, alignSelf: 'center', marginTop: 20, borderRadius: 18 },
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
    marginTop: 'auto',
    marginHorizontal: 24,
    marginBottom: 20,
  },
})
