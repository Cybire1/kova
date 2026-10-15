import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { Image } from 'expo-image'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getTrip, payLinkFor, type Trip, type TripShare } from '@/lib/api'
import { colors } from '@/lib/theme'
import { clock, day, useTravel } from '@/lib/travel'
import { Flyer, Kovi } from '@/ui/art'
import { Icon } from '@/ui/Icon'
import { Bob } from '@/ui/motion'
import { Header, PillButton, Screen, Txt } from '@/ui/primitives'
import { Stage as KoviStage } from '@/ui/Stage'
import { dollars } from '@/ui/StallParts'

/** "in 23 min" or "until Sat 14:00", for how long a trip can still be paid. */
function payWindow(iso: string) {
  const ms = Date.parse(iso) - Date.now()
  if (ms <= 0) return 'now'
  if (ms < 3_600_000) return `within ${Math.max(1, Math.round(ms / 60_000))} min`
  return `by ${new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`
}

/**
 * One trip, from paying to flying. While it waits for money it shows who still has to pay and
 * a link for each; once paid, Kova books it and it turns into a boarding pass or a hotel voucher.
 */
export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const insets = useSafeAreaInsets()
  const { tokenFor } = useTravel()
  const [trip, setTrip] = useState<Trip | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const booked = useRef(false)

  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      const token = await tokenFor(id)
      if (!token) return setProblem('This trip was booked on another phone.')
      try {
        const next = await getTrip(id, token)
        if (!live) return
        setTrip(next)
        if (next.status === 'booked' && !booked.current) {
          booked.current = true
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        }
        if (next.status === 'awaiting_payment' || next.status === 'booking')
          timer = setTimeout(load, 3000)
      } catch (error) {
        if (live) setProblem(error instanceof Error ? error.message : 'Kova is unreachable.')
      }
    }
    void load()
    return () => {
      live = false
      if (timer) clearTimeout(timer)
    }
  }, [id, tokenFor])

  const close = () => (router.canGoBack() ? router.back() : router.replace('/travel'))

  if (!trip)
    return (
      <Screen bg={colors.paper}>
        <Header backIcon="close" onBack={close} />
        <View style={styles.center}>
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
        </View>
      </Screen>
    )

  return (
    <Screen bg={trip.status === 'booked' ? colors.tealSoft : colors.paper}>
      <Header
        title={trip.summary.title}
        subtitle={trip.summary.subtitle}
        backIcon="close"
        onBack={close}
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 30 }}
      >
        {trip.test_mode ? (
          <View style={styles.test}>
            <Icon name="info" size={15} />
            <Txt size={13} style={{ flex: 1 }}>
              Test mode: booked with Duffel’s sandbox, not a real{' '}
              {trip.kind === 'flight' ? 'airline' : 'hotel'}.
            </Txt>
          </View>
        ) : null}
        {trip.status === 'awaiting_payment' ? <Paying trip={trip} /> : null}
        {trip.status === 'booking' ? (
          <View style={styles.center}>
            <Bob distance={10}>
              {trip.kind === 'flight' ? <Flyer size={160} /> : <Kovi pose="key" size={150} />}
            </Bob>
            <Txt weight="bold" size={26} style={{ marginTop: 12, letterSpacing: -0.6 }}>
              Paid. Booking it now
            </Txt>
            <Txt size={15} color={colors.muted} style={{ marginTop: 4, textAlign: 'center' }}>
              {trip.kind === 'flight'
                ? 'The airline issues the ticket in a moment.'
                : 'The hotel confirms in a moment.'}
            </Txt>
          </View>
        ) : null}
        {trip.status === 'booked' ? (
          trip.kind === 'flight' ? (
            <BoardingPass trip={trip} />
          ) : (
            <Voucher trip={trip} />
          )
        ) : null}
        {trip.status === 'failed' || trip.status === 'expired' || trip.status === 'canceled' ? (
          <View style={styles.center}>
            <KoviStage pose="oops" size={140} motion="bob" />
            <Txt weight="bold" size={24} style={{ marginTop: 10 }}>
              {trip.status === 'expired' ? 'The price ran out' : 'It wasn’t booked'}
            </Txt>
            <Txt
              size={15}
              color={colors.muted}
              style={{ marginTop: 6, textAlign: 'center', lineHeight: 22 }}
            >
              {trip.status === 'expired'
                ? 'It wasn’t fully paid in time, so nothing was booked. Anything already paid goes back to whoever paid it.'
                : `${trip.failure ?? 'The booking didn’t go through.'} Nothing was booked, and what was paid goes back to whoever paid it.`}
            </Txt>
            <View style={{ alignSelf: 'stretch', marginTop: 18 }}>
              <PillButton
                label="Search again"
                icon="arrow"
                onPress={() => router.replace('/travel')}
              />
            </View>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  )
}

/** Who has paid and who hasn't, with a way to pay your own share or send the others theirs. */
function Paying({ trip }: { trip: Trip }) {
  const paid = trip.shares.filter((s) => s.status === 'paid').length
  return (
    <>
      <View style={styles.status}>
        <Image
          source={trip.summary.provider.image ? { uri: trip.summary.provider.image } : undefined}
          style={styles.provider}
          contentFit={trip.kind === 'flight' ? 'contain' : 'cover'}
        />
        <View style={{ flex: 1 }}>
          <Txt weight="bold" size={22} style={{ letterSpacing: -0.5 }}>
            {trip.shares.length > 1
              ? `${paid} of ${trip.shares.length} paid`
              : 'Waiting for payment'}
          </Txt>
          <Txt size={14} color={colors.muted}>
            {trip.held ? 'The airline is holding the fare. ' : ''}Pay {payWindow(trip.pay_by)}.
          </Txt>
        </View>
      </View>
      <View style={styles.total}>
        <Txt size={14} color={colors.muted}>
          Total
        </Txt>
        <Txt weight="bold" size={30} style={{ letterSpacing: -1 }}>
          {dollars(trip.amount)}
        </Txt>
        {trip.fare.currency !== 'USD' ? (
          <Txt size={13} color={colors.muted}>
            The fare is {trip.fare.currency}{' '}
            {Number(trip.fare.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}, in
            dollars at Kova’s reference rate
          </Txt>
        ) : null}
      </View>
      {trip.shares.map((share) => (
        <ShareRow key={share.label} share={share} trip={trip} />
      ))}
    </>
  )
}

function ShareRow({ share, trip }: { share: TripShare; trip: Trip }) {
  const [copied, setCopied] = useState(false)
  const done = share.status === 'paid'
  const mine = share.label === 'You'
  const link = share.checkout ? payLinkFor(share.checkout) : ''
  const message =
    trip.shares.length > 1
      ? `Your share of ${trip.summary.title} is ${dollars(share.amount)}. Pay it in dollars with Kova: ${link}`
      : `Can you pay for my ${trip.kind === 'flight' ? 'flight' : 'hotel'}, ${trip.summary.title}? It’s ${dollars(share.amount)}, paid in dollars with Kova: ${link}`
  return (
    <View style={[styles.share, done && styles.shareDone]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={[styles.shareDot, done && { backgroundColor: colors.teal }]}>
          {done ? <Icon name="check" size={16} color={colors.white} strokeWidth={2.6} /> : null}
        </View>
        <View style={{ flex: 1 }}>
          <Txt weight="semi" size={16}>
            {mine ? 'Your share' : share.label}
          </Txt>
          <Txt size={13} color={colors.muted}>
            {done ? 'Paid' : 'Not paid yet'}
          </Txt>
        </View>
        <Txt weight="bold" size={18}>
          {dollars(share.amount)}
        </Txt>
      </View>
      {!done && share.checkout ? (
        mine ? (
          <View style={{ marginTop: 12 }}>
            <PillButton
              label={`Pay ${dollars(share.amount)}`}
              icon="face"
              onPress={() =>
                router.push({ pathname: '/pay/[id]', params: { id: share.checkout ?? '' } })
              }
            />
          </View>
        ) : (
          <View style={styles.shareActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                void Linking.openURL(`https://wa.me/?text=${encodeURIComponent(message)}`)
              }
              style={[styles.shareButton, { backgroundColor: colors.coral }]}
            >
              <Icon name="whatsapp" size={16} />
              <Txt weight="semi" size={14}>
                WhatsApp
              </Txt>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void Share.share({ message })}
              style={styles.shareButton}
            >
              <Icon name="share" size={16} />
              <Txt weight="semi" size={14}>
                Share
              </Txt>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy the link"
              onPress={async () => {
                await Clipboard.setStringAsync(link)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
              style={styles.shareButton}
            >
              <Icon name={copied ? 'check' : 'copy'} size={16} />
              <Txt weight="semi" size={14}>
                {copied ? 'Copied' : 'Copy'}
              </Txt>
            </Pressable>
          </View>
        )
      ) : null}
    </View>
  )
}

/** The ticket: one pass per direction, torn along a perforation, with the booking reference. */
function BoardingPass({ trip }: { trip: Trip }) {
  return (
    <>
      <View style={styles.bookedHead}>
        <Kovi pose="cheer" size={90} />
        <View style={{ flex: 1 }}>
          <Txt weight="bold" size={26} style={{ letterSpacing: -0.8 }}>
            You’re booked
          </Txt>
          <Txt size={14} color={colors.onTint}>
            Paid in dollars. The airline has your ticket.
          </Txt>
        </View>
      </View>
      {trip.summary.legs.map((leg, i) => {
        const [fromCity, fromCode] = /^(.*) \((\w{3})\)$/.exec(leg.from)?.slice(1) ?? [leg.from, '']
        const [toCity, toCode] = /^(.*) \((\w{3})\)$/.exec(leg.to)?.slice(1) ?? [leg.to, '']
        return (
          <View key={`${leg.departs}${i}`} style={styles.pass}>
            <View style={styles.passTop}>
              <View style={styles.passLogo}>
                {trip.summary.provider.image ? (
                  <Image
                    source={{ uri: trip.summary.provider.image }}
                    style={{ width: 24, height: 24 }}
                    contentFit="contain"
                  />
                ) : (
                  <Icon name="send" size={14} />
                )}
              </View>
              <Txt weight="semi" size={14} color={colors.onInk} style={{ flex: 1 }}>
                {leg.carrier ?? trip.summary.provider.name}, {leg.flight}
              </Txt>
              <Txt weight="semi" size={13} color={colors.onInk}>
                {day(leg.departs)}
              </Txt>
            </View>
            <View style={styles.route}>
              <View>
                <Txt weight="bold" size={44} color={colors.white} style={{ letterSpacing: -1 }}>
                  {fromCode}
                </Txt>
                <Txt size={13} color={colors.onInk}>
                  {fromCity}
                </Txt>
                <Txt weight="bold" size={18} color={colors.white} style={{ marginTop: 6 }}>
                  {clock(leg.departs)}
                </Txt>
              </View>
              <View style={{ alignItems: 'center', gap: 4 }}>
                <Icon name="send" size={22} color={colors.coral} />
                <Txt size={12} color={colors.onInk}>
                  {leg.duration ?? ''}
                </Txt>
                <Txt size={12} color={colors.onInk}>
                  {leg.stops === 0 ? 'Non-stop' : `${leg.stops} stop${leg.stops > 1 ? 's' : ''}`}
                </Txt>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Txt weight="bold" size={44} color={colors.white} style={{ letterSpacing: -1 }}>
                  {toCode}
                </Txt>
                <Txt size={13} color={colors.onInk}>
                  {toCity}
                </Txt>
                <Txt weight="bold" size={18} color={colors.white} style={{ marginTop: 6 }}>
                  {clock(leg.arrives)}
                </Txt>
              </View>
            </View>
            <View style={styles.tear} pointerEvents="none">
              <View style={[styles.notch, { left: -13 }]} />
              <View style={styles.perforation} />
              <View style={[styles.notch, { right: -13 }]} />
            </View>
            <View style={styles.passBottom}>
              <View style={{ flex: 1, gap: 8 }}>
                <View>
                  <Txt size={12} color={colors.onInk}>
                    Booking reference
                  </Txt>
                  <Txt weight="bold" size={26} color={colors.white} style={{ letterSpacing: 3 }}>
                    {trip.booking_reference ?? '······'}
                  </Txt>
                </View>
                <Txt size={13} color={colors.onInk} numberOfLines={2}>
                  {trip.travellers.join(', ')}
                </Txt>
                {trip.summary.extras.length ? (
                  <Txt size={13} color={colors.onInk} numberOfLines={2}>
                    {trip.summary.extras.join(', ')}
                  </Txt>
                ) : null}
              </View>
              {trip.booking_reference ? (
                <View style={styles.qr}>
                  <QRCode
                    value={trip.booking_reference}
                    size={78}
                    color={colors.ink}
                    backgroundColor={colors.surface}
                  />
                </View>
              ) : null}
            </View>
          </View>
        )
      })}
    </>
  )
}

/** The hotel booking, ready to show at the front desk. */
function Voucher({ trip }: { trip: Trip }) {
  const leg = trip.summary.legs[0]
  return (
    <>
      <View style={styles.bookedHead}>
        <Kovi pose="cheer" size={90} />
        <View style={{ flex: 1 }}>
          <Txt weight="bold" size={26} style={{ letterSpacing: -0.8 }}>
            You’re booked
          </Txt>
          <Txt size={14} color={colors.onTint}>
            Paid in dollars. Show this at check-in.
          </Txt>
        </View>
      </View>
      <View style={styles.voucher}>
        {trip.summary.provider.image ? (
          <Image
            source={{ uri: trip.summary.provider.image }}
            style={styles.voucherPhoto}
            contentFit="cover"
          />
        ) : null}
        <View style={{ padding: 16, gap: 10 }}>
          <Txt weight="bold" size={22} style={{ letterSpacing: -0.5 }}>
            {trip.summary.title}
          </Txt>
          <View style={styles.voucherDates}>
            <View>
              <Txt size={12} color={colors.muted}>
                Check in
              </Txt>
              <Txt weight="bold" size={17}>
                {day(leg?.departs)}
              </Txt>
            </View>
            <Icon name="arrow" size={20} />
            <View style={{ alignItems: 'flex-end' }}>
              <Txt size={12} color={colors.muted}>
                Check out
              </Txt>
              <Txt weight="bold" size={17}>
                {day(leg?.arrives)}
              </Txt>
            </View>
          </View>
          {trip.summary.room ? (
            <Txt size={14} color={colors.muted}>
              {trip.summary.room.name}, {trip.summary.room.board}. {trip.summary.room.cancellation}.
            </Txt>
          ) : null}
          <Txt size={14} color={colors.muted}>
            {trip.travellers.join(', ')}
          </Txt>
          <View style={styles.voucherRef}>
            <View style={{ flex: 1 }}>
              <Txt size={12} color={colors.muted}>
                Booking reference
              </Txt>
              <Txt weight="bold" size={22} style={{ letterSpacing: 2 }}>
                {trip.booking_reference}
              </Txt>
            </View>
            {trip.booking_reference ? (
              <QRCode
                value={trip.booking_reference}
                size={70}
                color={colors.ink}
                backgroundColor={colors.surface}
              />
            ) : null}
          </View>
        </View>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  test: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    padding: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: colors.coralSoft,
    marginBottom: 12,
  },
  status: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 4 },
  provider: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.ink,
  },
  total: {
    marginTop: 16,
    marginBottom: 14,
    padding: 16,
    borderRadius: 24,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.ink,
    gap: 2,
  },
  share: {
    marginBottom: 10,
    padding: 14,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  shareDone: { backgroundColor: colors.tealSoft },
  shareDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  shareButton: {
    flex: 1,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  bookedHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  pass: { marginBottom: 14, borderRadius: 28, backgroundColor: colors.ink, overflow: 'hidden' },
  passTop: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, paddingBottom: 6 },
  passLogo: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  route: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 10,
  },
  tear: { height: 26, justifyContent: 'center' },
  notch: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.tealSoft,
  },
  perforation: {
    marginHorizontal: 22,
    borderTopWidth: 2,
    borderColor: 'rgba(255,255,255,0.22)',
    borderStyle: 'dashed',
  },
  passBottom: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, paddingTop: 10 },
  qr: { padding: 8, borderRadius: 14, backgroundColor: colors.surface },
  voucher: {
    borderRadius: 28,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  voucherPhoto: { height: 160, borderBottomWidth: 2, borderColor: colors.ink },
  voucherDates: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 18,
    backgroundColor: colors.paper,
  },
  voucherRef: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: colors.sunken,
  },
})
