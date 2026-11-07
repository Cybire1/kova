import { parseAmount } from '@kova/monad'
import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { applyKey, formatUsd } from '@/lib/money'
import { type DollarCard, getDollarCard, withdrawFromCard } from '@/lib/partners'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Keypad } from '@/ui/Keypad'
import { problemOf, useMoney } from '@/ui/Money'
import { PillButton, Txt } from '@/ui/primitives'

const MIN = 1_000_000n

/**
 * Withdraw from the dollar card: a sheet over the card, like Top up the other way. Type an amount
 * up to what's on the card and approve it with Face ID; it leaves the card and lands in the Kova
 * balance, free.
 */
export default function WithdrawSheet() {
  const { profile, signMessage } = useWallet()
  const { data } = useMoney<DollarCard>(getDollarCard)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // After the card is deleted its money is still on its account (`balance` at the top level).
  const left = data?.card?.balance ?? data?.balance ?? null
  const onCard = left ? BigInt(left) : null
  // Whole cents only: what's on the card, rounded down to the cent.
  const all = onCard === null ? null : (onCard / 10_000n) * 10_000n
  const value = (() => {
    try {
      return typed ? parseAmount(typed) : 0n
    } catch {
      return 0n
    }
  })()
  const tooMuch = all !== null && value > all
  const tooLittle = value > 0n && value < MIN

  const go = async () => {
    if (!profile) return
    setBusy(true)
    setError(null)
    try {
      await withdrawFromCard(profile.address, signMessage, value)
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
        Withdraw to Kova
      </Txt>
      <Txt weight="bold" size={56} style={styles.amount}>
        <Txt weight="bold" size={30} color={colors.muted}>
          $
        </Txt>
        {typed || '0'}
      </Txt>
      <View style={styles.from}>
        <Txt weight="semi" size={14} style={{ flex: 1 }}>
          On your card
        </Txt>
        <Txt weight="bold" size={14} color={tooMuch ? colors.danger : colors.muted}>
          {all === null ? '—' : formatUsd(all)}
        </Txt>
        {all !== null && all >= MIN ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Withdraw all of it"
            onPress={() => setTyped((Number(all) / 1_000_000).toFixed(2).replace(/\.00$/, ''))}
            style={({ pressed }) => [styles.all, pressed && { opacity: 0.6 }]}
          >
            <Txt weight="semi" size={13}>
              All
            </Txt>
          </Pressable>
        ) : null}
      </View>
      <View style={[styles.from, { marginTop: 0 }]}>
        <Txt size={13} color={colors.muted} style={{ flex: 1 }}>
          To your Kova balance
        </Txt>
        <Txt weight="semi" size={13} color={colors.muted}>
          Free · you get {formatUsd(value)}
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
              ? `Up to ${formatUsd(all ?? 0n)}`
              : tooLittle
                ? `At least ${formatUsd(MIN)}`
                : busy
                  ? 'Withdrawing…'
                  : `Withdraw ${formatUsd(value)}`
          }
          icon="face"
          loading={busy}
          disabled={value <= 0n || tooMuch || tooLittle || !data?.card}
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
  from: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  all: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
