import type { Metadata } from 'next'
import '@/styles/admin.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: { default: 'Kova admin', template: '%s · Kova admin' },
  robots: { index: false, follow: false },
}

/** Kova's own dashboard: for the team only (lib/admin.ts), never indexed. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="adm">{children}</div>
}
