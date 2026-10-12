'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { Art, Icon } from './brand'

type DockIcon = 'today' | 'sales' | 'stall' | 'charge' | 'shop'

const TABS: { href: string; label: string; icon: DockIcon; also?: string[] }[] = [
  { href: '/dashboard', label: 'Today', icon: 'today' },
  { href: '/dashboard/payments', label: 'Sales', icon: 'sales' },
]
const TABS_AFTER: { href: string; label: string; icon: DockIcon; also?: string[] }[] = [
  { href: '/dashboard/stalls', label: 'Stall', icon: 'stall' },
  {
    href: '/dashboard/more',
    label: 'More',
    icon: 'shop',
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
 * The shop side's dock icons, drawn as the app draws them (apps/mobile src/ui/NavIcons.tsx): today
 * is a stack of coins, a sale is a receipt, the stall wears its awning. Quiet outlines; active,
 * their key part fills with colour.
 */
function DockGlyph({
  name,
  active,
  size = 22,
}: {
  name: Exclude<DockIcon, 'shop'>
  active?: boolean
  size?: number
}) {
  const line = {
    stroke: 'currentColor',
    strokeWidth: active ? 2 : 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  const fill = (accent: string) => (active ? accent : 'none')
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {name === 'today' ? (
        <>
          <rect
            x={5.6}
            y={16.2}
            width={12.8}
            height={4.2}
            rx={2.1}
            fill={fill('var(--coral-soft)')}
            {...line}
          />
          <rect
            x={4.2}
            y={11.4}
            width={12.8}
            height={4.2}
            rx={2.1}
            fill={fill('var(--coral-soft)')}
            {...line}
          />
          <rect
            x={7}
            y={6.6}
            width={12.8}
            height={4.2}
            rx={2.1}
            fill={fill('var(--coral-soft)')}
            {...line}
          />
          <path d="M5.2 3.2v2.4M4 4.4h2.4" fill="none" {...line} strokeWidth={1.5} />
        </>
      ) : null}
      {name === 'sales' ? (
        <>
          <path
            d="M5.5 3.2h13v17.4l-2.2-1.6-2.1 1.6-2.2-1.6-2.2 1.6-2.1-1.6-2.2 1.6z"
            fill={fill('var(--coral-soft)')}
            {...line}
          />
          <path d="M8.6 8h6.8M8.6 11.4h6.8M8.6 14.8h3.6" fill="none" {...line} strokeWidth={1.5} />
        </>
      ) : null}
      {name === 'stall' ? (
        <>
          <path
            d="M5 11.2v8.6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8.6"
            fill={fill('#8fb9bb')}
            {...line}
          />
          <path
            d="M3.6 8.6 5.2 3.8h13.6l1.6 4.8a1.95 1.95 0 0 1-3.8.6 1.95 1.95 0 0 1-3.8 0 1.95 1.95 0 0 1-3.8 0 1.95 1.95 0 0 1-3.8 0 1.95 1.95 0 0 1-1.6-.6z"
            fill={fill('var(--coral)')}
            {...line}
          />
          <path d="M10.2 20.8v-4.6h3.6v4.6" fill="none" {...line} strokeWidth={1.5} />
        </>
      ) : null}
      {name === 'charge' ? (
        <>
          <path
            d="M8.3 8.6a5 5 0 0 1 0 6.8M11.4 6.1a8.4 8.4 0 0 1 0 11.8M14.5 3.6a11.9 11.9 0 0 1 0 16.8"
            fill="none"
            {...line}
            strokeWidth={2.1}
          />
          <circle cx={5} cy={12} r={1.6} fill="currentColor" />
        </>
      ) : null}
    </svg>
  )
}

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

  // The wallet's dock, with the shop's tabs: the one you're on sits in a light circle, and More is
  // the shop's own little storefront, as the app's Shop tab is. Names are for screen readers and
  // the pointer's tooltip.
  const tab = (t: (typeof TABS)[number]) => {
    const on = current(path, t)
    return (
      <Link
        key={t.href}
        href={t.href}
        className={`w-dock-tab${on ? ' w-dock-on' : ''}`}
        aria-label={t.label}
        title={t.label}
        aria-current={on ? 'page' : undefined}
      >
        <span className="w-dock-disc">
          {t.icon === 'shop' ? (
            <span className="w-dock-face">
              <Art name="badge-shop" size={26} />
            </span>
          ) : (
            <DockGlyph name={t.icon} active={on} />
          )}
        </span>
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

      <div className="w-dock-fade" aria-hidden="true" />
      <nav className="w-dock" aria-label="Shop">
        {TABS.map(tab)}
        <Link href="/charge" className="w-dock-pay" aria-label="Charge. Take a payment">
          <DockGlyph name="charge" size={20} active />
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
