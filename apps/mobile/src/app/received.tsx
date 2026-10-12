import { Redirect, router, useLocalSearchParams } from 'expo-router'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import { baseToNumber, formatLocal, formatUsd } from '@/lib/money'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Burst, CoinRain, PopIn } from '@/ui/motion'
import { when } from '@/ui/EntryRow'
import { NoteSlip } from '@/ui/LinkParts'
import { PrivateNote } from '@/ui/PrivateNote'
import { Stage } from '@/ui/Stage'
import { Chip, Header, PillButton, Rise, Screen, Sticker, Txt } from '@/ui/primitives'

/** Money arrived: coins rain, Kovi catches them, and the amount is the headline. */
export default function Received() {
  const params = useLocalSearchParams<{ amount: string; name: string; hash?: string; note?: string; via?: string }>()
  // Claimed from a link: their note was written on the link, not sealed for you.
  const byLink = params.via === 'link'
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

  return (
    <Screen bg={colors.tealSoft}>
      <Header backIcon="close" onBack={() => router.back()} right={<Chip label={latest ? when(latest.at) : 'Just now'} dot={colors.tealLight} />} />
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
        <Txt weight="bold" size={64} style={{ letterSpacing: -2.5 }} adjustsFontSizeToFit numberOfLines={1}>
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
          <PrivateNote text={note} caption={`From ${name.split(' ')[0]}. Sealed by them; only you two can read it.`} />
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
            onPress={() => router.replace({ pathname: '/send/[to]', params: { to: known.address, name: known.name } })}
          />
        ) : (
          <PillButton label="Done" icon="check" onPress={() => router.back()} />
        )}
      </View>
    </Screen>
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
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18 },
  footer: { paddingHorizontal: 20, paddingBottom: 12, marginTop: 'auto' },
})
