'use client'

import { parseAmount } from '@kova/monad'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Art, Icon } from '@/components/brand'
import type { CashOutToPay } from '@/lib/wallet/chain'
import { formatUsd } from '@/lib/wallet/money'
import { ScreenHead } from './activity'
import { useWallet } from './provider'
import { CopyButton } from './ui'

/**
 * Naira in and out (the API's services/naira.ts), through PAJ on Monad mainnet or Paystack:
 *
 * - Cash out: dollars to any Nigerian bank account. The bank names the account first, and the
 *   wallet signs exactly the quote's transfer. With PAJ it goes to Kova's cash-out contract, which
 *   swaps it to USDC and pays PAJ, and PAJ pays the bank; with Paystack, to Kova's treasury.
 * - Add money: with PAJ, a bank transfer to an account opened for this one payment (Kova's page
 *   for it, /naira/pay/:reference); with Paystack, its checkout. The dollars land in the wallet.
 */

export type NairaPartner = 'paj' | 'paystack'

export interface NairaInfo {
  enabled: boolean
  partner?: NairaPartner | null
  test_mode?: boolean
  rate_source?: 'chainlink' | 'table' | 'paj'
  market_rate?: string
  cash_out_rate?: string
  top_up_rate?: string
}

const partnerName = (partner: NairaPartner | null | undefined) =>
  partner === 'paj' ? 'PAJ' : 'Paystack'

interface Bank {
  name: string
  code: string
}

interface Quote {
  naira: string
  rate: string
  fee: string
  rate_source: 'chainlink' | 'table' | 'paj'
}

export interface TopUp {
  reference: string
  partner?: NairaPartner
  amount: string
  naira: string
  status: 'initialized' | 'paid' | 'settled' | 'failed'
  /** PAJ: the bank account opened for this one payment, and exactly what to send it. */
  bank_transfer?: {
    bank_name: string | null
    account_number: string
    account_name: string | null
    naira: string
  } | null
  return_url?: string | null
  tx_url: string | null
  failure: string | null
  test_mode: boolean
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const body = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `Kova didn’t answer (${response.status}).`)
  return body
}

const naira = (n: number) =>
  `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const DOLLARS = /^\d{1,7}(\.\d{0,2})?$/

/** Whether naira is on for this server, and today's rates. */
export function useNaira() {
  const [info, setInfo] = useState<NairaInfo | null>(null)
  useEffect(() => {
    void json<NairaInfo>('/api/naira/naira')
      .then(setInfo)
      .catch(() => setInfo({ enabled: false }))
  }, [])
  return info
}

function useQuote(amount: string, direction: 'in' | 'out', enabled: boolean) {
  const [quote, setQuote] = useState<Quote | null>(null)
  useEffect(() => {
    setQuote(null)
    if (!enabled || !DOLLARS.test(amount) || Number(amount) < 1) return
    const timer = setTimeout(() => {
      void json<Quote>(`/api/naira/naira/quote?amount=${amount}&direction=${direction}`)
        .then(setQuote)
        .catch(() => setQuote(null))
    }, 250)
    return () => clearTimeout(timer)
  }, [amount, direction, enabled])
  return quote
}

function TestModeNote({ on }: { on: boolean | undefined }) {
  if (!on) return null
  return (
    <p className="w-fine w-center w-naira-test">
      Paystack test mode: no naira moves. The dollars are Monad testnet dollars.
    </p>
  )
}

// ── Cash out ────────────────────────────────────────────────────────────────────────────────

type CashStage =
  | { at: 'form' }
  | { at: 'quoting' }
  | { at: 'signing' }
  | { at: 'done'; cashOut: CashOutToPay }

export function NairaCashOut() {
  const { profile, balance, cashOutNaira } = useWallet()
  const info = useNaira()
  const [banks, setBanks] = useState<Bank[]>([])
  const [amount, setAmount] = useState('')
  const [bank, setBank] = useState('')
  const [account, setAccount] = useState('')
  const [named, setNamed] = useState<{ name: string } | { problem: string } | null>(null)
  const [stage, setStage] = useState<CashStage>({ at: 'form' })
  const [problem, setProblem] = useState<string | null>(null)
  const enabled = info?.enabled === true
  const quote = useQuote(amount, 'out', enabled)

  useEffect(() => {
    if (!enabled) return
    void json<{ data: Bank[] }>('/api/naira/naira/banks')
      .then((r) => setBanks(r.data))
      .catch(() => setBanks([]))
  }, [enabled])

  // The bank names the account as soon as the number is complete.
  useEffect(() => {
    setNamed(null)
    if (!bank || !/^\d{10}$/.test(account)) return
    let live = true
    void json<{ account_name: string }>('/api/naira/naira/account', {
      method: 'POST',
      body: JSON.stringify({ account_number: account, bank_code: bank }),
    })
      .then((r) => live && setNamed({ name: r.account_name }))
      .catch(
        (e) =>
          live && setNamed({ problem: e instanceof Error ? e.message : 'The bank didn’t answer.' }),
      )
    return () => {
      live = false
    }
  }, [account, bank])

  const units = useMemo(() => {
    try {
      return DOLLARS.test(amount) ? parseAmount(amount) : 0n
    } catch {
      return 0n
    }
  }, [amount])
  const short = balance !== null && units > balance
  const ready =
    enabled && units >= 1_000_000n && !short && quote !== null && named !== null && 'name' in named

  const cashOut = async () => {
    if (!profile || !ready) return
    setProblem(null)
    setStage({ at: 'quoting' })
    try {
      const quoted = await json<CashOutToPay>(`/api/naira/wallets/${profile.address}/cash-outs`, {
        method: 'POST',
        body: JSON.stringify({ amount, bank_code: bank, account_number: account }),
      })
      setStage({ at: 'signing' })
      setStage({ at: 'done', cashOut: await cashOutNaira(quoted) })
    } catch (e) {
      setStage({ at: 'form' })
      setProblem(e instanceof Error ? e.message : 'The cash-out didn’t go through. Nothing moved.')
    }
  }

  if (stage.at === 'done') return <CashOutResult first={stage.cashOut} />

  if (info && !enabled)
    return (
      <div className="w-screen">
        <ScreenHead title="Cash out to naira" back="/wallet/cash-out" />
        <div className="w-empty w-empty-art">
          <Art name="kovi-sleep" size={112} />
          <strong>Naira isn’t on here yet</strong>
          <span>Cashing out to a Nigerian bank opens on this server soon.</span>
        </div>
      </div>
    )

  const busy = stage.at === 'quoting' || stage.at === 'signing'
  return (
    <div className="w-screen">
      <ScreenHead title="Cash out to naira" back="/wallet/cash-out" />
      <div className="w-add w-naira">
        <h1 className="w-title">Dollars to your bank</h1>
        <p className="w-lead">
          Any Nigerian bank account, in naira. The bank shows the name on the account before
          anything moves.
        </p>
        <div className="w-naira-form">
          <label className="w-naira-field">
            <span className="w-naira-label">Amount</span>
            <span className="w-naira-money">
              <span aria-hidden="true">$</span>
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => {
                  const next = e.target.value.replace(/[^\d.]/g, '')
                  if (next === '' || DOLLARS.test(next)) setAmount(next)
                }}
                aria-label="Amount in dollars"
              />
            </span>
            <span className={short ? 'w-naira-help w-naira-bad' : 'w-naira-help'}>
              {balance === null
                ? '…'
                : short
                  ? `You have ${formatUsd(balance)}`
                  : `Available ${formatUsd(balance)}`}
            </span>
          </label>
          <label className="w-naira-field">
            <span className="w-naira-label">Bank</span>
            <select value={bank} onChange={(e) => setBank(e.target.value)} aria-label="Bank">
              <option value="">{banks.length ? 'Choose your bank' : 'Loading banks…'}</option>
              {banks.map((b) => (
                <option key={`${b.code}-${b.name}`} value={b.code}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="w-naira-field">
            <span className="w-naira-label">Account number</span>
            <input
              inputMode="numeric"
              placeholder="10 digits"
              maxLength={10}
              value={account}
              onChange={(e) => setAccount(e.target.value.replace(/\D/g, '').slice(0, 10))}
              aria-label="Account number"
            />
            {named && 'name' in named ? (
              <span className="w-naira-named">
                <Icon name="check" size={14} /> {named.name}
              </span>
            ) : named && 'problem' in named ? (
              <span className="w-naira-help w-naira-bad">{named.problem}</span>
            ) : (
              <span className="w-naira-help">
                {bank && account.length === 10 ? 'Asking the bank…' : 'The bank names the account'}
              </span>
            )}
          </label>
        </div>
        <dl className="w-review-card">
          <div className="w-review-row">
            <dt>They get</dt>
            <dd>
              <strong>{quote ? quote.naira : '₦—'}</strong>
            </dd>
          </div>
          <div className="w-review-row">
            <dt>Rate</dt>
            <dd>
              {quote
                ? `${naira(Number(quote.rate))} per $1`
                : info?.cash_out_rate
                  ? `${naira(Number(info.cash_out_rate))} per $1`
                  : '…'}
            </dd>
          </div>
          <div className="w-review-row">
            <dt>Bank fee</dt>
            <dd>{quote ? quote.fee : info?.partner === 'paj' ? '₦0.00' : '₦10 to ₦50'}</dd>
          </div>
          <div className="w-review-row">
            <dt>Network fee</dt>
            <dd>$0.00, Kova pays it</dd>
          </div>
        </dl>
        <p className="w-fine w-center">
          {info?.partner === 'paj'
            ? 'PAJ’s rate today, less 0.1% for turning your AUSD into the USDC PAJ pays out. The quote holds for 15 minutes.'
            : `${info?.rate_source === 'chainlink' ? 'Chainlink rate on Monad, less 1%.' : 'Market rate, less 1%.'} The quote holds for 15 minutes. If the bank can’t take it, your dollars come back.`}
        </p>
        {problem ? <p className="form-error">{problem}</p> : null}
        <button
          type="button"
          className="pill pill-block"
          data-tone="coral"
          disabled={!ready || busy}
          onClick={() => void cashOut()}
        >
          <span className="pill-label">
            {stage.at === 'quoting'
              ? 'Locking the rate…'
              : stage.at === 'signing'
                ? 'Approve with your passkey…'
                : quote
                  ? `Cash out ${quote.naira}`
                  : 'Cash out'}
          </span>
          <span className="pill-cap">
            <Icon name="out" size={18} />
          </span>
        </button>
        <TestModeNote on={info?.test_mode} />
      </div>
    </div>
  )
}

/** How the cash-out went, following the bank until it's paid or the dollars are back. */
function CashOutResult({ first }: { first: CashOutToPay }) {
  const [cashOut, setCashOut] = useState(first)
  useEffect(() => {
    if (cashOut.status !== 'paying' && cashOut.status !== 'received') return
    const timer = setTimeout(() => {
      void json<CashOutToPay>(`/api/naira/cash-outs/${cashOut.id}`)
        .then(setCashOut)
        .catch(() => {})
    }, 3000)
    return () => clearTimeout(timer)
  }, [cashOut])

  const paid = cashOut.status === 'paid'
  const failed = cashOut.status === 'failed'
  return (
    <div className="w-screen w-moment">
      <Art
        name={failed ? 'kovi-oops' : paid ? 'kovi-cheer' : 'kovi-ride'}
        size={180}
        className="w-moment-art"
      />
      <h1 className="w-hero-title">
        {paid
          ? 'Sent to your bank.'
          : failed
            ? 'Your dollars came back.'
            : 'On its way to your bank.'}
      </h1>
      <p className="w-lead">
        {paid
          ? `${cashOut.naira} went to ${cashOut.bank_name} ····${cashOut.account_last4}.`
          : failed
            ? (cashOut.failure ?? 'The bank couldn’t take it.')
            : cashOut.partner === 'paj'
              ? `Your $${cashOut.amount} reached PAJ on Monad. PAJ is paying ${cashOut.naira} to ${cashOut.bank_name}.`
              : `Your $${cashOut.amount} reached Kova on Monad. Paystack is paying ${cashOut.naira} to ${cashOut.bank_name}.`}
      </p>
      <dl className="w-review-card">
        <div className="w-review-row">
          <dt>Naira</dt>
          <dd>
            <strong>{cashOut.naira}</strong>
          </dd>
        </div>
        <div className="w-review-row">
          <dt>To</dt>
          <dd>
            {cashOut.account_name ? `${cashOut.account_name}, ` : ''}
            {cashOut.bank_name} ····{cashOut.account_last4}
          </dd>
        </div>
        <div className="w-review-row">
          <dt>Dollars</dt>
          <dd>${cashOut.amount}</dd>
        </div>
        <div className="w-review-row">
          <dt>Rate</dt>
          <dd>{naira(Number(cashOut.rate))} per $1</dd>
        </div>
        {cashOut.tx_url ? (
          <div className="w-review-row">
            <dt>On Monad</dt>
            <dd>
              <a className="textlink" href={cashOut.tx_url} target="_blank" rel="noreferrer">
                See the transfer
              </a>
            </dd>
          </div>
        ) : null}
        {cashOut.refund_tx_url ? (
          <div className="w-review-row">
            <dt>Sent back</dt>
            <dd>
              <a className="textlink" href={cashOut.refund_tx_url} target="_blank" rel="noreferrer">
                See the refund
              </a>
            </dd>
          </div>
        ) : null}
      </dl>
      <TestModeNote on={cashOut.test_mode} />
      <div className="w-moment-actions">
        <Link href="/wallet" className="pill pill-block" data-tone="ink">
          <span className="pill-label">Back to home</span>
          <span className="pill-cap">
            <Icon name="home" size={18} />
          </span>
        </Link>
      </div>
    </div>
  )
}

// ── Add money in naira ──────────────────────────────────────────────────────────────────────

const EMAIL_KEY = 'kova.web.naira.email.v1'

export function NairaTopUp({ reference }: { reference: string | null }) {
  const { profile } = useWallet()
  const info = useNaira()
  const [amount, setAmount] = useState('10')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const enabled = info?.enabled === true
  const quote = useQuote(amount, 'in', enabled)

  useEffect(() => {
    try {
      setEmail(localStorage.getItem(EMAIL_KEY) ?? '')
    } catch {
      // No storage: the field starts empty.
    }
  }, [])

  if (reference) return <TopUpReturn reference={reference} />

  if (info && !enabled)
    return (
      <div className="w-screen">
        <ScreenHead title="Add naira" back="/wallet/add" />
        <div className="w-empty w-empty-art">
          <Art name="kovi-sleep" size={112} />
          <strong>Naira isn’t on here yet</strong>
          <span>Adding money from a Nigerian bank opens on this server soon.</span>
        </div>
      </div>
    )

  const paj = info?.partner === 'paj'
  const ok =
    DOLLARS.test(amount) &&
    Number(amount) >= 1 &&
    Number(amount) <= 500 &&
    (paj || /.+@.+\..+/.test(email))
  const start = async () => {
    if (!profile || !ok) return
    setBusy(true)
    setProblem(null)
    try {
      try {
        localStorage.setItem(EMAIL_KEY, email)
      } catch {
        // Not remembered; fine.
      }
      const started = await json<TopUp & { url: string }>(
        `/api/naira/wallets/${profile.address}/naira-top-ups`,
        {
          method: 'POST',
          body: JSON.stringify({
            amount,
            ...(email ? { email } : {}),
            return_url: `${window.location.origin}/wallet/add/naira`,
          }),
        },
      )
      window.location.assign(started.url)
    } catch (e) {
      setBusy(false)
      setProblem(
        e instanceof Error
          ? e.message
          : `${partnerName(info?.partner)} didn’t open. Nothing was charged.`,
      )
    }
  }

  return (
    <div className="w-screen">
      <ScreenHead title="Add naira" back="/wallet/add" />
      <div className="w-add w-naira">
        <Art name="kovi-catch" size={96} className="w-add-art" />
        <h1 className="w-title">From your bank, in naira</h1>
        <p className="w-lead">
          {paj
            ? 'Send naira by bank transfer from any Nigerian bank. The dollars land in this wallet as soon as the transfer arrives.'
            : 'Pay naira by bank transfer, card or USSD with Paystack. The dollars land in this wallet as soon as Paystack confirms it.'}
        </p>
        <div className="w-naira-form">
          <label className="w-naira-field">
            <span className="w-naira-label">You get</span>
            <span className="w-naira-money">
              <span aria-hidden="true">$</span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  const next = e.target.value.replace(/[^\d.]/g, '')
                  if (next === '' || DOLLARS.test(next)) setAmount(next)
                }}
                aria-label="Dollars you get"
              />
            </span>
            <span className="w-naira-help">Between $1 and $500</span>
          </label>
          {paj ? null : (
            <label className="w-naira-field">
              <span className="w-naira-label">Email for Paystack’s receipt</span>
              <input
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value.trim())}
                aria-label="Email"
              />
            </label>
          )}
        </div>
        <dl className="w-review-card">
          <div className="w-review-row">
            <dt>You pay</dt>
            <dd>
              <strong>{quote ? quote.naira : '₦—'}</strong>
            </dd>
          </div>
          <div className="w-review-row">
            <dt>Rate</dt>
            <dd>{quote ? `${naira(Number(quote.rate))} per $1` : '…'}</dd>
          </div>
          <div className="w-review-row">
            <dt>{paj ? 'Fee' : 'Paystack’s fee'}</dt>
            <dd>{paj ? 'In the rate' : quote ? `${quote.fee}, included` : '…'}</dd>
          </div>
          <div className="w-review-row">
            <dt>Arrives</dt>
            <dd>{paj ? 'Once your transfer lands, on Monad' : 'In seconds, on Monad'}</dd>
          </div>
        </dl>
        {problem ? <p className="form-error">{problem}</p> : null}
        <button
          type="button"
          className="pill pill-block"
          data-tone="coral"
          disabled={!ok || !quote || busy}
          onClick={() => void start()}
        >
          <span className="pill-label">
            {busy
              ? paj
                ? 'Opening an account for you…'
                : 'Opening Paystack…'
              : quote
                ? `Pay ${quote.naira}`
                : `Pay with ${partnerName(info?.partner)}`}
          </span>
          <span className="pill-cap">
            <Icon name="arrow" size={18} />
          </span>
        </button>
        <TestModeNote on={info?.test_mode} />
      </div>
    </div>
  )
}

/** Back from paying: Kova checks the payment, and the dollars land. */
function TopUpReturn({ reference }: { reference: string }) {
  const { profile, refresh } = useWallet()
  const [topUp, setTopUp] = useState<TopUp | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const tries = useRef(0)

  const verify = useCallback(async () => {
    try {
      const checked = await json<TopUp>(`/api/naira/naira-top-ups/${reference}/verify`, {
        method: 'POST',
      })
      setTopUp(checked)
      if (checked.status === 'settled' && profile) void refresh()
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Kova couldn’t check the payment yet.')
    }
  }, [profile, reference, refresh])

  useEffect(() => {
    void verify()
  }, [verify])

  useEffect(() => {
    if (!topUp || (topUp.status !== 'initialized' && topUp.status !== 'paid') || tries.current > 20)
      return
    const timer = setTimeout(() => {
      tries.current += 1
      void verify()
    }, 3000)
    return () => clearTimeout(timer)
  }, [topUp, verify])

  const settled = topUp?.status === 'settled'
  const failed = topUp?.status === 'failed'
  return (
    <div className="w-screen w-moment">
      <Art
        name={settled ? 'scene-coin-rain' : failed ? 'kovi-oops' : 'kovi-ride'}
        size={settled ? 220 : 180}
        className="w-moment-art"
      />
      <h1 className="w-hero-title">
        {settled
          ? 'Money’s in.'
          : failed
            ? 'The payment didn’t go through.'
            : 'Checking your payment…'}
      </h1>
      <p className="w-lead">
        {settled
          ? `$${topUp?.amount} landed in your wallet, for ${topUp?.naira}.`
          : failed
            ? (topUp?.failure ?? 'No naira was taken. Try again.')
            : (topUp?.failure ?? 'As soon as your naira arrives, the dollars land here.')}
      </p>
      {topUp ? (
        <dl className="w-review-card">
          <div className="w-review-row">
            <dt>You paid</dt>
            <dd>{topUp.naira}</dd>
          </div>
          <div className="w-review-row">
            <dt>You got</dt>
            <dd>
              <strong>${topUp.amount}</strong>
            </dd>
          </div>
          {topUp.tx_url ? (
            <div className="w-review-row">
              <dt>On Monad</dt>
              <dd>
                <a className="textlink" href={topUp.tx_url} target="_blank" rel="noreferrer">
                  See the transfer
                </a>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {problem ? <p className="form-error">{problem}</p> : null}
      <TestModeNote on={topUp?.test_mode} />
      <div className="w-moment-actions">
        <Link href="/wallet" className="pill pill-block" data-tone="ink">
          <span className="pill-label">Back to home</span>
          <span className="pill-cap">
            <Icon name="home" size={18} />
          </span>
        </Link>
      </div>
    </div>
  )
}

// ── Paying PAJ's account ────────────────────────────────────────────────────────────────────

/**
 * Where a PAJ top-up sends the payer (/naira/pay/:reference): the bank account PAJ opened for this
 * one payment, exactly what to send it, and the payment followed until the dollars land. It needs
 * no wallet, so it works in the app's in-app browser too.
 */
export function NairaTransfer({ reference }: { reference: string }) {
  const [topUp, setTopUp] = useState<TopUp | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const check = useCallback(async () => {
    try {
      setTopUp(
        await json<TopUp>(`/api/naira/naira-top-ups/${reference}/verify`, { method: 'POST' }),
      )
      setProblem(null)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Kova couldn’t find this payment.')
    }
  }, [reference])

  useEffect(() => {
    void check()
  }, [check])

  // PAJ keeps the account open for days: follow the payment for as long as the page is open.
  useEffect(() => {
    if (!topUp || topUp.status === 'settled' || topUp.status === 'failed') return
    const timer = setTimeout(() => void check(), 5000)
    return () => clearTimeout(timer)
  }, [topUp, check])

  const back = topUp?.return_url ? `${topUp.return_url}?reference=${reference}` : '/wallet'

  if (!topUp)
    return (
      <div className="w-screen w-moment">
        <Art name={problem ? 'kovi-oops' : 'kovi-ride'} size={160} className="w-moment-art" />
        <h1 className="w-hero-title">{problem ? 'No such payment.' : 'Opening your payment…'}</h1>
        {problem ? <p className="w-lead">{problem}</p> : null}
      </div>
    )

  if (topUp.status === 'settled' || topUp.status === 'failed') {
    const settled = topUp.status === 'settled'
    return (
      <div className="w-screen w-moment">
        <Art
          name={settled ? 'scene-coin-rain' : 'kovi-oops'}
          size={settled ? 220 : 180}
          className="w-moment-art"
        />
        <h1 className="w-hero-title">
          {settled ? 'Money’s in.' : 'The payment didn’t go through.'}
        </h1>
        <p className="w-lead">
          {settled
            ? `$${topUp.amount} landed in your Kova wallet, for ${topUp.naira}.`
            : (topUp.failure ?? 'No naira was taken.')}
        </p>
        {settled && topUp.tx_url ? (
          <dl className="w-review-card">
            <div className="w-review-row">
              <dt>On Monad</dt>
              <dd>
                <a className="textlink" href={topUp.tx_url} target="_blank" rel="noreferrer">
                  See the transfer
                </a>
              </dd>
            </div>
          </dl>
        ) : null}
        <div className="w-moment-actions">
          <a href={back} className="pill pill-block" data-tone="ink">
            <span className="pill-label">Back to Kova</span>
            <span className="pill-cap">
              <Icon name="home" size={18} />
            </span>
          </a>
        </div>
        <p className="w-fine w-center">In the Kova app? Close this page.</p>
      </div>
    )
  }

  const transfer = topUp.bank_transfer
  const received = topUp.status === 'paid'
  return (
    <div className="w-screen">
      <div className="w-add w-naira w-naira-pay">
        <Art name="kovi-catch" size={96} className="w-add-art" />
        <h1 className="w-title">Send {transfer?.naira ?? topUp.naira}</h1>
        <p className="w-lead">
          From any Nigerian bank app, to this account. It’s open for this payment only, and $
          {topUp.amount} lands in your Kova wallet when your naira arrives.
        </p>
        {transfer ? (
          <dl className="w-review-card">
            <div className="w-review-row">
              <dt>Account number</dt>
              <dd className="w-naira-copyable">
                <strong>{transfer.account_number}</strong>
                <CopyButton text={transfer.account_number} />
              </dd>
            </div>
            <div className="w-review-row">
              <dt>Bank</dt>
              <dd>{transfer.bank_name ?? '—'}</dd>
            </div>
            <div className="w-review-row">
              <dt>Name</dt>
              <dd>{transfer.account_name ?? '—'}</dd>
            </div>
            <div className="w-review-row">
              <dt>Amount</dt>
              <dd className="w-naira-copyable">
                <strong>{transfer.naira}</strong>
                <CopyButton text={transfer.naira.replace(/[₦,]/g, '')} />
              </dd>
            </div>
          </dl>
        ) : null}
        <p className="w-naira-wait" aria-live="polite">
          <span className="w-naira-pulse" aria-hidden="true" />
          {received ? 'Naira received. Your dollars are on the way…' : 'Waiting for your transfer…'}
        </p>
        <p className="w-fine w-center">
          Send exactly this amount, once. PAJ, Kova’s naira partner, receives it and sends the
          dollars to your wallet on Monad.
        </p>
        {problem ? <p className="form-error">{problem}</p> : null}
        <a href={back} className="pill pill-block" data-tone="ink">
          <span className="pill-label">I’ve sent it</span>
          <span className="pill-cap">
            <Icon name="arrow" size={18} />
          </span>
        </a>
      </div>
    </div>
  )
}

/** The row on Add money and Cash out that opens naira. */
export function NairaRow({
  href,
  title,
  detail,
  pajDetail,
}: {
  href: string
  title: string
  detail: string
  /** What the row says when PAJ moves the naira. */
  pajDetail: string
}) {
  const info = useNaira()
  if (!info?.enabled) return null
  return (
    <Link href={href} className="w-add-chain">
      <span>
        <strong>{title}</strong>
        <small>{info.partner === 'paj' ? pajDetail : detail}</small>
      </span>
      <Icon name="arrow" size={18} />
    </Link>
  )
}
