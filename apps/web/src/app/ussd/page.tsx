import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { UssdDemo } from '@/components/ussd-demo'
import { TESTNET_SITE } from '@/lib/growth'
import { network } from '@/lib/network'

// The network is this server's (KOVA_NETWORK), read when someone asks.
export const dynamic = 'force-dynamic'

const TITLE = 'Try Kova on a basic phone'
const DESCRIPTION =
  'No smartphone, no data. Dial a code, enter a PIN and pay a shop from a basic phone, on Monad. Try it here with test dollars.'

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

/** The demo runs on the test network with test dollars, so mykova.app sends visitors to the test site. */
export default function UssdPage() {
  if (network === 'mainnet') redirect(`${TESTNET_SITE}/ussd`)
  return <UssdDemo />
}
