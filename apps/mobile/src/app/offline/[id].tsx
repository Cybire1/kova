import { offlinePaymentLink } from '@kova/monad'
import * as Haptics from 'expo-haptics'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef } from 'react'
import { Share, StyleSheet, useWindowDimensions, View } from 'react-native'
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated'
import { shareWebUrl } from '@/lib/config'
import { baseToNumber, formatLocal, formatUsd } from '@/lib/money'
import { type OfflineItem, useOffline, useOfflineName } from '@/lib/offline'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { CodeCard } from '@/ui/CodeCard'
import { Icon } from '@/ui/Icon'
import { Burst, CoinRain, PopIn } from '@/ui/motion'
import { SettleStatus } from '@/ui/Offline'
import { Chip, Header, PillButton, Rise, Screen, Sticker, TextLink, Txt } from '@/ui/primitives'
import { Stage } from '@/ui/Stage'

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/**
 * One payment made with no signal. Yours: the code to show them (or share), and where it is on its
 * way to Monad. Theirs to you: what arrived, checked on this phone, and the honest part: until it
 * settles, it can still fail if they don't have the money.
 */
export default function OfflinePayment() {
  const { id } = useLocalSearchParams<{ id: string; fresh?: string }>()
  const offline = useOffline()
  const item = offline.item(id)
  if (!item)
    return (
      <Screen bg={colors.sunken}>
        <Header backIcon="close" />
        <Txt style={{ padding: 24 }}>This payment isn’t on this phone.</Txt>
      </Screen>
    )
  return item.direction === 'out' ? <Outgoing item={item} /> : <Incoming item={item} />
}

function StatusChip({ item }: { item: OfflineItem }) {
  if (item.status === 'settled') return <Chip label="Settled" dot={colors.tealLight} />
  if (item.status === 'expired') return <Chip label="Expired" />
  if (item.status === 'failed') return <Chip label="Not settled" dot={colors.coral} />
  return <Chip label="Waiting" icon="clock" />
}

/** Celebrates the moment it settles while you're looking at it. */
function useSettledBuzz(item: OfflineItem) {
  const was = useRef(item.status)
  useEffect(() => {
    if (was.current !== 'settled' && item.status === 'settled') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    was.current = item.status
  }, [item.status])
}

function Outgoing({ item }: { item: OfflineItem }) {
  const { name, first } = useOfflineName(item)
  const amount = BigInt(item.amount)
  const link = offlinePaymentLink(item.code, shareWebUrl)
  const settled = item.status === 'settled'
  useSettledBuzz(item)
  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))

  return (
    <Screen bg={colors.coralSoft}>
      <Header title="Payment code" backIcon="close" onBack={close} right={<StatusChip item={item} />} />
      <View style={styles.body}>
        <Txt weight="semi" size={26} style={styles.title} numberOfLines={1} adjustsFontSizeToFit>
          {settled ? `${first} has been paid` : `Show ${first} this code`}
        </Txt>
        <View>
          <CodeCard value={link} size={232} />
          {settled ? (
            <Animated.View entering={FadeIn.duration(300)} style={styles.paidOver} pointerEvents="none">
              <Animated.View entering={ZoomIn.springify().damping(14)} style={styles.stamp}>
                <Icon name="check" size={30} color={colors.white} strokeWidth={3} />
                <Txt weight="bold" size={26} color={colors.white} style={{ letterSpacing: -0.6 }}>
                  Paid
                </Txt>
              </Animated.View>
            </Animated.View>
          ) : null}
        </View>
        <Txt weight="bold" size={40} style={styles.amount} numberOfLines={1} adjustsFontSizeToFit>
          {formatUsd(amount)}
        </Txt>
        <Txt size={14} color={colors.onTint} style={styles.line}>
          {settled
            ? `To ${name}, signed on your phone with no signal.`
            : `Show this to ${first}, or share it. It settles on Monad as soon as either phone is online.`}
        </Txt>
        <Sticker radius={22} style={styles.statusCard}>
          <SettleStatus item={item} other={first} />
        </Sticker>
      </View>
      <View style={styles.footer}>
        {settled ? (
          <>
            <PillButton label="Done" icon="check" onPress={close} />
            {item.entryId ? (
              <View style={{ alignItems: 'center', marginTop: 12 }}>
                <TextLink
                  label="See receipt"
                  onPress={() => {
                    close()
                    router.push({ pathname: '/receipt/[id]', params: { id: item.entryId as string } })
                  }}
                />
              </View>
            ) : null}
          </>
        ) : (
          <>
            <PillButton
              label="Share code"
              icon="share"
              onPress={() => void Share.share({ message: `${formatUsd(amount)} for ${first}, paid on Kova: ${link}` })}
            />
            <Txt size={12} color={colors.onTint} style={{ textAlign: 'center', marginTop: 10 }}>
              It pays {first} once, however many times it’s shown or shared.
            </Txt>
          </>
        )}
      </View>
    </Screen>
  )
}

function Incoming({ item }: { item: OfflineItem }) {
  const { profile } = useWallet()
  const { name, first, claimedOnly } = useOfflineName(item)
  const { width } = useWindowDimensions()
  const amount = BigInt(item.amount)
  const settled = item.status === 'settled'
  const failed = item.status === 'failed' || item.status === 'expired'
  useSettledBuzz(item)
  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))

  return (
    <Screen bg={colors.tealSoft}>
      <Header backIcon="close" onBack={close} right={<StatusChip item={item} />} />
      <View style={{ height: 268 }}>
        {settled ? <CoinRain width={width} height={268} /> : null}
        <View style={[styles.catch, { left: width / 2 - 90 }]}>
          <PopIn delay={250} style={styles.bubble}>
            <Txt weight="bold" size={18}>
              {settled ? `Yay! ${formatUsd(amount, { sign: true })}` : failed ? 'Hmm…' : formatUsd(amount, { sign: true })}
            </Txt>
            <View style={styles.bubbleTail} />
          </PopIn>
          <Stage pose={failed ? 'oops' : 'catch'} size={180} motion={settled ? 'bounce' : 'bob'} />
        </View>
        {settled ? (
          <Burst
            spots={[
              { x: width / 2 - 112, y: 130, size: 22, fill: colors.white, delay: 300 },
              { x: width / 2 + 108, y: 150, size: 26, fill: colors.yellow, delay: 450 },
              { x: width / 2 - 86, y: 240, size: 16, fill: colors.yellow, delay: 600 },
              { x: width / 2 + 88, y: 244, size: 18, fill: colors.white, delay: 750 },
            ]}
          />
        ) : null}
      </View>
      <Rise style={styles.copy}>
        <Txt weight="medium" size={20} numberOfLines={1}>
          {name} sent you
        </Txt>
        <Txt weight="bold" size={60} style={{ letterSpacing: -2.4 }} adjustsFontSizeToFit numberOfLines={1}>
          {formatUsd(amount, { sign: true })}
        </Txt>
        {claimedOnly ? (
          <Txt size={13} color={colors.onTint} style={{ textAlign: 'center' }}>
            Their code says “{item.claimed}” · signed by {short(item.from)}
          </Txt>
        ) : profile && profile.currency !== 'USD' ? (
          <Txt size={15} color={colors.onTint}>
            about {formatLocal(baseToNumber(amount), profile.currency)}
          </Txt>
        ) : null}
      </Rise>
      <View style={{ paddingHorizontal: 20, marginTop: 18, gap: 10 }}>
        <Sticker radius={22} style={styles.facts}>
          <View style={styles.fact}>
            <View style={[styles.factIcon, { backgroundColor: colors.teal }]}>
              <Icon name="check" size={17} color={colors.white} strokeWidth={2.6} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt weight="semi" size={15}>
                Signed on {first}’s phone
              </Txt>
              <Txt size={13} color={colors.onTint}>
                Checked here, with no signal needed
              </Txt>
            </View>
          </View>
          <View style={styles.factRule} />
          <SettleStatus item={item} other={first} />
        </Sticker>
        {!settled && !failed ? (
          <Animated.View entering={FadeIn.delay(400)}>
            <Txt size={13} color={colors.onTint} style={{ textAlign: 'center', lineHeight: 18, paddingHorizontal: 10 }}>
              Until it settles it can still fail, if {first} doesn’t have the money. It settles on Monad as soon as either of you is online.
            </Txt>
          </Animated.View>
        ) : null}
      </View>
      <View style={styles.footer}>
        <PillButton label="Done" icon="check" onPress={close} />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 4 },
  title: { letterSpacing: -0.6, textAlign: 'center', marginTop: 2 },
  paidOver: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 44,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stamp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 64,
    paddingHorizontal: 22,
    borderRadius: 32,
    backgroundColor: colors.ink,
    transform: [{ rotate: '-8deg' }],
  },
  amount: { letterSpacing: -1.5, marginTop: 14 },
  line: { textAlign: 'center', lineHeight: 20, marginTop: 2, paddingHorizontal: 6 },
  statusCard: { alignSelf: 'stretch', marginTop: 16, paddingHorizontal: 14, paddingVertical: 12 },
  footer: { paddingHorizontal: 20, paddingBottom: 12, paddingTop: 8, marginTop: 'auto' },
  catch: { position: 'absolute', top: 44, width: 180, alignItems: 'center' },
  bubble: {
    marginBottom: -16,
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
  facts: { paddingHorizontal: 14, paddingVertical: 12 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  factIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  factRule: { height: 1, backgroundColor: colors.sunken, marginVertical: 12 },
})
