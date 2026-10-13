'use client'

import type { MoneyFeature } from '@kova/monad'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Art, type ArtName, Icon } from '@/components/brand'
import { formatUsd, toBase } from '@/lib/wallet/money'
import {
  type DollarCard,
  getDollarCard,
  getSavings,
  getUsAccount,
  issueDollarCard,
  openUsAccount,
  requestAccess,
  revealDollarCard,
  type Savings,
  saveIn,
  saveOut,
  setDollarCard,
  type UsAccount,
  viewUsAccount,
} from '@/lib/wallet/partners'
import '@/styles/money.css'
import { ScreenHead } from './activity'
import { useWallet } from './provider'
import { CopyButton } from './ui'

/**
 * Money in (a US account number), the dollar card and savings. Each runs through a partner; until
 * Kova has that partner's key, the screen says so plainly and lets you ask to be first, and once it
 * has it, the real thing opens.
 */

const problemOf = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.')

/** Loads one of the three, and reloads it on demand. */
function useMoney<T>(load: (address: string) => Promise<T>) {
  const { profile } = useWallet()
  const [data, setData] = useState<T | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const address = profile?.address
  const reload = useCallback(async () => {
    if (!address) return
    try {
      setData(await load(address))
      setProblem(null)
    } catch (e) {
      setProblem(problemOf(e))
    }
  }, [address, load])
  useEffect(() => {
    void reload()
  }, [reload])
  return { data, setData, problem, reload }
}

/** The honest state: what it is, who runs it, and a way to be first when it opens. */
function NotYet({
  art,
  title,
  lead,
  facts,
  feature,
  requested,
  onRequested,
}: {
  art: ArtName
  title: string
  lead: string
  facts: Array<[string, string]>
  feature: MoneyFeature
  requested: boolean
  onRequested: () => void
}) {
  const { profile, signMessage } = useWallet()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  return (
    <div className="m-intro">
      <Art name={art} size={112} className="m-intro-art" />
      <h1 className="w-title">{title}</h1>
      <p className="w-lead">{lead}</p>
      <dl className="w-review-card">
        {facts.map(([k, v]) => (
          <div key={k} className="w-review-row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {requested ? (
        <p className="m-listed">
          <Icon name="check" size={16} />
          You’re on the list. Kova switches this on for you as soon as its partner does.
        </p>
      ) : (
        <>
          <p className="m-quiet">Opening soon. Ask now and you’ll be among the first.</p>
          {problem ? <p className="form-error">{problem}</p> : null}
          <button
            type="button"
            className="pill pill-block"
            data-tone="ink"
            disabled={busy || !profile}
            onClick={async () => {
              if (!profile) return
              setBusy(true)
              setProblem(null)
              try {
                await requestAccess(profile.address as `0x${string}`, signMessage, feature)
                onRequested()
              } catch (e) {
                setProblem(problemOf(e))
              } finally {
                setBusy(false)
              }
            }}
          >
            <span className="pill-label">{busy ? 'Asking…' : 'Request access'}</span>
            <span className="pill-cap">
              <Icon name="bell" size={18} />
            </span>
          </button>
        </>
      )}
    </div>
  )
}

function Sandbox({ what }: { what: string }) {
  return (
    <p className="m-sandbox">
      <Icon name="info" size={14} />
      {what}
    </p>
  )
}

// --- Get paid from abroad --------------------------------------------------------------------

export function UsAccountScreen() {
  const { profile, signMessage } = useWallet()
  const { data, setData, problem, reload } = useMoney<UsAccount>(getUsAccount)
  const [form, setForm] = useState({ full_name: profile?.name ?? '', email: '' })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const address = profile?.address as `0x${string}` | undefined

  const act = async (label: string, run: () => Promise<UsAccount | void>) => {
    setBusy(label)
    setError(null)
    try {
      const next = await run()
      if (next) setData(next)
    } catch (e) {
      setError(problemOf(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="w-screen">
      <ScreenHead title="Get paid from abroad" back="/wallet/add" />
      {!data ? (
        <p className="w-quiet">{problem ?? 'Opening…'}</p>
      ) : !data.live ? (
        <NotYet
          art="kovi-catch"
          title="Your own US account number"
          lead="Clients and platforms abroad pay it like any US bank account, and it lands here as dollars you can keep, spend or send."
          facts={[
            ['They pay by', 'ACH or wire, from any US bank'],
            ['It lands as', `${data.arrives_as} in this wallet, on Monad`],
            ['In your name', 'After a quick identity check'],
            ['Partner', 'Bridge, a Stripe company'],
          ]}
          feature="us_account"
          requested={data.requested}
          onRequested={() => setData({ ...data, requested: true })}
        />
      ) : data.status === 'none' ? (
        <div className="m-intro">
          <Art name="kovi-catch" size={104} className="m-intro-art" />
          <h1 className="w-title">Your own US account number</h1>
          <p className="w-lead">Bridge checks who you are first, as every bank does. It takes a few minutes.</p>
          {data.sandbox ? <Sandbox what="Bridge sandbox: the account is a test one and no money moves." /> : null}
          <label className="m-field">
            <span>Your full name</span>
            <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} autoComplete="name" />
          </label>
          <label className="m-field">
            <span>Email</span>
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} type="email" autoComplete="email" />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button
            type="button"
            className="pill pill-block"
            data-tone="coral"
            disabled={busy !== null || !address || form.full_name.trim().length < 2 || !form.email.includes('@')}
            onClick={() => address && act('open', () => openUsAccount(address, signMessage, form))}
          >
            <span className="pill-label">{busy ? 'Starting…' : 'Continue to verification'}</span>
            <span className="pill-cap">
              <Icon name="arrow" size={18} />
            </span>
          </button>
        </div>
      ) : data.status === 'kyc' ? (
        <div className="m-intro">
          <Art name="kovi-key" size={104} className="m-intro-art" />
          <h1 className="w-title">Finish with Bridge</h1>
          <p className="w-lead">
            Bridge is checking it’s you{data.kyc_status ? ` (${data.kyc_status.replaceAll('_', ' ')})` : ''}. Your account
            number appears here the moment it’s approved.
          </p>
          {data.kyc_link ? (
            <a href={data.kyc_link} target="_blank" rel="noopener noreferrer" className="pill pill-block" data-tone="coral">
              <span className="pill-label">Verify with Bridge</span>
              <span className="pill-cap">
                <Icon name="external" size={18} />
              </span>
            </a>
          ) : null}
          <button type="button" className="m-link" onClick={() => void reload()}>
            I’ve finished: check again
          </button>
        </div>
      ) : (
        <div className="m-intro">
          <p className="m-eyebrow">Your US account</p>
          <h1 className="w-title">Paid in dollars, from anywhere</h1>
          {data.sandbox ? <Sandbox what="Bridge sandbox: a test account, no money moves." /> : null}
          {data.details ? (
            <dl className="m-bank">
              {(
                [
                  ['Bank', data.details.bank_name],
                  ['Account number', data.details.account_number],
                  ['Routing number', data.details.routing_number],
                  ['Name on the account', data.details.beneficiary_name],
                ] as const
              ).map(([k, v]) =>
                v ? (
                  <div key={k} className="m-bank-row">
                    <dt>{k}</dt>
                    <dd>
                      <span>{v}</span>
                      <CopyButton text={v} label="Copy" className="m-copy" />
                    </dd>
                  </div>
                ) : null,
              )}
            </dl>
          ) : (
            <button
              type="button"
              className="m-bank m-bank-hidden"
              disabled={busy !== null || !address}
              onClick={() => address && act('view', () => viewUsAccount(address, signMessage))}
            >
              <span>Account ending {data.last_four ?? '····'}</span>
              <strong>{busy ? 'Opening…' : 'Show the details'}</strong>
            </button>
          )}
          {error ? <p className="form-error">{error}</p> : null}
          <p className="m-quiet">
            ACH takes 1 to 3 business days and wires arrive the same day. Either way it lands here as {data.arrives_as}.
          </p>
        </div>
      )}
    </div>
  )
}

// --- The dollar card -------------------------------------------------------------------------

const LIMITS = [50, 200, 500, 1000]

export function DollarCardScreen() {
  const { profile, signMessage } = useWallet()
  const { data, setData, problem } = useMoney<DollarCard>(getDollarCard)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reveal, setReveal] = useState<string | null>(null)
  const address = profile?.address as `0x${string}` | undefined

  const act = async (label: string, run: () => Promise<DollarCard>) => {
    setBusy(label)
    setError(null)
    try {
      setData(await run())
    } catch (e) {
      setError(problemOf(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="w-screen">
      <ScreenHead title="Dollar card" />
      {!data ? (
        <p className="w-quiet">{problem ?? 'Opening…'}</p>
      ) : !data.live ? (
        <NotYet
          art="card-active"
          title="A dollar card for anywhere"
          lead="Pay online and in shops straight from your Kova dollars: subscriptions, flights, anything that takes a card."
          facts={[
            ['Spends from', 'Your Kova balance'],
            ['Daily limit', 'You set it, and change it any time'],
            ['Freeze', 'One tap, refused at once'],
            ['Card number', 'Shown only to you'],
          ]}
          feature="dollar_card"
          requested={data.requested}
          onRequested={() => setData({ ...data, requested: true })}
        />
      ) : !data.card ? (
        <div className="m-intro">
          <Art name="card-active" size={150} className="m-intro-art" />
          <h1 className="w-title">Get your dollar card</h1>
          <p className="w-lead">A virtual card you can use straight away, spending up to $200 a day from your balance.</p>
          {data.sandbox ? <Sandbox what="Card sandbox: a test card, no money moves." /> : null}
          {error ? <p className="form-error">{error}</p> : null}
          <button
            type="button"
            className="pill pill-block"
            data-tone="coral"
            disabled={busy !== null || !address}
            onClick={() => address && act('issue', () => issueDollarCard(address, signMessage))}
          >
            <span className="pill-label">{busy ? 'Making your card…' : 'Get my card'}</span>
            <span className="pill-cap">
              <Icon name="card" size={18} />
            </span>
          </button>
        </div>
      ) : (
        <div className="m-intro">
          {data.sandbox ? <Sandbox what="Card sandbox: a test card, no money moves." /> : null}
          <div className="m-card" data-frozen={data.card.frozen ? 'yes' : 'no'}>
            <span className="m-card-top">
              <span className="m-card-brand">kova</span>
              {data.card.frozen ? <span className="m-chip">Frozen</span> : <span className="m-card-kind">Virtual</span>}
            </span>
            <span className="m-card-number">•••• •••• •••• {data.card.last_four}</span>
            <span className="m-card-bottom">
              <span>{profile?.name || 'Kova'}</span>
              <span>{data.card.exp_month && data.card.exp_year ? `${data.card.exp_month}/${data.card.exp_year.slice(-2)}` : ''}</span>
            </span>
          </div>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="m-actions">
            <button
              type="button"
              className="m-action"
              disabled={busy !== null || !address}
              onClick={async () => {
                if (!address) return
                setBusy('reveal')
                setError(null)
                try {
                  setReveal((await revealDollarCard(address, signMessage)).url)
                } catch (e) {
                  setError(problemOf(e))
                } finally {
                  setBusy(null)
                }
              }}
            >
              <Icon name="eye" size={18} />
              <span>{busy === 'reveal' ? 'Opening…' : 'Show number'}</span>
            </button>
            <button
              type="button"
              className="m-action"
              data-tone={data.card.frozen ? 'teal' : 'coral'}
              disabled={busy !== null || !address}
              onClick={() =>
                address && act('freeze', () => setDollarCard(address, signMessage, { frozen: !data.card?.frozen }))
              }
            >
              <Icon name="lock" size={18} />
              <span>{busy === 'freeze' ? 'One moment…' : data.card.frozen ? 'Unfreeze' : 'Freeze'}</span>
            </button>
          </div>
          <h2 className="w-section">Daily limit</h2>
          <div className="m-limits">
            {LIMITS.map((dollars) => {
              const units = toBase(String(dollars))
              const on = BigInt(data.card?.daily_limit ?? 0) === units
              return (
                <button
                  key={dollars}
                  type="button"
                  className="m-limit"
                  aria-pressed={on}
                  disabled={busy !== null || on || !address}
                  onClick={() =>
                    address && act('limit', () => setDollarCard(address, signMessage, { daily_limit: units.toString() }))
                  }
                >
                  ${dollars.toLocaleString('en-US')}
                </button>
              )
            })}
          </div>
          <h2 className="w-section">Payments</h2>
          {data.transactions.length === 0 ? (
            <p className="w-quiet">Card payments show up here.</p>
          ) : (
            <ul className="m-list">
              {data.transactions.map((t) => (
                <li key={t.id}>
                  <span>
                    <strong>{t.merchant}</strong>
                    <small>
                      {new Date(t.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {t.status}
                    </small>
                  </span>
                  <span className="m-amount">−{formatUsd(BigInt(t.amount))}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {reveal ? (
        <div className="m-reveal" role="dialog" aria-label="Card number">
          <div className="m-reveal-sheet">
            <iframe src={reveal} title="Your card number" className="m-reveal-frame" />
            <button type="button" className="pill pill-block" data-tone="ink" onClick={() => setReveal(null)}>
              <span className="pill-label">Done</span>
              <span className="pill-cap">
                <Icon name="check" size={18} />
              </span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// --- Savings ---------------------------------------------------------------------------------

export function SavingsScreen() {
  const { profile, network, signingAccount, refresh, balance } = useWallet()
  const { data, setData, problem, reload } = useMoney<Savings>(getSavings)
  const [mode, setMode] = useState<'in' | 'out'>('in')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  return (
    <div className="w-screen">
      <ScreenHead title="Savings" />
      {!data ? (
        <p className="w-quiet">{problem ?? 'Opening…'}</p>
      ) : !data.live ? (
        <NotYet
          art="coin-usd"
          title="Dollars that earn"
          lead="Move the dollars you aren’t spending into savings, and they earn while they wait. Take them back any time."
          facts={[
            ['Earns from', 'An AUSD savings vault on Monad'],
            ['Moving in and out', 'One signature, Kova pays the gas'],
            ['Your savings', 'Held in your name, not Kova’s'],
          ]}
          feature="savings"
          requested={data.requested}
          onRequested={() => setData({ ...data, requested: true })}
        />
      ) : (
        <div className="m-intro">
          <p className="m-eyebrow">{data.vault?.name ?? 'Savings'}</p>
          <p className="m-big">{formatUsd(BigInt(data.balance))}</p>
          <p className="m-earned">
            <strong>+{formatUsd(BigInt(data.earned))}</strong> {data.test ? 'test interest' : 'earned'} on{' '}
            {formatUsd(BigInt(data.deposited))} put in
          </p>
          {data.test ? (
            <Sandbox what="Test savings on Monad testnet: the interest is test dollars Kova adds, not a real yield." />
          ) : null}
          <div className="m-toggle" role="tablist">
            {(['in', 'out'] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}>
                {m === 'in' ? 'Move in' : 'Move out'}
              </button>
            ))}
          </div>
          <label className="m-field m-field-money">
            <span>{mode === 'in' ? `From your balance (${formatUsd(balance ?? 0n)})` : `From savings (${formatUsd(BigInt(data.balance))})`}</span>
            <span className="m-money-input">
              <span>$</span>
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              />
            </span>
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          {done ? <p className="m-listed">{done}</p> : null}
          <button
            type="button"
            className="pill pill-block"
            data-tone={mode === 'in' ? 'coral' : 'ink'}
            disabled={busy || !profile || !(Number(amount) > 0)}
            onClick={async () => {
              setBusy(true)
              setError(null)
              setDone(null)
              try {
                const value = toBase(amount)
                const account = await signingAccount(value)
                if (mode === 'in') {
                  if (value > (balance ?? 0n)) throw new Error('That’s more than your balance.')
                  await saveIn(network, account, data, value)
                  setDone(`${formatUsd(value)} is in savings.`)
                } else {
                  const total = BigInt(data.balance)
                  if (value > total) throw new Error('That’s more than you have in savings.')
                  const shares = (BigInt(data.vault?.shares ?? '0') * value) / (total || 1n)
                  await saveOut(account, data, value === total ? BigInt(data.vault?.shares ?? '0') : shares)
                  setDone(`${formatUsd(value)} is back in your balance.`)
                }
                setAmount('')
                await Promise.all([reload(), refresh()])
              } catch (e) {
                setError(problemOf(e))
              } finally {
                setBusy(false)
              }
            }}
          >
            <span className="pill-label">{busy ? 'Moving…' : mode === 'in' ? 'Move into savings' : 'Move to my balance'}</span>
            <span className="pill-cap">
              <Icon name={mode === 'in' ? 'down' : 'up'} size={18} />
            </span>
          </button>
          {data.moves.length > 0 ? (
            <>
              <h2 className="w-section">Moves</h2>
              <ul className="m-list">
                {data.moves.map((m) => (
                  <li key={m.tx_hash}>
                    <span>
                      <strong>{m.kind === 'in' ? 'Into savings' : 'Back to balance'}</strong>
                      <small>{new Date(m.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</small>
                    </span>
                    <span className="m-amount">{formatUsd(BigInt(m.amount))}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}

// --- On Home ---------------------------------------------------------------------------------

/** Savings and the dollar card, side by side under the shop, as on the app's Home. */
export function MoneyRow() {
  const { profile } = useWallet()
  const [savings, setSavings] = useState<Savings | null>(null)
  const [card, setCard] = useState<DollarCard | null>(null)
  const address = profile?.address
  useEffect(() => {
    if (!address) return
    void getSavings(address).then(setSavings).catch(() => null)
    void getDollarCard(address).then(setCard).catch(() => null)
  }, [address])
  const saved = savings?.live ? BigInt(savings.balance) : 0n
  return (
    <div className="m-row">
      <Link href="/wallet/savings" className="m-tile" data-tone="teal">
        <span className="m-tile-icon">
          <Icon name="up" size={16} />
        </span>
        <small>Savings</small>
        <strong>{savings?.live && saved > 0n ? formatUsd(saved) : 'Earn on spare dollars'}</strong>
        {savings?.live && BigInt(savings.earned) > 0n ? <span className="m-tile-note">+{formatUsd(BigInt(savings.earned))}</span> : null}
      </Link>
      <Link href="/wallet/card" className="m-tile" data-tone="ink">
        <span className="m-tile-icon">
          <Icon name="card" size={16} />
        </span>
        <small>Dollar card</small>
        <strong>{card?.card ? `•••• ${card.card.last_four}` : 'Spend anywhere'}</strong>
        {card?.card?.frozen ? <span className="m-tile-note">Frozen</span> : null}
      </Link>
    </div>
  )
}

/** Add money's row for a US account number. */
export function FromAbroadRow() {
  return (
    <Link href="/wallet/us-account" className="w-add-chain">
      <span>
        <strong>Get paid from abroad</strong>
        <small>Your own US account number, by ACH or wire</small>
      </span>
      <Icon name="globe" size={18} />
    </Link>
  )
}
