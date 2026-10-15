'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Art, Icon, Pill } from '@/components/brand'
import type { PaymentIntent, Summary, Terminal } from '@/lib/api'
import { ago, usd } from '@/lib/format'
import { DayChart } from './day-chart'
import { Odometer } from './odometer'
import { PairSheet } from './pair-sheet'
import { Sources } from './sources'
import { Tape } from './tape'

const hourName = (h: number) =>
  h === 0 ? 'midnight' : h < 12 ? `${h}am` : h === 12 ? 'noon' : `${h - 12}pm`

/**
 * The overview, kept live: the total rolls, new payments print on the tape, and the day's
 * bars and each phone's takings follow within a couple of seconds.
 */
export function OverviewLive({
  initialSummary,
  initialIntents,
  initialTerminals,
  hasWebhook,
}: {
  initialSummary: Summary
  initialIntents: PaymentIntent[]
  initialTerminals: Terminal[]
  hasWebhook: boolean
}) {
  const [summary, setSummary] = useState(initialSummary)
  const [intents, setIntents] = useState(initialIntents)
  const [terminals, setTerminals] = useState(initialTerminals)
  const [connected, setConnected] = useState(true)
  const [pairing, setPairing] = useState(false)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const [hop, setHop] = useState(0)
  const seen = useRef(new Set(initialIntents.map((i) => `${i.id}:${i.status}`)))
  const [, setNow] = useState(0)

  useEffect(() => {
    let cancelled = false
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const tick = async () => {
      try {
        const response = await fetch(`/api/feed?tz=${encodeURIComponent(tz)}`)
        if (response.status === 401) return window.location.assign('/signin?expired=1')
        if (!response.ok) throw new Error(String(response.status))
        const data = (await response.json()) as {
          summary: Summary
          intents: PaymentIntent[]
          terminals: Terminal[]
        }
        if (cancelled) return
        const landed = data.intents.filter((i) => !seen.current.has(`${i.id}:${i.status}`))
        for (const intent of data.intents) seen.current.add(`${intent.id}:${intent.status}`)
        setSummary(data.summary)
        setIntents(data.intents)
        setTerminals(data.terminals)
        setConnected(true)
        if (landed.length) {
          setFresh(new Set(landed.map((i) => i.id)))
          if (landed.some((i) => i.status === 'paid')) setHop((n) => n + 1)
        }
      } catch {
        if (!cancelled) setConnected(false)
      }
      setNow(Date.now()) // keeps "3 min ago" honest
    }
    tick()
    const id = setInterval(tick, 2000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const [whole, cents] = usd(summary.today.total).split('.')
  const count = summary.today.count
  const busiest = summary.hourly.reduce<Summary['hourly'][number] | null>(
    (best, h) => (h.count > 0 && (!best || Number(h.total) > Number(best.total)) ? h : best),
    null,
  )
  const average = count ? Number(summary.today.total) / count : 0

  const steps = [
    {
      done: terminals.length > 0,
      label: 'Pair a phone as a terminal',
      cta: 'Pair a phone',
      action: () => setPairing(true),
    },
    {
      done: summary.all_time.count > 0,
      label: 'Take your first payment',
      cta: 'Start a charge',
      href: '/charge',
    },
    {
      done: hasWebhook,
      label: 'Send payments to your own systems',
      cta: 'Add a webhook',
      href: '/dashboard/developers',
    },
  ]
  const next = steps.find((s) => !s.done)
  const doneCount = steps.filter((s) => s.done).length + 1

  return (
    <div className="ov">
      <header className="ov-head">
        <div className="ov-shop">
          <Art name="badge-shop" size={56} priority />
          <div>
            <h1>{summary.merchant.name}</h1>
            <p>
              {new Date().toLocaleDateString([], {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </p>
          </div>
        </div>
        <Pill href="/charge" icon="tap" tone="coral" className="desk-charge">
          New charge
        </Pill>
      </header>

      <section className="ov-total" aria-label="Taken today">
        <p className="ov-label">Taken today</p>
        <p className="ov-amount">
          <Odometer value={whole ?? '$0'} />
          <span className="ov-cents">
            .<Odometer value={cents ?? '00'} />
          </span>
        </p>
        <div className="ov-chips">
          <span className="chip">
            {count} {count === 1 ? 'payment' : 'payments'}
          </span>
          {count ? <span className="chip">Average {usd(average)}</span> : null}
          {busiest ? <span className="chip">Busiest hour, {hourName(busiest.hour)}</span> : null}
          {summary.last_paid_at ? (
            <span className="chip">Last {ago(summary.last_paid_at)}</span>
          ) : null}
          {summary.open_intents > 0 ? (
            <Link href="/dashboard/payments?status=requires_payment" className="chip chip-coral">
              {summary.open_intents} waiting
            </Link>
          ) : null}
        </div>
      </section>

      {next ? (
        <section className="setup" aria-label="Get set up">
          <div className="setup-dots" aria-hidden="true">
            {[true, ...steps.map((s) => s.done)].map((done, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed four steps
              <span key={i} data-done={done ? 'true' : undefined} />
            ))}
          </div>
          <p>
            <strong>
              {doneCount} of {steps.length + 1} set up.
            </strong>{' '}
            Next: {next.label.toLowerCase()}.
          </p>
          {next.href ? (
            <Link href={next.href} className="mini mini-ink">
              {next.cta} <Icon name="arrow" size={14} />
            </Link>
          ) : (
            <button type="button" className="mini mini-ink" onClick={next.action}>
              {next.cta} <Icon name="arrow" size={14} />
            </button>
          )}
        </section>
      ) : null}

      <DayChart hourly={summary.hourly} daily={summary.daily} />

      <Sources
        terminals={terminals}
        byTerminal={summary.by_terminal}
        byStall={summary.by_stall ?? []}
        onAdd={() => setPairing(true)}
      />

      <Tape intents={intents} fresh={fresh} connected={connected} hop={hop} />

      {pairing ? (
        <PairSheet
          known={terminals.map((t) => t.id)}
          onPaired={(list) => setTerminals(list)}
          onClose={() => setPairing(false)}
        />
      ) : null}
    </div>
  )
}
