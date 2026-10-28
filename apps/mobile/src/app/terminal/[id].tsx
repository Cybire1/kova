import * as Haptics from 'expo-haptics'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import { cancelCharge, getCharge, type PaymentIntent, payLinkFor } from '@/lib/api'
import { CardError, finishTap, isCancelled, type ReadTap, readTap } from '@/lib/card'
import { useShop } from '@/lib/shop'
import { colors, palette } from '@/lib/theme'
import { KoviPeek, peekEdge } from '@/ui/art'
import { Icon } from '@/ui/Icon'
import { Ping } from '@/ui/motion'
import { PaidScene } from '@/ui/PaidScene'
import { PinEntry } from '@/ui/PinEntry'
import {
  Chip,
  PillButton,
  Rise,
  RoundButton,
  Screen,
  Sticker,
  TextLink,
  Txt,
} from '@/ui/primitives'
import { Stage as KoviStage } from '@/ui/Stage'

/**
 * The screen the merchant turns toward the customer. Read from across a counter, so it says
 * only who, how much and how, then flips to PAID the moment the chain confirms it.
 */
export default function CustomerDisplay() {
  const params = useLocalSearchParams<{ id: string; price?: string; usd?: string }>()
  const id = params.id
  const shop = useShop()
  const { width } = useWindowDimensions()
  const [intent, setIntent] = useState<PaymentIntent | null>(null)
  const started = useRef(Date.now())
  const [tookMs, setTookMs] = useState<number | null>(null)
  // A Kova Card tap: read and signed in one NFC session, then paid, with the PIN when it's asked.
  const [tap, setTap] = useState<
    | { at: 'idle'; problem?: string }
    | { at: 'reading' }
    | { at: 'pin'; read: ReadTap; signature: `0x${string}`; pin: string; problem?: string }
    | { at: 'paying' }
  >({ at: 'idle' })

  const pay = async (read: ReadTap, signature: `0x${string}`, pin?: string) => {
    setTap({ at: 'paying' })
    try {
      await finishTap(read.id, signature, pin)
      setIntent(await getCharge(id))
    } catch (error) {
      const details = error instanceof CardError ? error.details : {}
      const message = error instanceof Error ? error.message : 'That didn’t work. Tap again.'
      // A wrong PIN keeps the same signed tap: the customer just tries the PIN again.
      if (details.pin_required && pin !== undefined)
        setTap({ at: 'pin', read, signature, pin: '', problem: message })
      else setTap({ at: 'idle', problem: message })
    }
  }

  const tapCard = async () => {
    setTap({ at: 'reading' })
    try {
      const { tap: read, signature } = await readTap(id)
      if (read.pin_required) setTap({ at: 'pin', read, signature, pin: '' })
      else await pay(read, signature)
    } catch (error) {
      setTap(
        isCancelled(error)
          ? { at: 'idle' }
          : {
              at: 'idle',
              problem: error instanceof Error ? error.message : 'That didn’t work. Tap again.',
            },
      )
    }
  }

  useEffect(() => {
    let cancelled = false
    const poll = setInterval(async () => {
      try {
        const latest = await getCharge(id)
        if (cancelled) return
        setIntent(latest)
        if (latest.status === 'paid') {
          clearInterval(poll)
          setTookMs(Date.now() - started.current)
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        } else if (latest.status !== 'requires_payment' && latest.status !== 'processing')
          clearInterval(poll)
      } catch {
        // A missed poll is not a failed payment. Keep waiting.
      }
    }, 800)
    return () => {
      cancelled = true
      clearInterval(poll)
    }
  }, [id])

  // The price as the shop entered it travels in the link; reopened without it, fall back to the
  // charge's own dollar amount.
  const usd = params.usd ?? intent?.amount ?? '…'
  const price = params.price ?? `$${usd}`
  const status = intent?.status ?? 'requires_payment'
  const next = () => router.replace('/terminal')

  if (status === 'paid')
    return (
      <Screen bg={colors.sunken}>
        <View style={styles.top}>
          <RoundButton icon="close" label="Close" onPress={next} />
          <Txt weight="semi" size={18}>
            {shop.name}
          </Txt>
          <Chip label="Settled" dot={colors.tealLight} />
        </View>
        <PaidScene amount={price} height={340} />
        <Rise style={{ alignItems: 'center', marginBottom: 18, paddingHorizontal: 24 }}>
          <Txt weight="bold" size={64} style={{ letterSpacing: -2 }}>
            Paid!
          </Txt>
          <Txt weight="medium" size={22} style={{ textAlign: 'center' }} numberOfLines={2}>
            {price}
            {intent?.reference ? ` for ${intent.reference}` : ''}
          </Txt>
          <Txt size={15} color={colors.onTint}>
            ${usd} is in your settlement wallet.
          </Txt>
        </Rise>
        <View style={{ paddingHorizontal: 20 }}>
          <Sticker radius={26}>
            <View style={styles.stats}>
              <Stat label="Took" value={tookMs ? `${(tookMs / 1000).toFixed(1)}s` : '—'} />
              <Stat label="Card fees" value="$0.00" />
              <Stat
                label="Time"
                value={new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              />
            </View>
          </Sticker>
        </View>
        <View style={styles.footer}>
          <PillButton label="Next customer" onPress={next} />
        </View>
      </Screen>
    )

  if (status !== 'requires_payment' && status !== 'processing')
    return (
      <Screen bg={colors.sunken}>
        <View style={styles.center}>
          <KoviStage pose="oops" size={150} motion="bob" />
          <Txt weight="semi" size={30} style={{ marginTop: 12 }}>
            {status === 'expired' ? 'Nobody paid in time' : 'This charge stopped'}
          </Txt>
          <Txt
            size={16}
            color={colors.onTint}
            style={{ textAlign: 'center', marginTop: 8, lineHeight: 23 }}
          >
            {status === 'expired'
              ? 'No money moved. Start the charge again when the customer is ready.'
              : status === 'held'
                ? "The payment was stopped by the settlement wallet's receive rules. Check the shop's wallet."
                : 'No money moved. Start a new charge.'}
          </Txt>
        </View>
        <View style={styles.footer}>
          <PillButton label="New charge" onPress={next} />
        </View>
      </Screen>
    )

  if (tap.at === 'pin')
    return (
      <Screen bg={colors.paper}>
        <View style={styles.top}>
          <RoundButton icon="close" label="Cancel tap" onPress={() => setTap({ at: 'idle' })} />
          <Txt weight="semi" size={18}>
            Pay {shop.name}
          </Txt>
          <Chip label="Card •••" icon="tap" />
        </View>
        <View style={{ alignItems: 'center', marginTop: 24, paddingHorizontal: 24 }}>
          <Txt
            weight="bold"
            size={56}
            style={{ letterSpacing: -2 }}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {price}
          </Txt>
          <Txt weight="semi" size={24} style={{ marginTop: 8 }}>
            Enter your card PIN
          </Txt>
          <Txt size={15} color={colors.muted} style={{ marginTop: 4, textAlign: 'center' }}>
            Cover the keys while you type. Kova checks it; the shop never sees it.
          </Txt>
        </View>
        <View style={{ marginTop: 'auto', paddingBottom: 16 }}>
          <PinEntry
            value={tap.pin}
            length={4}
            max={6}
            error={tap.problem ?? null}
            onChange={(next) => {
              setTap({ ...tap, pin: next, problem: undefined })
              if (next.length === 4) void pay(tap.read, tap.signature, next)
            }}
          />
        </View>
      </Screen>
    )

  const qr = Math.min(width - 150, 240)
  return (
    <Screen bg={colors.tealSoft}>
      <View style={styles.top}>
        <RoundButton
          icon="close"
          label="Cancel charge"
          onPress={async () => {
            await cancelCharge(id).catch(() => {})
            next()
          }}
        />
        <Txt weight="semi" size={18}>
          Pay {shop.name}
        </Txt>
        <Chip label={status === 'processing' ? 'Confirming' : 'Waiting'} dot={colors.coral} />
      </View>
      <View style={styles.center}>
        <Txt
          weight="bold"
          size={64}
          style={{ letterSpacing: -2.5 }}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {price}
        </Txt>
        <Txt weight="medium" size={16} color={colors.onTint}>
          {price.startsWith('$') ? 'in dollars' : `$${usd}`}
          {intent?.reference ? `  ·  ${intent.reference}` : ''}
        </Txt>
        {/* Room above the code for Kovi's head, so he never covers what's being paid for. */}
        <View style={{ marginTop: 56 }}>
          <Sticker radius={34} style={{ width: qr + 52, height: qr + 52 }}>
            <View style={styles.qr}>
              <QRCode
                value={payLinkFor(id)}
                size={qr}
                color={palette.light.ink}
                backgroundColor={palette.light.surface}
                ecl="M"
              />
            </View>
          </Sticker>
          <View style={styles.peek} pointerEvents="none">
            <KoviPeek width={130} />
          </View>
        </View>
        <View style={styles.how}>
          <View style={styles.tapDisc}>
            <Ping size={40} color={colors.ink} />
            <Icon name="scan" size={18} color={colors.white} />
          </View>
          <Txt weight="medium" size={15}>
            Scan with Kova Pay or any phone camera
          </Txt>
        </View>
        {tap.at === 'idle' && tap.problem ? (
          <Txt
            weight="medium"
            size={15}
            color={colors.danger}
            style={{ textAlign: 'center', marginTop: 12 }}
          >
            {tap.problem}
          </Txt>
        ) : null}
      </View>
      <View style={[styles.footer, { alignItems: 'center', gap: 12 }]}>
        <View style={{ alignSelf: 'stretch' }}>
          <PillButton
            label={
              tap.at === 'paying'
                ? 'Paying…'
                : tap.at === 'reading'
                  ? 'Hold the card to the phone'
                  : 'Tap a Kova Card'
            }
            icon="tap"
            tone="white"
            loading={tap.at === 'reading' || tap.at === 'paying'}
            onPress={() => void tapCard()}
          />
        </View>
        <TextLink
          label="Cancel charge"
          onPress={async () => {
            await cancelCharge(id).catch(() => {})
            next()
          }}
        />
      </View>
    </Screen>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Txt size={13} color={colors.muted}>
        {label}
      </Txt>
      <Txt weight="semi" size={16}>
        {value}
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  qr: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  peek: { position: 'absolute', top: -65 * peekEdge + 1, right: 30 },
  how: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 22 },
  tapDisc: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.coral,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stats: { flexDirection: 'row', paddingVertical: 12 },
  footer: { paddingHorizontal: 20, paddingBottom: 16, paddingTop: 12, marginTop: 'auto' },
})
