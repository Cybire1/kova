import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { router, useLocalSearchParams } from 'expo-router'
import * as SecureStore from 'expo-secure-store'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { type NairaInfo, type NairaQuote, type NairaTopUp, naira } from '@/lib/api'
import { shareWebUrl } from '@/lib/config'
import { applyKey, groupTyped, type Key, toBase } from '@/lib/money'
import { colors, fonts } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Kovi } from '@/ui/art'
import { Keypad } from '@/ui/Keypad'
import { CoinRain, Ping } from '@/ui/motion'
import { Header, PillButton, Screen, Txt } from '@/ui/primitives'

type Step = 'amount' | 'pay' | 'transfer' | 'checking' | 'done'

const EMAIL = 'kova.naira.email'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const dollars = (base: bigint) => (Number(base) / 1e6).toFixed(2)

/**
 * Adding money in naira (the API's services/naira.ts). Through PAJ (Monad mainnet): PAJ opens a
 * bank account for this one payment, shown here to copy into any bank app, and the screen follows
 * it until PAJ has sent the dollars to this wallet. Through Paystack: its checkout, in the in-app
 * browser. The web's twins are /wallet/add/naira and /naira/pay/:reference.
 */
export default function AddNaira() {
  const { profile, refresh } = useWallet()
  const [info, setInfo] = useState<NairaInfo | null>(null)
  const [step, setStep] = useState<Step>('amount')
  const [typed, setTyped] = useState('10')
  const [quote, setQuote] = useState<NairaQuote | null>(null)
  const [email, setEmail] = useState('')
  const [topUp, setTopUp] = useState<NairaTopUp | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  // Development only, for films and screenshots: ?amount=10&email=ada@example.com&step=pay
  const dev = useLocalSearchParams<{ amount?: string; email?: string; step?: string }>()
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, from the dev link
  useEffect(() => {
    void naira.info().then(setInfo)
    void SecureStore.getItemAsync(EMAIL).then((saved) => saved && setEmail(saved))
    if (__DEV__ && dev.amount) setTyped(dev.amount)
    if (__DEV__ && dev.email) setEmail(dev.email)
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: the dev link's one step
  useEffect(() => {
    if (__DEV__ && dev.step === 'pay' && quote && step === 'amount') setStep('pay')
  }, [quote])

  const onKey = useCallback((key: Key) => setTyped((v) => applyKey(v, key, 2)), [])
  const amount = useMemo(() => {
    try {
      return typed && Number(typed) > 0 ? toBase(Number(typed).toFixed(2)) : 0n
    } catch {
      return 0n
    }
  }, [typed])
  const outside = amount > 0n && (amount < 1_000_000n || amount > 500_000_000n)
  const paj = info?.partner === 'paj'

  useEffect(() => {
    setQuote(null)
    if (amount < 1_000_000n || amount > 500_000_000n || !info?.enabled) return
    const id = setTimeout(() => {
      void naira
        .quote(dollars(amount), 'in')
        .then(setQuote)
        .catch(() => setQuote(null))
    }, 250)
    return () => clearTimeout(id)
  }, [amount, info?.enabled])

  const pay = async () => {
    if (!profile || !quote) return
    setBusy(true)
    setProblem(null)
    try {
      if (!paj) void SecureStore.setItemAsync(EMAIL, email)
      const started = await naira.topUp(profile.address, {
        amount: dollars(amount),
        ...(paj ? {} : { email }),
        // Kova's web for this network, which checks the payment too if Paystack lands there first.
        returnUrl: `${shareWebUrl}/wallet/add/naira`,
      })
      setTopUp(started)
      if (started.bank_transfer) {
        // PAJ: the account opened for this payment, right here. The screen follows it.
        setStep('transfer')
        return
      }
      await WebBrowser.openBrowserAsync(started.url)
      // Back from Paystack: Kova checks the payment and sends the dollars.
      setStep('checking')
      let checked = await naira.verifyTopUp(started.reference)
      setTopUp(checked)
      for (
        let i = 0;
        i < 15 && (checked.status === 'initialized' || checked.status === 'paid');
        i++
      ) {
        await wait(3000)
        checked = await naira.verifyTopUp(started.reference)
        setTopUp(checked)
      }
      if (checked.status === 'settled') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        void refresh()
      }
      setStep('done')
    } catch (error) {
      setProblem(
        error instanceof Error
          ? error.message
          : `${paj ? 'The bank transfer' : 'Paystack'} didn’t open. Nothing was charged.`,
      )
      setStep('pay')
    } finally {
      setBusy(false)
    }
  }

  // PAJ: follow the payment while its account is on screen, until the dollars land.
  useEffect(() => {
    if (step !== 'transfer' || !topUp) return
    if (topUp.status === 'settled') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      void refresh()
      setStep('done')
      return
    }
    if (topUp.status === 'failed') {
      setStep('done')
      return
    }
    const id = setTimeout(() => {
      void naira
        .verifyTopUp(topUp.reference)
        .then(setTopUp)
        .catch(() => setTopUp({ ...topUp }))
    }, 4000)
    return () => clearTimeout(id)
  }, [step, topUp, refresh])

  if (info && !info.enabled)
    return (
      <Screen bg={colors.tealLight}>
        <Header title="Add naira" backIcon="close" />
        <View style={styles.done}>
          <Kovi pose="sleep" size={140} />
          <Txt weight="bold" size={22} style={{ textAlign: 'center' }}>
            Naira isn’t on here yet
          </Txt>
          <Txt color={colors.onTint} style={{ textAlign: 'center' }}>
            Adding money from a Nigerian bank opens on this server soon.
          </Txt>
        </View>
      </Screen>
    )

  const settled = topUp?.status === 'settled'
  const failed = topUp?.status === 'failed'

  return (
    <Screen bg={colors.tealLight}>
      <Header
        title={
          step === 'done' || step === 'checking'
            ? undefined
            : step === 'transfer'
              ? 'Pay by bank transfer'
              : 'Add naira'
        }
        backIcon={step === 'pay' ? 'back' : 'close'}
        onBack={busy ? null : step === 'pay' ? () => setStep('amount') : () => router.back()}
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
              <Txt size={14} color={colors.onTint} style={{ flex: 1 }}>
                {paj
                  ? 'A bank transfer from any Nigerian bank. You get dollars.'
                  : 'Bank transfer, card or USSD, with Paystack. You get dollars.'}
              </Txt>
            </View>
            <View style={styles.typed}>
              <Txt weight="semi" size={30} color={colors.onTint} style={{ marginTop: 10 }}>
                $
              </Txt>
              <Txt weight="bold" size={64} exact>
                {groupTyped(typed) || '0'}
              </Txt>
            </View>
            <View style={styles.pills}>
              {quote ? (
                <View style={[styles.pill, { backgroundColor: colors.surface }]}>
                  <Txt weight="semi" size={14}>
                    You pay {quote.naira}
                  </Txt>
                </View>
              ) : null}
              <View style={[styles.pill, outside && { backgroundColor: colors.coralSoft }]}>
                <Txt weight="semi" size={14} color={outside ? colors.danger : colors.onTint}>
                  Between $1 and $500
                </Txt>
              </View>
            </View>
            <View style={{ flex: 1 }} />
            <Keypad onKey={onKey} />
            <View style={{ marginTop: 14 }}>
              <PillButton
                label="Continue"
                disabled={!quote || outside}
                onPress={() => setStep('pay')}
              />
            </View>
          </View>
        ) : null}

        {step === 'pay' && quote ? (
          <View style={styles.flow}>
            <Txt weight="bold" size={22}>
              {paj ? 'Pay by bank transfer' : 'Pay with Paystack'}
            </Txt>
            <View style={{ gap: 4, marginTop: 10 }}>
              <Txt weight="bold" size={40} style={{ textAlign: 'center' }}>
                {quote.naira}
              </Txt>
              <Txt color={colors.onTint} style={{ textAlign: 'center' }}>
                for ${dollars(amount)} in your wallet
              </Txt>
            </View>
            <View style={styles.facts}>
              <Fact
                label="Rate"
                value={`₦${Number(quote.rate).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} per dollar`}
                hint={
                  paj
                    ? 'Fee included'
                    : quote.rate_source === 'chainlink'
                      ? 'Chainlink rate on Monad, plus 1%'
                      : 'Market rate, plus 1%'
                }
              />
              {paj ? (
                <Fact label="Fee" value="In the rate" />
              ) : (
                <Fact label="Paystack’s fee" value={quote.fee} hint="Included in what you pay" />
              )}
              <Fact
                label="Arrives"
                value={paj ? 'When your transfer lands' : 'In seconds, on Monad'}
                hint={paj ? 'The dollars come to this wallet on Monad' : undefined}
                last
              />
            </View>
            {paj ? null : (
              <View style={{ gap: 8, marginTop: 16 }}>
                <Txt weight="bold" size={13} color={colors.onTint}>
                  Email for Paystack’s receipt
                </Txt>
                <TextInput
                  value={email}
                  onChangeText={(t) => setEmail(t.trim())}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  placeholder="you@example.com"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                />
              </View>
            )}
            {info?.test_mode ? (
              <Txt size={13} color={colors.onTint} style={{ marginTop: 10 }}>
                Paystack test mode: no naira moves. Use Paystack’s test card on its page.
              </Txt>
            ) : null}
            {problem ? <Txt color={colors.danger}>{problem}</Txt> : null}
            <View style={{ flex: 1 }} />
            <PillButton
              label={
                busy
                  ? paj
                    ? 'Opening an account for you…'
                    : 'Opening Paystack…'
                  : paj
                    ? 'Get the account to pay'
                    : `Pay ${quote.naira}`
              }
              loading={busy}
              disabled={busy || (!paj && !/.+@.+\..+/.test(email))}
              onPress={() => void pay()}
            />
          </View>
        ) : null}

        {step === 'transfer' && topUp?.bank_transfer ? (
          <ScrollView contentContainerStyle={styles.transfer}>
            <View style={{ gap: 4 }}>
              <Txt weight="bold" size={40} style={{ textAlign: 'center' }}>
                {topUp.bank_transfer.naira}
              </Txt>
              <Txt color={colors.onTint} style={{ textAlign: 'center' }}>
                for ${topUp.amount} in your wallet
              </Txt>
            </View>
            <View style={styles.facts}>
              <CopyFact label="Account number" value={topUp.bank_transfer.account_number} />
              <Fact label="Bank" value={topUp.bank_transfer.bank_name ?? '—'} />
              <Fact label="Name" value={topUp.bank_transfer.account_name ?? '—'} />
              <CopyFact
                label="Amount"
                value={topUp.bank_transfer.naira}
                copy={(Number(topUp.bank_transfer.naira_kobo) / 100).toFixed(2)}
                last
              />
            </View>
            <Txt size={13} color={colors.onTint}>
              Send exactly this amount, once, from any Nigerian bank app. This account is for this
              payment only. The dollars come to this wallet when it lands.
            </Txt>
            <View style={styles.wait} accessibilityLiveRegion="polite">
              <View style={styles.dot}>
                <Ping size={12} />
              </View>
              <Txt weight="semi" size={15}>
                {topUp.status === 'paid'
                  ? 'Naira received. Your dollars are on the way…'
                  : 'Waiting for your transfer…'}
              </Txt>
            </View>
            <View style={{ flex: 1 }} />
            <PillButton label="Done" icon="check" onPress={() => router.back()} />
            <Txt size={13} color={colors.onTint} style={{ textAlign: 'center' }}>
              Close this whenever you like: the dollars still land when your naira does.
            </Txt>
          </ScrollView>
        ) : null}

        {step === 'checking' || step === 'done' ? (
          <View style={styles.done}>
            {settled ? <CoinRain width={360} height={300} /> : null}
            <Kovi pose={settled ? 'cheer' : failed ? 'oops' : 'ride'} size={150} />
            <Txt weight="bold" size={26} style={{ textAlign: 'center' }}>
              {settled
                ? 'Money’s in.'
                : failed
                  ? 'The payment didn’t go through'
                  : step === 'checking'
                    ? 'Checking your payment…'
                    : 'Waiting for your naira'}
            </Txt>
            <Txt color={colors.onTint} style={{ textAlign: 'center' }}>
              {settled
                ? `$${topUp?.amount} landed in your wallet, for ${topUp?.naira}.`
                : failed
                  ? (topUp?.failure ?? 'No naira was taken. Try again.')
                  : (topUp?.failure ?? 'As soon as your naira arrives, the dollars land here.')}
            </Txt>
            {topUp?.tx_url ? (
              <Pressable
                onPress={() => void WebBrowser.openBrowserAsync(topUp.tx_url as string)}
                accessibilityRole="link"
              >
                <Txt weight="semi" size={14} color={colors.tealDeep}>
                  See the transfer on Monad
                </Txt>
              </Pressable>
            ) : null}
            <View style={{ alignSelf: 'stretch', marginTop: 8 }}>
              <PillButton
                label="Done"
                icon="check"
                disabled={step === 'checking'}
                onPress={() => router.back()}
              />
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  )
}

/** A fact with a Copy button, for the account number and the amount to send. */
function CopyFact({
  label,
  value,
  copy,
  last,
}: {
  label: string
  value: string
  copy?: string
  last?: boolean
}) {
  const [copied, setCopied] = useState(false)
  return (
    <View style={[styles.fact, { alignItems: 'center' }, !last && styles.rule]}>
      <Txt size={14} color={colors.muted}>
        {label}
      </Txt>
      <View style={styles.copyRow}>
        <Txt weight="bold" size={16} selectable>
          {value}
        </Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Copy ${label.toLowerCase()}`}
          onPress={async () => {
            await Clipboard.setStringAsync(copy ?? value).catch(() => {})
            void Haptics.selectionAsync()
            setCopied(true)
            setTimeout(() => setCopied(false), 1600)
          }}
          style={styles.copy}
          hitSlop={8}
        >
          <Txt weight="bold" size={13}>
            {copied ? 'Copied' : 'Copy'}
          </Txt>
        </Pressable>
      </View>
    </View>
  )
}

function Fact({
  label,
  value,
  hint,
  last,
}: {
  label: string
  value: string
  hint?: string
  last?: boolean
}) {
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
  route: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  naira: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.tealDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typed: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-start',
    marginTop: 28,
  },
  pills: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.tealSoft,
  },
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
  rule: { borderBottomWidth: 1, borderBottomColor: colors.sunken },
  facts: {
    marginTop: 16,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
  },
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12 },
  transfer: { flexGrow: 1, gap: 14, paddingHorizontal: 20, paddingBottom: 16 },
  copyRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
  },
  copy: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.tealSoft,
  },
  wait: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.coral },
  done: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 28 },
})
