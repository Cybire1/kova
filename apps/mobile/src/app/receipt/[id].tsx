import * as WebBrowser from 'expo-web-browser'
import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Pressable, Share, StyleSheet, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { explorerTx } from '@/lib/chain'
import { formatUsd } from '@/lib/money'
import { colors } from '@/lib/theme'
import { Icon, type IconName } from '@/ui/Icon'
import { isUnnamed, useWallet } from '@/lib/wallet'
import { Avatar, ShopBadge } from '@/ui/art'
import { signed, when } from '@/ui/EntryRow'
import { NameSheet } from '@/ui/NameSheet'
import { Header, PillButton, Screen, TextLink, Txt } from '@/ui/primitives'

const titles = { paid: 'Paid', sent: 'Sent', received: 'Received', added: 'Added' } as const

/** A paper receipt with a torn edge, and a link to the transaction on Monadscan. */
export default function Receipt() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { activity } = useWallet()
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

  return (
    <Screen bg={colors.sunken}>
      <Header title="Receipt" />
      <View style={styles.wrap}>
        <View style={styles.paper}>
          <View style={styles.top}>
            {entry.kind === 'paid' || entry.takings ? <ShopBadge size={64} /> : <Avatar name={entry.name} id={entry.address} size={64} />}
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
          ) : ['Sent', 'Arrived', 'Scan to pay', 'AUSD test faucet'].includes(entry.detail) || entry.takings ? null : (
            <Row label="For" value={entry.detail} />
          )}
          {entry.private ? (
            <Txt size={12} color={colors.muted} style={{ textAlign: 'right', marginTop: -2 }}>
              {entry.private === 'both' ? 'Sealed: only the two of you can read it' : 'Sealed: only you can read it'}
            </Txt>
          ) : null}
          {entry.ms ? <Row label="Took" value={`${(entry.ms / 1000).toFixed(1)} seconds`} /> : null}
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
        <PillButton
          label="Share receipt"
          icon="share"
          onPress={() =>
            void Share.share({
              message: `${titles[entry.kind]} ${formatUsd(BigInt(entry.amount))} ${incoming ? 'from' : 'to'} ${entry.name} on Kova.${entry.txHash ? ` ${explorerTx(entry.txHash)}` : ''}`,
            })
          }
        />
      </View>
      <NameSheet person={naming && person ? { address: person, name: entry.name } : null} onClose={() => setNaming(false)} />
    </Screen>
  )
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
