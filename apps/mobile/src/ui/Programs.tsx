import { nadNameOf } from '@kova/monad'
import { useEffect, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { type Address, getAddress, isAddressEqual } from 'viem'
import { shortAddress } from '@/lib/programs'
import { colors, inkAt } from '@/lib/theme'
import { isUnnamed, useWallet } from '@/lib/wallet'
import type { KoviPose } from './art'
import { Icon } from './Icon'
import { Rise, Txt } from './primitives'
import { Stage } from './Stage'

/**
 * Pieces repeat payments and splits share: the honest state for a feature Kova hasn't switched on
 * yet, and the names people know each other's wallets by.
 */

/** A feature that's built and on its way: what it does, plainly, and that it's coming. */
export function ComingSoon({
  pose = 'sleep',
  title,
  lead,
  facts,
  note,
}: {
  pose?: KoviPose
  title: string
  lead: string
  facts: Array<[string, string]>
  note: string
}) {
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
      <View style={styles.soon}>
        <View style={styles.soonIcon}>
          <Icon name="clock" size={18} color={colors.white} />
        </View>
        <Txt weight="semi" size={14} style={{ flex: 1, lineHeight: 20 }}>
          {note}
        </Txt>
      </View>
    </View>
  )
}

/**
 * What to call each wallet: your own name for them, else their .nad name, else a short address.
 * .nad names are looked up once each, in the background.
 */
export function useNames(addresses: string[]) {
  const { contacts } = useWallet()
  const [nad, setNad] = useState<Record<string, string | null>>({})
  const key = useMemo(
    () => [...new Set(addresses.map((a) => a.toLowerCase()))].sort().join(','),
    [addresses],
  )
  useEffect(() => {
    if (!key) return
    let live = true
    const unknown = key
      .split(',')
      .filter((a) => !contacts.some((c) => c.address.toLowerCase() === a && !isUnnamed(c.name)))
    for (const a of unknown) {
      void nadNameOf(getAddress(a))
        .catch(() => null)
        .then((name) => {
          if (live) setNad((m) => (a in m ? m : { ...m, [a]: name }))
        })
    }
    return () => {
      live = false
    }
  }, [key, contacts])
  return (address: string) => {
    const saved = contacts.find((c) => isAddressEqual(c.address, address as Address))?.name
    if (saved && !isUnnamed(saved)) return saved
    return nad[address.toLowerCase()] ?? shortAddress(address)
  }
}

/** "Fri 7 Nov", in the phone's own time. */
export function shortDate(at: string | number | Date) {
  return new Date(at).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

const styles = StyleSheet.create({
  art: { alignItems: 'center', marginTop: 4, height: 150 },
  title: { letterSpacing: -0.8, textAlign: 'center' },
  lead: { lineHeight: 23, marginTop: 8, textAlign: 'center' },
  facts: {
    marginTop: 18,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: 22,
    backgroundColor: colors.surface,
  },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 12 },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: inkAt(0.18) },
  soon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 18,
    padding: 14,
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: 18,
    backgroundColor: colors.tealSoft,
  },
  soonIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.tealDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
