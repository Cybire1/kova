import * as Haptics from 'expo-haptics'
import { Image } from 'expo-image'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import {
  type ColorValue,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { formatUsd } from '@/lib/money'
import { type DollarCard, getDollarCard, setDollarCard } from '@/lib/partners'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { CardBrand } from '@/ui/CardBrand'
import { Icon, type IconName } from '@/ui/Icon'
import { NotYet, problemOf, SandboxNote, useMoney } from '@/ui/Money'
import { Header, PillButton, Screen, Txt } from '@/ui/primitives'

const cardArt = require('../../../assets/cards/coral.png')
const koviRide = require('../../../assets/art/kovi-ride.png')
const koviPeek = require('../../../assets/art/kovi-peek.png')

/**
 * The dollar card (Nuvion): a virtual USD card, topped up from the wallet, up to $50 a day.
 *
 * Where you are decides the screen: no card yet (what it is, then the ID check), the check with the
 * issuer, a check that didn't pass, or the card itself (balance, top up, details, freeze).
 */
export default function DollarCardScreen() {
  const { data, setData, problem, reload } = useMoney<DollarCard>(getDollarCard)
  useFocusEffect(
    useCallback(() => {
      void reload()
    }, [reload]),
  )

  if (!data)
    return (
      <Screen>
        <Header title="Dollar card" />
        <Txt size={15} color={colors.muted} style={{ marginTop: 40, textAlign: 'center' }}>
          {problem ?? 'Opening…'}
        </Txt>
      </Screen>
    )
  if (!data.live)
    return (
      <Screen>
        <Header title="Dollar card" />
        <ScrollView contentContainerStyle={styles.body}>
          <NotYet
            pose="ride"
            title="A dollar card for anywhere"
            lead="Subscriptions, flights, apps, anything online that takes a card. Fill it from your Kova balance in a tap."
            facts={[
              ['Top up from', 'Your Kova balance'],
              ['Up to', '$50 a day'],
              ['Freeze', 'One tap'],
              ['Card number', 'Shown only to you'],
            ]}
            feature="dollar_card"
            requested={data.requested}
            onRequested={() => setData({ ...data, requested: true })}
          />
        </ScrollView>
      </Screen>
    )
  if (data.stage === 'intro') return <Intro sandbox={data.sandbox} />
  if (data.stage === 'checking') return <Checking />
  if (data.stage === 'fix') return <TryAgain reason={data.reason ?? null} />
  return <CardHome data={data} onChange={setData} onRefresh={reload} />
}

function Intro({ sandbox }: { sandbox: boolean }) {
  return (
    <Screen bg={colors.coral} edges={['top']}>
      <Header />
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} bounces={false}>
        <View style={styles.introTop}>
          <Txt weight="bold" size={40} color={colors.dark} style={styles.introTitle}>
            {'Spend\ndollars\nanywhere.'}
          </Txt>
          <Image source={koviRide} style={styles.introKovi} contentFit="contain" />
          <Image source={cardArt} style={styles.introCard} contentFit="contain" />
        </View>
        <View style={styles.introBottom}>
          <View style={styles.stickers}>
            <Sticker label="Top up from Kova" />
            <Sticker label="Up to $50 a day" fill={colors.tealSoft} tilt={-2} />
            <Sticker label="Freeze in one tap" />
            <Sticker label="One ID check" fill={colors.coralSoft} tilt={1.5} />
          </View>
          {sandbox ? <SandboxNote text="Card sandbox: a test card, no money moves" /> : null}
          <View style={{ marginTop: 'auto', gap: 12 }}>
            <PillButton label="Get my card" onPress={() => router.push('/dollar-card/check')} />
            <Txt size={12} color={colors.muted} style={{ textAlign: 'center', lineHeight: 17 }}>
              {
                'Virtual card with our partner Nuvion. Kova covers the card fee.\nYour main balance stays in your wallet.'
              }
            </Txt>
          </View>
        </View>
      </ScrollView>
    </Screen>
  )
}

function Sticker({ label, fill, tilt = 0 }: { label: string; fill?: ColorValue; tilt?: number }) {
  return (
    <View
      style={[
        styles.sticker,
        { backgroundColor: fill ?? colors.surface, transform: [{ rotate: `${tilt}deg` }] },
      ]}
    >
      <Txt weight="semi" size={13}>
        {label}
      </Txt>
    </View>
  )
}

function Checking() {
  return (
    <Screen>
      <Header />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.checkArt}>
          <View style={styles.checkCard} />
          <Image source={koviPeek} style={styles.checkKovi} contentFit="contain" />
        </View>
        <Txt weight="bold" size={32} style={styles.title}>
          Checking your ID
        </Txt>
        <Txt size={15} color={colors.muted} style={styles.lead}>
          You can close Kova. Your card appears here the moment Nuvion is done.
        </Txt>
        <View style={styles.section}>
          <Step done label="Details sent" />
          <Step done label="ID photo sent" />
          <Step label="Nuvion checks it" now />
          <Step label="Your card is made" />
        </View>
        <View style={{ marginTop: 24 }}>
          <PillButton label="Back to home" icon="home" tone="white" onPress={() => router.back()} />
        </View>
        <Txt size={12} color={colors.muted} style={styles.fine}>
          If something doesn’t match, we’ll tell you what to fix.
        </Txt>
      </ScrollView>
    </Screen>
  )
}

function Step({ label, done, now }: { label: string; done?: boolean; now?: boolean }) {
  return (
    <View style={[styles.step, now && styles.stepNow]}>
      <View style={[styles.stepDot, done && styles.stepDone, now && styles.stepSpin]}>
        {done ? <Icon name="check" size={14} color={colors.white} /> : null}
      </View>
      <Txt weight={now ? 'bold' : 'semi'} size={15} color={done || now ? colors.ink : colors.muted}>
        {label}
      </Txt>
    </View>
  )
}

function TryAgain({ reason }: { reason: string | null }) {
  return (
    <Screen>
      <Header />
      <ScrollView contentContainerStyle={styles.body}>
        <Txt weight="bold" size={32} style={styles.title}>
          Your ID didn’t pass
        </Txt>
        <Txt size={15} color={colors.muted} style={styles.lead}>
          {reason
            ? `Nuvion said: ${reason}`
            : 'Nuvion couldn’t confirm your details from that photo.'}{' '}
          Check that your details match your ID exactly, then send a clearer photo.
        </Txt>
        <View style={{ marginTop: 28 }}>
          <PillButton label="Try again" onPress={() => router.push('/dollar-card/check')} />
        </View>
      </ScrollView>
    </Screen>
  )
}

function CardHome({
  data,
  onChange,
  onRefresh,
}: {
  data: DollarCard
  onChange: (d: DollarCard) => void
  onRefresh: () => Promise<void>
}) {
  const insets = useSafeAreaInsets()
  const [refreshing, setRefreshing] = useState(false)
  const refresh = async () => {
    setRefreshing(true)
    await onRefresh().catch(() => null)
    setRefreshing(false)
  }
  const { profile, signMessage } = useWallet()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const card = data.card
  if (!card) return null
  const cap = BigInt(data.daily_topup)
  const today = BigInt(data.topups?.today ?? '0')
  const left = BigInt(data.topups?.left ?? data.daily_topup)
  const blocks = 10
  const used = cap > 0n ? Number((today * BigInt(blocks)) / cap) : 0

  const freeze = async (frozen: boolean) => {
    if (!profile) return
    setBusy(true)
    setError(null)
    try {
      onChange(await setDollarCard(profile.address, signMessage, frozen))
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch (e) {
      setError(problemOf(e))
    } finally {
      setBusy(false)
    }
  }

  if (card.frozen)
    return (
      <Screen bg={colors.ice}>
        <Header />
        <ScrollView contentContainerStyle={styles.body}>
          <Txt weight="bold" size={32} style={styles.title}>
            Frozen
          </Txt>
          <Txt size={15} color={colors.iceInk} style={styles.lead}>
            Every payment is refused until you unfreeze it. Nothing leaves your card.
          </Txt>
          <View style={styles.frozenArt}>
            <View style={styles.frozenCard}>
              <Image source={cardArt} style={styles.frozenImage} contentFit="cover" />
              <View style={styles.frost} />
            </View>
            <View style={styles.flake}>
              <Icon name="snow" size={30} color={colors.white} />
            </View>
          </View>
          <View style={[styles.section, styles.safe]}>
            <View>
              <Txt weight="semi" size={12} color={colors.iceInk}>
                Safe on your card
              </Txt>
              <Txt weight="bold" size={24}>
                {card.balance === null ? '—' : formatUsd(BigInt(card.balance))}
              </Txt>
            </View>
            <Txt weight="semi" size={13} color={colors.iceInk}>
              •••• {card.last_four}
            </Txt>
          </View>
          {error ? <Problem text={error} /> : null}
          <View style={{ marginTop: 16 }}>
            <PillButton
              label={busy ? 'One moment…' : 'Unfreeze'}
              icon="snow"
              tone="coral"
              loading={busy}
              onPress={() => void freeze(false)}
            />
          </View>
        </ScrollView>
      </Screen>
    )

  return (
    <Screen bg={colors.paper} edges={['bottom']}>
      {/* Behind the list: pulling down shows more of the band's colour, never a gap above it. */}
      <View style={styles.bandBackdrop} />
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 32, backgroundColor: colors.paper }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.white}
          />
        }
      >
        <View style={[styles.band, { paddingTop: insets.top }]}>
          <Header
            title=""
            right={
              data.sandbox ? (
                <Txt weight="semi" size={12} color={colors.onInk}>
                  Sandbox
                </Txt>
              ) : null
            }
          />
          <View style={{ paddingHorizontal: 24 }}>
            <Txt weight="semi" size={13} color={colors.onInk}>
              Ready to spend
            </Txt>
            <Txt weight="bold" size={46} color={colors.white} style={{ letterSpacing: -1.4 }}>
              {card.balance === null ? '—' : formatUsd(BigInt(card.balance))}
            </Txt>
          </View>
        </View>
        <View style={styles.hero}>
          <View style={styles.tilt}>
            <Image source={cardArt} style={styles.heroCard} contentFit="contain" />
            <View style={styles.lastFour}>
              <Txt weight="bold" size={12} color={colors.white} style={{ letterSpacing: 1 }}>
                •••• {card.last_four}
              </Txt>
            </View>
            <View style={styles.brand}>
              <CardBrand brand={card.brand} width={34} />
            </View>
          </View>
          <View style={[styles.meter, styles.tiltSoft]}>
            <View style={styles.meterHead}>
              <Txt weight="bold" size={12}>
                Today’s top-ups
              </Txt>
              <Txt weight="semi" size={12} color={colors.muted}>
                {formatUsd(left)} left of {formatUsd(cap)}
              </Txt>
            </View>
            <View style={styles.blocks}>
              {Array.from({ length: blocks }, (_, i) => (
                <View
                  // biome-ignore lint/suspicious/noArrayIndexKey: ten fixed blocks of a meter
                  key={i}
                  style={[styles.block, i < used && styles.blockOn]}
                />
              ))}
            </View>
          </View>
        </View>
        {error ? <Problem text={error} /> : null}
        <View style={styles.actions}>
          <Action
            icon="plus"
            label="Top up"
            wide
            coral
            disabled={left === 0n}
            onPress={() => router.push('/dollar-card/top-up')}
          />
          <Action icon="eye" label="Details" onPress={() => router.push('/dollar-card/details')} />
          <Action
            icon="snow"
            label={busy ? '…' : 'Freeze'}
            disabled={busy}
            onPress={() => void freeze(true)}
          />
        </View>
        <View style={styles.activity}>
          {(data.activity ?? []).length === 0 ? (
            <Txt size={15} color={colors.muted}>
              Top-ups and card payments show up here.
            </Txt>
          ) : (
            (data.activity ?? []).map((a, i) => (
              <View key={a.id} style={[styles.row, i > 0 && styles.rule]}>
                <View
                  style={[
                    styles.rowIcon,
                    a.kind === 'topup' && { backgroundColor: colors.tealSoft },
                    a.kind === 'spend' && { backgroundColor: colors.fill },
                  ]}
                >
                  {a.kind === 'spend' ? (
                    <Txt weight="bold" size={15} color={colors.onFill}>
                      {a.title.slice(0, 1).toUpperCase()}
                    </Txt>
                  ) : (
                    <Icon name={a.kind === 'topup' ? 'up' : 'down'} size={16} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Txt weight="semi" size={15} numberOfLines={1}>
                    {a.title}
                  </Txt>
                  <Txt size={12} color={colors.muted}>
                    {when(a.at)}
                    {a.status === 'pending' ? ' · On its way' : ''}
                    {a.status === 'failed' ? ' · Declined' : ''}
                  </Txt>
                </View>
                <Txt
                  weight="bold"
                  size={15}
                  color={a.kind === 'spend' ? colors.ink : colors.positive}
                >
                  {formatUsd(BigInt(a.amount), { sign: true })}
                </Txt>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </Screen>
  )
}

function Action({
  icon,
  label,
  onPress,
  wide,
  coral,
  disabled,
}: {
  icon: IconName
  label: string
  onPress: () => void
  wide?: boolean
  coral?: boolean
  disabled?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        onPress()
      }}
      style={({ pressed }) => [
        styles.action,
        wide && { flex: 1.4 },
        coral && { backgroundColor: colors.coral },
        disabled && { opacity: 0.5 },
        pressed && { transform: [{ scale: 0.97 }] },
      ]}
    >
      <Icon name={icon} size={18} color={coral ? colors.dark : colors.ink} />
      <Txt weight="semi" size={15} color={coral ? colors.dark : colors.ink}>
        {label}
      </Txt>
    </Pressable>
  )
}

function Problem({ text }: { text: string }) {
  return (
    <Txt
      weight="medium"
      size={14}
      color={colors.danger}
      style={{ marginTop: 12, paddingHorizontal: 20 }}
    >
      {text}
    </Txt>
  )
}

function when(at: string) {
  const d = new Date(at)
  const today = new Date()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (d.toDateString() === today.toDateString()) return `Today · ${time}`
  const yesterday = new Date(today.getTime() - 86_400_000)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const styles = StyleSheet.create({
  body: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 32 },
  title: { letterSpacing: -1, marginTop: 8 },
  lead: { marginTop: 8, lineHeight: 21 },
  fine: { textAlign: 'center', marginTop: 12, lineHeight: 17 },
  section: {
    marginTop: 22,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    padding: 6,
  },
  introTop: { height: 400, borderBottomWidth: 2, borderColor: colors.line },
  introTitle: { marginTop: 4, marginLeft: 22, lineHeight: 39, letterSpacing: -1.2 },
  introKovi: { position: 'absolute', right: 4, top: 108, width: 140, height: 140 },
  introCard: {
    position: 'absolute',
    left: 52,
    top: 214,
    width: 282,
    height: 178,
    transform: [{ rotate: '-6deg' }],
  },
  introBottom: {
    flex: 1,
    backgroundColor: colors.paper,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 34,
  },
  stickers: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  sticker: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.line,
  },
  checkArt: { height: 220, marginTop: 10, alignItems: 'center' },
  checkCard: {
    position: 'absolute',
    top: 90,
    width: 284,
    height: 130,
    borderRadius: 20,
    borderWidth: 3,
    borderStyle: 'dashed',
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  checkKovi: { width: 240, height: 120 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, borderRadius: 16 },
  stepNow: { backgroundColor: colors.raised },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDone: { backgroundColor: colors.positive, borderColor: colors.positive },
  stepSpin: { borderColor: colors.coral, borderRightColor: colors.coralSoft, borderWidth: 3 },
  frozenArt: { height: 236, marginTop: 14, alignItems: 'center', justifyContent: 'center' },
  frozenCard: {
    width: 290,
    height: 183,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: colors.line,
    transform: [{ rotate: '-4deg' }],
  },
  frozenImage: { width: '100%', height: '100%', opacity: 0.45 },
  frost: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(225,231,250,0.62)' },
  flake: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.dark,
    borderWidth: 3,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  safe: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  bandBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 320,
    backgroundColor: colors.dark,
  },
  band: {
    backgroundColor: colors.dark,
    paddingBottom: 120,
    borderBottomLeftRadius: 44,
    borderBottomRightRadius: 44,
  },
  hero: { marginTop: -100, alignItems: 'center' },
  tilt: { transform: [{ rotate: '-4deg' }] },
  tiltSoft: { transform: [{ rotate: '-4deg' }] },
  heroCard: { width: 290, height: 183, borderRadius: 17 },
  brand: { position: 'absolute', right: 12, top: 10 },
  lastFour: {
    position: 'absolute',
    left: 14,
    top: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.dark,
  },
  meter: {
    width: 290,
    marginTop: 12,
    padding: 12,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  meterHead: { flexDirection: 'row', justifyContent: 'space-between' },
  blocks: { flexDirection: 'row', gap: 4, marginTop: 8 },
  block: { flex: 1, height: 12, borderRadius: 3, backgroundColor: colors.sunken },
  blockOn: { backgroundColor: colors.ink },
  actions: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginTop: 26 },
  action: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  activity: { paddingHorizontal: 20, marginTop: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  rule: { borderTopWidth: 2, borderColor: colors.sunken },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
