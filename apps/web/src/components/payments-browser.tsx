'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { IntentList, PaymentIntent } from '@/lib/api'
import { usd } from '@/lib/format'
import { Art, Icon } from './brand'
import { PaymentRow, statusText } from './payment-row'

const FILTERS: { label: string; status?: string }[] = [
  { label: 'All' },
  { label: 'Paid', status: 'paid' },
  { label: 'Waiting', status: 'requires_payment' },
  { label: 'Expired', status: 'expired' },
  { label: 'Canceled', status: 'canceled' },
  { label: 'Failed', status: 'failed' },
]

function dayOf(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
}

function toCsv(rows: PaymentIntent[]) {
  const cells = (v: string | null) => `"${(v ?? '').replaceAll('"', '""')}"`
  const head = ['id', 'created_at', 'paid_at', 'status', 'amount', 'currency', 'reference']
  return [head.join(','), ...rows.map((r) => [r.id, r.created_at, r.paid_at, statusText[r.status], r.amount, r.currency, r.reference].map(cells).join(','))].join('\n')
}

/** Every charge, newest first, grouped by day. Filters and search live in the URL, so they share and reload. */
export function PaymentsBrowser({ initial, status, q }: { initial: IntentList; status?: string; q?: string }) {
  const [rows, setRows] = useState(initial.data)
  const [cursor, setCursor] = useState(initial.has_more ? initial.next_before : null)
  const [loading, setLoading] = useState(false)

  const groups = useMemo(() => {
    const out: { day: string; rows: PaymentIntent[]; total: number }[] = []
    for (const row of rows) {
      const day = dayOf(row.created_at)
      let group = out.at(-1)
      if (!group || group.day !== day) {
        group = { day, rows: [], total: 0 }
        out.push(group)
      }
      group.rows.push(row)
      if (row.status === 'paid') group.total += Number(row.amount)
    }
    return out
  }, [rows])

  const more = async () => {
    if (!cursor) return
    setLoading(true)
    const params = new URLSearchParams({ before: cursor })
    if (status) params.set('status', status)
    if (q) params.set('q', q)
    const response = await fetch(`/api/payments?${params}`)
    if (response.ok) {
      const page = (await response.json()) as IntentList
      setRows((r) => [...r, ...page.data])
      setCursor(page.has_more ? page.next_before : null)
    }
    setLoading(false)
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: `kova-payments-${new Date().toISOString().slice(0, 10)}.csv` })
    a.click()
    URL.revokeObjectURL(url)
  }

  const href = (next: { status?: string; q?: string }) => {
    const params = new URLSearchParams()
    if (next.status) params.set('status', next.status)
    if (next.q) params.set('q', next.q)
    const s = params.toString()
    return `/dashboard/payments${s ? `?${s}` : ''}`
  }

  // Nothing to filter or search until the first charge.
  const untouched = rows.length === 0 && !q && !status

  return (
    <>
      {untouched ? null : (
        <div className="toolbar">
          <nav className="filters" aria-label="Filter by status">
            {FILTERS.map((f) => (
              <Link key={f.label} href={href({ status: f.status, q })} className="filter" aria-current={(f.status ?? '') === (status ?? '') ? 'true' : undefined}>
                {f.label}
              </Link>
            ))}
          </nav>
          <form className="search" action="/dashboard/payments" role="search">
            {status ? <input type="hidden" name="status" value={status} /> : null}
            <Icon name="search" size={18} />
            <input name="q" defaultValue={q} placeholder="Search what it was for" aria-label="Search payments" />
          </form>
        </div>
      )}

      {rows.length === 0 ? (
        <section className="card empty big-empty">
          <Art name="kovi-sleep" size={150} />
          <h3>{q || status ? 'Nothing matches' : 'No payments yet'}</h3>
          <p>{q || status ? 'Try another filter, or clear the search.' : 'Charges you start from a terminal or this dashboard show up here the moment they’re made.'}</p>
          {q || status ? (
            <Link className="textlink" href="/dashboard/payments">
              Clear filters
            </Link>
          ) : null}
        </section>
      ) : (
        <section className="card" aria-label="Payments">
          {groups.map((g) => (
            <div key={g.day} className="daygroup">
              <div className="dayhead">
                <span>{g.day}</span>
                {g.total > 0 ? <span>{usd(g.total)} paid</span> : null}
              </div>
              <ul className="rows">
                {g.rows.map((intent) => (
                  <PaymentRow key={intent.id} intent={intent} />
                ))}
              </ul>
            </div>
          ))}
          <div className="foot">
            <button type="button" className="textlink small linkbutton" onClick={download}>
              <Icon name="download" size={15} /> Download these as CSV
            </button>
            {cursor ? (
              <button type="button" className="mini" onClick={more} disabled={loading}>
                {loading ? 'Loading' : 'Show more'}
              </button>
            ) : (
              <span>
                {rows.length} {rows.length === 1 ? 'charge' : 'charges'}
              </span>
            )}
          </div>
        </section>
      )}
    </>
  )
}
