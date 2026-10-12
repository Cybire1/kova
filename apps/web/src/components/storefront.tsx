'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import type { Checkout, OrderReward, OrderStatus, PublicStall } from '@/lib/api'
import { usd } from '@/lib/format'
import { type Currency, inCurrency, type LiveRates, RATES } from '@/lib/rates'
import { Awning } from './awning'
import { Art, Icon, LogoMark, Pill } from './brand'
import { OrderReady } from './order-ready'
import { StampCard, useStampCard } from './stamp-card'

type Placed = {
  id: string
  table?: string | null
  status?: OrderStatus
  reward?: OrderReward | null
  checkout: { id: string; amount: string; expires_at: string }
}

/** A tint for a product with no photo yet, stable per name. */
const TINTS = ['#a9c9c9', '#ebb3aa', '#f3d6d0', '#cfe3dc', '#efe0c6']
const tintFor = (name: string) => TINTS[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % TINTS.length]

type Item = PublicStall['items'][number]

/**
 * A stall, as a buyer sees it: a proper little shop. The stall's awning hangs over its window
 * (the cover photo), then everything for sale as photo cards with quick add, a product view, a
 * bag that slides in, and a checkout that pays now or sends the bill to someone else. Prices
 * can show in the buyer's own currency; everything is paid in dollars.
 *
 * Opened from a table's QR code (?table=3), the order says which table to bring it to. With a
 * stamp card on, the buyer sees their stamps here: the wallet that pays is the card.
 */
export function Storefront({ stall, preview, rates, table }: { stall: PublicStall; preview: boolean; rates?: LiveRates; table: string | null }) {
  const router = useRouter()
  const [basket, setBasket] = useState<Record<string, number>>({})
  const [currency, setCurrency] = useState<Currency>('USD')
  const [bagOpen, setBagOpen] = useState(false)
  const [viewing, setViewing] = useState<Item | null>(null)
  /** How many the buyer has picked in the product view, before it goes in the bag. */
  const [picked, setPicked] = useState(1)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<'pay' | 'ask' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [asked, setAsked] = useState<Placed | null>(null)
  const [shared, setShared] = useState(false)
  const { payer, card } = useStampCard(stall.slug, Boolean(stall.loyalty_every) && !preview)

  const lines = useMemo(
    () => stall.items.flatMap((item) => (basket[item.id] ? [{ item, quantity: basket[item.id] as number }] : [])),
    [stall.items, basket],
  )
  const count = lines.reduce((n, l) => n + l.quantity, 0)
  const subtotal = lines.reduce((sum, l) => sum + Number(l.item.price) * l.quantity, 0)
  // A full card makes the cheapest thing in the bag free; Kova works it out again when the order is placed.
  const free = card?.ready && lines.length ? lines.reduce((a, b) => (Number(b.item.price) < Number(a.item.price) ? b : a)).item : null
  const total = Math.max(0, subtotal - Number(free?.price ?? 0))
  const ordering = stall.open && !preview

  const set = (id: string, quantity: number) => setBasket((b) => ({ ...b, [id]: Math.max(0, Math.min(99, quantity)) }))
  const price = (dollars: number | string) => (currency === 'USD' ? usd(dollars) : inCurrency(dollars, currency, rates))

  // Escape closes whatever is open, like any good shop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy) return
      setViewing(null)
      setBagOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy])

  const share = async () => {
    const url = window.location.href
    if (typeof navigator.share === 'function') await navigator.share({ title: stall.name, url }).catch(() => {})
    else {
      await navigator.clipboard.writeText(url)
      setShared(true)
      setTimeout(() => setShared(false), 1800)
    }
  }

  const place = async (payForMe: boolean) => {
    setBusy(payForMe ? 'ask' : 'pay')
    setError(null)
    try {
      const response = await fetch(`/api/stalls/${stall.slug}/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: lines.map((l) => ({ id: l.item.id, quantity: l.quantity })),
          customer_name: name.trim() || undefined,
          note: note.trim() || undefined,
          pay_for_me: payForMe,
          table: table ?? undefined,
          payer: payer ?? undefined,
        }),
      })
      const body = (await response.json()) as Placed & { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Could not place the order')
      if (payForMe) setAsked(body)
      else router.push(`/pay/${body.checkout.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not place the order')
    } finally {
      setBusy(null)
    }
  }

  const available = stall.items.filter((i) => !i.sold_out).length

  return (
    <div className="store">
      <header className="store-bar">
        <a className="store-brand" href="#top" aria-label={`${stall.name}, back to the top`}>
          <span className="store-mark" aria-hidden="true">
            {stall.name.trim().charAt(0).toUpperCase()}
          </span>
          <span className="store-brand-name">{stall.name}</span>
        </a>
        <div className="store-bar-end">
          <label className="store-currency">
            <span className="sr-only">Show prices in</span>
            <span aria-hidden="true">
              {RATES[currency].symbol.trim()} {currency}
            </span>
            <Icon name="chevronDown" size={14} />
            <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
              {(Object.keys(RATES) as Currency[]).map((c) => (
                <option key={c} value={c}>
                  {RATES[c].symbol.trim()} {c}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="store-bag-button" data-full={count > 0 ? 'true' : undefined} onClick={() => setBagOpen(true)} aria-label={`Bag, ${count} ${count === 1 ? 'item' : 'items'}`}>
            <Icon name="bag" size={18} />
            <span>Bag</span>
            {count > 0 ? <span className="store-bag-count">{count}</span> : null}
          </button>
        </div>
      </header>

      <section className="store-hero" id="top">
        <Awning height={64} stripe={30} className="store-awning" tone={stall.open ? 'coral' : 'teal'} />
        {stall.cover_url ? (
          <>
            <div className="store-window">
              {/* biome-ignore lint/performance/noImgElement: the seller's own photo, already sized */}
              <img src={stall.cover_url} alt="" className="store-window-photo" />
            </div>
            <div className="store-intro">
              <h1>{stall.name}</h1>
              {stall.tagline ? <p className="store-tagline">{stall.tagline}</p> : null}
            </div>
          </>
        ) : (
          // No photo of the shop yet: its name, painted on the board under the awning.
          <div className="store-sign">
            <div className="store-sign-text">
              <h1>{stall.name}</h1>
              {stall.tagline ? <p className="store-tagline">{stall.tagline}</p> : null}
            </div>
            <span className="store-sign-kovi" aria-hidden="true">
              <Art name="kovi-cheer" size={124} />
            </span>
          </div>
        )}
        <div className="store-intro store-intro-more">
          <div className="store-facts">
            <span className="chip" data-state={stall.open ? 'live' : 'stale'}>
              <span className="dot" />
              {stall.open ? 'Open now' : 'Closed right now'}
            </span>
            <span className="chip">
              {available} {available === 1 ? 'thing' : 'things'} to order
            </span>
            {stall.livemode ? null : <span className="chip">Test dollars</span>}
            {table ? (
              <span className="chip chip-table">
                <Icon name="stall" size={14} /> Table {table}
              </span>
            ) : null}
          </div>
          <div className="store-actions">
            <button type="button" className="store-action" onClick={() => void share()}>
              <Icon name={shared ? 'check' : 'share'} size={16} /> {shared ? 'Link copied' : 'Share this shop'}
            </button>
          </div>
        </div>
      </section>

      {preview ? <p className="store-preview">Preview. Ordering is switched off here.</p> : null}

      {stall.loyalty_every ? (
        <div className="store-stamps">
          <StampCard
            every={stall.loyalty_every}
            stamps={card?.stamps ?? 0}
            ready={Boolean(card?.ready)}
            known={Boolean(payer && card)}
            shop={stall.name}
          />
        </div>
      ) : null}

      {stall.items.length === 0 ? (
        <div className="store-empty">
          <Art name="kovi-sleep" size={112} />
          <p>Nothing on the menu yet. Check back soon.</p>
        </div>
      ) : (
        <section className="store-shelf" aria-label="Everything for sale">
          <div className="store-shelf-head">
            <h2>Everything</h2>
            <p>Order now and pay from your phone. No card fees.</p>
          </div>
          <ul className="store-grid">
            {stall.items.map((item) => {
              const qty = basket[item.id] ?? 0
              return (
                <li key={item.id} className="product" data-soldout={item.sold_out ? 'true' : undefined}>
                  <button
                    type="button"
                    className="product-open"
                    onClick={() => {
                      setPicked(basket[item.id] || 1)
                      setViewing(item)
                    }}
                    aria-label={`${item.name}, ${usd(item.price)}`}
                  >
                    <span className="product-photo" style={item.image_url ? undefined : { background: tintFor(item.name) }}>
                      {item.image_url ? (
                        // biome-ignore lint/performance/noImgElement: the seller's own photo, already sized
                        <img src={item.image_url} alt="" loading="lazy" />
                      ) : (
                        <span className="product-type" aria-hidden="true">
                          {item.name}
                        </span>
                      )}
                      {item.sold_out ? <span className="product-sold">Sold out</span> : null}
                    </span>
                    {item.image_url ? (
                      <span className="product-name">{item.name}</span>
                    ) : item.description ? (
                      <span className="product-desc">{item.description}</span>
                    ) : null}
                    <span className="product-price">
                      {price(item.price)}
                      {currency !== 'USD' ? <em>{usd(item.price)}</em> : null}
                    </span>
                  </button>
                  {item.sold_out ? null : qty === 0 ? (
                    <button type="button" className="product-add" aria-label={`Add ${item.name} to your bag`} disabled={!ordering} onClick={() => set(item.id, 1)}>
                      <Icon name="plus" size={18} />
                    </button>
                  ) : (
                    <span className="product-qty stepper stepper-sm">
                      <button type="button" aria-label={`One less ${item.name}`} onClick={() => set(item.id, qty - 1)}>
                        −
                      </button>
                      <span aria-live="polite">{qty}</span>
                      <button type="button" aria-label={`One more ${item.name}`} onClick={() => set(item.id, qty + 1)}>
                        +
                      </button>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <footer className="store-foot">
        <div>
          <strong>{stall.name}</strong>
          {stall.tagline ? <p>{stall.tagline}</p> : null}
        </div>
        <p className="store-powered">
          <LogoMark size={20} /> Paid in dollars with Kova. No card fees, settled in seconds.
        </p>
      </footer>

      {count > 0 && !bagOpen && !viewing ? (
        <button type="button" className="store-bagbar" onClick={() => setBagOpen(true)}>
          <span className="store-bag-count">{count}</span>
          <span>View bag</span>
          <strong>{price(total)}</strong>
        </button>
      ) : null}

      {viewing ? (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setViewing(null)}>
          <div className="sheet product-sheet" role="dialog" aria-modal="true" aria-labelledby="product-title">
            <button type="button" className="round sheet-close" aria-label="Close" onClick={() => setViewing(null)} autoFocus>
              <Icon name="close" size={18} />
            </button>
            <span className="product-sheet-photo" style={viewing.image_url ? undefined : { background: tintFor(viewing.name) }}>
              {viewing.image_url ? (
                // biome-ignore lint/performance/noImgElement: the seller's own photo, already sized
                <img src={viewing.image_url} alt="" />
              ) : (
                <span className="product-type product-type-big" aria-hidden="true">
                  {viewing.name}
                </span>
              )}
            </span>
            <h2 id="product-title">{viewing.name}</h2>
            <p className="product-sheet-price">
              {price(viewing.price)}
              {currency !== 'USD' ? <em>{usd(viewing.price)}, paid in dollars</em> : null}
            </p>
            {viewing.description ? <p className="sheet-lead">{viewing.description}</p> : null}
            {viewing.sold_out ? (
              <p className="product-sheet-note">Sold out for now.</p>
            ) : (
              <div className="product-sheet-buy">
                <span className="stepper">
                  <button type="button" aria-label="One less" onClick={() => setPicked((n) => Math.max(0, n - 1))} disabled={picked === 0}>
                    −
                  </button>
                  <span aria-live="polite">{picked}</span>
                  <button type="button" aria-label="One more" onClick={() => setPicked((n) => Math.min(99, n + 1))}>
                    +
                  </button>
                </span>
                <Pill
                  icon="bag"
                  tone="coral"
                  disabled={!ordering || (picked === 0 && !basket[viewing.id])}
                  onClick={() => {
                    set(viewing.id, picked)
                    setViewing(null)
                  }}
                  wide
                >
                  {picked === 0 ? 'Remove' : `${basket[viewing.id] ? 'Update' : 'Add'} ${price(Number(viewing.price) * picked)}`}
                </Pill>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {bagOpen ? (
        <div className="overlay store-drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && setBagOpen(false)}>
          <div className="sheet store-drawer" role="dialog" aria-modal="true" aria-labelledby="bag-title">
            <button type="button" className="round sheet-close" aria-label="Close" onClick={() => setBagOpen(false)} autoFocus>
              <Icon name="close" size={18} />
            </button>
            {asked ? (
              <AskedToPay stall={stall} placed={asked} />
            ) : lines.length === 0 ? (
              <div className="store-drawer-empty">
                <Art name="kovi-sleep" size={104} />
                <h2 id="bag-title">Your bag is empty</h2>
                <p className="sheet-lead">Tap + on anything you like.</p>
              </div>
            ) : (
              <>
                <h2 id="bag-title">Your bag</h2>
                <p className="sheet-lead">
                  From {stall.name}. {count} {count === 1 ? 'thing' : 'things'}.
                </p>
                <ul className="bag-lines">
                  {lines.map((l) => (
                    <li key={l.item.id}>
                      <span className="bag-thumb" style={l.item.image_url ? undefined : { background: tintFor(l.item.name) }}>
                        {l.item.image_url ? (
                          // biome-ignore lint/performance/noImgElement: the seller's own photo, already sized
                          <img src={l.item.image_url} alt="" />
                        ) : (
                          l.item.name.charAt(0).toUpperCase()
                        )}
                      </span>
                      <span className="bag-line-text">
                        <strong>{l.item.name}</strong>
                        <span>
                          {price(Number(l.item.price) * l.quantity)}
                          {free?.id === l.item.id ? <em className="bag-free"> · one free</em> : null}
                        </span>
                      </span>
                      <span className="stepper stepper-sm">
                        <button type="button" aria-label={`One less ${l.item.name}`} onClick={() => set(l.item.id, l.quantity - 1)}>
                          −
                        </button>
                        <span>{l.quantity}</span>
                        <button type="button" aria-label={`One more ${l.item.name}`} onClick={() => set(l.item.id, l.quantity + 1)}>
                          +
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
                {free ? (
                  <p className="basket-reward">
                    <span className="basket-reward-stamp" aria-hidden="true">
                      <LogoMark size={18} stem="#fff" wave="var(--ink)" />
                    </span>
                    <span>
                      <strong>Free with your stamp card</strong> One {free.name}
                    </span>
                    <em>−{usd(free.price)}</em>
                  </p>
                ) : null}
                <p className="basket-total">
                  <span>Total</span>
                  <strong>{usd(total)}</strong>
                </p>
                {table ? (
                  <p className="basket-table">
                    <Icon name="stall" size={16} /> For table {table}. They’ll bring it over.
                  </p>
                ) : null}
                {currency !== 'USD' ? <p className="field-help basket-approx">About {inCurrency(total, currency, rates)}. You pay in dollars.</p> : null}
                <div className="stack-form">
                  <label className="field-label" htmlFor="buyer-name">
                    Your name <span className="optional">so they know it’s yours</span>
                  </label>
                  <input id="buyer-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Sam" autoComplete="given-name" />
                  <label className="field-label" htmlFor="buyer-note">
                    A note for {stall.name} <span className="optional">anything they should know</span>
                  </label>
                  <input id="buyer-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Gift-wrap it, please" />
                </div>
                {error ? <p className="form-error">{error}</p> : null}
                <div className="basket-pay">
                  <Pill icon="tap" tone="coral" onClick={() => place(false)} disabled={!ordering || busy !== null} wide>
                    {busy === 'pay' ? 'Opening payment' : total === 0 ? 'Get it free' : `Pay ${usd(total)}`}
                  </Pill>
                  <Pill icon="send" tone="light" onClick={() => place(true)} disabled={!ordering || busy !== null} wide>
                    {busy === 'ask' ? 'Making the link' : 'Ask someone else to pay'}
                  </Pill>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** The pay-for-me handoff: a link to send, and the moment it's paid. */
function AskedToPay({ stall, placed }: { stall: PublicStall; placed: Placed }) {
  const [link, setLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [paid, setPaid] = useState<Checkout['order'] | false>(false)

  useEffect(() => {
    setLink(`${window.location.origin}/pay/${placed.checkout.id}`)
    const id = setInterval(async () => {
      const r = await fetch(`/api/checkout/${placed.checkout.id}`).catch(() => null)
      if (!r?.ok) return
      const { status, order } = (await r.json()) as Checkout
      if (status === 'paid') {
        setPaid(order)
        clearInterval(id)
      }
    }, 2500)
    return () => clearInterval(id)
  }, [placed.checkout.id])

  if (paid !== false)
    return (
      <div className="asked">
        <Art name="kovi-cheer" size={104} />
        <h2>It’s paid</h2>
        <p className="sheet-lead">Someone paid {usd(placed.checkout.amount)} for your order. {stall.name} has it.</p>
        {/* The one who ordered is the one waiting for it: they see it get ready here. */}
        {paid?.status ? <OrderReady checkoutId={placed.checkout.id} order={paid} shop={stall.name} /> : null}
      </div>
    )

  const message = `Can you pay for my order at ${stall.name}? It’s ${usd(placed.checkout.amount)}, paid in dollars with Kova: ${link}`
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator
  return (
    <div className="asked">
      <Art name="kovi-ride" size={104} />
      <h2>Send it to whoever’s paying</h2>
      <p className="sheet-lead">They can pay from anywhere, with Kova Pay or any Monad wallet. The link stays open for 24 hours, and this page updates when it’s paid.</p>
      <div className="field-value">
        <code>{link}</code>
        <button
          type="button"
          className="round"
          aria-label="Copy the payment link"
          onClick={async () => {
            await navigator.clipboard.writeText(link)
            setCopied(true)
          }}
        >
          <Icon name={copied ? 'check' : 'copy'} size={16} />
        </button>
      </div>
      <div className="basket-pay">
        <Pill href={`https://wa.me/?text=${encodeURIComponent(message)}`} icon="whatsapp" tone="coral" wide>
          Send on WhatsApp
        </Pill>
        {canShare ? (
          <Pill icon="share" tone="light" onClick={() => void navigator.share({ title: stall.name, text: message })} wide>
            Share another way
          </Pill>
        ) : null}
      </div>
      <p className="asked-wait">
        <span className="dot" /> Waiting for their payment
      </p>
    </div>
  )
}
