'use client'

import { useCallback, useEffect, useState } from 'react'
import { Icon } from '@/components/brand'
import { formatUsd } from '@/lib/wallet/money'
import type { MovedIn } from '@/lib/wallet/private'
import { useSessionState } from '@/lib/wallet/session'
import { isUnnamed, type PayFrom, type PrivateStep, short, useWallet } from './provider'

/**
 * Private sends, on the wallet's screens: the switch on Send's review, paying from private dollars,
 * the dollars sent to you privately and the way to move them in, and the line in Profile that says
 * anyone can.
 */

const PAY_FROM = 'kova.web.payFrom.v1'

/** Pay from your balance or your private dollars: the last choice, remembered on this browser. */
export function usePayFrom(): [PayFrom, (from: PayFrom) => void] {
  const [from, setFrom] = useState<PayFrom>('balance')
  useEffect(() => {
    try {
      if (localStorage.getItem(PAY_FROM) === 'private') setFrom('private')
    } catch {}
  }, [])
  const choose = useCallback((next: PayFrom) => {
    setFrom(next)
    try {
      localStorage.setItem(PAY_FROM, next)
    } catch {}
  }, [])
  return [from, choose]
}

/** What paying from private dollars is doing now, in a few words. */
export const stepLine = (step: PrivateStep | null) =>
  step === 'gathering' ? 'Gathering your private dollars…' : step === 'paying' ? 'Paying…' : null

/** Why gathering is fine: it links the gathered addresses to each other on Monad, not to you. */
export const GATHER_LINE =
  'Gathering links those private addresses to each other on Monad, never to you.'

/**
 * Pay from your balance, or from your private dollars: then a one-time address only you can open
 * pays (Kova covers its fee), and Monad can't tie the payment to your wallet. Shown when your
 * private dollars cover the amount; the balance is greyed out when it doesn't.
 */
export function PayFromChoice({
  value,
  onChange,
  amount,
  disabled,
}: {
  value: PayFrom
  onChange: (from: PayFrom) => void
  amount: bigint
  disabled?: boolean
}) {
  const { balance, privateBalance, privateLargest, hideBalance } = useWallet()
  const balanceCovers = balance !== null && balance >= amount
  const shown = (v: bigint) => (hideBalance ? '••••' : formatUsd(v))
  return (
    <div className="w-payfrom">
      <span className="w-payfrom-label" id="w-payfrom-label">
        Pay from
      </span>
      <div className="w-payfrom-options">
        <label
          className="w-payfrom-option"
          data-on={value === 'balance' ? 'true' : undefined}
          data-off={disabled || !balanceCovers ? 'true' : undefined}
        >
          <input
            type="radio"
            name="w-payfrom"
            aria-describedby="w-payfrom-label"
            checked={value === 'balance'}
            disabled={disabled || !balanceCovers}
            onChange={() => onChange('balance')}
          />
          <strong>Balance</strong>
          <small>{balance === null ? '…' : shown(balance)}</small>
        </label>
        <label
          className="w-payfrom-option w-payfrom-private"
          data-on={value === 'private' ? 'true' : undefined}
          data-off={disabled ? 'true' : undefined}
        >
          <input
            type="radio"
            name="w-payfrom"
            aria-describedby="w-payfrom-label"
            checked={value === 'private'}
            disabled={disabled}
            onChange={() => onChange('private')}
          />
          <strong>
            <Icon name="lock" size={13} /> Private dollars
          </strong>
          <small>{shown(privateBalance)}</small>
        </label>
      </div>
      <p className="w-payfrom-fine">
        {value === 'private'
          ? privateLargest >= amount
            ? 'Paid from an address only you can open. Monad can’t tie it to your wallet.'
            : `They’re at a few addresses, so they’re gathered into one first. ${GATHER_LINE}`
          : 'From your wallet, as usual: Monad shows it came from you.'}
      </p>
    </div>
  )
}

const first = (name: string) => (isUnnamed(name) ? short(name) : (name.split(' ')[0] ?? name))

/** Passkey cancelled: not a problem to show. */
const cancelled = (message: string) => /cancel|not allowed|abort/i.test(message)

/** Whether moving private dollars in would make up the difference. */
export function privateCovers(balance: bigint | null, privateBalance: bigint, amount: bigint) {
  return (
    balance !== null &&
    amount > balance &&
    privateBalance > 0n &&
    balance + privateBalance >= amount
  )
}

/** "From Ada", "From Ada and Ben", "From Ada and 2 others", for who sent what's waiting. */
function fromLine(names: string[]) {
  const [one, two] = names
  if (!one) return null
  if (names.length === 1) return `From ${one}`
  if (names.length === 2) return `From ${one} and ${two}`
  return `From ${one} and ${names.length - 1} others`
}

/**
 * Dollars sent to you privately, on Home under Pay: what's waiting at one-time addresses only your
 * keys can open, who it's from, and Move in. Each address moves its dollars to your wallet itself,
 * and Kova covers the fee; the row says how far it's got, then how long it took.
 */
export function PrivateWaiting() {
  const { activity, privateBalance, moveIn, movingIn, hideBalance } = useWallet()
  const session = useSessionState()
  const [moved, setMoved] = useState<MovedIn | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  // The result stays a moment, then the row goes: the money is in the balance above.
  useEffect(() => {
    if (!moved || moved.failed) return
    const timer = setTimeout(() => setMoved(null), 9000)
    return () => clearTimeout(timer)
  }, [moved])

  /** Moving in is public: the first tap says so, the second moves. */
  const [sure, setSure] = useState(false)
  useEffect(() => {
    if (!sure) return
    const timer = setTimeout(() => setSure(false), 8000)
    return () => clearTimeout(timer)
  }, [sure])

  if (!privateBalance && !moved && !movingIn) return null

  const go = async () => {
    if (!sure) return setSure(true)
    setSure(false)
    setProblem(null)
    setMoved(null)
    try {
      const result = await moveIn()
      if (result.count) setMoved(result)
      if (result.failed) setProblem(result.problem)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kova couldn’t move them in.'
      if (!cancelled(message)) setProblem(message)
    }
  }

  const names = [
    ...new Set(
      activity
        .filter((e) => e.oneTime && e.kind === 'received' && e.waiting && e.name)
        .map((e) => first(e.name)),
    ),
  ]
  const from = fromLine(names)

  if (moved && !movingIn && !privateBalance)
    return (
      <section className="w-private w-private-done" aria-live="polite">
        <span className="w-private-icon">
          <Icon name="check" size={18} />
        </span>
        <strong className="w-private-title">
          Moved {formatUsd(moved.amount)} in {(moved.ms / 1000).toFixed(1)} s
        </strong>
        <span className="w-private-sub">
          Into your balance.{' '}
          {moved.explorer ? (
            <a href={moved.explorer} target="_blank" rel="noreferrer">
              See it on Monad
            </a>
          ) : null}
        </span>
      </section>
    )

  return (
    <>
      <section
        className="w-private"
        aria-label="Dollars sent to you privately"
        aria-busy={movingIn !== null}
      >
        <span className="w-private-icon">
          <Icon name="lock" size={18} />
        </span>
        <strong className="w-private-title">
          {movingIn
            ? 'Moving in…'
            : hideBalance
              ? 'Your private dollars'
              : `${formatUsd(privateBalance)} in private dollars`}
        </strong>
        <span className="w-private-sub">
          {movingIn
            ? movingIn.total > 1
              ? `${movingIn.done} of ${movingIn.total}, Kova covers the fee`
              : 'Kova covers the fee'
            : sure
              ? 'Moving in is public: Monad shows them reaching your wallet.'
              : (from ?? 'Only you can tell they’re yours')}
        </span>
        <button
          type="button"
          className="w-private-cta"
          disabled={movingIn !== null}
          onClick={() => void go()}
        >
          {movingIn ? (
            <span className="spinner w-spinner-light" aria-hidden="true" />
          ) : (
            <Icon name={session.open ? 'arrow' : 'face'} size={15} />
          )}
          {movingIn ? 'Moving' : sure ? 'Move in anyway' : 'Move in'}
        </button>
      </section>
      {problem ? (
        <p className="w-sheet-problem w-private-problem" role="alert">
          <Icon name="info" size={16} />
          {moved?.count
            ? `Moved ${formatUsd(moved.amount)}, but ${moved.failed === 1 ? 'one didn’t go' : `${moved.failed} didn’t go`}. ${problem}`
            : problem}
        </p>
      ) : null}
    </>
  )
}

/**
 * Short of money with private dollars waiting: one tap moves them in, then the payment goes on.
 */
export function MoveInFirst({ tone = 'ink' }: { tone?: 'ink' | 'coral' }) {
  const { privateBalance, moveIn, movingIn } = useWallet()
  const [problem, setProblem] = useState<string | null>(null)
  const go = async () => {
    setProblem(null)
    try {
      const result = await moveIn()
      if (result.failed) setProblem(result.problem)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kova couldn’t move them in.'
      if (!cancelled(message)) setProblem(message)
    }
  }
  return (
    <>
      <button
        type="button"
        className="pill pill-block"
        data-tone={tone}
        disabled={movingIn !== null}
        onClick={() => void go()}
      >
        <span className="pill-label">
          {movingIn
            ? movingIn.total > 1
              ? `Moving in, ${movingIn.done} of ${movingIn.total}…`
              : 'Moving in…'
            : `Move in your private ${formatUsd(privateBalance)} first`}
        </span>
        <span className="pill-cap">
          {movingIn ? (
            <span className="spinner" aria-hidden="true" />
          ) : (
            <Icon name="lock" size={18} />
          )}
        </span>
      </button>
      {problem ? <p className="form-error">{problem}</p> : null}
    </>
  )
}

/**
 * Send privately, on the review: to a one-time address made for them from the key their wallet
 * published. Monad shows the money leaving you, and nothing that says where it went.
 */
export function PrivateSwitch({
  on,
  onChange,
  name,
  amount,
  disabled,
  fromPrivate,
}: {
  on: boolean
  onChange: (on: boolean) => void
  name: string
  amount: bigint
  disabled?: boolean
  /** Paid from private dollars, so Monad doesn't show who sent it either. */
  fromPrivate?: boolean
}) {
  return (
    <label className={`w-private-switch${on ? ' w-private-switch-on' : ''}`}>
      <span className="w-private-switch-icon">
        <Icon name="lock" size={16} />
      </span>
      <span className="w-private-switch-text">
        <strong>Send privately</strong>
        <small>
          {on && fromPrivate
            ? `On Monad, people will see ${formatUsd(amount)} move, but not who sent it or to whom.`
            : on
              ? `On Monad, people will see you sent ${formatUsd(amount)}, but not to whom.`
              : `Hide who gets it from everyone but ${first(name)}.`}
        </small>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-checked={on}
        checked={on}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="w-private-switch-track" aria-hidden="true" />
    </label>
  )
}

/** In Profile: whether anyone can send to you privately, and turning it on if it isn't yet. */
export function PrivateReceiving() {
  const { privateReceiving, checkPrivate } = useWallet()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  if (privateReceiving === null) return null
  const turnOn = async () => {
    setBusy(true)
    setProblem(null)
    try {
      await checkPrivate()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Your passkey didn’t open it.'
      if (!cancelled(message)) setProblem(message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="w-receiving" data-on={privateReceiving ? 'true' : undefined}>
      <span className="w-receiving-icon">
        <Icon name="lock" size={18} />
      </span>
      <span className="w-receiving-text">
        <strong>Private receiving: {privateReceiving ? 'on' : 'off'}</strong>
        <small>
          {privateReceiving
            ? 'Anyone can send you dollars privately. Only you can tell they’re yours.'
            : (problem ?? 'Turn it on and anyone can send you dollars privately.')}
        </small>
      </span>
      {privateReceiving ? null : (
        <button
          type="button"
          className="mini mini-ink"
          disabled={busy}
          onClick={() => void turnOn()}
        >
          <Icon name="face" size={14} /> {busy ? 'Turning on…' : 'Turn on'}
        </button>
      )}
    </section>
  )
}

/**
 * In Activity, after a reload: private payments only show once your keys have looked through what
 * Kova announced, and here the keys live in memory, so the passkey checks.
 */
export function CheckPrivate() {
  const { checkPrivate } = useWallet()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const check = async () => {
    setBusy(true)
    setProblem(null)
    try {
      await checkPrivate()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Your passkey didn’t open them.'
      if (!cancelled(message)) setProblem(message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="w-notes-locked">
      <span className="w-notes-locked-icon">
        <Icon name="lock" size={16} />
      </span>
      <span className="w-notes-locked-text">
        <strong>Private payments</strong>
        <small>{problem ?? 'Some may be yours. Your passkey checks, here on this device.'}</small>
      </span>
      <button
        type="button"
        className="w-notes-locked-btn"
        onClick={() => void check()}
        disabled={busy}
      >
        {busy ? 'Checking…' : 'Check'}
      </button>
    </div>
  )
}
