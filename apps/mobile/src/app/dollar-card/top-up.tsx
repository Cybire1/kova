import { parseAmount } from '@kova/monad'
import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { applyKey, formatUsd } from '@/lib/money'
import { type DollarCard, getDollarCard, topUpCard, topUpFee } from '@/lib/partners'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Keypad } from '@/ui/Keypad'
import { problemOf, useMoney } from '@/ui/Money'
import { PillButton, Txt } from '@/ui/primitives'

const BLOCKS = 10

/**
 * Top up the dollar card: a sheet over the card. Type an amount, see where it lands in today's limit,
 * and approve it with Face ID. One signed transfer to Kova of the amount plus Kova's 0.5% fee; the
 * amount lands on the card.
 */
export default function TopUpSheet() {
  const { profile, signTypedData, balance } = useWallet()
  const { data } = useMoney<DollarCard>(getDollarCard)
  const [typed, setTyped] = useState('20')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cap = BigInt(data?.daily_topup ?? '100000000')
  const today = BigInt(data?.topups?.today ?? '0')
  const left = BigInt(data?.topups?.left ?? cap.toString())
  const value = (() => {
    try {
      return typed ? parseAmount(typed) : 0n
    } catch {
      return 0n
    }
  })()
  const bps = data?.topup_fee_bps ?? 50
  const fee = value > 0n ? topUpFee(value, bps) : 0n
  const total = value + fee
  const tooMuch = value > left
  const short = balance !== null && total > balance
  const after = left > value ? left - value : 0n
  const earlier = cap > 0n ? Number((today * BigInt(BLOCKS)) / cap) : 0
  const now = cap > 0n ? Math.ceil(Number(((today + value) * BigInt(BLOCKS)) / cap)) - earlier : 0

  const go = async () => {
    const treasury = data?.topups?.treasury
    if (!profile || !treasury) return
    setBusy(true)
    setError(null)
    try {
      await topUpCard(profile.address, signTypedData, treasury, value, bps)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      router.back()
    } catch (e) {
      setError(problemOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.sheet}>
      <Txt weight="bold" size={17}>
        Top up card
      </Txt>
      <Txt weight="bold" size={56} style={styles.amount}>
        <Txt weight="bold" size={30} color={colors.muted}>
          $
        </Txt>
        {typed || '0'}
      </Txt>
      <View style={styles.meter}>
        <View style={styles.blocks}>
          {Array.from({ length: BLOCKS }, (_, i) => (
            <View
              // biome-ignore lint/suspicious/noArrayIndexKey: ten fixed blocks of a meter
              key={i}
              style={[
                styles.block,
                i < earlier && styles.blockEarlier,
                i >= earlier && i < earlier + now && (tooMuch ? styles.blockOver : styles.blockNow),
              ]}
            />
          ))}
        </View>
        <View style={styles.meterFoot}>
          <Txt weight="semi" size={12} color={colors.muted}>
            {today > 0n ? `${formatUsd(today)} earlier · ` : ''}
            <Txt weight="semi" size={12} color={tooMuch ? colors.danger : colors.coralDeep}>
              +{formatUsd(value)} now
            </Txt>
          </Txt>
          <Txt weight="bold" size={12} color={tooMuch ? colors.danger : colors.ink}>
            {tooMuch ? `${formatUsd(left)} left today` : `${formatUsd(after)} left today`}
          </Txt>
        </View>
      </View>
      <View style={styles.from}>
        <Txt weight="semi" size={14} style={{ flex: 1 }}>
          From Kova balance
        </Txt>
        <Txt weight="bold" size={14} color={short ? colors.danger : colors.muted}>
          {balance === null ? '—' : formatUsd(balance)}
        </Txt>
      </View>
      <View style={[styles.from, { marginTop: 0 }]}>
        <Txt size={13} color={colors.muted} style={{ flex: 1 }}>
          Kova fee ({(bps / 100).toFixed(1)}%)
        </Txt>
        <Txt weight="semi" size={13} color={colors.muted}>
          {formatUsd(fee)} · you pay {formatUsd(total)}
        </Txt>
      </View>
      <Keypad size={52} onKey={(key) => setTyped((t) => applyKey(t, key))} />
      {error ? (
        <Txt weight="medium" size={14} color={colors.danger} style={{ marginTop: 8 }}>
          {error}
        </Txt>
      ) : null}
      <View style={{ marginTop: 14 }}>
        <PillButton
          label={
            tooMuch
              ? `Up to ${formatUsd(left)} today`
              : short
                ? 'Not enough in your balance'
                : busy
                  ? 'Topping up…'
                  : `Top up ${formatUsd(value)}`
          }
          icon="face"
          loading={busy}
          disabled={value <= 0n || tooMuch || short || !data?.topups}
          onPress={() => void go()}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  sheet: {
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 30,
    backgroundColor: colors.paper,
  },
  amount: { textAlign: 'center', marginTop: 4, letterSpacing: -2 },
  meter: {
    marginTop: 10,
    padding: 12,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  blocks: { flexDirection: 'row', gap: 4 },
  block: { flex: 1, height: 14, borderRadius: 3, backgroundColor: colors.sunken },
  blockEarlier: { backgroundColor: colors.ink },
  blockNow: { backgroundColor: colors.coral, borderWidth: 2, borderColor: colors.line },
  blockOver: { backgroundColor: colors.danger },
  meterFoot: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  from: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
})
