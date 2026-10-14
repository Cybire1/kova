import type { Metadata } from 'next'
import { TeamPanel } from '@/components/business'
import { kova, kovaForRoute, type Merchant } from '@/lib/api'
import type { Team } from '@/lib/business'
import '@/styles/business.css'

export const metadata: Metadata = { title: 'Team' }

/** The team keys that can spend the business's dollars, from Keys, with today's spending. */
export default async function TeamPage() {
  const merchant = await kova<Merchant>('/v1/account')
  const owner = merchant.owner_address ?? merchant.settlement_address
  const team = await kovaForRoute<{ data: Team['data'] }>(`/v1/wallets/${owner}/keys?kind=team`)
    .then((r): Team => ({ available: true, data: r.data ?? [] }))
    .catch((): Team => ({ available: false, data: [] }))
  return <TeamPanel team={team} />
}
