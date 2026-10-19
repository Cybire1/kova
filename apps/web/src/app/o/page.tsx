import { network } from '@/lib/network'
import type { Metadata } from 'next'
import { Brand } from '@/components/brand'
import { OfflinePaymentView } from '@/components/offline-payment'
import { WalletProvider } from '@/components/wallet/provider'

export const dynamic = 'force-dynamic'

const title = 'A Kova payment'
const description =
  'A payment signed on a phone with no signal. Open it to check it, and settle it on Monad in about a second.'

/** The preview a chat app shows: never the payment itself, which lives after the # and never reaches here. */
export const metadata: Metadata = {
  title: { absolute: title },
  description,
  robots: { index: false },
  openGraph: { title, description },
  twitter: { title, description },
}

/**
 * An offline payment, opened by anyone: mykova.app/o#<code>. Someone signed it on their phone with
 * no signal, and it travelled as a QR or a link. The browser reads the code after the #, checks the
 * signature with no network, and asks Kova only whether it has settled. Anyone can settle it, and
 * the dollars can only go where the sender signed them to. The wallet is mounted so the person it
 * pays sees "This is yours", and their balance once it lands.
 */
export default function OfflinePaymentPage() {
  return (
    <WalletProvider
      network={network}
      shop={null}
      initialRates={null}
    >
      <main className="lk-page of-page">
        <header className="lk-top">
          <Brand />
        </header>
        <OfflinePaymentView />
      </main>
    </WalletProvider>
  )
}
