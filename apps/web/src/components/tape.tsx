'use client'

import Link from 'next/link'
import type { PaymentIntent } from '@/lib/api'
import { usd } from '@/lib/format'
import { Art, Pill } from './brand'

const statusWord: Record<PaymentIntent['status'], string> = {
  paid: 'Paid',
  requires_payment: 'Waiting',
  processing: 'Confirming',
  held: 'Held',
  failed: 'Failed',
  canceled: 'Canceled',
  expired: 'Expired',
}

const hourOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric' })
const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/**
 * The live tape: payments print out of the slot as they land, newest on top, with a cut line
 * between the hours. Kovi keeps watch over the slot and hops when money comes in.
 */
export function Tape({
  intents,
  fresh,
  connected,
  hop,
}: {
  intents: PaymentIntent[]
  fresh: Set<string>
  connected: boolean
  hop: number
}) {
  const rows: React.ReactNode[] = []
  let lastHour: string | null = null
  for (const intent of intents) {
    const at = intent.paid_at ?? intent.created_at
    const hour = hourOf(at)
    if (lastHour !== null && hour !== lastHour)
      rows.push(
        <li key={`cut-${intent.id}`} className="tape-cut" aria-hidden="true">
          <span>{hour}</span>
        </li>,
      )
    lastHour = hour
    const open = intent.status === 'requires_payment' || intent.status === 'processing'
    rows.push(
      <li
        key={intent.id}
        className="tape-line"
        data-status={intent.status}
        data-new={fresh.has(intent.id) ? 'true' : undefined}
      >
        <Link href={`/dashboard/payments/${intent.id}`}>
          <span className="tape-time">{timeOf(at)}</span>
          <span className="tape-what">
            <span className="tape-title" data-none={intent.reference ? undefined : 'true'}>
              {intent.reference ?? 'Payment'}
            </span>
            <span className="tape-from">
              {intent.order?.stall?.name ?? intent.terminal?.name ?? 'Online'}
              {intent.order?.customer_name ? `, for ${intent.order.customer_name}` : ''}
            </span>
          </span>
          <span className="tape-money">
            <span className="tape-amount">{usd(intent.amount)}</span>
            <span className="tape-status">{open ? 'Waiting' : statusWord[intent.status]}</span>
          </span>
        </Link>
      </li>,
    )
  }

  return (
    <section className="tape" aria-label="Live payments">
      <div className="tape-top">
        <Art
          key={hop}
          name="kovi-peek"
          size={150}
          className={`tape-kovi${hop > 0 ? ' is-hopping' : ''}`}
          priority
        />
        <div className="tape-slot" data-state={connected ? 'live' : 'stale'}>
          <span className="tape-led" />
          <span>{connected ? 'Live' : 'Reconnecting'}</span>
          <span className="tape-mouth" aria-hidden="true" />
        </div>
      </div>
      <div className="tape-paper">
        <div className="tape-head">
          <span>{intents.length ? 'Printing as payments land' : 'Nothing printed yet'}</span>
          <Link href="/dashboard/payments">See all</Link>
        </div>
        {intents.length ? (
          <ol className="tape-lines">{rows}</ol>
        ) : (
          <div className="tape-empty">
            <p>Your first payment prints right here, the second it lands.</p>
            <Pill href="/charge" icon="tap" tone="coral">
              Start a charge
            </Pill>
          </div>
        )}
      </div>
    </section>
  )
}
