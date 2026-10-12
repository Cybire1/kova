import { router } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'
import { formatUsd } from '@/lib/money'
import { colors } from '@/lib/theme'
import { Icon } from './Icon'
import type { Entry } from '@/lib/wallet'
import { AddBadge, Avatar, ShopBadge } from './art'
import { EnvelopeBadge } from './LinkParts'
import { Txt } from './primitives'

export function when(at: number): string {
  const d = new Date(at)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === today.toDateString()) return time
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

const verbs = { paid: 'Paid', sent: 'Sent', received: 'Received', added: 'Added' } as const

/** One line of money: who, what, when, and how much, signed by direction. */
export function EntryRow({ entry }: { entry: Entry }) {
  const incoming = entry.kind === 'received' || entry.kind === 'added'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${verbs[entry.kind]} ${formatUsd(BigInt(entry.amount))}, ${entry.name}`}
      onPress={() => router.push({ pathname: '/receipt/[id]', params: { id: entry.id } })}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
    >
      {entry.link ? (
        <EnvelopeBadge size={38} tone={incoming ? 'teal' : 'coral'} />
      ) : entry.kind === 'paid' ? (
        <ShopBadge size={38} />
      ) : entry.kind === 'added' ? (
        <AddBadge size={38} />
      ) : (
        <Avatar name={entry.name} id={entry.address} size={38} />
      )}
      <View style={{ flex: 1 }}>
        <Txt weight="semi" size={16} numberOfLines={1}>
          {entry.name}
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {entry.private ? <Icon name="lock" size={12} color={colors.muted} /> : null}
          <Txt size={13} color={colors.muted} numberOfLines={1} style={{ flexShrink: 1 }}>
            {entry.detail}, {when(entry.at)}
          </Txt>
        </View>
      </View>
      <Txt weight="semi" size={16} color={incoming ? colors.positive : colors.ink}>
        {signed(entry)}
      </Txt>
    </Pressable>
  )
}

export function signed(entry: Entry) {
  const amount = BigInt(entry.amount)
  return entry.kind === 'received' || entry.kind === 'added' ? formatUsd(amount, { sign: true }) : formatUsd(-amount)
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
})
