import * as Haptics from 'expo-haptics'
import { useFocusEffect } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useState } from 'react'
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { isAddress } from 'viem'
import {
  addSupplier,
  listSupplierPayments,
  listSuppliers,
  type Supplier,
  type SupplierPayment,
} from '@/lib/api'
import { amountOk, paySupplier, shortAddress, usd, whenLabel } from '@/lib/business'
import { type DisplayCurrency, displayCurrencies, formatLocal } from '@/lib/money'
import { ratesLive } from '@/lib/rates'
import { useShop } from '@/lib/shop'
import { useStall } from '@/lib/stall'
import { colors, inkAt } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Kovi } from '@/ui/art'
import {
  Avatar,
  businessStyles,
  Card,
  Field,
  PayButton,
  Problem,
  SectionTitle,
} from '@/ui/Business'
import { Icon } from '@/ui/Icon'
import { Header, Screen, Txt } from '@/ui/primitives'

const words = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'That didn’t work. Try again.'
const isDisplay = (c: string): c is DisplayCurrency =>
  (displayCurrencies as readonly string[]).includes(c)

/** Suppliers: who the business buys from, anywhere, paid in seconds, in what they think in. */
export default function Suppliers() {
  const shop = useShop()
  const { owned } = useStall()
  const wallet = useWallet()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [payments, setPayments] = useState<SupplierPayment[]>([])
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<{
    name: string
    wallet: string
    country: string
    currency: DisplayCurrency
  }>({
    name: '',
    wallet: '',
    country: '',
    currency: 'USD',
  })
  const [open, setOpen] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [paid, setPaid] = useState<{
    supplier: string
    ms: number
    payment: SupplierPayment
  } | null>(null)

  const load = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([listSuppliers(), listSupplierPayments()])
      setSuppliers(s)
      setPayments(p)
      if (!s.length) setAdding(true)
    } catch (error) {
      setProblem(words(error))
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      if (owned) void load()
    }, [owned, load]),
  )

  const add = async () => {
    setProblem(null)
    if (!draft.name.trim()) return setProblem('Who is it? Add their name.')
    if (!isAddress(draft.wallet.trim()))
      return setProblem(
        'That wallet address isn’t right: it starts with 0x and has 40 more characters.',
      )
    setBusy(true)
    try {
      const added = await addSupplier({
        name: draft.name.trim(),
        wallet_address: draft.wallet.trim(),
        country: draft.country.trim() || null,
        currency: draft.currency,
      })
      setSuppliers((list) =>
        [...list.filter((s) => s.id !== added.id), added].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      )
      setDraft({ name: '', wallet: '', country: '', currency: 'USD' })
      setAdding(false)
      setOpen(added.id)
    } catch (error) {
      setProblem(words(error))
    } finally {
      setBusy(false)
    }
  }

  const pay = async (supplier: Supplier) => {
    setProblem(null)
    if (!amountOk(amount)) return setProblem('How much? In dollars, like 120 or 45.50.')
    if (wallet.balance !== null && Number(wallet.balance) / 1e6 + 1e-9 < Number(amount))
      return setProblem(
        `${shop.name}’s wallet has ${usd(Number(wallet.balance) / 1e6)}, and this needs ${usd(amount)}. Add money first.`,
      )
    setBusy(true)
    try {
      const result = await paySupplier({
        approve: wallet.approve,
        supplier,
        amount: Number(amount).toFixed(2),
        note,
      })
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setPaid({ supplier: supplier.id, ms: result.ms, payment: result.payment })
      setAmount('')
      setNote('')
      await load()
      void wallet.refresh()
    } catch (error) {
      setProblem(words(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen edges={['top']}>
      <Header title="Suppliers" subtitle="Pay anyone, anywhere" />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 60 }}
          keyboardShouldPersistTaps="handled"
        >
          {!owned ? (
            <View style={styles.empty}>
              <Kovi pose="key" size={130} />
              <Txt size={15} color={colors.muted} style={{ textAlign: 'center', lineHeight: 21 }}>
                Suppliers belong to the shop’s owner. Open them on the phone whose wallet owns{' '}
                {shop.name}.
              </Txt>
            </View>
          ) : (
            <>
              <Problem text={problem} />
              {suppliers.length ? (
                <Card style={{ marginTop: problem ? 12 : 0 }}>
                  {suppliers.map((s, i) => {
                    const expanded = open === s.id
                    const local =
                      isDisplay(s.currency) && s.currency !== 'USD' && Number(amount) > 0
                        ? formatLocal(Number(amount), s.currency)
                        : null
                    return (
                      <View
                        key={s.id}
                        style={[
                          i > 0 && businessStyles.rule,
                          expanded && { backgroundColor: colors.raised },
                        ]}
                      >
                        <View style={businessStyles.row}>
                          <Avatar name={s.name} tint={colors.coralSoft} />
                          <View style={{ flex: 1 }}>
                            <Txt weight="semi" size={15} numberOfLines={1}>
                              {s.name}
                            </Txt>
                            <Txt size={12} color={colors.muted} numberOfLines={1}>
                              {s.country ? `${s.country} · ` : ''}
                              {s.currency !== 'USD' ? `${s.currency} · ` : ''}
                              {s.payments ? `${usd(s.paid_total)} paid` : 'Not paid yet'}
                            </Txt>
                          </View>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={expanded ? `Close ${s.name}` : `Pay ${s.name}`}
                            onPress={() => {
                              setOpen(expanded ? null : s.id)
                              setPaid(null)
                              setProblem(null)
                            }}
                            style={[styles.mini, !expanded && { backgroundColor: colors.fill }]}
                          >
                            <Txt
                              weight="semi"
                              size={13}
                              color={expanded ? colors.ink : colors.white}
                            >
                              {expanded ? 'Close' : 'Pay'}
                            </Txt>
                          </Pressable>
                        </View>
                        {expanded ? (
                          <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 10 }}>
                            <Field
                              accessibilityLabel={`Amount for ${s.name} in dollars`}
                              placeholder="$0.00"
                              value={amount}
                              onChangeText={(v) => setAmount(v.replace(/[^\d.]/g, ''))}
                              keyboardType="decimal-pad"
                              editable={!busy}
                              style={{ height: 60, fontSize: 26 }}
                            />
                            <Txt size={14} color={colors.muted}>
                              {local ? (
                                <>
                                  {s.name.split(' ')[0]} gets about{' '}
                                  <Txt weight="bold" size={14}>
                                    {local}
                                  </Txt>{' '}
                                  · {ratesLive() ? 'market rate' : 'reference rate'}
                                </>
                              ) : (
                                `To ${shortAddress(s.wallet_address)}, in dollars`
                              )}
                            </Txt>
                            <Field
                              placeholder="What it’s for (optional)"
                              value={note}
                              onChangeText={setNote}
                              maxLength={140}
                            />
                            <PayButton
                              label={
                                busy ? 'Paying…' : `Pay ${amountOk(amount) ? usd(amount) : ''}`
                              }
                              icon="send"
                              onPress={() => void pay(s)}
                              disabled={!amountOk(amount)}
                              busy={busy}
                            />
                            {paid && paid.supplier === s.id ? (
                              <Pressable
                                onPress={() =>
                                  void WebBrowser.openBrowserAsync(paid.payment.explorer_url)
                                }
                                style={styles.paid}
                              >
                                <Icon name="check" size={16} color={colors.tealDeep} />
                                <Txt weight="semi" size={14} color={colors.tealDeep}>
                                  Paid {usd(paid.payment.amount)} in {(paid.ms / 1000).toFixed(2)} s
                                  · See proof
                                </Txt>
                              </Pressable>
                            ) : null}
                          </View>
                        ) : null}
                      </View>
                    )
                  })}
                </Card>
              ) : null}

              {adding ? (
                <Card style={{ marginTop: 12, padding: 14, gap: 10 }}>
                  <Txt weight="bold" size={16}>
                    Add a supplier
                  </Txt>
                  <Field
                    placeholder="Name, like Shenzhen Parts Co"
                    value={draft.name}
                    onChangeText={(v) => setDraft((d) => ({ ...d, name: v }))}
                    maxLength={80}
                  />
                  <Field
                    placeholder="Their wallet (0x…)"
                    value={draft.wallet}
                    onChangeText={(v) => setDraft((d) => ({ ...d, wallet: v.trim() }))}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Field
                    placeholder="Country"
                    value={draft.country}
                    onChangeText={(v) => setDraft((d) => ({ ...d, country: v }))}
                    maxLength={60}
                  />
                  <Txt weight="semi" size={14}>
                    Show their amounts in
                  </Txt>
                  <View style={styles.chips}>
                    {displayCurrencies.map((c) => {
                      const on = c === draft.currency
                      return (
                        <Pressable
                          key={c}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: on }}
                          onPress={() => setDraft((d) => ({ ...d, currency: c }))}
                          style={[styles.chip, on && { backgroundColor: colors.chosen }]}
                        >
                          <Txt weight="semi" size={13} color={on ? colors.onChosen : colors.ink}>
                            {c}
                          </Txt>
                        </Pressable>
                      )
                    })}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void add()}
                      disabled={busy}
                      style={[styles.small, { backgroundColor: colors.fill }]}
                    >
                      <Txt weight="semi" size={14} color={colors.white}>
                        Save supplier
                      </Txt>
                    </Pressable>
                    {suppliers.length ? (
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
                  style={styles.addOpen}
                >
                  <Icon name="plus" size={18} />
                  <Txt weight="semi" size={15}>
                    Add a supplier
                  </Txt>
                </Pressable>
              )}

              <SectionTitle>Payments</SectionTitle>
              {payments.length ? (
                <Card>
                  {payments.map((p, i) => (
                    <Pressable
                      key={p.id}
                      accessibilityRole="link"
                      onPress={() => void WebBrowser.openBrowserAsync(p.explorer_url)}
                      style={({ pressed }) => [
                        businessStyles.row,
                        i > 0 && businessStyles.rule,
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Txt weight="semi" size={15} numberOfLines={1}>
                          {p.supplier_name ?? 'Supplier'}
                        </Txt>
                        <Txt size={12} color={colors.muted} numberOfLines={1}>
                          {whenLabel(p.paid_at)}
                          {p.note ? ` · ${p.note}` : ''}
                        </Txt>
                      </View>
                      <Txt weight="bold" size={15}>
                        {usd(p.amount)}
                      </Txt>
                    </Pressable>
                  ))}
                </Card>
              ) : (
                <Txt size={14} color={colors.muted} style={{ lineHeight: 20 }}>
                  Every payment to a supplier lands here once it’s confirmed.
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
  mini: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: colors.sunken,
    justifyContent: 'center',
  },
  paid: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: colors.line,
    justifyContent: 'center',
  },
  small: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.line,
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
    borderColor: inkAt(0.35),
  },
})
