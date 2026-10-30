import type { Metadata } from 'next'
import { RepeatScreen } from '@/components/wallet/repeat'

export const metadata: Metadata = { title: 'Repeat payments' }

export default function RepeatPage() {
  return <RepeatScreen />
}
