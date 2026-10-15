'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { lookupBarcode, removeItem, saveItem } from '@/app/actions'
import type { CatalogItem } from '@/lib/api'
import { Icon, Pill } from './brand'
import { uploadPhoto } from './photos'

/**
 * Add or edit one thing a shop sells. A barcode can be typed (or comes from the app's scanner)
 * and looked up, which fills in the name when an open product database knows it.
 */
export function ItemSheet({
  item,
  stallId,
  onClose,
  onSaved,
  onRemoved,
}: {
  item: CatalogItem | null
  stallId?: string
  onClose: () => void
  onSaved: (item: CatalogItem) => void
  onRemoved?: (id: string) => void
}) {
  const [name, setName] = useState(item?.name ?? '')
  const [price, setPrice] = useState(item?.price ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [barcode, setBarcode] = useState(item?.barcode ?? '')
  const [soldOut, setSoldOut] = useState(item?.sold_out ?? false)
  const [photo, setPhoto] = useState<{ id: string | null; url: string | null }>({
    id: item?.image_id ?? null,
    url: item?.image_url ?? null,
  })
  const [uploading, setUploading] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pending, start] = useTransition()
  const first = useRef<HTMLInputElement>(null)
  const handlers = useRef({ onClose })
  handlers.current = { onClose }

  useEffect(() => {
    first.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && handlers.current.onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const pick = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      setPhoto(await uploadPhoto(file))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const look = () =>
    start(async () => {
      setNote(null)
      const r = await lookupBarcode(barcode.trim())
      if (r.error) return setError(r.error)
      if (r.lookup?.item && r.lookup.item.id !== item?.id)
        return setNote(`Already in your catalogue as “${r.lookup.item.name}”.`)
      if (r.lookup?.suggestion) {
        if (!name.trim()) setName(r.lookup.suggestion.name)
        return setNote(`Found: ${r.lookup.suggestion.name}.`)
      }
      setNote('Not in the product databases. Name it yourself.')
    })

  const save = () =>
    start(async () => {
      setError(null)
      const r = await saveItem(item?.id ?? null, {
        name: name.trim(),
        price: price.trim().replace(/^\$/, ''),
        description: description.trim() || null,
        barcode: barcode.trim() || null,
        image_id: photo.id,
        ...(item ? { sold_out: soldOut } : {}),
        ...(!item && stallId ? { stall_ids: [stallId] } : {}),
      })
      if (r.error || !r.item) return setError(r.error ?? 'Could not save')
      onSaved(r.item)
    })

  const remove = () =>
    start(async () => {
      if (!item) return
      const r = await removeItem(item.id)
      if (r.error) return setError(r.error)
      onRemoved?.(item.id)
    })

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a backdrop click is a mouse shortcut; Escape and the Close button close the sheet from the keyboard
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="sheet item-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-title"
      >
        <button type="button" className="round sheet-close" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
        <h2 id="item-title">{item ? 'Edit item' : 'Add an item'}</h2>

        <form
          className="stack-form"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <label className="photo-pick" data-empty={photo.url ? undefined : 'true'}>
            {photo.url ? (
              // biome-ignore lint/performance/noImgElement: the uploaded photo, shown as uploaded
              <img src={photo.url} alt="" />
            ) : (
              <span>
                <Icon name="camera" size={22} />
                {uploading ? 'Uploading' : 'Add a photo'}
              </span>
            )}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => pick(e.target.files?.[0])}
              disabled={uploading}
            />
          </label>
          {photo.url ? (
            <button
              type="button"
              className="linkbutton small-link"
              onClick={() => setPhoto({ id: null, url: null })}
            >
              Remove photo
            </button>
          ) : null}

          <label className="field-label" htmlFor="item-name">
            Name
          </label>
          <input
            id="item-name"
            ref={first}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            placeholder="Iced latte"
          />

          <label className="field-label" htmlFor="item-price">
            Price in dollars
          </label>
          <div className="money-input">
            <span>$</span>
            <input
              id="item-price"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              required
              placeholder="4.75"
              pattern="\$?\d+(\.\d{1,2})?"
            />
          </div>

          <label className="field-label" htmlFor="item-desc">
            Description <span className="optional">optional</span>
          </label>
          <input
            id="item-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={200}
            placeholder="Oat milk on request"
          />

          <label className="field-label" htmlFor="item-barcode">
            Barcode <span className="optional">optional, for the till</span>
          </label>
          <div className="inline-form">
            <input
              id="item-barcode"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              maxLength={14}
              placeholder="5449000000996"
              className="mono-input"
            />
            <button
              type="button"
              className="mini"
              onClick={look}
              disabled={pending || barcode.trim().length < 8}
            >
              <Icon name="search" size={14} /> Look up
            </button>
          </div>
          {note ? <p className="field-help">{note}</p> : null}

          {item ? (
            <label className="checkline">
              <input
                type="checkbox"
                checked={soldOut}
                onChange={(e) => setSoldOut(e.target.checked)}
              />
              Sold out for now
            </label>
          ) : null}

          {error ? <p className="form-error">{error}</p> : null}

          <Pill type="submit" icon="check" disabled={pending || uploading} wide>
            {pending ? 'Saving' : item ? 'Save changes' : 'Add item'}
          </Pill>
        </form>

        {item && onRemoved ? (
          confirmDelete ? (
            <div className="inline-confirm sheet-danger">
              <span>Remove it from your catalogue and every stall?</span>
              <button type="button" className="mini" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
              <button
                type="button"
                className="mini mini-danger"
                onClick={remove}
                disabled={pending}
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="linkbutton sheet-danger-link"
              onClick={() => setConfirmDelete(true)}
            >
              <Icon name="trash" size={15} /> Remove this item
            </button>
          )
        ) : null}
      </div>
    </div>
  )
}
