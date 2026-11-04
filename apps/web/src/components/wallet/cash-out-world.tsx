'use client'

import { parseAmount } from '@kova/monad'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@/components/brand'
import { applyKey, formatUsd } from '@/lib/wallet/money'
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
  payPayout,
  quotePayout,
  type Recipient,
  waysOut,
} from '@/lib/wallet/payouts'
import { ScreenHead } from './activity'
import { useWallet } from './provider'
import { Keypad } from './ui'

type Step = 'where' | 'country' | 'rail' | 'details' | 'amount' | 'review' | 'tracking'
const FIRST = ['US', 'CA', 'GB', 'EU', 'GH', 'KE', 'ZA']

/** The country the browser is set to (en-NG → NG), as a guess for where someone lives. */
const homeCountry = () => {
  const region = Intl.DateTimeFormat().resolvedOptions().locale.split('-').pop() ?? ''
  return /^[A-Z]{2}$/.test(region) ? region : ''
}

/**
 * Cash out to any country Nuvion pays, as in the app: a saved account or a new one (country, the
 * way, its details), an amount, the rate locked for a couple of minutes, the passkey, then the
 * payout followed until it lands. Nigeria goes to the naira cash-out, whose rate is better.
 */
export function CashOutWorld() {
  const { profile, balance, network, signMessage, signingAccount, refresh } = useWallet()
  const router = useRouter()
  const [info, setInfo] = useState<PayoutsInfo | null>(null)
  const [recipients, setRecipients] = useState<Recipient[] | null>(null)
  const [step, setStep] = useState<Step>('where')
  const [country, setCountry] = useState<string | null>(null)
  const [corridor, setCorridor] = useState<Corridor | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [banks, setBanks] = useState<PayoutBank[] | null>(null)
  const [bankQuery, setBankQuery] = useState('')
  const [bank, setBank] = useState<PayoutBank | null>(null)
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

  const countries = useMemo(() => {
    const by = new Map<string, Corridor[]>()
    for (const c of info?.corridors ?? []) by.set(c.country, [...(by.get(c.country) ?? []), c])
    const rank = (code: string) => {
      const i = FIRST.indexOf(code)
      return i === -1 ? (code === 'WW' ? 999 : 100) : i
    }
    return [...by.entries()]
      .map(([code, rails]) => ({ code, rails }))
      .sort(
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
    setBankQuery('')
    setProblem(null)
    setStep('details')
    if (c.banks)
      void getPayoutBanks(c.banks)
        .then(setBanks)
        .catch(() => setBanks([]))
  }

  const pickCountry = (code: string) => {
    if (code === 'NG') {
      router.push('/wallet/cash-out/naira')
      return
    }
    const rails = countries.find((c) => c.code === code)?.rails ?? []
    setCountry(code)
    if (rails.length === 1 && rails[0]) choose(rails[0])
    else setStep('rail')
  }

  const startAmount = (r: Recipient) => {
    setRecipient(r)
    setTyped('')
    setQuote(null)
    setProblem(null)
    setRate(null)
    setStep('amount')
    void getPayoutRate(r.currency === 'USDC' ? 'USC' : r.currency)
      .then(setRate)
      .catch(() => setRate(null))
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
      startAmount(saved)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Those details weren’t saved. Try again.')
    } finally {
      setBusy(false)
    }
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
      const account = await signingAccount(BigInt(quote.pay.value))
      setPayout(await payPayout(network, account, quote))
      setStep('tracking')
      void refresh()
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
  }

  const title =
    step === 'where'
      ? 'Cash out to any country'
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
                : payout?.status === 'failed'
                  ? 'Sent back'
                  : payout?.status === 'paid'
                    ? 'Arrived'
                    : 'On its way'

  return (
    <div className="w-screen cw">
      <ScreenHead
        title={title}
        back="/wallet"
        {...(step === 'where' || step === 'tracking' ? {} : { onBack: back })}
      />

      {!info ? (
        <p className="w-quiet">{problem ?? 'Opening…'}</p>
      ) : !info.live ? (
        <p className="w-quiet">Cashing out to other countries isn’t on for this server yet.</p>
      ) : null}

      {info?.live && step === 'where' ? (
        <>
          <p className="w-lead">
            Banks, mobile money and Interac in {countries.length - 1}+ places, or a USDC wallet.
          </p>
          {recipients && recipients.length > 0 ? (
            <ul className="cw-list">
              {recipients.map((r) => (
                <li key={r.id}>
                  <button type="button" className="cw-row" onClick={() => startAmount(r)}>
                    <span className="cw-flag">{r.flag}</span>
                    <span className="cw-text">
                      <strong>{r.label}</strong>
                      <small>
                        {r.name} · {r.title}
                      </small>
                    </span>
                    {r.speed === 'Instant' ? <span className="cw-chip">Instant</span> : null}
                    <Icon name="arrow" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            className="pill pill-block cw-gap"
            data-tone="ink"
            onClick={() => setStep('country')}
          >
            <span className="pill-label">Add an account</span>
            <span className="pill-cap">
              <Icon name="plus" size={18} />
            </span>
          </button>
        </>
      ) : null}

      {info?.live && step === 'country' ? (
        <>
          <input
            className="cw-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search countries"
            aria-label="Search countries"
          />
          <ul className="cw-list">
            {countries
              .filter((c) =>
                (c.rails[0]?.name ?? '').toLowerCase().includes(search.trim().toLowerCase()),
              )
              .map((c) => {
                const first = c.rails[0] as Corridor
                return (
                  <li key={c.code}>
                    <button type="button" className="cw-row" onClick={() => pickCountry(c.code)}>
                      <span className="cw-flag">{first.flag}</span>
                      <span className="cw-text">
                        <strong>{first.name}</strong>
                        <small>
                          {c.code === 'NG'
                            ? 'Naira to any bank, at the best rate'
                            : waysOut(c.rails)}
                        </small>
                      </span>
                      {c.rails.some((r) => r.speed === 'Instant') ? (
                        <span className="cw-chip">Instant</span>
                      ) : null}
                      <Icon name="arrow" size={16} />
                    </button>
                  </li>
                )
              })}
          </ul>
        </>
      ) : null}

      {info?.live && step === 'rail' ? (
        <ul className="cw-list">
          {(countries.find((c) => c.code === country)?.rails ?? []).map((r) => (
            <li key={r.id}>
              <button type="button" className="cw-row" onClick={() => choose(r)}>
                <span className="cw-flag">{r.flag}</span>
                <span className="cw-text">
                  <strong>{r.title}</strong>
                  <small>
                    {r.speed} · arrives in {r.currency}
                  </small>
                </span>
                {r.speed === 'Instant' ? <span className="cw-chip">Instant</span> : null}
                <Icon name="arrow" size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {info?.live && step === 'details' && corridor ? (
        <form
          className="cw-form"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="cw-rail">
            <span className="cw-flag">{corridor.flag}</span>
            <span className="cw-text">
              <strong>{corridor.name}</strong>
              <small>
                {corridor.speed} · arrives in {corridor.currency}
              </small>
            </span>
          </div>
          {corridor.fields.map((f) => (
            <Field
              key={f.key}
              field={f}
              value={values[f.key] ?? ''}
              onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
              banks={banks}
              bank={bank}
              bankQuery={bankQuery}
              setBankQuery={setBankQuery}
              onBank={setBank}
            />
          ))}
          <p className="w-fine">Kova keeps only the last digits. The rest stays with Nuvion.</p>
          {problem ? <p className="form-error">{problem}</p> : null}
          <button type="submit" className="pill pill-block" data-tone="ink" disabled={busy}>
            <span className="pill-label">{busy ? 'Saving…' : 'Save and continue'}</span>
            <span className="pill-cap">
              <Icon name="face" size={18} />
            </span>
          </button>
        </form>
      ) : null}

      {info?.live && step === 'amount' && recipient ? (
        <div className="cw-amount">
          <span className="cw-to">
            {recipient.flag} {recipient.label}
          </span>
          <strong className="cw-typed">
            <small>$</small>
            {typed || '0'}
          </strong>
          <p className="cw-gets">
            They get{' '}
            <strong>
              {rate === null
                ? '…'
                : `≈ ${inCurrency((Number(dollars) / 1e6) * rate, recipient.currency)}`}
            </strong>
          </p>
          <p className="dc-from">
            <span>From Kova balance</span>
            <strong data-over={short ? 'yes' : 'no'}>
              {balance === null ? '—' : formatUsd(balance)}
            </strong>
          </p>
          <Keypad onKey={(key) => setTyped((t) => applyKey(t, key))} />
          {problem ? <p className="form-error">{problem}</p> : null}
          <button
            type="button"
            className="pill pill-block"
            data-tone="ink"
            disabled={busy || dollars < min || dollars > max || short}
            onClick={() => void getQuote()}
          >
            <span className="pill-label">
              {dollars > 0n && dollars < min
                ? `At least ${formatUsd(min)}`
                : dollars > max
                  ? `Up to ${formatUsd(max)} at a time`
                  : short
                    ? 'Not enough in your balance'
                    : busy
                      ? 'Getting the rate…'
                      : 'See the rate'}
            </span>
            <span className="pill-cap">
              <Icon name="arrow" size={18} />
            </span>
          </button>
        </div>
      ) : null}

      {info?.live && step === 'review' && quote ? (
        <div className="cw-review">
          <p className="cw-hero">
            <small>{quote.recipient?.holder_name ?? 'They'} gets</small>
            <strong>{inCurrency(quote.amount_to, quote.currency)}</strong>
          </p>
          <dl className="cw-facts">
            <div>
              <dt>You send</dt>
              <dd>${quote.amount}</dd>
            </div>
            {Number(quote.fee) > 0 ? (
              <div>
                <dt>Kova fee</dt>
                <dd>${quote.fee}</dd>
              </div>
            ) : null}
            {quote.currency !== 'USD' ? (
              <div>
                <dt>Rate</dt>
                <dd>$1 = {inCurrency(Number(quote.rate), quote.currency)}</dd>
              </div>
            ) : null}
            <div>
              <dt>To</dt>
              <dd>{quote.recipient?.label}</dd>
            </div>
            <div>
              <dt>Arrives</dt>
              <dd>{quote.recipient?.speed}</dd>
            </div>
          </dl>
          <p className="cw-held" data-out={left > 0 ? 'no' : 'yes'}>
            {left > 0
              ? `Rate held for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
              : 'This rate ran out. Get a fresh one.'}
          </p>
          {problem ? <p className="form-error">{problem}</p> : null}
          <button
            type="button"
            className="pill pill-block"
            data-tone="ink"
            disabled={busy}
            onClick={() => void (left > 0 ? approve() : getQuote())}
          >
            <span className="pill-label">
              {left <= 0 ? 'Get a fresh rate' : busy ? 'Cashing out…' : `Cash out $${quote.amount}`}
            </span>
            <span className="pill-cap">
              <Icon name="face" size={18} />
            </span>
          </button>
        </div>
      ) : null}

      {step === 'tracking' && payout ? (
        <div className="cw-review">
          <p className="cw-hero">
            <strong>{inCurrency(payout.amount_to, payout.currency)}</strong>
            <small>to {payout.recipient?.label}</small>
          </p>
          <ol className="cw-stages">
            <li data-state="done">
              <strong>Dollars sent to Kova</strong>
              <small>On Monad, in a second</small>
            </li>
            <li
              data-state={
                payout.status === 'failed' ? 'failed' : payout.status === 'paid' ? 'done' : 'active'
              }
            >
              <strong>{payout.status === 'failed' ? 'Didn’t go through' : 'Paying out'}</strong>
              <small>
                {payout.status === 'failed'
                  ? (payout.failure ?? 'Your dollars went back to your wallet.')
                  : payout.recipient?.title}
              </small>
            </li>
            {payout.status === 'failed' ? (
              <li data-state="done">
                <strong>Back in your wallet</strong>
                <small>Every cent, the fee too</small>
              </li>
            ) : (
              <li data-state={payout.status === 'paid' ? 'done' : 'pending'}>
                <strong>Arrived</strong>
                <small>
                  {payout.status === 'paid' ? 'In the account' : payout.recipient?.speed}
                </small>
              </li>
            )}
          </ol>
          <button
            type="button"
            className="pill pill-block"
            data-tone="ink"
            onClick={() => router.push('/wallet')}
          >
            <span className="pill-label">Done</span>
            <span className="pill-cap">
              <Icon name="check" size={18} />
            </span>
          </button>
        </div>
      ) : null}
    </div>
  )
}

function Field({
  field,
  value,
  onChange,
  banks,
  bank,
  bankQuery,
  setBankQuery,
  onBank,
}: {
  field: PayoutField
  value: string
  onChange: (v: string) => void
  banks: PayoutBank[] | null
  bank: PayoutBank | null
  bankQuery: string
  setBankQuery: (q: string) => void
  onBank: (b: PayoutBank | null) => void
}) {
  const heading = field.section ? (
    <div className="cw-section">
      <strong>{field.section}</strong>
      <small>Nuvion, who pays out for Kova, needs this for every payout.</small>
    </div>
  ) : null
  if (field.kind === 'bank') {
    const q = bankQuery.trim().toLowerCase()
    const matches = (banks ?? []).filter((b) => b.name.toLowerCase().includes(q)).slice(0, 8)
    return (
      <div className="cw-field">
        <span>{field.label}</span>
        {bank ? (
          <button type="button" className="cw-picked" onClick={() => onBank(null)}>
            {bank.name} <small>Change</small>
          </button>
        ) : (
          <>
            <input
              value={bankQuery}
              onChange={(e) => setBankQuery(e.target.value)}
              placeholder={banks === null ? 'Loading banks…' : `Search ${banks.length} banks`}
              aria-label="Search banks"
            />
            {q ? (
              <ul className="cw-banks">
                {matches.map((b) => (
                  <li key={`${b.code}-${b.name}`}>
                    <button type="button" onClick={() => onBank(b)}>
                      {b.name}
                    </button>
                  </li>
                ))}
                {matches.length === 0 ? <li className="w-quiet">No bank by that name.</li> : null}
              </ul>
            ) : null}
          </>
        )}
      </div>
    )
  }
  if (field.kind === 'select')
    return (
      <div className="cw-field">
        {heading}
        <span>{field.label}</span>
        <div className="cw-options">
          {(field.options ?? []).map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={value === o.value}
              onClick={() => onChange(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    )
  return (
    <label className="cw-field">
      {heading}
      <span>
        {field.label}
        {field.optional ? ' (optional)' : ''}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder ?? ''}
        inputMode={
          field.kind === 'digits'
            ? 'numeric'
            : field.kind === 'phone'
              ? 'tel'
              : field.kind === 'email'
                ? 'email'
                : 'text'
        }
        type={field.kind === 'email' ? 'email' : 'text'}
        autoComplete="off"
        autoCapitalize={
          field.kind === 'country' || field.kind === 'bic' || field.kind === 'iban'
            ? 'characters'
            : 'none'
        }
        spellCheck={false}
      />
    </label>
  )
}
