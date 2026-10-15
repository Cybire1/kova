import * as Haptics from 'expo-haptics'
import { Redirect, router, useLocalSearchParams } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import { useReducedMotion } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { baseToNumber, formatLocal, formatUsd } from '@/lib/money'
import { explainedKey } from '@/lib/private'
import { load, save } from '@/lib/storage'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { beats, DecodedNote, OnBeat, PeekingKovi, SealedEnvelope, SlideUp } from '@/ui/Arrival'
import { when } from '@/ui/EntryRow'
import { Icon } from '@/ui/Icon'
import { NoteSlip } from '@/ui/LinkParts'
import { Burst, CoinRain, PopIn } from '@/ui/motion'
import { PrivateNote } from '@/ui/PrivateNote'
import { Chip, Header, PillButton, Rise, Screen, Sticker, Txt } from '@/ui/primitives'
import { Stage } from '@/ui/Stage'

/**
 * Money arrived: coins rain, Kovi catches them, and the amount is the headline. Sent privately, it's
 * a moment of its own (PrivateArrival): a sealed envelope opens for you, the note decodes, and it's
 * in your balance, nothing to do.
 */
export default function Received() {
  const params = useLocalSearchParams<{
    amount: string
    name: string
    hash?: string
    note?: string
    via?: string
    private?: string
    oneTime?: string
    unconfirmed?: string
  }>()
  // Claimed from a link: their note was written on the link, not sealed for you.
  const byLink = params.via === 'link'
  const privately = params.private === '1'
  const unconfirmed = params.unconfirmed === '1'
  const { profile, contacts, activity } = useWallet()
  const { width } = useWindowDimensions()
  // Opened without an arrival (a stale link, a relaunch): show the latest money in instead.
  const latest = params.amount ? null : activity.find((e) => e.kind === 'received')
  const amount = params.amount ?? latest?.amount
  const name = params.name || latest?.name || 'Someone'
  const note = params.note || (latest?.private ? latest.detail : undefined)
  const base = BigInt(amount ?? '0')
  const known = contacts.find((c) => c.name === name)

  if (!amount || base === 0n) return <Redirect href="/" />

  if (privately)
    return <PrivateArrival amount={base} name={name} note={note} unconfirmed={unconfirmed} />

  return (
    <Screen bg={colors.tealSoft}>
      <Header
        backIcon="close"
        onBack={() => router.back()}
        right={<Chip label={latest ? when(latest.at) : 'Just now'} dot={colors.tealLight} />}
      />
      <View style={{ height: 320 }}>
        <CoinRain width={width} height={320} />
        <View style={[styles.catch, { left: width / 2 - 100 }]}>
          <PopIn delay={250} style={styles.bubble}>
            <Txt weight="bold" size={18}>
              Yay! {formatUsd(base, { sign: true })}
            </Txt>
            <View style={styles.bubbleTail} />
          </PopIn>
          <Stage pose="catch" size={200} />
        </View>
        <Burst
          spots={[
            { x: width / 2 - 118, y: 150, size: 24, fill: colors.white, delay: 300 },
            { x: width / 2 + 116, y: 170, size: 28, fill: colors.yellow, delay: 450 },
            { x: width / 2 - 90, y: 290, size: 18, fill: colors.yellow, delay: 600 },
            { x: width / 2 + 92, y: 292, size: 20, fill: colors.white, delay: 750 },
          ]}
        />
      </View>
      <Rise style={styles.copy}>
        <Txt weight="medium" size={20}>
          {name} {byLink ? 'sent you' : 'paid you'}
        </Txt>
        <Txt
          weight="bold"
          size={64}
          style={{ letterSpacing: -2.5 }}
          adjustsFontSizeToFit
          numberOfLines={1}
        >
          {formatUsd(base, { sign: true })}
        </Txt>
        {profile && profile.currency !== 'USD' ? (
          <Txt size={16} color={colors.onTint}>
            about {formatLocal(baseToNumber(base), profile.currency)}, added to your balance
          </Txt>
        ) : (
          <Txt size={16} color={colors.onTint}>
            Added to your balance
          </Txt>
        )}
      </Rise>
      {note && byLink ? (
        <View style={{ marginTop: 22 }}>
          <NoteSlip text={note} caption={`From ${name.split(' ')[0]}, with the link`} />
        </View>
      ) : note ? (
        <View style={{ marginTop: 22 }}>
          <PrivateNote
            text={note}
            caption={`From ${name.split(' ')[0]}. Sealed by them; only you two can read it.`}
          />
        </View>
      ) : (
        <View style={{ paddingHorizontal: 20, marginTop: 24 }}>
          <Sticker radius={24} style={{ height: 66 }}>
            <View style={styles.row}>
              <Txt size={15} color={colors.muted}>
                Arrived
              </Txt>
              <Txt weight="semi" size={15}>
                {byLink ? 'From a link, in about a second' : 'On Monad, final in under a second'}
              </Txt>
            </View>
          </Sticker>
        </View>
      )}
      <View style={styles.footer}>
        {known ? (
          <PillButton
            label={name.startsWith('0x') ? 'Send some back' : `Say thanks to ${name.split(' ')[0]}`}
            icon="send"
            onPress={() =>
              router.replace({
                pathname: '/send/[to]',
                params: { to: known.address, name: known.name },
              })
            }
          />
        ) : (
          <PillButton label="Done" icon="check" onPress={() => router.back()} />
        )}
      </View>
    </Screen>
  )
}

/**
 * A private payment, arriving: one full-screen moment on ink. The envelope breaks its seal and
 * opens (a tap of the phone as it does), the card with the amount rises out, the sender's note
 * decodes, and Kovi peeks over the edge to whisper it. It's already in the balance: one button,
 * Done. The very first one on a wallet says, once, what makes it private.
 */
function PrivateArrival({
  amount,
  name,
  note,
  unconfirmed,
}: {
  amount: bigint
  name: string
  note?: string
  unconfirmed: boolean
}) {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const still = useReducedMotion()
  const { profile } = useWallet()
  const [stage, setStage] = useState<{ width: number; height: number } | null>(null)
  /** The first private payment this wallet has seen arrive: explained once, never again. */
  const [explain, setExplain] = useState(false)
  const first = name.startsWith('0x') ? 'they' : (name.split(' ')[0] ?? name)
  const address = profile?.address

  useEffect(() => {
    if (!address) return
    let live = true
    void load<boolean>(explainedKey(address), false).then((seen) => {
      if (!live || seen) return
      setExplain(true)
      void save(explainedKey(address), true)
    })
    return () => {
      live = false
    }
  }, [address])

  // The phone answers as the envelope opens.
  useEffect(() => {
    const timer = setTimeout(
      () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
      still ? 120 : beats.open + 90,
    )
    return () => clearTimeout(timer)
  }, [still])

  const usd = formatUsd(amount)
  const envelope = stage
    ? Math.max(150, Math.min(272, stage.width - 96, (stage.height - 16) / 0.98))
    : 0

  return (
    <View style={[styles.privateScreen, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.privateTop}>
        <View style={styles.privateTag}>
          <Icon name="lock" size={13} color={colors.white} strokeWidth={2.4} />
          <Txt weight="semi" size={13} color={colors.white}>
            Private · just now
          </Txt>
        </View>
      </View>
      <View
        style={styles.privateStage}
        onLayout={(e) =>
          setStage({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
        }
      >
        {envelope ? (
          <SealedEnvelope
            width={envelope}
            amount={usd}
            from={name}
            to={profile?.name.split(' ')[0]}
          />
        ) : null}
      </View>
      <PeekingKovi width={Math.min(164, width * 0.42)} whisper="Psst… just for you" />
      <SlideUp
        at={beats.open}
        style={[styles.privateSheet, { paddingBottom: Math.max(insets.bottom, 12) + 4 }]}
      >
        <OnBeat at={beats.copy}>
          <Txt weight="bold" size={26} style={{ letterSpacing: -0.7, lineHeight: 31 }}>
            {name} sent you {usd}, privately
          </Txt>
          {unconfirmed ? (
            <Txt size={13} color={colors.coralDeep} style={{ marginTop: 2 }}>
              Unconfirmed: only their sealed note says it’s them
            </Txt>
          ) : null}
        </OnBeat>
        {note ? (
          <OnBeat at={beats.note - 160} style={{ marginTop: 6 }}>
            <DecodedNote
              text={note}
              caption={`From ${first}. Only you two can read it.`}
              delay={beats.note}
            />
          </OnBeat>
        ) : null}
        <OnBeat at={beats.note + 260} style={styles.inBalance}>
          <View style={styles.inBalanceTick}>
            <Icon name="check" size={13} color={colors.white} strokeWidth={2.8} />
          </View>
          <Txt weight="semi" size={16}>
            It’s in your balance.
          </Txt>
          {profile && profile.currency !== 'USD' ? (
            <Txt size={14} color={colors.muted}>
              About {formatLocal(baseToNumber(amount), profile.currency)}
            </Txt>
          ) : null}
        </OnBeat>
        {explain ? (
          <OnBeat at={beats.note + 520} style={styles.explainOnce}>
            <View style={styles.explainLock}>
              <Icon name="lock" size={16} color={colors.white} strokeWidth={2.4} />
            </View>
            <Txt size={14} color={colors.onTint} style={{ flex: 1, lineHeight: 20 }}>
              <Txt weight="semi" size={14}>
                Only you can see this came from {name.startsWith('0x') ? 'them' : first}.
              </Txt>{' '}
              Monad shows a payment to an address made just for it.
            </Txt>
          </OnBeat>
        ) : null}
        <View style={{ marginTop: 'auto', paddingTop: 14 }}>
          <PillButton
            label="Done"
            icon="check"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          />
        </View>
      </SlideUp>
    </View>
  )
}

const styles = StyleSheet.create({
  catch: { position: 'absolute', top: 60, width: 200, alignItems: 'center' },
  bubble: {
    marginBottom: -18,
    zIndex: 2,
    paddingHorizontal: 16,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.ink,
    justifyContent: 'center',
  },
  bubbleTail: {
    position: 'absolute',
    bottom: -8,
    left: '50%',
    marginLeft: -7,
    width: 14,
    height: 14,
    backgroundColor: colors.surface,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: colors.ink,
    transform: [{ rotate: '45deg' }],
  },
  copy: { alignItems: 'center', paddingHorizontal: 24 },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
  },
  footer: { paddingHorizontal: 20, paddingBottom: 12, marginTop: 'auto' },
  privateScreen: { flex: 1, backgroundColor: colors.ink },
  privateTop: { height: 48, alignItems: 'center', justifyContent: 'center' },
  privateTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  privateStage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  privateSheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 22,
    paddingTop: 20,
    minHeight: 270,
    gap: 10,
  },
  inBalance: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 },
  inBalanceTick: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.positive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  explainOnce: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    padding: 12,
  },
  explainLock: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
