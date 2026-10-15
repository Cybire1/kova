import * as Haptics from 'expo-haptics'
import { router, useLocalSearchParams } from 'expo-router'
import * as SecureStore from 'expo-secure-store'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { KeyboardAvoidingView, Pressable, StyleSheet, TextInput, View } from 'react-native'
import { type NairaInfo, type NairaQuote, type NairaTopUp, naira } from '@/lib/api'
import { shareWebUrl } from '@/lib/config'
import { applyKey, groupTyped, type Key, toBase } from '@/lib/money'
import { colors, fonts } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Kovi } from '@/ui/art'
import { Keypad } from '@/ui/Keypad'
import { CoinRain } from '@/ui/motion'
import { Header, PillButton, Screen, Txt } from '@/ui/primitives'

type Step = 'amount' | 'pay' | 'checking' | 'done'

const EMAIL = 'kova.naira.email'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const dollars = (base: bigint) => (Number(base) / 1e6).toFixed(2)

/**
 * Adding money in naira (the API's services/naira.ts): pay naira by bank transfer, card or USSD on
 * Paystack's checkout, in the in-app browser, and the dollars land in this wallet once Paystack
 * confirms it. The web's twin is /wallet/add/naira.
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
      void SecureStore.setItemAsync(EMAIL, email)
      const started = await naira.topUp(profile.address, {
        amount: dollars(amount),
        email,
        // Kova's web for this network, which checks the payment too if Paystack lands there first.
        returnUrl: `${shareWebUrl}/wallet/add/naira`,
      })
      setTopUp(started)
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
        error instanceof Error ? error.message : 'Paystack didn’t open. Nothing was charged.',
      )
      setStep('pay')
    } finally {
      setBusy(false)
    }
  }

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
        title={step === 'done' || step === 'checking' ? undefined : 'Add naira'}
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
                Bank transfer, card or USSD, with Paystack. You get dollars.
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
              Pay with Paystack
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
                  quote.rate_source === 'chainlink'
                    ? 'Chainlink rate on Monad, plus 1%'
                    : 'Market rate, plus 1%'
                }
              />
              <Fact label="Paystack’s fee" value={quote.fee} hint="Included in what you pay" />
              <Fact label="Arrives" value="In seconds, on Monad" last />
            </View>
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
            {info?.test_mode ? (
              <Txt size={13} color={colors.onTint} style={{ marginTop: 10 }}>
                Paystack test mode: no naira moves. Use Paystack’s test card on its page.
              </Txt>
            ) : null}
            {problem ? <Txt color={colors.danger}>{problem}</Txt> : null}
            <View style={{ flex: 1 }} />
            <PillButton
              label={busy ? 'Opening Paystack…' : `Pay ${quote.naira}`}
              loading={busy}
              disabled={busy || !/.+@.+\..+/.test(email)}
              onPress={() => void pay()}
            />
          </View>
        ) : null}

        {step === 'checking' || step === 'done' ? (
          <View style={styles.done}>
            {settled ? <CoinRain width={360} height={300} /> : null}
            <Kovi pose={settled ? 'cheer' : failed ? 'oops' : 'ride'} size={150} />
            <Txt weight="bold" size={26} style={{ textAlign: 'center' }}>
              {settled
                ? 'Money’s in.'
                : failed
                  ? 'Paystack didn’t take it'
                  : step === 'checking'
                    ? 'Checking with Paystack…'
                    : 'Waiting for Paystack'}
            </Txt>
            <Txt color={colors.onTint} style={{ textAlign: 'center' }}>
              {settled
                ? `$${topUp?.amount} landed in your wallet, for ${topUp?.naira}.`
                : failed
                  ? (topUp?.failure ?? 'No naira was taken. Try again.')
                  : (topUp?.failure ??
                    'As soon as Paystack confirms your naira, the dollars land here.')}
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
  done: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 28 },
})
