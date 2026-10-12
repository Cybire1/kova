'use client'

import type { NetworkId } from '@kova/monad'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Announcement } from '@/lib/api'
import { ago } from '@/lib/format'
import {
  baseOf,
  byNewest,
  fileSlug,
  readViewLink,
  saveFile,
  scan,
  shortAddress,
  takingsCsv,
  totalOf,
  type ViewKey,
} from '@/lib/takings'
import { formatUsd } from '@/lib/wallet/money'
import { Art, Icon } from './brand'
import { Odometer } from './odometer'

/**
 * The accountant's view of a shop's private takings. The link's # holds the shop's viewing key
 * (and its name); this page fetches every private sale Kova has announced, for every shop and with
 * no shop named, and checks each one here in the browser for the ones that key opens. The key never
 * leaves the page, not even for Kova. It can see every sale and add them up; it can move nothing.
 */

type Stage =
  | { at: 'reading' }
  /** No key after the #, or one that's cut short. */
  | { at: 'invalid'; missing: boolean }
  | { at: 'failed' }
  /** Fetching everyone's sales and checking them for this shop's. */
  | { at: 'looking' }
  | { at: 'ready' }

interface Page {
  data: Announcement[]
  next: string | null
}

/** Every announcement after `after`, following Kova's pages to the end. */
async function fetchAfter(after: string | null) {
  const all: Announcement[] = []
  let cursor = after
  for (;;) {
    const query = cursor ? `?after=${encodeURIComponent(cursor)}` : ''
    const response = await fetch(`/api/announcements${query}`, { cache: 'no-store' })
    if (!response.ok) throw new Error(`Kova didn’t answer (${response.status})`)
    const page = (await response.json()) as Page
    all.push(...page.data)
    if (!page.next) return all
    cursor = page.next
  }
}

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`

function dayName(date: Date) {
  const today = new Date()
  if (dayKey(date) === dayKey(today)) return 'Today'
  if (dayKey(date) === dayKey(new Date(today.getTime() - 86_400_000))) return 'Yesterday'
  return date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
}

/** The most squares the "everyone's sales" picture draws; past that, a square stands for several. */
const MOST_SQUARES = 360
const POLL_MS = 10_000
/** On a phone the ledger shows this many, then "Show all": the page goes on below it. */
const PHONE_ROWS = 8

/** A phone-width screen, where the ledger sits in the page rather than beside it. */
function useNarrow() {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 900px)')
    const update = () => setNarrow(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return narrow
}

export function Books({ network }: { network: NetworkId }) {
  const [stage, setStage] = useState<Stage>({ at: 'reading' })
  const [name, setName] = useState<string | null>(null)
  /** Every private sale on Kova, oldest first: the haystack. */
  const [everyone, setEveryone] = useState<Announcement[]>([])
  const [checked, setChecked] = useState(0)
  const [mine, setMine] = useState<Announcement[]>([])
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const [, setNow] = useState(0)
  const view = useRef<ViewKey | null>(null)
  const run = useRef(0)

  /** Reads the key from the #, then looks through every sale on Kova for the ones it opens. */
  const open = useCallback(async () => {
    const id = ++run.current
    const stopped = () => run.current !== id
    const fragment = window.location.hash
    const link = readViewLink(fragment)
    if (!link) {
      view.current = null
      return setStage({ at: 'invalid', missing: fragment.replace(/^#/, '').trim() === '' })
    }
    view.current = link.view
    setName(link.name)
    // The shop's name is only in the #, so the tab learns it here, in the browser.
    if (link.name) document.title = `${link.name}’s private takings · Kova`
    setEveryone([])
    setChecked(0)
    setMine([])
    setStage({ at: 'looking' })
    try {
      const all = await fetchAfter(null)
      if (stopped()) return
      setEveryone(all)
      const found = await scan(
        link.view,
        all,
        (n, so) => {
          if (stopped()) return
          setChecked(n)
          setMine(so)
        },
        stopped,
      )
      if (!found || stopped()) return
      setChecked(all.length)
      setMine(found)
      setStage({ at: 'ready' })
    } catch {
      if (!stopped()) setStage({ at: 'failed' })
    }
  }, [])

  useEffect(() => {
    void open()
    const reopen = () => void open()
    window.addEventListener('hashchange', reopen)
    return () => {
      run.current++
      window.removeEventListener('hashchange', reopen)
    }
  }, [open])

  // New sales land while the page is open: check only what's new since the last one seen.
  useEffect(() => {
    if (stage.at !== 'ready') return
    let busy = false
    const tick = async () => {
      setNow(Date.now()) // keeps "Last sale 3 min ago" honest
      const key = view.current
      const last = everyone[everyone.length - 1]?.id ?? null
      if (busy || !key || document.visibilityState !== 'visible') return
      busy = true
      try {
        const added = await fetchAfter(last)
        if (!added.length) return
        const id = run.current
        const found = await scan(
          key,
          added,
          () => {},
          () => run.current !== id,
        )
        if (!found || run.current !== id) return
        setEveryone((list) => [...list, ...added])
        setChecked((n) => n + added.length)
        if (found.length) {
          setMine((list) => [...list, ...found])
          setFresh(new Set(found.map((s) => s.id)))
        }
      } catch {
        // Offline for a moment: the next tick tries again.
      } finally {
        busy = false
      }
    }
    const timer = setInterval(() => void tick(), POLL_MS)
    return () => clearInterval(timer)
  }, [stage.at, everyone])

  const shop = name ?? 'This shop'
  const owner = name ? `${name}’s` : 'this shop’s'
  const total = totalOf(mine)
  const sales = useMemo(() => [...mine].sort(byNewest), [mine])

  if (stage.at === 'reading')
    return (
      <div className="bk-panel bk-panel-quiet" aria-busy="true">
        <span className="spinner" aria-hidden="true" />
      </div>
    )

  if (stage.at === 'invalid')
    return (
      <div className="bk-panel bk-closed" role="alert">
        <Art name="kovi-oops" size={104} priority />
        <h1 className="bk-closed-h">
          {stage.missing ? 'This view opens with its link' : 'This view doesn’t open'}
        </h1>
        <p className="w-lead">
          {stage.missing
            ? 'It shows a shop’s private takings to whoever has the shop’s own link. Ask the shop for theirs and open it whole.'
            : 'The key at the end of the link is missing or cut short. Ask the shop to copy their accountant view link again, and open all of it.'}
        </p>
      </div>
    )

  if (stage.at === 'failed')
    return (
      <div className="bk-panel bk-closed" role="alert">
        <Art name="kovi-oops" size={104} priority />
        <h1 className="bk-closed-h">Kova didn’t answer</h1>
        <p className="w-lead">
          The sales couldn’t load just now. Check your connection, then try again.
        </p>
        <button type="button" className="pill" data-tone="light" onClick={() => void open()}>
          <span className="pill-label">Try again</span>
          <span className="pill-cap">
            <Icon name="refresh" size={18} />
          </span>
        </button>
      </div>
    )

  const looking = stage.at === 'looking'
  const usd = formatUsd(total)
  const dot = usd.lastIndexOf('.')
  const count = mine.length
  const first = sales[sales.length - 1]?.paid_at
  const last = sales[0]?.paid_at

  const download = () =>
    saveFile(
      `${fileSlug(shop)}-private-takings-${new Date().toISOString().slice(0, 10)}.csv`,
      takingsCsv(mine),
    )

  return (
    <div className="bk" data-stage={stage.at}>
      <section className="bk-hero" aria-labelledby="bk-title">
        <p className="bk-eyebrow">
          <Icon name="lock" size={14} />
          Private takings
        </p>
        <h1 id="bk-title">{name ? `${name}’s private takings` : 'A shop’s private takings'}</h1>
        <p className="bk-lead">
          This view can see every sale. It can’t move money. Nobody without this link can add these
          up.
        </p>
      </section>

      <section className="bk-total" aria-label="Taken privately" aria-busy={looking}>
        <Art name="kovi-key" size={132} className="bk-kovi" priority />
        <p className="bk-label">{looking ? 'Adding up…' : 'Taken privately'}</p>
        <p className="bk-amount">
          <Odometer value={usd.slice(0, dot)} />
          <span className="bk-cents">
            .<Odometer value={usd.slice(dot + 1)} />
          </span>
        </p>
        <div className="bk-chips">
          <span className="chip">
            {count} {count === 1 ? 'sale' : 'sales'}
          </span>
          {count ? <span className="chip">Average {formatUsd(total / BigInt(count))}</span> : null}
          {first ? (
            <span className="chip">
              Since {new Date(first).toLocaleDateString([], { day: 'numeric', month: 'long' })}
            </span>
          ) : null}
          {last && !looking ? <span className="chip">Last sale {ago(last)}</span> : null}
        </div>
        <button
          type="button"
          className="pill bk-csv"
          data-tone="light"
          disabled={looking || count === 0}
          onClick={download}
        >
          <span className="pill-label">Download CSV</span>
          <span className="pill-cap">
            <Icon name="download" size={18} />
          </span>
        </button>
      </section>

      <Haystack everyone={everyone} checked={checked} mine={mine} owner={owner} looking={looking} />

      <Ledger sales={sales} fresh={fresh} looking={looking} owner={owner} onDownload={download} />

      {count ? <Days sales={mine} /> : null}

      <section className="bk-how" aria-label="How this view works">
        <h2>How this view works</h2>
        <ol>
          <li>
            <span className="bk-how-icon">
              <Icon name="shield" size={18} />
            </span>
            <strong>Every sale has its own address</strong>
            <p>
              Each customer paid an address made for that one sale. On Monad they look like
              strangers: nothing ties them to {name ?? 'the shop'}, or to each other.
            </p>
          </li>
          <li>
            <span className="bk-how-icon">
              <Icon name="key" size={18} />
            </span>
            <strong>This link’s key finds them</strong>
            <p>
              The key at the end of this link picks {owner} sales out of everyone’s, here in your
              browser. It never leaves it, not even for Kova.
            </p>
          </li>
          <li>
            <span className="bk-how-icon">
              <Icon name="eye" size={18} />
            </span>
            <strong>It can look, not move</strong>
            <p>
              Moving the dollars takes {owner} own passkey. This view can’t move a cent, and neither
              can Kova.
            </p>
          </li>
        </ol>
      </section>

      <p className="bk-foot">
        Keep this link to yourself: whoever has it can see these sales, though never move them.
        {network === 'testnet' ? ' Test dollars on Monad testnet.' : ''}
      </p>
    </div>
  )
}

/**
 * Every private sale on Kova as a square, the shop's lit up: the whole idea in one picture. Kova
 * publishes all of them with no names; only this link's key can tell which are the shop's.
 */
function Haystack({
  everyone,
  checked,
  mine,
  owner,
  looking,
}: {
  everyone: Announcement[]
  checked: number
  mine: Announcement[]
  owner: string
  looking: boolean
}) {
  const total = everyone.length
  const per = Math.max(1, Math.ceil(total / MOST_SQUARES))
  const squares = Math.ceil(total / per)
  const lit = useMemo(() => {
    const index = new Map(everyone.map((a, i) => [a.id, i]))
    return new Set(mine.map((a) => Math.floor((index.get(a.id) ?? 0) / per)))
  }, [everyone, mine, per])
  const size = squares <= 48 ? 'l' : squares <= 160 ? 'm' : 's'

  return (
    <section className="bk-find" aria-label="Found with this link’s key">
      <div className="bk-find-head">
        <h2>Found with this link’s key</h2>
        <p aria-live={looking ? 'off' : 'polite'}>
          {total === 0
            ? looking
              ? 'Fetching every private sale on Kova…'
              : 'No shop has a private sale on Kova yet.'
            : looking
              ? `Checking ${checked.toLocaleString()} of ${total.toLocaleString()} private sales on Kova…`
              : mine.length
                ? `${mine.length.toLocaleString()} of the ${total.toLocaleString()} private sales on Kova are ${owner}. To anyone without this link, they look like all the others.`
                : `None of the ${total.toLocaleString()} private sales on Kova are ${owner} yet.`}
        </p>
      </div>
      {squares ? (
        <ol className="bk-squares" data-size={size} aria-hidden="true">
          {Array.from({ length: squares }, (_, i) => {
            const done = Math.min((i + 1) * per, total) <= checked
            return (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed grid of positions
                key={i}
                data-state={lit.has(i) ? 'mine' : done ? 'other' : 'waiting'}
              />
            )
          })}
        </ol>
      ) : (
        <div className="bk-squares-empty" aria-hidden="true" />
      )}
      <ul className="bk-key">
        <li>
          <span data-state="mine" /> {owner.charAt(0).toUpperCase() + owner.slice(1)}
        </li>
        <li>
          <span data-state="other" /> Every other shop’s
        </li>
        {per > 1 ? <li className="bk-key-note">Each square is {per} sales</li> : null}
      </ul>
    </section>
  )
}

/** Every sale, newest first, by day: when, how much, and the address it was paid to. */
function Ledger({
  sales,
  fresh,
  looking,
  owner,
  onDownload,
}: {
  sales: Announcement[]
  fresh: Set<string>
  looking: boolean
  owner: string
  onDownload: () => void
}) {
  const narrow = useNarrow()
  const [all, setAll] = useState(false)
  const capped = narrow && !all && sales.length > PHONE_ROWS
  const days: { key: string; label: string; total: bigint; sales: Announcement[] }[] = []
  for (const sale of capped ? sales.slice(0, PHONE_ROWS) : sales) {
    const at = new Date(sale.paid_at ?? 0)
    const key = dayKey(at)
    let day = days[days.length - 1]
    if (!day || day.key !== key) {
      day = { key, label: dayName(at), total: 0n, sales: [] }
      days.push(day)
    }
    day.total += baseOf(sale.amount)
    day.sales.push(sale)
  }

  return (
    <section className="bk-ledger" aria-label="Every sale">
      <div className="bk-ledger-head">
        <div>
          <h2>Every sale</h2>
          <p>
            {looking
              ? 'Filling in as they’re found'
              : sales.length
                ? `${sales.length} ${sales.length === 1 ? 'sale' : 'sales'}, newest first`
                : 'None yet'}
          </p>
        </div>
        <button
          type="button"
          className="mini"
          disabled={looking || sales.length === 0}
          onClick={onDownload}
        >
          <Icon name="download" size={14} /> CSV
        </button>
      </div>
      {sales.length ? (
        <div className="bk-days-list">
          {days.map((day) => (
            <section key={day.key} className="bk-day" aria-label={day.label}>
              <h3>
                <span>{day.label}</span>
                <span>{formatUsd(day.total)}</span>
              </h3>
              <ol>
                {day.sales.map((sale) => (
                  <li
                    key={sale.id}
                    className="bk-sale"
                    data-new={fresh.has(sale.id) ? 'true' : undefined}
                  >
                    <span className="bk-sale-time">{sale.paid_at ? timeOf(sale.paid_at) : ''}</span>
                    <a
                      className="bk-sale-to"
                      href={sale.explorer_url}
                      target="_blank"
                      rel="noreferrer"
                      title="See this payment on Monad’s explorer"
                    >
                      <span>Paid to its own address</span>
                      <span className="bk-sale-address">
                        {shortAddress(sale.stealth_address)} <Icon name="external" size={12} />
                      </span>
                    </a>
                    <span className="bk-sale-amount">{formatUsd(baseOf(sale.amount))}</span>
                  </li>
                ))}
              </ol>
            </section>
          ))}
          {capped ? (
            <button type="button" className="bk-all" onClick={() => setAll(true)}>
              Show all {sales.length} sales
            </button>
          ) : null}
        </div>
      ) : (
        <div className="bk-ledger-empty">
          {looking ? (
            <span className="spinner" aria-hidden="true" />
          ) : (
            <>
              <Art name="kovi-sleep" size={120} />
              <p>
                No private sales yet. When a customer pays, the sale shows up here, already checked
                as {owner}.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  )
}

/** The last two weeks, a bar a day, today in coral. */
function Days({ sales }: { sales: Announcement[] }) {
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  const days = Array.from({ length: 14 }, (_, i) => {
    const date = new Date(today.getTime() - (13 - i) * 86_400_000)
    return { key: dayKey(date), date, total: 0n, count: 0 }
  })
  const byKey = new Map(days.map((d) => [d.key, d]))
  for (const sale of sales) {
    const day = sale.paid_at ? byKey.get(dayKey(new Date(sale.paid_at))) : undefined
    if (!day) continue
    day.total += baseOf(sale.amount)
    day.count++
  }
  const most = days.reduce((m, d) => (d.total > m ? d.total : m), 0n)
  const sum = days.reduce((s, d) => s + d.total, 0n)
  const count = days.reduce((n, d) => n + d.count, 0)

  return (
    <section className="bk-chart" aria-label="The last 14 days">
      <div className="bk-chart-head">
        <h2>The last 14 days</h2>
        <p>
          {count
            ? `${formatUsd(sum)} across ${count} ${count === 1 ? 'sale' : 'sales'}`
            : 'No private sales in the last two weeks.'}
        </p>
      </div>
      <ol className="bk-bars">
        {days.map((d, i) => {
          const height = most === 0n ? 0 : Math.max(Number((d.total * 1000n) / most) / 10, 7)
          const tip = `${d.date.toLocaleDateString([], {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}: ${formatUsd(d.total)}, ${d.count} ${d.count === 1 ? 'sale' : 'sales'}`
          return (
            <li
              key={d.key}
              className="bk-bar"
              data-today={i === days.length - 1 ? 'true' : undefined}
              title={tip}
              aria-label={tip}
            >
              {d.total > 0n ? (
                <span
                  className="bk-bar-fill"
                  style={{ height: `${height}%`, animationDelay: `${i * 30}ms` }}
                />
              ) : (
                <span className="bk-bar-stub" />
              )}
            </li>
          )
        })}
      </ol>
      <p className="bk-axis" aria-hidden="true">
        <span>{days[0]?.date.toLocaleDateString([], { day: 'numeric', month: 'short' })}</span>
        <span>Today</span>
      </p>
    </section>
  )
}
