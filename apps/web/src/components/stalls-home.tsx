'use client'

import Link from 'next/link'
import { useEffect, useState, useTransition } from 'react'
import { markCollected, setOrderStatus } from '@/app/actions'
import type { Order, Stall } from '@/lib/api'
import { ago, usd } from '@/lib/format'
import { Awning } from './awning'
import { Art, Icon, Pill } from './brand'
import { PageHead } from './shell'

type Filter = 'hand' | 'waiting' | 'done'

const paid = (o: Order) => o.payment_status === 'paid'
const waiting = (o: Order) =>
  o.payment_status === 'requires_payment' || o.payment_status === 'processing'
const summary = (o: Order) =>
  o.lines.map((l) => (l.quantity > 1 ? `${l.quantity} × ${l.name}` : l.name)).join(', ')

/**
 * The stalls a shop runs, and the orders coming in from them. Orders that are paid but not yet
 * handed over sit at the top until someone taps Collected. Ready tells the buyer's phone (it
 * lights up and chimes), so nobody needs a buzzer; a table order says which table to bring it to.
 */
export function StallsHome({
  stalls,
  initialOrders,
  catalogueSize,
}: {
  stalls: Stall[]
  initialOrders: Order[]
  catalogueSize: number
}) {
  const [orders, setOrders] = useState(initialOrders)
  const [filter, setFilter] = useState<Filter>('hand')
  const [copied, setCopied] = useState<string | null>(null)
  const [, start] = useTransition()

  useEffect(() => {
    const id = setInterval(async () => {
      const r = await fetch('/api/orders').catch(() => null)
      if (r?.ok) setOrders((await r.json()) as Order[])
    }, 4000)
    return () => clearInterval(id)
  }, [])

  const toHand = orders.filter((o) => paid(o) && !o.collected_at)
  const lists: Record<Filter, Order[]> = {
    hand: toHand,
    waiting: orders.filter(waiting),
    done: orders.filter((o) => o.collected_at),
  }
  const shown = lists[filter]

  const collect = (o: Order, collected: boolean) => {
    setOrders((list) =>
      list.map((x) =>
        x.id === o.id ? { ...x, collected_at: collected ? new Date().toISOString() : null } : x,
      ),
    )
    start(async () => {
      await markCollected(o.id, collected)
    })
  }

  const ready = (o: Order) => {
    setOrders((list) => list.map((x) => (x.id === o.id ? { ...x, status: 'ready' } : x)))
    start(async () => {
      await setOrderStatus(o.id, 'ready')
    })
  }

  const share = async (s: Stall) => {
    await navigator.clipboard.writeText(`${window.location.origin}/s/${s.slug}`)
    setCopied(s.id)
    setTimeout(() => setCopied(null), 1600)
  }

  if (stalls.length === 0)
    return (
      <>
        <PageHead title="Stalls" sub="Pocket shops people order from with a link or a QR code" />
        <section className="stall-first">
          <Awning height={64} />
          <div className="stall-first-body">
            <Art name="kovi-wave" size={150} className="stall-first-kovi" />
            <h2>Open your first stall</h2>
            <p>
              A stall is your menu on a link. Share it on WhatsApp, tape its QR code to your table,
              and people pay from their own phones, from anywhere, in dollars.
            </p>
            <ol className="stall-steps">
              <li>Add what you sell, or snap a photo of your menu.</li>
              <li>Share the link, or print the table poster.</li>
              <li>Orders land here, already paid, with the buyer’s name.</li>
            </ol>
            <Pill href="/dashboard/stalls/new" icon="stall" tone="coral">
              Open a stall
            </Pill>
          </div>
        </section>
      </>
    )

  return (
    <>
      <PageHead
        title="Stalls"
        sub={`${stalls.length} ${stalls.length === 1 ? 'stall' : 'stalls'}, ${catalogueSize} items in your catalogue`}
      >
        <Pill href="/dashboard/catalogue" icon="tag" tone="light">
          Catalogue
        </Pill>
        <Pill href="/dashboard/stalls/new" icon="plus" tone="coral">
          Open a stall
        </Pill>
      </PageHead>

      <div className="stalls-layout">
        <section className="stall-cards" aria-label="Your stalls">
          {stalls.map((s) => (
            <article key={s.id} className="stall-card" data-open={s.open ? 'true' : undefined}>
              <Awning height={44} tone={s.open ? 'coral' : 'teal'} />
              <div className="stall-card-body">
                <div className="stall-card-top">
                  <h3>{s.name}</h3>
                  <span className="chip" data-state={s.open ? 'live' : 'stale'}>
                    <span className="dot" />
                    {s.open ? 'Open' : 'Closed'}
                  </span>
                </div>
                {s.tagline ? <p className="stall-card-line">{s.tagline}</p> : null}
                <p className="stall-card-meta">
                  {s.item_ids?.length ?? 0} {s.item_ids?.length === 1 ? 'item' : 'items'}, at /s/
                  {s.slug}
                  {s.table_count
                    ? `, ${s.table_count} ${s.table_count === 1 ? 'table' : 'tables'}`
                    : ''}
                  {s.loyalty_every ? `, stamp card of ${s.loyalty_every}` : ''}
                </p>
                <div className="stall-card-actions">
                  <Link href={`/dashboard/stalls/${s.id}`} className="mini mini-ink">
                    Edit stall
                  </Link>
                  <button type="button" className="mini" onClick={() => share(s)}>
                    <Icon name={copied === s.id ? 'check' : 'copy'} size={14} />{' '}
                    {copied === s.id ? 'Link copied' : 'Copy link'}
                  </button>
                  <a className="mini" href={`/s/${s.slug}/poster`} target="_blank" rel="noreferrer">
                    Poster
                  </a>
                </div>
              </div>
            </article>
          ))}
        </section>

        <section className="card orders" aria-label="Orders">
          <div className="card-head">
            <h2>Orders</h2>
            <p>{toHand.length ? `${toHand.length} to hand over` : 'All handed over'}</p>
          </div>
          {/* The app's three: a count where there's something to do, none on what's done. */}
          <div className="orders-tabs" role="tablist">
            {(
              [
                ['hand', 'To hand over'],
                ['waiting', 'Waiting'],
                ['done', 'Done'],
              ] as [Filter, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                onClick={() => setFilter(key)}
              >
                {label}
                {key !== 'done' && lists[key].length ? <span>{lists[key].length}</span> : null}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="orders-empty">
              {filter === 'hand'
                ? 'Nothing waiting at the counter.'
                : filter === 'waiting'
                  ? 'No unpaid orders.'
                  : 'Nothing collected yet today.'}
            </p>
          ) : (
            <ul className="order-list">
              {shown.map((o) => (
                <li
                  key={o.id}
                  className="order"
                  data-state={o.collected_at ? 'done' : paid(o) ? 'hand' : 'waiting'}
                >
                  <div className="order-top">
                    <strong>
                      {o.customer_name ?? (o.source === 'till' ? 'At the till' : 'No name given')}
                    </strong>
                    <span className="order-amount">{usd(o.amount ?? '0')}</span>
                  </div>
                  {o.table || o.reward || (o.status === 'ready' && !o.collected_at) ? (
                    <p className="order-tags">
                      {o.table ? (
                        <span className="order-tag order-tag-table">
                          <Icon name="stall" size={13} /> Table {o.table}
                        </span>
                      ) : null}
                      {o.reward ? (
                        <span className="order-tag order-tag-stamp">
                          Stamp card: {o.reward.name} free
                        </span>
                      ) : null}
                      {o.status === 'ready' && !o.collected_at ? (
                        <span className="order-tag order-tag-ready">
                          <Icon name="bell" size={13} /> Ready, they’ve been told
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                  <p className="order-lines">{summary(o)}</p>
                  {o.note ? <p className="order-note">“{o.note}”</p> : null}
                  <div className="order-foot">
                    <span>
                      {o.stall?.name ?? 'Till'}, {ago(o.created_at)}
                      {o.pay_for_me && waiting(o) ? ', someone else is paying' : ''}
                    </span>
                    {paid(o) ? (
                      <span className="order-acts">
                        {o.collected_at || o.status === 'ready' ? null : (
                          <button
                            type="button"
                            className="mini mini-coral"
                            onClick={() => ready(o)}
                          >
                            <Icon name="bell" size={14} /> Ready
                          </button>
                        )}
                        <button
                          type="button"
                          className={`mini${o.collected_at ? '' : ' mini-ink'}`}
                          onClick={() => collect(o, !o.collected_at)}
                        >
                          {o.collected_at ? (
                            'Undo'
                          ) : (
                            <>
                              <Icon name="check" size={14} /> Collected
                            </>
                          )}
                        </button>
                      </span>
                    ) : (
                      <span className="order-wait">Waiting to pay</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  )
}
