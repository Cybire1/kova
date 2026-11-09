import type { Metadata } from 'next'
import { AdminOpen } from '@/components/wallet/admin-open'

export const metadata: Metadata = { title: 'Kova’s dashboard', robots: { index: false } }

export default function Page() {
  return <AdminOpen />
}
