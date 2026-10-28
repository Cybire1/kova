'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Art, Icon } from '@/components/brand'
import { baseToNumber, formatLocal, formatUsd } from '@/lib/wallet/money'
import type { MovedIn } from '@/lib/wallet/private'
import { ScreenHead } from './activity'
import {
  type Entry,
  isUnnamed,
  type PayFrom,
  type PrivateStep,
  type Route,
  short,
  useWallet,
} from './provider'
import { EntryRow } from './ui'

/**
 * Private dollars, on the wallet's screens. They count in the balance and pay like any dollars:
 * the privacy router (@kova/monad) picks where each payment comes from, so these pieces only
 * explain it, offer a choice under Details to anyone who wants one, and make the moment a private
 * payment arrives. Making them public lives on the Private dollars screen, under its ⋯.
 */

/** What paying with private dollars is doing now, in a few plain words. */
export const stepLine = (step: PrivateStep | null, moving?: bigint) =>
  step === 'gathering'
    ? 'Getting your private dollars ready…'
    : step === 'moving'
      ? `Moving ${moving ? formatUsd(moving) : 'them'} into your balance…`
      : step === 'paying'
        ? 'Paying…'
        : null

const first = (name: string) => (isUnnamed(name) ? short(name) : (name.split(' ')[0] ?? name))

/** Passkey cancelled: not a problem to show. */
const cancelled = (message: string) => /cancel|not allowed|abort/i.test(message)

/**
 * Where a payment comes from, by the privacy router, as the amount and balance change. `direct`:
 * private dollars may pay it straight from their addresses. `privateFirst`: a private send. A
 * choice made under Details holds for this payment only, and only while it can pay. While
 * `paying`, the route holds as it was when the payment began: the balance changes under it.
 */
export function usePaymentRoute({
  amount,
  direct,
  privateFirst = false,
  paying = false,
}: {
  amount: bigint
  direct: boolean
  privateFirst?: boolean
  paying?: boolean
}) {
  const { balance, route: routeOf } = useWallet()
  const [choice, choose] = useState<PayFrom | null>(null)
  const now = routeOf({ amount, balance, direct, privateFirst, choice })
  const held = useRef(now)
  if (!paying) held.current = now
  const route = paying ? held.current : now
  // Details offers a choice only when both ways would really pay it.
  const viaBalance = routeOf({ amount, balance, direct, privateFirst, choice: 'balance' }).from
  const viaPrivate = routeOf({ amount, balance, direct, privateFirst, choice: 'private' }).from
  const choosable =
    direct && viaPrivate === 'private' && (viaBalance === 'balance' || viaBalance === 'top-up')
  const from: PayFrom = route.from === 'private' ? 'private' : 'balance'
  return { route, choose, choosable, from }
}

/**
 * The one calm line a payment needs when the balance and private dollars only cover it together:
 * how much moves into the balance first, and that the move shows on Monad.
 */
export function TopUpLine({ route }: { route: Route }) {
  if (route.from !== 'top-up') return null
  return (
    <p className="w-topup" aria-live="polite">
      <Icon name="lock" size={14} />
      <span>
        {formatUsd(route.moving)} of your private dollars moves into your balance for this; that
        move is public.
      </span>
    </p>
  )
}

/**
 * Details, folded away under a payment: where it comes from, for anyone who'd rather choose. The
 * router has already picked; opening this shows that, and lets them pick the other way.
 */
export function PayDetails({
  amount,
  route,
  onChoose,
  disabled,
}: {
  amount: bigint
  route: Route
  onChoose: (from: PayFrom) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="w-details">
      <button
        type="button"
        className="w-details-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Details <Icon name="chevronDown" size={14} />
      </button>
      {open ? (
        <PayFromChoice route={route} onChange={onChoose} amount={amount} disabled={disabled} />
      ) : null}
    </div>
  )
}

/**
 * Pay from your balance, or from your private dollars: then an address only you can open pays
 * (Kova covers its fee), and Monad can't tie the payment to your wallet.
 */
function PayFromChoice({
  route,
  onChange,
  amount,
  disabled,
}: {
  route: Route
  onChange: (from: PayFrom) => void
  amount: bigint
  disabled?: boolean
}) {
  const { balance, privateBalance, hideBalance } = useWallet()
  const value: PayFrom = route.from === 'private' ? 'private' : 'balance'
  const shown = (v: bigint) => (hideBalance ? '••••' : formatUsd(v))
  const short_ = balance !== null && balance < amount
  return (
    <div className="w-payfrom">
      <span className="w-payfrom-label" id="w-payfrom-label">
        Pay from
      </span>
      <div className="w-payfrom-options">
        <label className="w-payfrom-option" data-on={value === 'balance' ? 'true' : undefined}>
          <input
            type="radio"
            name="w-payfrom"
            aria-describedby="w-payfrom-label"
            checked={value === 'balance'}
            disabled={disabled}
            onChange={() => onChange('balance')}
          />
          <strong>Balance</strong>
          <small>{balance === null ? '…' : shown(balance)}</small>
        </label>
        <label
          className="w-payfrom-option w-payfrom-private"
          data-on={value === 'private' ? 'true' : undefined}
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
        {route.from === 'private'
          ? route.gather
            ? 'They’re in a few places, so they’re put together into one first: that publicly ties them to each other, never to you. Then they pay, and nothing public ties it to your wallet.'
            : 'Paid from an address only you can open. Nothing public ties it to your wallet, and the change stays private.'
          : short_
            ? 'From your wallet, after just enough private dollars move into it. It’s public that it came from you.'
            : 'From your wallet, as usual: it’s public that it came from you.'}
      </p>
    </div>
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
            ? `It’s public that ${formatUsd(amount)} moved, but not who sent it or to whom.`
            : on
              ? `It’s public that you sent ${formatUsd(amount)}, but not to whom.`
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
 * A browser without a saved read-only view unlocks once to enable automatic balance checks.
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
        <small>
          {problem ??
            'Unlock once on this browser. Your private balance then updates automatically.'}
        </small>
      </span>
      <button
        type="button"
        className="w-notes-locked-btn"
        onClick={() => void check()}
        disabled={busy}
      >
        {busy ? 'Unlocking…' : 'Unlock'}
      </button>
    </div>
  )
}

// --- The Private dollars screen ------------------------------------------------------------------

/**
 * Private dollars: the part of your balance only you can tell is yours. Nothing to manage here:
 * how much is private and who it's from, how it works a tap away, every private payment, and
 * whether people can send to you privately. Making them public lives under the ⋯.
 */
export function PrivateDollars() {
  const { activity, privateBalance, privateOpen, privateUnchecked, moveIn, movingIn, hideBalance } =
    useWallet()
  const [menu, setMenu] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [how, setHow] = useState(false)
  const [moved, setMoved] = useState<MovedIn | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const payments = useMemo(
    () => activity.filter((e) => e.oneTime && e.kind === 'received'),
    [activity],
  )
  const senders = [
    ...new Set(payments.filter((e) => e.waiting && e.name).map((e) => first(e.name))),
  ]
  const shown = (v: bigint) => (hideBalance ? '••••' : formatUsd(v))

  const makePublic = async () => {
    setConfirming(false)
    setProblem(null)
    setMoved(null)
    try {
      const result = await moveIn()
      setMoved(result)
      if (result.failed) setProblem(result.problem)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kova couldn’t move them.'
      if (!cancelled(message)) setProblem(message)
    }
  }

  return (
    <div className="w-screen">
      <ScreenHead title="Private dollars">
        <button
          type="button"
          className="round"
          aria-label="More"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          <span className="w-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </button>
      </ScreenHead>

      {menu ? (
        <div className="w-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(false)
              setHow(true)
            }}
          >
            <Icon name="info" size={18} />
            <span>
              <strong>How private works</strong>
              <small>What’s public, and what only you can see</small>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={privateBalance === 0n || movingIn !== null}
            onClick={() => {
              setMenu(false)
              setConfirming(true)
            }}
          >
            <Icon name="receive" size={18} />
            <span>
              <strong>Make these public</strong>
              <small>
                {privateBalance > 0n
                  ? `Move ${shown(privateBalance)} into your wallet, in the open`
                  : 'Nothing private to move right now'}
              </small>
            </span>
          </button>
        </div>
      ) : null}

      <section className="w-privcard" aria-live="polite">
        {moved?.count && !privateBalance ? (
          <>
            <span className="w-privcard-tag w-privcard-tag-done">
              <Icon name="check" size={13} /> Made public
            </span>
            <strong className="w-privcard-amount">{formatUsd(moved.amount)}</strong>
            <p>
              moved into your wallet in {(moved.ms / 1000).toFixed(1)} s. Still in your balance; the
              move is public.{' '}
              {moved.explorer ? (
                <a href={moved.explorer} target="_blank" rel="noreferrer">
                  See proof
                </a>
              ) : null}
            </p>
          </>
        ) : (
          <>
            <span className="w-privcard-row">
              <strong className="w-privcard-amount">{shown(privateBalance)}</strong>
              {privateBalance > 0n ? (
                <span className="w-privcard-tag">
                  <Icon name="check" size={13} /> In your balance
                </span>
              ) : null}
            </span>
            <p>
              {privateBalance > 0n
                ? 'Only you can tell these are yours. Pay and send with them like any dollars: Kova keeps them private.'
                : 'When someone sends you dollars privately, they land in your balance, and only you can tell they’re yours.'}
            </p>
            {senders.length ? (
              <span className="w-privcard-from">
                {senders.slice(0, 3).map((s) => (
                  <span key={s}>From {s}</span>
                ))}
              </span>
            ) : null}
            {movingIn ? (
              <span className="w-privcard-making">
                <span className="spinner w-spinner-light" aria-hidden="true" />
                {movingIn.total > 1
                  ? `Making them public, ${Math.min(movingIn.done + 1, movingIn.total)} of ${movingIn.total}…`
                  : 'Making it public…'}
              </span>
            ) : null}
          </>
        )}
        {problem ? <p className="w-privcard-problem">{problem}</p> : null}
      </section>

      {confirming ? (
        <div className="w-confirm" role="alertdialog" aria-label="Make them public">
          <strong>Make {shown(privateBalance)} public?</strong>
          <p>
            Each private payment moves into your wallet, and every move is public, so anyone can see
            these dollars reached you. They stay in your balance either way. Kova covers the fee.
          </p>
          <button
            type="button"
            className="pill pill-block"
            data-tone="ink"
            onClick={() => void makePublic()}
          >
            <span className="pill-label">Make {shown(privateBalance)} public</span>
            <span className="pill-cap">
              <Icon name="receive" size={18} />
            </span>
          </button>
          <button type="button" className="textlink" onClick={() => setConfirming(false)}>
            Keep them private
          </button>
        </div>
      ) : null}

      <button type="button" className="w-howlink" aria-expanded={how} onClick={() => setHow(!how)}>
        <Icon name="info" size={16} /> How private works <Icon name="chevronDown" size={15} />
      </button>
      {how ? (
        <div className="w-explain">
          <PrivateFlow from={payments[0]} />
          <p>
            Someone who sends you dollars privately pays an address made just for that payment. Who
            sent it and how much is public, but only your keys can tell the address is yours, so
            nobody can add up what you receive.
          </p>
          <small>
            They count in your balance straight away. When you pay a shop or send privately, Kova
            pays straight from them, so your wallet never shows. If a payment needs a little more
            than your balance holds, just enough moves in first, and Kova says so before it does:
            that move is public.
          </small>
        </div>
      ) : null}

      <div className="w-section-row">
        <h2 className="w-section">Every private payment</h2>
        {payments.length ? (
          <span className="w-quiet-count">
            {payments.length} {payments.length === 1 ? 'payment' : 'payments'}
          </span>
        ) : null}
      </div>
      {!privateOpen && privateUnchecked ? <CheckPrivate /> : null}
      {payments.length ? (
        <div className="w-entries">
          {payments.map((entry) => (
            <EntryRow key={entry.id} entry={entry} />
          ))}
        </div>
      ) : (
        <p className="w-quiet">Private payments show up here the moment they land.</p>
      )}

      <h2 className="w-section">Receiving privately</h2>
      <PrivateReceiving />
    </div>
  )
}

/** How it stays private: someone pays an address made for that payment alone, only you can open it. */
function PrivateFlow({ from }: { from?: Entry }) {
  const name = from?.name ? first(from.name) : 'Someone'
  return (
    <div
      className="w-flow"
      role="img"
      aria-label="Someone pays an address made for that payment alone, which only your keys can open"
    >
      <span className="w-flow-end">
        <span className="w-flow-face">{name.slice(0, 1).toUpperCase()}</span>
        <small>{name}</small>
      </span>
      <span className="w-flow-line" />
      <span className="w-flow-mid">
        <span className="w-flow-chip">
          {from?.oneTime ? short(from.oneTime) : 'its own address'}
        </span>
        <small>Public</small>
      </span>
      <span className="w-flow-line" />
      <span className="w-flow-end">
        <span className="w-flow-you">
          <Icon name="lock" size={18} />
        </span>
        <small>Only you</small>
      </span>
    </div>
  )
}

// --- The arrival ---------------------------------------------------------------------------------

const EXPLAINED = (wallet: string) => `kova.web.private.explained.v1.${wallet.toLowerCase()}`
const CIPHER = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&'

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** `text` as it's decrypted: scrambled characters settling into the real ones, left to right. */
function useDecoded(text: string, delay: number, ms = 700) {
  const [shown, setShown] = useState(text)
  useEffect(() => {
    if (reducedMotion()) return setShown(text)
    const scramble = (keep: number) =>
      [...text]
        .map((c, i) =>
          i < keep || c === ' ' ? c : (CIPHER[Math.floor(Math.random() * CIPHER.length)] ?? c),
        )
        .join('')
    setShown(scramble(0))
    let frame = 0
    let began = 0
    let last = 0
    const step = (now: number) => {
      if (!began) began = now
      const p = Math.min(1, (now - began) / ms)
      // A new scramble every few frames, not every one: it reads as decoding, not noise.
      if (now - last > 45 || p === 1) {
        last = now
        setShown(p === 1 ? text : scramble(Math.floor(p * text.length)))
      }
      if (p < 1) frame = requestAnimationFrame(step)
    }
    const timer = setTimeout(() => {
      frame = requestAnimationFrame(step)
    }, delay)
    return () => {
      clearTimeout(timer)
      cancelAnimationFrame(frame)
    }
  }, [text, delay, ms])
  return shown
}

/**
 * A private payment arriving while the wallet is open: one full-screen moment, as in the app. A
 * sealed envelope, addressed to you, breaks its seal, the flap folds back and the card with the
 * amount rises out; the sender's note decodes as it's opened. It's already in the balance: one
 * button, Done. The first private arrival on a wallet says, once, what makes it private.
 */
export function PrivateArrivalMoment() {
  const { privateArrival: arrival, clearPrivateArrival, profile, rates } = useWallet()
  const [explain, setExplain] = useState(false)
  const address = profile?.address
  const id = arrival?.id

  useEffect(() => {
    if (!id || !address) return
    try {
      if (localStorage.getItem(EXPLAINED(address))) return setExplain(false)
      localStorage.setItem(EXPLAINED(address), '1')
      setExplain(true)
    } catch {
      // Storage blocked: explain this time anyway.
      setExplain(true)
    }
  }, [id, address])

  // A tap of the phone as the envelope opens, where the browser can.
  useEffect(() => {
    if (!id) return
    const timer = setTimeout(
      () => {
        try {
          navigator.vibrate?.([14, 50, 22])
        } catch {}
      },
      reducedMotion() ? 0 : 850,
    )
    return () => clearTimeout(timer)
  }, [id])

  // Escape closes it, and the page behind doesn't scroll.
  useEffect(() => {
    if (!id) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && clearPrivateArrival()
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [id, clearPrivateArrival])

  if (!arrival) return null
  const usd = formatUsd(arrival.amount)
  const who = isUnnamed(arrival.name) ? 'them' : first(arrival.name)
  return (
    <div
      className="w-parrival"
      role="dialog"
      aria-modal="true"
      aria-label={`${arrival.name} sent you ${usd}, privately`}
    >
      <div className="w-arrival-top">
        <span className="w-arrival-tag">
          <Icon name="lock" size={13} /> Private · just now
        </span>
      </div>
      <div className="w-arrival-stage">
        <SealedEnvelope
          amount={usd}
          from={arrival.name}
          to={profile?.name ? profile.name.split(' ')[0] : undefined}
        />
      </div>
      <div className="w-arrival-kovi" aria-hidden="true">
        <Art name="kovi-peek" size={150} className="w-arrival-peek" />
        <span className="w-arrival-whisper">Psst… just for you</span>
      </div>
      <div className="w-arrival-sheet">
        <h2 className="w-arrival-title">
          {arrival.name} sent you {usd}, privately
        </h2>
        {arrival.unconfirmed ? (
          <p className="w-arrival-unconfirmed">
            Unconfirmed: only their sealed note says it’s them
          </p>
        ) : null}
        {arrival.note ? (
          <DecodedNote text={arrival.note} caption={`From ${who}. Only you two can read it.`} />
        ) : null}
        <p className="w-arrival-in">
          <span className="w-arrival-tick">
            <Icon name="check" size={13} />
          </span>
          It’s in your balance.
          {profile && profile.currency !== 'USD' ? (
            <small>
              About {formatLocal(baseToNumber(arrival.amount), profile.currency, rates)}
            </small>
          ) : null}
        </p>
        {explain ? (
          <p className="w-arrival-explain">
            <span className="w-arrival-explain-lock">
              <Icon name="lock" size={15} />
            </span>
            <span>
              <strong>Only you can see this came from {who}.</strong> In public, it’s a payment to
              an address made just for it.
            </span>
          </p>
        ) : null}
        <button
          type="button"
          className="pill pill-block w-arrival-done"
          data-tone="ink"
          onClick={clearPrivateArrival}
        >
          <span className="pill-label">Done</span>
          <span className="pill-cap">
            <Icon name="check" size={18} />
          </span>
        </button>
      </div>
    </div>
  )
}

/** The note, sealed in the payment, decoding as it's opened: a slip of paper taped down, with a lock. */
function DecodedNote({ text, caption }: { text: string; caption: string }) {
  const shown = useDecoded(text, 1400)
  return (
    <figure className="w-arrival-note" aria-label={`Private note: ${text}. ${caption}`}>
      <span className="w-arrival-note-lock">
        <Icon name="lock" size={12} /> Private note
      </span>
      <blockquote aria-hidden="true">“{shown}”</blockquote>
      <figcaption>{caption}</figcaption>
    </figure>
  )
}

/**
 * The envelope, teal (money arriving), with a coral seal over its flap. CSS runs the seal's pulse
 * and break, the flap's fold, the card's rise and the sparkles (wallet.css, .w-env); with reduced
 * motion it's simply open.
 */
function SealedEnvelope({ amount, from, to }: { amount: string; from: string; to?: string }) {
  return (
    <div
      className="w-env"
      role="img"
      aria-label={`A sealed envelope from ${from}, opening. ${amount} inside.`}
    >
      <span className="w-env-back" />
      <svg className="w-env-flap w-env-flap-open" viewBox="0 0 280 98" aria-hidden="true">
        <path d="M1 1 H279 L154 90 Q140 101 126 90 Z" />
      </svg>
      <span className="w-env-card">
        <small>From {from}</small>
        <strong>{amount}</strong>
        <em>
          <Icon name="lock" size={11} /> Sealed for you
        </em>
      </span>
      <svg className="w-env-front" viewBox="0 0 280 174" aria-hidden="true">
        <path d="M1 1 L140 87 L279 1 V156 Q279 173 262 173 H18 Q1 173 1 156 Z" />
      </svg>
      <span className="w-env-label">
        {to ? <strong>For {to}</strong> : null}
        <small>Opened here, with your keys</small>
      </span>
      <svg className="w-env-flap w-env-flap-shut" viewBox="0 0 280 98" aria-hidden="true">
        <path d="M1 1 H279 L154 90 Q140 101 126 90 Z" />
      </svg>
      <span className="w-env-ripple" />
      <span className="w-env-seal">
        <Icon name="lock" size={20} />
      </span>
      <Art name="sparkle-4" size={22} className="w-env-spark w-env-spark-1" />
      <Art name="sparkle-8" size={18} className="w-env-spark w-env-spark-2" />
      <Art name="sparkle-11" size={16} className="w-env-spark w-env-spark-3" />
    </div>
  )
}
