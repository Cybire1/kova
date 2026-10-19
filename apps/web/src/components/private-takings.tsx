'use client'

import { type NetworkId, type StealthKeys, stealthMetaAddress } from '@kova/monad'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { movePrivateTakings, turnOffPrivateTakings, turnOnPrivateTakings } from '@/app/actions'
import type { PrivateSale, PrivateTakings } from '@/lib/api'
import { ago } from '@/lib/format'
import { passkeyDomain, passkeyHome } from '@/lib/passkey'
import { addressUrl, baseOf, opens, shortAddress, totalOf, viewLink, viewOf } from '@/lib/takings'
import { formatUsd } from '@/lib/wallet/money'
import { rememberedWallet, signMoves, takingsKeys, type WebWallet } from '@/lib/wallet/takings'
import { Art, Icon } from './brand'
import { Odometer } from './odometer'
import { PageHead } from './shell'

/**
 * A shop's private takings, from its owner's side. Turning them on takes the owner's passkey: the
 * Kova wallet signs once, the signature becomes the shop's keys (the same ones the app makes), and
 * only the public meta-address goes to Kova. From then on every charge pays a fresh one-time
 * address. The keys stay in this page's memory: they check that each sale Kova lists really is the
 * shop's, sign the moves that bring the dollars home, and make the accountant's view link.
 */

interface Shop {
  /** The shop's public id (mer_…): its keys are made for this shop alone. */
  id: string
  name: string
  owner: string | null
  settlement: string
  network: NetworkId
  explorer: string
}

type Working = 'on' | 'off' | 'move' | 'link' | null

interface Moved {
  amount: bigint
  count: number
  failed: number
  seconds: string
  explorer: string | null
}

const same = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b && a.toLowerCase() === b.toLowerCase())
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`

/** Kova's own words for a failed move, or plain ones when they're about gas. */
function plain(error: string) {
  if (/insufficient|exceeds the balance|gas|funds/i.test(error))
    return 'Kova couldn’t pay the network fee just now. Your dollars are safe where they are; try again in a little while.'
  return error.length < 160
    ? error
    : 'Kova couldn’t move them just now. Nothing was lost; try again.'
}

const dateOf = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`
}

const SHOWN = 6

export function PrivateTakingsPanel({
  shop,
  initial,
  demo,
}: {
  shop: Shop
  initial: PrivateTakings
  demo: boolean
}) {
  const [takings, setTakings] = useState(initial)
  /** This browser's Kova wallet; undefined until it's been read. */
  const [wallet, setWallet] = useState<WebWallet | null | undefined>(undefined)
  const [home, setHome] = useState(true)
  const [keys, setKeys] = useState<StealthKeys | null>(null)
  const [working, setWorking] = useState<Working>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [moved, setMoved] = useState<Moved | null>(null)
  const [sureOff, setSureOff] = useState(false)
  const [copied, setCopied] = useState(false)
  const [all, setAll] = useState(false)
  /** One-time addresses Monad showed empty when moving: nothing there to wait for. */
  const [empty, setEmpty] = useState<Set<string>>(new Set())
  const [origin, setOrigin] = useState('https://mykova.app')
  const [, setNow] = useState(0)
  const busy = useRef(false)

  useEffect(() => {
    setWallet(rememberedWallet())
    setHome(passkeyHome())
    setOrigin(window.location.origin)
  }, [])

  // The server's copy after an action (revalidated), then the live one.
  useEffect(() => setTakings(initial), [initial])

  // New private sales land while the page is open.
  useEffect(() => {
    const tick = async () => {
      setNow(Date.now())
      if (busy.current || document.visibilityState !== 'visible') return
      const response = await fetch('/api/private-takings', { cache: 'no-store' }).catch(() => null)
      if (response?.status === 401) return window.location.assign('/signin?expired=1')
      if (response?.ok && !busy.current) setTakings((await response.json()) as PrivateTakings)
    }
    const timer = setInterval(() => void tick(), 6000)
    return () => clearInterval(timer)
  }, [])

  const linked = same(shop.owner, wallet?.address)
  const view = useMemo(() => (keys ? viewOf(keys) : null), [keys])
  /** Each address checked once: a check is an elliptic-curve multiplication, and the list refreshes. */
  const verdicts = useMemo(() => (view ? new Map<string, boolean>() : null), [view])
  /** Kova's list, each sale checked with the keys once they're open. */
  const sales = useMemo(
    () =>
      takings.receipts.map((sale) => {
        if (!view || !verdicts) return { sale, yours: null }
        let yours = verdicts.get(sale.stealth_address)
        if (yours === undefined) {
          yours = opens(view, sale)
          verdicts.set(sale.stealth_address, yours)
        }
        return { sale, yours }
      }),
    [takings.receipts, view, verdicts],
  )
  const isEmpty = (sale: PrivateSale) => empty.has(sale.stealth_address.toLowerCase())
  const waiting = sales.filter(
    ({ sale, yours }) => !sale.swept_at && yours !== false && !isEmpty(sale),
  )
  const waitingTotal = totalOf(waiting.map((w) => w.sale))
  const movedCount = sales.filter(({ sale }) => sale.swept_at).length
  const notYours = sales.filter(({ yours }) => yours === false).length
  const other =
    keys && takings.meta_address ? stealthMetaAddress(keys) !== takings.meta_address : false
  const link = keys ? viewLink(origin, keys, shop.name) : null

  /** Why this browser can't use the passkey for this shop, and what to do instead. */
  const blocked: { text: string; href?: string; cta?: string } | null = demo
    ? {
        text: 'This is a shared demo shop, so its takings stay as they are. Open your own shop to keep yours private.',
        href: '/wallet/shop?go=open',
        cta: 'Open my shop',
      }
    : !home && wallet?.auth !== 'google'
      ? {
          text: `Private takings open with your Kova passkey, on ${passkeyDomain}.`,
          href: `https://${passkeyDomain}/dashboard/private`,
          cta: `Open ${passkeyDomain}`,
        }
      : !shop.owner
        ? {
            text: 'This shop signs in with a secret key. Link it to your Kova wallet in Settings, and your passkey can keep its takings private.',
            href: '/dashboard/settings',
            cta: 'Go to Settings',
          }
        : wallet === null
          ? {
              text: 'Your Kova wallet’s passkey makes this shop’s keys. Open your wallet on this browser first, then come back.',
              href: '/wallet',
              cta: 'Open my wallet',
            }
          : wallet && !linked
            ? {
                text: `This shop belongs to another Kova wallet, ${short(shop.owner ?? '')}. Open that wallet on this browser to use private takings.`,
                href: '/wallet',
                cta: 'Open my wallet',
              }
            : null

  /** The keys: already in memory, or from the passkey now. */
  const openKeys = async () => {
    if (keys) return keys
    if (!wallet || !linked) throw new Error('Open the Kova wallet this shop belongs to first.')
    const made = await takingsKeys(wallet, shop.id)
    setKeys(made)
    return made
  }

  const act = async (what: Exclude<Working, null>, task: () => Promise<void>) => {
    setWorking(what)
    setProblem(null)
    busy.current = true
    try {
      await task()
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Something went wrong. Try again.')
    } finally {
      busy.current = false
      setWorking(null)
    }
  }

  const turnOn = () =>
    act('on', async () => {
      const made = await openKeys()
      const result = await turnOnPrivateTakings(stealthMetaAddress(made))
      if (result.error) throw new Error(result.error)
      setTakings((t) => ({ ...t, enabled: true, meta_address: stealthMetaAddress(made) }))
    })

  const turnOff = () =>
    act('off', async () => {
      const result = await turnOffPrivateTakings()
      if (result.error) throw new Error(result.error)
      setTakings((t) => ({ ...t, enabled: false, meta_address: null }))
      setSureOff(false)
    })

  const move = () =>
    act('move', async () => {
      setMoved(null)
      const made = await openKeys()
      const ours = viewOf(made)
      const due = takings.receipts.filter(
        (sale) => !sale.swept_at && !isEmpty(sale) && opens(ours, sale),
      )
      if (!due.length) throw new Error('Nothing is waiting to move.')
      const started = performance.now()
      const signed = await signMoves(made, due, shop.settlement, shop.network)
      const { moves } = signed
      if (signed.empty.length)
        setEmpty((known) => {
          const next = new Set(known)
          for (const sale of signed.empty) next.add(sale.stealth_address.toLowerCase())
          return next
        })
      if (!moves.length)
        throw new Error(
          signed.empty.length === 1
            ? 'That address is empty on Monad, so there’s nothing to move.'
            : 'These addresses are empty on Monad, so there’s nothing to move.',
        )
      let amount = 0n
      let count = 0
      let failed: string | null = null
      let explorer: string | null = null
      for (let i = 0; i < moves.length; i += 50) {
        const batch = moves.slice(i, i + 50)
        const result = await movePrivateTakings(batch.map((m) => m.authorization))
        if (result.error) {
          failed = result.error
          break
        }
        for (const [j, done] of (result.moves ?? []).entries()) {
          if (done.error) failed ??= done.error
          else {
            amount += batch[j]?.amount ?? 0n
            count++
            explorer = done.explorer_url ?? explorer
          }
        }
      }
      if (count)
        setMoved({
          amount,
          count,
          failed: moves.length - count,
          seconds: ((performance.now() - started) / 1000).toFixed(1),
          explorer,
        })
      if (failed) setProblem(plain(failed))
      const fresh = await fetch('/api/private-takings', { cache: 'no-store' }).catch(() => null)
      if (fresh?.ok) setTakings((await fresh.json()) as PrivateTakings)
    })

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // No clipboard right after Face ID in some browsers: the link is on screen to copy.
    }
  }

  const getLink = () =>
    act('link', async () => {
      const made = await openKeys()
      await copy(viewLink(origin, made, shop.name))
    })

  const on = takings.enabled
  const [whole, cents] = formatUsd(waitingTotal).split('.')
  const lastPaid = takings.receipts[0]?.paid_at ?? null
  const shown = all ? sales : sales.slice(0, SHOWN)
  const canAct = !blocked
  /** The wallet is read after the page loads: until then the buttons are there, but resting. */
  const resting = working !== null || wallet === undefined

  return (
    <>
      <PageHead
        title="Private takings"
        sub={
          on
            ? 'On. Each sale goes to its own address that only your passkey can open.'
            : `Off. Sales land at ${short(shop.settlement)}, where anyone can add them up.`
        }
      />

      <div className="pt" data-on={on ? 'true' : undefined}>
        <div className="pt-main">
          {/* What's waiting, on or off: sales already private stay the shop's to move. */}
          {on || waiting.length ? (
            <section className="pt-hero pt-hero-on" aria-label="Waiting to move">
              <Art name="kovi-key" size={120} className="pt-kovi" priority />
              <p className="pt-label">Waiting to move</p>
              <p className="pt-amount">
                <Odometer value={whole ?? '$0'} />
                <span className="pt-cents">
                  .<Odometer value={cents ?? '00'} />
                </span>
              </p>
              <div className="pt-chips">
                <span className="chip">
                  {waiting.length} {waiting.length === 1 ? 'sale' : 'sales'} waiting
                </span>
                {movedCount ? (
                  <span className="chip">{movedCount} moved to your wallet</span>
                ) : null}
                {lastPaid ? <span className="chip">Last sale {ago(lastPaid)}</span> : null}
              </div>

              {moved ? (
                <p className="pt-moved" role="status">
                  <Icon name="check" size={18} />
                  <span>
                    Moved {formatUsd(moved.amount)} to your wallet in {moved.seconds} s
                    {moved.failed ? `; ${moved.failed} didn’t go, try again` : ''}.
                    {moved.explorer ? (
                      <>
                        {' '}
                        <a href={moved.explorer} target="_blank" rel="noreferrer">
                          See it on Monad
                        </a>
                      </>
                    ) : null}
                  </span>
                </p>
              ) : null}

              {on && other ? (
                <div className="pt-warn" role="alert">
                  <Icon name="info" size={18} />
                  <p>
                    Your passkey’s keys aren’t the ones this shop’s private takings use: they were
                    turned on with another wallet, which can still move those sales.
                  </p>
                  <button
                    type="button"
                    className="mini mini-ink"
                    disabled={working !== null}
                    onClick={() => void turnOn()}
                  >
                    Use my keys for new sales
                  </button>
                </div>
              ) : null}

              {canAct ? (
                <div className="pt-actions">
                  <button
                    type="button"
                    className="pill"
                    data-tone="light"
                    disabled={resting || waiting.length === 0}
                    onClick={() => void move()}
                  >
                    <span className="pill-label">
                      {working === 'move'
                        ? 'Moving…'
                        : waiting.length
                          ? `Move ${formatUsd(waitingTotal)} to wallet`
                          : 'Nothing to move'}
                    </span>
                    <span className="pill-cap">
                      {working === 'move' ? (
                        <span className="spinner" aria-hidden="true" />
                      ) : (
                        <Icon name={keys ? 'arrow' : 'face'} size={18} />
                      )}
                    </span>
                  </button>
                  <p className="pt-fine">
                    To {short(shop.settlement)}, where your sales land. It takes about a second, and
                    Kova covers the fee.
                  </p>
                </div>
              ) : blocked ? (
                <Blocked {...blocked} tone="on" />
              ) : null}
            </section>
          ) : null}

          {on ? null : (
            <section className="pt-hero" aria-label="Turn on private takings">
              <div className={`pt-pitch${waiting.length ? ' pt-pitch-plain' : ''}`}>
                {waiting.length ? null : (
                  <Art name="kovi-key" size={112} className="pt-pitch-art" priority />
                )}
                <h2>
                  {sales.length ? 'Keep new sales private too' : 'Keep your takings to yourself'}
                </h2>
                <p>
                  Right now sales land at{' '}
                  <span className="pt-nowrap">{short(shop.settlement)}</span>, and anyone can look
                  that address up on Monad and add up your day.{' '}
                  <a
                    href={addressUrl(shop.network, shop.settlement)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    See what they see
                  </a>
                </p>
              </div>
              <ol className="pt-steps">
                <li>Customers pay the way they always do.</li>
                <li>
                  Each sale goes to a new address made for it, that only your passkey can open.
                </li>
                <li>
                  Move it all to your wallet in one tap, whenever you like. Kova covers the fee.
                </li>
              </ol>
              {canAct ? (
                <div className="pt-actions">
                  <button
                    type="button"
                    className="pill"
                    data-tone="coral"
                    disabled={resting}
                    onClick={() => void turnOn()}
                  >
                    <span className="pill-label">
                      {working === 'on' ? 'Waiting for your passkey…' : 'Turn on private takings'}
                    </span>
                    <span className="pill-cap">
                      {working === 'on' ? (
                        <span className="spinner" aria-hidden="true" />
                      ) : (
                        <Icon name="face" size={18} />
                      )}
                    </span>
                  </button>
                  <p className="pt-fine">
                    Your passkey makes the keys, here on this device. Kova never has them: it can
                    point a payment at you, but never move it.
                  </p>
                </div>
              ) : blocked ? (
                <Blocked {...blocked} tone="off" />
              ) : null}
            </section>
          )}

          {problem ? (
            <p className="w-sheet-problem pt-problem" role="alert">
              <Icon name="info" size={18} />
              {problem}
            </p>
          ) : null}

          {on || sales.length ? (
            <section className="card pt-sales" aria-label="Private sales">
              <div className="card-head">
                <div>
                  <h2>Private sales</h2>
                  <p>
                    {sales.length
                      ? `${sales.length} ${sales.length === 1 ? 'sale' : 'sales'}, each paid to its own address`
                      : 'Each one lands here, at an address only you can open'}
                  </p>
                </div>
              </div>
              {sales.length ? (
                <>
                  <ol className="pt-list">
                    {shown.map(({ sale, yours }) => (
                      <SaleRow
                        key={sale.payment_intent}
                        sale={sale}
                        yours={yours}
                        empty={isEmpty(sale)}
                        explorer={shop.explorer}
                      />
                    ))}
                  </ol>
                  {sales.length > SHOWN ? (
                    <button type="button" className="pt-more" onClick={() => setAll(!all)}>
                      {all ? 'Show fewer' : `Show all ${sales.length}`}
                    </button>
                  ) : null}
                  <p className="pt-checked">
                    {view ? (
                      <>
                        <Icon name="shield" size={16} />
                        {notYours
                          ? `Checked with your keys: ${sales.length - notYours} of ${sales.length} are yours. The rest were made for other keys.`
                          : `Checked with your keys: ${sales.length === 1 ? 'it’s yours' : `all ${sales.length} are yours`}, at addresses only they open.`}
                      </>
                    ) : (
                      <>
                        <Icon name="lock" size={16} />
                        Your passkey checks each of these is yours when you move them or share the
                        view.
                      </>
                    )}
                  </p>
                </>
              ) : (
                <div className="pt-empty">
                  <Art name="kovi-sleep" size={120} />
                  <p>No private sales yet. Your next one lands here, the second it’s paid.</p>
                </div>
              )}
            </section>
          ) : null}
        </div>

        <aside className="pt-side">
          <section className="card card-pad pt-books" aria-label="Your accountant’s view">
            <span className="pt-books-icon">
              <Icon name="eye" size={20} />
            </span>
            <h2 className="setting-title">Your accountant’s view</h2>
            <p className="field-help">
              A link that sees every private sale and adds them up, and can’t move money. Send it to
              whoever keeps your books.
            </p>
            {link ? (
              <>
                <input
                  className="pt-link"
                  value={link}
                  readOnly
                  spellCheck={false}
                  aria-label="Accountant view link"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <div className="row-actions">
                  <button type="button" className="mini mini-ink" onClick={() => void copy(link)}>
                    <Icon name={copied ? 'check' : 'copy'} size={14} />{' '}
                    {copied ? 'Copied' : 'Copy accountant view link'}
                  </button>
                  <a className="mini" href={link} target="_blank" rel="noreferrer">
                    <Icon name="external" size={14} /> Open it
                  </a>
                </div>
              </>
            ) : (on || sales.length) && canAct ? (
              <button
                type="button"
                className="mini mini-ink pt-books-get"
                disabled={resting}
                onClick={() => void getLink()}
              >
                <Icon name={working === 'link' ? 'clock' : 'face'} size={14} />
                {working === 'link' ? 'Waiting for your passkey…' : 'Copy accountant view link'}
              </button>
            ) : (
              <p className="pt-books-off">
                {on || sales.length
                  ? 'The link is made with the passkey this shop belongs to.'
                  : 'Turn on private takings to get the link.'}
              </p>
            )}
            <p className="pt-fine pt-fine-dark">
              Whoever has the link can see these sales, so share it like a key. The key stays after
              the #, so it never reaches Kova.
            </p>
          </section>

          {on && !demo ? (
            <section className="card card-pad pt-off" aria-label="Turn off private takings">
              <h2 className="setting-title">Turn off</h2>
              {sureOff ? (
                <>
                  <p className="field-help">
                    New sales will land at {short(shop.settlement)} again, where anyone can add them
                    up. Sales already private stay yours to move.
                  </p>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="mini mini-danger"
                      disabled={working !== null}
                      onClick={() => void turnOff()}
                    >
                      {working === 'off' ? 'Turning off…' : 'Turn off private takings'}
                    </button>
                    <button type="button" className="mini" onClick={() => setSureOff(false)}>
                      Keep them private
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="field-help">
                    New sales go back to {short(shop.settlement)}. What’s private now stays private.
                  </p>
                  <div className="row-actions">
                    <button type="button" className="mini" onClick={() => setSureOff(true)}>
                      Turn off private takings
                    </button>
                  </div>
                </>
              )}
            </section>
          ) : null}
        </aside>
      </div>
    </>
  )
}

function Blocked({
  text,
  href,
  cta,
  tone,
}: {
  text: string
  href?: string
  cta?: string
  tone: 'on' | 'off'
}) {
  return (
    <div className="pt-blocked" data-tone={tone}>
      <p>{text}</p>
      {href && cta ? (
        href.startsWith('/') ? (
          <Link href={href} className="mini mini-ink">
            {cta} <Icon name="arrow" size={14} />
          </Link>
        ) : (
          <a href={href} className="mini mini-ink">
            {cta} <Icon name="arrow" size={14} />
          </a>
        )
      ) : null}
    </div>
  )
}

/** One private sale: when, how much, the one-time address it was paid to, and where it is now. */
function SaleRow({
  sale,
  yours,
  empty,
  explorer,
}: {
  sale: PrivateSale
  yours: boolean | null
  empty: boolean
  explorer: string
}) {
  const state = yours === false ? 'other' : sale.swept_at ? 'moved' : empty ? 'empty' : 'waiting'
  return (
    <li className="pt-sale" data-state={state}>
      <span className="pt-sale-icon" title={yours ? 'Checked with your keys' : undefined}>
        <Icon name={yours ? 'shield' : 'lock'} size={18} />
      </span>
      <a className="pt-sale-to" href={sale.explorer_url} target="_blank" rel="noreferrer">
        <span>Paid to its own address</span>
        <span className="pt-sale-address">
          {shortAddress(sale.stealth_address)} · {dateOf(sale.paid_at)}
        </span>
      </a>
      <span className="pt-sale-money">
        <span className="pt-sale-amount">{formatUsd(baseOf(sale.amount))}</span>
        {state === 'moved' && sale.swept_tx ? (
          <a
            className="pt-sale-state"
            href={`${explorer}/tx/${sale.swept_tx}`}
            target="_blank"
            rel="noreferrer"
          >
            Moved
          </a>
        ) : (
          <span className="pt-sale-state">
            {state === 'other'
              ? 'Other keys'
              : state === 'moved'
                ? 'Moved'
                : state === 'empty'
                  ? 'Empty on Monad'
                  : 'Waiting'}
          </span>
        )}
      </span>
    </li>
  )
}
