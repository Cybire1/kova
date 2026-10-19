import type { Metadata } from 'next'
import { Books } from '@/components/books'
import { Brand, Icon } from '@/components/brand'
import { network } from '@/lib/network'

// The network comes from this server's environment when the page is asked for, not at build.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Private takings',
  description:
    'A read-only view of a shop’s private takings on Kova: every sale and the total, opened by the key in the link.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

/**
 * The accountant's view of a shop's private takings. The page itself is the same for everyone: the
 * key that finds one shop's sales is after the # of the link, read in the browser and never sent
 * to this server or to Kova.
 */
export default function BooksPage() {
  return (
    <main className="bk-page">
      <header className="bk-top">
        <Brand />
        <span className="bk-badge">
          <Icon name="eye" size={16} />
          Read-only
        </span>
      </header>
      <Books network={network} />
    </main>
  )
}
