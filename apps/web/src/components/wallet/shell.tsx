'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Brand, NavIcon, type NavIconName } from '@/components/brand'
import { ArrivalNotice } from './arrival'
import { FlowContext, isFlow } from './flow'
import { PhoneWelcome } from './phone-welcome'
import { PrivateArrivalMoment } from './private'
import { useWallet } from './provider'
import { TokenWatch } from './tokens'
import { Avatar } from './ui'
import { Welcome } from './welcome'

/**
 * The Kova app on the web: your wallet, with your shop as one of its features. The Shop card on
 * Home opens shop mode, and shop mode's "Wallet" brings you back. The dock is the app's, Pay in
 * the middle.
 *
 * The brand bar stays on every screen, phone and desktop, above each screen's own title. Send is a
 * sheet over Home, so the dock steps aside while it's open; the other money flows (request, get
 * paid, cash out, pay, add) rise over Home the same way and close with × (flow.tsx).
 */
export function WalletShell({ children }: { children: React.ReactNode }) {
  const { status, tickPrivate } = useWallet()
  const path = usePathname()
  // Back from Paystack with a naira top-up: its result shows even where no wallet is open (an in-app browser).
  const params = useSearchParams()
  const nairaReturn =
    path === '/wallet/add/naira' && Boolean(params.get('reference') ?? params.get('trxref'))
  const sheet = path.startsWith('/wallet/send')
  const inner = status === 'ready' && path !== '/wallet' && !sheet
  const flow = status === 'ready' && isFlow(path)
  // Closing a flow plays its exit first, then goes; arriving anywhere ends it.
  const router = useRouter()
  const [leaving, setLeaving] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new path is a new screen
  useEffect(() => setLeaving(false), [path])
  const close = useCallback(
    (href: string) => {
      setLeaving(true)
      setTimeout(() => router.push(href), 200)
    },
    [router],
  )
  const flowContext = useMemo(() => (flow ? { close } : null), [flow, close])

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
    <div
      className={`w-app${inner ? ' w-app-inner' : ''}${flow ? ' w-app-flow' : ''}${
        // Getting paid is teal, as in the app.
        flow && path.startsWith('/wallet/receive') ? ' w-app-teal' : ''
      }`}
    >
      <header className="w-top">
        <Brand href="/wallet" />
      </header>

      <main
        // Keyed so a flow's rise plays as it opens, not again between its own pages.
        key={flow ? 'flow' : 'tab'}
        className={`w-main${flow ? ' w-flow' : ''}${leaving ? ' w-flow-out' : ''}`}
      >
        <FlowContext.Provider value={flowContext}>
          {status === 'loading' ? (
            <Opening />
          ) : status === 'none' && !nairaReturn ? (
            path.startsWith('/wallet/phone/') ? (
              <PhoneWelcome id={path.split('/').pop()!} />
            ) : (
              <Welcome forShop={path.startsWith('/wallet/shop')} />
            )
          ) : (
            children
          )}
        </FlowContext.Provider>
      </main>

      {status === 'ready' && !sheet && !flow ? <Dock path={path} /> : null}
      {status === 'ready' ? <ArrivalNotice /> : null}
      {/* A private payment found while the wallet is open gets its own moment, over any screen. */}
      {status === 'ready' ? <PrivateArrivalMoment /> : null}
      {/* Other tokens arriving (USDT0, WETH…) get their moment too, with a way to make them dollars. */}
      {status === 'ready' ? <TokenWatch /> : null}
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

/**
 * While the wallet opens: Home's shape, softly shimmering, instead of a blank page. It fades in
 * only if opening takes a moment, so a quick open never flashes it.
 */
function Opening() {
  return (
    <div className="w-loading" role="status" aria-busy="true" aria-label="Opening your wallet">
      <span className="w-skel w-skel-hello" />
      <span className="w-skel w-skel-card" />
      <span className="w-skel-row">
        <span className="w-skel w-skel-pay" />
        <span className="w-skel-col">
          <span className="w-skel" />
          <span className="w-skel" />
        </span>
      </span>
      <span className="w-skel w-skel-wide" />
    </div>
  )
}
