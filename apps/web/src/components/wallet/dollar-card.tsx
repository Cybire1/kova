'use client'

import { useCallback, useEffect, useState } from 'react'
import { Icon } from '@/components/brand'
import { formatUsd, toBase } from '@/lib/wallet/money'
import {
  type CardCheck,
  type CardDetails,
  type DollarCard,
  getDollarCard,
  requestAccess,
  revealDollarCard,
  setDollarCard,
  startCardCheck,
  topUpCard,
  topUpFee,
} from '@/lib/wallet/partners'
import '@/styles/dollar-card.css'
import { ScreenHead } from './activity'
import { useWallet } from './provider'

/**
 * The dollar card (Nuvion) in the web wallet: a virtual USD card topped up from the wallet, up to
 * $50 a day. Where you are decides the screen: what it is, the ID check, the check with the issuer,
 * a check that didn't pass, or the card itself (balance, top up, details, freeze).
 */

const problemOf = (e: unknown) =>
  e instanceof Error ? e.message : 'Something went wrong. Try again.'
const BLOCKS = 10

export function DollarCardScreen() {
  const { profile } = useWallet()
  const address = profile?.address
  const [data, setData] = useState<DollarCard | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [view, setView] = useState<'home' | 'check' | 'top-up' | 'details'>('home')
  const load = useCallback(async () => {
    if (!address) return
    try {
      setData(await getDollarCard(address))
      setProblem(null)
    } catch (e) {
      setProblem(problemOf(e))
    }
  }, [address])
  useEffect(() => {
    void load()
  }, [load])

  if (!data)
    return (
      <div className="w-screen">
        <ScreenHead title="Dollar card" />
        <p className="w-quiet">{problem ?? 'Opening…'}</p>
      </div>
    )
  if (view === 'check')
    return <Check onBack={() => setView('home')} onSent={(d) => (setData(d), setView('home'))} />
  if (view === 'details') return <Details onClose={() => setView('home')} />
  if (!data.live)
    return <Waitlist data={data} onRequested={() => setData({ ...data, requested: true })} />
  if (data.stage === 'intro')
    return <Intro sandbox={data.sandbox} onStart={() => setView('check')} />
  if (data.stage === 'checking') return <Checking />
  if (data.stage === 'fix')
    return <TryAgain reason={data.reason ?? null} onRetry={() => setView('check')} />
  return (
    <>
      <CardHome
        data={data}
        onChange={setData}
        onTopUp={() => setView('top-up')}
        onDetails={() => setView('details')}
      />
      {view === 'top-up' ? (
        <TopUp
          data={data}
          onClose={() => setView('home')}
          onDone={(d) => (setData(d), setView('home'))}
        />
      ) : null}
    </>
  )
}

function Waitlist({ data, onRequested }: { data: DollarCard; onRequested: () => void }) {
  const { profile, signMessage } = useWallet()
  const [busy, setBusy] = useState(false)
  return (
    <div className="w-screen dc">
      <ScreenHead title="Dollar card" />
      <div className="dc-intro-top">
        <h1 className="dc-hero">{'Spend\ndollars\nanywhere.'}</h1>
        <img src="/art/kovi-ride.webp" alt="" className="dc-kovi" />
        <img src="/art/card-coral.png" alt="The Kova dollar card" className="dc-intro-card" />
      </div>
      <p className="w-lead dc-pad">
        Subscriptions, flights, apps, anything online that takes a card. Fill it from your Kova
        balance in a tap. Opening soon.
      </p>
      <div className="dc-pad">
        <button
          type="button"
          className="pill pill-block"
          data-tone="ink"
          disabled={busy || data.requested || !profile}
          onClick={async () => {
            if (!profile) return
            setBusy(true)
            try {
              await requestAccess(profile.address as `0x${string}`, signMessage, 'dollar_card')
              onRequested()
            } finally {
              setBusy(false)
            }
          }}
        >
          <span className="pill-label">
            {data.requested ? 'You’re on the list' : 'Request access'}
          </span>
          <span className="pill-cap">
            <Icon name={data.requested ? 'check' : 'bell'} size={18} />
          </span>
        </button>
      </div>
    </div>
  )
}

function Intro({ sandbox, onStart }: { sandbox: boolean; onStart: () => void }) {
  return (
    <div className="w-screen dc">
      <ScreenHead title="Dollar card" />
      <div className="dc-intro-top">
        <h1 className="dc-hero">{'Spend\ndollars\nanywhere.'}</h1>
        <img src="/art/kovi-ride.webp" alt="" className="dc-kovi" />
        <img src="/art/card-coral.png" alt="The Kova dollar card" className="dc-intro-card" />
      </div>
      <div className="dc-stickers dc-pad">
        <span>Top up from Kova</span>
        <span data-tone="teal">Up to $50 a day</span>
        <span>Freeze in one tap</span>
        <span data-tone="coral">One ID check</span>
      </div>
      {sandbox ? (
        <p className="dc-sandbox dc-pad">Card sandbox: a test card, no money moves.</p>
      ) : null}
      <div className="dc-pad dc-foot">
        <button type="button" className="pill pill-block" data-tone="ink" onClick={onStart}>
          <span className="pill-label">Get my card</span>
          <span className="pill-cap">
            <Icon name="arrow" size={18} />
          </span>
        </button>
        <p className="dc-fine">
          Virtual card with our partner Nuvion. Kova covers the card fee. Your main balance stays in
          your wallet.
        </p>
      </div>
    </div>
  )
}

function Checking() {
  return (
    <div className="w-screen dc">
      <ScreenHead title="Dollar card" />
      <div className="dc-pad">
        <div className="dc-check-art">
          <span className="dc-check-card" />
          <img src="/art/kovi-peek.webp" alt="" />
        </div>
        <h1 className="dc-title">Checking your ID</h1>
        <p className="w-lead">Your card appears here the moment Nuvion is done.</p>
        <ol className="dc-steps">
          <li data-state="done">Details sent</li>
          <li data-state="done">ID photo sent</li>
          <li data-state="now">Nuvion checks it</li>
          <li>Your card is made</li>
        </ol>
        <p className="dc-fine">If something doesn’t match, we’ll tell you what to fix.</p>
      </div>
    </div>
  )
}

function TryAgain({ reason, onRetry }: { reason: string | null; onRetry: () => void }) {
  return (
    <div className="w-screen dc">
      <ScreenHead title="Dollar card" />
      <div className="dc-pad">
        <h1 className="dc-title">Your ID didn’t pass</h1>
        <p className="w-lead">
          {reason
            ? `Nuvion said: ${reason}`
            : 'Nuvion couldn’t confirm your details from that photo.'}{' '}
          Check that your details match your ID exactly, then send a clearer photo.
        </p>
        <button type="button" className="pill pill-block" data-tone="ink" onClick={onRetry}>
          <span className="pill-label">Try again</span>
          <span className="pill-cap">
            <Icon name="arrow" size={18} />
          </span>
        </button>
      </div>
    </div>
  )
}

const COUNTRIES = [
  ['NG', 'Nigeria'],
  ['GH', 'Ghana'],
  ['KE', 'Kenya'],
  ['ZA', 'South Africa'],
  ['GB', 'United Kingdom'],
  ['US', 'United States'],
] as const
const IDS: Array<[CardCheck['document']['type'], string]> = [
  ['international_passport', 'Passport'],
  ['national_id', 'National ID'],
  ['drivers_license', 'Licence'],
]

function Check({ onBack, onSent }: { onBack: () => void; onSent: (d: DollarCard) => void }) {
  const { profile, signMessage } = useWallet()
  const [step, setStep] = useState<'details' | 'photo'>('details')
  const [f, setF] = useState({
    first: '',
    last: '',
    dob: '',
    gender: '' as '' | 'f' | 'm',
    country: 'NG',
    email: '',
    phone: '+234',
    line1: '',
    city: '',
    state: '',
    postal: '',
    idType: 'international_passport' as CardCheck['document']['type'],
    idNumber: '',
  })
  const [photo, setPhoto] = useState<{
    url: string
    base64: string
    mime: CardCheck['document']['mime']
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value })
  const adult = (() => {
    const d = new Date(`${f.dob}T00:00:00Z`)
    const line = new Date()
    line.setUTCFullYear(line.getUTCFullYear() - 18)
    return !Number.isNaN(d.getTime()) && d <= line && d.getUTCFullYear() >= 1900
  })()
  const ready =
    f.first.trim() &&
    f.last.trim() &&
    adult &&
    f.gender &&
    /^\S+@\S+\.\S+$/.test(f.email.trim()) &&
    /^\+\d{8,15}$/.test(f.phone.replace(/\s/g, '')) &&
    f.line1.trim().length >= 3 &&
    f.city.trim().length >= 2 &&
    f.state.trim().length >= 2 &&
    f.postal.trim().length >= 2 &&
    f.idNumber.trim().length >= 4
  const idName = IDS.find(([t]) => t === f.idType)?.[1] ?? 'ID'

  const choose = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    if (file.size > 6_000_000) return setError('That photo is over 6 MB. Choose a smaller one.')
    const mime = file.type as CardCheck['document']['mime']
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(mime))
      return setError('Choose a JPEG, PNG or PDF.')
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
      reader.onerror = () => reject(new Error('That file couldn’t be read.'))
      reader.readAsDataURL(file)
    })
    setPhoto({ url: URL.createObjectURL(file), base64, mime })
  }

  const send = async () => {
    if (!profile || !photo || !f.gender) return
    setBusy(true)
    setError(null)
    try {
      onSent(
        await startCardCheck(profile.address as `0x${string}`, signMessage, {
          first_name: f.first.trim(),
          last_name: f.last.trim(),
          date_of_birth: f.dob,
          email: f.email.trim(),
          phone: f.phone.replace(/\s/g, ''),
          nationality: f.country,
          gender: f.gender,
          address: {
            line1: f.line1.trim(),
            city: f.city.trim(),
            state: f.state.trim(),
            postal_code: f.postal.trim(),
            country: f.country,
          },
          document: {
            type: f.idType,
            number: f.idNumber.trim(),
            file: photo.base64,
            mime: photo.mime,
          },
        }),
      )
    } catch (e) {
      setError(problemOf(e))
    } finally {
      setBusy(false)
    }
  }

  if (step === 'photo')
    return (
      <div className="w-screen dc dc-dark">
        <ScreenHead title="ID check" onBack={() => setStep('details')} />
        <div className="dc-pad">
          <Progress step={2} label={`Step 2 of 2 · Photo of your ${idName.toLowerCase()}`} />
          <h1 className="dc-title dc-center">Fit your {idName.toLowerCase()} in the frame</h1>
          <label className="dc-frame">
            {photo ? (
              photo.mime === 'application/pdf' ? (
                <span className="dc-frame-empty">PDF chosen</span>
              ) : (
                <img src={photo.url} alt={`Your ${idName.toLowerCase()}`} />
              )
            ) : (
              <span className="dc-frame-empty">
                <Icon name="camera" size={30} />
                Choose a photo
              </span>
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              capture="environment"
              onChange={(e) => void choose(e.target.files?.[0])}
            />
          </label>
          <ul className="dc-tips">
            <li>No glare</li>
            <li>All four corners</li>
            <li>Words easy to read</li>
          </ul>
          {error ? <p className="form-error">{error}</p> : null}
          <button
            type="button"
            className="pill pill-block"
            data-tone="coral"
            disabled={!photo || busy}
            onClick={() => void send()}
          >
            <span className="pill-label">{busy ? 'Sending to Nuvion…' : 'Send for checking'}</span>
            <span className="pill-cap">
              <Icon name="check" size={18} />
            </span>
          </button>
        </div>
      </div>
    )

  return (
    <div className="w-screen dc">
      <ScreenHead title="ID check" onBack={onBack} />
      <form
        className="dc-pad dc-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) setStep('photo')
        }}
      >
        <Progress step={1} label="Step 1 of 2 · Your details" />
        <h1 className="dc-title">Exactly as it’s written on your ID</h1>
        <div className="dc-pair">
          <Field
            label="First name"
            value={f.first}
            onChange={set('first')}
            autoComplete="given-name"
          />
          <Field
            label="Last name"
            value={f.last}
            onChange={set('last')}
            autoComplete="family-name"
          />
        </div>
        <div className="dc-pair">
          <Field
            label="Date of birth"
            type="date"
            value={f.dob}
            onChange={set('dob')}
            autoComplete="bday"
          />
          <fieldset className="dc-fieldset">
            <legend>Gender</legend>
            <div className="dc-choices">
              {(
                [
                  ['f', 'Female'],
                  ['m', 'Male'],
                ] as const
              ).map(([g, name]) => (
                <button
                  key={g}
                  type="button"
                  aria-pressed={f.gender === g}
                  onClick={() => setF({ ...f, gender: g })}
                >
                  {name}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        <fieldset className="dc-fieldset">
          <legend>Nationality</legend>
          <div className="dc-choices dc-wrap">
            {COUNTRIES.map(([code, name]) => (
              <button
                key={code}
                type="button"
                aria-pressed={f.country === code}
                onClick={() => setF({ ...f, country: code })}
              >
                {name}
              </button>
            ))}
          </div>
        </fieldset>
        <Field
          label="Email"
          type="email"
          value={f.email}
          onChange={set('email')}
          autoComplete="email"
        />
        <Field
          label="Phone"
          type="tel"
          value={f.phone}
          onChange={set('phone')}
          autoComplete="tel"
        />
        <Field
          label="Home address"
          value={f.line1}
          onChange={set('line1')}
          placeholder="House number and street"
          autoComplete="street-address"
        />
        <div className="dc-pair">
          <Field label="City" value={f.city} onChange={set('city')} />
          <Field label="State" value={f.state} onChange={set('state')} />
        </div>
        <Field
          label="Postcode"
          value={f.postal}
          onChange={set('postal')}
          autoComplete="postal-code"
        />
        <fieldset className="dc-fieldset">
          <legend>ID type</legend>
          <div className="dc-choices">
            {IDS.map(([type, name]) => (
              <button
                key={type}
                type="button"
                aria-pressed={f.idType === type}
                onClick={() => setF({ ...f, idType: type })}
              >
                {name}
              </button>
            ))}
          </div>
        </fieldset>
        <Field label={`${idName} number`} value={f.idNumber} onChange={set('idNumber')} />
        <p className="dc-note">
          <Icon name="lock" size={15} />
          Sent straight to Nuvion, who issue the card. Kova keeps only whether you passed.
        </p>
        <button type="submit" className="pill pill-block" data-tone="ink" disabled={!ready}>
          <span className="pill-label">Continue</span>
          <span className="pill-cap">
            <Icon name="arrow" size={18} />
          </span>
        </button>
      </form>
    </div>
  )
}

function Progress({ step, label }: { step: 1 | 2; label: string }) {
  return (
    <div className="dc-progress" data-step={step}>
      <span>{label}</span>
      <div>
        <i />
        <i />
      </div>
    </div>
  )
}

function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, ...rest } = props
  return (
    <label className="dc-field">
      <span>{label}</span>
      <input {...rest} />
    </label>
  )
}

function CardHome({
  data,
  onChange,
  onTopUp,
  onDetails,
}: {
  data: DollarCard
  onChange: (d: DollarCard) => void
  onTopUp: () => void
  onDetails: () => void
}) {
  const { profile, signMessage } = useWallet()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const card = data.card
  if (!card) return null
  const cap = BigInt(data.daily_topup)
  const today = BigInt(data.topups?.today ?? '0')
  const left = BigInt(data.topups?.left ?? data.daily_topup)
  const used = cap > 0n ? Number((today * BigInt(BLOCKS)) / cap) : 0
  const balance = card.balance === null ? '—' : formatUsd(BigInt(card.balance))

  const freeze = async (frozen: boolean) => {
    if (!profile) return
    setBusy(true)
    setError(null)
    try {
      onChange(await setDollarCard(profile.address as `0x${string}`, signMessage, frozen))
    } catch (e) {
      setError(problemOf(e))
    } finally {
      setBusy(false)
    }
  }

  if (card.frozen)
    return (
      <div className="w-screen dc dc-ice">
        <ScreenHead title="Dollar card" />
        <div className="dc-pad">
          <h1 className="dc-title">Frozen</h1>
          <p className="w-lead">
            Every payment is refused until you unfreeze it. Nothing leaves your card.
          </p>
          <div className="dc-frozen">
            <span className="dc-frozen-card">
              <img src="/art/card-coral.png" alt="Your card, frozen" />
            </span>
            <span className="dc-flake" aria-hidden="true">
              ❄
            </span>
          </div>
          <div className="dc-safe">
            <span>
              <small>Safe on your card</small>
              <strong>{balance}</strong>
            </span>
            <span>•••• {card.last_four}</span>
          </div>
          {error ? <p className="form-error">{error}</p> : null}
          <button
            type="button"
            className="pill pill-block"
            data-tone="coral"
            disabled={busy}
            onClick={() => void freeze(false)}
          >
            <span className="pill-label">{busy ? 'One moment…' : 'Unfreeze'}</span>
            <span className="pill-cap">
              <Icon name="check" size={18} />
            </span>
          </button>
        </div>
      </div>
    )

  return (
    <div className="w-screen dc">
      <div className="dc-band">
        <ScreenHead title="" />
        <div className="dc-pad">
          <small>Ready to spend{data.sandbox ? ' · sandbox' : ''}</small>
          <strong className="dc-balance">{balance}</strong>
        </div>
      </div>
      <div className="dc-hero-card">
        <span className="dc-tilt">
          <img src="/art/card-coral.png" alt={`Your Kova card ending ${card.last_four}`} />
          <span className="dc-last4">•••• {card.last_four}</span>
          <CardBrand brand={card.brand} className="dc-brand" />
        </span>
        <div className="dc-meter dc-tilt">
          <p>
            <strong>Today’s top-ups</strong>
            <span>
              {formatUsd(left)} left of {formatUsd(cap)}
            </span>
          </p>
          <div className="dc-blocks">
            {Array.from({ length: BLOCKS }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: ten fixed blocks of a meter
              <i key={i} data-on={i < used ? 'yes' : 'no'} />
            ))}
          </div>
        </div>
      </div>
      {error ? <p className="form-error dc-pad">{error}</p> : null}
      <div className="dc-actions dc-pad">
        <button type="button" data-tone="coral" disabled={left === 0n} onClick={onTopUp}>
          <Icon name="plus" size={18} />
          Top up
        </button>
        <button type="button" onClick={onDetails}>
          <Icon name="eye" size={18} />
          Details
        </button>
        <button type="button" disabled={busy} onClick={() => void freeze(true)}>
          <Icon name="lock" size={18} />
          Freeze
        </button>
      </div>
      <ul className="dc-activity dc-pad">
        {(data.activity ?? []).length === 0 ? (
          <li className="w-quiet">Top-ups and card payments show up here.</li>
        ) : (
          (data.activity ?? []).map((a) => (
            <li key={a.id}>
              <span className="dc-dot" data-kind={a.kind}>
                {a.kind === 'spend' ? (
                  a.title.slice(0, 1).toUpperCase()
                ) : (
                  <Icon name={a.kind === 'topup' ? 'up' : 'down'} size={16} />
                )}
              </span>
              <span className="dc-what">
                <strong>{a.title}</strong>
                <small>
                  {new Date(a.at).toLocaleString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                  {a.kind === 'check' ? ' · Card check, not charged' : ''}
                  {a.kind !== 'check' && a.status === 'pending' ? ' · On its way' : ''}
                  {a.status === 'failed' ? ' · Declined' : ''}
                </small>
              </span>
              <span className="dc-amount" data-kind={a.kind}>
                {a.kind === 'spend' ? '−' : a.kind === 'check' ? '' : '+'}
                {formatUsd(BigInt(a.amount) < 0n ? -BigInt(a.amount) : BigInt(a.amount))}
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}

function TopUp({
  data,
  onClose,
  onDone,
}: {
  data: DollarCard
  onClose: () => void
  onDone: (d: DollarCard) => void
}) {
  const { network, signingAccount, balance } = useWallet()
  const [typed, setTyped] = useState('20')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cap = BigInt(data.daily_topup)
  const today = BigInt(data.topups?.today ?? '0')
  const left = BigInt(data.topups?.left ?? data.daily_topup)
  const value = (() => {
    try {
      return typed ? toBase(typed) : 0n
    } catch {
      return 0n
    }
  })()
  const bps = data.topup_fee_bps ?? 50
  const fee = value > 0n ? topUpFee(value, bps) : 0n
  const total = value + fee
  const tooMuch = value > left
  const short = balance !== null && total > balance
  const earlier = cap > 0n ? Number((today * BigInt(BLOCKS)) / cap) : 0
  const now = cap > 0n ? Math.ceil(Number(((today + value) * BigInt(BLOCKS)) / cap)) - earlier : 0

  const go = async () => {
    const treasury = data.topups?.treasury
    if (!treasury) return
    setBusy(true)
    setError(null)
    try {
      const account = await signingAccount(total)
      onDone((await topUpCard(network, account, treasury, value, bps)).card)
    } catch (e) {
      setError(problemOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dc-sheet-back" role="dialog" aria-label="Top up card">
      <div className="dc-sheet">
        <p className="dc-sheet-head">
          <strong>Top up card</strong>
          <button type="button" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </p>
        <label className="dc-amount-input">
          <span>$</span>
          <input
            inputMode="decimal"
            value={typed}
            onChange={(e) => setTyped(e.target.value.replace(/[^\d.]/g, '').slice(0, 8))}
            aria-label="Amount"
          />
        </label>
        <div className="dc-meter">
          <div className="dc-blocks">
            {Array.from({ length: BLOCKS }, (_, i) => (
              <i
                // biome-ignore lint/suspicious/noArrayIndexKey: ten fixed blocks of a meter
                key={i}
                data-on={
                  i < earlier ? 'yes' : i < earlier + now ? (tooMuch ? 'over' : 'now') : 'no'
                }
              />
            ))}
          </div>
          <p>
            <span>
              {today > 0n ? `${formatUsd(today)} earlier · ` : ''}+{formatUsd(value)} now
            </span>
            <strong data-over={tooMuch ? 'yes' : 'no'}>
              {formatUsd(tooMuch ? left : left - value)} left today
            </strong>
          </p>
        </div>
        <p className="dc-from">
          <span>From Kova balance</span>
          <strong data-over={short ? 'yes' : 'no'}>
            {balance === null ? '—' : formatUsd(balance)}
          </strong>
        </p>
        <p className="dc-from dc-fee">
          <span>Kova fee ({(bps / 100).toFixed(1)}%)</span>
          <span>
            {formatUsd(fee)} · you pay {formatUsd(total)}
          </span>
        </p>
        {error ? <p className="form-error">{error}</p> : null}
        <button
          type="button"
          className="pill pill-block"
          data-tone="ink"
          disabled={busy || value <= 0n || tooMuch || short}
          onClick={() => void go()}
        >
          <span className="pill-label">
            {tooMuch
              ? `Up to ${formatUsd(left)} today`
              : short
                ? 'Not enough in your balance'
                : busy
                  ? 'Topping up…'
                  : `Top up ${formatUsd(value)}`}
          </span>
          <span className="pill-cap">
            <Icon name="face" size={18} />
          </span>
        </button>
      </div>
    </div>
  )
}

function Details({ onClose }: { onClose: () => void }) {
  const { profile, signMessage } = useWallet()
  const [details, setDetails] = useState<CardDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [left, setLeft] = useState(30)
  const [copied, setCopied] = useState<string | null>(null)
  useEffect(() => {
    if (!profile) return
    revealDollarCard(profile.address as `0x${string}`, signMessage)
      .then(setDetails)
      .catch((e) => setError(problemOf(e)))
  }, [profile, signMessage])
  useEffect(() => {
    if (!details) return
    const t = setInterval(() => setLeft((s) => s - 1), 1000)
    return () => clearInterval(t)
  }, [details])
  useEffect(() => {
    if (left <= 0) onClose()
  }, [left, onClose])
  const copy = (what: string, value: string) => {
    void navigator.clipboard.writeText(value)
    setCopied(what)
  }
  const row = (label: string, value: string, what?: string, raw?: string) => (
    <div className="dc-row">
      <span>
        <small>{label}</small>
        <strong>{value}</strong>
      </span>
      {what && raw ? (
        <button type="button" onClick={() => copy(what, raw)}>
          {copied === what ? 'Copied' : 'Copy'}
        </button>
      ) : null}
    </div>
  )
  return (
    <div className="w-screen dc">
      <ScreenHead title="Card details" onBack={onClose} />
      <div className="dc-pad">
        <span className="dc-details-box">
          <img src="/art/card-coral.png" alt="Your Kova dollar card" className="dc-details-card" />
          <CardBrand brand={details?.brand} className="dc-brand dc-brand-lg" />
        </span>
        {error ? (
          <p className="form-error">{error}</p>
        ) : (
          <div className="dc-section">
            {row(
              'Card number',
              details ? details.number.replace(/(\d{4})(?=\d)/g, '$1 ') : 'Opening…',
              'number',
              details?.number,
            )}
            <div className="dc-split">
              {row(
                'Expires',
                details ? `${details.exp_month}/${details.exp_year.slice(-2)}` : '··/··',
              )}
              {row('CVV', details?.cvv ?? '···', 'cvv', details?.cvv)}
            </div>
            {details?.brand === 'mastercard' ? (
              <div className="dc-row">
                <span>
                  <small>Network</small>
                  <strong>Mastercard</strong>
                </span>
                <CardBrand brand="mastercard" />
              </div>
            ) : null}
            {row('Name on card', details?.name ?? '', 'name', details?.name)}
          </div>
        )}
        {details ? (
          <div className="dc-timer">
            <i style={{ width: `${(left / 30) * 100}%` }} />
            <p>
              <span>Hides by itself</span>
              <strong>{left} s</strong>
            </p>
          </div>
        ) : null}
        <p className="dc-note">
          <Icon name="lock" size={15} />
          Only you can see this. It comes straight from Nuvion, and Kova never stores your card
          number or CVV.
        </p>
      </div>
    </div>
  )
}

/** Mastercard's two overlapping circles on a Mastercard; other brands show nothing rather than a guess. */
function CardBrand({ brand, className }: { brand?: string; className?: string }) {
  if (brand !== 'mastercard') return null
  return (
    <svg
      viewBox="0 0 38 24"
      width="38"
      height="24"
      className={className}
      role="img"
      aria-label="Mastercard"
    >
      <circle cx="12" cy="12" r="12" fill="#EB001B" />
      <circle cx="26" cy="12" r="12" fill="#F79E1B" />
      <path d="M19 2.25A12 12 0 0 1 19 21.75A12 12 0 0 1 19 2.25Z" fill="#FF5F00" />
    </svg>
  )
}
