import type { Metadata } from 'next'
import { type ShopToday, WalletProvider } from '@/components/wallet/provider'
import { WalletShell } from '@/components/wallet/shell'
import { kovaPublic, type Merchant, type Summary } from '@/lib/api'
import { network } from '@/lib/network'
import { getSession } from '@/lib/session'
import { timeZone, tzQuery } from '@/lib/tz'
import type { LiveRates } from '@/lib/wallet/money'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Wallet' }

/** The shop this browser is signed in to, with today's takings for its card on Home. */
async function shopToday(): Promise<ShopToday | null> {
  const session = await getSession()
  // The shared demo shop isn't anyone's own, so it doesn't appear as "your shop".
  if (!session || session.demo) return null
  const [shop, summary] = await Promise.all([
    kovaPublic<Merchant>('/v1/account', {}, session.key).catch(() => null),
    kovaPublic<Summary>(`/v1/summary${tzQuery(await timeZone())}`, {}, session.key).catch(
      () => null,
    ),
  ])
  return shop ? { name: shop.name, today: summary?.today ?? null } : null
}

/** The Kova app on the web: the wallet the Kova app holds, opened with the same passkey, and its shop. */
export default async function WalletLayout({ children }: { children: React.ReactNode }) {
  const [shop, rates] = await Promise.all([
    shopToday(),
    kovaPublic<LiveRates>('/v1/rates').catch(() => null),
  ])
  return (
    <WalletProvider network={network} shop={shop} initialRates={rates}>
      <WalletShell>{children}</WalletShell>
    </WalletProvider>
  )
}
