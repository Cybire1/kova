import { parseAmount } from '@kova/monad'
import * as Haptics from 'expo-haptics'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
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
import { DEMO_BALANCE, demoCashOutOn, demoSend } from '@/lib/demo-cashout'
import { applyKey, formatUsd } from '@/lib/money'
import {
  addRecipient,
  type CashOutAccess,
  type Corridor,
  getCashOutAccounts,
  getPayout,
  getPayoutBanks,
  getPayoutRate,
  getPayoutsInfo,
  inCurrency,
  type Payout,
  type PayoutBank,
  PayoutError,
  type PayoutField,
  type PayoutsInfo,
  quotePayout,
  type Recipient,
  type Verification,
} from '@/lib/payouts'
import { load, save as store } from '@/lib/storage'
import { colors, fonts, pair } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Flag, flagCode } from '@/ui/Flag'
import { Icon } from '@/ui/Icon'
import { Keypad } from '@/ui/Keypad'
import { Header, PillButton, RoundButton, Screen, Txt } from '@/ui/primitives'

type Step = 'where' | 'country' | 'rail' | 'details' | 'amount' | 'review' | 'tracking'

/** Countries offered first, after the one the phone is set to. */
const POPULAR = ['US', 'GB', 'NG', 'KE', 'CA', 'EU', 'GH']

/** The fields about the person (not the account), which Kova asks once and keeps on the phone. */
const ABOUT = [
  'email',
  'address_line1',
  'address_city',
  'address_state',
  'address_postal_code',
  'address_country',
]
const aboutKey = (address: string) => `kova.cashout.about.${address.toLowerCase()}`

/**
 * Cash out to a bank, mobile money or a USDC wallet, almost anywhere. Pick a saved account or add
 * one (where, then how it should arrive, then the account), type an amount and see what lands and
 * when, check it, approve with Face ID, and follow it to the account. The person's own address is
 * asked once and kept on this phone. Nigeria goes to the naira cash-out, whose rate is better.
 */
export default function CashOutWorld() {
  const wallet = useWallet()
  const { profile, signMessage } = wallet
  // Development only: the cash-out demo (lib/demo-cashout.ts) has its own balance and payouts.
  const balance = demoCashOutOn() ? DEMO_BALANCE : wallet.balance
  const cashOutWorld = demoCashOutOn() ? async (q: Payout) => demoSend(q) : wallet.cashOutWorld
  const insets = useSafeAreaInsets()
  const dev = useLocalSearchParams<{
    step?: string
    corridor?: string
    country?: string
    film?: string
  }>()
  const list = useRef<ScrollView>(null)
  const [info, setInfo] = useState<PayoutsInfo | null>(null)
  const [recipients, setRecipients] = useState<Recipient[] | null>(null)
  const [access, setAccess] = useState<CashOutAccess | null>(null)
  const [step, setStep] = useState<Step>('where')
  const [country, setCountry] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [corridor, setCorridor] = useState<Corridor | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [about, setAbout] = useState<Record<string, string> | null>(null)
  const [editAbout, setEditAbout] = useState(false)
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
    void getCashOutAccounts(profile.address)
      .then((r) => {
        setRecipients(r.recipients)
        setAccess(r.access)
      })
      .catch(() => setRecipients([]))
    void load<Record<string, string> | null>(aboutKey(profile.address), null).then(setAbout)
  }, [profile])

  // Development only: `?step=country`, `?step=rail&country=US`, `?step=details&corridor=…`, or
  // `?step=amount|review|tracking` with the first saved account, to open a step for screenshots.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once the rails and accounts arrive
  useEffect(() => {
    if (!__DEV__ || !info || !recipients || !dev.step) return
    if (dev.step === 'country') setStep('country')
    if (dev.step === 'rail' && dev.country) pickCountry(dev.country)
    const chosen = info.corridors.find((c) => c.id === dev.corridor)
    if (dev.step === 'details' && chosen) choose(chosen)
    const first = recipients[0]
    if (!first || !['amount', 'review', 'tracking'].includes(dev.step)) return
    void startAmount(first).then(() => {
      setTyped('100')
      if (dev.step === 'amount') return
      void quotePayout(profile?.address ?? '0x', first.id, '100').then((q) => {
        setQuote(q)
        if (dev.step === 'review') setStep('review')
        else {
          setPayout(demoCashOutOn() ? demoSend(q) : { ...q, status: 'sending' })
          setStep('tracking')
        }
      })
    })
  }, [info, recipients])

  // Development only, for the launch film: `?film=1` (with the cash-out demo on) plays one real
  // run of the screens by itself, at a watchable pace, since a simulator can't be tapped while
  // it's recorded. Every step calls the same functions a tap would.
  const live = useRef(
    {} as {
      pickCountry: (code: string) => void
      choose: (c: Corridor) => void
      saveAccount: () => Promise<void>
      getQuote: () => Promise<void>
      approve: () => Promise<void>
    },
  )
  const filmed = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: once the rails and accounts arrive
  useEffect(() => {
    if (!__DEV__ || !dev.film || !demoCashOutOn() || !info || !recipients || filmed.current) return
    filmed.current = true
    const stopped = false
    const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))
    const type = async (text: string, each: number, put: (t: string) => void) => {
      for (let i = 1; i <= text.length && !stopped; i++) {
        put(text.slice(0, i))
        await wait(each)
      }
    }
    setAbout({
      email: 'ada@example.com',
      address_line1: '14 Riverside Drive',
      address_city: 'Nairobi',
      address_state: 'Nairobi',
      address_postal_code: '00100',
      address_country: 'KE',
    })
    void getPayoutRate('KES').catch(() => {})
    void (async () => {
      await wait(2600)
      setStep('country')
      await wait(1500)
      list.current?.scrollTo({ y: 560, animated: true })
      await wait(1300)
      list.current?.scrollTo({ y: 1180, animated: true })
      await wait(1300)
      list.current?.scrollTo({ y: 0, animated: true })
      await wait(900)
      await type('Ken', 220, setSearch)
      await wait(900)
      void Haptics.selectionAsync()
      live.current.pickCountry('KE')
      await wait(1700)
      setPicked('ke_eft')
      await wait(650)
      setPicked('ke_momo')
      await wait(1000)
      const momo = info.corridors.find((c) => c.id === 'ke_momo')
      if (!momo || stopped) return
      live.current.choose(momo)
      await wait(1100)
      setValues((v) => ({ ...v, scheme: 'mpesa' }))
      await wait(500)
      await type('+254 712 345 678', 70, (t) => setValues((v) => ({ ...v, phone_number: t })))
      await wait(1100)
      await live.current.saveAccount()
      await wait(900)
      await type('50', 260, setTyped)
      await wait(1500)
      await live.current.getQuote()
      await wait(2300)
      await live.current.approve()
    })()
  }, [info, recipients])

  /** Every country with its ways out; "any other country" and USDC kept apart. */
  const countries = useMemo(() => {
    const by = new Map<string, Corridor[]>()
    for (const c of info?.corridors ?? []) by.set(c.country, [...(by.get(c.country) ?? []), c])
    return [...by.entries()]
      .map(([code, rails]) => ({ code, rails, name: rails[0]?.name ?? code }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [info])
  const named = countries.filter((c) => c.code !== 'WW')
  const elsewhere = (info?.corridors ?? []).filter((c) => c.country === 'WW')
  const wayOf = (r: Recipient) => info?.corridors.find((c) => c.id === r.corridor)
  /** The ways out for a country; for "any other country", the international transfers. */
  const railsOf = (code: string | null | undefined) =>
    (info?.corridors ?? []).filter(
      (c) => c.country === code && (code !== 'WW' || c.id.startsWith('swift')),
    )
  const feeOn = (dollars: number) =>
    Math.ceil((dollars * (info?.fee_bps ?? 0)) / 10_000 / 0.01) * 0.01

  const choose = (c: Corridor) => {
    setCorridor(c)
    setValues({
      holder_name: profile?.name ?? '',
      address_country: homeCountry(),
      ...(about ?? {}),
    })
    setEditAbout(!about)
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
    const rails = railsOf(code)
    setCountry(code)
    setSearch('')
    if (rails.length === 1 && rails[0]) {
      choose(rails[0])
      return
    }
    setPicked(rails[0]?.id ?? null)
    setRate(null)
    setStep('rail')
    const currency = rails[0]?.currency
    if (currency && currency !== 'USD')
      void getPayoutRate(currency)
        .then(setRate)
        .catch(() => setRate(null))
    else setRate(1)
  }

  /** Kova said the ID check comes first: back to the first step, which shows where it stands. */
  const needsCheck = (e: unknown) => {
    if (!(e instanceof PayoutError) || !e.verification) return false
    setAccess({ required: true, verification: e.verification })
    setStep('where')
    return true
  }
  const mustVerify = !!access?.required && access.verification !== 'verified'

  const saveAccount = async () => {
    if (!profile || !corridor) return
    setBusy(true)
    setProblem(null)
    try {
      const saved = await addRecipient(profile.address, signMessage, corridor.id, {
        ...values,
        ...(bank ? { bank: bank.code } : {}),
      })
      const kept = Object.fromEntries(ABOUT.filter((k) => values[k]).map((k) => [k, values[k]]))
      if (Object.keys(kept).length) {
        setAbout(kept as Record<string, string>)
        void store(aboutKey(profile.address), kept)
      }
      setRecipients((list) => [saved, ...(list ?? []).filter((r) => r.label !== saved.label)])
      await startAmount(saved)
    } catch (e) {
      if (needsCheck(e)) return
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
    setRate(r.currency === 'USD' ? 1 : null)
    if (r.currency !== 'USD')
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
      if (needsCheck(e)) return
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

  live.current = {
    pickCountry: (code) => pickCountry(code),
    choose: (c) => choose(c),
    saveAccount: () => saveAccount(),
    getQuote: () => getQuote(),
    approve: () => approve(),
  }

  const back = () => {
    setProblem(null)
    if (step === 'country') setStep('where')
    else if (step === 'rail') setStep('country')
    else if (step === 'details') setStep(railsOf(corridor?.country).length > 1 ? 'rail' : 'country')
    else if (step === 'amount') setStep('where')
    else if (step === 'review') setStep('amount')
    else router.back()
  }

  const placeName = (code: string | null) => countries.find((c) => c.code === code)?.name ?? ''
  const title =
    step === 'where'
      ? 'Cash out'
      : step === 'country'
        ? 'Where to?'
        : step === 'rail'
          ? placeName(country)
          : step === 'details'
            ? (corridor?.title ?? 'Details')
            : step === 'amount'
              ? 'How much?'
              : step === 'review'
                ? 'Check and send'
                : payout?.status === 'failed'
                  ? 'Sent back'
                  : payout?.status === 'paid'
                    ? 'Arrived'
                    : 'On its way'
  const progress =
    step === 'country'
      ? 1
      : step === 'rail'
        ? 2
        : step === 'details'
          ? 3
          : step === 'amount' || step === 'review'
            ? 4
            : 0

  const fields = corridor?.fields ?? []
  const split = fields.findIndex((f) => !!f.section)
  const accountFields = split === -1 ? fields : fields.slice(0, split)
  const aboutFields = split === -1 ? [] : fields.slice(split)
  const aboutComplete = aboutFields.every((f) => f.optional || !!values[f.key])

  return (
    <Screen>
      <Header
        title={title}
        onBack={step === 'tracking' ? null : step === 'where' ? () => router.back() : back}
        backIcon={step === 'where' ? 'close' : 'back'}
      />
      {progress > 0 ? <Steps at={progress} /> : null}

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
          <Txt weight="semi" size={13} color={colors.muted}>
            From your Kova dollars
          </Txt>
          <Txt weight="bold" size={34} style={{ letterSpacing: -1 }}>
            {balance === null ? '—' : formatUsd(balance)}
          </Txt>

          {mustVerify ? <VerifyFirst verification={access?.verification ?? 'needed'} /> : null}

          {!mustVerify && recipients && recipients.length > 0 ? (
            <>
              <View style={styles.groupHead}>
                <Txt weight="bold" size={13}>
                  Send to
                </Txt>
                <Txt size={12} color={colors.muted}>
                  {recipients.length} saved
                </Txt>
              </View>
              <View style={styles.card}>
                {recipients.map((r, i) => {
                  const way = wayOf(r)
                  return (
                    <Row
                      key={r.id}
                      flag={way ? flagCode(way) : flagCode(r)}
                      title={r.label}
                      detail={`${r.title} · ${r.currency}`}
                      last={i === recipients.length - 1}
                      onPress={() => void startAmount(r)}
                    />
                  )
                })}
              </View>
            </>
          ) : null}

          {mustVerify ? null : (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void Haptics.selectionAsync()
                setStep('country')
              }}
              style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.7 }]}
            >
              <View style={styles.addDot}>
                <Icon name="plus" size={16} color={colors.dark} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt weight="bold" size={15}>
                  New account
                </Txt>
                <Txt size={12} color={colors.muted}>
                  A bank or mobile money, almost anywhere
                </Txt>
              </View>
            </Pressable>
          )}
        </ScrollView>
      ) : null}

      {info?.live && step === 'country' ? (
        <View style={{ flex: 1 }}>
          <View style={[styles.searchBox, { marginHorizontal: 20 }]}>
            <Icon name="search" size={18} color={colors.ink} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search a country or currency"
              placeholderTextColor={colors.muted}
              autoCorrect={false}
              accessibilityLabel="Search countries"
              style={styles.searchInput}
            />
          </View>
          <ScrollView
            ref={list}
            contentContainerStyle={styles.pad}
            keyboardShouldPersistTaps="handled"
          >
            {(() => {
              const q = search.trim().toLowerCase()
              const shown = named.filter((c) =>
                `${c.name} ${c.rails[0]?.currency ?? ''} ${ways(c.rails)}`
                  .toLowerCase()
                  .includes(q),
              )
              const home = homeCountry()
              const suggested = [
                ...new Set([home === 'NG' ? '' : home, ...POPULAR].filter(Boolean)),
              ]
                .map((code) => named.find((c) => c.code === code))
                .filter((c): c is (typeof named)[number] => !!c)
                .slice(0, 3)
              return (
                <>
                  {!q ? (
                    <>
                      <Txt weight="bold" size={12} color={colors.muted} style={styles.label}>
                        Where you live, and popular
                      </Txt>
                      <View style={styles.tiles}>
                        {suggested.map((c) => (
                          <Pressable
                            key={c.code}
                            accessibilityRole="button"
                            accessibilityLabel={c.name}
                            onPress={() => {
                              void Haptics.selectionAsync()
                              pickCountry(c.code)
                            }}
                            style={({ pressed }) => [styles.tile, pressed && { opacity: 0.7 }]}
                          >
                            <Flag code={c.code} size={34} />
                            <View style={{ gap: 1 }}>
                              <Txt weight="bold" size={14} numberOfLines={1}>
                                {shortName(c.name)}
                              </Txt>
                              <Txt size={11} color={colors.muted}>
                                {c.rails[0]?.currency}
                                {c.rails.some((r) => r.speed === 'Instant') ? ' · Instant' : ''}
                              </Txt>
                            </View>
                          </Pressable>
                        ))}
                      </View>
                    </>
                  ) : null}
                  <Txt weight="bold" size={12} color={colors.muted} style={styles.label}>
                    {q ? `${shown.length} found` : 'All countries'}
                  </Txt>
                  {shown.length ? (
                    <View style={styles.card}>
                      {shown.map((c, i) => (
                        <Row
                          key={c.code}
                          flag={c.code}
                          title={c.name}
                          detail={
                            c.code === 'NG' ? 'Bank account, at the best naira rate' : ways(c.rails)
                          }
                          aside={c.rails[0]?.currency}
                          last={i === shown.length - 1}
                          onPress={() => pickCountry(c.code)}
                        />
                      ))}
                    </View>
                  ) : (
                    <View style={[styles.card, { padding: 16, gap: 4 }]}>
                      <Txt weight="bold" size={15}>
                        Not listed by name
                      </Txt>
                      <Txt size={13} color={colors.muted} style={{ lineHeight: 18 }}>
                        Most banks still take an international transfer. Pick “Any other country”
                        below.
                      </Txt>
                    </View>
                  )}
                  <Txt weight="bold" size={12} color={colors.muted} style={styles.label}>
                    Other ways out
                  </Txt>
                  <View style={styles.card}>
                    {elsewhere.some((c) => c.id.startsWith('swift')) ? (
                      <Row
                        flag="WW"
                        title="Any other country"
                        detail="International bank transfer"
                        onPress={() => pickCountry('WW')}
                      />
                    ) : null}
                    {elsewhere
                      .filter((c) => !c.id.startsWith('swift'))
                      .map((c, i, all) => (
                        <Row
                          key={c.id}
                          flag={flagCode(c)}
                          title={c.name}
                          detail={c.title.replace(/^USDC on /, '')}
                          last={i === all.length - 1}
                          onPress={() => choose(c)}
                        />
                      ))}
                  </View>
                </>
              )
            })()}
          </ScrollView>
        </View>
      ) : null}

      {info?.live && step === 'rail' ? (
        <View style={[styles.flow, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
            <View style={styles.railTitle}>
              <Flag code={country === 'WW' ? 'WW' : (country ?? '')} size={28} />
              <Txt weight="bold" size={24} style={{ letterSpacing: -0.5, flex: 1 }}>
                How should it arrive?
              </Txt>
            </View>
            <Txt size={13} color={colors.muted} style={{ marginTop: 6, marginBottom: 12 }}>
              Prices are for $100.
            </Txt>
            <View style={{ gap: 10 }}>
              {railsOf(country).map((r) => {
                const on = r.id === picked
                const net = 100 - feeOn(100)
                return (
                  <Pressable
                    key={r.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${r.title}. ${r.speed}`}
                    onPress={() => {
                      void Haptics.selectionAsync()
                      setPicked(r.id)
                    }}
                    style={[styles.way, on && styles.wayOn]}
                  >
                    <View style={styles.wayHead}>
                      <View style={[styles.radio, on && { borderColor: colors.onChosen }]}>
                        {on ? <View style={styles.radioDot} /> : null}
                      </View>
                      <Txt
                        weight="bold"
                        size={16}
                        color={on ? colors.onChosen : colors.ink}
                        style={{ flex: 1 }}
                      >
                        {r.title}
                      </Txt>
                      {r.speed === 'Instant' ? (
                        <View style={styles.tag}>
                          <Txt weight="bold" size={11} color={colors.dark}>
                            Fastest
                          </Txt>
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.wayFacts}>
                      <WayFact on={on} label="Arrives" value={brief(r.speed)} />
                      <WayFact on={on} label="Fees" value={`$${feeOn(100).toFixed(2)}`} />
                      <WayFact
                        on={on}
                        label="They get"
                        value={
                          rate === null
                            ? '…'
                            : `${r.currency === 'USD' ? '' : '≈ '}${inCurrency(net * rate, r.currency)}`
                        }
                      />
                    </View>
                  </Pressable>
                )
              })}
            </View>
          </ScrollView>
          <PillButton
            label="Continue"
            disabled={!picked}
            onPress={() => {
              const r = info?.corridors.find((c) => c.id === picked)
              if (r) choose(r)
            }}
          />
        </View>
      ) : null}

      {info?.live && step === 'details' && corridor ? (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
            <View style={styles.railHead}>
              <Flag code={flagCode(corridor)} size={30} />
              <View style={{ flex: 1 }}>
                <Txt weight="bold" size={15}>
                  {corridor.name}
                </Txt>
                <Txt size={12} color={colors.muted}>
                  {corridor.speed} · arrives in {corridor.currency}
                </Txt>
              </View>
            </View>

            <Txt weight="bold" size={12} color={colors.muted} style={styles.label}>
              The account
            </Txt>
            <View style={styles.card}>
              {rowsOf(accountFields).map((row, i, all) =>
                row.length === 1 && row[0] ? (
                  <FieldInput
                    key={row[0].key}
                    field={row[0]}
                    value={values[row[0].key] ?? ''}
                    bank={bank}
                    banksLoading={!!corridor.banks && banks === null}
                    last={i === all.length - 1}
                    onBank={() => setSheet(true)}
                    onChange={(v) => setValues((prev) => ({ ...prev, [row[0]?.key ?? '']: v }))}
                  />
                ) : (
                  <View
                    key={row.map((f) => f.key).join()}
                    style={[styles.fieldLine, i < all.length - 1 && styles.rule]}
                  >
                    {row.map((f, j) => (
                      <View key={f.key} style={[{ flex: 1 }, j > 0 && styles.fieldDivide]}>
                        <FieldInput
                          field={f}
                          value={values[f.key] ?? ''}
                          bank={null}
                          banksLoading={false}
                          last
                          onBank={() => {}}
                          onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
                        />
                      </View>
                    ))}
                  </View>
                ),
              )}
            </View>

            {aboutFields.length ? (
              <>
                <View style={styles.groupHead}>
                  <Txt weight="bold" size={12} color={colors.muted}>
                    Your address
                  </Txt>
                  <Txt size={11} color={colors.muted}>
                    Asked once, kept on this phone
                  </Txt>
                </View>
                {!editAbout && aboutComplete ? (
                  <View style={[styles.card, styles.aboutCard]}>
                    <View style={styles.homeDot}>
                      <Icon name="home" size={16} color={colors.ink} />
                    </View>
                    <View style={{ flex: 1, gap: 1 }}>
                      <Txt weight="bold" size={14} numberOfLines={1}>
                        {[values.address_line1, values.address_city].filter(Boolean).join(', ')}
                      </Txt>
                      <Txt size={12} color={colors.muted} numberOfLines={1}>
                        {[values.address_state, values.address_postal_code, values.address_country]
                          .filter(Boolean)
                          .join(' · ')}
                      </Txt>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Edit your address"
                      hitSlop={10}
                      onPress={() => setEditAbout(true)}
                    >
                      <Txt weight="bold" size={14}>
                        Edit
                      </Txt>
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.card}>
                    {rowsOf(aboutFields).map((row, i, all) => (
                      <View
                        key={row.map((f) => f.key).join()}
                        style={[styles.fieldLine, i < all.length - 1 && styles.rule]}
                      >
                        {row.map((f, j) => (
                          <View key={f.key} style={[{ flex: 1 }, j > 0 && styles.fieldDivide]}>
                            <FieldInput
                              field={f}
                              value={values[f.key] ?? ''}
                              bank={null}
                              banksLoading={false}
                              last
                              onBank={() => {}}
                              onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
                            />
                          </View>
                        ))}
                      </View>
                    ))}
                  </View>
                )}
                <View style={styles.note}>
                  <Icon name="lock" size={12} color={colors.tealDeep} />
                  <Txt size={11} color={colors.muted}>
                    Banks need it to pay you. Kova keeps only the account’s last digits.
                  </Txt>
                </View>
              </>
            ) : null}

            {problem ? <Problem text={problem} /> : null}
            <View style={{ marginTop: 18 }}>
              <PillButton
                label={busy ? 'Saving…' : 'Save account'}
                icon="face"
                loading={busy}
                onPress={() => void saveAccount()}
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      ) : null}

      {info?.live && step === 'amount' && recipient ? (
        <View style={[styles.flow, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`To ${recipient.label}. Change`}
            onPress={() => setStep('where')}
            style={styles.to}
          >
            <Flag
              code={(() => {
                const way = wayOf(recipient)
                return way ? flagCode(way) : flagCode(recipient)
              })()}
              size={30}
            />
            <View style={{ flex: 1 }}>
              <Txt weight="bold" size={14} numberOfLines={1}>
                {recipient.label}
              </Txt>
              <Txt size={11} color={colors.muted} numberOfLines={1}>
                {recipient.title} · {recipient.speed}
              </Txt>
            </View>
            <Txt weight="bold" size={13} style={{ paddingRight: 4 }}>
              Change
            </Txt>
          </Pressable>
          <Txt weight="bold" size={56} style={styles.amount}>
            <Txt weight="bold" size={30} color={colors.muted}>
              $
            </Txt>
            {typed || '0'}
          </Txt>
          <Txt
            weight="semi"
            size={12}
            color={short ? colors.danger : colors.muted}
            style={{ textAlign: 'center' }}
          >
            {short
              ? 'More than you have'
              : balance === null
                ? ' '
                : `${formatUsd(balance)} available`}
          </Txt>
          <View style={styles.sums}>
            <Sum
              label="Fees"
              value={dollars > 0n ? `$${feeOn(Number(dollars) / 1e6).toFixed(2)}` : '—'}
            />
            <Sum
              label="They get"
              value={
                dollars === 0n
                  ? '—'
                  : rate === null
                    ? '…'
                    : `${recipient.currency === 'USD' ? '' : '≈ '}${inCurrency(
                        (Number(dollars) / 1e6 - feeOn(Number(dollars) / 1e6)) * rate,
                        recipient.currency,
                      )}`
              }
              strong
            />
            <Sum label="Arrives" value={brief(recipient.speed)} last />
          </View>
          <Keypad size={52} onKey={(key) => setTyped((t) => applyKey(t, key))} />
          {problem ? <Problem text={problem} /> : null}
          <View style={{ marginTop: 10 }}>
            <PillButton
              label={
                dollars > 0n && dollars < min
                  ? `At least ${formatUsd(min)}`
                  : dollars > max
                    ? `Up to ${formatUsd(max)} at a time`
                    : short
                      ? 'Not enough in your balance'
                      : busy
                        ? 'Locking the rate…'
                        : 'Continue'
              }
              loading={busy}
              disabled={dollars < min || dollars > max || short}
              onPress={() => void getQuote()}
            />
          </View>
        </View>
      ) : null}

      {info?.live && step === 'review' && quote ? (
        <View style={[styles.flow, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.hero}>
            <Txt weight="semi" size={14} color={colors.muted}>
              {quote.recipient?.holder_name ?? 'They'} get{quote.recipient ? 's' : ''}
            </Txt>
            <Txt weight="bold" size={44} style={{ letterSpacing: -1.5 }}>
              {inCurrency(quote.amount_to, quote.currency)}
            </Txt>
            <Txt size={13} color={colors.muted}>
              {quote.recipient?.label}
            </Txt>
          </View>
          <View style={styles.card}>
            <Fact label="You send" value={`$${quote.amount}`} />
            <Fact label="Fees" value={`$${quote.fee}`} />
            {quote.currency !== 'USD' ? (
              <Fact label="Rate" value={`$1 = ${inCurrency(Number(quote.rate), quote.currency)}`} />
            ) : null}
            <Fact label="Arrives" value={quote.recipient?.speed ?? ''} last tone="teal" />
          </View>
          {quote.currency !== 'USD' ? (
            <View style={styles.held}>
              <Icon name="clock" size={14} color={left > 0 ? colors.muted : colors.danger} />
              <Txt weight="semi" size={12} color={left > 0 ? colors.muted : colors.danger}>
                {left > 0
                  ? `Rate held for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
                  : 'This rate ran out. Get a fresh one.'}
              </Txt>
            </View>
          ) : null}
          {problem ? <Problem text={problem} /> : null}
          <View style={{ marginTop: 'auto' }}>
            {left > 0 ? (
              <PillButton
                label={busy ? 'Sending…' : `Send $${quote.amount}`}
                icon="face"
                tone="coral"
                loading={busy}
                onPress={() => void approve()}
              />
            ) : (
              <PillButton label="Get a fresh rate" onPress={() => void getQuote()} />
            )}
          </View>
        </View>
      ) : null}

      {step === 'tracking' && payout ? (
        <View style={[styles.flow, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.hero}>
            <Txt weight="bold" size={44} style={{ letterSpacing: -1.5 }}>
              {payout.status === 'failed'
                ? `$${payout.amount}`
                : inCurrency(payout.amount_to, payout.currency)}
            </Txt>
            <Txt size={14} color={colors.muted}>
              {payout.status === 'failed'
                ? 'back in your Kova wallet'
                : `to ${payout.recipient?.label ?? ''}`}
            </Txt>
          </View>
          <View style={[styles.card, { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 }]}>
            <Stage
              title="Sent"
              time={clock(payout.created_at)}
              detail="From your Kova wallet"
              state="done"
            />
            {payout.status === 'failed' ? (
              <>
                <Stage
                  title="The bank couldn’t take it"
                  detail={plainFailure(payout.failure)}
                  state="failed"
                />
                <Stage
                  title="Back in your wallet"
                  detail="Every cent, fees too"
                  state="done"
                  last
                />
              </>
            ) : (
              <>
                <Stage
                  title="Paid out"
                  detail={`To ${payout.recipient?.label ?? 'the account'}`}
                  state={
                    payout.status === 'sending' || payout.status === 'paid' ? 'done' : 'active'
                  }
                />
                <Stage
                  title="On its way to the bank"
                  time={payout.status === 'sending' ? 'Now' : undefined}
                  detail="Banks move money on business days"
                  state={
                    payout.status === 'paid'
                      ? 'done'
                      : payout.status === 'sending'
                        ? 'active'
                        : 'pending'
                  }
                />
                <Stage
                  title="In the account"
                  detail={
                    payout.status === 'paid'
                      ? 'It’s there'
                      : `Usually ${(payout.recipient?.speed ?? '').toLowerCase()}`
                  }
                  state={payout.status === 'paid' ? 'done' : 'pending'}
                  last
                />
              </>
            )}
          </View>
          <View style={styles.receipt}>
            <Fact label="You sent" value={`$${payout.amount}`} quiet />
            <Fact label="Fees" value={`$${payout.fee}`} quiet last />
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

/** Arrival in a few words, for tight spaces: "Same or next day" → "By tomorrow". */
const brief = (speed: string) =>
  speed === 'Same or next day'
    ? 'By tomorrow'
    : speed.replace(' business days', ' days').replace('Under a minute', 'In a minute')

/** Short names for the small tiles. */
const shortName = (name: string) =>
  name === 'United States'
    ? 'USA'
    : name === 'United Kingdom'
      ? 'UK'
      : name === 'United Arab Emirates'
        ? 'UAE'
        : name

/** "19:36", from a payout's time. */
const clock = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? undefined
    : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** What went wrong, in a line someone can act on, from Kova's longer note. */
function plainFailure(failure: string | null): string {
  const f = (failure ?? '').toLowerCase()
  if (f.includes('postal')) return 'Your address needs a postal code'
  if (f.includes('state')) return 'Your address needs a state or region'
  if (f.includes('account') && f.includes('number')) return 'The account number wasn’t right'
  if (f.includes('name')) return 'The name didn’t match the account'
  return 'The bank didn’t accept the details'
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
                : r.title.startsWith('Bank or e-wallet')
                  ? 'Bank or e-wallet'
                  : 'Bank account',
      ),
    ),
  ].join(' · ') + (rails.some((r) => r.speed === 'Instant') ? ' · instant' : '')

function Steps({ at }: { at: number }) {
  return (
    <View style={styles.steps} accessibilityLabel={`Step ${at} of 4`}>
      {[1, 2, 3, 4].map((n) => (
        <View key={n} style={[styles.stepBar, n <= at && { backgroundColor: colors.ink }]} />
      ))}
    </View>
  )
}

function Row({
  flag,
  title,
  detail,
  aside,
  last,
  onPress,
}: {
  flag: string
  title: string
  detail: string
  aside?: string
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
      <Flag code={flag} size={36} />
      <View style={{ flex: 1, gap: 1 }}>
        <Txt weight="bold" size={15} numberOfLines={1}>
          {title}
        </Txt>
        <Txt size={12} color={colors.muted} numberOfLines={1}>
          {detail}
        </Txt>
      </View>
      {aside ? (
        <Txt weight="bold" size={12} color={colors.muted}>
          {aside}
        </Txt>
      ) : (
        <Icon name="arrow" size={16} color={colors.muted} />
      )}
    </Pressable>
  )
}

function WayFact({ on, label, value }: { on: boolean; label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 1 }}>
      <Txt size={11} color={on ? colors.onInk : colors.muted}>
        {label}
      </Txt>
      <Txt weight="bold" size={13} color={on ? colors.onChosen : colors.ink} numberOfLines={2}>
        {value}
      </Txt>
    </View>
  )
}

function Sum({
  label,
  value,
  strong,
  last,
}: {
  label: string
  value: string
  strong?: boolean
  last?: boolean
}) {
  return (
    <View style={[styles.sum, !last && styles.sumRule]}>
      <Txt size={11} color={colors.muted}>
        {label}
      </Txt>
      <Txt weight="bold" size={strong ? 15 : 13} numberOfLines={1}>
        {value}
      </Txt>
    </View>
  )
}

/** Short fields that read as one (a city, its state, its postal code) share a line. */
const TOGETHER = [
  ['bank_city', 'bank_state', 'bank_postal_code'],
  ['address_city', 'address_state'],
  ['address_postal_code', 'address_country'],
]
function rowsOf(fields: PayoutField[]): PayoutField[][] {
  const rows: PayoutField[][] = []
  for (const f of fields) {
    const group = TOGETHER.find((g) => g.includes(f.key))
    const last = rows[rows.length - 1]
    if (group && last?.[0] && group.includes(last[0].key) && last[0].kind !== 'select') last.push(f)
    else rows.push([f])
  }
  return rows
}

/** What to type, when the field is empty: its own example, or the shape it wants. */
const hint = (f: PayoutField) =>
  f.placeholder ??
  (f.kind === 'digits' && f.min && f.max
    ? f.min === f.max
      ? `${f.min} digits`
      : `${f.min} to ${f.max} digits`
    : f.kind === 'email'
      ? 'you@example.com'
      : f.kind === 'iban'
        ? 'Starts with two letters'
        : f.kind === 'bic'
          ? '8 or 11 characters'
          : f.kind === 'phone'
            ? 'With the country code'
            : f.kind === 'country'
              ? 'Two letters, like NG'
              : '')

const keyboardFor = (f: PayoutField) =>
  f.kind === 'digits'
    ? 'number-pad'
    : f.kind === 'email'
      ? 'email-address'
      : f.kind === 'phone'
        ? 'phone-pad'
        : 'default'

/** One field as a row of its card: the label above, the value as typed below. */
function FieldInput({
  field,
  value,
  bank,
  banksLoading,
  last,
  onBank,
  onChange,
}: {
  field: PayoutField
  value: string
  bank: PayoutBank | null
  banksLoading: boolean
  last?: boolean
  onBank: () => void
  onChange: (v: string) => void
}) {
  const label = `${field.label}${field.optional ? ' (optional)' : ''}`
  if (field.kind === 'bank')
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={bank ? `Bank: ${bank.name}` : 'Choose a bank'}
        onPress={onBank}
        disabled={banksLoading}
        style={({ pressed }) => [
          styles.fieldRow,
          !last && styles.rule,
          pressed && { opacity: 0.7 },
        ]}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Txt size={11} color={colors.muted}>
            {label}
          </Txt>
          <Txt weight="bold" size={16} color={bank ? colors.ink : colors.muted} numberOfLines={1}>
            {bank ? bank.name : banksLoading ? 'Loading banks…' : 'Choose a bank'}
          </Txt>
        </View>
        <Icon name="arrow" size={16} color={colors.muted} />
      </Pressable>
    )
  if (field.kind === 'select')
    return (
      <View style={[styles.fieldRow, !last && styles.rule]}>
        <Txt size={11} color={colors.muted} style={{ flex: 1 }}>
          {label}
        </Txt>
        <View style={styles.segment}>
          {(field.options ?? []).map((o) => (
            <Pressable
              key={o.value}
              accessibilityRole="button"
              accessibilityState={{ selected: value === o.value }}
              onPress={() => onChange(o.value)}
              style={[styles.segmentOption, value === o.value && styles.segmentOn]}
            >
              <Txt weight="bold" size={13} color={value === o.value ? colors.onChosen : colors.ink}>
                {o.label}
              </Txt>
            </Pressable>
          ))}
        </View>
      </View>
    )
  return (
    <View style={[styles.fieldStack, !last && styles.rule]}>
      <Txt size={11} color={colors.muted}>
        {label}
      </Txt>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={hint(field)}
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

function Fact({
  label,
  value,
  last,
  quiet,
  tone,
}: {
  label: string
  value: string
  last?: boolean
  quiet?: boolean
  tone?: 'teal'
}) {
  return (
    <View
      style={[
        styles.fact,
        quiet && styles.factQuiet,
        !last && (quiet ? styles.quietRule : styles.rule),
      ]}
    >
      <Txt size={14} color={colors.muted}>
        {label}
      </Txt>
      <Txt
        weight="bold"
        size={14}
        color={tone === 'teal' ? colors.tealDeep : colors.ink}
        style={{ flexShrink: 1, textAlign: 'right' }}
        numberOfLines={1}
      >
        {value}
      </Txt>
    </View>
  )
}

function Stage({
  title,
  detail,
  time,
  state,
  last,
}: {
  title: string
  detail: string
  time?: string
  state: 'done' | 'active' | 'pending' | 'failed'
  last?: boolean
}) {
  return (
    <View style={styles.stage}>
      <View style={styles.stageRail}>
        <View
          style={[
            styles.stageDot,
            state === 'done' && { backgroundColor: colors.tealDeep, borderColor: colors.tealDeep },
            state === 'active' && { borderColor: colors.ink },
            state === 'pending' && { borderColor: colors.sunken },
            state === 'failed' && { backgroundColor: colors.coral, borderColor: colors.coral },
          ]}
        >
          {state === 'done' ? <Icon name="check" size={12} color={colors.white} /> : null}
          {state === 'failed' ? <Icon name="close" size={11} color={colors.dark} /> : null}
          {state === 'active' ? <View style={styles.liveDot} /> : null}
        </View>
        {last ? null : (
          <View
            style={[
              styles.stageLine,
              { backgroundColor: state === 'done' ? colors.tealDeep : colors.sunken },
            ]}
          />
        )}
      </View>
      <View style={{ flex: 1, paddingBottom: last ? 12 : 16, gap: 2 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <Txt weight="bold" size={15} color={state === 'pending' ? colors.muted : colors.ink}>
            {title}
          </Txt>
          {time ? (
            <Txt
              weight={time === 'Now' ? 'bold' : 'regular'}
              size={12}
              color={time === 'Now' ? colors.coralDeep : colors.muted}
            >
              {time}
            </Txt>
          ) : null}
        </View>
        <Txt size={12} color={colors.muted} style={{ lineHeight: 17 }}>
          {detail}
        </Txt>
      </View>
    </View>
  )
}

const VERIFY_COPY: Record<
  Exclude<Verification, 'verified'>,
  { title: string; body: string; cta: string }
> = {
  needed: {
    title: 'Verify your ID first',
    body: 'A cash-out abroad goes out in your own name, so Kova’s banking partner checks your ID once. It’s the same check as the dollar card.',
    cta: 'Verify my ID',
  },
  checking: {
    title: 'Your ID is being checked',
    body: 'You can cash out abroad as soon as it passes. It usually takes a few minutes.',
    cta: 'See the check',
  },
  failed: {
    title: 'Your ID check didn’t pass',
    body: 'Cashing out abroad isn’t open to you. If you think that’s wrong, write to Kova.',
    cta: 'See why',
  },
}

/** The first step while the ID check is needed: what's left to do, and the way to the check. */
function VerifyFirst({ verification }: { verification: Verification }) {
  const copy = VERIFY_COPY[verification === 'verified' ? 'checking' : verification]
  return (
    <View style={styles.verify}>
      <View style={styles.verifyIcon}>
        <Icon name={verification === 'checking' ? 'clock' : 'user'} size={20} color={colors.dark} />
      </View>
      <Txt weight="bold" size={20} style={{ letterSpacing: -0.4 }}>
        {copy.title}
      </Txt>
      <Txt size={15} color={colors.muted} style={{ lineHeight: 21 }}>
        {copy.body}
      </Txt>
      <View style={{ marginTop: 8 }}>
        <PillButton
          label={copy.cta}
          icon="arrow"
          onPress={() => {
            void Haptics.selectionAsync()
            router.push('/dollar-card')
          }}
        />
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
  verify: {
    marginTop: 20,
    gap: 8,
    padding: 18,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  verifyIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.tealSoft,
    marginBottom: 4,
  },
  flow: { flex: 1, paddingHorizontal: 20, paddingTop: 4 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 28,
  },
  steps: { flexDirection: 'row', gap: 4, paddingHorizontal: 20, marginTop: 2, marginBottom: 12 },
  stepBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.sunken },
  label: { marginTop: 18, marginBottom: 8, marginHorizontal: 4 },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 22,
    marginBottom: 8,
    marginHorizontal: 4,
  },
  card: {
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    minHeight: 62,
    paddingVertical: 10,
  },
  rule: { borderBottomWidth: 1.5, borderColor: colors.sunken },
  addRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 66,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.ink,
  },
  addDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    paddingHorizontal: 16,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, fontFamily: fonts.semi, fontSize: 15, color: colors.ink },
  tiles: { flexDirection: 'row', gap: 8 },
  tile: {
    flex: 1,
    gap: 8,
    padding: 12,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  railTitle: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  way: {
    gap: 10,
    padding: 14,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  wayOn: { backgroundColor: colors.chosen, borderColor: colors.chosen },
  wayHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  wayFacts: { flexDirection: 'row', gap: 8, paddingLeft: 30 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.onChosen },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: colors.coral,
  },
  railHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: colors.sunken,
  },
  fieldStack: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8, gap: 2 },
  fieldLine: { flexDirection: 'row' },
  fieldDivide: { borderLeftWidth: 1.5, borderColor: colors.sunken },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    minHeight: 58,
    paddingVertical: 8,
  },
  input: {
    paddingVertical: 2,
    color: colors.ink,
    fontFamily: fonts.bold,
    fontSize: 16,
  },
  segment: {
    flexDirection: 'row',
    gap: 4,
    padding: 3,
    borderRadius: 16,
    backgroundColor: colors.sunken,
  },
  segmentOption: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentOn: { backgroundColor: colors.chosen },
  aboutCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  homeDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, marginHorizontal: 4 },
  to: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 10,
    borderRadius: 26,
    backgroundColor: colors.sunken,
  },
  amount: { textAlign: 'center', marginTop: 10, letterSpacing: -2 },
  sums: {
    flexDirection: 'row',
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  sum: { flex: 1, paddingHorizontal: 12, paddingVertical: 9, gap: 1 },
  sumRule: { borderRightWidth: 1.5, borderColor: colors.sunken },
  hero: { alignItems: 'center', gap: 2, marginTop: 14, marginBottom: 18 },
  fact: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  factQuiet: { paddingHorizontal: 0, paddingVertical: 9 },
  quietRule: { borderBottomWidth: 1.5, borderColor: colors.rule },
  held: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
    marginTop: 12,
  },
  receipt: {
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 2,
    borderRadius: 16,
    backgroundColor: colors.sunken,
  },
  stage: { flexDirection: 'row', gap: 12 },
  stageRail: { alignItems: 'center', width: 24 },
  stageDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.coral },
  stageLine: { width: 2, flex: 1, minHeight: 18 },
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
