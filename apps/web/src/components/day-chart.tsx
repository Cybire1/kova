'use client'

import { useState } from 'react'
import type { Summary } from '@/lib/api'
import { usd } from '@/lib/format'

const hourName = (h: number) => (h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`)
const hourShort = (h: number) => String(h % 12 === 0 ? 12 : h % 12)

interface Bar {
  key: string
  value: number
  count: number
  state: 'past' | 'now' | 'future'
  label: string
  tip: string
  top?: string
}

/**
 * The shop's day as bars, one per hour, the current hour in coral and the rest of the day
 * still to come drawn dashed. Switch to the last fourteen days for the longer view.
 */
export function DayChart({ hourly, daily }: { hourly: Summary['hourly']; daily: Summary['daily'] }) {
  const [range, setRange] = useState<'today' | 'days'>('today')
  const now = new Date().getHours()

  let bars: Bar[]
  if (range === 'today') {
    const active = hourly.filter((h) => h.count > 0).map((h) => h.hour)
    const start = Math.min(7, now, ...active)
    const end = Math.min(23, Math.max(18, now + 1, ...active))
    bars = hourly
      .filter((h) => h.hour >= start && h.hour <= end)
      .map((h) => {
        const state = h.hour < now ? 'past' : h.hour === now ? 'now' : 'future'
        const first = h.hour === start
        const last = h.hour === end
        return {
          key: String(h.hour),
          value: Number(h.total),
          count: h.count,
          state,
          label: state === 'now' ? 'Now' : first || last || h.hour === 12 ? hourName(h.hour) : hourShort(h.hour),
          tip: `${hourName(h.hour)} to ${hourName((h.hour + 1) % 24)}`,
        }
      })
  } else {
    bars = daily.map((d, i) => {
      const date = new Date(`${d.date}T12:00:00`)
      const today = i === daily.length - 1
      return {
        key: d.date,
        value: Number(d.total),
        count: d.count,
        state: today ? 'now' : 'past',
        label: today ? 'Today' : date.toLocaleDateString([], { weekday: 'narrow' }),
        tip: date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }),
      }
    })
  }

  const max = Math.max(...bars.map((b) => b.value), 0)
  const best = max > 0 ? bars.findIndex((b) => b.value === max) : -1
  for (const [i, b] of bars.entries()) {
    if (b.state === 'now' && range === 'today') b.top = b.value > 0 ? `${usd(b.value)} so far` : undefined
    else if (i === best) b.top = usd(b.value)
  }
  const total = bars.reduce((sum, b) => sum + b.value, 0)
  const empty = max === 0

  return (
    <section className="dc" aria-label="Takings over time">
      <div className="dc-head">
        <div>
          <h2>{range === 'today' ? 'The day so far' : 'The last 14 days'}</h2>
          <p>{empty ? (range === 'today' ? 'Your day starts with the first payment.' : 'Nothing yet. It fills in as payments land.') : `${usd(total)} across ${bars.reduce((n, b) => n + b.count, 0)} payments`}</p>
        </div>
        <fieldset className="seg" aria-label="Range">
          <button type="button" aria-pressed={range === 'today'} onClick={() => setRange('today')}>
            Today
          </button>
          <button type="button" aria-pressed={range === 'days'} onClick={() => setRange('days')}>
            14 days
          </button>
        </fieldset>
      </div>
      <ol className="dc-bars" data-range={range} data-empty={empty ? 'true' : undefined} style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` }}>
        {bars.map((b, i) => {
          const height = b.state === 'future' || max === 0 ? 0 : Math.max((b.value / max) * 100, b.value > 0 ? 7 : 0)
          return (
            <li key={b.key} className="dc-bar" data-state={b.state} tabIndex={b.state === 'future' ? -1 : 0} aria-label={`${b.tip}: ${usd(b.value)}, ${b.count} payments`}>
              <span className="dc-tip" aria-hidden="true">
                <strong>{usd(b.value)}</strong>
                {b.count} {b.count === 1 ? 'payment' : 'payments'}, {b.tip}
              </span>
              <span className="dc-col">
                {b.top ? <span className="dc-top">{b.top}</span> : null}
                {b.state === 'future' || height === 0 ? (
                  <span className="dc-stub" />
                ) : (
                  <span className="dc-fill" style={{ height: `${height}%`, animationDelay: `${i * 30}ms` }} />
                )}
              </span>
              <span className="dc-label">{b.label}</span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
