import * as WebBrowser from 'expo-web-browser'
import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Pressable, Share, StyleSheet, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { explorerTx } from '@/lib/chain'
import { formatUsd } from '@/lib/money'
import { usePrivate } from '@/lib/private'
import { shortAddress } from '@/lib/takings-core'
import { colors } from '@/lib/theme'
import { Icon, type IconName } from '@/ui/Icon'
import { type Entry, isUnnamed, useWallet } from '@/lib/wallet'
import { Avatar, ShopBadge } from '@/ui/art'
import { PrivateAvatar, signed, when } from '@/ui/EntryRow'
import { Announced } from '@/ui/Private'
import { NameSheet } from '@/ui/NameSheet'
import { Header, PillButton, Screen, TextLink, Txt } from '@/ui/primitives'

const titles = { paid: 'Paid', sent: 'Sent', received: 'Received', added: 'Added' } as const

/** A paper receipt with a torn edge, and a link to the transaction on Monadscan. */
export default function Receipt() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { activity } = useWallet()
  const privately = usePrivate()
  const entry = activity.find((e) => e.id === id)
  const [naming, setNaming] = useState(false)

  if (!entry)
    return (
      <Screen bg={colors.sunken}>
        <Header />
        <Txt style={{ padding: 24 }}>This receipt isn’t on this phone.</Txt>
      </Screen>
    )

  const incoming = entry.kind === 'received' || entry.kind === 'added'
  // A one-time address (a link's, or a private sale's) is never a person to name.
  const person = (entry.kind === 'sent' || entry.kind === 'received') && entry.address && !entry.takings ? entry.address : null
  const zigzag = Array.from({ length: 18 }, (_, i) => `L${i * 20 + 10} 10 L${i * 20 + 20} 0`).join(' ')
  // Received privately: still private (in the balance either way), spent privately, or made public.
  const receipt = entry.privately && incoming ? privately.receiptAt(entry.oneTime) : undefined
  const waiting = receipt ? BigInt(receipt.held) > 0n : false
  const first = isUnnamed(entry.name) ? 'they' : entry.name.split(' ')[0]

  return (
    <Screen bg={colors.sunken}>
      <Header title="Receipt" />
      <View style={styles.wrap}>
        <View style={styles.paper}>
          <View style={styles.top}>
            {entry.kind === 'paid' || entry.takings ? (
              <ShopBadge size={64} />
            ) : entry.privately ? (
              <PrivateAvatar name={entry.name} id={entry.address} size={64} />
            ) : (
              <Avatar name={entry.name} id={entry.address} size={64} />
            )}
            <Txt size={15} color={colors.muted} style={{ marginTop: 12 }}>
              {titles[entry.kind]} {incoming ? 'from' : 'to'}
            </Txt>
            {person ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Rename ${entry.name}`} onPress={() => setNaming(true)}>
                <Txt weight="semi" size={22}>
                  {entry.name}
                </Txt>
              </Pressable>
            ) : (
              <Txt weight="semi" size={22}>
                {entry.name}
              </Txt>
            )}
            {entry.unconfirmed ? (
              <Txt size={13} color={colors.coralDeep} style={{ marginTop: 2, textAlign: 'center' }}>
                Unconfirmed: only their sealed note says it’s them
              </Txt>
            ) : null}
            {person && isUnnamed(entry.name) ? (
              <View style={{ marginTop: 6 }}>
                <TextLink label="Add a name" onPress={() => setNaming(true)} />
              </View>
            ) : null}
            <Txt weight="bold" size={48} color={incoming ? colors.positive : colors.ink} style={{ letterSpacing: -1.5, marginTop: 6 }}>
              {signed(entry)}
            </Txt>
          </View>
          <View style={styles.rule} />
          <Row label="When" value={`${new Date(entry.at).toLocaleDateString([], { day: 'numeric', month: 'long' })}, ${when(entry.at)}`} />
          {entry.private ? (
            <Row label="Private note" icon="lock" value={entry.detail} />
          ) : ['Sent', 'Arrived', 'Scan to pay', 'AUSD test faucet'].includes(entry.detail) || entry.takings || entry.privately || entry.offline ? null : (
            <Row label="For" value={entry.detail} />
          )}
          {entry.private ? (
            <Txt size={12} color={colors.muted} style={{ textAlign: 'right', marginTop: -2 }}>
              {entry.private === 'both' ? 'Sealed: only the two of you can read it' : 'Sealed: only you can read it'}
            </Txt>
          ) : null}
          {entry.privately ? (
            <>
              <Row label="Privacy" icon="lock" value={incoming ? 'Received privately' : 'Sent privately'} />
              {entry.oneTime ? <Row label="Paid to" value={shortAddress(entry.oneTime)} /> : null}
              <Txt size={12} color={colors.muted} style={{ textAlign: 'right', marginTop: -2, lineHeight: 17 }}>
                {incoming
                  ? 'An address made just for this payment. Only you can tell it’s yours.'
                  : `Monad shows that address, not ${isUnnamed(entry.name) ? 'them' : first}. Only ${first} can open it.`}
              </Txt>
              {receipt ? (
                <Row
                  label="Now"
                  value={waiting ? (BigInt(receipt.held) < BigInt(receipt.amount) ? `${formatUsd(BigInt(receipt.held))} left, private` : 'Private, in your balance') : receipt.movedTx ? 'Made public' : 'Spent privately'}
                />
              ) : null}
              {entry.oneTime ? (
                <View style={{ alignItems: 'flex-end', marginTop: 4 }}>
                  <Announced url={privately.announcementAt(entry.oneTime)} at={entry.at} />
                </View>
              ) : null}
            </>
          ) : null}
          {entry.offline ? (
            <>
              <Row label="How" icon="noSignal" value="Paid with a code" />
              <Txt size={12} color={colors.muted} style={{ textAlign: 'right', marginTop: -2, lineHeight: 17 }}>
                Signed on {incoming ? `${first}’s` : 'your'} phone with no signal, and settled on Monad once a phone was online.
              </Txt>
            </>
          ) : null}
          {entry.fromPrivate ? <Row label="Paid from" icon="lock" value="Private dollars" /> : null}
          {entry.fromPrivate ? (
            <Txt size={12} color={colors.muted} style={{ textAlign: 'right', marginTop: -2, lineHeight: 17 }}>
              Paid from an address only you can open. Your wallet doesn’t show on Monad.
            </Txt>
          ) : null}
          {entry.ms ? <Row label={entry.offline ? 'Settled in' : 'Took'} value={`${(entry.ms / 1000).toFixed(entry.offline ? 2 : 1)} seconds`} /> : null}
          <Row label="Fee" value={entry.kind === 'paid' || entry.kind === 'sent' ? '$0.00, covered by Kova' : '$0.00'} />
          <Row label="Amount" value={formatUsd(BigInt(entry.amount))} />
          {entry.txHash ? (
            <View style={{ alignItems: 'center', marginTop: 14 }}>
              <TextLink label="View on Monadscan" onPress={() => void WebBrowser.openBrowserAsync(explorerTx(entry.txHash as string))} />
            </View>
          ) : null}
        </View>
        <Svg width="100%" height={12} viewBox="0 0 360 12" preserveAspectRatio="none">
          <Path d={`M0 0 ${zigzag} L360 0 Z`} fill={colors.surface} />
        </Svg>
      </View>
      <View style={styles.footer}>
        <PillButton label="Share receipt" icon="share" onPress={() => void Share.share({ message: shareText(entry, incoming) })} />
      </View>
      <NameSheet person={naming && person ? { address: person, name: entry.name } : null} onClose={() => setNaming(false)} />
    </Screen>
  )
}

function shareText(entry: Entry, incoming: boolean) {
  return `${titles[entry.kind]} ${formatUsd(BigInt(entry.amount))} ${incoming ? 'from' : 'to'} ${entry.name}${entry.privately ? ', privately,' : ''} on Kova.${entry.txHash ? ` ${explorerTx(entry.txHash)}` : ''}`
}

function Row({ label, value, icon }: { label: string; value: string; icon?: IconName }) {
  return (
    <View style={styles.row}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        {icon ? <Icon name={icon} size={14} color={colors.muted} /> : null}
        <Txt size={15} color={colors.muted}>
          {label}
        </Txt>
      </View>
      <Txt weight="semi" size={15} style={{ flexShrink: 1, textAlign: 'right' }} numberOfLines={2}>
        {value}
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 20, marginTop: 16 },
  paper: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 18 },
  top: { alignItems: 'center' },
  rule: { borderBottomWidth: 2, borderColor: colors.sunken, borderStyle: 'dashed', marginVertical: 18 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 7 },
  footer: { paddingHorizontal: 20, paddingBottom: 12, marginTop: 'auto' },
})
