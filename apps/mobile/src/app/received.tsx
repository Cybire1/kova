import { Redirect, router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import { baseToNumber, formatLocal, formatUsd } from '@/lib/money'
import { usePrivate } from '@/lib/private'
import { shortAddress } from '@/lib/takings-core'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Burst, CoinRain, PopIn } from '@/ui/motion'
import { when } from '@/ui/EntryRow'
import { NoteSlip } from '@/ui/LinkParts'
import { PrivateNote } from '@/ui/PrivateNote'
import { Stage } from '@/ui/Stage'
import { Chip, Header, PillButton, Rise, Screen, Sticker, TextLink, Txt } from '@/ui/primitives'

/**
 * Money arrived: coins rain, Kovi catches them, and the amount is the headline. Sent privately, it
 * says so: the dollars wait at a one-time address only this wallet can open, a tap from the balance.
 */
export default function Received() {
  const params = useLocalSearchParams<{ amount: string; name: string; hash?: string; note?: string; via?: string; private?: string; oneTime?: string }>()
  // Claimed from a link: their note was written on the link, not sealed for you.
  const byLink = params.via === 'link'
  const privately = params.private === '1'
  const dollars = usePrivate()
  const [movedIn, setMovedIn] = useState(false)
  const { profile, contacts, activity } = useWallet()
  const { width } = useWindowDimensions()
  // Opened without an arrival (a stale link, a relaunch): show the latest money in instead.
  const latest = params.amount ? null : activity.find((e) => e.kind === 'received')
  const amount = params.amount ?? latest?.amount
  const name = params.name || latest?.name || 'Someone'
  const note = params.note || (latest?.private ? latest.detail : undefined)
  const base = BigInt(amount ?? '0')
  const known = contacts.find((c) => c.name === name)
  const receipt = privately ? dollars.receiptAt(params.oneTime) : undefined
  const waiting = receipt ? BigInt(receipt.held) > 0n : privately

  // Moved in from here: a beat to see it land, then back to where you were.
  useEffect(() => {
    if (!movedIn) return
    const timer = setTimeout(() => router.back(), 1100)
    return () => clearTimeout(timer)
  }, [movedIn])

  if (!amount || base === 0n) return <Redirect href="/" />

  return (
    <Screen bg={colors.tealSoft}>
      <Header
        backIcon="close"
        onBack={() => router.back()}
        right={privately ? <Chip label="Private" icon="lock" /> : <Chip label={latest ? when(latest.at) : 'Just now'} dot={colors.tealLight} />}
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
          {name} {byLink ? 'sent you' : privately ? 'paid you privately' : 'paid you'}
        </Txt>
        <Txt weight="bold" size={64} style={{ letterSpacing: -2.5 }} adjustsFontSizeToFit numberOfLines={1}>
          {formatUsd(base, { sign: true })}
        </Txt>
        {privately ? (
          <Txt size={16} color={colors.onTint} style={{ textAlign: 'center', lineHeight: 22 }}>
            {movedIn || !waiting
              ? 'In your balance now'
              : `${profile && profile.currency !== 'USD' ? `About ${formatLocal(baseToNumber(base), profile.currency)}, waiting` : 'Waiting'} at an address only you can open`}
          </Txt>
        ) : profile && profile.currency !== 'USD' ? (
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
      ) : privately ? (
        <View style={{ paddingHorizontal: 20, marginTop: 24 }}>
          <Sticker radius={24} style={{ height: 66 }}>
            <View style={styles.row}>
              <Txt size={15} color={colors.muted}>
                Paid to
              </Txt>
              <Txt weight="semi" size={15}>
                {params.oneTime ? `${shortAddress(params.oneTime)}, yours alone` : 'An address only you can open'}
              </Txt>
            </View>
          </Sticker>
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
        {privately && (waiting || movedIn) ? (
          <View style={{ gap: 14 }}>
            <PillButton
              label={movedIn ? 'In your balance' : dollars.progress ? 'Moving it in…' : 'Move into my balance'}
              icon={movedIn ? 'check' : 'receive'}
              loading={Boolean(dollars.progress)}
              onPress={async () => {
                if (movedIn) return router.back()
                const outcome = await dollars.moveIn()
                if (outcome?.count) setMovedIn(true)
              }}
            />
            {dollars.problem?.during === 'move' ? (
              <Txt weight="medium" size={13} color={colors.danger} style={{ textAlign: 'center', marginTop: -6 }}>
                {dollars.problem.text}
              </Txt>
            ) : null}
            <View style={{ alignItems: 'center' }}>
              <TextLink label="Keep it private for now" onPress={() => router.back()} />
            </View>
          </View>
        ) : known ? (
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
