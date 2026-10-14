'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import { Brand, NavIcon, type NavIconName } from '@/components/brand'
import { useWallet } from './provider'
import { Avatar } from './ui'
import { Welcome } from './welcome'

/**
 * The Kova app on the web: your wallet, with your shop as one of its features. The Shop card on
 * Home opens shop mode, and shop mode's "Wallet" brings you back. The dock is the app's, Pay in
 * the middle.
 *
 * On a phone the brand bar shows on Home and the welcome only: every other screen starts with its
 * own title, as in the app. Send is a sheet over Home, so the dock steps aside while it's open.
 */
export function WalletShell({ children }: { children: React.ReactNode }) {
  const { status, tickPrivate } = useWallet()
  const path = usePathname()
  // Back from Paystack with a naira top-up: its result shows even where no wallet is open (an in-app browser).
  const params = useSearchParams()
  const nairaReturn = path === '/wallet/add/naira' && Boolean(params.get('reference') ?? params.get('trxref'))
  const sheet = path.startsWith('/wallet/send')
  const inner = status === 'ready' && path !== '/wallet' && !sheet

  // Private payments to you are looked for while the wallet is open: new ones found by your keys,
  // who sent them, and what their one-time addresses still hold.
  useEffect(() => {
    if (status !== 'ready') return
    const tick = () => {
      if (document.visibilityState === 'visible') void tickPrivate()
    }
    tick()
    const timer = setInterval(tick, 8_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [status, tickPrivate])

  return (
    <div className={`w-app${inner ? ' w-app-inner' : ''}`}>
      <header className="w-top">
        <Brand href="/wallet" />
      </header>

      <main className="w-main">
        {status === 'loading' ? (
          <div className="w-loading" aria-busy="true" />
        ) : status === 'none' && !nairaReturn ? (
          <Welcome forShop={path.startsWith('/wallet/shop')} />
        ) : (
          children
        )}
      </main>

      {status === 'ready' && !sheet ? <Dock path={path} /> : null}
    </div>
  )
}

type Tab = { href: string; label: string; icon: NavIconName; exact?: boolean }

const before: Tab[] = [
  { href: '/wallet', label: 'Home', icon: 'home', exact: true },
  { href: '/wallet/activity', label: 'Activity', icon: 'activity' },
]
const after: Tab[] = [
  { href: '/wallet/send', label: 'People', icon: 'people' },
  { href: '/wallet/profile', label: 'You', icon: 'profile' },
]

/**
 * A floating ink pill, as in the app: Pay is a coral capsule in the middle, the four tabs share
 * the rest, and the one you're on sits in a light circle. You are your own face. The names are for
 * screen readers and the pointer's tooltip, not squeezed under the icons.
 */
function Dock({ path }: { path: string }) {
  const { profile } = useWallet()
  const on = (t: Tab) =>
    t.exact ? path === t.href : path === t.href || path.startsWith(`${t.href}/`)
  const tab = (t: Tab) => {
    const active = on(t)
    return (
      <Link
        key={t.href}
        href={t.href}
        className={`w-dock-tab${active ? ' w-dock-on' : ''}`}
        aria-label={t.label}
        title={t.label}
        aria-current={active ? 'page' : undefined}
      >
        <span className="w-dock-disc">
          {t.icon === 'profile' && profile ? (
            <span className="w-dock-face">
              <Avatar name={profile.name} id={profile.address} size={26} />
            </span>
          ) : (
            <NavIcon name={t.icon} active={active} size={22} />
          )}
        </span>
      </Link>
    )
  }
  return (
    <>
      <div className="w-dock-fade" aria-hidden="true" />
      <nav className="w-dock" aria-label="Kova">
        {before.map(tab)}
        <Link
          href="/wallet/pay"
          className={`w-dock-pay${path.startsWith('/wallet/pay') ? ' w-dock-on' : ''}`}
          aria-label="Pay. Scan a code or paste a link"
          aria-current={path.startsWith('/wallet/pay') ? 'page' : undefined}
        >
          <NavIcon name="pay" size={20} active />
          <span>Pay</span>
        </Link>
        {after.map(tab)}
      </nav>
    </>
  )
}
