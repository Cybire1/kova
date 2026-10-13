import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { naira, type NairaBank, type NairaInfo } from '@/lib/api'
import type { CashOutToPay } from '@/lib/chain'
import { chainName } from '@/lib/config'
import { applyKey, formatUsd, groupTyped, type Key, toBase } from '@/lib/money'
import { useSessionCovers } from '@/lib/session'
import { colors, fonts } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Kovi } from '@/ui/art'
import { Icon } from '@/ui/Icon'
import { Keypad } from '@/ui/Keypad'
import { Header, PillButton, Screen, Txt } from '@/ui/primitives'
import { SlideToSend } from '@/ui/send/SlideToSend'

type Step = 'amount' | 'account' | 'review' | 'done'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const dollars = (base: bigint) => (Number(base) / 1e6).toFixed(2)

/**
 * Cashing out to naira (the API's services/naira.ts): dollars from this wallet to any Nigerian
 * bank account, through Paystack. How much (with what they'd get as you type), which account (the
 * bank says whose it is), the quote, slide. The wallet signs exactly the quote's transfer to
 * Kova's treasury, Kova pays the gas, and the screen follows the bank until the naira is there,
 * or says the dollars came back. The web's twin is /wallet/cash-out/naira.
 */
export default function CashOutScreen() {
  const { balance, profile, cashOutNaira } = useWallet()
  const [info, setInfo] = useState<NairaInfo | null>(null)
  const [step, setStep] = useState<Step>('amount')
  const [typed, setTyped] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [banks, setBanks] = useState<NairaBank[] | null>(null)
  const [search, setSearch] = useState('')
  const [bank, setBank] = useState<NairaBank | null>(null)
  const [account, setAccount] = useState('')
  const [named, setNamed] = useState<{ number: string; name: string } | null>(null)
  const [looking, setLooking] = useState(false)
  const [quote, setQuote] = useState<CashOutToPay | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const quick = useSessionCovers(quote ? BigInt(quote.pay.value) : 0n)

  useEffect(() => {
    void naira.info().then(setInfo)
  }, [])

  const onKey = useCallback((key: Key) => setTyped((v) => applyKey(v, key, 2)), [])
  const amount = useMemo(() => {
    try {
      return typed && Number(typed) > 0 ? toBase(Number(typed).toFixed(2)) : 0n
    } catch {
      return 0n
    }
  }, [typed])
  const over = balance !== null && amount > balance
  const tooSmall = amount > 0n && amount < 1_000_000n

  useEffect(() => {
    if (amount < 1_000_000n || !info?.enabled) return setPreview(null)
    const id = setTimeout(() => {
      void naira
        .quote(dollars(amount), 'out')
        .then((q) => setPreview(q.naira))
        .catch(() => setPreview(null))
    }, 250)
    return () => clearTimeout(id)
  }, [amount, info?.enabled])

  useEffect(() => {
    if (step !== 'account' || banks) return
    void naira
      .banks()
      .then(setBanks)
      .catch((e: Error) => setProblem(e.message))
  }, [banks, step])

  useEffect(() => {
    setNamed(null)
    if (!bank || !/^\d{10}$/.test(account)) return
    setLooking(true)
    setProblem(null)
    void naira
      .accountName(account, bank.code)
      .then((name) => setNamed({ number: account, name }))
      .catch((e: Error) => setProblem(e.message))
      .finally(() => setLooking(false))
  }, [account, bank])

  const shown = useMemo(() => {
    if (!banks) return []
    const q = search.trim().toLowerCase()
    return (q ? banks.filter((b) => b.name.toLowerCase().includes(q)) : banks).slice(0, 30)
  }, [banks, search])

  const review = async () => {
    if (!bank || !named || !profile) return
    setBusy(true)
    setProblem(null)
    try {
      setQuote(await naira.cashOut(profile.address, { amount: dollars(amount), bankCode: bank.code, accountNumber: named.number }))
      setStep('review')
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Kova didn’t answer. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const go = async () => {
    if (!quote) return
    setBusy(true)
    setProblem(null)
    try {
      let result: CashOutToPay = await cashOutNaira(quote)
      void Haptics.notificationAsync(
        result.status === 'failed' ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success,
      )
      setQuote(result)
      setStep('done')
      for (let i = 0; i < 20 && (result.status === 'paying' || result.status === 'received'); i++) {
        await wait(3000)
        result = await naira.cashOutStatus(quote.id)
        setQuote(result)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'It didn’t go through. Nothing moved.'
      if (!/cancel/i.test(message)) setProblem(message)
    } finally {
      setBusy(false)
    }
  }

  if (info && !info.enabled)
    return (
      <Screen>
        <Header title="Cash out to naira" backIcon="close" />
        <View style={styles.done}>
          <Kovi pose="sleep" size={140} />
          <Txt weight="bold" size={22} style={{ textAlign: 'center' }}>
            Naira isn’t on here yet
          </Txt>
          <Txt color={colors.muted} style={{ textAlign: 'center' }}>
            Cashing out to a Nigerian bank opens on this server soon.
          </Txt>
        </View>
      </Screen>
    )

  return (
    <Screen>
      <Header
        title={step === 'done' ? undefined : 'Cash out to naira'}
        backIcon={step === 'amount' || step === 'done' ? 'close' : 'back'}
        onBack={
          busy
            ? null
            : step === 'account'
              ? () => setStep('amount')
              : step === 'review'
                ? () => setStep('account')
                : () => router.back()
        }
      />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        {step === 'amount' ? (
          <View style={styles.flow}>
            <View style={styles.route}>
              <View style={styles.naira}>
                <Txt weight="bold" size={18} color={colors.white}>
                  ₦
                </Txt>
              </View>
              <Txt size={14} color={colors.muted} style={{ flex: 1 }}>
                To any Nigerian bank, through Paystack
                {info?.cash_out_rate ? `, at ₦${Number(info.cash_out_rate).toLocaleString('en-NG', { maximumFractionDigits: 2 })} per $1` : ''}
              </Txt>
            </View>
            <View style={styles.typed}>
              <Txt weight="semi" size={30} color={colors.muted} style={{ marginTop: 10 }}>
                $
              </Txt>
              <Txt weight="bold" size={64} exact>
                {groupTyped(typed) || '0'}
              </Txt>
            </View>
            <View style={styles.pills}>
              {preview && !over ? (
                <View style={[styles.pill, { backgroundColor: colors.tealSoft }]}>
                  <Txt weight="semi" size={14}>
                    They get ≈ {preview}
                  </Txt>
                </View>
              ) : null}
              {balance !== null ? (
                <View style={[styles.pill, over && { backgroundColor: colors.coralSoft }]}>
                  <Txt weight="semi" size={14} color={over ? colors.danger : colors.onTint}>
                    {over ? `You have ${formatUsd(balance)}` : `${formatUsd(balance)} available`}
                  </Txt>
                </View>
              ) : null}
            </View>
            <View style={{ flex: 1 }} />
            <Keypad onKey={onKey} />
            <View style={{ marginTop: 14 }}>
              <PillButton
                label={over ? 'More than you have' : tooSmall ? 'At least $1' : 'Choose the account'}
                disabled={amount === 0n || over || tooSmall}
                onPress={() => setStep('account')}
              />
            </View>
          </View>
        ) : null}

        {step === 'account' ? (
          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            <Txt weight="bold" size={22}>
              Which account?
            </Txt>
            {bank ? (
              <Pressable onPress={() => setBank(null)} style={styles.bankPick} accessibilityLabel={`${bank.name}, change bank`}>
                <View style={styles.bankBadge}>
                  <Icon name="web" size={17} color={colors.white} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt weight="bold" size={15}>
                    {bank.name}
                  </Txt>
                  <Txt size={13} color={colors.muted}>
                    Change bank
                  </Txt>
                </View>
              </Pressable>
            ) : (
              <Field label="Bank">
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search your bank"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                />
                <View style={styles.bankList}>
                  {banks === null ? (
                    <Txt color={colors.muted} style={{ padding: 12 }}>
                      Loading banks…
                    </Txt>
                  ) : (
                    shown.map((b, i) => (
                      <Pressable
                        key={`${b.code}-${b.name}`}
                        onPress={() => setBank(b)}
                        style={[styles.bankRow, i < shown.length - 1 && styles.rule]}
                      >
                        <Txt size={15}>{b.name}</Txt>
                      </Pressable>
                    ))
                  )}
                </View>
              </Field>
            )}
            {bank ? (
              <Field label="Account number">
                <TextInput
                  value={account}
                  onChangeText={(t) => setAccount(t.replace(/\D/g, '').slice(0, 10))}
                  keyboardType="number-pad"
                  placeholder="10 digits"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                />
              </Field>
            ) : null}
            {looking ? <Txt color={colors.muted}>Asking the bank whose account it is…</Txt> : null}
            {named ? (
              <View style={styles.named}>
                <Icon name="check" size={16} color={colors.tealDeep} />
                <Txt weight="bold" size={15} color={colors.tealDeep}>
                  {named.name}
                </Txt>
              </View>
            ) : null}
            {problem ? <Txt color={colors.danger}>{problem}</Txt> : null}
            <PillButton
              label={busy ? 'Locking the rate…' : 'Review'}
              loading={busy}
              disabled={!named || busy}
              onPress={() => void review()}
            />
          </ScrollView>
        ) : null}

        {step === 'review' && quote ? (
          <View style={styles.flow}>
            <Txt weight="bold" size={22}>
              {busy ? 'Cashing out' : 'Check and cash out'}
            </Txt>
            <View style={{ gap: 4, marginTop: 10 }}>
              <Txt weight="bold" size={40} style={{ textAlign: 'center' }}>
                {quote.naira}
              </Txt>
              <Txt color={colors.muted} style={{ textAlign: 'center' }}>
                to {quote.account_name}, {quote.bank_name} ••••{quote.account_last4}
              </Txt>
            </View>
            <View style={styles.facts}>
              <Fact label="You send" value={`$${quote.amount}`} hint={`From your balance on ${chainName}`} />
              <Fact label="Rate" value={`₦${quote.rate} per dollar`} hint={info?.rate_source === 'chainlink' ? 'Chainlink rate on Monad, less 1%' : 'Market rate, less 1%'} />
              <Fact label="Bank fee" value={quote.fee} hint="Taken from the naira" />
              <Fact label="Network fee" value="$0.00, Kova covers it" />
              <Fact label="Arrives" value="In minutes" hint="If the bank can’t take it, your dollars come back" last />
            </View>
            {quote.test_mode ? (
              <Txt size={13} color={colors.muted} style={{ marginTop: 10 }}>
                Paystack test mode: no naira moves. The dollars are Monad testnet dollars.
              </Txt>
            ) : null}
            {problem ? <Txt color={colors.danger}>{problem}</Txt> : null}
            <View style={{ flex: 1 }} />
            <SlideToSend
              label={problem ? 'Slide to try again' : `Slide to cash out $${quote.amount}`}
              busy={busy}
              onSend={() => void go()}
            />
            <Txt size={13} color={colors.muted} style={{ textAlign: 'center', marginTop: 8 }}>
              {quick ? 'Your wallet is open, so this one needs no Face ID.' : 'Face ID approves it.'}
            </Txt>
          </View>
        ) : null}

        {step === 'done' && quote ? (
          <View style={styles.done}>
            <Kovi pose={quote.status === 'failed' ? 'oops' : quote.status === 'paid' ? 'cheer' : 'ride'} size={150} />
            <Txt weight="bold" size={26} style={{ textAlign: 'center' }}>
              {quote.status === 'paid'
                ? 'In their account'
                : quote.status === 'failed'
                  ? 'Your dollars came back'
                  : 'On its way to the bank'}
            </Txt>
            <Txt color={colors.muted} style={{ textAlign: 'center' }}>
              {quote.status === 'failed'
                ? (quote.failure ?? 'The bank couldn’t take it. Your dollars came back to your wallet.')
                : `${quote.naira} to ${quote.account_name ?? 'the account'}, ${quote.bank_name} ••••${quote.account_last4}.`}
            </Txt>
            {quote.tx_url ? (
              <Pressable onPress={() => void WebBrowser.openBrowserAsync(quote.tx_url as string)} accessibilityRole="link">
                <Txt weight="semi" size={14} color={colors.tealDeep}>
                  See the transfer on Monad
                </Txt>
              </Pressable>
            ) : null}
            {quote.refund_tx_url ? (
              <Pressable onPress={() => void WebBrowser.openBrowserAsync(quote.refund_tx_url as string)} accessibilityRole="link">
                <Txt weight="semi" size={14} color={colors.tealDeep}>
                  See the refund on Monad
                </Txt>
              </Pressable>
            ) : null}
            {quote.test_mode ? (
              <Txt size={13} color={colors.muted} style={{ textAlign: 'center' }}>
                Paystack test mode: no naira moved.
              </Txt>
            ) : null}
            <View style={{ alignSelf: 'stretch', marginTop: 8 }}>
              <PillButton label="Done" icon="check" onPress={() => router.back()} />
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Txt weight="bold" size={13} color={colors.muted}>
        {label}
      </Txt>
      {children}
    </View>
  )
}

function Fact({ label, value, hint, last }: { label: string; value: string; hint?: string; last?: boolean }) {
  return (
    <View style={[styles.fact, !last && styles.rule]}>
      <Txt size={14} color={colors.muted}>
        {label}
      </Txt>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        <Txt weight="bold" size={14} style={{ textAlign: 'right' }}>
          {value}
        </Txt>
        {hint ? (
          <Txt size={12} color={colors.muted} style={{ textAlign: 'right' }}>
            {hint}
          </Txt>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  flow: { flex: 1, paddingHorizontal: 20, paddingBottom: 12 },
  form: { paddingHorizontal: 20, paddingBottom: 40, gap: 16 },
  route: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  naira: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.tealDeep, alignItems: 'center', justifyContent: 'center' },
  typed: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start', marginTop: 28 },
  pills: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.sunken },
  input: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: 16,
    backgroundColor: colors.surface,
    fontFamily: fonts.semi,
    fontSize: 16,
    color: colors.ink,
  },
  bankList: { maxHeight: 300, borderWidth: 2, borderColor: colors.ink, borderRadius: 16, backgroundColor: colors.surface, overflow: 'hidden' },
  bankRow: { paddingHorizontal: 14, paddingVertical: 12 },
  rule: { borderBottomWidth: 1, borderBottomColor: colors.sunken },
  bankPick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.tealSoft,
  },
  bankBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  named: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 12, borderRadius: 14, backgroundColor: colors.tealSoft },
  facts: { marginTop: 16, borderRadius: 20, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.surface, paddingHorizontal: 14 },
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12 },
  done: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 28 },
})
