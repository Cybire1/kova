'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Art, Icon } from '@/components/brand'
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

export async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const body = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `Kova didn’t answer (${response.status}).`)
  return body
}

/** Naira, as people read it: ₦1,376.55. */
export const nairaText = (n: number) =>
  `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const DOLLARS = /^\d{1,7}(\.\d{0,2})?$/

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

export function useQuote(amount: string, direction: 'in' | 'out', enabled: boolean) {
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
            <dd>{quote ? `${nairaText(Number(quote.rate))} per $1` : '…'}</dd>
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
