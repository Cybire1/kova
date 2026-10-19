'use client'

import Link from 'next/link'
import { startTransition, useCallback, useEffect, useRef, useState } from 'react'
import { Awning } from '@/components/awning'
import { Art, type ArtName, Icon, type IconName, Pill } from '@/components/brand'
import { IphoneCard } from '@/components/iphone-beta'
import { cleanRef, PROFILE_KEY, REF_KEY, shopKey, TRY_KEY } from '@/lib/growth'

/**
 * Try Kova in a minute: the page every post links to. Four steps that tick themselves off from
 * what really happened (the wallet in this browser, dollars that arrived, a stamp at the bakery, a
 * link sent), checked again whenever you come back to the page and every few seconds while it's
 * open. It counts where you came from, once per browser: the visit, and a wallet that's new since.
 */

export type CountStep = (ref: string, step: 'visit' | 'wallet') => Promise<boolean>

/** The demo bakery, as its menu says: its name, the croissant's price and its stamp card. */
export interface Bakery {
  slug: string
  name: string
  /** The croissant's price ("3.25"), or null when it's off the menu today. */
  croissant: string | null
  /** Paid orders that fill its stamp card. */
  every: number | null
}

// --- What this browser remembers ---------------------------------------------------------

const read = <T,>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode or full storage: nothing is remembered, so nothing is counted.
  }
}

type Step = 'dollars' | 'order' | 'link'

interface Memory {
  /** When this browser first opened /try. */
  first?: number
  /** It had a Kova wallet already then: not a new one, so never counted as one. */
  had?: boolean
  /** The visit was counted. */
  visit?: boolean
  /** The wallet counted as new from here. */
  wallet?: string
  /** Steps seen done, per wallet. They stay done: a full stamp card starts again at zero. */
  done?: Record<string, Partial<Record<Step, true>>>
}

const memory = () => read<Memory>(TRY_KEY) ?? {}
const remember = (change: (m: Memory) => Memory) => write(TRY_KEY, change(memory()))

interface Me {
  address: string
  name: string
}

/** The wallet in this browser, as the web wallet keeps it: only its address and name are read. */
function me(): Me | null {
  const profile = read<{ address?: unknown; name?: unknown }>(PROFILE_KEY)
  if (
    !profile ||
    typeof profile.address !== 'string' ||
    !/^0x[0-9a-fA-F]{40}$/.test(profile.address)
  )
    return null
  const name =
    typeof profile.name === 'string' && !profile.name.startsWith('0x') ? profile.name : ''
  return { address: profile.address, name }
}

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? ''

/** The face the wallet gives this address (components/wallet/ui.tsx): FNV-1a over it, lowercased. */
const FACES: ArtName[] = [
  'avatar-1',
  'avatar-2',
  'avatar-3',
  'avatar-4',
  'avatar-5',
  'avatar-6',
  'avatar-7',
]
function face(id: string): ArtName {
  let h = 0x811c9dc5
  for (const c of id.toLowerCase()) {
    h ^= c.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return FACES[h % FACES.length] ?? 'avatar-1'
}

// --- Where this visitor came from --------------------------------------------------------

/**
 * The source is the first one this browser was given, kept so it lasts through the wallet and
 * back. The visit is counted once; a wallet once, and only when it's new since that first visit.
 * Nothing is counted where this browser can't remember that it was.
 */
function useSource(initialRef: string | null, count: CountStep, wallet: string | null) {
  const source = useRef<string | null>(null)

  useEffect(() => {
    const kept = cleanRef(read<string>(REF_KEY))
    const ref = kept ?? cleanRef(initialRef) ?? 'direct'
    if (!kept) write(REF_KEY, ref)
    source.current = ref
    if (!memory().first) remember((m) => ({ ...m, first: Date.now(), had: me() !== null }))
    const m = memory()
    if (!m.first || m.visit) return
    remember((x) => ({ ...x, visit: true }))
    startTransition(async () => {
      const counted = await count(ref, 'visit').catch(() => false)
      if (!counted) remember((x) => ({ ...x, visit: false }))
    })
  }, [count, initialRef])

  useEffect(() => {
    const ref = source.current
    if (!wallet || !ref) return
    const m = memory()
    if (!m.first || m.had || m.wallet) return
    remember((x) => ({ ...x, wallet }))
    startTransition(async () => {
      const counted = await count(ref, 'wallet').catch(() => false)
      if (!counted) remember((x) => ({ ...x, wallet: undefined }))
    })
  }, [count, wallet])
}

// --- What's done -------------------------------------------------------------------------

interface Progress {
  /** This browser has been looked at: the wallet and what it remembers. */
  ready: boolean
  wallet: Me | null
  dollars: boolean
  order: boolean
  link: boolean
  shop: boolean
  /** Stamps on the bakery's card right now, when Kova said. */
  stamps: number | null
  links: { sent: number; claimed: number } | null
}

const START: Progress = {
  ready: false,
  wallet: null,
  dollars: false,
  order: false,
  link: false,
  shop: false,
  stamps: null,
  links: null,
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: 'no-store' })
    return response.ok ? ((await response.json()) as T) : null
  } catch {
    return null
  }
}

function useProgress(bakery: Bakery) {
  const [progress, setProgress] = useState<Progress>(START)
  const busy = useRef(false)

  /** What's done, from this browser and from Kova. `fresh` asks again even for steps seen done. */
  const check = useCallback(
    async (fresh: boolean) => {
      const who = me()
      if (!who) {
        setProgress({ ...START, ready: true })
        return
      }
      const key = who.address.toLowerCase()
      const shop = read<string>(shopKey(who.address)) !== null
      const seen = memory().done?.[key] ?? {}
      // What this browser already knows shows at once; Kova's answers follow.
      setProgress((p) => {
        const same = p.wallet?.address === who.address ? p : START
        return {
          ...same,
          ready: true,
          wallet: who,
          dollars: same.dollars || Boolean(seen.dollars || seen.order || seen.link),
          order: same.order || Boolean(seen.order),
          link: same.link || Boolean(seen.link),
          shop,
        }
      })
      if (busy.current) return
      busy.current = true
      try {
        const [card, sent] = await Promise.all([
          fresh || !seen.order
            ? getJson<{ stamps?: number }>(
                `/api/stalls/${encodeURIComponent(bakery.slug)}/stamps?payer=${who.address}`,
              )
            : null,
          fresh || !seen.link
            ? getJson<{ data?: { status?: string }[] }>(`/api/links?sender=${who.address}`)
            : null,
        ])
        const stamps = typeof card?.stamps === 'number' ? card.stamps : null
        const links = Array.isArray(sent?.data)
          ? {
              sent: sent.data.length,
              claimed: sent.data.filter((l) => l.status === 'claimed').length,
            }
          : null
        const order = Boolean(seen.order) || (stamps ?? 0) >= 1
        const link = Boolean(seen.link) || (links?.sent ?? 0) >= 1
        let dollars = Boolean(seen.dollars) || order || link
        if (!dollars) {
          // Dollars that arrived count even once they're spent: the faucet's, or a friend's.
          const arrived = await getJson<{ data?: unknown[] }>(
            `/api/wallet/${who.address}/transfers?direction=in`,
          )
          dollars = (arrived?.data?.length ?? 0) > 0
        }
        if (me()?.address !== who.address) return
        const done: Partial<Record<Step, true>> = {
          ...seen,
          ...(dollars ? { dollars: true } : {}),
          ...(order ? { order: true } : {}),
          ...(link ? { link: true } : {}),
        }
        if (Object.keys(done).length !== Object.keys(seen).length)
          remember((m) => ({ ...m, done: { ...m.done, [key]: done } }))
        setProgress((p) => ({
          ...p,
          ready: true,
          wallet: who,
          dollars,
          order,
          link,
          shop,
          stamps: stamps ?? p.stamps,
          links: links ?? p.links,
        }))
      } finally {
        busy.current = false
      }
    },
    [bakery.slug],
  )

  useEffect(() => {
    void check(true)
    const again = () => {
      if (document.visibilityState === 'visible') void check(true)
    }
    // Every few seconds while it's in view; only steps not yet done go to Kova.
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void check(false)
    }, 5000)
    window.addEventListener('focus', again)
    window.addEventListener('pageshow', again)
    window.addEventListener('storage', again)
    document.addEventListener('visibilitychange', again)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', again)
      window.removeEventListener('pageshow', again)
      window.removeEventListener('storage', again)
      document.removeEventListener('visibilitychange', again)
    }
  }, [check])

  return progress
}

// --- The page ----------------------------------------------------------------------------

interface StepView {
  id: 'wallet' | Step
  art: ArtName
  title: string
  body: string
  done: boolean
  doneText: string
  cta: string
  icon: IconName
  href: string
}

export function TryChecklist({
  bakery,
  initialRef,
  count,
  iphone,
}: {
  bakery: Bakery
  initialRef: string | null
  count: CountStep
  /** Where the iPhone beta's page is (one list, on mykova.app). */
  iphone: string
}) {
  const p = useProgress(bakery)
  useSource(initialRef, count, p.wallet?.address ?? null)

  const steps: StepView[] = [
    {
      id: 'wallet',
      art: 'scene-faceid',
      title: 'Make your wallet',
      body: 'Face ID or your fingerprint, no seed phrase, nothing to install. Your $5 comes next.',
      done: p.wallet !== null,
      doneText: p.wallet?.name
        ? `Made. Hello, ${firstName(p.wallet.name)}.`
        : `Made: ${p.wallet ? short(p.wallet.address) : ''}`,
      cta: 'Make my wallet',
      icon: 'face',
      href: '/wallet/add',
    },
    {
      id: 'dollars',
      art: 'coin-usd',
      title: 'Get $5 of test dollars',
      body: 'Free from Kova, once a day. They land in about a second, and Kova pays the gas.',
      done: p.dollars,
      doneText: 'In your wallet, ready to spend.',
      cta: 'Get $5',
      icon: 'plus',
      href: '/wallet/add',
    },
    {
      id: 'order',
      art: 'scene-paid-terminal',
      title: bakery.croissant
        ? `Order a croissant at ${bakery.name}, from table 3`
        : `Order at ${bakery.name}, from table 3`,
      body: `${bakery.croissant ? `$${bakery.croissant} from the menu. ` : ''}Pay with Face ID and the order goes straight to the bakery${bakery.every ? ', with a stamp on your card' : ''}.`,
      done: p.order,
      doneText:
        p.stamps && bakery.every
          ? `Paid. ${p.stamps} of ${bakery.every} stamps on your card.`
          : 'Paid. Enjoy it.',
      cta: bakery.croissant ? 'Order a croissant' : 'Order something',
      icon: 'bag',
      href: `/s/${encodeURIComponent(bakery.slug)}?table=3`,
    },
    {
      id: 'link',
      art: 'plane',
      title: 'Send a friend $1 with a link',
      body: 'They don’t need Kova. Every link you send brings someone new.',
      done: p.link,
      doneText: p.links?.claimed
        ? `Sent, and ${p.links.claimed === 1 ? 'claimed' : `${p.links.claimed} claimed`}. Someone new is on Kova.`
        : 'Sent. It waits for them, or comes back to you.',
      cta: 'Send $1 by link',
      icon: 'link',
      href: '/wallet/send/link',
    },
  ]
  const done = steps.filter((s) => s.done).length
  const current = steps.findIndex((s) => !s.done)
  const finished = current === -1

  return (
    <div className="gr-try-grid" data-ready={p.ready ? 'true' : undefined}>
      <section className="gr-try-hero" aria-labelledby="gr-try-title">
        <div className="gr-try-art" aria-hidden="true">
          <Art name="sparkle-8" size={26} className="gr-spark gr-spark-a" />
          <Art name="sparkle-11" size={20} className="gr-spark gr-spark-b" />
          <Art name="sparkle-4" size={16} className="gr-spark gr-spark-c" />
          <Art name={finished ? 'kovi-cheer' : 'kovi-wave'} size={128} priority />
        </div>
        <h1 className="gr-title" id="gr-try-title">
          {finished ? 'You’ve used Kova on Monad.' : 'Try Kova in a minute'}
        </h1>
        <p className="gr-lead">
          {finished
            ? 'A wallet with no seed phrase, a bakery order and a dollar by link, each settled in about a second. Now bring someone along.'
            : 'Make a wallet, buy a croissant and send a friend a dollar, with free test dollars on Monad’s test network. Each payment settles in about a second.'}
        </p>
        {finished ? <Share /> : null}

        <div className="gr-progress-row">
          {p.wallet ? (
            <Art name={face(p.wallet.address)} size={36} className="gr-me" alt="" />
          ) : null}
          <div className="gr-progress-body">
            <p className="gr-progress-text" aria-live="polite">
              {p.wallet?.name ? `${firstName(p.wallet.name)}, ` : ''}
              {done} of 4 done
            </p>
            <div
              className="gr-progress"
              role="progressbar"
              aria-label="Steps done"
              aria-valuemin={0}
              aria-valuemax={4}
              aria-valuenow={done}
            >
              {steps.map((s) => (
                <span key={s.id} data-on={s.done ? 'true' : undefined} />
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="gr-try-list">
        <ol className="gr-steps">
          {steps.map((s, i) => (
            <StepCard key={s.id} step={s} n={i + 1} current={i === current} />
          ))}
        </ol>

        <ShopStep done={p.shop} hasWallet={p.wallet !== null} />

        <IphoneCard href={iphone} compact />

        <p className="gr-try-fine">
          Monad’s test network: test dollars, the same one-second payments as mainnet.{' '}
          <Link href="/stats" className="gr-fine-link">
            See Kova, live
          </Link>
        </p>
      </div>
    </div>
  )
}

/**
 * A step: its number (a tick once done), what to do, and its picture. The step you're on carries
 * the one coral button; every other step is a link to the same place.
 */
function StepCard({ step, n, current }: { step: StepView; n: number; current: boolean }) {
  const state = step.done ? 'done' : current ? 'current' : 'later'
  return (
    <li className="gr-step" data-state={state}>
      <span className="gr-step-disc" aria-hidden="true">
        {step.done ? <Icon name="check" size={18} /> : n}
      </span>
      <div className="gr-step-text">
        <h2 className="gr-step-title">
          {current ? (
            step.title
          ) : (
            <Link href={step.href} className="gr-step-link">
              {step.title}
            </Link>
          )}
          {step.done ? <span className="gr-sr"> (done)</span> : null}
        </h2>
        <p className={step.done ? 'gr-step-done' : 'gr-step-body'}>
          {step.done ? step.doneText : step.body}
        </p>
      </div>
      <Art name={step.art} size={current ? 76 : 52} className="gr-step-art" />
      {current ? (
        <Pill href={step.href} icon={step.icon} tone="coral" className="gr-step-cta">
          {step.cta}
        </Pill>
      ) : null}
    </li>
  )
}

/** The bonus: a shop of your own, drawn as the wallet draws its shop card, awning and all. */
function ShopStep({ done, hasWallet }: { done: boolean; hasWallet: boolean }) {
  return (
    <section
      className="gr-shop"
      data-state={done ? 'done' : undefined}
      aria-labelledby="gr-shop-title"
    >
      <Awning height={22} stripe={16} />
      <div className="gr-shop-body">
        <Art name="badge-shop" size={46} className="gr-shop-badge" />
        <div className="gr-shop-text">
          <small>{done ? 'Bonus, done' : 'Bonus'}</small>
          <h2 id="gr-shop-title">
            <Link href="/wallet/shop" className="gr-step-link">
              {done ? 'Your shop is open' : 'Open your own shop, free'}
            </Link>
          </h2>
          <p>
            {done
              ? 'Its sales land in this same wallet.'
              : `Take payments into ${hasWallet ? 'this' : 'your'} wallet: a till on your phone, a menu with table codes, a stamp card.`}
          </p>
        </div>
        <span className="gr-shop-go" aria-hidden="true">
          <Icon name={done ? 'check' : 'arrow'} size={18} />
        </span>
      </div>
    </section>
  )
}

/** The X mark, for the one button that posts there. */
function XMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

const SHARE_TEXT =
  'I just paid a bakery in about a second and sent a friend $1 by link, with Kova on @monad testnet. Face ID wallet, no seed phrase, no gas. Try it:'

/** Bring someone along: a post on X, or the link itself, both counted as a friend's. */
function Share() {
  const [url, setUrl] = useState<string | null>(null)
  const [native, setNative] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setUrl(`${window.location.origin}/try?ref=friend`)
    setNative(
      typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches,
    )
  }, [])

  if (!url) return null
  const post = `https://x.com/intent/tweet?text=${encodeURIComponent(SHARE_TEXT)}&url=${encodeURIComponent(url)}`

  const pass = async () => {
    if (native) {
      await navigator
        .share({ title: 'Try Kova in a minute', text: SHARE_TEXT, url })
        .catch(() => {})
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      window.prompt('Copy this link', url)
    }
  }

  return (
    <div className="gr-share">
      <a className="pill" data-tone="ink" href={post} target="_blank" rel="noopener noreferrer">
        <span className="pill-label">Share on X</span>
        <span className="pill-cap">
          <XMark />
        </span>
      </a>
      <button type="button" className="pill" data-tone="light" onClick={() => void pass()}>
        <span className="pill-label">
          {copied ? 'Link copied' : native ? 'Share the link' : 'Copy the link'}
        </span>
        <span className="pill-cap">
          <Icon name={copied ? 'check' : native ? 'share' : 'copy'} size={18} />
        </span>
      </button>
    </div>
  )
}

/**
 * Mainnet has no test dollars: Kova is live there with AUSD. The free way to try it all is the
 * test network's own /try, which this page sends people to (and counts where they came from).
 */
export function TryMainnet({
  initialRef,
  count,
  testnet,
  iphone,
}: {
  initialRef: string | null
  count: CountStep
  testnet: string
  /** Where the iPhone beta's page is (one list, on mykova.app). */
  iphone: string
}) {
  const [wallet, setWallet] = useState<string | null>(null)
  useEffect(() => setWallet(me()?.address ?? null), [])
  useSource(initialRef, count, wallet)

  return (
    <div className="gr-try-grid gr-try-main">
      <section className="gr-try-hero" aria-labelledby="gr-try-title">
        <div className="gr-try-art" aria-hidden="true">
          <Art name="sparkle-8" size={26} className="gr-spark gr-spark-a" />
          <Art name="sparkle-11" size={20} className="gr-spark gr-spark-b" />
          <Art name="sparkle-4" size={16} className="gr-spark gr-spark-c" />
          <Art name="kovi-wave" size={128} priority />
        </div>
        <h1 className="gr-title" id="gr-try-title">
          Try Kova in a minute
        </h1>
        <p className="gr-lead">
          Kova is live on Monad mainnet, with AUSD, Agora’s dollar. To try every part of it for
          free, use Kova’s test network: it gives you $5 of test dollars a day, and works the same.
        </p>
        <div className="gr-main-ctas">
          <Pill href={testnet} icon="arrow" tone="coral">
            Try it free on testnet
          </Pill>
          <Pill href="/wallet" icon="face" tone="light">
            Open my wallet
          </Pill>
        </div>
      </section>

      <div className="gr-try-list">
        <section className="gr-main-card" aria-labelledby="gr-main-steps">
          <h2 className="gr-h2" id="gr-main-steps">
            On the test network, you’ll
          </h2>
          <ol className="gr-main-steps">
            <li>
              <Art name="scene-faceid" size={40} /> Make a wallet with Face ID, no seed phrase
            </li>
            <li>
              <Art name="coin-usd" size={40} /> Get $5 of test dollars, free
            </li>
            <li>
              <Art name="scene-paid-terminal" size={40} /> Order a croissant at Ada’s Bakery
            </li>
            <li>
              <Art name="plane" size={40} /> Send a friend $1 with a link
            </li>
          </ol>
        </section>
        <IphoneCard href={iphone} compact />
        <p className="gr-try-fine">
          Every payment settles on Monad in about a second, and Kova pays the gas.{' '}
          <Link href="/stats" className="gr-fine-link">
            See Kova, live
          </Link>
        </p>
      </div>
    </div>
  )
}
