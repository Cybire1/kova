'use client'

import { bankDisplayName, POPULAR_BANKS, parseAmount, suggestBanks } from '@kova/monad'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Art, Icon } from '@/components/brand'
import type { CashOutToPay } from '@/lib/wallet/chain'
import { formatUsd } from '@/lib/wallet/money'
import { DOLLARS, json, nairaText, useNaira, useQuote } from './naira'
import { useWallet } from './provider'

/**
 * Cashing out to naira (the API's services/naira.ts, through PAJ), in five steps: how much; who
 * gets it (the account number first, then the banks it could belong to, with their logos, and the
 * bank names the account); check and send, with the passkey; each step live while PAJ pays; and the
 * receipt. The iPhone app's cash-out is the same flow.
 */

interface Bank {
  name: string
  code: string
  logo?: string | null
}

/** Someone this browser cashed out to before, kept here only. */
interface Recent {
  name: string
  bankCode: string
  bankName: string
  accountNumber: string
  logo?: string | null
}

type Step = 'amount' | 'recipient' | 'review' | 'sending' | 'done'

type Check =
  | { code: string; state: 'checking' }
  | { code: string; state: 'named'; name: string }
  | { code: string; state: 'missed'; why: string }

const RECENTS = 'kova.web.naira.recents.v1'

function readRecents(): Recent[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENTS) ?? '[]') as Recent[]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function keepRecent(recent: Recent) {
  try {
    const rest = readRecents().filter(
      (r) => !(r.bankCode === recent.bankCode && r.accountNumber === recent.accountNumber),
    )
    localStorage.setItem(RECENTS, JSON.stringify([recent, ...rest].slice(0, 5)))
  } catch {
    // Not remembered on this browser; the cash-out itself is unaffected.
  }
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())
const initials = (s: string) =>
  s
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
const spaced = (n: string) => `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`
const grouped = (n: string) =>
  [n.slice(0, 3), n.slice(3, 6), n.slice(6, 10)].filter(Boolean).join(' ')

export function NairaCashOut() {
  const { profile, balance, cashOutNaira } = useWallet()
  const info = useNaira()
  const enabled = info?.enabled === true
  const [step, setStep] = useState<Step>('amount')
  const [amount, setAmount] = useState('')
  const estimate = useQuote(amount, 'out', enabled)
  const [banks, setBanks] = useState<Bank[]>([])
  const [recents, setRecents] = useState<Recent[]>([])
  const [account, setAccount] = useState('')
  const [bank, setBank] = useState<Bank | null>(null)
  const [check, setCheck] = useState<Check | null>(null)
  const [sheet, setSheet] = useState(false)
  const [cashOut, setCashOut] = useState<CashOutToPay | null>(null)
  const [save, setSave] = useState(true)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [took, setTook] = useState<number | null>(null)
  const sentAt = useRef(0)

  useEffect(() => setRecents(readRecents()), [])

  useEffect(() => {
    if (!enabled) return
    void json<{ data: Bank[] }>('/api/naira/naira/banks')
      .then((r) => setBanks(r.data))
      .catch(() => setBanks([]))
  }, [enabled])

  const units = useMemo(() => {
    try {
      return DOLLARS.test(amount) ? parseAmount(amount) : 0n
    } catch {
      return 0n
    }
  }, [amount])
  const short = balance !== null && units > balance
  const amountOk = units >= 1_000_000n && units <= 500_000_000n && !short
  const suggestions = useMemo(() => suggestBanks(account, banks, 5), [account, banks])
  const named = check?.state === 'named' ? check : null
  const logoOf = (code: string | undefined) => banks.find((b) => b.code === code)?.logo ?? null

  const checkName = useCallback(async (picked: Bank, number: string) => {
    setBank(picked)
    setCheck({ code: picked.code, state: 'checking' })
    setProblem(null)
    try {
      const r = await json<{ account_name: string }>('/api/naira/naira/account', {
        method: 'POST',
        body: JSON.stringify({ account_number: number, bank_code: picked.code }),
      })
      setCheck({ code: picked.code, state: 'named', name: r.account_name })
    } catch (e) {
      setCheck({
        code: picked.code,
        state: 'missed',
        why: /match|account/i.test(e instanceof Error ? e.message : '')
          ? 'No account with this number here'
          : e instanceof Error
            ? e.message
            : 'The bank didn’t answer. Try again.',
      })
    }
  }, [])

  const typeAccount = (value: string) => {
    setAccount(value.replace(/\D/g, '').slice(0, 10))
    setBank(null)
    setCheck(null)
  }

  const quote = async () => {
    if (!profile || !bank || !named) return
    setBusy(true)
    setProblem(null)
    try {
      setCashOut(
        await json<CashOutToPay>(`/api/naira/wallets/${profile.address}/cash-outs`, {
          method: 'POST',
          body: JSON.stringify({ amount, bank_code: bank.code, account_number: account }),
        }),
      )
      setStep('review')
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Kova couldn’t get a quote. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const send = async () => {
    if (!cashOut || !bank || !named) return
    setBusy(true)
    setProblem(null)
    sentAt.current = Date.now()
    try {
      const sent = await cashOutNaira(cashOut)
      if (save)
        keepRecent({
          name: named.name,
          bankCode: bank.code,
          bankName: bankDisplayName(bank),
          accountNumber: account,
          logo: bank.logo ?? null,
        })
      setCashOut(sent)
      setStep(sent.status === 'paid' || sent.status === 'failed' ? 'done' : 'sending')
      if (sent.status === 'paid') setTook(Date.now() - sentAt.current)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'It didn’t go through. Nothing moved.'
      if (!/cancel/i.test(message)) setProblem(message)
    } finally {
      setBusy(false)
    }
  }

  // Follow it until the bank is paid: PAJ pays as soon as the USDC reaches it.
  useEffect(() => {
    if (step !== 'sending' || !cashOut) return
    if (cashOut.status === 'paid') {
      setTook(Date.now() - sentAt.current)
      setStep('done')
      return
    }
    if (cashOut.status === 'failed') {
      setStep('done')
      return
    }
    const timer = setTimeout(() => {
      void json<CashOutToPay>(`/api/naira/cash-outs/${cashOut.id}`)
        .then(setCashOut)
        .catch(() => setCashOut({ ...cashOut }))
    }, 3000)
    return () => clearTimeout(timer)
  }, [step, cashOut])

  if (info && !enabled)
    return (
      <div className="w-screen">
        <Head title="Cash out to naira" href="/wallet/cash-out" />
        <div className="w-empty w-empty-art">
          <Art name="kovi-sleep" size={112} />
          <strong>Naira isn’t on here yet</strong>
          <span>Cashing out to a Nigerian bank opens on this server soon.</span>
        </div>
      </div>
    )

  const bankName = bank ? bankDisplayName(bank) : ''
  const who = named?.name ?? cashOut?.account_name ?? ''

  if (step === 'done' && cashOut)
    return (
      <Done
        cashOut={cashOut}
        bankName={bankName || cashOut.bank_name}
        logo={bank?.logo ?? logoOf(cashOut.bank_code)}
        who={who}
        took={took}
      />
    )

  if (step === 'sending' && cashOut)
    return (
      <div className="w-screen cx-moment">
        <Art name="kovi-ride" size={136} className="cx-ride" />
        <p className="cx-moment-label">On its way to {titleCase(who)}</p>
        <strong className="cx-moment-amount">{cashOut.naira}</strong>
        <span className="cx-moment-to">
          <BankLogo logo={bank?.logo} name={bankName} size={22} />
          {bankName} · {spaced(account)}
        </span>
        <ol className="cx-steps" aria-live="polite">
          <StepRow
            state={cashOut.tx_hash ? 'done' : 'active'}
            title="Left your wallet"
            detail={`$${cashOut.amount} on Monad`}
          />
          <StepRow
            state={cashOut.tx_hash ? 'done' : 'waiting'}
            title="PAJ has it"
            detail="Turned into USDC and paid to PAJ"
          />
          <StepRow
            state={cashOut.tx_hash ? 'active' : 'waiting'}
            title={`${bankName} is paying ${titleCase(who)}`}
            detail="Usually a few seconds"
          />
          <StepRow
            state="waiting"
            title={`In ${titleCase(who)}’s account`}
            detail={cashOut.naira}
            last
          />
        </ol>
        <p className="cx-fine">
          You can close this. It keeps going, and it shows in your activity.
        </p>
        <Link href="/wallet" className="cx-line-button">
          Close
        </Link>
      </div>
    )

  if (step === 'review' && cashOut)
    return (
      <div className="w-screen">
        <Head title="Check and send" onBack={() => setStep('recipient')} />
        <div className="cx">
          <section className="cx-hero">
            <span className="cx-hero-who">
              <Avatar name={who} logo={bank?.logo} size={46} />
              <span>
                <strong>{titleCase(who)}</strong>
                <small>
                  {bankName} · {spaced(account)}
                </small>
              </span>
            </span>
            <span className="cx-hero-label">They get</span>
            <strong className="cx-hero-amount">{cashOut.naira}</strong>
            {/* biome-ignore lint/performance/noImgElement: pre-sized WebP art, no optimizer needed */}
            <img className="cx-hero-coin" src="/art/coin-ngn.webp" alt="" />
          </section>
          <dl className="w-review-card">
            <div className="w-review-row">
              <dt>You send</dt>
              <dd>${cashOut.amount}</dd>
            </div>
            <div className="w-review-row">
              <dt>Rate</dt>
              <dd>{nairaText(Number(cashOut.rate))} per $1</dd>
            </div>
            <div className="w-review-row">
              <dt>Fees</dt>
              <dd>{cashOut.fee === '₦0.00' ? 'None' : cashOut.fee}</dd>
            </div>
            <div className="w-review-row">
              <dt>Arrives</dt>
              <dd>In seconds</dd>
            </div>
          </dl>
          <label className="cx-save">
            <input type="checkbox" checked={save} onChange={() => setSave(!save)} />
            Save {titleCase(who)} for next time
          </label>
          <p className="cx-fine">
            PAJ, Kova’s naira partner, pays {bankName} as soon as your dollars reach it on Monad.
            The quote holds for 15 minutes.
          </p>
          {problem ? <p className="form-error">{problem}</p> : null}
          <button
            type="button"
            className="pill pill-block"
            data-tone="coral"
            disabled={busy}
            onClick={() => void send()}
          >
            <span className="pill-label">
              {busy ? 'Approve with your passkey…' : `Send ${cashOut.naira}`}
            </span>
            <span className="pill-cap">
              <Icon name="face" size={20} />
            </span>
          </button>
          <p className="cx-fine">Your passkey approves it. Kova pays the network fee.</p>
        </div>
      </div>
    )

  if (step === 'recipient')
    return (
      <div className="w-screen">
        <Head title="Who gets it?" onBack={() => setStep('amount')} />
        <div className="cx">
          <p className="cx-sub">
            ${amount} → {estimate?.naira ?? '…'}
          </p>
          {recents.length ? (
            <>
              <span className="cx-label">Recent</span>
              <div className="cx-recents">
                {recents.map((r) => (
                  <button
                    type="button"
                    key={`${r.bankCode}-${r.accountNumber}`}
                    className="cx-recent"
                    onClick={() => {
                      setAccount(r.accountNumber)
                      const known = banks.find((b) => b.code === r.bankCode)
                      void checkName(
                        known ?? { name: r.bankName, code: r.bankCode, logo: r.logo },
                        r.accountNumber,
                      )
                    }}
                  >
                    <Avatar name={r.name} logo={r.logo} size={30} />
                    <span>
                      <strong>{titleCase(r.name)}</strong>
                      <small>
                        {r.bankName} ••{r.accountNumber.slice(-4)}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
          <label className="cx-label" htmlFor="cx-account">
            Account number
          </label>
          <div className="cx-field">
            <input
              id="cx-account"
              inputMode="numeric"
              autoComplete="off"
              placeholder="10 digits"
              value={grouped(account)}
              onChange={(e) => {
                typeAccount(e.target.value)
                // The tenth digit closes the keyboard, so the banks below are in view.
                if (e.target.value.replace(/\D/g, '').length >= 10) e.target.blur()
              }}
            />
            <span>{account.length < 10 ? `${account.length}/10` : ''}</span>
          </div>
          {account.length < 10 ? (
            <p className="cx-hint">Type all 10 digits and Kova suggests the bank.</p>
          ) : (
            <>
              <span className="cx-label">Their bank</span>
              <div className="cx-tiles">
                {suggestions.map((s) => (
                  <BankTile
                    key={s.bank.code}
                    bank={s.bank}
                    fits={s.reason === 'fits'}
                    check={check?.code === s.bank.code ? check : null}
                    onPick={() => void checkName(s.bank, account)}
                  />
                ))}
                {bank && check && !suggestions.some((s) => s.bank.code === bank.code) ? (
                  <BankTile
                    bank={bank}
                    check={check.code === bank.code ? check : null}
                    onPick={() => void checkName(bank, account)}
                  />
                ) : (
                  <button type="button" className="cx-tile" onClick={() => setSheet(true)}>
                    <span className="cx-tile-logo cx-tile-other">
                      <Icon name="search" size={18} />
                    </span>
                    <span className="cx-tile-name">Other bank</span>
                  </button>
                )}
              </div>
            </>
          )}
          {named ? (
            <div className="cx-named" role="status">
              <span className="cx-named-tick">
                <Icon name="check" size={14} />
              </span>
              <span>
                <strong>{named.name}</strong>
                <small>confirmed by {bankName}</small>
              </span>
            </div>
          ) : null}
          {problem ? <p className="form-error">{problem}</p> : null}
          <button
            type="button"
            className="pill pill-block cx-go"
            data-tone="ink"
            disabled={!named || busy}
            onClick={() => void quote()}
          >
            <span className="pill-label">
              {busy ? 'Getting your quote…' : named ? 'Continue' : 'Pick their bank'}
            </span>
            <span className="pill-cap">
              <Icon name="arrow" size={18} />
            </span>
          </button>
        </div>
        {sheet ? (
          <BankSheet
            banks={banks}
            onClose={() => setSheet(false)}
            onPick={(b) => {
              setSheet(false)
              void checkName(b, account)
            }}
          />
        ) : null}
      </div>
    )

  const max = balance === null ? null : Math.min(Number(balance) / 1e6, 500)
  return (
    <div className="w-screen">
      <Head title="Cash out to naira" href="/wallet/cash-out" />
      <div className="cx">
        <div className="cx-amount">
          <span className="cx-amount-label">You send</span>
          <label className="cx-big">
            <span aria-hidden="true">$</span>
            <input
              inputMode="decimal"
              placeholder="0"
              value={amount}
              style={{ width: `${Math.max(1, amount.length) + 0.3}ch` }}
              aria-label="Dollars to cash out"
              onChange={(e) => {
                const next = e.target.value.replace(/[^\d.]/g, '')
                if (next === '' || DOLLARS.test(next)) setAmount(next)
              }}
            />
          </label>
          <span className="cx-get">
            {/* biome-ignore lint/performance/noImgElement: pre-sized WebP art, no optimizer needed */}
            <img src="/art/coin-ngn.webp" alt="" />
            They get <strong>{estimate?.naira ?? '₦0.00'}</strong>
          </span>
        </div>
        <div className="cx-chips">
          <span className={short ? 'cx-chip cx-chip-bad' : 'cx-chip'}>
            {balance === null
              ? '…'
              : short
                ? `You have ${formatUsd(balance)}`
                : `Available ${formatUsd(balance)}`}
          </span>
          {max !== null && max >= 1 ? (
            <button
              type="button"
              className="cx-chip cx-chip-line"
              onClick={() => setAmount((Math.floor(max * 100) / 100).toFixed(2))}
            >
              Max
            </button>
          ) : null}
        </div>
        <p className="cx-rate">
          {info?.cash_out_rate ? `${nairaText(Number(info.cash_out_rate))} per $1 · ` : ''}No fees ·
          Lands in seconds
        </p>
        <button
          type="button"
          className="pill pill-block cx-go"
          data-tone="ink"
          disabled={!amountOk || !estimate}
          onClick={() => setStep('recipient')}
        >
          <span className="pill-label">Continue</span>
          <span className="pill-cap">
            <Icon name="arrow" size={18} />
          </span>
        </button>
      </div>
    </div>
  )
}

/** The screen's head: back to a page, or a step back in the flow. */
function Head({ title, href, onBack }: { title: string; href?: string; onBack?: () => void }) {
  return (
    <div className="w-head">
      {onBack ? (
        <button type="button" className="round" aria-label="Back" onClick={onBack}>
          <Icon name="back" size={18} />
        </button>
      ) : (
        <Link href={href ?? '/wallet'} className="round" aria-label="Back">
          <Icon name="back" size={18} />
        </Link>
      )}
      <h1>{title}</h1>
    </div>
  )
}

function BankLogo({ logo, name, size }: { logo?: string | null; name: string; size: number }) {
  return logo ? (
    // biome-ignore lint/performance/noImgElement: a bank's small logo from PAJ's list, shown as it comes
    <img className="cx-logo" src={logo} alt="" width={size} height={size} />
  ) : (
    <span className="cx-logo cx-logo-none" style={{ width: size, height: size }} aria-hidden="true">
      {initials(name)}
    </span>
  )
}

/** A person: their initials, with their bank's logo as a badge. */
function Avatar({ name, logo, size }: { name: string; logo?: string | null; size: number }) {
  return (
    <span className="cx-avatar" style={{ width: size, height: size }}>
      <span className="cx-avatar-face">{initials(name) || '?'}</span>
      {logo ? (
        // biome-ignore lint/performance/noImgElement: a bank's small logo from PAJ's list, shown as it comes
        <img className="cx-avatar-bank" src={logo} alt="" />
      ) : null}
    </span>
  )
}

/** A bank to pick: its logo and name; while the bank answers, a spinner; then a tick or "No account". */
function BankTile({
  bank,
  fits,
  check,
  onPick,
}: {
  bank: Bank
  fits?: boolean
  check: Check | null
  onPick: () => void
}) {
  const name = bankDisplayName(bank)
  return (
    <button
      type="button"
      className="cx-tile"
      data-state={check?.state ?? 'idle'}
      aria-pressed={check?.state === 'named'}
      aria-label={
        check?.state === 'missed'
          ? `${name}: no account with this number`
          : `${name}${fits ? ', number fits' : ''}`
      }
      disabled={check?.state === 'checking'}
      onClick={onPick}
    >
      <span className="cx-tile-logo">
        <BankLogo logo={bank.logo} name={name} size={36} />
        {check?.state === 'checking' ? (
          <span className="spinner cx-tile-spin" aria-hidden="true" />
        ) : null}
        {check?.state === 'named' ? (
          <span className="cx-tile-tick" aria-hidden="true">
            <Icon name="check" size={11} />
          </span>
        ) : null}
      </span>
      <span className="cx-tile-name">{name}</span>
      {check?.state === 'missed' ? (
        <small className="cx-tile-note cx-bad">No account</small>
      ) : fits ? (
        <small className="cx-tile-note">Fits</small>
      ) : null}
    </button>
  )
}

/** Any bank: search, the most used ones first, then all of them A to Z. */
function BankSheet({
  banks,
  onPick,
  onClose,
}: {
  banks: Bank[]
  onPick: (bank: Bank) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const popular = POPULAR_BANKS.slice(0, 8)
    .map((code) => banks.find((b) => b.code === code))
    .filter((b): b is Bank => Boolean(b))
  const all = useMemo(
    () =>
      banks
        .map((b) => ({ bank: b, name: bankDisplayName(b) }))
        .sort((a, b) => {
          const digit = (n: string) => /^\d/.test(n)
          return digit(a.name) === digit(b.name)
            ? a.name.localeCompare(b.name)
            : digit(a.name)
              ? 1
              : -1
        }),
    [banks],
  )
  const matches = q ? all.filter((b) => b.name.toLowerCase().includes(q)) : all

  return (
    <div className="cx-sheet-wrap" role="dialog" aria-modal="true" aria-label="Choose their bank">
      <button type="button" className="cx-sheet-shade" aria-label="Close" onClick={onClose} />
      <div className="cx-sheet">
        <span className="cx-grip" aria-hidden="true" />
        <div className="cx-sheet-head">
          <strong>Choose their bank</strong>
          <button type="button" className="round" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <label className="cx-search">
          <Icon name="search" size={18} />
          <input
            placeholder={`Search ${banks.length} banks`}
            value={query}
            autoComplete="off"
            aria-label="Search banks"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {q ? null : (
          <>
            <span className="cx-label">Most used</span>
            <div className="cx-popular">
              {popular.map((b) => (
                <button type="button" key={b.code} className="cx-pop" onClick={() => onPick(b)}>
                  <BankLogo logo={b.logo} name={bankDisplayName(b)} size={40} />
                  <span className="cx-pop-name">{bankDisplayName(b)}</span>
                </button>
              ))}
            </div>
            <span className="cx-label">All banks, A to Z</span>
          </>
        )}
        <div className="cx-all">
          {matches.map(({ bank, name }) => (
            <button
              type="button"
              key={bank.code}
              className="cx-all-row"
              onClick={() => onPick(bank)}
            >
              <BankLogo logo={bank.logo} name={name} size={30} />
              <span className="cx-all-name">{name}</span>
              <Icon name="chevron" size={16} />
            </button>
          ))}
          {matches.length === 0 ? (
            <p className="cx-hint">No bank by that name. Try its short name, like GTBank.</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function StepRow({
  state,
  title,
  detail,
  last,
}: {
  state: 'done' | 'active' | 'waiting'
  title: string
  detail: string
  last?: boolean
}) {
  return (
    <li className="cx-step" data-state={state}>
      <span className="cx-step-mark" aria-hidden="true">
        {state === 'done' ? <Icon name="check" size={14} /> : null}
        {last ? null : <span className="cx-step-line" />}
      </span>
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
    </li>
  )
}

/** In their account: the moment, then the receipt to keep or send. */
function Done({
  cashOut,
  bankName,
  logo,
  who,
  took,
}: {
  cashOut: CashOutToPay
  bankName: string
  logo?: string | null
  who: string
  took: number | null
}) {
  const [shared, setShared] = useState<string | null>(null)
  if (cashOut.status === 'failed')
    return (
      <div className="w-screen cx-moment">
        <Art name="kovi-oops" size={136} className="cx-ride" />
        <strong className="cx-moment-title">It didn’t go through</strong>
        <p className="cx-fine">{cashOut.failure ?? 'Nothing moved. Try again.'}</p>
        <Link href="/wallet" className="pill pill-block" data-tone="ink">
          <span className="pill-label">Done</span>
          <span className="pill-cap">
            <Icon name="home" size={18} />
          </span>
        </Link>
      </div>
    )

  const reference = cashOut.id.slice(0, 8).toUpperCase()
  const receipt = [
    `${cashOut.naira} sent to ${titleCase(who)}, ${bankName} ••${cashOut.account_last4}`,
    `$${cashOut.amount} at ${nairaText(Number(cashOut.rate))} per $1, with Kova`,
    `Reference ${reference}`,
    cashOut.tx_url ? `On Monad: ${cashOut.tx_url}` : '',
  ]
    .filter(Boolean)
    .join('\n')
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Kova receipt', text: receipt })
      else {
        await navigator.clipboard.writeText(receipt)
        setShared('Receipt copied')
      }
    } catch {
      // Closed the share sheet: nothing to do.
    }
  }

  return (
    <div className="w-screen cx-moment cx-done">
      <span className="cx-confetti" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="cx-cheer">
        <Art name="kovi-cheer" size={124} />
        <span className="cx-cheer-tick" aria-hidden="true">
          <Icon name="check" size={22} />
        </span>
      </span>
      <strong className="cx-done-amount">{cashOut.naira}</strong>
      <span className="cx-done-where">
        is in {titleCase(who)}’s
        <BankLogo logo={logo} name={bankName} size={28} />
        {bankName} account
      </span>
      {took !== null ? (
        <span className="cx-took">Done in {Math.max(1, Math.round(took / 1000))} seconds</span>
      ) : null}
      <dl className="w-review-card cx-receipt">
        <div className="w-review-row">
          <dt>To</dt>
          <dd>
            {titleCase(who)} · {bankName} ••{cashOut.account_last4}
          </dd>
        </div>
        <div className="w-review-row">
          <dt>You sent</dt>
          <dd>${cashOut.amount}</dd>
        </div>
        <div className="w-review-row">
          <dt>Rate</dt>
          <dd>{nairaText(Number(cashOut.rate))} per $1</dd>
        </div>
        <div className="w-review-row cx-receipt-rule">
          <dt>Reference</dt>
          <dd>{reference}</dd>
        </div>
        {cashOut.tx_url ? (
          <div className="w-review-row">
            <dt>On Monad</dt>
            <dd>
              <a className="textlink" href={cashOut.tx_url} target="_blank" rel="noreferrer">
                See the transaction
              </a>
            </dd>
          </div>
        ) : null}
      </dl>
      {shared ? (
        <p className="cx-fine" role="status">
          {shared}
        </p>
      ) : null}
      <div className="cx-done-actions">
        <button type="button" className="cx-line-button" onClick={() => void share()}>
          <Icon name="share" size={18} /> Share receipt
        </button>
        <Link href="/wallet" className="pill pill-block" data-tone="ink">
          <span className="pill-label">Done</span>
          <span className="pill-cap">
            <Icon name="home" size={18} />
          </span>
        </Link>
      </div>
    </div>
  )
}
