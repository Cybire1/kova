'use client'

import Link from 'next/link'
import type { Summary, Terminal } from '@/lib/api'
import { ago, usd } from '@/lib/format'
import { Awning } from './awning'
import { Art, Icon } from './brand'

const MINUTE = 60_000

function status(t: Terminal): { word: string; state: 'live' | 'recent' | 'idle' } {
  const seen = t.last_seen_at
    ? Date.now() - new Date(t.last_seen_at).getTime()
    : Number.POSITIVE_INFINITY
  if (seen < 15 * MINUTE) return { word: 'Taking payments', state: 'live' }
  if (seen < 3 * 60 * MINUTE)
    return { word: `Used ${ago(t.last_seen_at as string)}`, state: 'recent' }
  return {
    word: t.last_seen_at
      ? `Idle since ${new Date(t.last_seen_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : 'Not used yet',
    state: 'idle',
  }
}

/**
 * Where today's money came from: each paired phone drawn as a phone with its own takings,
 * the API as its own tile, and a place to pair another. An idle phone's Kovi is asleep.
 */
export function Sources({
  terminals,
  byTerminal,
  byStall,
  onAdd,
}: {
  terminals: Terminal[]
  byTerminal: Summary['by_terminal']
  byStall: Summary['by_stall']
  onAdd: () => void
}) {
  const online = byTerminal.find((b) => b.terminal === null)
  // Nothing to show yet: one line that starts the first phone, not an empty shelf.
  if (terminals.length === 0 && byStall.length === 0 && !online)
    return (
      <section className="src" aria-label="Where today’s money came from">
        <div className="src-head">
          <h2>Where it came from</h2>
          <Link href="/dashboard/terminals">Manage terminals</Link>
        </div>
        <button type="button" className="src-first" onClick={onAdd}>
          <Art name="badge-add" size={44} />
          <span className="src-first-text">
            <strong>Pair your first phone</strong>
            <small>Any phone with Kova becomes a till, with its own takings here.</small>
          </span>
          <Icon name="chevron" size={18} />
        </button>
      </section>
    )
  return (
    <section className="src" aria-label="Where today’s money came from">
      <div className="src-head">
        <h2>Where it came from</h2>
        <Link href="/dashboard/terminals">Manage terminals</Link>
      </div>
      <div className="src-row">
        {terminals.map((t) => {
          const taken = byTerminal.find((b) => b.terminal?.id === t.id)
          const s = status(t)
          return (
            <Link key={t.id} href="/dashboard/terminals" className="phone" data-state={s.state}>
              <span className="phone-screen">
                <span className="phone-notch" aria-hidden="true" />
                {s.state === 'idle' ? (
                  <Art name="kovi-sleep" size={64} className="phone-kovi" />
                ) : null}
                <span className="phone-name">{t.name}</span>
                <span className="phone-status">
                  <span className="phone-dot" />
                  {s.word}
                </span>
                <span className="phone-money">{usd(taken?.total ?? '0')}</span>
                <span className="phone-count">
                  {taken?.count ?? 0} {taken?.count === 1 ? 'payment' : 'payments'} today
                </span>
              </span>
            </Link>
          )
        })}
        {byStall.map((s) => (
          <Link key={s.stall.id} href="/dashboard/stalls" className="phone phone-stall">
            <Awning height={40} />
            <span className="phone-name">{s.stall.name}</span>
            <span className="phone-status">Stall orders</span>
            <span className="phone-money">{usd(s.total)}</span>
            <span className="phone-count">
              {s.count} {s.count === 1 ? 'order' : 'orders'} today
            </span>
          </Link>
        ))}
        {online ? (
          <Link href="/dashboard/developers" className="phone phone-api">
            <span className="phone-api-icon">
              <Icon name="code" size={20} />
            </span>
            <span className="phone-name">Online and API</span>
            <span className="phone-status">Your own site or app</span>
            <span className="phone-money">{usd(online.total)}</span>
            <span className="phone-count">
              {online.count} {online.count === 1 ? 'payment' : 'payments'} today
            </span>
          </Link>
        ) : null}
        <button type="button" className="phone phone-add" onClick={onAdd}>
          <Art name="badge-add" size={60} />
          <span>{terminals.length ? 'Pair another phone' : 'Pair your first phone'}</span>
        </button>
      </div>
    </section>
  )
}
