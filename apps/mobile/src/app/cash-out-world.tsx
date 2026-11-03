import { parseAmount } from '@kova/monad'
import * as Haptics from 'expo-haptics'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { applyKey, formatUsd } from '@/lib/money'
import {
  addRecipient,
  type Corridor,
  getPayout,
  getPayoutBanks,
  getPayoutRate,
  getPayoutsInfo,
  getRecipients,
  inCurrency,
  type Payout,
  type PayoutBank,
  type PayoutField,
  type PayoutsInfo,
  quotePayout,
  type Recipient,
} from '@/lib/payouts'
import { colors, fonts, pair } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Icon } from '@/ui/Icon'
import { Keypad } from '@/ui/Keypad'
import { Header, PillButton, RoundButton, Screen, Txt } from '@/ui/primitives'

type Step = 'where' | 'country' | 'rail' | 'details' | 'amount' | 'review' | 'tracking'

/** Countries listed first: where Kova's people most often have accounts. */
const FIRST = ['US', 'CA', 'GB', 'EU', 'GH', 'KE', 'ZA']

/**
 * Cash out to any country Nuvion pays: a bank, mobile money, Interac or a USDC wallet. Pick a saved
 * account or add one (country, then the way, then its details), type an amount, see the rate locked
 * for a couple of minutes, approve with Face ID, and watch it land. Nigeria goes to the naira
 * cash-out, whose rate is better.
 */
export default function CashOutWorld() {
  const { profile, balance, signMessage, cashOutWorld } = useWallet()
  const insets = useSafeAreaInsets()
  const dev = useLocalSearchParams<{ step?: string; corridor?: string }>()
  const [info, setInfo] = useState<PayoutsInfo | null>(null)
  const [recipients, setRecipients] = useState<Recipient[] | null>(null)
  const [step, setStep] = useState<Step>('where')
  const [country, setCountry] = useState<string | null>(null)
  const [corridor, setCorridor] = useState<Corridor | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [bank, setBank] = useState<PayoutBank | null>(null)
  const [banks, setBanks] = useState<PayoutBank[] | null>(null)
  const [sheet, setSheet] = useState(false)
  const [recipient, setRecipient] = useState<Recipient | null>(null)
  const [typed, setTyped] = useState('')
  const [rate, setRate] = useState<number | null>(null)
  const [quote, setQuote] = useState<Payout | null>(null)
  const [payout, setPayout] = useState<Payout | null>(null)
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    void getPayoutsInfo()
      .then(setInfo)
      .catch((e) => setProblem(e instanceof Error ? e.message : 'Kova is unreachable.'))
  }, [])
  useEffect(() => {
    if (!profile) return
    void getRecipients(profile.address)
      .then(setRecipients)
      .catch(() => setRecipients([]))
  }, [profile])

  // Development only: `?step=country|amount|review|tracking`, or `?step=details&corridor=…`, to
  // open a step directly for screenshots.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once the rails and accounts arrive
  useEffect(() => {
    if (!__DEV__ || !info || !recipients || !dev.step) return
    if (dev.step === 'country') setStep('country')
    const picked = info.corridors.find((c) => c.id === dev.corridor)
    if (dev.step === 'details' && picked) choose(picked)
    const first = recipients[0]
    if (!first || !['amount', 'review', 'tracking'].includes(dev.step)) return
    void startAmount(first).then(() => {
      setTyped('20')
      if (dev.step === 'amount') return
      void quotePayout(profile?.address ?? '0x', first.id, '20').then((q) => {
        setQuote(q)
        if (dev.step === 'review') setStep('review')
        else {
          setPayout({ ...q, status: 'sending' })
          setStep('tracking')
        }
      })
    })
  }, [info, recipients])

  const countries = useMemo(() => {
    const by = new Map<string, Corridor[]>()
    for (const c of info?.corridors ?? []) by.set(c.country, [...(by.get(c.country) ?? []), c])
    const list = [...by.entries()].map(([code, rails]) => ({ code, rails }))
    const rank = (code: string) => {
      const i = FIRST.indexOf(code)
      return i === -1 ? (code === 'WW' ? 999 : 100) : i
    }
    return list.sort(
      (a, b) =>
        rank(a.code) - rank(b.code) ||
        (a.rails[0]?.name ?? '').localeCompare(b.rails[0]?.name ?? ''),
    )
  }, [info])

  const choose = (c: Corridor) => {
    setCorridor(c)
    setValues({ holder_name: profile?.name ?? '', address_country: homeCountry() })
    setBank(null)
    setBanks(null)
    setProblem(null)
    setStep('details')
    if (c.banks)
      void getPayoutBanks(c.banks)
        .then(setBanks)
        .catch(() => setBanks([]))
  }

  const pickCountry = (code: string) => {
    if (code === 'NG') {
      // Naira goes through PAJ: a better rate than converting through Nuvion.
      router.replace('/cash-out')
      return
    }
    const rails = countries.find((c) => c.code === code)?.rails ?? []
    setCountry(code)
    if (rails.length === 1 && rails[0]) choose(rails[0])
    else setStep('rail')
  }

  const save = async () => {
    if (!profile || !corridor) return
    setBusy(true)
    setProblem(null)
    try {
      const saved = await addRecipient(profile.address, signMessage, corridor.id, {
        ...values,
        ...(bank ? { bank: bank.code } : {}),
      })
      setRecipients((list) => [saved, ...(list ?? [])])
      await startAmount(saved)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Those details weren’t saved. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const startAmount = async (r: Recipient) => {
    setRecipient(r)
    setTyped('')
    setQuote(null)
    setProblem(null)
    setStep('amount')
    setRate(null)
    void getPayoutRate(r.currency === 'USDC' ? 'USC' : r.currency)
      .then(setRate)
      .catch(() => setRate(null))
  }

  const dollars = (() => {
    try {
      return typed ? parseAmount(typed) : 0n
    } catch {
      return 0n
    }
  })()
  const min = info ? parseAmount(info.min) : 1_000_000n
  const max = info ? parseAmount(info.max) : 500_000_000n
  const short = balance !== null && dollars > balance

  const getQuote = async () => {
    if (!profile || !recipient) return
    setBusy(true)
    setProblem(null)
    try {
      setQuote(await quotePayout(profile.address, recipient.id, typed))
      setStep('review')
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Kova couldn’t get a rate. Try again.')
    } finally {
      setBusy(false)
    }
  }

  // The quote's clock, and the payout's progress once it's on its way.
  useEffect(() => {
    if (step !== 'review') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [step])
  useEffect(() => {
    if (step !== 'tracking' || !payout || payout.status === 'paid' || payout.status === 'failed')
      return
    const t = setInterval(() => {
      void getPayout(payout.id)
        .then(setPayout)
        .catch(() => {})
    }, 4000)
    return () => clearInterval(t)
  }, [step, payout])

  const left = quote ? Math.max(0, Math.floor((Date.parse(quote.expires_at) - now) / 1000)) : 0

  const approve = async () => {
    if (!quote) return
    setBusy(true)
    setProblem(null)
    try {
      const sent = await cashOutWorld(quote)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setPayout(sent)
      setStep('tracking')
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'The cash-out didn’t go through. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const back = () => {
    setProblem(null)
    if (step === 'country') setStep('where')
    else if (step === 'rail') setStep('country')
    else if (step === 'details')
      setStep(
        (countries.find((c) => c.code === country)?.rails.length ?? 1) > 1 ? 'rail' : 'country',
      )
    else if (step === 'amount') setStep('where')
    else if (step === 'review') setStep('amount')
    else router.back()
  }

  const title =
    step === 'where'
      ? 'Cash out'
      : step === 'country'
        ? 'Where to?'
        : step === 'rail'
          ? (countries.find((c) => c.code === country)?.rails[0]?.name ?? 'How?')
          : step === 'details'
            ? (corridor?.title ?? 'Details')
            : step === 'amount'
              ? 'How much?'
              : step === 'review'
                ? 'Check and approve'
                : 'On its way'

  return (
    <Screen>
      <Header
        title={title}
        onBack={step === 'tracking' ? null : step === 'where' ? () => router.back() : back}
        backIcon={step === 'where' ? 'close' : 'back'}
      />

      {!info ? (
        <View style={styles.center}>
          <Txt size={15} color={colors.muted}>
            {problem ?? 'Opening…'}
          </Txt>
        </View>
      ) : !info.live ? (
        <View style={styles.center}>
          <Txt weight="bold" size={22}>
            Not switched on yet
          </Txt>
          <Txt size={15} color={colors.muted} style={{ textAlign: 'center' }}>
            Cashing out to other countries isn’t on for this version of Kova yet.
          </Txt>
        </View>
      ) : null}

      {info?.live && step === 'where' ? (
        <ScrollView contentContainerStyle={styles.pad}>
          <Txt size={15} color={colors.muted} style={{ lineHeight: 22 }}>
            Banks, mobile money and Interac in {countries.length - 1}+ places, or a USDC wallet.
          </Txt>
          {recipients && recipients.length > 0 ? (
            <View style={styles.card}>
              {recipients.map((r, i) => (
                <Row
                  key={r.id}
                  flag={r.flag}
                  title={r.label}
                  detail={`${r.name} · ${r.title}`}
                  chip={r.speed === 'Instant' ? 'Instant' : undefined}
                  last={i === recipients.length - 1}
                  onPress={() => void startAmount(r)}
                />
              ))}
            </View>
          ) : null}
          <View style={{ marginTop: 18 }}>
            <PillButton label="Add an account" icon="plus" onPress={() => setStep('country')} />
          </View>
        </ScrollView>
      ) : null}

      {info?.live && step === 'country' ? (
        <View style={{ flex: 1 }}>
          <View style={[styles.searchBox, { marginHorizontal: 20 }]}>
            <Icon name="search" size={18} color={colors.muted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search countries"
              placeholderTextColor={colors.muted}
              autoCorrect={false}
              accessibilityLabel="Search countries"
              style={styles.searchInput}
            />
          </View>
          <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
            <View style={[styles.card, { marginTop: 12 }]}>
              {(() => {
                const shown = countries.filter((c) =>
                  (c.rails[0]?.name ?? '').toLowerCase().includes(search.trim().toLowerCase()),
                )
                return shown.map((item, index) => {
                  const first = item.rails[0] as Corridor
                  return (
                    <Row
                      key={item.code}
                      flag={first.flag}
                      title={first.name}
                      detail={
                        item.code === 'NG'
                          ? 'Naira to any bank, at the best rate'
                          : ways(item.rails)
                      }
                      chip={item.rails.some((r) => r.speed === 'Instant') ? 'Instant' : undefined}
                      last={index === shown.length - 1}
                      onPress={() => pickCountry(item.code)}
                    />
                  )
                })
              })()}
            </View>
          </ScrollView>
        </View>
      ) : null}

      {info?.live && step === 'rail' ? (
        <ScrollView contentContainerStyle={styles.pad}>
          <View style={styles.card}>
            {(countries.find((c) => c.code === country)?.rails ?? []).map((r, i, all) => (
              <Row
                key={r.id}
                flag={r.flag}
                title={r.title}
                detail={`${r.speed} · arrives in ${r.currency}`}
                chip={r.speed === 'Instant' ? 'Instant' : undefined}
                last={i === all.length - 1}
                onPress={() => choose(r)}
              />
            ))}
          </View>
        </ScrollView>
      ) : null}

      {info?.live && step === 'details' && corridor ? (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
            <View style={styles.railHead}>
              <Txt size={28}>{corridor.flag}</Txt>
              <View style={{ flex: 1 }}>
                <Txt weight="bold" size={16}>
                  {corridor.name}
                </Txt>
                <Txt size={13} color={colors.muted}>
                  {corridor.speed} · arrives in {corridor.currency}
                </Txt>
              </View>
            </View>
            {corridor.fields.map((f) => (
              <FieldInput
                key={f.key}
                field={f}
                value={values[f.key] ?? ''}
                bank={bank}
                banksLoading={!!corridor.banks && banks === null}
                onBank={() => setSheet(true)}
                onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
              />
            ))}
            <Txt size={12} color={colors.muted} style={{ marginTop: 14, lineHeight: 17 }}>
              Kova keeps only the last digits. The rest stays with Nuvion.
            </Txt>
            {problem ? <Problem text={problem} /> : null}
            <View style={{ marginTop: 16 }}>
              <PillButton
                label={busy ? 'Saving…' : 'Save and continue'}
                icon="face"
                loading={busy}
                onPress={() => void save()}
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      ) : null}

      {info?.live && step === 'amount' && recipient ? (
        <View style={[styles.flow, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.to}>
            <Txt size={20}>{recipient.flag}</Txt>
            <Txt weight="semi" size={14} numberOfLines={1} style={{ flex: 1 }}>
              {recipient.label}
            </Txt>
          </View>
          <Txt weight="bold" size={56} style={styles.amount}>
            <Txt weight="bold" size={30} color={colors.muted}>
              $
            </Txt>
            {typed || '0'}
          </Txt>
          <View style={styles.gets}>
            <Txt weight="semi" size={14} color={colors.muted}>
              They get
            </Txt>
            <Txt weight="bold" size={14}>
              {rate === null
                ? '…'
                : `≈ ${inCurrency((Number(dollars) / 1e6) * rate, recipient.currency)}`}
            </Txt>
          </View>
          <View style={styles.from}>
            <Txt weight="semi" size={14} style={{ flex: 1 }}>
              From Kova balance
            </Txt>
            <Txt weight="bold" size={14} color={short ? colors.danger : colors.muted}>
              {balance === null ? '—' : formatUsd(balance)}
            </Txt>
          </View>
          <Keypad size={54} onKey={(key) => setTyped((t) => applyKey(t, key))} />
          {problem ? <Problem text={problem} /> : null}
          <View style={{ marginTop: 12 }}>
            <PillButton
              label={
                dollars > 0n && dollars < min
                  ? `At least ${formatUsd(min)}`
                  : dollars > max
                    ? `Up to ${formatUsd(max)} at a time`
                    : short
                      ? 'Not enough in your balance'
                      : busy
                        ? 'Getting the rate…'
                        : 'See the rate'
              }
              loading={busy}
              disabled={dollars < min || dollars > max || short}
              onPress={() => void getQuote()}
            />
          </View>
        </View>
      ) : null}

      {info?.live && step === 'review' && quote ? (
        <ScrollView contentContainerStyle={styles.pad}>
          <View style={styles.hero}>
            <Txt weight="semi" size={14} color={colors.muted}>
              {quote.recipient?.holder_name ?? 'They'} get{quote.recipient ? 's' : ''}
            </Txt>
            <Txt weight="bold" size={40} style={{ letterSpacing: -1.5 }}>
              {inCurrency(quote.amount_to, quote.currency)}
            </Txt>
          </View>
          <View style={styles.card}>
            <Fact label="You send" value={`$${quote.amount}`} />
            {Number(quote.fee) > 0 ? <Fact label="Kova fee" value={`$${quote.fee}`} /> : null}
            {quote.currency !== 'USD' ? (
              <Fact label="Rate" value={`$1 = ${inCurrency(Number(quote.rate), quote.currency)}`} />
            ) : null}
            <Fact label="To" value={quote.recipient?.label ?? ''} />
            <Fact label="Arrives" value={quote.recipient?.speed ?? ''} last />
          </View>
          <View style={styles.held}>
            <Icon name="clock" size={15} color={left > 0 ? colors.ink : colors.danger} />
            <Txt weight="semi" size={13} color={left > 0 ? colors.ink : colors.danger}>
              {left > 0
                ? `Rate held for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
                : 'This rate ran out. Get a fresh one.'}
            </Txt>
          </View>
          {problem ? <Problem text={problem} /> : null}
          <View style={{ marginTop: 16 }}>
            {left > 0 ? (
              <PillButton
                label={busy ? 'Cashing out…' : `Cash out $${quote.amount}`}
                icon="face"
                loading={busy}
                onPress={() => void approve()}
              />
            ) : (
              <PillButton label="Get a fresh rate" onPress={() => void getQuote()} />
            )}
          </View>
        </ScrollView>
      ) : null}

      {step === 'tracking' && payout ? (
        <View style={[styles.pad, { flex: 1 }]}>
          <View style={styles.hero}>
            <Txt weight="bold" size={40} style={{ letterSpacing: -1.5 }}>
              {inCurrency(payout.amount_to, payout.currency)}
            </Txt>
            <Txt size={15} color={colors.muted}>
              to {payout.recipient?.label}
            </Txt>
          </View>
          <View style={styles.card}>
            <Stage title="Dollars sent to Kova" detail="On Monad, in a second" state="done" />
            <Stage
              title={payout.status === 'failed' ? 'Didn’t go through' : 'Paying out'}
              detail={
                payout.status === 'failed'
                  ? (payout.failure ?? 'Your dollars went back to your wallet.')
                  : (payout.recipient?.title ?? '')
              }
              state={
                payout.status === 'failed' ? 'failed' : payout.status === 'paid' ? 'done' : 'active'
              }
            />
            <Stage
              title="Arrived"
              detail={payout.status === 'paid' ? 'In the account' : (payout.recipient?.speed ?? '')}
              state={payout.status === 'paid' ? 'done' : 'pending'}
              last
            />
          </View>
          <View style={{ marginTop: 'auto' }}>
            <PillButton label="Done" onPress={() => router.back()} />
          </View>
        </View>
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
          bottom={Math.max(insets.bottom, 16)}
          onClose={() => setSheet(false)}
          onPick={(b) => {
            setBank(b)
            setSheet(false)
          }}
        />
      </Modal>
    </Screen>
  )
}

/** The country the phone is set to (en-NG → NG), as a starting guess for where someone lives. */
function homeCountry(): string {
  const region = Intl.DateTimeFormat().resolvedOptions().locale.split('-').pop() ?? ''
  return /^[A-Z]{2}$/.test(region) ? region : ''
}

/** A country's ways out in a few words: "Interac · Bank account", "M-Pesa · Bank account". */
const ways = (rails: Corridor[]) =>
  [
    ...new Set(
      rails.map((r) =>
        r.title.includes('Interac')
          ? 'Interac'
          : r.title.startsWith('M-Pesa')
            ? 'M-Pesa'
            : r.title.startsWith('Mobile money')
              ? 'Mobile money'
              : r.title.startsWith('Wire')
                ? 'Wire'
                : r.title.startsWith('SWIFT')
                  ? 'SWIFT, in dollars'
                  : r.title.startsWith('USDC')
                    ? 'Base, Ethereum, Polygon, Solana'
                    : r.title.startsWith('Another Nuvion')
                      ? 'Instant, in dollars'
                      : r.title.startsWith('Bank or e-wallet')
                        ? 'Bank or e-wallet'
                        : 'Bank account',
      ),
    ),
  ].join(' · ')

function Row({
  flag,
  title,
  detail,
  chip,
  last,
  onPress,
}: {
  flag: string
  title: string
  detail: string
  chip?: string
  last?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      onPress={() => {
        void Haptics.selectionAsync()
        onPress()
      }}
      style={({ pressed }) => [styles.row, !last && styles.rule, pressed && { opacity: 0.7 }]}
    >
      <Txt size={26}>{flag}</Txt>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt weight="semi" size={16} numberOfLines={1}>
          {title}
        </Txt>
        <Txt size={13} color={colors.muted} numberOfLines={2}>
          {detail}
        </Txt>
      </View>
      {chip ? (
        <View style={styles.chip}>
          <Txt weight="bold" size={11} color={colors.positive}>
            {chip}
          </Txt>
        </View>
      ) : null}
      <Icon name="arrow" size={16} color={colors.muted} />
    </Pressable>
  )
}

const keyboardFor = (f: PayoutField) =>
  f.kind === 'digits'
    ? 'number-pad'
    : f.kind === 'email'
      ? 'email-address'
      : f.kind === 'phone'
        ? 'phone-pad'
        : 'default'

function FieldInput({
  field,
  value,
  bank,
  banksLoading,
  onBank,
  onChange,
}: {
  field: PayoutField
  value: string
  bank: PayoutBank | null
  banksLoading: boolean
  onBank: () => void
  onChange: (v: string) => void
}) {
  return (
    <View style={styles.field}>
      {field.section ? (
        <View style={styles.section}>
          <Txt weight="bold" size={16}>
            {field.section}
          </Txt>
          <Txt size={13} color={colors.muted}>
            Nuvion, who pays out for Kova, needs this for every payout.
          </Txt>
        </View>
      ) : null}
      <Txt weight="semi" size={13} color={colors.muted}>
        {field.label}
        {field.optional ? ' (optional)' : ''}
      </Txt>
      {field.kind === 'bank' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={bank ? `Bank: ${bank.name}` : 'Choose a bank'}
          onPress={onBank}
          disabled={banksLoading}
          style={({ pressed }) => [styles.input, styles.pick, pressed && { opacity: 0.7 }]}
        >
          <Txt
            weight="semi"
            size={16}
            color={bank ? colors.ink : colors.muted}
            style={{ flex: 1 }}
            numberOfLines={1}
          >
            {bank ? bank.name : banksLoading ? 'Loading banks…' : 'Choose a bank'}
          </Txt>
          <Icon name="arrow" size={16} color={colors.muted} />
        </Pressable>
      ) : field.kind === 'select' ? (
        <View style={styles.chips}>
          {(field.options ?? []).map((o) => (
            <Pressable
              key={o.value}
              accessibilityRole="button"
              accessibilityState={{ selected: value === o.value }}
              onPress={() => onChange(o.value)}
              style={[styles.option, value === o.value && styles.optionOn]}
            >
              <Txt weight="semi" size={14} color={value === o.value ? colors.paper : colors.ink}>
                {o.label}
              </Txt>
            </Pressable>
          ))}
        </View>
      ) : (
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={field.placeholder ?? ''}
          placeholderTextColor={pair('rgba(31,52,56,0.38)', 'rgba(233,229,221,0.38)')}
          keyboardType={keyboardFor(field)}
          autoCapitalize={
            field.kind === 'text'
              ? 'words'
              : field.kind === 'country' || field.kind === 'bic' || field.kind === 'iban'
                ? 'characters'
                : 'none'
          }
          autoCorrect={false}
          accessibilityLabel={field.label}
          style={styles.input}
        />
      )}
    </View>
  )
}

function BankSheet({
  banks,
  bottom,
  onClose,
  onPick,
}: {
  banks: PayoutBank[]
  bottom: number
  onClose: () => void
  onPick: (b: PayoutBank) => void
}) {
  const [q, setQ] = useState('')
  const matches = banks.filter((b) => b.name.toLowerCase().includes(q.trim().toLowerCase()))
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
          value={q}
          onChangeText={setQ}
          placeholder={`Search ${banks.length} banks`}
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          accessibilityLabel="Search banks"
          style={styles.searchInput}
        />
      </View>
      <FlatList
        style={{ marginTop: 12 }}
        data={matches}
        keyExtractor={(b) => `${b.code}-${b.name}`}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={16}
        renderItem={({ item, index }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.name}
            onPress={() => onPick(item)}
            style={({ pressed }) => [
              styles.sheetRow,
              index < matches.length - 1 && styles.rule,
              pressed && { backgroundColor: colors.sunken },
            ]}
          >
            <Txt weight="semi" size={15} style={{ flex: 1 }} numberOfLines={1}>
              {item.name}
            </Txt>
            <Icon name="arrow" size={16} color={colors.muted} />
          </Pressable>
        )}
        ListEmptyComponent={
          <Txt weight="semi" size={14} color={colors.muted} style={{ padding: 16 }}>
            No bank by that name.
          </Txt>
        }
      />
    </View>
  )
}

function Fact({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.fact, !last && styles.rule]}>
      <Txt size={14} color={colors.muted}>
        {label}
      </Txt>
      <Txt weight="bold" size={14} style={{ flexShrink: 1, textAlign: 'right' }} numberOfLines={1}>
        {value}
      </Txt>
    </View>
  )
}

function Stage({
  title,
  detail,
  state,
  last,
}: {
  title: string
  detail: string
  state: 'done' | 'active' | 'pending' | 'failed'
  last?: boolean
}) {
  return (
    <View style={[styles.stage, !last && styles.rule]}>
      <View
        style={[
          styles.stageDot,
          state === 'done' && { backgroundColor: colors.positive, borderColor: colors.positive },
          state === 'active' && { borderColor: colors.ink },
          state === 'failed' && { backgroundColor: colors.danger, borderColor: colors.danger },
        ]}
      >
        {state === 'done' ? <Icon name="check" size={13} color={colors.white} /> : null}
        {state === 'failed' ? <Icon name="close" size={13} color={colors.white} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Txt weight="bold" size={15} color={state === 'pending' ? colors.muted : colors.ink}>
          {title}
        </Txt>
        <Txt size={13} color={colors.muted} style={{ lineHeight: 18 }}>
          {detail}
        </Txt>
      </View>
    </View>
  )
}

function Problem({ text }: { text: string }) {
  return (
    <Txt weight="medium" size={14} color={colors.danger} style={{ marginTop: 12, lineHeight: 20 }}>
      {text}
    </Txt>
  )
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 32 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 28,
  },
  card: {
    marginTop: 16,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rule: { borderBottomWidth: 2, borderColor: colors.sunken },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: pair('rgba(30,122,90,0.12)', 'rgba(120,210,170,0.16)'),
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, fontFamily: fonts.semi, fontSize: 16, color: colors.ink },
  railHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: colors.sunken,
  },
  field: { marginTop: 14, gap: 6 },
  section: { marginTop: 14, marginBottom: 2, gap: 2 },
  input: {
    minHeight: 52,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontFamily: fonts.semi,
    fontSize: 16,
  },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  flow: { flex: 1, paddingHorizontal: 22 },
  to: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'center',
    maxWidth: '100%',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: colors.sunken,
  },
  amount: { textAlign: 'center', marginTop: 10, letterSpacing: -2 },
  gets: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 2 },
  from: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  hero: { alignItems: 'center', gap: 4, marginTop: 12 },
  fact: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  held: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
    marginTop: 14,
  },
  stage: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  stageDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    height: '78%',
    paddingHorizontal: 20,
    paddingTop: 10,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.paper,
  },
  grip: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.sunken,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    marginBottom: 12,
  },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
})
