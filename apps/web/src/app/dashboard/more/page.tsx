import type { Metadata } from 'next'
import Link from 'next/link'
import { signOut } from '@/app/actions'
import { Art, Icon, type IconName } from '@/components/brand'
import { kova, type Merchant } from '@/lib/api'

export const metadata: Metadata = { title: 'More' }

const ROWS: { href: string; icon: IconName; title: string; sub: string }[] = [
  {
    href: '/dashboard/business',
    icon: 'bag',
    title: 'Business',
    sub: 'Private payroll, suppliers abroad, and your team’s spending',
  },
  {
    href: '/dashboard/catalogue',
    icon: 'tag',
    title: 'Products',
    sub: 'What you sell: prices, photos, sold out',
  },
  {
    href: '/dashboard/terminals',
    icon: 'terminal',
    title: 'Terminals',
    sub: 'Phones that take payments for this shop',
  },
  {
    href: '/dashboard/private',
    icon: 'lock',
    title: 'Private takings',
    sub: 'Sales only you can add up, and a view for your accountant',
  },
  {
    href: '/dashboard/settings',
    icon: 'settings',
    title: 'Settings',
    sub: 'Your shop’s name, and where its money lands',
  },
  {
    href: '/dashboard/developers',
    icon: 'code',
    title: 'Developers',
    sub: 'Secret keys and webhooks for your own systems',
  },
]

/** Everything else the shop has, one tap from the dock: the app's More, not a second menu. */
export default async function MorePage() {
  const shop = await kova<Merchant>('/v1/account')
  return (
    <div className="more">
      <div className="more-head">
        <Art name="badge-shop" size={64} />
        <div>
          <h1>{shop.name}</h1>
          <p>
            {shop.livemode
              ? 'Taking payments'
              : 'On Monad’s test network: test dollars, real speed'}
          </p>
        </div>
      </div>

      <nav className="more-list" aria-label="More">
        {ROWS.map((row) => (
          <Link key={row.href} href={row.href} className="more-row">
            <span className="more-icon">
              <Icon name={row.icon} size={20} />
            </span>
            <span className="more-text">
              <strong>{row.title}</strong>
              <small>{row.sub}</small>
            </span>
            <Icon name="chevron" size={18} />
          </Link>
        ))}
      </nav>

      <div className="more-list more-list-quiet">
        <Link href="/wallet" className="more-row">
          <span className="more-icon more-icon-teal">
            <Icon name="card" size={20} />
          </span>
          <span className="more-text">
            <strong>Back to my wallet</strong>
            <small>Your money, and everyone you pay</small>
          </span>
          <Icon name="chevron" size={18} />
        </Link>
        <form action={signOut}>
          <button type="submit" className="more-row">
            <span className="more-icon more-icon-quiet">
              <Icon name="out" size={20} />
            </span>
            <span className="more-text">
              <strong>Sign out of this shop</strong>
              <small>Your wallet stays open on this browser</small>
            </span>
          </button>
        </form>
      </div>
    </div>
  )
}
