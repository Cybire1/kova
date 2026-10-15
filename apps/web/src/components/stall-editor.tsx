'use client'

import Link from 'next/link'
import { useEffect, useState, useTransition } from 'react'
import { closeStallForGood, updateStall } from '@/app/actions'
import type { CatalogItem, StallDetail } from '@/lib/api'
import { usd } from '@/lib/format'
import { Icon, Pill } from './brand'
import { ItemFace } from './catalogue-manager'
import { ItemSheet } from './item-sheet'
import { MenuImportSheet } from './menu-import'
import { StampCard } from './stamp-card'

/**
 * One stall, end to end: its sign, what it sells and in what order, how people find it, and a
 * live phone showing exactly what a buyer sees. Every change saves as it is made.
 */
export function StallEditor({
  stall: initial,
  catalogue: initialCatalogue,
}: {
  stall: StallDetail
  catalogue: CatalogItem[]
}) {
  const [stall, setStall] = useState(initial)
  const [catalogue, setCatalogue] = useState(initialCatalogue)
  const [onStall, setOnStall] = useState<string[]>(initial.items.map((i) => i.id))
  const [name, setName] = useState(initial.name)
  const [tagline, setTagline] = useState(initial.tagline ?? '')
  const [editing, setEditing] = useState<CatalogItem | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState(0)
  const [closing, setClosing] = useState(false)
  const [origin, setOrigin] = useState('')
  const [qr, setQr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [pending, start] = useTransition()
  // Counts change a step at a time: they save once the shop stops tapping.
  const [tables, setTables] = useState(initial.table_count ?? 6)
  const [every, setEvery] = useState(initial.loyalty_every ?? 5)

  const url = origin ? `${origin}/s/${stall.slug}` : `/s/${stall.slug}`
  const byId = new Map(catalogue.map((i) => [i.id, i]))
  const items = onStall.flatMap((id) => (byId.get(id) ? [byId.get(id) as CatalogItem] : []))
  const offStall = catalogue.filter((i) => !onStall.includes(i.id))

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  useEffect(() => {
    if (!origin) return
    void import('qrcode').then(({ toString: toSvg }) =>
      toSvg(`${origin}/s/${stall.slug}`, {
        type: 'svg',
        margin: 0,
        color: { dark: '#0b1a1d', light: '#ffffff' },
      }).then(setQr),
    )
  }, [origin, stall.slug])

  const save = (patch: Parameters<typeof updateStall>[1], label: string) =>
    start(async () => {
      setError(null)
      const r = await updateStall(stall.id, patch)
      if (r.error || !r.stall) return setError(r.error ?? 'Could not save')
      setStall((s) => ({ ...s, ...r.stall }))
      setSaved(label)
      setPreview((n) => n + 1)
      setTimeout(() => setSaved(null), 1800)
    })

  const setItems = (ids: string[]) => {
    setOnStall(ids)
    save({ item_ids: ids }, 'Items saved')
  }

  const move = (id: string, by: number) => {
    const i = onStall.indexOf(id)
    const j = i + by
    if (j < 0 || j >= onStall.length) return
    const next = [...onStall]
    ;[next[i], next[j]] = [next[j] as string, next[i] as string]
    setItems(next)
  }

  useEffect(() => {
    if (!stall.table_count || tables === stall.table_count) return
    const timer = setTimeout(() => save({ table_count: tables }, `${tables} tables`), 700)
    return () => clearTimeout(timer)
    // save is a fresh closure each render; the counts are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables, stall.table_count])

  useEffect(() => {
    if (!stall.loyalty_every || every === stall.loyalty_every) return
    const timer = setTimeout(() => save({ loyalty_every: every }, `A card of ${every} stamps`), 700)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [every, stall.loyalty_every])

  const copy = async () => {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`Order from ${stall.name} and pay with Kova: ${url}`)}`

  return (
    <div className="editor">
      <div className="editor-main">
        <Link href="/dashboard/stalls" className="backlink">
          <Icon name="back" size={16} /> Stalls
        </Link>
        <header className="editor-head">
          <div>
            <h1>{stall.name}</h1>
            <p>
              {saved ?? (pending ? 'Saving' : 'Changes save as you make them.')}
              {error ? <span className="form-error-inline"> {error}</span> : null}
            </p>
          </div>
          <label className="switch switch-big">
            <input
              type="checkbox"
              checked={stall.open}
              onChange={(e) =>
                save({ open: e.target.checked }, e.target.checked ? 'Open for orders' : 'Closed')
              }
            />
            <span aria-hidden="true" />
            <span className="switch-text">{stall.open ? 'Open for orders' : 'Closed'}</span>
          </label>
        </header>

        <section className="card card-pad editor-section" aria-label="The sign">
          <h2>The sign</h2>
          <div className="editor-fields">
            <label className="field-label" htmlFor="st-name">
              Name
            </label>
            <input
              id="st-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() =>
                name.trim() &&
                name.trim() !== stall.name &&
                save({ name: name.trim() }, 'Name saved')
              }
              maxLength={60}
            />
            <label className="field-label" htmlFor="st-tag">
              A line about it
            </label>
            <input
              id="st-tag"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              onBlur={() =>
                tagline.trim() !== (stall.tagline ?? '') &&
                save({ tagline: tagline.trim() || null }, 'Saved')
              }
              maxLength={120}
              placeholder="Fresh every morning, round the corner"
            />
          </div>
        </section>

        <section className="card editor-section" aria-label="What it sells">
          <div className="card-head">
            <div>
              <h2>What it sells</h2>
              <p>In the order buyers see it. Prices come from your catalogue.</p>
            </div>
          </div>
          {items.length === 0 ? (
            <p className="orders-empty">Nothing on this stall yet. Add something below.</p>
          ) : (
            <ol className="stall-items">
              {items.map((item, i) => (
                <li key={item.id} data-soldout={item.sold_out ? 'true' : undefined}>
                  <ItemFace item={item} size={48} />
                  <button
                    type="button"
                    className="stall-item-text"
                    onClick={() => setEditing(item)}
                  >
                    <strong>{item.name}</strong>
                    <span>
                      {usd(item.price)}
                      {item.sold_out ? ', sold out' : ''}
                    </span>
                  </button>
                  <span className="stall-item-moves">
                    <button
                      type="button"
                      className="round"
                      aria-label={`Move ${item.name} up`}
                      disabled={i === 0 || pending}
                      onClick={() => move(item.id, -1)}
                    >
                      <Icon name="up" size={16} />
                    </button>
                    <button
                      type="button"
                      className="round round-flip"
                      aria-label={`Move ${item.name} down`}
                      disabled={i === items.length - 1 || pending}
                      onClick={() => move(item.id, 1)}
                    >
                      <Icon name="up" size={16} />
                    </button>
                    <button
                      type="button"
                      className="round"
                      aria-label={`Take ${item.name} off this stall`}
                      disabled={pending}
                      onClick={() => setItems(onStall.filter((x) => x !== item.id))}
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          )}
          <div className="card-body">
            {offStall.length ? (
              <>
                <p className="field-label">From your catalogue</p>
                <div className="chips-add">
                  {offStall.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="chip-add"
                      disabled={pending}
                      onClick={() => setItems([...onStall, item.id])}
                    >
                      <Icon name="plus" size={14} /> {item.name} <span>{usd(item.price)}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            <div className="row-actions">
              <button type="button" className="mini mini-ink" onClick={() => setEditing('new')}>
                <Icon name="plus" size={14} /> New item
              </button>
              <button type="button" className="mini" onClick={() => setImporting(true)}>
                <Icon name="camera" size={14} /> Snap your menu
              </button>
            </div>
          </div>
        </section>

        <section className="card card-pad editor-section" aria-label="Tables">
          <div className="setting-head">
            <div>
              <h2>Tables</h2>
              <p>
                Each table gets its own QR code. The order says which table it’s for, and the
                buyer’s phone tells them when it’s ready. No buzzers.
              </p>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={Boolean(stall.table_count)}
                onChange={(e) =>
                  save(
                    { table_count: e.target.checked ? tables : null },
                    e.target.checked ? 'Table ordering on' : 'Counter only',
                  )
                }
                aria-label="Order from the table"
              />
              <span aria-hidden="true" />
            </label>
          </div>
          {stall.table_count ? (
            <div className="setting-body">
              <div className="setting-count">
                <span className="field-label" id="st-tables">
                  How many tables
                </span>
                {/* biome-ignore lint/a11y/useSemanticElements: an inline stepper beside its label; a <fieldset> is a block form group */}
                <span className="stepper" role="group" aria-labelledby="st-tables">
                  <button
                    type="button"
                    aria-label="One table fewer"
                    disabled={tables <= 1}
                    onClick={() => setTables((n) => Math.max(1, n - 1))}
                  >
                    −
                  </button>
                  <span aria-live="polite">{tables}</span>
                  <button
                    type="button"
                    aria-label="One table more"
                    disabled={tables >= 200}
                    onClick={() => setTables((n) => Math.min(200, n + 1))}
                  >
                    +
                  </button>
                </span>
              </div>
              <ul className="setting-tables" aria-label="Your tables">
                {Array.from({ length: Math.min(tables, 12) }, (_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: tables are numbered positions
                  <li key={i}>{i + 1}</li>
                ))}
                {tables > 12 ? <li className="setting-tables-more">+{tables - 12}</li> : null}
              </ul>
              <div className="row-actions">
                <a
                  className="mini mini-ink"
                  href={`/s/${stall.slug}/poster?tables=1`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon name="download" size={14} /> Print table cards
                </a>
                <a
                  className="mini"
                  href={`/s/${stall.slug}?table=1`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon name="external" size={14} /> Try table 1
                </a>
              </div>
            </div>
          ) : (
            <p className="setting-off">Off: orders are collected at the counter.</p>
          )}
        </section>

        <section className="card card-pad editor-section" aria-label="Stamp card">
          <div className="setting-head">
            <div>
              <h2>Stamp card</h2>
              <p>
                Every paid order is a stamp. When the card is full, the cheapest thing on the next
                order is free. No sign-up: the wallet a buyer pays with is their card.
              </p>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={Boolean(stall.loyalty_every)}
                onChange={(e) =>
                  save(
                    { loyalty_every: e.target.checked ? every : null },
                    e.target.checked ? 'Stamp card on' : 'Stamp card off',
                  )
                }
                aria-label="Stamp card"
              />
              <span aria-hidden="true" />
            </label>
          </div>
          {stall.loyalty_every ? (
            <div className="setting-body">
              <div className="setting-count">
                <span className="field-label" id="st-every">
                  Stamps to fill it
                </span>
                {/* biome-ignore lint/a11y/useSemanticElements: an inline stepper beside its label; a <fieldset> is a block form group */}
                <span className="stepper" role="group" aria-labelledby="st-every">
                  <button
                    type="button"
                    aria-label="One stamp fewer"
                    disabled={every <= 2}
                    onClick={() => setEvery((n) => Math.max(2, n - 1))}
                  >
                    −
                  </button>
                  <span aria-live="polite">{every}</span>
                  <button
                    type="button"
                    aria-label="One stamp more"
                    disabled={every >= 20}
                    onClick={() => setEvery((n) => Math.min(20, n + 1))}
                  >
                    +
                  </button>
                </span>
              </div>
              <div className="setting-preview">
                <p className="field-label">What a regular sees</p>
                <StampCard
                  every={every}
                  stamps={Math.max(1, every - 2)}
                  ready={false}
                  known
                  shop={stall.name}
                />
              </div>
              <p className="field-help">
                The free item is still paid through Kova, at $0.00, so it shows in your payments
                like any order.
              </p>
            </div>
          ) : (
            <p className="setting-off">Off: no stamps, everyone pays full price.</p>
          )}
        </section>

        <section className="card card-pad editor-section" aria-label="Share it">
          <h2>Share it</h2>
          <div className="share">
            {qr ? (
              <div
                className="qr share-qr"
                role="img"
                aria-label="QR code for the shop's link"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: an SVG the qrcode package drew from our own link, not user HTML
                dangerouslySetInnerHTML={{ __html: qr }}
              />
            ) : (
              <div className="qr share-qr" />
            )}
            <div className="share-actions">
              <div className="field-value">
                <code>{url}</code>
                <button
                  type="button"
                  className="round"
                  aria-label="Copy the stall link"
                  onClick={copy}
                >
                  <Icon name={copied ? 'check' : 'copy'} size={16} />
                </button>
              </div>
              <a
                className="mini mini-ink"
                href={`/s/${stall.slug}/poster`}
                target="_blank"
                rel="noreferrer"
              >
                Print the table poster
              </a>
              <a className="mini" href={whatsapp} target="_blank" rel="noreferrer">
                <Icon name="whatsapp" size={14} /> Share on WhatsApp
              </a>
              <a className="mini" href={`/s/${stall.slug}`} target="_blank" rel="noreferrer">
                <Icon name="external" size={14} /> Open the stall
              </a>
            </div>
          </div>
        </section>

        <section className="editor-danger">
          {closing ? (
            <div className="inline-confirm">
              <span>
                Close {stall.name} for good? Its link stops working. Your catalogue stays.
              </span>
              <button type="button" className="mini" onClick={() => setClosing(false)}>
                Keep it
              </button>
              <button
                type="button"
                className="mini mini-danger"
                onClick={() => start(() => closeStallForGood(stall.id))}
              >
                Close for good
              </button>
            </div>
          ) : (
            <button type="button" className="linkbutton" onClick={() => setClosing(true)}>
              Close this stall for good
            </button>
          )}
        </section>
      </div>

      <aside className="editor-preview" aria-label="What buyers see">
        <p>What buyers see</p>
        <div className="preview-phone">
          <iframe
            key={preview}
            src={`/s/${stall.slug}?preview=1`}
            title={`${stall.name} preview`}
          />
        </div>
      </aside>

      {editing ? (
        <ItemSheet
          item={editing === 'new' ? null : editing}
          stallId={stall.id}
          onClose={() => setEditing(null)}
          onSaved={(item) => {
            setCatalogue((list) =>
              list.some((i) => i.id === item.id)
                ? list.map((i) => (i.id === item.id ? item : i))
                : [...list, item],
            )
            if (!onStall.includes(item.id)) setOnStall((ids) => [...ids, item.id])
            setEditing(null)
            setPreview((n) => n + 1)
          }}
          onRemoved={(id) => {
            setCatalogue((list) => list.filter((i) => i.id !== id))
            setOnStall((ids) => ids.filter((x) => x !== id))
            setEditing(null)
            setPreview((n) => n + 1)
          }}
        />
      ) : null}
      {importing ? (
        <MenuImportSheet
          stallId={stall.id}
          onClose={() => setImporting(false)}
          onAdded={(added) => {
            setCatalogue((list) => [...list, ...added])
            setOnStall((ids) => [...ids, ...added.map((a) => a.id)])
            setPreview((n) => n + 1)
          }}
        />
      ) : null}
    </div>
  )
}
