'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Icon } from '@/components/brand'
import { baseToNumber, formatLocal, formatUsd } from '@/lib/wallet/money'
import { isOfflineTx } from '@/lib/wallet/offline'
import { CheckPrivate } from './private'
import { type Entry, isUnnamed, short, useWallet } from './provider'
import { Avatar, EntryBadge, EntryRow, incoming, LockedFace, NoSignal, signed } from './ui'

/** A screen's title, with the way back. */
export function ScreenHead({
  title,
  back = '/wallet',
  children,
}: {
  title: string
  back?: string
  children?: React.ReactNode
}) {
  return (
    <div className="w-head">
      <Link href={back} className="round" aria-label="Back">
        <Icon name="back" size={18} />
      </Link>
      <h1>{title}</h1>
      <span className="w-head-end">{children}</span>
    </div>
  )
}

type Filter = 'all' | 'out' | 'in'

const dayLabel = (at: number) => {
  const d = new Date(at)
  if (d.toDateString() === new Date().toDateString()) return 'Today'
  if (d.toDateString() === new Date(Date.now() - 86_400_000).toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
}

/**
 * Everything that moved, the app's Activity: this month at a glance (what came in, what went out,
 * the last seven days), then every payment by day. It's Kova's index of Monad, so it's the same
 * history on every device.
 */
export function Activity() {
  const { activity, profile, rates, privateUnchecked } = useWallet()
  const locked = activity.some((e) => e.locked)
  const [filter, setFilter] = useState<Filter>('all')

  const month = useMemo(() => {
    const start = new Date()
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
    let inn = 0n
    let out = 0n
    for (const e of activity) {
      if (e.at < start.getTime()) continue
      if (incoming(e)) inn += BigInt(e.amount)
      else out += BigInt(e.amount)
    }
    const days = Array.from({ length: 7 }, (_, i) => {
      const day = new Date()
      day.setHours(0, 0, 0, 0)
      day.setDate(day.getDate() - (6 - i))
      const next = day.getTime() + 86_400_000
      let dayIn = 0n
      let dayOut = 0n
      for (const e of activity) {
        if (e.at < day.getTime() || e.at >= next) continue
        if (incoming(e)) dayIn += BigInt(e.amount)
        else dayOut += BigInt(e.amount)
      }
      return {
        at: day.getTime(),
        label: day.toLocaleDateString([], { weekday: 'narrow' }),
        dayIn,
        dayOut,
      }
    })
    const peak = days.reduce((m, d) => (d.dayIn + d.dayOut > m ? d.dayIn + d.dayOut : m), 0n)
    return { name: start.toLocaleDateString([], { month: 'long' }), inn, out, days, peak }
  }, [activity])

  const shown = activity.filter((e) =>
    filter === 'all' ? true : filter === 'in' ? incoming(e) : !incoming(e),
  )
  const groups: { label: string; entries: Entry[]; net: bigint }[] = []
  for (const e of shown) {
    const label = dayLabel(e.at)
    let group = groups.at(-1)
    if (!group || group.label !== label) {
      group = { label, entries: [], net: 0n }
      groups.push(group)
    }
    group.entries.push(e)
    group.net += incoming(e) ? BigInt(e.amount) : -BigInt(e.amount)
  }

  const net = month.inn - month.out
  const total = month.inn + month.out
  return (
    <div className="w-screen">
      <ScreenHead title="Activity" />

      <section
        className="w-month"
        aria-label={`${month.name}: ${formatUsd(month.inn)} in, ${formatUsd(month.out)} out`}
      >
        <span className="w-month-label">{month.name}, net</span>
        <strong className={`w-month-net${net < 0n ? ' w-month-down' : ''}`}>
          {formatUsd(net, { sign: true })}
        </strong>
        {profile && profile.currency !== 'USD' ? (
          <span className="w-month-local">
            ≈ {formatLocal(baseToNumber(net < 0n ? -net : net), profile.currency, rates)}
          </span>
        ) : null}
        <div className="w-split" aria-hidden="true">
          {total === 0n ? (
            <span className="w-split-empty" />
          ) : (
            <>
              <span className="w-split-in" style={{ flexGrow: Number(month.inn) || 0.0001 }} />
              <span className="w-split-out" style={{ flexGrow: Number(month.out) || 0.0001 }} />
            </>
          )}
        </div>
        <div className="w-split-legend">
          <span>
            <i className="w-dot-in" /> In {formatUsd(month.inn)}
          </span>
          <span>
            <i className="w-dot-out" /> Out {formatUsd(month.out)}
          </span>
        </div>
        <span className="w-week-caption">Last 7 days</span>
        <div className={`w-week${month.peak === 0n ? ' w-week-quiet' : ''}`} aria-hidden="true">
          {month.days.map((d, i) => {
            const height = (v: bigint) =>
              month.peak === 0n
                ? 0
                : Math.max(v > 0n ? 4 : 0, Math.round((Number(v) / Number(month.peak)) * 64))
            const quiet = d.dayIn === 0n && d.dayOut === 0n
            return (
              <span key={d.at} className={`w-week-day${i === 6 ? ' w-week-today' : ''}`}>
                <span className="w-week-bar">
                  {/* A quiet day is a small stub, not an empty column. */}
                  {quiet ? <i className="w-week-none" /> : null}
                  {d.dayIn > 0n ? (
                    <i className="w-week-in" style={{ height: height(d.dayIn) }} />
                  ) : null}
                  {d.dayOut > 0n ? (
                    <i className="w-week-out" style={{ height: height(d.dayOut) }} />
                  ) : null}
                </span>
                <small>{d.label}</small>
              </span>
            )
          })}
        </div>
      </section>

      {/* The passkey that opens notes also looks for private payments: one ask, not two. */}
      {locked ? <ReadNotes /> : privateUnchecked ? <CheckPrivate /> : null}

      <div className="w-filters" role="tablist" aria-label="Show">
        {(
          [
            ['all', 'All'],
            ['out', 'Money out'],
            ['in', 'Money in'],
          ] as [Filter, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            className={`w-filter${filter === value ? ' w-filter-on' : ''}`}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <div className="w-empty">
          <strong>{activity.length === 0 ? 'Nothing here yet' : 'Nothing in this view'}</strong>
          <span>
            {activity.length === 0
              ? 'Pay a shop or send money to a friend and it shows up here.'
              : 'Try another filter.'}
          </span>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.label} className="w-day">
            <div className="w-day-head">
              <h2>{g.label}</h2>
              <span className={g.net > 0n ? 'w-in' : undefined}>
                {formatUsd(g.net, { sign: true })}
              </span>
            </div>
            <div className="w-day-card">
              {g.entries.map((e) => (
                <EntryRow key={e.id} entry={e} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}

const verb = { paid: 'Paid', sent: 'Sent', received: 'Received', added: 'Added' } as const
const direction = { paid: 'to', sent: 'to', received: 'from', added: 'from' } as const

/** One payment, as a receipt: who, what for, when, how long it took, what it cost, and proof on Monadscan. */
export function Receipt({ id }: { id: string }) {
  const { activity, renameContact, moveIn, movingIn } = useWallet()
  const entry = activity.find((e) => e.id === id || e.txHash.toLowerCase() === id.toLowerCase())
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  if (!entry)
    return (
      <div className="w-screen">
        <ScreenHead title="Receipt" back="/wallet/activity" />
        <div className="w-empty">
          <strong>Looking for this payment</strong>
          <span>
            It shows here as soon as Kova’s record of Monad has it, usually within a second or two.
          </span>
        </div>
      </div>
    )

  const privately = Boolean(entry.oneTime)
  /** Someone to name and send to: a private payment's person is known only once Kova has it. */
  const person = (entry.kind === 'sent' || entry.kind === 'received') && Boolean(entry.address)
  const fee =
    entry.kind === 'paid'
      ? '$0.00, covered by Kova'
      : entry.kind === 'sent'
        ? '$0.00, covered by Kova'
        : '$0.00'
  const first = entry.name ? (isUnnamed(entry.name) ? entry.name : entry.name.split(' ')[0]) : ''
  return (
    <div className="w-screen">
      <ScreenHead title="Receipt" back="/wallet/activity" />
      <article className="w-receipt">
        <div className="w-receipt-top">
          {privately ? (
            <LockedFace name={entry.name} id={entry.address} size={56} />
          ) : person ? (
            <Avatar name={entry.name} id={entry.address} size={56} />
          ) : (
            <EntryBadge entry={entry} size={56} />
          )}
          <span className="w-receipt-verb">
            {privately
              ? entry.kind === 'received'
                ? entry.name
                  ? 'Sent to you privately by'
                  : 'Sent to you privately'
                : entry.name
                  ? 'Sent privately to'
                  : 'Sent privately'
              : `${verb[entry.kind]} ${direction[entry.kind]}`}
          </span>
          {entry.unconfirmed ? (
            <span className="w-receipt-unconfirmed">
              Unconfirmed: only their sealed note says so
            </span>
          ) : null}
          {person && naming ? (
            <form
              className="w-receipt-rename"
              onSubmit={(e) => {
                e.preventDefault()
                if (entry.address && name.trim()) renameContact(entry.address, name)
                setNaming(false)
              }}
            >
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Their name"
                maxLength={40}
                aria-label="Their name"
              />
              <button type="submit" className="mini mini-ink">
                Save
              </button>
            </form>
          ) : entry.name ? (
            <strong className="w-receipt-name">
              {entry.name}
              {person ? (
                <button
                  type="button"
                  className="w-receipt-pen"
                  aria-label={isUnnamed(entry.name) ? 'Add their name' : 'Rename'}
                  onClick={() => {
                    setName(isUnnamed(entry.name) ? '' : entry.name)
                    setNaming(true)
                  }}
                >
                  <Icon name="pen" size={14} />
                </button>
              ) : null}
            </strong>
          ) : null}
          <span className={`w-receipt-amount${incoming(entry) ? ' w-in' : ''}`}>
            {signed(entry)}
          </span>
        </div>
        <dl className="w-receipt-rows">
          <div>
            <dt>When</dt>
            <dd>
              {new Date(entry.at).toLocaleString([], {
                day: 'numeric',
                month: 'long',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </dd>
          </div>
          {entry.private || entry.locked ? (
            <div className="w-receipt-note">
              <dt>
                <Icon name="lock" size={14} /> Private note
              </dt>
              <dd>
                {entry.locked ? <ReadNotes inline /> : entry.detail}
                <small>
                  {entry.locked
                    ? 'Sealed for the two of you. Your passkey opens it.'
                    : entry.private === 'both'
                      ? 'Sealed: only the two of you can read it'
                      : 'Sealed: only you can read it'}
                </small>
              </dd>
            </div>
          ) : entry.oneTime ? null : (
            <div>
              <dt>For</dt>
              <dd>{entry.detail}</dd>
            </div>
          )}
          {isOfflineTx(entry.txHash) ? (
            <div className="w-receipt-note">
              <dt>
                <NoSignal size={14} /> How
              </dt>
              <dd>
                Offline payment
                <small>Signed on a phone with no signal, settled when it was handed in</small>
              </dd>
            </div>
          ) : null}
          {entry.oneTime ? (
            <div className="w-receipt-note">
              <dt>
                <Icon name="lock" size={14} /> Paid to
              </dt>
              <dd>
                Its own address
                <small>
                  {short(entry.oneTime)},{' '}
                  {entry.kind === 'received'
                    ? 'only you can tell it’s yours'
                    : first
                      ? `only ${first} can tell it’s theirs`
                      : 'only they can tell it’s theirs'}
                </small>
              </dd>
            </div>
          ) : null}
          {entry.oneTime && entry.kind === 'received' ? (
            <div>
              <dt>Now</dt>
              <dd>
                {entry.waiting ? (
                  entry.used ? (
                    'Change, still private'
                  ) : (
                    'Private, ready to spend'
                  )
                ) : entry.movedIn ? (
                  <a href={entry.movedIn.explorer} target="_blank" rel="noreferrer">
                    In your balance
                  </a>
                ) : entry.used ? (
                  'Spent privately'
                ) : (
                  'In your balance'
                )}
              </dd>
            </div>
          ) : null}
          {entry.fromPrivate ? (
            <div className="w-receipt-note">
              <dt>
                <Icon name="lock" size={14} /> Paid from
              </dt>
              <dd>
                Private dollars
                <small>A one-time address paid it: Monad can’t tie it to you</small>
              </dd>
            </div>
          ) : null}
          {entry.oneTime ? (
            <div>
              <dt>On Monad</dt>
              <dd>
                {entry.announced ? (
                  <a
                    className="w-announced"
                    href={entry.announced}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Announced <Icon name="external" size={13} />
                  </a>
                ) : Date.now() - entry.at < 3 * 60_000 ? (
                  <span className="w-announcing">Announcing…</span>
                ) : (
                  'Not announced'
                )}
              </dd>
            </div>
          ) : null}
          {entry.ms ? (
            <div>
              <dt>Took</dt>
              <dd>{(entry.ms / 1000).toFixed(1)} seconds</dd>
            </div>
          ) : null}
          <div>
            <dt>Fee</dt>
            <dd>{fee}</dd>
          </div>
          <div>
            <dt>Amount</dt>
            <dd>{formatUsd(BigInt(entry.amount))} AUSD</dd>
          </div>
        </dl>
        {entry.explorer ? (
          <a className="w-receipt-proof" href={entry.explorer} target="_blank" rel="noreferrer">
            View on Monadscan <Icon name="external" size={15} />
          </a>
        ) : null}
      </article>
      {entry.oneTime && entry.kind === 'received' && entry.waiting ? (
        <>
          <MoveInHere busy={movingIn !== null} onMove={moveIn} />
          <p className="w-fine w-center w-receipt-public">
            Moving in is public on Monad: it shows these dollars reaching your wallet. Paying a shop
            or a friend straight from private dollars keeps them private.
          </p>
        </>
      ) : null}
      {person && entry.address ? (
        <Link
          href={`/wallet/send/${entry.address}${isUnnamed(entry.name) ? '' : `?name=${encodeURIComponent(entry.name)}`}`}
          className="pill pill-block w-receipt-again"
          data-tone={entry.oneTime && entry.waiting ? 'light' : 'coral'}
        >
          <span className="pill-label">
            {entry.kind === 'received' ? `Send some back to ${first}` : `Send ${first} more`}
          </span>
          <span className="pill-cap">
            <Icon name="send" size={18} />
          </span>
        </Link>
      ) : null}
    </div>
  )
}

/** On a private payment's receipt: bring it, and anything else waiting, into the wallet. */
function MoveInHere({ busy, onMove }: { busy: boolean; onMove: () => Promise<unknown> }) {
  const [problem, setProblem] = useState<string | null>(null)
  return (
    <>
      <button
        type="button"
        className="pill pill-block w-receipt-again"
        data-tone="coral"
        disabled={busy}
        onClick={async () => {
          setProblem(null)
          try {
            await onMove()
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Kova couldn’t move it in.'
            if (!/cancel|not allowed|abort/i.test(message)) setProblem(message)
          }
        }}
      >
        <span className="pill-label">{busy ? 'Moving in…' : 'Move into my balance'}</span>
        <span className="pill-cap">
          {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="down" size={18} />}
        </span>
      </button>
      {problem ? <p className="form-error">{problem}</p> : null}
    </>
  )
}

/** Private notes stay sealed after a reload (their key lives in memory); the passkey opens them. */
function ReadNotes({ inline }: { inline?: boolean }) {
  const { readNotes } = useWallet()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const read = async () => {
    setBusy(true)
    setProblem(null)
    try {
      await readNotes()
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Your passkey didn’t open them.')
    } finally {
      setBusy(false)
    }
  }
  if (inline)
    return (
      <button type="button" className="textlink" onClick={() => void read()} disabled={busy}>
        {busy ? 'Opening…' : 'Read it'}
      </button>
    )
  return (
    <div className="w-notes-locked">
      <span className="w-notes-locked-icon">
        <Icon name="lock" size={16} />
      </span>
      <span className="w-notes-locked-text">
        <strong>Private notes are sealed</strong>
        <small>
          {problem ??
            'Only you and the people you pay can read them. Your passkey opens them here.'}
        </small>
      </span>
      <button
        type="button"
        className="w-notes-locked-btn"
        onClick={() => void read()}
        disabled={busy}
      >
        {busy ? 'Opening…' : 'Read'}
      </button>
    </div>
  )
}
