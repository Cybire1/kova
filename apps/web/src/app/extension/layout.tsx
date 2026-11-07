import type { Metadata } from 'next'
import { WalletProvider } from '@/components/wallet/provider'
import { kovaPublic } from '@/lib/api'
import { network } from '@/lib/network'
import type { LiveRates } from '@/lib/wallet/money'
import '../../styles/extension.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Kova for Chrome',
  robots: { index: false, follow: false },
}

/** Kova for Chrome's window onto the wallet: the same wallet and passkey, without the app around it. */
export default async function ExtensionLayout({ children }: { children: React.ReactNode }) {
  const rates = await kovaPublic<LiveRates>('/v1/rates').catch(() => null)
  return (
    <WalletProvider network={network} shop={null} initialRates={rates}>
      {children}
    </WalletProvider>
  )
}
