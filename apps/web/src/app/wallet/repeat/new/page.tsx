import type { Metadata } from 'next'
import { NewRepeat } from '@/components/wallet/repeat'

export const metadata: Metadata = { title: 'New repeat payment' }

export default function NewRepeatPage() {
  return <NewRepeat />
}
