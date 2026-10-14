import type { Metadata } from 'next'
import { PayrollPanel } from '@/components/business'
import { kova, type Merchant } from '@/lib/api'
import type { PayrollRun, Person } from '@/lib/business'
import { businessShop } from '../shop'
import '@/styles/business.css'

export const metadata: Metadata = { title: 'Payroll' }

/** The payroll book: the people the business pays, a new run, and every past one. */
export default async function PayrollPage() {
  const [merchant, people, runs] = await Promise.all([
    kova<Merchant>('/v1/account'),
    kova<{ data: Person[] }>('/v1/business/people').then((r) => r.data),
    kova<{ data: PayrollRun[] }>('/v1/business/payroll').then((r) => r.data),
  ])
  return <PayrollPanel shop={businessShop(merchant)} initialPeople={people} initialRuns={runs} />
}
