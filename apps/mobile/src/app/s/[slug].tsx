import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  getCheckout,
  getPublicStall,
  getStampCard,
  orderFromStall,
  type PlacedOrder,
  type PublicStall,
  payLinkFor,
  type StampCard,
} from '@/lib/api'
import { tableFrom } from '@/lib/links'
import { type DisplayCurrency, formatLocal } from '@/lib/money'
import { colors, fonts } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Awning } from '@/ui/Awning'
import { Coin, Kovi } from '@/ui/art'
import { Icon } from '@/ui/Icon'
import { usePaymentRoute } from '@/ui/Private'
import { PillButton, RoundButton, Screen, Txt } from '@/ui/primitives'
import { Stage as KoviStage } from '@/ui/Stage'
import { about, dollars, ItemFace, Stepper } from '@/ui/StallParts'

type Basket = Record<string, number>

/**
 * A stall, as a buyer sees it in Kova Pay: the sign, what's for sale with prices in your own
 * currency, a basket, and two ways to pay: now with Face ID, or by sending the bill to
 * someone who'll pay it from wherever they are.
 */
/** Development only: a dev link's bag fills once per app run, however often the screen mounts. */
let devBagFilled = false
let devOrderPlaced = false

export default function StallFront() {
  // bag, note and checkout are development-only: a dev link fills the bag and places the order, so a
  // film can capture every real screen of buying without anyone tapping.
  const {
    slug,
    bag,
    note: devNote,
    checkout,
    table: tableParam,
  } = useLocalSearchParams<{
    slug: string
    bag?: string
    note?: string
    checkout?: string
    /** From a table's own QR code: the order is brought to this table. */
    table?: string
  }>()
  const table = tableFrom(tableParam)
  const { width } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const { profile } = useWallet()
  const [stall, setStall] = useState<PublicStall | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [basket, setBasket] = useState<Basket>({})
  const [open, setOpen] = useState(false)
  const [card, setCard] = useState<StampCard | null>(null)
  const payer = profile?.address

  useEffect(() => {
    getPublicStall(slug)
      .then(setStall)
      .catch((error: Error) =>
        setProblem(
          /no such/i.test(error.message)
            ? 'This stall isn’t here. It may have closed for good.'
            : error.message,
        ),
      )
  }, [slug])

  useEffect(() => {
    if (!__DEV__ || !bag || !stall || devBagFilled) return
    devBagFilled = true
    const next: Basket = {}
    for (const part of bag.split(';')) {
      const [name, qty = '1'] = part.split('*')
      const item = stall.items.find((i) => i.name === name)
      if (item) next[item.id] = Number(qty)
    }
    setBasket(next)
    setTimeout(() => setOpen(true), 1200)
  }, [bag, stall])

  // The wallet is the stamp card: read it whenever the stall comes into view, so a stamp just
  // earned shows on the way back from paying.
  const loyalty = stall?.loyalty_every ?? null
  useFocusEffect(
    useCallback(() => {
      if (!loyalty || !payer) return
      getStampCard(slug, payer)
        .then(setCard)
        .catch(() => {})
    }, [slug, payer, loyalty]),
  )

  const currency = profile?.currency ?? 'USD'
  const lines = useMemo(
    () =>
      (stall?.items ?? []).flatMap((item) =>
        basket[item.id] ? [{ item, quantity: basket[item.id] as number }] : [],
      ),
    [stall, basket],
  )
  const count = lines.reduce((n, l) => n + l.quantity, 0)
  const subtotal =
    lines.reduce((sum, l) => sum + Math.round(Number(l.item.price) * 100) * l.quantity, 0) / 100
  // A full card: the cheapest item on this order is free, as Kova will price it.
  const free =
    card?.ready && card.every && lines.length
      ? lines.reduce((a, b) => (Number(b.item.price) < Number(a.item.price) ? b : a)).item
      : null
  const total = Math.max(0, Math.round((subtotal - (free ? Number(free.price) : 0)) * 100) / 100)
  const set = (id: string, quantity: number) =>
    setBasket((b) => ({ ...b, [id]: Math.max(0, Math.min(99, quantity)) }))
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'))

  if (!stall)
    return (
      <Screen bg={colors.paper}>
        <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
          <RoundButton icon="close" label="Close" onPress={close} />
        </View>
        <View style={styles.center}>
          {problem ? (
            <>
              <KoviStage pose="oops" size={150} motion="bob" />
              <Txt weight="semi" size={24} style={{ marginTop: 12 }}>
                Not this time
              </Txt>
              <Txt
                size={16}
                color={colors.muted}
                style={{ textAlign: 'center', marginTop: 6, lineHeight: 23 }}
              >
                {problem}
              </Txt>
            </>
          ) : (
            <ActivityIndicator color={colors.ink} />
          )}
        </View>
      </Screen>
    )

  const ordering = stall.open
  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}>
        <View style={{ height: insets.top + 62, overflow: 'hidden' }}>
          <Awning
            width={width}
            height={insets.top + 62}
            stripe={30}
            tone={stall.open ? 'coral' : 'teal'}
          />
        </View>
        <View style={styles.sign}>
          <Txt weight="bold" size={32} style={{ letterSpacing: -1.1, lineHeight: 36 }}>
            {stall.name}
          </Txt>
          {stall.tagline ? (
            <Txt size={16} color={colors.muted} style={{ marginTop: 4, lineHeight: 22 }}>
              {stall.tagline}
            </Txt>
          ) : null}
          <View style={styles.chips}>
            {table ? (
              <View
                style={[styles.chip, styles.tableChip]}
                accessibilityLabel={`Ordering for table ${table}`}
              >
                <Txt weight="bold" size={13} color={colors.white}>
                  Table {table}
                </Txt>
              </View>
            ) : null}
            <View
              style={[
                styles.chip,
                { backgroundColor: stall.open ? colors.tealSoft : colors.sunken },
              ]}
            >
              <View
                style={[styles.dot, { backgroundColor: stall.open ? colors.teal : colors.muted }]}
              />
              <Txt weight="semi" size={13}>
                {stall.open ? 'Open now' : 'Closed right now'}
              </Txt>
            </View>
            {stall.livemode ? null : (
              <View style={[styles.chip, { backgroundColor: colors.coralSoft }]}>
                <Txt weight="semi" size={13}>
                  Test dollars
                </Txt>
              </View>
            )}
            {stall.shop_name !== stall.name ? (
              <View style={styles.chip}>
                <Txt weight="semi" size={13}>
                  by {stall.shop_name}
                </Txt>
              </View>
            ) : null}
          </View>
          {stall.open ? null : (
            <Txt size={14} color={colors.muted} style={{ marginTop: 10 }}>
              You can look around. Ordering opens when they do.
            </Txt>
          )}
        </View>

        {card?.every && payer ? <StampCardFace card={card} free={free?.name ?? null} /> : null}

        {stall.items.length === 0 ? (
          <View style={styles.center}>
            <Kovi pose="sleep" size={140} />
            <Txt size={16} color={colors.muted}>
              Nothing on the menu yet. Check back soon.
            </Txt>
          </View>
        ) : (
          <View style={{ paddingHorizontal: 20, gap: 10, marginTop: 18 }}>
            {stall.items.map((item) => {
              const qty = basket[item.id] ?? 0
              const local = about(item.price, currency)
              return (
                <View
                  key={item.id}
                  style={[
                    styles.item,
                    qty > 0 && styles.itemIn,
                    item.sold_out && { opacity: 0.55 },
                  ]}
                >
                  <ItemFace item={item} size={64} radius={17} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt weight="semi" size={17} numberOfLines={2}>
                      {item.name}
                    </Txt>
                    {item.description ? (
                      <Txt
                        size={13}
                        color={colors.muted}
                        numberOfLines={2}
                        style={{ lineHeight: 18 }}
                      >
                        {item.description}
                      </Txt>
                    ) : null}
                    <Txt weight="bold" size={16} style={{ marginTop: 2 }}>
                      {dollars(item.price)}
                      {local ? (
                        <Txt size={13} color={colors.muted}>
                          {'  '}
                          {local}
                        </Txt>
                      ) : null}
                    </Txt>
                  </View>
                  {item.sold_out ? (
                    <View style={[styles.chip, { backgroundColor: colors.sunken }]}>
                      <Txt weight="semi" size={12}>
                        Sold out
                      </Txt>
                    </View>
                  ) : qty === 0 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Add ${item.name}`}
                      disabled={!ordering}
                      onPress={() => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                        set(item.id, 1)
                      }}
                      style={({ pressed }) => [
                        styles.add,
                        !ordering && { opacity: 0.35 },
                        pressed && { transform: [{ scale: 0.92 }] },
                      ]}
                    >
                      <Icon name="plus" size={22} color={colors.white} strokeWidth={2.6} />
                    </Pressable>
                  ) : (
                    <Stepper value={qty} name={item.name} onChange={(n) => set(item.id, n)} small />
                  )}
                </View>
              )
            })}
          </View>
        )}
        <Txt
          size={13}
          color={colors.muted}
          style={{ textAlign: 'center', marginTop: 22, paddingHorizontal: 32, lineHeight: 19 }}
        >
          You pay in dollars from your Kova wallet, with no card fees. Local prices are a guide at
          Kova’s reference rate.
        </Txt>
      </ScrollView>

      <View style={[styles.close, { top: insets.top + 8 }]}>
        <RoundButton icon="close" label="Close" fill={colors.surface} onPress={close} />
      </View>

      {count > 0 ? (
        <Animated.View
          entering={FadeInDown.springify().damping(16)}
          exiting={FadeOutDown}
          style={[styles.barWrap, { bottom: Math.max(insets.bottom, 16) }]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View basket, ${count} items, ${dollars(total)}`}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
              setOpen(true)
            }}
            style={({ pressed }) => [styles.bar, pressed && { transform: [{ scale: 0.98 }] }]}
          >
            <View style={styles.barCount}>
              <Txt weight="bold" size={15}>
                {count}
              </Txt>
            </View>
            <Txt weight="semi" size={17} color={colors.white} style={{ flex: 1 }}>
              View basket
            </Txt>
            <Txt weight="bold" size={17} color={colors.white}>
              {free && total === 0 ? 'Free' : dollars(total)}
            </Txt>
          </Pressable>
        </Animated.View>
      ) : null}

      <BasketSheet
        visible={open}
        stall={stall}
        lines={lines}
        subtotal={subtotal}
        total={total}
        free={free}
        card={card}
        table={table}
        payer={payer}
        currency={currency}
        defaultName={profile?.name.split(' ')[0] ?? ''}
        defaultNote={__DEV__ ? (devNote ?? '') : ''}
        autoPlace={__DEV__ && checkout === '1'}
        onQty={set}
        onClose={() => setOpen(false)}
        onPaid={() => setBasket({})}
      />
    </View>
  )
}

function BasketSheet({
  visible,
  stall,
  lines,
  subtotal,
  total,
  free,
  card,
  table,
  payer,
  currency,
  defaultName,
  defaultNote,
  autoPlace,
  onQty,
  onClose,
  onPaid,
}: {
  visible: boolean
  stall: PublicStall
  lines: { item: PublicStall['items'][number]; quantity: number }[]
  subtotal: number
  /** After the stamp card's free item. */
  total: number
  /** The item a full stamp card makes free on this order. */
  free: PublicStall['items'][number] | null
  card: StampCard | null
  table: string | undefined
  /** This wallet: it pays, so it earns the stamp. */
  payer: string | undefined
  currency: DisplayCurrency
  defaultName: string
  defaultNote: string
  /** Development only: place the order by itself, for a film. */
  autoPlace: boolean
  onQty: (id: string, quantity: number) => void
  onClose: () => void
  onPaid: () => void
}) {
  const insets = useSafeAreaInsets()
  const [name, setName] = useState(defaultName)
  const [note, setNote] = useState(defaultNote)
  const [busy, setBusy] = useState<'pay' | 'ask' | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [asked, setAsked] = useState<PlacedOrder | null>(null)
  // Paid from private dollars (the router's pick when the balance is short): the order isn't tied to
  // this wallet, so it collects no stamp. A free item on the card always pays from the wallet.
  const { balance } = useWallet()
  const totalBase = BigInt(Math.round(total * 1e6))
  const { route } = usePaymentRoute({ amount: totalBase, balance, direct: !free && totalBase > 0n })
  const privately = route.from === 'private'

  useEffect(() => {
    if (visible && lines.length === 0 && !asked) onClose()
  }, [visible, lines.length, asked, onClose])

  const place = async (payForMe: boolean) => {
    setBusy(payForMe ? 'ask' : 'pay')
    setProblem(null)
    try {
      const placed = await orderFromStall(stall.slug, {
        items: lines.map((l) => ({ id: l.item.id, quantity: l.quantity })),
        customer_name: name.trim() || undefined,
        note: note.trim() || undefined,
        pay_for_me: payForMe,
        table,
        // Paying yourself earns the stamp, and spends a full card. Someone else paying doesn't, and
        // nor does a private payment: the stamp would tie it to your wallet.
        payer: payForMe || privately ? undefined : payer,
      })
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      if (payForMe) setAsked(placed)
      else {
        onClose()
        onPaid()
        router.push({
          pathname: '/pay/[id]',
          params: {
            id: placed.checkout.id,
            ...(autoPlace ? { autopay: '1' } : {}),
            ...(!privately && payer && stall.loyalty_every ? { stamp: '1' } : {}),
          },
        })
      }
    } catch (error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setProblem(error instanceof Error ? error.message : 'The order didn’t go through. Try again.')
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    if (!autoPlace || !visible || lines.length === 0 || devOrderPlaced) return
    const timer = setTimeout(() => {
      if (devOrderPlaced) return
      devOrderPlaced = true
      void place(false)
    }, 2600)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlace, visible, lines.length])

  const dismiss = () => {
    if (asked) {
      setAsked(null)
      onPaid()
    }
    onClose()
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={dismiss}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          accessibilityLabel="Close"
          style={styles.backdrop}
          onPress={busy ? undefined : dismiss}
        />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.grip} />
          {asked ? (
            <AskedToPay stall={stall} placed={asked} onDone={dismiss} />
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingTop: 14 }}
            >
              <Txt weight="bold" size={26} style={{ letterSpacing: -0.6 }}>
                Your order
              </Txt>
              <Txt size={14} color={colors.muted}>
                from {stall.name}
                {table ? `, brought to table ${table}` : ''}
              </Txt>
              <View style={styles.basket}>
                {lines.map((l, i) => (
                  <View
                    key={l.item.id}
                    style={[styles.basketLine, i < lines.length - 1 && styles.rule]}
                  >
                    <Stepper
                      small
                      value={l.quantity}
                      name={l.item.name}
                      onChange={(n) => onQty(l.item.id, n)}
                    />
                    <Txt weight="semi" size={15} style={{ flex: 1 }} numberOfLines={2}>
                      {l.item.name}
                    </Txt>
                    <Txt weight="semi" size={15}>
                      {dollars(Number(l.item.price) * l.quantity)}
                    </Txt>
                  </View>
                ))}
                {free ? (
                  <View style={[styles.basketLine, styles.freeLine]}>
                    <View style={styles.freeStamp}>
                      <Icon name="sparkle" size={15} />
                    </View>
                    <Txt
                      weight="semi"
                      size={15}
                      color={colors.tealDeep}
                      style={{ flex: 1 }}
                      numberOfLines={2}
                    >
                      Stamp card: {free.name} free
                    </Txt>
                    <Txt weight="semi" size={15} color={colors.tealDeep}>
                      −{dollars(free.price)}
                    </Txt>
                  </View>
                ) : null}
                <View style={styles.totalRow}>
                  <View>
                    <Txt weight="semi" size={16}>
                      Total
                    </Txt>
                    {free ? (
                      <Txt
                        size={13}
                        color={colors.muted}
                        style={{ textDecorationLine: 'line-through' }}
                      >
                        {dollars(subtotal)}
                      </Txt>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Txt weight="bold" size={22}>
                      {free && total === 0 ? 'Free' : dollars(total)}
                    </Txt>
                    {currency !== 'USD' && total > 0 ? (
                      <Txt size={13} color={colors.muted}>
                        about {formatLocal(total, currency)}
                      </Txt>
                    ) : null}
                  </View>
                </View>
              </View>

              <Txt weight="semi" size={14} color={colors.muted} style={styles.label}>
                Your name{' '}
                <Txt size={13} color="#8C9799">
                  so they know it’s yours
                </Txt>
              </Txt>
              <TextInput
                value={name}
                onChangeText={setName}
                maxLength={60}
                placeholder="Sam"
                placeholderTextColor="#8C9799"
                style={styles.input}
              />
              <Txt weight="semi" size={14} color={colors.muted} style={styles.label}>
                A note{' '}
                <Txt size={13} color="#8C9799">
                  optional
                </Txt>
              </Txt>
              <TextInput
                value={note}
                onChangeText={setNote}
                maxLength={200}
                placeholder="Gift-wrap it, please"
                placeholderTextColor="#8C9799"
                style={styles.input}
              />

              {problem ? (
                <Txt
                  weight="medium"
                  size={14}
                  color={colors.danger}
                  style={{ marginTop: 12, textAlign: 'center' }}
                >
                  {problem}
                </Txt>
              ) : null}
              {card?.every && !free ? (
                <Txt size={13} color={colors.muted} style={{ marginTop: 12, marginLeft: 4 }}>
                  {privately
                    ? 'Paying from private dollars. Private payments don’t collect stamps.'
                    : `Paying for this earns a stamp: ${Math.min(card.stamps + 1, card.every)} of ${card.every}.`}
                </Txt>
              ) : null}
              <View style={{ gap: 10, marginTop: 16 }}>
                <PillButton
                  label={free && total === 0 ? 'Get it free' : `Pay ${dollars(total)}`}
                  icon="face"
                  loading={busy === 'pay'}
                  disabled={busy !== null || !stall.open}
                  onPress={() => void place(false)}
                />
                <PillButton
                  label="Ask someone else to pay"
                  icon="send"
                  tone="white"
                  loading={busy === 'ask'}
                  disabled={busy !== null || !stall.open}
                  onPress={() => void place(true)}
                />
              </View>
              {free ? (
                <Txt size={13} color={colors.muted} style={{ textAlign: 'center', marginTop: 10 }}>
                  The free {free.name} counts when you pay from your own wallet.
                </Txt>
              ) : null}
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

/**
 * The stamp card, and there's nothing to sign up for: the wallet that pays is the card. A coin
 * for each paid order, and the last circle is the free one.
 */
function StampCardFace({ card, free }: { card: StampCard; free: string | null }) {
  const every = card.every ?? 0
  const left = every - card.stamps
  const line = card.ready
    ? free
      ? `Your card is full. The ${free} on this order is free.`
      : 'Your card is full. The cheapest item on this order is free.'
    : card.stamps === 0
      ? `Pay with Kova and collect a stamp. After ${every}, the cheapest item on your next order is free.`
      : `${card.stamps} of ${every} stamps. ${left === 1 ? 'One more' : `${left} more`} and the next one has something free.`
  return (
    <View style={[styles.stampCard, card.ready && { backgroundColor: colors.coralSoft }]}>
      <View style={styles.stampHead}>
        <View style={{ flex: 1 }}>
          <Txt weight="bold" size={17}>
            {card.ready ? 'Something’s on the house' : 'Your stamp card'}
          </Txt>
          <Txt size={13} color={colors.onTint} style={{ marginTop: 2, lineHeight: 18 }}>
            {line}
          </Txt>
        </View>
        <Kovi pose={card.ready ? 'cheer' : 'wave'} size={card.ready ? 62 : 54} />
      </View>
      <View style={styles.stamps} accessibilityLabel={`${card.stamps} of ${every} stamps`}>
        {Array.from({ length: every }, (_, i) => i + 1).map((n) => (
          <View key={n} style={[styles.stamp, n <= card.stamps ? styles.stampOn : null]}>
            {n <= card.stamps ? <Coin size={22} /> : null}
          </View>
        ))}
        <View
          style={[styles.stamp, styles.stampFree, card.ready && { backgroundColor: colors.coral }]}
        >
          <Icon name="sparkle" size={14} color={card.ready ? colors.white : colors.ink} />
        </View>
      </View>
      <Txt size={12} color={colors.onTint} style={{ marginTop: 10 }}>
        No sign-up. Your Kova wallet is the card.
      </Txt>
    </View>
  )
}

/** The pay-for-me handoff: a link to send, and the moment it's paid. */
function AskedToPay({
  stall,
  placed,
  onDone,
}: {
  stall: PublicStall
  placed: PlacedOrder
  onDone: () => void
}) {
  const [paid, setPaid] = useState(false)
  const [copied, setCopied] = useState(false)
  const link = payLinkFor(placed.checkout.id)
  const message = `Can you pay for my order at ${stall.name}? It’s ${dollars(placed.checkout.amount)}, paid in dollars with Kova: ${link}`

  useEffect(() => {
    const id = setInterval(async () => {
      const latest = await getCheckout(placed.checkout.id).catch(() => null)
      if (latest?.status === 'paid') {
        clearInterval(id)
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        setPaid(true)
      }
    }, 2500)
    return () => clearInterval(id)
  }, [placed.checkout.id])

  if (paid)
    return (
      <View style={styles.asked}>
        <KoviStage pose="cheer" size={140} />
        <Txt weight="bold" size={28} style={{ letterSpacing: -0.8, marginTop: 8 }}>
          It’s paid
        </Txt>
        <Txt
          size={16}
          color={colors.muted}
          style={{ textAlign: 'center', marginTop: 4, lineHeight: 22 }}
        >
          Someone paid {dollars(placed.checkout.amount)} for your order. {stall.name} has it.
        </Txt>
        <View style={{ alignSelf: 'stretch', marginTop: 18 }}>
          <PillButton label="Done" icon="check" onPress={onDone} />
        </View>
      </View>
    )

  return (
    <View style={styles.asked}>
      <Kovi pose="ride" size={120} />
      <Txt weight="bold" size={26} style={{ letterSpacing: -0.6, textAlign: 'center' }}>
        Send it to whoever’s paying
      </Txt>
      <Txt
        size={15}
        color={colors.muted}
        style={{ textAlign: 'center', marginTop: 6, lineHeight: 21 }}
      >
        They can pay from anywhere with Kova or any Monad wallet. The link stays open for a day, and
        this updates when it’s paid.
      </Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Copy the payment link"
        onPress={async () => {
          await Clipboard.setStringAsync(link)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
        style={styles.linkPill}
      >
        <Icon name={copied ? 'check' : 'copy'} size={16} />
        <Txt weight="semi" size={14} numberOfLines={1} style={{ flexShrink: 1 }}>
          {copied ? 'Link copied' : link.replace(/^https?:\/\//, '')}
        </Txt>
      </Pressable>
      <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 16 }}>
        <PillButton
          label="Send on WhatsApp"
          icon="send"
          onPress={() => void Linking.openURL(`https://wa.me/?text=${encodeURIComponent(message)}`)}
        />
        <PillButton
          label="Share another way"
          icon="share"
          tone="white"
          onPress={() => void Share.share({ message })}
        />
      </View>
      <View style={styles.waiting}>
        <ActivityIndicator size="small" color={colors.muted} />
        <Txt size={14} color={colors.muted}>
          Waiting for their payment
        </Txt>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingTop: 30,
  },
  close: { position: 'absolute', left: 20 },
  sign: { paddingHorizontal: 20, paddingTop: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  tableChip: { backgroundColor: colors.coral, borderWidth: 2, borderColor: colors.ink },
  stampCard: {
    marginHorizontal: 20,
    marginTop: 16,
    padding: 14,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.tealSoft,
  },
  stampHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stamps: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  stamp: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: colors.ink,
    borderStyle: 'dashed',
    backgroundColor: 'rgba(255,255,255,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stampOn: { borderStyle: 'solid', backgroundColor: colors.white },
  stampFree: { borderStyle: 'solid', backgroundColor: colors.white },
  freeLine: { borderTopWidth: 1, borderColor: colors.sunken },
  freeStamp: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.tealSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 8,
    paddingRight: 10,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  itemIn: { backgroundColor: colors.white },
  add: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.coral,
    borderWidth: 2,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barWrap: { position: 'absolute', left: 20, right: 20 },
  bar: {
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingLeft: 8,
    paddingRight: 24,
  },
  barCount: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(11,26,29,0.32)' },
  sheet: {
    maxHeight: '88%',
    backgroundColor: colors.paper,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  grip: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(11,26,29,0.16)',
  },
  basket: {
    marginTop: 14,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
  },
  basketLine: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  rule: { borderBottomWidth: 1, borderColor: colors.sunken },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: 2,
    borderColor: colors.ink,
  },
  label: { marginTop: 16, marginBottom: 8, marginLeft: 4 },
  input: {
    height: 46,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.ink,
  },
  asked: { alignItems: 'center', paddingTop: 14, paddingBottom: 6 },
  linkPill: {
    marginTop: 14,
    maxWidth: '100%',
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 19,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
})
