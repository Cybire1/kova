import { parseAmount } from '@kova/monad'
import * as Haptics from 'expo-haptics'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { formatUsd } from '@/lib/money'
import { getSavings, type Savings, saveIn, saveOut } from '@/lib/partners'
import { colors, fonts, inkAt } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Icon } from '@/ui/Icon'
import { NotYet, problemOf, SandboxNote, useMoney } from '@/ui/Money'
import { Header, PillButton, Screen, Txt } from '@/ui/primitives'

/**
 * Savings: dollars you aren't spending, in an ERC-4626 vault for AUSD, in your own name. Moving in
 * and out is one signature; Kova's saver contract carries it out and pays the gas. On testnet the
 * vault is a labelled test vault and its interest is test dollars.
 */
export default function SavingsScreen() {
  const { profile, signTypedData, balance, refresh } = useWallet()
  const { data, setData, problem, reload } = useMoney<Savings>(getSavings)
  const [picked, setMode] = useState<'in' | 'out'>('in')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  // A wallet savings hasn't opened to yet, already holding some, can only take them out.
  const canSave = data?.can_save !== false
  const mode = canSave ? picked : 'out'
  /** What the vault's cap leaves for this wallet, and what can come out right now. */
  const room = data?.room == null ? null : BigInt(data.room)
  const outNow = data?.withdrawable == null ? null : BigInt(data.withdrawable)
  const held = data ? BigInt(data.balance) : 0n
  const limit =
    mode === 'in'
      ? room === null
        ? null
        : room === 0n
          ? 'Savings is full right now. Try again later.'
          : room < (balance ?? 0n)
            ? `Savings can take ${formatUsd(room)} more right now.`
            : null
      : outNow === null || outNow >= held
        ? null
        : outNow === 0n
          ? 'Savings can’t pay out right now. Your savings are still yours: try again in a little while.'
          : `You can move ${formatUsd(outNow)} out right now.`
  const shut = (mode === 'in' && room === 0n) || (mode === 'out' && outNow === 0n)

  const move = async () => {
    if (!profile || !data) return
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const value = parseAmount(amount)
      if (mode === 'in') {
        if (value > (balance ?? 0n)) throw new Error('That’s more than your balance.')
        if (room !== null && value > room)
          throw new Error(`Savings can take ${formatUsd(room)} more right now.`)
        await saveIn(profile.address, signTypedData, data, value)
        setDone(`${formatUsd(value)} is in savings.`)
      } else {
        const total = BigInt(data.balance)
        if (value > total) throw new Error('That’s more than you have in savings.')
        if (outNow !== null && value > outNow)
          throw new Error(`You can move ${formatUsd(outNow)} out right now.`)
        const allShares = BigInt(data.vault?.shares ?? '0')
        const shares = value === total ? allShares : (allShares * value) / (total || 1n)
        await saveOut(profile.address, signTypedData, data, shares)
        setDone(`${formatUsd(value)} is back in your balance.`)
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setAmount('')
      await Promise.all([reload(), refresh()])
    } catch (e) {
      setError(problemOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen bg={colors.paper}>
      <Header title="Savings" />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {!data ? (
          <Txt size={15} color={colors.muted} style={{ marginTop: 40, textAlign: 'center' }}>
            {problem ?? 'Opening…'}
          </Txt>
        ) : !data.live ? (
          <NotYet
            pose="sleep"
            title="Dollars that earn"
            lead="Move the dollars you aren’t spending into savings, and they earn while they wait. Take them back any time."
            facts={[
              ['Earns from', 'A dollar savings vault'],
              ['Moving in and out', 'One signature, Kova covers the fee'],
              ['Your savings', 'Held in your name, not Kova’s'],
            ]}
            feature="savings"
            requested={data.requested}
            onRequested={() => setData({ ...data, requested: true })}
          />
        ) : (
          <View style={{ flex: 1 }}>
            <Txt weight="bold" size={12} color={colors.tealDeep} style={styles.eyebrow}>
              {(data.vault?.name ?? 'Savings').toUpperCase()}
            </Txt>
            <Txt weight="bold" size={46} style={styles.big}>
              {formatUsd(BigInt(data.balance))}
            </Txt>
            <Txt size={15} color={colors.muted} style={{ textAlign: 'center' }}>
              <Txt weight="semi" size={15} color={colors.positive}>
                +{formatUsd(BigInt(data.earned))}
              </Txt>{' '}
              {data.test ? 'test interest' : 'earned'} on {formatUsd(BigInt(data.deposited))} put in
            </Txt>
            {data.rate && data.rate.yearly > 0 && !data.test ? (
              <View style={styles.rate}>
                <Txt weight="bold" size={15} style={{ textAlign: 'center' }}>
                  About {(data.rate.yearly * 100).toFixed(1)}% a year lately
                </Txt>
                <Txt size={13} color={colors.muted} style={{ textAlign: 'center' }}>
                  What it paid over the last {data.rate.days} days. It changes, and isn’t a promise.
                </Txt>
              </View>
            ) : null}
            {data.test ? (
              <SandboxNote text="Testnet: the interest is test dollars Kova adds" />
            ) : null}
            {data.beta ? (
              <View style={styles.risk}>
                <Icon name="info" size={16} color={colors.ink} />
                <Txt size={13} style={{ flex: 1, lineHeight: 19 }}>
                  Your savings sit in {data.vault?.name ?? 'a partner’s vault'}, a partner’s vault,
                  in your name. It’s new and hasn’t been audited, and it can pause withdrawals for a
                  while. Only save what you could do without.
                </Txt>
              </View>
            ) : null}
            <View style={styles.toggle}>
              {(canSave ? (['in', 'out'] as const) : (['out'] as const)).map((m) => (
                <Pressable
                  key={m}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: mode === m }}
                  onPress={() => setMode(m)}
                  style={[styles.toggleItem, mode === m && styles.toggleOn]}
                >
                  <Txt weight="semi" size={15} color={mode === m ? colors.onChosen : colors.ink}>
                    {m === 'in' ? 'Move in' : 'Move out'}
                  </Txt>
                </Pressable>
              ))}
            </View>
            <Txt
              weight="semi"
              size={13}
              color={colors.muted}
              style={{ marginTop: 16, marginLeft: 4 }}
            >
              {mode === 'in'
                ? `From your balance (${formatUsd(balance ?? 0n)})`
                : `From savings (${formatUsd(BigInt(data.balance))})`}
            </Txt>
            <View style={styles.money}>
              <Txt weight="bold" size={30}>
                $
              </Txt>
              <TextInput
                value={amount}
                onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ''))}
                placeholder="0.00"
                keyboardType="decimal-pad"
                style={styles.moneyInput}
              />
            </View>
            {limit ? (
              <Txt size={14} color={colors.muted} style={{ marginTop: 10, textAlign: 'center' }}>
                {limit}
              </Txt>
            ) : null}
            {error ? (
              <Txt weight="medium" size={14} color={colors.danger} style={{ marginTop: 10 }}>
                {error}
              </Txt>
            ) : null}
            {done ? (
              <Txt weight="semi" size={14} color={colors.positive} style={{ marginTop: 10 }}>
                {done}
              </Txt>
            ) : null}
            <View style={{ marginTop: 18 }}>
              <PillButton
                label={
                  busy ? 'Moving…' : mode === 'in' ? 'Move into savings' : 'Move to my balance'
                }
                icon={mode === 'in' ? 'down' : 'up'}
                loading={busy}
                disabled={shut || !(Number(amount) > 0)}
                onPress={() => void move()}
              />
            </View>
            {data.moves.length ? (
              <View style={styles.list}>
                {data.moves.map((m, i) => (
                  <View key={m.tx_hash} style={[styles.row, i > 0 && styles.rule]}>
                    <View style={{ flex: 1 }}>
                      <Txt weight="semi" size={15}>
                        {m.kind === 'in' ? 'Into savings' : 'Back to balance'}
                      </Txt>
                      <Txt size={13} color={colors.muted}>
                        {new Date(m.at).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </Txt>
                    </View>
                    <Txt weight="semi" size={15}>
                      {formatUsd(BigInt(m.amount))}
                    </Txt>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 32 },
  eyebrow: { letterSpacing: 1.4, textAlign: 'center', marginTop: 12 },
  rate: { marginTop: 10, gap: 2 },
  risk: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 14,
    padding: 12,
    borderRadius: 16,
    backgroundColor: colors.sunken,
  },
  big: { letterSpacing: -2, textAlign: 'center', marginTop: 4 },
  toggle: {
    flexDirection: 'row',
    marginTop: 22,
    padding: 4,
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  toggleItem: {
    flex: 1,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  toggleOn: { backgroundColor: colors.chosen },
  money: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
    paddingHorizontal: 16,
    height: 64,
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: 20,
    backgroundColor: colors.surface,
  },
  moneyInput: { flex: 1, fontFamily: fonts.bold, fontSize: 30, color: colors.ink },
  list: {
    marginTop: 22,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: 22,
    backgroundColor: colors.surface,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: inkAt(0.18) },
})
