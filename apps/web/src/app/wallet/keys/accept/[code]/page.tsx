import type { Metadata } from 'next'
import { AcceptKey } from '@/components/wallet/accept-key'

export const metadata: Metadata = { title: 'Accept' }

export default async function AcceptPage({ params }: { params: Promise<{ code: string }> }) {
  return <AcceptKey code={(await params).code} />
}
