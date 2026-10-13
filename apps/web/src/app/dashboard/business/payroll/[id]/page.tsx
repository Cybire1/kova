import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { RunReceipt } from '@/components/business'
import { ApiError, kova, type Merchant } from '@/lib/api'
import type { PayrollRun } from '@/lib/business'
import '@/styles/business.css'

export const metadata: Metadata = { title: 'Payroll receipt' }

/** One payroll's receipt: each person, what they got, and the one-time address it went to. */
export default async function PayrollReceiptPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  if (!/^run_[a-z0-9]{26}$/.test(id)) notFound()
  const [merchant, run] = await Promise.all([
    kova<Merchant>('/v1/account'),
    kova<PayrollRun>(`/v1/business/payroll/${id}`).catch((error) => {
      if (error instanceof ApiError && error.status === 404) return null
      throw error
    }),
  ])
  if (!run) notFound()
  return <RunReceipt run={run} business={merchant.name} />
}
