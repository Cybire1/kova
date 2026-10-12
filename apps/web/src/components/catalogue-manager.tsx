'use client'

import { useState, useTransition } from 'react'
import { saveItem } from '@/app/actions'
import type { CatalogItem } from '@/lib/api'
import { usd } from '@/lib/format'
import { Art, Icon, Pill } from './brand'
import { ItemSheet } from './item-sheet'
import { MenuImportSheet } from './menu-import'
import { PageHead } from './shell'

/** A tile for an item with no photo: its first letter, on a colour picked from its name. */
export function ItemFace({ item, size = 56 }: { item: Pick<CatalogItem, 'name' | 'image_url'>; size?: number }) {
  if (item.image_url)
    return (
      // biome-ignore lint/performance/noImgElement: the seller's own photo, already sized
      <img className="item-face" src={item.image_url} alt="" width={size} height={size} />
    )
  const tones = ['#a9c9c9', '#ebb3aa', '#dedcd8', '#f3d6d0']
  const tone = tones[[...item.name].reduce((n, c) => n + c.charCodeAt(0), 0) % tones.length]
  // Sized through a variable, so a phone layout can draw it smaller, as it does the photos.
  return (
    <span className="item-face item-face-letter" style={{ '--face': `${size}px`, background: tone } as React.CSSProperties} aria-hidden="true">
      {item.name.trim().charAt(0).toUpperCase()}
    </span>
  )
}

/**
 * Everything the shop sells, in one place: what its stalls show, what its till scans. Add by
 * hand, from a photo of the menu, or by barcode.
 */
export function CatalogueManager({ initial }: { initial: CatalogItem[] }) {
  const [items, setItems] = useState(initial)
  const [editing, setEditing] = useState<CatalogItem | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [query, setQuery] = useState('')
  const [, start] = useTransition()

  const shown = query.trim()
    ? items.filter((i) => `${i.name} ${i.barcode ?? ''} ${i.description ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
    : items

  const toggleSoldOut = (item: CatalogItem) => {
    setItems((list) => list.map((i) => (i.id === item.id ? { ...i, sold_out: !i.sold_out } : i)))
    start(async () => {
      const r = await saveItem(item.id, { sold_out: !item.sold_out })
      if (r.item) setItems((list) => list.map((i) => (i.id === item.id ? (r.item as CatalogItem) : i)))
    })
  }

  return (
    <>
      {/* With nothing for sale yet, the empty card below offers both ways to start. */}
      <PageHead title="Catalogue" sub={`${items.length} ${items.length === 1 ? 'item' : 'items'}, shared by your stalls and your till`}>
        {items.length ? (
          <>
            <Pill icon="camera" tone="light" onClick={() => setImporting(true)}>
              Snap<span className="pill-more"> your</span> menu
            </Pill>
            <Pill icon="plus" onClick={() => setEditing('new')}>
              Add<span className="pill-more"> an</span> item
            </Pill>
          </>
        ) : null}
      </PageHead>

      {items.length === 0 ? (
        <section className="card empty big-empty">
          <Art name="kovi-wave" size={140} />
          <h3>Nothing for sale yet</h3>
          <p>Add what you sell once, and every stall and till uses it. The quickest start: take a photo of your menu or price board.</p>
          <div className="row-actions">
            <Pill icon="camera" tone="coral" onClick={() => setImporting(true)}>
              Snap your menu
            </Pill>
            <Pill icon="plus" tone="light" onClick={() => setEditing('new')}>
              Add by hand
            </Pill>
          </div>
        </section>
      ) : (
        <>
          <div className="toolbar">
            <form className="search" role="search" onSubmit={(e) => e.preventDefault()}>
              <Icon name="search" size={18} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or barcode" aria-label="Search the catalogue" />
            </form>
            <p className="field-help">Scan barcodes with the Kova app to add packaged goods in a second.</p>
          </div>
          <ul className="cat-grid">
            {shown.map((item) => (
              <li key={item.id} className="cat-item" data-soldout={item.sold_out ? 'true' : undefined}>
                <button type="button" className="cat-main" onClick={() => setEditing(item)} aria-label={`Edit ${item.name}`}>
                  <ItemFace item={item} size={64} />
                  <span className="cat-text">
                    <span className="cat-name">{item.name}</span>
                    <span className="cat-price">{usd(item.price)}</span>
                    {item.barcode ? (
                      <span className="cat-code">
                        <Icon name="barcode" size={13} /> {item.barcode}
                      </span>
                    ) : null}
                  </span>
                </button>
                <label className="switch" title={item.sold_out ? 'Sold out' : 'In stock'}>
                  <input type="checkbox" checked={!item.sold_out} onChange={() => toggleSoldOut(item)} aria-label={`${item.name} in stock`} />
                  <span aria-hidden="true" />
                  <span className="switch-text">{item.sold_out ? 'Sold out' : 'In stock'}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      {editing ? (
        <ItemSheet
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setItems((list) => (list.some((i) => i.id === saved.id) ? list.map((i) => (i.id === saved.id ? saved : i)) : [...list, saved]))
            setEditing(null)
          }}
          onRemoved={(id) => {
            setItems((list) => list.filter((i) => i.id !== id))
            setEditing(null)
          }}
        />
      ) : null}
      {importing ? (
        <MenuImportSheet
          onClose={() => setImporting(false)}
          onAdded={(added) => {
            setItems((list) => [...list, ...added])
          }}
        />
      ) : null}
    </>
  )
}
