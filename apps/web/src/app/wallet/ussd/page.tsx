import type { Metadata } from 'next'
import { UssdScreen } from '@/components/wallet/ussd'
export const metadata: Metadata = { title: 'Pay by USSD' }
export default function UssdPage() {
  return <UssdScreen />
}
