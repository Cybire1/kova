import { bankDisplayName, POPULAR_BANKS, suggestBanks } from '@kova/monad'
import * as Haptics from 'expo-haptics'
import { Image } from 'expo-image'
import { router, useLocalSearchParams } from 'expo-router'
import * as SecureStore from 'expo-secure-store'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  type ColorValue,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { type NairaBank, type NairaInfo, naira } from '@/lib/api'
import type { CashOutToPay } from '@/lib/chain'
import { applyKey, formatUsd, groupTyped, type Key, toBase } from '@/lib/money'
import { usePrivate } from '@/lib/private'
import { useSessionCovers } from '@/lib/session'
import { colors, fonts, inkAt, pair } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Coin, Kovi } from '@/ui/art'
import { Icon } from '@/ui/Icon'
import { Keypad } from '@/ui/Keypad'
import { Bob, Burst, Ping, PopIn } from '@/ui/motion'
import { spendLabel, TopUpLine, usePaymentRoute } from '@/ui/Private'
import { Header, PillButton, RoundButton, Screen, Txt } from '@/ui/primitives'
import { SlideToSend } from '@/ui/send/SlideToSend'

type Step = 'amount' | 'account' | 'review' | 'sending' | 'done'

/** Someone this phone cashed out to before. Kept on the phone only, never sent anywhere. */
interface Recent {
  name: string
  bankCode: string
  bankName: string
  accountNumber: string
  logo?: string | null
}

const RECENTS = 'kova.naira.recents.v1'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const dollars = (base: bigint) => (Number(base) / 1e6).toFixed(2)
const nairaText = (n: number) =>
  `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
/** Banks give names in capitals ("ADA OBI"): shown as people write them. */
const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (_, gap: string, c: string) => gap + c.toUpperCase())
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
const spaced = (n: string) =>
  n.length === 10 ? `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}` : n
/** An account number as it's read out, grouped as it's typed: 803 123 4567. */
const grouped = (n: string) => [n.slice(0, 3), n.slice(3, 6), n.slice(6)].filter(Boolean).join(' ')

/**
 * Cashing out to naira (the API's services/naira.ts): dollars from this wallet to any Nigerian
 * bank account, through PAJ (Monad mainnet) or Paystack. How much, then who: the account number
 * first, and Kova suggests the bank from it (phone-number banks for numbers that look like phone
 * numbers, banks whose NUBAN check digit it fits), the bank names the account, the quote, slide.
 * The wallet signs exactly the quote's transfer (to Kova's cash-out contract, which swaps it to USDC
 * and pays PAJ; or to Kova's treasury for Paystack), Kova pays the gas, and the screen follows the
 * money step by step until it's in their account. The web's twin is /wallet/cash-out/naira.
 */
export default function CashOutScreen() {
  const { balance, profile, cashOutNaira } = useWallet()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const [info, setInfo] = useState<NairaInfo | null>(null)
  const [step, setStep] = useState<Step>('amount')
  const [typed, setTyped] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [banks, setBanks] = useState<NairaBank[] | null>(null)
  const [recents, setRecents] = useState<Recent[]>([])
  const [account, setAccount] = useState('')
  const [bank, setBank] = useState<NairaBank | null>(null)
  const [checking, setChecking] = useState<string | null>(null)
  const [missed, setMissed] = useState<string[]>([])
  const [named, setNamed] = useState<{ number: string; code: string; name: string } | null>(null)
  const [sheet, setSheet] = useState(false)
  const [search, setSearch] = useState('')
  const [quote, setQuote] = useState<CashOutToPay | null>(null)
  const [save, setSave] = useState(true)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [took, setTook] = useState<number | null>(null)
  /** The latest name check: an older answer arriving late is ignored. */
  const seq = useRef(0)
  const live = useRef(true)
  const quick = useSessionCovers(quote ? BigInt(quote.pay.value) : 0n)
  // Development only, for films and screenshots: ?amount=2&bank=100004&account=8031234567&step=account|review
  const dev = useLocalSearchParams<{
    amount?: string
    bank?: string
    account?: string
    step?: string
  }>()

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  useEffect(() => {
    void naira.info().then(setInfo)
    void SecureStore.getItemAsync(RECENTS)
      .then((raw) => {
        const list = raw ? (JSON.parse(raw) as Recent[]) : []
        if (Array.isArray(list)) setRecents(list.slice(0, 5))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!info?.enabled || banks) return
    void naira
      .banks()
      .then(setBanks)
      .catch(() => setBanks([]))
  }, [info?.enabled, banks])

  // biome-ignore lint/correctness/useExhaustiveDependencies: once, from the dev link
  useEffect(() => {
    if (!__DEV__ || !dev.amount) return
    setTyped(dev.amount)
    if (dev.account) setAccount(dev.account)
    if (dev.step === 'account' || dev.step === 'review') setStep('account')
  }, [])

  const onKey = useCallback((key: Key) => setTyped((v) => applyKey(v, key, 2)), [])
  const amount = useMemo(() => {
    try {
      return typed && Number(typed) > 0 ? toBase(Number(typed).toFixed(2)) : 0n
    } catch {
      return 0n
    }
  }, [typed])
  // A new amount needs a new quote.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the amount changes, by design
  useEffect(() => {
    setNamed(null)
    setQuote(null)
  }, [amount])
  // One balance: private dollars count in what you have, and just enough moves in first when it's short.
  const privately = usePrivate()
  const have = balance === null ? null : balance + (privately.keysHere ? privately.waiting : 0n)
  const { route } = usePaymentRoute({ amount, balance, direct: false, paying: busy })
  const over = route.from === 'short'
  const tooSmall = amount > 0n && amount < 1_000_000n
  const paj = info?.partner === 'paj'

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

  const byCode = useMemo(() => new Map((banks ?? []).map((b) => [b.code, b])), [banks])
  const shortName = useCallback(
    (code: string | undefined, fallback: string) =>
      bankDisplayName({ code: code ?? '', name: (code && byCode.get(code)?.name) || fallback }),
    [byCode],
  )

  /** The banks this number most likely belongs to; a bank picked from the full list joins them. */
  const suggestions = useMemo((): { bank: NairaBank; fits: boolean }[] => {
    if (!banks || account.length !== 10) return []
    const list = suggestBanks(account, banks, 5).map((s) => ({
      bank: s.bank,
      fits: s.reason === 'fits',
    }))
    if (bank && !list.some((s) => s.bank.code === bank.code))
      return [{ bank, fits: false }, ...list.slice(0, 4)]
    return list
  }, [account, banks, bank])

  /**
   * Picking a bank makes the quote: PAJ confirms the account with the bank as it opens it, so the
   * name and the naira arrive together and Continue waits on nothing. A spinner on its tile
   * meanwhile, then the name, or a quiet no.
   */
  const check = useCallback(
    async (b: NairaBank, number: string) => {
      if (!profile) return
      const mine = ++seq.current
      setBank(b)
      setNamed(null)
      setQuote(null)
      setChecking(b.code)
      setProblem(null)
      void Haptics.selectionAsync()
      try {
        const quoted = await naira.cashOut(profile.address, {
          amount: dollars(amount),
          bankCode: b.code,
          accountNumber: number,
        })
        if (seq.current !== mine || !live.current) return
        setQuote(quoted)
        setNamed({ number, code: b.code, name: quoted.account_name ?? '' })
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      } catch (error) {
        if (seq.current !== mine || !live.current) return
        const message = error instanceof Error ? error.message : 'The bank didn’t answer.'
        if (/match an account|account number/i.test(message))
          setMissed((m) => (m.includes(b.code) ? m : [...m, b.code]))
        else setProblem(message)
      } finally {
        if (seq.current === mine && live.current) setChecking(null)
      }
    },
    [amount, profile],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: once the banks arrive, from the dev link
  useEffect(() => {
    if (!__DEV__ || !dev.bank || !dev.account || !banks || bank) return
    const found = banks.find((b) => b.code === dev.bank)
    if (found && /^\d{10}$/.test(dev.account)) void check(found, dev.account)
  }, [banks])

  const typeAccount = (text: string) => {
    const next = text.replace(/\D/g, '').slice(0, 10)
    if (next === account) return
    seq.current++
    setAccount(next)
    setBank(null)
    setNamed(null)
    setQuote(null)
    setChecking(null)
    setMissed([])
    setProblem(null)
    // The number is complete: put the keyboard away so the banks for it are in view.
    if (next.length === 10) Keyboard.dismiss()
  }

  const pickRecent = (r: Recent) => {
    seq.current++
    setAccount(r.accountNumber)
    setMissed([])
    const b = byCode.get(r.bankCode) ?? { name: r.bankName, code: r.bankCode, logo: r.logo }
    void check(b, r.accountNumber)
  }

  const pickFromList = (b: NairaBank) => {
    setSheet(false)
    setSearch('')
    if (/^\d{10}$/.test(account)) void check(b, account)
    else setBank(b)
  }

  const review = async () => {
    if (!named || !profile) return
    // The quote came with the name.
    if (quote) {
      setStep('review')
      return
    }
    setBusy(true)
    setProblem(null)
    try {
      setQuote(
        await naira.cashOut(profile.address, {
          amount: dollars(amount),
          bankCode: named.code,
          accountNumber: named.number,
        }),
      )
      setStep('review')
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Kova didn’t answer. Try again.')
    } finally {
      setBusy(false)
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: the dev link's one review
  useEffect(() => {
    if (__DEV__ && dev.step === 'review' && named && step === 'account' && !busy && !quote)
      void review()
  }, [named])

  const remember = async (r: Recent) => {
    const next = [
      r,
      ...recents.filter((x) => !(x.bankCode === r.bankCode && x.accountNumber === r.accountNumber)),
    ].slice(0, 5)
    setRecents(next)
    await SecureStore.setItemAsync(RECENTS, JSON.stringify(next)).catch(() => {})
  }

  const go = async () => {
    if (!quote) return
    setBusy(true)
    setProblem(null)
    const started = Date.now()
    try {
      const pay = () => cashOutNaira(quote)
      let result: CashOutToPay = await privately.pay(route, BigInt(quote.pay.value), {
        fromBalance: pay,
        fromPrivate: pay,
      })
      if (!live.current) return
      setQuote(result)
      if (result.status === 'failed') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
        setStep('done')
        return
      }
      if (save && named)
        void remember({
          name: titleCase(named.name),
          bankCode: named.code,
          bankName: shortName(named.code, quote.bank_name),
          accountNumber: named.number,
          logo: byCode.get(named.code)?.logo ?? null,
        })
      setStep(result.status === 'paid' ? 'done' : 'sending')
      // Follow the bank for up to three minutes; the money arrives either way.
      for (let i = 0; i < 60 && (result.status === 'paying' || result.status === 'received'); i++) {
        await wait(3000)
        if (!live.current) return
        result = await naira.cashOutStatus(quote.id)
        if (!live.current) return
        setQuote(result)
      }
      if (result.status === 'paid') {
        setTook(Math.max(1, Math.round((Date.now() - started) / 1000)))
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        setStep('done')
      } else if (result.status === 'failed') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
        setStep('done')
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'It didn’t go through. Nothing moved.'
      if (live.current && !/cancel/i.test(message)) setProblem(message)
    } finally {
      if (live.current) setBusy(false)
    }
  }

  if (info && !info.enabled)
    return (
      <Screen>
        <Header title="Cash out to naira" backIcon="close" />
        <View style={styles.center}>
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

  const rate = info?.cash_out_rate
    ? `₦${Number(info.cash_out_rate).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : null
  const toBank = quote ? shortName(quote.bank_code ?? named?.code, quote.bank_name) : ''
  const toLogo = quote ? byCode.get(quote.bank_code ?? named?.code ?? '')?.logo : null
  const toName = titleCase(quote?.account_name ?? named?.name ?? 'the account holder')
  const toNumber =
    named && quote && named.number.endsWith(quote.account_last4)
      ? spaced(named.number)
      : `••••${quote?.account_last4 ?? ''}`
  const partnerHas = quote?.partner === 'paj' ? 'Ready for the bank' : 'Kova has it'
  const paid = quote?.status === 'paid'

  return (
    <Screen>
      <Header
        title={
          step === 'amount'
            ? 'Cash out to naira'
            : step === 'account'
              ? 'Cash out to'
              : step === 'review'
                ? 'Check and send'
                : undefined
        }
        subtitle={
          step === 'account' && amount > 0n ? `$${dollars(amount)} → ${preview ?? '…'}` : undefined
        }
        backIcon={step === 'account' || step === 'review' ? 'back' : 'close'}
        onBack={
          busy && step !== 'sending'
            ? null
            : step === 'account'
              ? () => setStep('amount')
              : step === 'review'
                ? () => setStep('account')
                : () => router.back()
        }
      />

      {step === 'amount' ? (
        <View style={styles.flow}>
          <View style={styles.amountBlock}>
            <Txt weight="semi" size={13} color={colors.muted}>
              You send
            </Txt>
            <View style={styles.typed}>
              <Txt weight="semi" size={24} color={colors.muted} style={{ marginTop: 8 }}>
                $
              </Txt>
              <Txt weight="bold" size={52} exact style={{ letterSpacing: -1.5 }}>
                {groupTyped(typed) || '0'}
              </Txt>
            </View>
            <View style={styles.getsPill}>
              <Coin symbol="₦" size={22} />
              <Txt weight="medium" size={14} color={colors.muted}>
                They get
              </Txt>
              <Txt weight="bold" size={15}>
                {preview && !over ? preview : '₦—'}
              </Txt>
            </View>
          </View>
          <View style={styles.chips}>
            {have !== null ? (
              <View style={[styles.chip, over && { backgroundColor: colors.coralSoft }]}>
                <Txt weight="bold" size={13} color={over ? colors.danger : colors.onTint}>
                  {over ? `You have ${formatUsd(have)}` : `Available ${formatUsd(have)}`}
                </Txt>
              </View>
            ) : null}
            {have !== null && have > 0n ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Cash out everything, ${formatUsd(have)}`}
                onPress={() => {
                  void Haptics.selectionAsync()
                  setTyped(dollars(have))
                }}
                hitSlop={8}
                style={({ pressed }) => [styles.maxChip, pressed && { opacity: 0.6 }]}
              >
                <Txt weight="bold" size={13}>
                  Max
                </Txt>
              </Pressable>
            ) : null}
          </View>
          {rate ? (
            <Txt
              weight="semi"
              size={13}
              color={colors.muted}
              style={{ textAlign: 'center', marginTop: 14 }}
            >
              {rate} per $1 · {paj ? 'No fees' : 'A small bank fee'} · Lands in seconds
            </Txt>
          ) : null}
          <View style={{ flex: 1 }} />
          <Keypad onKey={onKey} size={56} />
          <View style={{ marginTop: 14 }}>
            <PillButton
              label={over ? 'More than you have' : tooSmall ? 'At least $1' : 'Continue'}
              disabled={amount === 0n || over || tooSmall}
              onPress={() => setStep('account')}
            />
          </View>
        </View>
      ) : null}

      {step === 'account' ? (
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            {recents.length ? (
              <View style={{ gap: 8 }}>
                <Txt weight="semi" size={13} color={colors.muted}>
                  Recent
                </Txt>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8 }}
                  keyboardShouldPersistTaps="handled"
                >
                  {recents.map((r, i) => (
                    <Pressable
                      key={`${r.bankCode}-${r.accountNumber}`}
                      accessibilityRole="button"
                      accessibilityLabel={`${r.name}, ${r.bankName}, ending ${r.accountNumber.slice(-4)}`}
                      onPress={() => pickRecent(r)}
                      style={({ pressed }) => [styles.recent, pressed && { opacity: 0.7 }]}
                    >
                      <Person
                        name={r.name}
                        logo={byCode.get(r.bankCode)?.logo ?? r.logo}
                        size={28}
                        tone={i % 2 ? colors.teal : colors.coral}
                        ring={colors.surface}
                      />
                      <View>
                        <Txt weight="semi" size={13} numberOfLines={1}>
                          {r.name}
                        </Txt>
                        <Txt size={11} color={colors.muted}>
                          {shortName(r.bankCode, r.bankName)} ••{r.accountNumber.slice(-4)}
                        </Txt>
                      </View>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            <View style={{ gap: 8 }}>
              <Txt weight="semi" size={13} color={colors.muted}>
                Account number
              </Txt>
              <View style={styles.accountBox}>
                <TextInput
                  value={grouped(account)}
                  onChangeText={typeAccount}
                  keyboardType="number-pad"
                  maxLength={12}
                  autoFocus={!recents.length && !account}
                  placeholder="10 digits"
                  placeholderTextColor={colors.muted}
                  accessibilityLabel="Account number"
                  style={styles.accountInput}
                />
                {account.length < 10 ? (
                  <Txt weight="semi" size={12} color={colors.muted}>
                    {account.length}/10
                  </Txt>
                ) : null}
              </View>
            </View>

            {account.length < 10 ? (
              <Txt size={13} color={colors.muted}>
                Type all 10 digits and Kova suggests the bank.
              </Txt>
            ) : (
              <View style={{ gap: 8 }}>
                <Txt weight="semi" size={13} color={colors.muted}>
                  Pick bank
                </Txt>
                {banks === null ? (
                  <ActivityIndicator color={colors.ink} style={{ padding: 18 }} />
                ) : (
                  <View style={styles.tiles}>
                    {suggestions.map((s) => {
                      const name = shortName(s.bank.code, s.bank.name)
                      const confirmed = named?.code === s.bank.code
                      const miss = missed.includes(s.bank.code)
                      const asking = checking === s.bank.code
                      return (
                        <Pressable
                          key={s.bank.code}
                          accessibilityRole="button"
                          accessibilityLabel={`${name}${s.fits ? ', the number fits' : ''}${miss ? ', no account with this number' : ''}`}
                          accessibilityState={{ selected: confirmed, busy: asking }}
                          onPress={() => void check(s.bank, account)}
                          style={({ pressed }) => [
                            styles.tile,
                            confirmed && styles.tileOn,
                            miss && { opacity: 0.55 },
                            pressed && { opacity: 0.7 },
                          ]}
                        >
                          <View>
                            <BankLogo uri={s.bank.logo} name={name} size={36} />
                            {asking ? (
                              <View style={styles.tileBusy}>
                                <ActivityIndicator size="small" color={colors.ink} />
                              </View>
                            ) : null}
                            {confirmed ? (
                              <View style={styles.tileTick}>
                                <Icon
                                  name="check"
                                  size={10}
                                  color={colors.white}
                                  strokeWidth={3.4}
                                />
                              </View>
                            ) : null}
                          </View>
                          <Txt weight="bold" size={12} numberOfLines={1}>
                            {name}
                          </Txt>
                          {miss ? (
                            <Txt weight="semi" size={11} color={colors.danger}>
                              No account
                            </Txt>
                          ) : s.fits ? (
                            <Txt weight="semi" size={11} color={colors.muted}>
                              Fits
                            </Txt>
                          ) : null}
                        </Pressable>
                      )
                    })}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Other bank: search every bank"
                      onPress={() => setSheet(true)}
                      style={({ pressed }) => [styles.tile, pressed && { opacity: 0.7 }]}
                    >
                      <View style={styles.otherIcon}>
                        <Icon name="search" size={16} />
                      </View>
                      <Txt weight="bold" size={12}>
                        Other bank
                      </Txt>
                    </Pressable>
                  </View>
                )}
              </View>
            )}

            {named && account === named.number ? (
              <PopIn style={styles.confirmed}>
                <View style={styles.confirmedTick}>
                  <Icon name="check" size={13} color={colors.white} strokeWidth={3} />
                </View>
                <Txt weight="bold" size={15} numberOfLines={1} style={{ flexShrink: 1 }}>
                  {named.name.toUpperCase()}
                </Txt>
                <Txt weight="semi" size={12} color={colors.onTint} numberOfLines={1}>
                  confirmed by {shortName(named.code, bank?.name ?? '')}
                </Txt>
              </PopIn>
            ) : null}
            {problem ? (
              <Txt size={14} color={colors.danger}>
                {problem}
              </Txt>
            ) : null}
          </ScrollView>
          <View style={styles.bottom}>
            <PillButton
              label={named ? 'Continue' : 'Pick a bank'}
              loading={busy}
              disabled={!named || busy || named.number !== account}
              onPress={() => void review()}
            />
          </View>
        </KeyboardAvoidingView>
      ) : null}

      {step === 'review' && quote ? (
        <ScrollView contentContainerStyle={styles.flowScroll}>
          <View style={styles.hero}>
            <View style={styles.heroWho}>
              <Person name={toName} logo={toLogo} size={46} tone={colors.coral} ring={colors.ink} />
              <View style={{ flex: 1 }}>
                <Txt weight="semi" size={16} color={colors.white} numberOfLines={1}>
                  {toName}
                </Txt>
                <Txt size={13} color={colors.onInk}>
                  {toBank} · {toNumber}
                </Txt>
              </View>
            </View>
            <Txt weight="semi" size={13} color={colors.onInk} style={{ marginTop: 18 }}>
              They get
            </Txt>
            <Txt weight="bold" size={40} exact color={colors.white} style={{ letterSpacing: -1.2 }}>
              {quote.naira}
            </Txt>
            <View style={styles.heroCoin} pointerEvents="none">
              <Coin symbol="₦" size={96} />
            </View>
          </View>

          <View style={styles.facts}>
            <Fact label="You send" value={`$${quote.amount}`} />
            <Fact label="Rate" value={`${nairaText(Number(quote.rate))} per $1`} />
            <Fact label="Fees" value={quote.partner === 'paj' ? 'None' : quote.fee} />
            <Fact label="Arrives" value="In seconds" last />
          </View>

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: save }}
            onPress={() => {
              void Haptics.selectionAsync()
              setSave(!save)
            }}
            style={styles.saveRow}
          >
            <View style={[styles.box, save && { backgroundColor: colors.chosen }]}>
              {save ? <Icon name="check" size={15} color={colors.white} strokeWidth={3} /> : null}
            </View>
            <Txt weight="bold" size={15}>
              Save {toName} for next time
            </Txt>
          </Pressable>

          {quote.test_mode ? (
            <Txt size={13} color={colors.muted}>
              Paystack test mode: no naira moves. The dollars are Monad testnet dollars.
            </Txt>
          ) : null}
          <TopUpLine route={route} />
          {privately.spending ? (
            <Txt weight="medium" size={14} style={{ textAlign: 'center' }}>
              {spendLabel(privately.spending)}
            </Txt>
          ) : null}
          {problem ? <Txt color={colors.danger}>{problem}</Txt> : null}

          <View style={{ flex: 1 }} />
          <Txt
            weight="semi"
            size={13}
            color={colors.muted}
            style={{ textAlign: 'center', lineHeight: 18 }}
          >
            {quote.partner === 'paj'
              ? `${toBank} is paid as soon as your dollars arrive.`
              : `Paystack pays ${toBank} once your dollars reach Kova.`}
          </Txt>
          <SlideToSend
            label={problem ? 'Slide to try again' : `Slide to send ${quote.naira}`}
            busy={busy}
            onSend={() => void go()}
          />
          <Txt size={13} color={colors.muted} style={{ textAlign: 'center' }}>
            {quick ? 'Your wallet is open, so this one needs no Face ID.' : 'Face ID approves it.'}
          </Txt>
        </ScrollView>
      ) : null}

      {step === 'sending' && quote ? (
        <ScrollView contentContainerStyle={styles.flowScroll}>
          <View style={{ alignItems: 'center' }}>
            <Bob distance={8} duration={1600}>
              <Kovi pose="ride" size={140} />
            </Bob>
          </View>
          <View style={{ alignItems: 'center', gap: 2 }}>
            <Txt weight="semi" size={14} color={colors.muted}>
              On its way to {toName}
            </Txt>
            <Txt weight="bold" size={36} exact style={{ letterSpacing: -1.2 }}>
              {quote.naira}
            </Txt>
            <View style={styles.inline}>
              <BankLogo uri={toLogo} name={toBank} size={22} />
              <Txt weight="semi" size={14} color={colors.muted}>
                {toBank} · {toNumber}
              </Txt>
            </View>
          </View>
          <Timeline
            steps={[
              {
                title: 'Left your wallet',
                detail: `$${quote.amount}`,
                state: quote.tx_hash ? 'done' : 'active',
              },
              {
                title: partnerHas,
                detail: quote.partner === 'paj' ? 'Converted for the transfer' : 'Received by Kova',
                state: quote.tx_hash ? 'done' : 'pending',
              },
              {
                title: `${toBank} is paying ${toName}`,
                detail: 'Usually a few seconds',
                state: paid ? 'done' : quote.tx_hash ? 'active' : 'pending',
              },
              {
                title: `In ${toName}’s account`,
                detail: quote.naira,
                state: paid ? 'done' : 'pending',
              },
            ]}
          />
          {problem ? <Txt color={colors.danger}>{problem}</Txt> : null}
          <View style={{ flex: 1 }} />
          <Txt
            weight="semi"
            size={13}
            color={colors.muted}
            style={{ textAlign: 'center', lineHeight: 18 }}
          >
            You can close this. Kova tells you the moment it lands.
          </Txt>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.outline, pressed && { opacity: 0.7 }]}
          >
            <Txt weight="bold" size={16}>
              Close
            </Txt>
          </Pressable>
        </ScrollView>
      ) : null}

      {step === 'done' && quote && quote.status === 'failed' ? (
        <View style={styles.center}>
          <Kovi pose="oops" size={150} />
          <Txt weight="bold" size={26} style={{ textAlign: 'center' }}>
            Your dollars came back
          </Txt>
          <Txt color={colors.muted} style={{ textAlign: 'center' }}>
            {quote.failure ?? 'The bank couldn’t take it. Your dollars came back to your wallet.'}
          </Txt>
          {quote.refund_tx_url ? (
            <Pressable
              onPress={() => void WebBrowser.openBrowserAsync(quote.refund_tx_url as string)}
              accessibilityRole="link"
            >
              <Txt weight="semi" size={14} color={colors.tealDeep}>
                See the refund
              </Txt>
            </Pressable>
          ) : null}
          <View style={{ alignSelf: 'stretch', marginTop: 8 }}>
            <PillButton label="Done" icon="check" onPress={() => router.back()} />
          </View>
        </View>
      ) : null}

      {step === 'done' && quote && quote.status !== 'failed' ? (
        <ScrollView contentContainerStyle={styles.flowScroll}>
          <View style={styles.celebrate}>
            <Burst
              spots={[
                { x: (width - 40) / 2 - 118, y: 34, size: 26, fill: colors.yellow, delay: 120 },
                { x: (width - 40) / 2 + 116, y: 48, size: 30, fill: colors.coral, delay: 240 },
                { x: (width - 40) / 2 - 96, y: 128, size: 20, fill: colors.white, delay: 360 },
                { x: (width - 40) / 2 + 104, y: 136, size: 22, fill: colors.yellow, delay: 480 },
              ]}
            />
            <PopIn>
              <View style={{ width: 150, height: 150 }}>
                <Kovi pose="cheer" size={150} />
                <PopIn delay={260} style={styles.doneBadge}>
                  <Icon name="check" size={22} color={colors.white} strokeWidth={3} />
                </PopIn>
              </View>
            </PopIn>
          </View>
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Txt weight="bold" size={44} exact style={{ letterSpacing: -1.5 }}>
              {quote.naira}
            </Txt>
            <View style={styles.inline}>
              <Txt weight="semi" size={16}>
                {paid ? `is in ${toName}’s` : `is on its way to ${toName}’s`}
              </Txt>
              <BankLogo uri={toLogo} name={toBank} size={22} />
              <Txt weight="semi" size={16}>
                {toBank} account
              </Txt>
            </View>
            {took !== null ? (
              <View style={styles.tookPill}>
                <Txt weight="bold" size={13} color={colors.onTint}>
                  Done in {took} {took === 1 ? 'second' : 'seconds'}
                </Txt>
              </View>
            ) : null}
          </View>

          <View style={styles.receipt}>
            <Fact
              label="To"
              value={`${toName} · ${toBank} ••••${quote.account_last4}`}
              logo={toLogo}
              bankName={toBank}
            />
            <Fact label="You sent" value={`$${quote.amount}`} />
            <Fact label="Rate" value={`${nairaText(Number(quote.rate))} per $1`} last />
            <View style={styles.dashed} />
            <Fact label="Reference" value={quote.id.replace(/-/g, '').slice(0, 8).toUpperCase()} />
            {quote.tx_url ? (
              <Pressable
                accessibilityRole="link"
                onPress={() => void WebBrowser.openBrowserAsync(quote.tx_url as string)}
                style={styles.fact}
              >
                <Txt size={14} color={colors.muted}>
                  Proof
                </Txt>
                <Txt weight="bold" size={14} color={colors.tealDeep} style={{ marginLeft: 'auto' }}>
                  See the transaction
                </Txt>
              </Pressable>
            ) : null}
          </View>

          <View style={{ flex: 1 }} />
          <View style={styles.doneActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                void Share.share({
                  message: [
                    `Kova cash-out: ${quote.naira} to ${toName}, ${toBank} ••••${quote.account_last4}`,
                    `You sent $${quote.amount} at ${nairaText(Number(quote.rate))} per $1`,
                    `Reference ${quote.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
                    quote.tx_url ? `Proof: ${quote.tx_url}` : null,
                  ]
                    .filter(Boolean)
                    .join('\n'),
                }).catch(() => {})
              }
              style={({ pressed }) => [styles.outline, { flex: 1 }, pressed && { opacity: 0.7 }]}
            >
              <Icon name="share" size={18} />
              <Txt weight="bold" size={16}>
                Share receipt
              </Txt>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.back()}
              style={({ pressed }) => [styles.solid, { flex: 1 }, pressed && { opacity: 0.85 }]}
            >
              <Txt weight="bold" size={16} color={colors.white}>
                Done
              </Txt>
            </Pressable>
          </View>
        </ScrollView>
      ) : null}

      <Modal
        visible={sheet}
        transparent
        animationType="slide"
        onRequestClose={() => setSheet(false)}
      >
        <Pressable
          accessibilityLabel="Close"
          style={styles.backdrop}
          onPress={() => setSheet(false)}
        />
        <BankSheet
          banks={banks ?? []}
          search={search}
          setSearch={setSearch}
          onPick={pickFromList}
          onClose={() => setSheet(false)}
          bottom={Math.max(insets.bottom, 16)}
        />
      </Modal>
    </Screen>
  )
}

/** "Another bank": search, the banks most people send to, then every bank from A to Z. */
function BankSheet({
  banks,
  search,
  setSearch,
  onPick,
  onClose,
  bottom,
}: {
  banks: NairaBank[]
  search: string
  setSearch: (s: string) => void
  onPick: (b: NairaBank) => void
  onClose: () => void
  bottom: number
}) {
  const named = useMemo(
    () =>
      banks
        .map((b) => ({ bank: b, name: bankDisplayName(b) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [banks],
  )
  const q = search.trim().toLowerCase()
  const matches = q
    ? named.filter((n) => n.name.toLowerCase().includes(q) || n.bank.name.toLowerCase().includes(q))
    : named
  const popular = POPULAR_BANKS.slice(0, 8)
    .map((code) => named.find((n) => n.bank.code === code))
    .filter((n): n is { bank: NairaBank; name: string } => Boolean(n))

  return (
    <View style={[styles.sheet, { paddingBottom: bottom }]}>
      <View style={styles.grip} />
      <View style={styles.sheetHead}>
        <Txt weight="bold" size={22} style={{ letterSpacing: -0.5 }}>
          Choose a bank
        </Txt>
        <RoundButton icon="close" label="Close" onPress={onClose} />
      </View>
      <View style={styles.searchBox}>
        <Icon name="search" size={18} color={colors.muted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={
            banks.length > 100
              ? `Search ${Math.floor(banks.length / 100) * 100}+ banks`
              : 'Search banks'
          }
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          accessibilityLabel="Search banks"
          style={styles.searchInput}
        />
      </View>
      {q ? null : (
        <View style={{ gap: 8, marginTop: 16 }}>
          <Txt weight="bold" size={13} color={colors.muted}>
            Most used
          </Txt>
          <View style={styles.grid}>
            {popular.map((p) => (
              <Pressable
                key={p.bank.code}
                accessibilityRole="button"
                accessibilityLabel={p.name}
                onPress={() => onPick(p.bank)}
                style={({ pressed }) => [styles.gridCell, pressed && { opacity: 0.7 }]}
              >
                <BankLogo uri={p.bank.logo} name={p.name} size={40} />
                <Txt weight="bold" size={12} numberOfLines={1}>
                  {p.name}
                </Txt>
              </Pressable>
            ))}
          </View>
          <Txt weight="bold" size={13} color={colors.muted} style={{ marginTop: 8 }}>
            All banks, A to Z
          </Txt>
        </View>
      )}
      <View style={styles.sheetList}>
        <FlatList
          data={matches}
          keyExtractor={(n) => n.bank.code}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={14}
          renderItem={({ item, index }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.name}
              onPress={() => onPick(item.bank)}
              style={({ pressed }) => [
                styles.sheetRow,
                index < matches.length - 1 && styles.rule,
                pressed && { backgroundColor: colors.sunken },
              ]}
            >
              <BankLogo uri={item.bank.logo} name={item.name} size={32} />
              <Txt weight="semi" size={15} style={{ flex: 1 }} numberOfLines={1}>
                {item.name}
              </Txt>
              <Icon name="arrow" size={16} color={colors.muted} />
            </Pressable>
          )}
          ListEmptyComponent={
            <Txt weight="semi" size={14} color={colors.muted} style={{ padding: 16 }}>
              No bank by that name. Try its short name, like GTBank.
            </Txt>
          }
        />
      </View>
    </View>
  )
}

/** A bank's round logo on white, or its first letter when the list has no logo. */
function BankLogo({ uri, name, size }: { uri?: string | null; name: string; size: number }) {
  if (!uri)
    return (
      <View style={[styles.logoFallback, { width: size, height: size, borderRadius: size / 2 }]}>
        <Txt weight="bold" size={size * 0.4} color={colors.white}>
          {name.slice(0, 1)}
        </Txt>
      </View>
    )
  return (
    <Image
      source={{ uri }}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.white,
        borderWidth: 1,
        borderColor: inkAt(0.08),
      }}
      contentFit="cover"
      transition={120}
      accessible={false}
    />
  )
}

/** The person's initials, with their bank's logo as a badge. */
function Person({
  name,
  logo,
  size = 38,
  tone,
  ring,
}: {
  name: string
  logo?: string | null
  size?: number
  tone: ColorValue
  ring: ColorValue
}) {
  const badge = Math.round(size * 0.52)
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: tone,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Txt weight="bold" size={size * 0.36} color={colors.white}>
          {initials(name)}
        </Txt>
      </View>
      <View
        style={[
          styles.badge,
          { borderColor: ring, borderRadius: (badge + 4) / 2, right: -5, bottom: -5 },
        ]}
      >
        <BankLogo uri={logo} name={name} size={badge} />
      </View>
    </View>
  )
}

type StepState = 'done' | 'active' | 'pending'

/** The money's path, one step at a time: done, happening now, or still to come. */
function Timeline({ steps }: { steps: { title: string; detail: string; state: StepState }[] }) {
  return (
    <View style={styles.timeline} accessibilityLiveRegion="polite">
      {steps.map((s, i) => (
        <View key={s.title} style={{ flexDirection: 'row', gap: 14 }}>
          <View style={{ alignItems: 'center', width: 26 }}>
            {s.state === 'done' ? (
              <View style={styles.stepDone}>
                <Icon name="check" size={14} color={colors.white} strokeWidth={3} />
              </View>
            ) : s.state === 'active' ? (
              <View style={styles.stepActive}>
                <Ping size={26} />
                <View style={styles.stepDot} />
              </View>
            ) : (
              <View style={styles.stepPending} />
            )}
            {i < steps.length - 1 ? <View style={styles.stepLine} /> : null}
          </View>
          <View style={{ flex: 1, paddingBottom: 16 }}>
            <Txt weight="bold" size={16} color={s.state === 'pending' ? colors.muted : colors.ink}>
              {s.title}
            </Txt>
            <Txt weight="semi" size={13} color={colors.muted}>
              {s.detail}
            </Txt>
          </View>
        </View>
      ))}
    </View>
  )
}

function Fact({
  label,
  value,
  last,
  logo,
  bankName,
}: {
  label: string
  value: string
  last?: boolean
  logo?: string | null
  bankName?: string
}) {
  return (
    <View style={[styles.fact, !last && styles.rule]}>
      <Txt size={14} color={colors.muted}>
        {label}
      </Txt>
      <View style={styles.factValue}>
        {bankName ? <BankLogo uri={logo} name={bankName} size={20} /> : null}
        <Txt weight="bold" size={14} style={{ textAlign: 'right', flexShrink: 1 }}>
          {value}
        </Txt>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  flow: { flex: 1, paddingHorizontal: 20, paddingBottom: 12 },
  flowScroll: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 16, gap: 14 },
  form: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 20, gap: 14 },
  bottom: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 28,
  },
  amountBlock: { alignItems: 'center', marginTop: 16, gap: 2 },
  typed: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start' },
  getsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 10,
    paddingVertical: 5,
    paddingLeft: 5,
    paddingRight: 12,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chips: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.sunken,
  },
  maxChip: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 13,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.line,
  },
  recent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: 12,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  // The same field as Send's: a 50 pt pill with a 2 pt ink edge.
  accountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    paddingHorizontal: 18,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  accountInput: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    fontFamily: fonts.bold,
    fontSize: 20,
    letterSpacing: 1.5,
    color: colors.ink,
  },
  rule: { borderBottomWidth: 1, borderBottomColor: inkAt(0.1) },
  // Three across: five banks for the number and "Other bank", all in view under the field.
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    width: '31.8%',
    minHeight: 88,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  tileOn: { backgroundColor: colors.tealSoft },
  tileBusy: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 18,
    backgroundColor: pair('rgba(255,255,255,0.72)', 'rgba(22,22,22,0.72)'),
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileTick: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.tealSoft,
    backgroundColor: colors.positive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  otherIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.tealSoft,
  },
  confirmedTick: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.positive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    marginTop: 8,
    overflow: 'hidden',
    borderRadius: 28,
    backgroundColor: colors.fill,
    padding: 20,
  },
  heroWho: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  heroCoin: { position: 'absolute', right: -20, bottom: -24, transform: [{ rotate: '-12deg' }] },
  facts: {
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
  },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  factValue: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 7,
  },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  box: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    flexWrap: 'wrap',
  },
  timeline: {
    marginTop: 8,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingTop: 18,
    paddingHorizontal: 18,
    paddingBottom: 4,
  },
  stepDone: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.positive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepActive: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.white },
  stepPending: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: pair('#B9B7B2', '#3A3A3A'),
    backgroundColor: colors.paper,
  },
  stepLine: {
    width: 2,
    flex: 1,
    minHeight: 22,
    backgroundColor: pair('#C9C7C2', '#2C2C2C'),
    marginVertical: 4,
  },
  outline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 56,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.line,
  },
  solid: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    borderRadius: 999,
    backgroundColor: colors.fill,
  },
  celebrate: { height: 176, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  doneBadge: {
    position: 'absolute',
    right: 2,
    bottom: 8,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3,
    borderColor: colors.paper,
    backgroundColor: colors.positive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tookPill: {
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.tealSoft,
  },
  receipt: {
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
  },
  dashed: {
    borderTopWidth: 2,
    borderStyle: 'dashed',
    borderColor: pair('#C9C7C2', '#2C2C2C'),
    marginVertical: 2,
  },
  doneActions: { flexDirection: 'row', gap: 10 },
  logoFallback: {
    backgroundColor: colors.tealDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: { position: 'absolute', borderWidth: 2, padding: 0 },
  backdrop: { flex: 1, backgroundColor: pair('rgba(11,26,29,0.32)', 'rgba(0,0,0,0.6)') },
  sheet: {
    height: '86%',
    backgroundColor: colors.paper,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  grip: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.rule,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    marginTop: 14,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 12,
    fontFamily: fonts.semi,
    fontSize: 16,
    color: colors.ink,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gridCell: {
    width: '23.2%',
    alignItems: 'center',
    gap: 6,
    paddingTop: 10,
    paddingBottom: 8,
    paddingHorizontal: 4,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  sheetList: {
    flex: 1,
    marginTop: 8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 54,
    paddingHorizontal: 14,
  },
})
