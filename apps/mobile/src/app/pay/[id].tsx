import * as Haptics from 'expo-haptics'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native'
import { type Checkout, getCheckout, type OrderStatus } from '@/lib/api'
import { baseToNumber, formatLocal, formatUsd } from '@/lib/money'
import { usePrivate } from '@/lib/private'
import { useSessionCovers } from '@/lib/session'
import { colors } from '@/lib/theme'
import { type Entry, useWallet } from '@/lib/wallet'
import { useWatchedOrder, watchOrder } from '@/lib/watch'
import { Image } from 'expo-image'
import { Avatar, ShopBadge } from '@/ui/art'
import { Icon } from '@/ui/Icon'
import { Bob } from '@/ui/motion'
import { OrderProgress, progressCopy } from '@/ui/OrderProgress'
import { PaidScene } from '@/ui/PaidScene'
import { PayFrom, spendLabel, usePayFrom } from '@/ui/Private'
import { Stage as KoviStage } from '@/ui/Stage'
import { Chip, Header, PillButton, Rise, RoundButton, Screen, Sticker, TextLink, Txt } from '@/ui/primitives'

type Stage = 'loading' | 'review' | 'paying' | 'paid' | 'problem'

/** Paying a shop: see exactly what and to whom, approve (Face ID, unless the wallet is already open), and it's done. */
/** Development only: a dev link's charge is paid once per app run. */
let devPaid = false

export default function PayCharge() {
  // autopay is development-only: it presses Pay by itself, so a film can capture the real flow.
  // stamp=1: the order was placed with this wallet as its stamp-card payer, so it pays from the balance.
  const { id, autopay, stamp } = useLocalSearchParams<{ id: string; autopay?: string; stamp?: string }>()
  const { profile, balance, payCheckout } = useWallet()
  const dollars = usePrivate()
  const [stage, setStage] = useState<Stage>('loading')
  const [checkout, setCheckout] = useState<Checkout | null>(null)
  const [entry, setEntry] = useState<Entry | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  // Whether an open signing session will approve this without Face ID.
  const covered = useSessionCovers(checkout ? BigInt(checkout.amount_base) : 0n)
  // Once paid, a stall order is followed here: its progress stands in for the payment's stats.
  const tracked = useWatchedOrder(stage === 'paid' ? checkout?.id : undefined)

  useEffect(() => {
    getCheckout(id)
      .then((c) => {
        setCheckout(c)
        if (c.status === 'requires_payment') setStage('review')
        else {
          setProblem(
            c.status === 'paid'
              ? 'This charge has already been paid.'
              : c.status === 'expired'
                ? 'This charge expired. Ask the shop to show a new code.'
                : 'This charge is no longer open. Ask the shop to start it again.',
          )
          setStage('problem')
        }
      })
      .catch((error: Error) => {
        setProblem(error.message)
        setStage('problem')
      })
  }, [id])

  // Private dollars can pay any charge but a stamp-card reward (that's the card owner's wallet alone),
  // and an order already tied to this wallet's stamp card.
  const due = checkout ? BigInt(checkout.amount_base) : 0n
  const payFrom = usePayFrom(due, balance, Boolean(checkout && !checkout.order?.reward && due > 0n && stamp !== '1'))
  const fromPrivate = payFrom.source === 'private'

  const pay = async () => {
    if (!checkout) return
    setStage('paying')
    try {
      // From private dollars: one of your one-time addresses signs the payment, exactly as the wallet would.
      const done = fromPrivate
        ? await dollars.spendFrom(due, (account) => payCheckout(checkout, { signer: account }))
        : await payCheckout(checkout)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      // A stall order: follow it until the counter marks it ready, wherever the buyer goes next.
      watchOrder(checkout)
      setEntry(done)
      setStage('paid')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The payment did not go through.'
      if (/cancel/i.test(message)) setStage('review')
      else {
        setProblem(message)
        setStage('problem')
      }
    }
  }


  useEffect(() => {
    if (!__DEV__ || autopay !== '1' || stage !== 'review' || devPaid) return
    const timer = setTimeout(() => {
      if (devPaid) return
      devPaid = true
      void pay()
    }, 2600)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autopay, stage])

  if (stage === 'loading')
    return (
      <Screen bg={colors.tealSoft} style={styles.centered}>
        <ActivityIndicator color={colors.ink} />
      </Screen>
    )

  if (stage === 'problem' || !checkout)
    return (
      <Screen bg={colors.sunken}>
        <Header backIcon="close" onBack={() => router.replace('/(tabs)')} />
        <View style={styles.centered}>
          <KoviStage pose="oops" size={160} motion="bob" />
          <Txt weight="semi" size={28} style={styles.title}>
            Not this time
          </Txt>
          <Txt size={16} color={colors.onTint} style={styles.body}>
            {problem}
          </Txt>
        </View>
        <View style={styles.footer}>
          <PillButton label="Scan again" icon="scan" onPress={() => router.replace('/scan')} />
        </View>
      </Screen>
    )

  const amount = BigInt(checkout.amount_base)
  // Short of the balance, unless private dollars pay it.
  const short = balance !== null && balance < amount && !fromPrivate
  const reward = checkout.order?.reward ?? null
  // A full stamp card can make the whole order free: it's still approved, for $0, so it has a receipt.
  const free = amount === 0n && reward !== null

  if (stage === 'paid' && entry)
    return (
      <Screen bg={colors.sunken}>
        <View style={styles.paidTop}>
          <RoundButton icon="close" label="Close" onPress={() => router.replace('/(tabs)')} />
          <Txt weight="semi" size={18}>
            {checkout.merchant_name}
          </Txt>
          <Chip label="Paid" dot={colors.tealLight} />
        </View>
        <PaidScene amount={free ? 'Free' : formatUsd(amount)} height={330} />
        <Rise style={[styles.paidCopy, tracked && { marginBottom: 14 }]}>
          <Txt weight="bold" size={tracked ? 52 : 64} style={{ letterSpacing: -2 }}>
            {free ? 'It’s free!' : 'Paid!'}
          </Txt>
          <Txt weight="medium" size={tracked ? 19 : 22} style={{ textAlign: 'center' }}>
            {checkout.trip
              ? `${formatUsd(amount)} for ${checkout.trip.title}`
              : free && reward
                ? `${reward.name} from ${checkout.order?.stall?.name ?? checkout.merchant_name}, on your stamp card`
                : `${formatUsd(amount)} to ${checkout.order?.stall?.name ?? checkout.merchant_name}`}
          </Txt>
          {reward && !free ? (
            <Txt size={15} color={colors.onTint} style={{ textAlign: 'center' }}>
              {reward.name} was free with your stamp card
            </Txt>
          ) : null}
          {checkout.trip ? (
            <Txt size={15} color={colors.onTint} style={{ textAlign: 'center' }}>
              {checkout.trip.share === 'You' ? 'Kova is booking it now.' : `${checkout.trip.booked_by}’s trip gets booked once it’s all paid.`}
            </Txt>
          ) : null}
          {checkout.order?.pay_for_me && checkout.order.customer_name ? (
            <Txt size={15} color={colors.onTint}>
              for {checkout.order.customer_name}’s order
            </Txt>
          ) : null}
        </Rise>
        <View style={{ paddingHorizontal: 20 }}>
          {tracked ? (
            <Tracker status={tracked.status} table={tracked.table} />
          ) : (
            <Sticker radius={26}>
              <View style={styles.stats}>
                <Stat label="Took" value={entry.ms ? `${(entry.ms / 1000).toFixed(1)} seconds` : '—'} />
                <Stat label="Fee" value="$0.00" />
                {entry.fromPrivate ? (
                  <Stat label="From" value="Private dollars" />
                ) : (
                  <Stat label="Left" value={balance === null ? '—' : formatUsd(balance)} />
                )}
              </View>
            </Sticker>
          )}
        </View>
        <View style={[styles.footer, { gap: 14 }]}>
          <PillButton
            label="Done"
            icon="check"
            onPress={() => (checkout.trip?.share === 'You' && router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
          />
          <View style={{ alignItems: 'center' }}>
            <TextLink label="See receipt" onPress={() => router.replace({ pathname: '/receipt/[id]', params: { id: entry.id } })} />
          </View>
        </View>
      </Screen>
    )

  const order = checkout.order
  const trip = checkout.trip
  const place = trip ? trip.title : (order?.stall?.name ?? checkout.merchant_name)
  const askedBy = trip && trip.share !== 'You' ? trip.booked_by : order?.pay_for_me && order.customer_name ? order.customer_name : null
  const shown = order ? order.lines.slice(0, 4) : []
  const lead = trip
    ? trip.share === 'You'
      ? `You’re paying for your ${trip.kind === 'flight' ? 'flight' : 'stay'}`
      : trip.shares > 1
        ? `${trip.booked_by} split this ${trip.kind === 'flight' ? 'trip' : 'stay'} with you. Your share of`
        : `${trip.booked_by} asked you to pay for their ${trip.kind === 'flight' ? 'flight' : 'stay'}`
    : askedBy
      ? `${askedBy} asked you to pay for their order at`
      : free
        ? 'It’s on the house at'
        : 'You’re paying'
  return (
    <Screen bg={colors.tealSoft}>
      <Header backIcon="close" title="Confirm" onBack={() => router.replace('/(tabs)')} />
      <ScrollView contentContainerStyle={styles.review}>
        <Bob>
          {trip?.provider.image ? (
            <Image source={{ uri: trip.provider.image }} style={styles.tripArt} contentFit={trip.kind === 'flight' ? 'contain' : 'cover'} />
          ) : askedBy ? (
            <Avatar name={askedBy} size={88} />
          ) : (
            <ShopBadge size={order ? 80 : 96} />
          )}
        </Bob>
        <Txt size={18} style={{ marginTop: 16, textAlign: 'center' }}>
          {lead}
        </Txt>
        <Txt weight="semi" size={26} style={{ textAlign: 'center' }}>
          {place}
        </Txt>
        {trip ? (
          <Txt size={14} color={colors.onTint} style={{ textAlign: 'center', marginTop: 2 }}>
            {trip.subtitle}
          </Txt>
        ) : null}
        <Txt weight="bold" size={order ? 60 : 72} style={styles.amount} adjustsFontSizeToFit numberOfLines={1}>
          {free ? 'Free' : formatUsd(amount)}
        </Txt>
        {reward ? (
          <View style={styles.stampTag}>
            <Icon name="sparkle" size={15} />
            <Txt weight="semi" size={14}>
              {free ? 'Free with your stamp card' : `${reward.name} free with your stamp card`}
            </Txt>
          </View>
        ) : null}
        {profile && profile.currency !== 'USD' && !free ? (
          <Txt size={16} color={colors.onTint}>
            about {formatLocal(baseToNumber(amount), profile.currency)}
          </Txt>
        ) : null}
        {order ? (
          <View style={styles.order}>
            {shown.map((l) => (
              <View key={l.item_id} style={styles.orderLine}>
                <Txt weight="semi" size={15} style={{ width: 30 }}>
                  {l.quantity}×
                </Txt>
                <Txt weight="medium" size={15} style={{ flex: 1 }} numberOfLines={1}>
                  {l.name}
                </Txt>
                <Txt size={15} color={colors.muted}>
                  ${(Number(l.unit_price) * l.quantity).toFixed(2)}
                </Txt>
              </View>
            ))}
            {reward ? (
              <View style={styles.orderLine}>
                <View style={{ width: 30 }}>
                  <Icon name="sparkle" size={16} color={colors.tealDeep} />
                </View>
                <Txt weight="semi" size={15} color={colors.tealDeep} style={{ flex: 1 }} numberOfLines={1}>
                  Stamp card: {reward.name}
                </Txt>
                <Txt weight="semi" size={15} color={colors.tealDeep}>
                  −${Number(reward.amount).toFixed(2)}
                </Txt>
              </View>
            ) : null}
            {order.table ? (
              <Txt size={13} color={colors.onTint} style={{ marginTop: 4 }}>
                Brought to table {order.table}
              </Txt>
            ) : null}
            {order.lines.length > shown.length ? (
              <Txt size={13} color={colors.muted}>
                and {order.lines.length - shown.length} more
              </Txt>
            ) : null}
            {order.note ? (
              <Txt size={14} color={colors.onTint} style={{ marginTop: 4 }} numberOfLines={2}>
                “{order.note}”
              </Txt>
            ) : null}
          </View>
        ) : trip ? (
          <View style={styles.note}>
            <Txt weight="medium" size={15}>
              {trip.provider.name}. Pay by {new Date(trip.pay_by).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
            </Txt>
          </View>
        ) : checkout.reference ? (
          <View style={styles.note}>
            <Txt weight="medium" size={15}>
              {checkout.reference}
            </Txt>
          </View>
        ) : null}
      </ScrollView>
      <View style={{ paddingHorizontal: 20, gap: 10 }}>
        {payFrom.offered ? (
          <PayFrom amount={amount} balance={balance} source={payFrom.source} cover={payFrom.cover} onChange={payFrom.setSource} disabled={stage === 'paying'} />
        ) : null}
        <Sticker radius={24}>
          <View style={styles.lines}>
            {payFrom.offered ? null : <Line label="From" value={`Your wallet, ${balance === null ? '…' : formatUsd(balance)}`} />}
            <Line label="Fee" value="$0.00, Kova covers it" />
          </View>
        </Sticker>
        {fromPrivate && checkout.order?.stall ? (
          <Txt size={13} color={colors.onTint} style={{ textAlign: 'center' }}>
            Private payments don’t collect stamps.
          </Txt>
        ) : null}
        {short ? (
          <Txt weight="medium" size={15} color={colors.danger} style={{ marginTop: 12, textAlign: 'center' }}>
            You need {formatUsd(amount - (balance ?? 0n))} more. Add money first.
          </Txt>
        ) : null}
      </View>
      <View style={styles.footer}>
        {short ? (
          <PillButton label="Add money" icon="plus" onPress={() => router.push('/add-money')} />
        ) : (
          <>
            <PillButton
              label={spendLabel(dollars.spending) ?? (free ? 'Get it free' : fromPrivate ? `Pay ${formatUsd(amount)} privately` : `Pay ${formatUsd(amount)}`)}
              icon={fromPrivate ? 'lock' : covered ? 'bolt' : 'face'}
              loading={stage === 'paying'}
              onPress={pay}
            />
            {fromPrivate && dollars.problem?.during === 'spend' && stage === 'review' ? (
              <Txt weight="medium" size={13} color={colors.danger} style={{ textAlign: 'center', marginTop: 8 }}>
                {dollars.problem.text}
              </Txt>
            ) : null}
            {free ? (
              <Txt size={13} color={colors.muted} style={{ textAlign: 'center', marginTop: 8 }}>
                {covered ? 'Nothing to pay. Your wallet is open, so no Face ID either.' : 'Nothing to pay. Face ID confirms it’s your card.'}
              </Txt>
            ) : covered ? (
              <Txt size={13} color={colors.muted} style={{ textAlign: 'center', marginTop: 8 }}>
                Your wallet is open, so this one needs no Face ID.
              </Txt>
            ) : null}
          </>
        )}
      </View>
    </Screen>
  )
}

/** The buyer's buzzer: where the order is at the counter, live. */
function Tracker({ status, table }: { status: OrderStatus; table: string | null }) {
  const copy = progressCopy(status, table)
  return (
    <Sticker radius={26}>
      <View style={styles.trackerHead}>
        <View style={{ flex: 1 }}>
          <Txt weight="bold" size={17}>
            {copy.title}
          </Txt>
          <Txt size={13} color={colors.muted} style={{ lineHeight: 18 }}>
            {copy.body}
          </Txt>
        </View>
        {table ? (
          <View style={styles.tableTag}>
            <Txt weight="bold" size={13} color={colors.white}>
              Table {table}
            </Txt>
          </View>
        ) : null}
      </View>
      <View style={{ paddingHorizontal: 10, paddingBottom: 14 }}>
        <OrderProgress status={status} />
      </View>
    </Sticker>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Txt size={15} color={colors.muted}>
        {label}
      </Txt>
      <Txt weight="semi" size={15}>
        {value}
      </Txt>
    </View>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Txt size={13} color={colors.muted}>
        {label}
      </Txt>
      <Txt weight="semi" size={15} numberOfLines={1}>
        {value}
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  title: { marginTop: 16, letterSpacing: -0.6 },
  body: { textAlign: 'center', marginTop: 8, lineHeight: 23 },
  footer: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, marginTop: 'auto' },
  review: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 12 },
  order: {
    alignSelf: 'stretch',
    marginTop: 16,
    padding: 14,
    paddingVertical: 10,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    gap: 2,
  },
  orderLine: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3 },
  tripArt: { width: 96, height: 96, borderRadius: 28, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.white },
  amount: { letterSpacing: -2.5, marginTop: 8 },
  note: { marginTop: 14, paddingHorizontal: 14, height: 34, borderRadius: 17, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.ink, justifyContent: 'center' },
  lines: { paddingHorizontal: 18, paddingVertical: 6 },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  paidTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8 },
  paidCopy: { alignItems: 'center', marginTop: 4, marginBottom: 18, paddingHorizontal: 24 },
  stats: { flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 8 },
  stampTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.white,
    marginTop: 6,
  },
  trackerHead: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, paddingBottom: 12 },
  tableTag: { height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: colors.coral, borderWidth: 2, borderColor: colors.ink, justifyContent: 'center' },
})
