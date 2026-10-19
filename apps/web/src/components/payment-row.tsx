import Link from 'next/link'
import type { PaymentIntent } from '@/lib/api'
import { usd } from '@/lib/format'
import { Icon } from './brand'

export const statusText: Record<PaymentIntent['status'], string> = {
  paid: 'Paid',
  requires_payment: 'Waiting',
  processing: 'Confirming',
  held: 'Held by their wallet',
  failed: 'Failed',
  canceled: 'Canceled',
  expired: 'Expired',
}

export function clock(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** One charge: what it was for, where it stands, and the money. Opens the charge. */
export function PaymentRow({
  intent,
  fresh,
  showDate,
}: {
  intent: PaymentIntent
  fresh?: boolean
  showDate?: boolean
}) {
  const when = intent.paid_at ?? intent.created_at
  const open = intent.status === 'requires_payment' || intent.status === 'processing'
  return (
    <li className="row-item" data-new={fresh ? 'true' : undefined}>
      <Link href={`/dashboard/payments/${intent.id}`} className="row" data-status={intent.status}>
        <span className="row-icon">
          <Icon name={intent.status === 'paid' ? 'check' : open ? 'tap' : 'close'} size={18} />
        </span>
        <span className="row-text">
          <span className="row-title" data-none={intent.reference ? undefined : 'true'}>
            {intent.reference ?? 'Payment'}
          </span>
          <span className="row-sub">
            {statusText[intent.status]},{' '}
            {showDate
              ? `${new Date(when).toLocaleDateString([], { day: 'numeric', month: 'short' })}, `
              : ''}
            {clock(when)}
          </span>
        </span>
        <span className="row-amount">
          {intent.status === 'paid' ? `+${usd(intent.amount)}` : usd(intent.amount)}
        </span>
        <span className="row-go" aria-hidden="true">
          <Icon name="chevron" size={16} />
        </span>
      </Link>
    </li>
  )
}
