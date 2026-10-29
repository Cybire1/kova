import { parseAmount } from '@kova/monad'
import * as Haptics from 'expo-haptics'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { formatUsd } from '@/lib/money'
import { getSavings, type Savings, saveIn, saveOut } from '@/lib/partners'
import { colors, fonts, inkAt } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Kovi } from '@/ui/art'
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
  /** The most this move can be: your balance or the vault's room in; what can leave now out. */
  const cap = (a: bigint, b: bigint | null) => (b !== null && b < a ? b : a)
  const most = mode === 'in' ? cap(balance ?? 0n, room) : cap(held, outNow)
  const asTyped = (v: bigint) => (Number(v) / 1e6).toFixed(2)

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
          <View style={{ gap: 14, paddingTop: 8 }}>
            <View
              style={styles.card}
              accessibilityLabel={`${formatUsd(held)} in savings, ${formatUsd(BigInt(data.earned))} earned`}
            >
              <Svg
                width={220}
                height={220}
                viewBox="-110 -110 220 220"
                style={styles.rings}
                pointerEvents="none"
              >
                {[104, 78, 52, 26].map((r) => (
                  <Circle key={r} r={r} fill="none" stroke={colors.tealDeep} strokeWidth={2} />
                ))}
              </Svg>
              <View style={styles.kovi} pointerEvents="none">
                <Kovi pose="sleep" size={104} />
              </View>
              <Txt size={14} weight="semi" color={onTeal}>
                In savings
              </Txt>
              <Txt weight="bold" size={46} color={colors.white} style={styles.big}>
                {formatUsd(held).slice(0, formatUsd(held).lastIndexOf('.'))}
                <Txt weight="bold" size={24} color={colors.white}>
                  {formatUsd(held).slice(formatUsd(held).lastIndexOf('.'))}
                </Txt>
              </Txt>
              <Txt size={15} color={onTeal}>
                <Txt weight="bold" size={15} color={colors.white}>
                  +{formatUsd(BigInt(data.earned))}
                </Txt>{' '}
                {data.test ? 'test interest' : 'earned'} on {formatUsd(BigInt(data.deposited))}
              </Txt>
              {data.rate && data.rate.yearly > 0 && !data.test ? (
                <View style={styles.rateChip}>
                  <Icon name="bolt" size={14} color={colors.ink} />
                  <Txt weight="bold" size={13}>
                    About {(data.rate.yearly * 100).toFixed(1)}% a year lately
                  </Txt>
                </View>
              ) : null}
            </View>
            {data.rate && data.rate.yearly > 0 && !data.test ? (
              <Txt size={13} color={colors.muted} style={{ textAlign: 'center' }}>
                What it paid over the last {data.rate.days} days. It changes, and isn’t a promise.
              </Txt>
            ) : null}
            {data.test ? (
              <SandboxNote text="Testnet: the interest is test dollars Kova adds" />
            ) : null}

            <View style={styles.actions}>
              {canSave ? (
                <View style={[{ flex: 1 }, mode !== 'in' && styles.dim]}>
                  <PillButton
                    label="Save"
                    icon="down"
                    tone="coral"
                    onPress={() => {
                      setMode('in')
                      setAmount('')
                      setError(null)
                    }}
                  />
                </View>
              ) : null}
              <View style={[{ flex: 1 }, mode !== 'out' && styles.dim]}>
                <PillButton
                  label="Withdraw"
                  icon="up"
                  tone="white"
                  disabled={held === 0n}
                  onPress={() => {
                    setMode('out')
                    setAmount('')
                    setError(null)
                  }}
                />
              </View>
            </View>

            <View style={styles.move}>
              <Txt weight="semi" size={13} color={colors.muted}>
                {mode === 'in'
                  ? `Save from your balance · ${formatUsd(balance ?? 0n)}`
                  : `Withdraw to your balance · ${formatUsd(held)} saved`}
              </Txt>
              <View style={styles.money}>
                <Txt weight="bold" size={36}>
                  $
                </Txt>
                <TextInput
                  value={amount}
                  editable={!shut}
                  onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ''))}
                  placeholder="0.00"
                  placeholderTextColor={colors.muted}
                  keyboardType="decimal-pad"
                  accessibilityLabel={mode === 'in' ? 'Amount to save' : 'Amount to withdraw'}
                  style={styles.moneyInput}
                />
              </View>
              {shut ? null : (
                <View style={styles.quick}>
                  {(mode === 'in' ? [10_000_000n, 50_000_000n] : [])
                    .filter((v) => v < most)
                    .map((v) => (
                      <Pressable
                        key={String(v)}
                        accessibilityRole="button"
                        onPress={() => setAmount(asTyped(v))}
                        style={styles.quickItem}
                      >
                        <Txt weight="bold" size={13}>
                          {formatUsd(v)}
                        </Txt>
                      </Pressable>
                    ))}
                  {most > 0n ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setAmount(asTyped(most))}
                      style={styles.quickItem}
                    >
                      <Txt weight="bold" size={13}>
                        All {formatUsd(most)}
                      </Txt>
                    </Pressable>
                  ) : null}
                </View>
              )}
              {limit ? (
                <View style={styles.limit}>
                  <Txt size={13} style={{ lineHeight: 18 }}>
                    {limit}
                  </Txt>
                </View>
              ) : null}
              {error ? (
                <Txt weight="medium" size={14} color={colors.danger}>
                  {error}
                </Txt>
              ) : null}
              {done ? (
                <Txt weight="semi" size={14} color={colors.positive}>
                  {done}
                </Txt>
              ) : null}
              <PillButton
                label={
                  busy
                    ? 'Moving…'
                    : `${mode === 'in' ? 'Save' : 'Withdraw'}${Number(amount) > 0 ? ` $${Number(amount).toFixed(2)}` : ''}`
                }
                icon="face"
                tone={mode === 'in' ? 'coral' : 'ink'}
                loading={busy}
                disabled={shut || !(Number(amount) > 0)}
                onPress={() => void move()}
              />
              <Txt size={12} color={colors.muted} style={{ textAlign: 'center' }}>
                One Face ID tap. Kova covers the fee.
              </Txt>
            </View>

            <Txt weight="bold" size={20} style={{ marginTop: 10 }}>
              Where it sits
            </Txt>
            <View style={styles.path}>
              {(
                [
                  ['user', 'Your wallet', 'Signs every move', colors.fill],
                  ['lock', data.vault?.name ?? 'Savings vault', 'Held in your name', colors.teal],
                  ['web', 'Lending markets', 'Where it earns', colors.coral],
                ] as const
              ).map(([icon, title, sub, fill]) => (
                <View key={title} style={styles.node}>
                  <View style={[styles.nodeDot, { backgroundColor: fill }]}>
                    <Icon name={icon} size={17} color={colors.white} />
                  </View>
                  <Txt weight="bold" size={13} style={{ textAlign: 'center' }}>
                    {title}
                  </Txt>
                  <Txt size={11} color={colors.muted} style={{ textAlign: 'center' }}>
                    {sub}
                  </Txt>
                </View>
              ))}
            </View>
            {data.beta ? (
              <View style={styles.risk}>
                <Icon name="info" size={16} color={colors.ink} />
                <Txt size={13} style={{ flex: 1, lineHeight: 19 }}>
                  New, and not audited yet. Withdrawals can pause for a while if a market it lends
                  to stops reporting. Only save what you could do without.
                </Txt>
              </View>
            ) : null}

            {data.moves.length ? (
              <>
                <Txt weight="bold" size={20} style={{ marginTop: 10 }}>
                  Moves
                </Txt>
                <View style={styles.list}>
                  {data.moves.map((m, i) => (
                    <View key={m.tx_hash} style={[styles.row, i > 0 && styles.rule]}>
                      <View
                        style={[
                          styles.moveIcon,
                          { backgroundColor: m.kind === 'in' ? colors.coralSoft : colors.tealSoft },
                        ]}
                      >
                        <Icon name={m.kind === 'in' ? 'down' : 'up'} size={16} color={colors.ink} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Txt weight="semi" size={15}>
                          {m.kind === 'in' ? 'Saved' : 'Withdrew'}
                        </Txt>
                        <Txt size={13} color={colors.muted}>
                          {new Date(m.at).toLocaleDateString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                          })}
                        </Txt>
                      </View>
                      <Txt weight="bold" size={15}>
                        {m.kind === 'in' ? '+' : '−'}
                        {formatUsd(BigInt(m.amount))}
                      </Txt>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </View>
        )}
      </ScrollView>
    </Screen>
  )
}

/** Text on the teal card, as on Home's balance card. */
const onTeal = '#DCEBEA'

const styles = StyleSheet.create({
  body: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 32 },
  card: {
    minHeight: 180,
    borderRadius: 30,
    backgroundColor: colors.teal,
    borderWidth: 2,
    borderColor: colors.line,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 18,
    overflow: 'hidden',
    gap: 2,
  },
  rings: { position: 'absolute', right: -70, top: -70, opacity: 0.55 },
  kovi: { position: 'absolute', right: -6, bottom: -14 },
  big: { letterSpacing: -2 },
  rateChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 12,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surface,
  },
  actions: { flexDirection: 'row', gap: 10 },
  dim: { opacity: 0.6 },
  move: {
    gap: 12,
    padding: 16,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  money: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  moneyInput: { flex: 1, fontFamily: fonts.bold, fontSize: 36, color: colors.ink },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quickItem: {
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    backgroundColor: colors.sunken,
  },
  limit: { padding: 12, borderRadius: 14, backgroundColor: colors.sunken },
  path: { flexDirection: 'row', gap: 8 },
  node: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderRadius: 18,
    backgroundColor: colors.surface,
  },
  nodeDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  risk: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 16,
    backgroundColor: colors.sunken,
  },
  list: { paddingHorizontal: 16, borderRadius: 22, backgroundColor: colors.surface },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: inkAt(0.18) },
  moveIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
