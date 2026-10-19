import { router } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { Pressable, StyleSheet, View } from 'react-native'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import { explorerTx } from '@/lib/chain'
import { formatUsd } from '@/lib/money'
import { type OfflineItem, useOffline, useOfflineName } from '@/lib/offline'
import { colors } from '@/lib/theme'
import { Avatar } from './art'
import { when } from './EntryRow'
import { Icon } from './Icon'
import { TextLink, Txt } from './primitives'

/** "20 Oct": the day an offline payment's week runs out. */
export const until = (item: OfflineItem) =>
  new Date(item.validBefore * 1000).toLocaleDateString([], { day: 'numeric', month: 'short' })

/** "1.02 s": how long settling took, from handing it in. */
export const took = (ms: number) => `${(ms / 1000).toFixed(2)} s`

/**
 * Home's quiet note that the phone has no signal, and that nothing stops because of it: paying and
 * getting paid go by code, and your own code is one tap away.
 */
export function OfflinePill() {
  const { offline } = useOffline()
  if (!offline) return null
  return (
    <Animated.View
      entering={FadeIn.duration(260)}
      exiting={FadeOut.duration(200)}
      style={styles.pill}
      accessibilityRole="summary"
    >
      <View style={styles.pillIcon}>
        <Icon name="noSignal" size={17} color={colors.white} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.pillTop}>
          <Txt weight="semi" size={14}>
            Offline
          </Txt>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show my code"
            hitSlop={8}
            onPress={() => router.push('/receive')}
            style={({ pressed }) => [styles.pillCta, pressed && { transform: [{ scale: 0.96 }] }]}
          >
            <Icon name="qr" size={13} />
            <Txt weight="semi" size={12}>
              My code
            </Txt>
          </Pressable>
        </View>
        <Txt size={12} color={colors.onTint}>
          You can still pay and get paid with a code.
        </Txt>
      </View>
    </Animated.View>
  )
}

/** A face with a small clock on it: a payment signed, not settled yet. */
export function WaitingAvatar({
  name,
  id,
  size = 38,
  tone = 'ink',
}: {
  name: string
  id?: string
  size?: number
  tone?: 'ink' | 'danger'
}) {
  const badge = Math.max(16, Math.round(size * 0.46))
  return (
    <View>
      <Avatar name={name} id={id} size={size} />
      <View
        style={[
          styles.clock,
          {
            width: badge,
            height: badge,
            borderRadius: badge / 2,
            backgroundColor: tone === 'danger' ? colors.danger : colors.ink,
          },
        ]}
      >
        <Icon name="clock" size={Math.round(badge * 0.7)} color={colors.white} strokeWidth={2.6} />
      </View>
    </View>
  )
}

/** One offline payment still waiting: who, a clock, and the amount, greyed until it settles. */
export function OfflineRow({ item }: { item: OfflineItem }) {
  const { name } = useOfflineName(item)
  const incoming = item.direction === 'in'
  const amount = BigInt(item.amount)
  const short = item.status === 'failed'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${incoming ? 'From' : 'To'} ${name}, ${formatUsd(amount)}, ${short ? 'not settled yet' : 'waiting to settle'}`}
      onPress={() => router.push({ pathname: '/offline/[id]', params: { id: item.id } })}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
    >
      <WaitingAvatar
        name={name}
        id={incoming ? item.from : item.to}
        tone={short ? 'danger' : 'ink'}
      />
      <View style={{ flex: 1 }}>
        <Txt weight="semi" size={16} numberOfLines={1}>
          {name}
        </Txt>
        <Txt size={13} color={short ? colors.danger : colors.muted} numberOfLines={1}>
          {short
            ? item.problem?.kind === 'balance'
              ? 'Didn’t settle yet · retrying'
              : 'Not settled yet · retrying'
            : 'Waiting to settle'}
          , {when(item.at)}
        </Txt>
      </View>
      <Txt weight="semi" size={16} color={colors.muted}>
        {incoming ? formatUsd(amount, { sign: true }) : formatUsd(-amount)}
      </Txt>
    </Pressable>
  )
}

/** Activity's card of offline payments still on their way to Monad. */
export function WaitingCard({ items }: { items: OfflineItem[] }) {
  const { offline } = useOffline()
  if (items.length === 0) return null
  return (
    <View style={{ marginTop: 20 }}>
      <View style={styles.cardHead}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="clock" size={15} color={colors.muted} />
          <Txt weight="semi" size={14} color={colors.muted}>
            Waiting to settle
          </Txt>
        </View>
        <Txt size={13} color={colors.muted}>
          {offline ? 'Once a phone is online' : 'Settling on Monad'}
        </Txt>
      </View>
      <View style={styles.card}>
        {items.map((item, i) => (
          <View key={item.id} style={[{ paddingVertical: 2 }, i < items.length - 1 && styles.rule]}>
            <OfflineRow item={item} />
          </View>
        ))}
      </View>
    </View>
  )
}

/** The review's word on paying with no signal: what happens, and the limit. */
export function OfflineNotice() {
  return (
    <View style={styles.notice}>
      <View style={styles.noticeIcon}>
        <Icon name="noSignal" size={18} color={colors.white} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt weight="semi" size={15}>
          Offline payment
        </Txt>
        <Txt size={13} color={colors.onTint} style={{ lineHeight: 18, marginTop: 1 }}>
          Your phone signs it and it goes as a code. It settles on Monad as soon as either of you is
          online. Up to $100 a code.
        </Txt>
      </View>
    </View>
  )
}

/**
 * Where an offline payment is: waiting for a phone with signal, settled on Monad (how fast, and the
 * transaction), or not settled because the payer's wallet was short, and when Kova stops trying.
 */
export function SettleStatus({
  item,
  other,
  onInk,
}: {
  item: OfflineItem
  other: string
  onInk?: boolean
}) {
  const { offline } = useOffline()
  const ink = onInk ? colors.white : colors.ink
  const soft = onInk ? colors.onInk : colors.onTint
  if (item.status === 'settled')
    return (
      <View style={styles.status}>
        <View style={[styles.statusIcon, { backgroundColor: colors.ink }]}>
          <Icon name="bolt" size={17} color={colors.white} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt weight="semi" size={15} color={ink}>
            {item.ms && item.by === 'me'
              ? `Settled in ${took(item.ms)} on Monad`
              : 'Settled on Monad'}
          </Txt>
          <Txt size={13} color={soft}>
            {item.by === 'them'
              ? `${other.startsWith('0x') ? 'Their' : `${other}’s`} phone handed it in first`
              : 'Handed in from this phone'}
            {item.settledAt ? `, ${when(item.settledAt)}` : ''}
          </Txt>
        </View>
        {item.txHash ? (
          <TextLink
            label="Monadscan"
            onPress={() => void WebBrowser.openBrowserAsync(explorerTx(item.txHash as string))}
            color={ink}
          />
        ) : null}
      </View>
    )
  if (item.status === 'expired')
    return (
      <View style={styles.status}>
        <View style={[styles.statusIcon, { backgroundColor: colors.sunken }]}>
          <Icon name="close" size={17} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt weight="semi" size={15} color={ink}>
            Expired without settling
          </Txt>
          <Txt size={13} color={soft}>
            It waited a week. No money moved.
          </Txt>
        </View>
      </View>
    )
  const short = item.status === 'failed' && item.problem?.kind === 'balance'
  if (item.status === 'failed' || item.problem)
    return (
      <View style={[styles.status, styles.statusProblem]}>
        <View style={[styles.statusIcon, { backgroundColor: colors.danger }]}>
          <Icon name="info" size={17} color={colors.white} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt weight="semi" size={15} color={colors.danger}>
            {short
              ? `Didn’t settle: ${item.direction === 'out' ? 'your' : other.startsWith('0x') ? 'their' : `${other}’s`} balance was too low`
              : 'Didn’t settle yet'}
          </Txt>
          <Txt size={13} color={colors.onTint} style={{ lineHeight: 18 }}>
            {short
              ? `No money moved. Kova keeps trying until ${until(item)}.`
              : `${item.problem?.text ?? 'Kova refused it.'} Trying again until ${until(item)}.`}
          </Txt>
        </View>
      </View>
    )
  return (
    <View style={styles.status}>
      <View style={[styles.statusIcon, { backgroundColor: colors.ink }]}>
        <Icon name="clock" size={17} color={colors.white} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt weight="semi" size={15} color={ink}>
          Waiting to settle
        </Txt>
        <Txt size={13} color={soft}>
          {offline
            ? `Nothing has moved yet · good until ${until(item)}`
            : 'Handing it to Monad now…'}
        </Txt>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  pill: {
    marginTop: 12,
    borderRadius: 22,
    backgroundColor: colors.sunken,
    paddingVertical: 9,
    paddingLeft: 9,
    paddingRight: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pillIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 1,
  },
  pillCta: {
    height: 26,
    paddingHorizontal: 9,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  clock: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  cardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  card: {
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    borderStyle: 'dashed',
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
  },
  rule: { borderBottomWidth: 1, borderColor: colors.sunken },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
    padding: 12,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.tealSoft,
  },
  noticeIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusProblem: { alignItems: 'flex-start' },
  statusIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
