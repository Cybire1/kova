import * as Haptics from 'expo-haptics'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { isAddress } from 'viem'
import {
  addPayrollPerson,
  listPayrollPeople,
  listPayrollRuns,
  type PayrollPerson,
  type PayrollRun,
  removePayrollPerson,
  startPayrollRun,
} from '@/lib/api'
import {
  amountOk,
  type LineState,
  monthName,
  payPayroll,
  type Reach,
  reachOf,
  shortAddress,
  usd,
  whenLabel,
} from '@/lib/business'
import { useShop } from '@/lib/shop'
import { useStall } from '@/lib/stall'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Kovi } from '@/ui/art'
import {
  Avatar,
  businessStyles,
  Card,
  Field,
  LineIcon,
  PayButton,
  Problem,
  ReachText,
  SectionTitle,
} from '@/ui/Business'
import { Icon } from '@/ui/Icon'
import { Header, Screen, Txt } from '@/ui/primitives'

const words = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'That didn’t work. Try again.'

/**
 * Payroll: the people the business pays, a run approved with one Face ID where everyone is paid
 * privately, live as each payment lands, and every past run.
 */
export default function Payroll() {
  const shop = useShop()
  const { owned } = useStall()
  const wallet = useWallet()
  const [people, setPeople] = useState<PayrollPerson[]>([])
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [reach, setReach] = useState<Record<string, Reach>>({})
  const [label, setLabel] = useState(`${monthName()} salary`)
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [left, setLeft] = useState<Record<string, boolean>>({})
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ name: '', wallet: '', amount: '' })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [paying, setPaying] = useState<{
    run: PayrollRun
    lines: Record<string, LineState>
  } | null>(null)

  const load = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([listPayrollPeople(), listPayrollRuns()])
      setPeople(p)
      setRuns(r)
      setAmounts((a) => ({ ...Object.fromEntries(p.map((x) => [x.id, x.amount ?? ''])), ...a }))
      if (!p.length) setAdding(true)
    } catch (error) {
      setProblem(words(error))
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      if (owned) void load()
    }, [owned, load]),
  )

  useEffect(() => {
    if (!people.length) return
    void reachOf(people.map((p) => p.wallet_address)).then((found) =>
      setReach((r) => ({ ...r, ...found })),
    )
  }, [people])

  const reachFor = (p: PayrollPerson) => reach[p.wallet_address.toLowerCase()]
  const included = people.filter(
    (p) => !left[p.id] && reachFor(p) === 'private' && amountOk(amounts[p.id] ?? ''),
  )
  const total = included.reduce((sum, p) => sum + Number(amounts[p.id] ?? 0), 0)

  const add = async () => {
    setProblem(null)
    if (!draft.name.trim()) return setProblem('Who is it? Add their name.')
    if (!isAddress(draft.wallet.trim()))
      return setProblem(
        'That wallet address isn’t right: it starts with 0x and has 40 more characters.',
      )
    if (draft.amount && !amountOk(draft.amount))
      return setProblem('Their usual pay is in dollars, like 250 or 12.50.')
    setBusy(true)
    try {
      const added = await addPayrollPerson({
        name: draft.name.trim(),
        wallet_address: draft.wallet.trim(),
        amount: draft.amount || null,
      })
      setPeople((list) =>
        [...list.filter((p) => p.id !== added.id), added].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      )
      setAmounts((a) => ({ ...a, [added.id]: added.amount ?? '' }))
      setDraft({ name: '', wallet: '', amount: '' })
      setAdding(false)
    } catch (error) {
      setProblem(words(error))
    } finally {
      setBusy(false)
    }
  }

  const pay = async () => {
    if (!included.length) return
    setProblem(null)
    // Before anything is signed: the wallet has to cover everyone, or nobody is half-paid.
    if (wallet.balance !== null && Number(wallet.balance) / 1e6 + 1e-9 < total)
      return setProblem(
        `${shop.name}’s wallet has ${usd(Number(wallet.balance) / 1e6)}, and this needs ${usd(total)}. Add money first, so nobody is paid halfway.`,
      )
    setBusy(true)
    try {
      const run = await startPayrollRun(
        label.trim() || `${monthName()} salary`,
        included.map((p) => ({
          person: p.id,
          name: p.name,
          amount: Number(amounts[p.id]).toFixed(2),
        })),
      )
      const wallets: Record<string, string> = {}
      for (const payment of run.payments) {
        const who = included.find((p) => p.id === payment.person)
        if (who) wallets[payment.id] = who.wallet_address
      }
      setPaying({
        run,
        lines: Object.fromEntries(
          run.payments.map((p) => [p.id, { state: 'waiting' } as LineState]),
        ),
      })
      await payPayroll({
        approve: wallet.approve,
        business: shop.name,
        run,
        wallets,
        onLine: (id, state) =>
          setPaying((now) => (now ? { ...now, lines: { ...now.lines, [id]: state } } : now)),
      })
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setRuns(await listPayrollRuns())
      void wallet.refresh()
    } catch (error) {
      setProblem(words(error))
    } finally {
      setBusy(false)
    }
  }

  const lines = paying ? Object.values(paying.lines) : []
  const paidCount = lines.filter((l) => l.state === 'paid').length
  const done = paying !== null && lines.every((l) => l.state === 'paid' || l.state === 'failed')
  const picks = wallet.contacts
    .filter((c) => !people.some((p) => p.wallet_address.toLowerCase() === c.address.toLowerCase()))
    .slice(0, 6)

  return (
    <Screen edges={['top']}>
      <Header title="Payroll" subtitle="Paid privately" />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 60 }}
          keyboardShouldPersistTaps="handled"
        >
          {!owned ? (
            <View style={styles.empty}>
              <Kovi pose="key" size={130} />
              <Txt size={15} color={colors.muted} style={{ textAlign: 'center', lineHeight: 21 }}>
                Payroll belongs to the shop’s owner. Open it on the phone whose wallet owns{' '}
                {shop.name}.
              </Txt>
            </View>
          ) : (
            <>
              <Field
                label="What it’s for"
                value={label}
                onChangeText={setLabel}
                maxLength={60}
                editable={!busy}
              />
              <Txt size={13} color={colors.muted} style={{ marginTop: 6 }}>
                It travels sealed with each payment, so they see why they were paid.
              </Txt>

              <SectionTitle
                right={
                  <Txt size={14} color={colors.muted}>
                    {included.length} {included.length === 1 ? 'person' : 'people'} · {usd(total)}
                  </Txt>
                }
              >
                Who you pay
              </SectionTitle>

              {people.length ? (
                <Card>
                  {people.map((p, i) => {
                    const r = reachFor(p)
                    const on = !left[p.id] && r === 'private'
                    return (
                      <View
                        key={p.id}
                        style={[
                          businessStyles.row,
                          i > 0 && businessStyles.rule,
                          !on && { opacity: 0.6 },
                        ]}
                      >
                        <Pressable
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: on, disabled: r !== 'private' }}
                          accessibilityLabel={`Pay ${p.name}`}
                          disabled={busy || r !== 'private'}
                          onPress={() => setLeft((l) => ({ ...l, [p.id]: on }))}
                          style={[styles.check, on && styles.checkOn]}
                        >
                          {on ? <Icon name="check" size={14} color={colors.white} /> : null}
                        </Pressable>
                        <Avatar name={p.name} />
                        <Pressable
                          style={{ flex: 1 }}
                          onLongPress={() => void removePayrollPerson(p.id).then(load)}
                          accessibilityHint="Long press to take them off the payroll"
                        >
                          <Txt weight="semi" size={15} numberOfLines={1}>
                            {p.name}
                          </Txt>
                          <Txt size={12} color={colors.muted} numberOfLines={1}>
                            {shortAddress(p.wallet_address)}
                          </Txt>
                          <ReachText reach={r} />
                        </Pressable>
                        <TextInput
                          accessibilityLabel={`${p.name}’s pay in dollars`}
                          value={amounts[p.id] ?? ''}
                          onChangeText={(v) =>
                            setAmounts((a) => ({ ...a, [p.id]: v.replace(/[^\d.]/g, '') }))
                          }
                          placeholder="$0.00"
                          placeholderTextColor={colors.muted}
                          keyboardType="decimal-pad"
                          editable={!busy}
                          style={businessStyles.amount}
                        />
                      </View>
                    )
                  })}
                </Card>
              ) : null}

              {adding ? (
                <Card style={{ marginTop: 12, padding: 14, gap: 10 }}>
                  <Txt weight="bold" size={16}>
                    Add someone you pay
                  </Txt>
                  {picks.length ? (
                    <View style={styles.picks}>
                      {picks.map((c) => (
                        <Pressable
                          key={c.address}
                          accessibilityRole="button"
                          accessibilityLabel={`Use ${c.name}`}
                          onPress={() =>
                            setDraft((d) => ({ ...d, name: c.name, wallet: c.address }))
                          }
                          style={styles.pick}
                        >
                          <Txt weight="semi" size={13}>
                            {c.name}
                          </Txt>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                  <Field
                    placeholder="Their name"
                    value={draft.name}
                    onChangeText={(v) => setDraft((d) => ({ ...d, name: v }))}
                    maxLength={60}
                  />
                  <Field
                    placeholder="Their Kova wallet (0x…)"
                    value={draft.wallet}
                    onChangeText={(v) => setDraft((d) => ({ ...d, wallet: v.trim() }))}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Field
                    placeholder="Usual pay ($)"
                    value={draft.amount}
                    onChangeText={(v) =>
                      setDraft((d) => ({ ...d, amount: v.replace(/[^\d.]/g, '') }))
                    }
                    keyboardType="decimal-pad"
                  />
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void add()}
                      disabled={busy}
                      style={[styles.small, { backgroundColor: colors.ink }]}
                    >
                      <Txt weight="semi" size={14} color={colors.white}>
                        Add to payroll
                      </Txt>
                    </Pressable>
                    {people.length ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setAdding(false)}
                        style={styles.small}
                      >
                        <Txt weight="semi" size={14}>
                          Cancel
                        </Txt>
                      </Pressable>
                    ) : null}
                  </View>
                </Card>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setAdding(true)}
                  disabled={busy}
                  style={styles.addOpen}
                >
                  <Icon name="plus" size={18} />
                  <Txt weight="semi" size={15}>
                    Add someone you pay
                  </Txt>
                </Pressable>
              )}

              <View style={{ marginTop: 16, gap: 12 }}>
                <Problem text={problem} />
                <Txt size={13} color={colors.muted} style={{ lineHeight: 19 }}>
                  {people.some((p) => reachFor(p) === 'none')
                    ? 'People who can’t receive privately yet open Kova once to turn it on. Long-press someone to take them off.'
                    : 'One Face ID approves everyone. Kova pays the gas. Long-press someone to take them off.'}
                </Txt>
                <PayButton
                  label={
                    busy && paying
                      ? `Paying ${paidCount} of ${lines.length}…`
                      : `Pay ${included.length || ''} privately · ${usd(total)}`
                  }
                  onPress={() => void pay()}
                  disabled={included.length === 0}
                  busy={busy}
                />
              </View>

              {paying ? (
                <Card style={{ marginTop: 14 }}>
                  <View style={[businessStyles.row, { justifyContent: 'space-between' }]}>
                    <Txt weight="bold" size={15}>
                      {done
                        ? `${paidCount} of ${lines.length} paid privately`
                        : `Paying ${paying.run.label}…`}
                    </Txt>
                    {done ? (
                      <Pressable
                        onPress={() =>
                          router.push({
                            pathname: '/terminal/payroll-run',
                            params: { id: paying.run.id },
                          })
                        }
                      >
                        <Txt weight="semi" size={14} color={colors.tealDeep}>
                          Receipt
                        </Txt>
                      </Pressable>
                    ) : null}
                  </View>
                  {paying.run.payments.map((p) => {
                    const line = paying.lines[p.id]
                    return (
                      <View key={p.id} style={[businessStyles.row, businessStyles.rule]}>
                        <LineIcon state={line?.state} />
                        <View style={{ flex: 1 }}>
                          <Txt weight="semi" size={15} numberOfLines={1}>
                            {p.name}
                          </Txt>
                          {line?.state === 'paid' ? (
                            <Txt size={12} color={colors.muted}>
                              Paid privately in {(line.ms / 1000).toFixed(2)} s
                            </Txt>
                          ) : line?.state === 'failed' ? (
                            <Txt size={12} color={colors.coralDeep}>
                              {line.why}
                            </Txt>
                          ) : null}
                        </View>
                        <Txt weight="bold" size={15}>
                          {usd(p.amount)}
                        </Txt>
                      </View>
                    )
                  })}
                </Card>
              ) : null}

              <SectionTitle>Past payrolls</SectionTitle>
              {runs.length ? (
                <Card>
                  {runs.map((r, i) => (
                    <Pressable
                      key={r.id}
                      accessibilityRole="button"
                      onPress={() =>
                        router.push({ pathname: '/terminal/payroll-run', params: { id: r.id } })
                      }
                      style={({ pressed }) => [
                        businessStyles.row,
                        i > 0 && businessStyles.rule,
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Txt weight="semi" size={15} numberOfLines={1}>
                          {r.label}
                        </Txt>
                        <Txt size={12} color={colors.muted}>
                          {whenLabel(r.created_at)} · {r.paid} of {r.people} paid
                        </Txt>
                      </View>
                      <Txt weight="bold" size={15}>
                        {usd(r.paid_total)}
                      </Txt>
                      <Icon name="arrow" size={18} />
                    </Pressable>
                  ))}
                </Card>
              ) : (
                <Txt size={14} color={colors.muted} style={{ lineHeight: 20 }}>
                  Your first payroll shows up here, with a receipt for each person.
                </Txt>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', gap: 12, paddingTop: 60, paddingHorizontal: 12 },
  check: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.tealDeep, borderColor: colors.tealDeep },
  picks: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pick: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    backgroundColor: colors.tealSoft,
    justifyContent: 'center',
  },
  small: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addOpen: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    marginTop: 12,
    borderRadius: 18,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(11,26,29,0.35)',
  },
})
