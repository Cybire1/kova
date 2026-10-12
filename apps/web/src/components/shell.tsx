'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { Art, Icon, type IconName } from './brand'

const TABS: { href: string; label: string; icon: IconName; also?: string[] }[] = [
  { href: '/dashboard', label: 'Today', icon: 'home' },
  { href: '/dashboard/payments', label: 'Sales', icon: 'list' },
]
const TABS_AFTER: { href: string; label: string; icon: IconName; also?: string[] }[] = [
  { href: '/dashboard/stalls', label: 'Stall', icon: 'stall' },
  {
    href: '/dashboard/more',
    label: 'More',
    icon: 'menu',
    also: [
      '/dashboard/catalogue',
      '/dashboard/terminals',
      '/dashboard/private',
      '/dashboard/developers',
      '/dashboard/settings',
    ],
  },
]

const current = (path: string, tab: { href: string; also?: string[] }) =>
  tab.href === '/dashboard'
    ? path === tab.href
    : [tab.href, ...(tab.also ?? [])].some((href) => path.startsWith(href))

/**
 * Shop mode: the shop is a part of the Kova app, entered from Home and left the same way, as the
 * Kova app's Terminal mode is. The frame is the wallet's (the same top bar, the same floating dock),
 * with the shop's own tabs in the dock and Charge in coral where the wallet keeps Pay.
 */
export function Shell({
  shop,
  demo,
  livemode,
  children,
}: {
  shop: string
  demo: boolean
  livemode: boolean
  children: React.ReactNode
}) {
  const path = usePathname()
  const router = useRouter()

  // Tell the server this browser's time zone, so "today" is the shop's today.
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!tz || document.cookie.split('; ').includes(`kova_tz=${tz}`)) return
    // biome-ignore lint/suspicious/noDocumentCookie: a plain cookie the server reads for "today"; Safari has no Cookie Store API
    document.cookie = `kova_tz=${tz}; path=/; max-age=31536000; samesite=lax`
    router.refresh()
  }, [router])

  const tab = (t: (typeof TABS)[number]) => {
    const on = current(path, t)
    return (
      <Link
        key={t.href}
        href={t.href}
        className={`w-dock-tab${on ? ' w-dock-on' : ''}`}
        aria-current={on ? 'page' : undefined}
      >
        <Icon name={t.icon} size={22} />
        <span>{t.label}</span>
      </Link>
    )
  }

  return (
    <div className="w-app shop-mode">
      <header className="w-top shop-top">
        <Link href="/wallet" className="shop-back" aria-label="Back to your wallet">
          <Icon name="back" size={18} />
          <span>Wallet</span>
        </Link>
        <Link
          href="/dashboard/more"
          className="shop-id"
          title={`${shop}${livemode ? '' : ', test mode'}`}
        >
          <span className="shop-id-name">{shop}</span>
          <span className="shop-id-badge">
            <Art name="badge-shop" size={34} />
            {livemode ? null : <span className="shop-id-test" aria-hidden="true" />}
          </span>
        </Link>
      </header>

      {demo ? (
        <div className="demo-bar" role="note">
          You’re exploring a shared demo shop on Monad’s test network.{' '}
          <Link href="/wallet/shop?go=open">Open your own shop</Link>
        </div>
      ) : null}

      <main className="shop-main">{children}</main>

      <nav className="w-dock" aria-label="Shop">
        {TABS.map(tab)}
        <Link href="/charge" className="w-dock-pay" aria-label="Charge. Take a payment">
          <Icon name="tap" size={22} />
          <span>Charge</span>
        </Link>
        {TABS_AFTER.map(tab)}
      </nav>
    </div>
  )
}

/** Title, a line of context, and the page's own actions. */
export function PageHead({
  title,
  sub,
  children,
}: {
  title: string
  sub?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <header className="pagehead">
      <div>
        <h1>{title}</h1>
        {sub ? <p>{sub}</p> : null}
      </div>
      {children ? <div className="pagehead-actions">{children}</div> : null}
    </header>
  )
}
