'use client'

import type { NetworkId, OfflinePayment } from '@kova/monad'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { isAddressEqual } from 'viem'
import { formatUsd } from '@/lib/wallet/money'
import {
  handIn,
  offlineStatus,
  type ReadCode,
  Refused,
  readOfflineCode,
  rememberOfflineTx,
} from '@/lib/wallet/offline'
import { Art, Icon } from './brand'
import { short, useWallet } from './wallet/provider'
import { Avatar, NoSignal } from './wallet/ui'

/**
 * An offline payment, opened by anyone (mykova.app/o#<code>). The code is read from after the #
 * and checked here, with no network: its signature, its dollar, the $100 cap and its week. Kova is
 * asked only whether it has settled, by sender and nonce. "Settle it now" hands the signed payment
 * to Kova, which settles it on Monad and pays the gas; the dollars can only go where it was signed
 * to, so it doesn't matter who presses it.
 */

type Settled = {
  tx: string | null
  explorer: string | null
  at: string | null
  /** This visit settled it, in this many milliseconds. */
  ms?: number
}

type Problem =
  /** The sender's wallet holds less than the payment, for now. */
  { kind: 'short'; balance: bigint | null } | { kind: 'other'; message: string }

const POLL_MS = 6_000

export function OfflinePaymentView() {
  const [read, setRead] = useState<ReadCode | 'reading' | 'empty'>('reading')

  useEffect(() => {
    const take = () => {
      const hash = window.location.hash.replace(/^#/, '')
      if (!hash) return setRead('empty')
      setRead('reading')
      void readOfflineCode(hash).then(setRead)
    }
    take()
    window.addEventListener('hashchange', take)
    return () => window.removeEventListener('hashchange', take)
  }, [])

  if (read === 'reading')
    return (
      <div className="lk-grid of-grid">
        <div className="lk-panel lk-panel-quiet of-reading" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <span>Checking the signature…</span>
        </div>
      </div>
    )
  if (read === 'empty') return <Unopened kind="empty" />
  if (!read.ok && read.reason === 'not-a-code') return <Unopened kind="not-a-code" />
  if (!read.ok && read.reason !== 'expired')
    return <Invalid reason={read.reason} payment={read.payment} />
  return (
    <Live
      key={read.payment.authorization.nonce}
      payment={read.payment}
      network={read.network}
      expired={!read.ok}
    />
  )
}

/** A payment whose signature checks out: who, how much, whether it has settled, and the button. */
function Live({
  payment,
  network,
  expired,
}: {
  payment: OfflinePayment
  network: NetworkId
  expired: boolean
}) {
  const wallet = useWallet()
  const { profile, balance, refresh } = wallet
  const { from, to, value, validBefore } = payment.authorization
  const [settled, setSettled] = useState<Settled | null>(null)
  const [checked, setChecked] = useState(false)
  const [settling, setSettling] = useState(false)
  /** Monad is slow to answer: say so, and that waiting is safe. */
  const [slow, setSlow] = useState(false)
  const handing = useRef(false)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [, tick] = useState(0)
  const side = useRef<HTMLElement>(null)

  const here = wallet.network === network
  const yours = Boolean(profile && isAddressEqual(profile.address, to))
  const yoursToPay = Boolean(profile && isAddressEqual(profile.address, from))
  const name = payment.name?.trim() || null
  const first = name ? (name.split(' ')[0] ?? name) : null
  const sender = first ?? short(from)
  const amount = formatUsd(value)
  const until = new Date(Number(validBefore) * 1000)
  const test = network === 'testnet'

  const land = useCallback(
    (next: Settled) => {
      setSettled(next)
      setProblem(null)
      if (next.tx) rememberOfflineTx(next.tx)
      if (yours || yoursToPay) void refresh()
    },
    [yours, yoursToPay, refresh],
  )

  // Kova's word on it, and again every few seconds while it waits: the other phone may hand it in.
  useEffect(() => {
    if (!here) return
    let stop = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const ask = async () => {
      try {
        const s = await offlineStatus(payment)
        if (stop) return
        // This visitor is handing it in right now: its answer says how it went.
        if (handing.current) {
          timer = setTimeout(ask, POLL_MS)
          return
        }
        setChecked(true)
        if (s.status === 'settled') {
          setSettled((was) =>
            was?.ms !== undefined
              ? { ...was, tx: was.tx ?? s.tx_hash, explorer: was.explorer ?? s.explorer_url }
              : { tx: s.tx_hash, explorer: s.explorer_url, at: s.settled_at },
          )
          if (s.tx_hash) rememberOfflineTx(s.tx_hash)
          // Settled on Monad, not yet in Kova's index: its transaction follows shortly.
          if (!s.tx_hash) timer = setTimeout(ask, 2_500)
          return
        }
      } catch {
        if (stop) return
        setChecked(true)
      }
      if (!expired) timer = setTimeout(ask, document.hidden ? POLL_MS * 3 : POLL_MS)
    }
    void ask()
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [payment, expired, here])

  // "in 6 days" stays true while the page is open.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  // On a phone the outcome happens below the payment: bring it into view.
  useEffect(() => {
    if (!settled?.ms && problem === null) return
    const el = side.current
    if (!el || el.getBoundingClientRect().top < window.innerHeight * 0.5) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  }, [settled?.ms, problem])

  const settle = async () => {
    setSettling(true)
    handing.current = true
    setProblem(null)
    const slowly = setTimeout(() => setSlow(true), 8_000)
    try {
      const done = await handIn(payment)
      navigator.vibrate?.(30)
      land({
        tx: done.tx_hash,
        explorer: done.explorer_url,
        at: new Date().toISOString(),
        ms: done.ms,
      })
    } catch (error) {
      if (error instanceof Refused && error.alreadyPaid) {
        // Someone handed it in first: it's paid, whoever did it.
        const s = await offlineStatus(payment).catch(() => null)
        land({
          tx: s?.tx_hash ?? null,
          explorer: s?.explorer_url ?? null,
          at: s?.settled_at ?? null,
        })
      } else if (error instanceof Refused && error.short) {
        const held = error.details?.balance
        setProblem({
          kind: 'short',
          balance: typeof held === 'string' && /^\d+$/.test(held) ? BigInt(held) : null,
        })
      } else {
        const message = error instanceof Error ? error.message : ''
        setProblem({
          kind: 'other',
          message:
            message && message.length < 160
              ? message
              : 'Kova couldn’t settle it just now. Nothing moved; try again.',
        })
      }
    } finally {
      clearTimeout(slowly)
      handing.current = false
      setSettling(false)
      setSlow(false)
    }
  }

  const ranOut = expired && !settled
  const toLabel = yours ? 'you' : short(to)

  return (
    <div className="lk-grid of-grid">
      <section className="lk-hero" aria-label="The payment">
        <Art name="scene-coin-rain" size={640} className="lk-rain" />
        <div className={`lk-env of-slip${ranOut ? ' lk-env-closed' : ''}`}>
          <Art name="kovi-peek" size={88} className="lk-env-peek" priority alt="" />
          <div className="lk-env-card of-slip-card">
            {settled ? (
              <span className="of-slip-tag of-slip-tag-settled">
                <Icon name="check" size={13} />
                Settled on Monad
              </span>
            ) : (
              <span className="of-slip-tag">
                <NoSignal size={13} />
                Paid with no signal
              </span>
            )}
            <h1 className="lk-env-head">
              <span className="lk-env-from">
                <Avatar name={name ?? from} id={from} size={22} />
                <span className="of-slip-name">{name ?? short(from)}</span>
              </span>
              <span className="sr-only"> paid {yours ? 'you' : short(to)}</span>
              <strong className="lk-env-amount">{amount}</strong>
            </h1>
            <p className="of-slip-to">
              <span className="of-slip-to-label">to</span>
              {yours ? <strong>you</strong> : null}
              <code>{short(to)}</code>
            </p>
            <p className="of-slip-foot">
              <Icon name="pen" size={14} />
              {settled
                ? 'Signed on their phone with no signal · settled on Monad'
                : ranOut
                  ? 'Signed on their phone · ran out before anyone handed it in'
                  : 'Signed on their phone · settles on Monad as soon as anyone hands it in'}
            </p>
            {ranOut ? (
              <span className="lk-env-stamp" aria-hidden="true">
                Expired
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <section ref={side} className="lk-side of-side" aria-live="polite">
        {yours ? (
          <div className="lk-mine of-yours">
            <span className="lk-mine-icon">
              <Icon name="check" size={16} />
            </span>
            <div className="lk-mine-text">
              <strong>This is yours</strong>
              <span>
                {settled
                  ? 'It’s in your Kova wallet now.'
                  : `It pays your Kova wallet${profile?.name ? `, ${profile.name}` : ''}. Settle it and it shows in your balance.`}
              </span>
            </div>
          </div>
        ) : yoursToPay ? (
          <div className="lk-mine of-yours">
            <span className="lk-mine-icon">
              <Icon name="pen" size={16} />
            </span>
            <div className="lk-mine-text">
              <strong>You signed this</strong>
              <span>
                {settled
                  ? `It’s paid: ${amount} went to ${short(to)}.`
                  : `Your payment to ${short(to)}. Settle it now and it’s paid.`}
              </span>
            </div>
          </div>
        ) : null}

        {!here ? (
          <div className="lk-panel lk-closed" role="alert">
            <Art name="kovi-oops" size={88} className="lk-closed-art" />
            <h2 className="lk-h">This payment is on Monad {network}</h2>
            <p className="w-lead">
              This site settles payments on Monad {wallet.network}, so it can’t settle this one. The
              signature is genuine.
            </p>
          </div>
        ) : settled ? (
          <SettledPanel
            settled={settled}
            amount={amount}
            sender={sender}
            toLabel={toLabel}
            yours={yours}
            balance={yours ? balance : null}
            hasWallet={wallet.status === 'ready'}
          />
        ) : ranOut ? (
          <div className="lk-panel lk-closed of-expired">
            <Art name="kovi-sleep" size={88} className="lk-closed-art" />
            <h2 className="lk-h">This payment ran out</h2>
            <p className="w-lead">
              Nobody handed it in before {dateLabel(until)}, so it can’t settle now. Nothing moved.
              {first ? ` Ask ${first} to pay again.` : ' Ask them to pay again.'}
            </p>
          </div>
        ) : (
          <div className="lk-panel of-panel">
            <div className="of-status" data-state={checked ? 'waiting' : 'checking'}>
              <span className="of-status-dot" aria-hidden="true" />
              {checked ? 'Waiting to settle' : 'Asking Kova…'}
            </div>
            <Details payment={payment} name={name} yours={yours} until={until} test={test} />

            {problem?.kind === 'short' ? (
              <div className="of-short" role="alert">
                <Icon name="info" size={18} />
                <div>
                  <strong>It didn’t settle</strong>
                  <p>
                    {sender} doesn’t have the money in their wallet yet
                    {problem.balance !== null ? ` (it holds ${formatUsd(problem.balance)})` : ''},
                    so nothing moved. The payment is still good: try again later, before{' '}
                    {dateLabel(until)}.
                  </p>
                </div>
              </div>
            ) : problem?.kind === 'other' ? (
              <p className="w-sheet-problem lk-problem" role="alert">
                <Icon name="info" size={16} />
                {problem.message}
              </p>
            ) : null}

            <button
              type="button"
              className="pill pill-block of-settle"
              data-tone="coral"
              disabled={settling}
              onClick={() => void settle()}
            >
              <span className="pill-label">
                {settling
                  ? 'Settling on Monad…'
                  : problem?.kind === 'short'
                    ? 'Try again'
                    : 'Settle it now'}
              </span>
              <span className="pill-cap">
                {settling ? (
                  <span className="spinner" aria-hidden="true" />
                ) : (
                  <Icon name="bolt" size={18} />
                )}
              </span>
            </button>
            {slow ? (
              <p className="lk-fine of-slow" role="status">
                Monad is slow to answer. Hang on: a payment can only ever settle once, so waiting is
                safe.
              </p>
            ) : (
              <p className="lk-fine">
                Anyone can settle it, and Kova covers the fee. The dollars can only go to{' '}
                {yours ? 'you' : short(to)}.
              </p>
            )}
          </div>
        )}

        <p className="lk-foot">
          {test ? 'Test dollars on Monad testnet. ' : ''}The code stays in this browser: Kova sees
          the payment only when it’s settled.
        </p>
      </section>
    </div>
  )
}

/** Who, to whom, how much, and until when: the name is theirs to claim, the address is signed. */
function Details({
  payment,
  name,
  yours,
  until,
  test,
}: {
  payment: OfflinePayment
  name: string | null
  yours: boolean
  until: Date
  test: boolean
}) {
  const { from, to, value } = payment.authorization
  return (
    <dl className="of-rows">
      <div>
        <dt>From</dt>
        <dd>
          {name ? (
            <>
              <strong>{name}</strong>
              <small>Name from their phone, not checked</small>
            </>
          ) : null}
          <span className="of-signed">
            <code>{short(from)}</code>
            <span className="of-check">
              <Icon name="check" size={12} />
              Signature checked
            </span>
          </span>
        </dd>
      </div>
      <div>
        <dt>To</dt>
        <dd>
          {yours ? <strong>You</strong> : null}
          <code>{short(to)}</code>
        </dd>
      </div>
      <div>
        <dt>Amount</dt>
        <dd>
          <strong>{formatUsd(value)}</strong>
          <small>{test ? 'Test dollars (AUSD)' : 'US dollars (AUSD)'}</small>
        </dd>
      </div>
      <div>
        <dt>Good until</dt>
        <dd>
          {dateLabel(until)}
          <small>{inLabel(until)}</small>
        </dd>
      </div>
    </dl>
  )
}

function SettledPanel({
  settled,
  amount,
  sender,
  toLabel,
  yours,
  balance,
  hasWallet,
}: {
  settled: Settled
  amount: string
  sender: string
  toLabel: string
  yours: boolean
  balance: bigint | null
  hasWallet: boolean
}) {
  const now = settled.ms !== undefined
  return (
    <div className="lk-panel lk-done of-done">
      {now ? (
        <div className="w-sheet-cheer lk-cheer">
          <Art name="kovi-cheer" size={104} />
          <Art name="sparkle-4" size={22} className="w-spark w-spark-1" />
          <Art name="sparkle-8" size={26} className="w-spark w-spark-2" />
          <Art name="sparkle-11" size={18} className="w-spark w-spark-3" />
        </div>
      ) : (
        <Art name="kovi-catch" size={96} className="lk-closed-art" />
      )}
      <h2 className="lk-done-h">{now ? 'Settled' : 'Already settled'}</h2>
      <p className="lk-done-p">
        {now
          ? `${amount} from ${sender} went to ${toLabel}.`
          : `Someone handed it in${settled.at ? ` ${ago(settled.at)}` : ''}. ${amount} from ${sender} went to ${toLabel}.`}
      </p>
      {now ? (
        <span className="w-sheet-time">
          <Icon name="bolt" size={14} />
          Settled in {((settled.ms ?? 0) / 1000).toFixed((settled.ms ?? 0) < 10_000 ? 1 : 0)} s on
          Monad
        </span>
      ) : null}
      {settled.explorer ? (
        <a href={settled.explorer} className="lk-explorer" target="_blank" rel="noreferrer">
          See it on Monadscan <Icon name="external" size={14} />
        </a>
      ) : (
        <span className="of-indexing">
          <span className="spinner" aria-hidden="true" /> Finding its transaction…
        </span>
      )}
      {yours && balance !== null ? (
        <p className="of-balance">
          <small>Your balance</small>
          <strong>{formatUsd(balance)}</strong>
        </p>
      ) : null}
      <div className="lk-done-ways">
        {yours || hasWallet ? (
          <Link href="/wallet" className="pill pill-block" data-tone="ink">
            <span className="pill-label">Open my wallet</span>
            <span className="pill-cap">
              <Icon name="arrow" size={18} />
            </span>
          </Link>
        ) : (
          <Link href="/wallet" className="pill pill-block" data-tone="light">
            <span className="pill-label">Get a Kova wallet</span>
            <span className="pill-cap">
              <Icon name="arrow" size={18} />
            </span>
          </Link>
        )}
      </div>
    </div>
  )
}

/** A code that fails its own checks: changed after signing, over the cap, or not dollars Kova knows. */
function Invalid({
  reason,
  payment,
}: {
  reason: 'bad-signature' | 'too-large' | 'zero' | 'unknown-token' | 'unknown-network'
  payment: OfflinePayment
}) {
  const first = payment.name?.trim().split(' ')[0] || null
  const ask = first ? `Ask ${first} to send it again.` : 'Ask the sender to send it again.'
  const [title, body] =
    reason === 'bad-signature'
      ? [
          'The signature doesn’t match',
          `Something in this code changed after it was signed, so it can’t pay anyone and nothing can move with it. ${ask}`,
        ]
      : reason === 'too-large'
        ? [
            'Over the offline limit',
            'A payment made with no signal carries $100 at most. This one can’t settle.',
          ]
        : reason === 'zero'
          ? ['This payment is empty', 'It moves no money, so there’s nothing to settle.']
          : [
              'Kova can’t settle this',
              'It’s signed for dollars or a network Kova doesn’t pay with.',
            ]
  return (
    <div className="lk-grid of-grid of-grid-one">
      <div className="lk-panel lk-closed lk-missing of-bad" role="alert">
        <Art name="kovi-oops" size={96} className="lk-closed-art" priority />
        <h1 className="lk-h">{title}</h1>
        <p className="w-lead">{body}</p>
        <Link href="/wallet" className="pill pill-block" data-tone="light">
          <span className="pill-label">Open Kova</span>
          <span className="pill-cap">
            <Icon name="arrow" size={18} />
          </span>
        </Link>
      </div>
    </div>
  )
}

/** No code, or something that isn't one: say so, and take a pasted link or code instead. */
function Unopened({ kind }: { kind: 'empty' | 'not-a-code' }) {
  const [pasted, setPasted] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const open = async () => {
    const result = await readOfflineCode(pasted)
    if (!result.ok && result.reason === 'not-a-code')
      return setProblem('That isn’t a payment code. Paste the whole link or code.')
    const code = pasted.trim().replace(/^.*#/, '')
    window.location.hash = code
  }
  return (
    <div className="lk-grid of-grid of-grid-one">
      <div
        className="lk-panel lk-closed lk-missing of-bad"
        role={kind === 'empty' ? undefined : 'alert'}
      >
        <Art
          name={kind === 'empty' ? 'kovi-wave' : 'kovi-oops'}
          size={96}
          className="lk-closed-art"
          priority
        />
        <h1 className="lk-h">
          {kind === 'empty' ? 'Open a payment made with no signal' : 'This isn’t a payment code'}
        </h1>
        <p className="w-lead">
          {kind === 'empty'
            ? 'A Kova phone with no signal can still pay: it signs the payment and shows it as a QR or a link. Open the link, or paste it here.'
            : 'The link may be cut short. Open the whole link as it was sent, paste it here, or ask for it again.'}
        </p>
        <form
          className="lk-paste of-paste"
          onSubmit={(e) => {
            e.preventDefault()
            void open()
          }}
        >
          <label htmlFor="of-code">Payment link or code</label>
          <div className="lk-paste-row">
            <input
              id="of-code"
              value={pasted}
              onChange={(e) => {
                setPasted(e.target.value)
                setProblem(null)
              }}
              placeholder="mykova.app/o#…"
              spellCheck={false}
              autoComplete="off"
            />
            <button type="submit" disabled={!pasted.trim()}>
              Open
            </button>
          </div>
          {problem ? (
            <small className="of-paste-problem" role="alert">
              {problem}
            </small>
          ) : null}
        </form>
      </div>
    </div>
  )
}

function dateLabel(d: Date) {
  return d.toLocaleString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function inLabel(d: Date) {
  const minutes = Math.round((d.getTime() - Date.now()) / 60_000)
  if (minutes <= 0) return 'Ran out'
  if (minutes < 60) return `${minutes} min left`
  const hours = Math.round(minutes / 60)
  if (hours < 36) return `${hours} h left`
  return `${Math.round(hours / 24)} days left`
}

function ago(iso: string) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (!Number.isFinite(minutes) || minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `on ${new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' })}`
}
