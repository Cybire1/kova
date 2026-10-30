import type { Metadata } from 'next'
import { SplitsScreen } from '@/components/wallet/splits'

export const metadata: Metadata = { title: 'Splits' }

export default function SplitsPage() {
  return <SplitsScreen />
}
