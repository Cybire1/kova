import type { Metadata } from 'next'
import { Art } from '@/components/brand'
import { BusinessHome } from '@/components/business'
import { PageHead } from '@/components/shell'
import { ApiError, kova, kovaForRoute, type Merchant } from '@/lib/api'
import type { Business, Team } from '@/lib/business'
import '@/styles/business.css'

export const metadata: Metadata = { title: 'Business' }

/** Kova for Business: this month's payroll and suppliers, and what the team spent today. */
export default async function BusinessPage() {
  const merchant = await kova<Merchant>('/v1/account')
  const owner = merchant.owner_address ?? merchant.settlement_address
  const [summary, team] = await Promise.all([
    kova<Business>('/v1/business').catch((error) => {
      if (error instanceof ApiError) return null
      throw error
    }),
    kovaForRoute<{ data: Team['data'] }>(`/v1/wallets/${owner}/keys?kind=team`)
      .then((r): Team => ({ available: true, data: r.data ?? [] }))
      .catch((): Team => ({ available: false, data: [] })),
  ])
  if (!summary)
    return (
      <>
        <PageHead title="Business" />
        <section className="card notice" role="alert">
          <Art name="kovi-oops" size={120} />
          <h2>Your business didn’t load</h2>
          <p>Kova didn’t answer just now. Nothing has moved; try this page again in a moment.</p>
        </section>
      </>
    )
  return (
    <>
      <PageHead title="Business" sub={`${merchant.name}: payroll, suppliers and your team`} />
      <BusinessHome summary={summary} team={team} />
    </>
  )
}
