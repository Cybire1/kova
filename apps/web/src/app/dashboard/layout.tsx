import { redirect } from 'next/navigation'
import { Shell } from '@/components/shell'
import { kova, type Merchant } from '@/lib/api'
import { getSession } from '@/lib/session'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/wallet/shop?go=signin')
  const merchant = await kova<Merchant>('/v1/account')
  return (
    <Shell shop={merchant.name} demo={session.demo} livemode={merchant.livemode}>
      {children}
    </Shell>
  )
}
