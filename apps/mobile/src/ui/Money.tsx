import type { MoneyFeature } from '@kova/monad'
import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import type { Address } from 'viem'
import { formatUsd } from '@/lib/money'
import { type DollarCard, getDollarCard, getSavings, requestAccess, type Savings } from '@/lib/partners'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import type { KoviPose } from './art'
import { Icon } from './Icon'
import { PillButton, Rise, Txt } from './primitives'
import { Stage } from './Stage'

/**
 * The parts of money in, the dollar card and savings that the three screens share: loading one,
 * and the honest state for a feature that waits on a partner.
 */

export const problemOf = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.')

export function useMoney<T>(load: (address: Address) => Promise<T>) {
  const { profile } = useWallet()
  const [data, setData] = useState<T | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const address = profile?.address
  const reload = useCallback(async () => {
    if (!address) return
    try {
      setData(await load(address))
      setProblem(null)
    } catch (e) {
      setProblem(problemOf(e))
    }
  }, [address, load])
  useEffect(() => {
    void reload()
  }, [reload])
  return { data, setData, problem, reload }
}

/** What it is, who runs it, and a way to be first when it opens. */
export function NotYet({
  pose,
  title,
  lead,
  facts,
  feature,
  requested,
  onRequested,
}: {
  pose: KoviPose
  title: string
  lead: string
  facts: Array<[string, string]>
  feature: MoneyFeature
  requested: boolean
  onRequested: () => void
}) {
  const { profile, signMessage } = useWallet()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.art}>
        <Stage pose={pose} size={140} />
      </View>
      <Rise style={{ paddingHorizontal: 8 }}>
        <Txt weight="semi" size={30} style={styles.title}>
          {title}
        </Txt>
        <Txt size={16} color={colors.onTint} style={styles.lead}>
          {lead}
        </Txt>
      </Rise>
      <View style={styles.facts}>
        {facts.map(([k, v], i) => (
          <View key={k} style={[styles.fact, i > 0 && styles.rule]}>
            <Txt size={14} color={colors.muted}>
              {k}
            </Txt>
            <Txt weight="semi" size={14} style={{ flexShrink: 1, textAlign: 'right' }}>
              {v}
            </Txt>
          </View>
        ))}
      </View>
      {requested ? (
        <View style={styles.listed}>
          <Icon name="check" size={18} />
          <Txt weight="semi" size={14} style={{ flex: 1, lineHeight: 20 }}>
            You’re on the list. Kova switches this on for you as soon as its partner does.
          </Txt>
        </View>
      ) : (
        <View style={{ marginTop: 'auto', paddingTop: 16 }}>
          <Txt size={14} color={colors.muted} style={{ textAlign: 'center', marginBottom: 10 }}>
            Opening soon. Ask now and you’ll be among the first.
          </Txt>
          {problem ? (
            <Txt weight="medium" size={14} color={colors.danger} style={{ marginBottom: 8 }}>
              {problem}
            </Txt>
          ) : null}
          <PillButton
            label={busy ? 'Asking…' : 'Request access'}
            icon="sparkle"
            loading={busy}
            disabled={!profile}
            onPress={async () => {
              if (!profile) return
              setBusy(true)
              setProblem(null)
              try {
                await requestAccess(profile.address, signMessage, feature)
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
                onRequested()
              } catch (e) {
                setProblem(problemOf(e))
              } finally {
                setBusy(false)
              }
            }}
          />
        </View>
      )}
    </View>
  )
}

export function SandboxNote({ text }: { text: string }) {
  return (
    <View style={styles.sandbox}>
      <Icon name="info" size={14} color={colors.muted} />
      <Txt weight="semi" size={12} color={colors.muted}>
        {text}
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  art: { alignItems: 'center', marginTop: 4, height: 150 },
  title: { letterSpacing: -0.8, textAlign: 'center' },
  lead: { lineHeight: 23, marginTop: 8, textAlign: 'center' },
  facts: {
    marginTop: 18,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: 22,
    backgroundColor: colors.surface,
  },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 12 },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(11,26,29,0.18)' },
  listed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 'auto',
    padding: 14,
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: 18,
    backgroundColor: colors.tealSoft,
  },
  sandbox: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: colors.sunken,
    marginTop: 10,
  },
})

/** Home: savings and the dollar card, side by side under the shop. */
export function MoneyTiles() {
  const { profile } = useWallet()
  const [savings, setSavings] = useState<Savings | null>(null)
  const [card, setCard] = useState<DollarCard | null>(null)
  const address = profile?.address
  useEffect(() => {
    if (!address) return
    void getSavings(address).then(setSavings).catch(() => null)
    void getDollarCard(address).then(setCard).catch(() => null)
  }, [address])
  const saved = savings?.live ? BigInt(savings.balance) : 0n
  return (
    <View style={tiles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Savings"
        onPress={() => router.push('/savings')}
        style={({ pressed }) => [tiles.tile, { backgroundColor: colors.tealSoft }, pressed && tiles.pressed]}
      >
        <View style={tiles.icon}>
          <Icon name="up" size={16} />
        </View>
        <Txt weight="semi" size={12} color={colors.onTint}>
          Savings
        </Txt>
        <Txt weight="bold" size={15} numberOfLines={2}>
          {savings?.live && saved > 0n ? formatUsd(saved) : 'Earn on spare dollars'}
        </Txt>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dollar card"
        onPress={() => router.push('/dollar-card')}
        style={({ pressed }) => [tiles.tile, { backgroundColor: colors.ink }, pressed && tiles.pressed]}
      >
        <View style={[tiles.icon, { borderColor: colors.surface }]}>
          <Icon name="card" size={16} color={colors.surface} />
        </View>
        <Txt weight="semi" size={12} color={colors.onInk}>
          Dollar card
        </Txt>
        <Txt weight="bold" size={15} color={colors.surface} numberOfLines={2}>
          {card?.card ? `•••• ${card.card.last_four}${card.card.frozen ? ' · Frozen' : ''}` : 'Spend anywhere'}
        </Txt>
      </Pressable>
    </View>
  )
}

/** The Card tab: the dollar card beside the Kova Card. */
export function DollarCardRow() {
  return (
    <View style={{ paddingHorizontal: 20, marginTop: 18 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dollar card"
        onPress={() => router.push('/dollar-card')}
        style={({ pressed }) => [tiles.wide, pressed && tiles.pressed]}
      >
        <View style={[tiles.icon, { position: 'relative', top: 0, left: 0, borderColor: colors.surface }]}>
          <Icon name="card" size={16} color={colors.surface} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt weight="semi" size={16} color={colors.surface}>
            Dollar card
          </Txt>
          <Txt size={13} color={colors.onInk}>
            Online and in shops, from your Kova dollars
          </Txt>
        </View>
        <Icon name="arrow" size={18} color={colors.surface} />
      </Pressable>
    </View>
  )
}

/** Add money: a US account number of your own. */
export function FromAbroadRow() {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Get paid from abroad"
      onPress={() => router.push('/us-account')}
      style={({ pressed }) => [tiles.add, pressed && tiles.pressed]}
    >
      <View style={{ flex: 1 }}>
        <Txt weight="semi" size={16}>
          Get paid from abroad
        </Txt>
        <Txt size={13} color={colors.muted}>
          Your own US account number, by ACH or wire
        </Txt>
      </View>
      <Icon name="web" size={20} />
    </Pressable>
  )
}

const tiles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, marginHorizontal: 20, marginTop: 14 },
  tile: {
    flex: 1,
    minHeight: 104,
    justifyContent: 'flex-end',
    gap: 2,
    padding: 14,
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: 24,
  },
  pressed: { transform: [{ scale: 0.98 }] },
  icon: {
    position: 'absolute',
    top: 12,
    left: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: 24,
    backgroundColor: colors.ink,
  },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 66,
    paddingHorizontal: 18,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: 24,
    backgroundColor: colors.surface,
  },
})
