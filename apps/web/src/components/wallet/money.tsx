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

const problemOf = (e: unknown) =>
  e instanceof Error ? e.message : 'Something went wrong. Try again.'

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

  const act = async (label: string, run: () => Promise<UsAccount>) => {
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
            ['It lands as', 'Dollars in this wallet'],
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
          <p className="w-lead">
            Bridge checks who you are first, as every bank does. It takes a few minutes.
          </p>
          {data.sandbox ? (
            <Sandbox what="Bridge sandbox: the account is a test one and no money moves." />
          ) : null}
          <label className="m-field">
            <span>Your full name</span>
            <input
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              autoComplete="name"
            />
          </label>
          <label className="m-field">
            <span>Email</span>
            <input
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              type="email"
              autoComplete="email"
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button
            type="button"
            className="pill pill-block"
            data-tone="coral"
            disabled={
              busy !== null ||
              !address ||
              form.full_name.trim().length < 2 ||
              !form.email.includes('@')
            }
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
            Bridge is checking it’s you
            {data.kyc_status ? ` (${data.kyc_status.replaceAll('_', ' ')})` : ''}. Your account
            number appears here the moment it’s approved.
          </p>
          {data.kyc_link ? (
            <a
              href={data.kyc_link}
              target="_blank"
              rel="noopener noreferrer"
              className="pill pill-block"
              data-tone="coral"
            >
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
            ACH takes 1 to 3 business days and wires arrive the same day. Either way it lands here
            as dollars.
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
          <p className="w-lead">
            A virtual card you can use straight away, spending up to $200 a day from your balance.
          </p>
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
              {data.card.frozen ? (
                <span className="m-chip">Frozen</span>
              ) : (
                <span className="m-card-kind">Virtual</span>
              )}
            </span>
            <span className="m-card-number">•••• •••• •••• {data.card.last_four}</span>
            <span className="m-card-bottom">
              <span>{profile?.name || 'Kova'}</span>
              <span>
                {data.card.exp_month && data.card.exp_year
                  ? `${data.card.exp_month}/${data.card.exp_year.slice(-2)}`
                  : ''}
              </span>
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
                address &&
                act('freeze', () =>
                  setDollarCard(address, signMessage, { frozen: !data.card?.frozen }),
                )
              }
            >
              <Icon name="lock" size={18} />
              <span>
                {busy === 'freeze' ? 'One moment…' : data.card.frozen ? 'Unfreeze' : 'Freeze'}
              </span>
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
                    address &&
                    act('limit', () =>
                      setDollarCard(address, signMessage, { daily_limit: units.toString() }),
                    )
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
                      {new Date(t.at).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                      })}{' '}
                      · {t.status}
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
            <button
              type="button"
              className="pill pill-block"
              data-tone="ink"
              onClick={() => setReveal(null)}
            >
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
  const [picked, setMode] = useState<'in' | 'out'>('in')
  // A wallet savings hasn't opened to yet, already holding some, can only take them out.
  const canSave = data?.can_save !== false
  const mode = canSave ? picked : 'out'
  /** What the vault's cap leaves for this wallet, and what can come out right now. */
  const room = data?.room == null ? null : BigInt(data.room)
  const outNow = data?.withdrawable == null ? null : BigInt(data.withdrawable)
  const total = data ? BigInt(data.balance) : 0n
  const limit =
    mode === 'in'
      ? room === null
        ? null
        : room === 0n
          ? 'Savings is full right now. Try again later.'
          : room < (balance ?? 0n)
            ? `Savings can take ${formatUsd(room)} more right now.`
            : null
      : outNow === null || outNow >= total
        ? null
        : outNow === 0n
          ? 'Savings can’t pay out right now. Your savings are still yours: try again in a little while.'
          : `You can move ${formatUsd(outNow)} out right now.`
  const shut = (mode === 'in' && room === 0n) || (mode === 'out' && outNow === 0n)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  /** The most this move can be: your balance or the vault's room in; what can leave now out. */
  const cap = (a: bigint, b: bigint | null) => (b !== null && b < a ? b : a)
  const most = mode === 'in' ? cap(balance ?? 0n, room) : cap(total, outNow)
  const asTyped = (v: bigint) => (Number(v) / 1e6).toFixed(2)

  const move = async () => {
    if (!data) return
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const value = toBase(amount)
      const account = await signingAccount(value)
      if (mode === 'in') {
        if (value > (balance ?? 0n)) throw new Error('That’s more than your balance.')
        if (room !== null && value > room)
          throw new Error(`Savings can take ${formatUsd(room)} more right now.`)
        await saveIn(network, account, data, value)
        setDone(`${formatUsd(value)} is in savings.`)
      } else {
        if (value > total) throw new Error('That’s more than you have in savings.')
        if (outNow !== null && value > outNow)
          throw new Error(`You can move ${formatUsd(outNow)} out right now.`)
        const all = BigInt(data.vault?.shares ?? '0')
        await saveOut(account, data, value === total ? all : (all * value) / (total || 1n))
        setDone(`${formatUsd(value)} is back in your balance.`)
      }
      setAmount('')
      await Promise.all([reload(), refresh()])
    } catch (e) {
      setError(problemOf(e))
    } finally {
      setBusy(false)
    }
  }

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
            ['Earns from', 'A dollar savings vault'],
            ['Moving in and out', 'One passkey tap, Kova covers the fee'],
            ['Your savings', 'Held in your name, not Kova’s'],
          ]}
          feature="savings"
          requested={data.requested}
          onRequested={() => setData({ ...data, requested: true })}
        />
      ) : (
        <div className="sv">
          <section
            className="sv-card"
            aria-label={`${formatUsd(total)} in savings, ${formatUsd(BigInt(data.earned))} earned`}
          >
            <svg
              className="w-balance-rings"
              width="220"
              height="220"
              viewBox="-110 -110 220 220"
              aria-hidden="true"
            >
              {[104, 78, 52, 26].map((r) => (
                <circle key={r} r={r} fill="none" stroke="var(--teal-deep)" strokeWidth="2" />
              ))}
            </svg>
            <Art name="kovi-sleep" size={112} className="sv-kovi" />
            <p className="sv-label">In savings</p>
            <p className="sv-amount">
              {formatUsd(total).slice(0, formatUsd(total).lastIndexOf('.'))}
              <small>{formatUsd(total).slice(formatUsd(total).lastIndexOf('.'))}</small>
            </p>
            <p className="sv-earned">
              <strong>+{formatUsd(BigInt(data.earned))}</strong>{' '}
              {data.test ? 'test interest' : 'earned'} on {formatUsd(BigInt(data.deposited))}
            </p>
            {data.rate && data.rate.yearly > 0 && !data.test ? (
              <p className="sv-rate">
                <Icon name="bolt" size={14} /> About {(data.rate.yearly * 100).toFixed(1)}% a year
                lately
              </p>
            ) : null}
          </section>
          {data.rate && data.rate.yearly > 0 && !data.test ? (
            <p className="sv-fine">
              What it paid over the last {data.rate.days} days. It changes, and isn’t a promise.
            </p>
          ) : null}
          {data.test ? (
            <Sandbox what="Test savings on Monad testnet: the interest is test dollars Kova adds, not a real yield." />
          ) : null}

          <div className="sv-actions">
            {canSave ? (
              <button
                type="button"
                className="pill pill-block"
                data-tone="coral"
                aria-pressed={mode === 'in'}
                onClick={() => {
                  setMode('in')
                  setAmount('')
                  setError(null)
                }}
              >
                <span className="pill-label">Save</span>
                <span className="pill-cap">
                  <Icon name="down" size={18} />
                </span>
              </button>
            ) : null}
            <button
              type="button"
              className="pill pill-block"
              data-tone="light"
              aria-pressed={mode === 'out'}
              disabled={total === 0n}
              onClick={() => {
                setMode('out')
                setAmount('')
                setError(null)
              }}
            >
              <span className="pill-label">Withdraw</span>
              <span className="pill-cap">
                <Icon name="up" size={18} />
              </span>
            </button>
          </div>

          <div className="sv-move" data-mode={mode}>
            <label className="sv-move-label" htmlFor="sv-amount">
              {mode === 'in'
                ? `Save from your balance · ${formatUsd(balance ?? 0n)}`
                : `Withdraw to your balance · ${formatUsd(total)} saved`}
            </label>
            <span className="sv-money">
              <span aria-hidden="true">$</span>
              <input
                id="sv-amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                disabled={shut}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              />
            </span>
            {shut ? null : (
              <div className="sv-quick">
                {(mode === 'in' ? [10_000_000n, 50_000_000n] : [])
                  .filter((v) => v < most)
                  .map((v) => (
                    <button key={String(v)} type="button" onClick={() => setAmount(asTyped(v))}>
                      {formatUsd(v)}
                    </button>
                  ))}
                {most > 0n ? (
                  <button type="button" onClick={() => setAmount(asTyped(most))}>
                    All {formatUsd(most)}
                  </button>
                ) : null}
              </div>
            )}
            {limit ? <p className="m-limit">{limit}</p> : null}
            {error ? <p className="form-error">{error}</p> : null}
            {done ? <p className="m-listed">{done}</p> : null}
            <button
              type="button"
              className="pill pill-block"
              data-tone={mode === 'in' ? 'coral' : 'ink'}
              disabled={busy || shut || !profile || !(Number(amount) > 0)}
              onClick={() => void move()}
            >
              <span className="pill-label">
                {busy
                  ? 'Moving…'
                  : `${mode === 'in' ? 'Save' : 'Withdraw'}${Number(amount) > 0 ? ` $${Number(amount).toFixed(2)}` : ''}`}
              </span>
              <span className="pill-cap">
                <Icon name="face" size={18} />
              </span>
            </button>
            <p className="sv-fine">One passkey tap. Kova covers the fee.</p>
          </div>

          <section className="sv-where" aria-labelledby="sv-where-title">
            <h2 className="w-section" id="sv-where-title">
              Where it sits
            </h2>
            <ol className="sv-path">
              <li>
                <span className="sv-node">
                  <Icon name="user" size={18} />
                </span>
                <strong>Your wallet</strong>
                <small>Signs every move</small>
              </li>
              <li>
                <span className="sv-node sv-node-vault">
                  <Icon name="lock" size={18} />
                </span>
                <strong>{data.vault?.name ?? 'Savings vault'}</strong>
                <small>Held in your name</small>
              </li>
              <li>
                <span className="sv-node sv-node-earn">
                  <Icon name="globe" size={18} />
                </span>
                <strong>Lending markets</strong>
                <small>Where it earns</small>
              </li>
            </ol>
            {data.beta ? (
              <p className="m-risk">
                <Icon name="info" size={16} />
                <span>
                  New, and not audited yet. Withdrawals can pause for a while if a market it lends
                  to stops reporting. Only save what you could do without.
                </span>
              </p>
            ) : null}
          </section>

          {data.moves.length > 0 ? (
            <section aria-labelledby="sv-moves-title">
              <h2 className="w-section" id="sv-moves-title">
                Moves
              </h2>
              <ul className="sv-moves">
                {data.moves.map((m) => (
                  <li key={m.tx_hash}>
                    <span className="sv-move-icon" data-kind={m.kind}>
                      <Icon name={m.kind === 'in' ? 'down' : 'up'} size={16} />
                    </span>
                    <span className="sv-move-what">
                      <strong>{m.kind === 'in' ? 'Saved' : 'Withdrew'}</strong>
                      <small>
                        {new Date(m.at).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </small>
                    </span>
                    <span className="sv-move-amount">
                      {m.kind === 'in' ? '+' : '−'}
                      {formatUsd(BigInt(m.amount))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
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
    void getSavings(address)
      .then(setSavings)
      .catch(() => null)
    void getDollarCard(address)
      .then(setCard)
      .catch(() => null)
  }, [address])
  const saved = savings?.live ? BigInt(savings.balance) : 0n
  return (
    <div className="m-row">
      <Link href="/wallet/savings" className="m-tile" data-tone="teal">
        <span className="m-tile-icon">
          <Icon name="bolt" size={16} />
        </span>
        <small>Savings</small>
        <strong>
          {savings?.live && saved > 0n
            ? formatUsd(saved)
            : savings?.live && savings.rate && savings.rate.yearly > 0 && !savings.test
              ? `Earn ${(savings.rate.yearly * 100).toFixed(1)}% a year`
              : 'Earn on spare dollars'}
        </strong>
        {savings?.live && BigInt(savings.earned) > 0n ? (
          <span className="m-tile-note">+{formatUsd(BigInt(savings.earned))}</span>
        ) : null}
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
