import type { Metadata } from 'next'
import { Pill } from '@/components/brand'
import { PaymentsBrowser } from '@/components/payments-browser'
import { PageHead } from '@/components/shell'
import { type IntentList, kova, type Summary } from '@/lib/api'
import { usd } from '@/lib/format'

export const metadata: Metadata = { title: 'Payments' }

const STATUSES = new Set(['paid', 'requires_payment', 'expired', 'canceled', 'failed'])

export default async function PaymentsPage(props: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const params = await props.searchParams
  const status = params.status && STATUSES.has(params.status) ? params.status : undefined
  const q = params.q?.trim() || undefined
  const query = new URLSearchParams({ limit: '25' })
  if (status) query.set('status', status)
  if (q) query.set('q', q)
  const [list, summary] = await Promise.all([kova<IntentList>(`/v1/payment_intents?${query}`), kova<Summary>('/v1/summary')])

  return (
    <>
      <PageHead title="Payments" sub={`${summary.all_time.count} paid, ${usd(summary.all_time.total)} all time`}>
        <Pill href="/charge" icon="tap" tone="coral" className="desk-charge">
          New charge
        </Pill>
      </PageHead>
      {/* keyed by the filters, so changing them starts a fresh list */}
      <PaymentsBrowser key={`${status}-${q}`} initial={list} status={status} q={q} />
    </>
  )
}
