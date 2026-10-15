'use client'

import { useEffect, useRef, useState } from 'react'
import { saveItem } from '@/app/actions'
import type { CatalogItem, MenuImport } from '@/lib/api'
import { Art, Icon, Pill } from './brand'
import { menuPhoto } from './photos'

type Line = MenuImport['items'][number] & { keep: boolean }

const originalText = (o: { amount: number; currency: string }) => {
  const symbols: Record<string, string> = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    NGN: '₦',
    KES: 'KSh ',
    MXN: 'MX$',
  }
  return o.currency === 'USD'
    ? null
    : `${symbols[o.currency] ?? ''}${o.amount.toLocaleString('en-US')}`
}

/**
 * Snap your menu: a photo of a price board becomes catalogue items. Kova reads it, converts
 * local prices to dollars at the published reference rate, and the seller ticks, fixes and adds.
 */
export function MenuImportSheet({
  stallId,
  onClose,
  onAdded,
}: {
  stallId?: string
  onClose: () => void
  onAdded: (items: CatalogItem[]) => void
}) {
  const [stage, setStage] = useState<'pick' | 'reading' | 'review' | 'saving'>('pick')
  const [preview, setPreview] = useState<string | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [currency, setCurrency] = useState('USD')
  const [error, setError] = useState<string | null>(null)
  const handlers = useRef({ onClose })
  handlers.current = { onClose }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && handlers.current.onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const read = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setPreview(URL.createObjectURL(file))
    setStage('reading')
    try {
      const image = await menuPhoto(file)
      const response = await fetch('/api/catalog/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: image.data, media_type: image.media_type }),
      })
      const body = (await response.json()) as MenuImport & { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Could not read that menu')
      if (!body.items.length) throw new Error('No prices found. Try a closer, straighter photo.')
      setCurrency(body.currency)
      setLines(body.items.map((i) => ({ ...i, keep: true })))
      setStage('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that menu')
      setStage('pick')
    }
  }

  const update = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const chosen = lines.filter((l) => l.keep)

  const add = async () => {
    setStage('saving')
    setError(null)
    const added: CatalogItem[] = []
    for (const line of chosen) {
      const r = await saveItem(null, {
        name: line.name,
        price: line.price,
        description: line.description,
        ...(stallId ? { stall_ids: [stallId] } : {}),
      })
      if (r.item) added.push(r.item)
      else {
        setError(`${line.name}: ${r.error ?? 'could not be added'}`)
        break
      }
    }
    if (added.length) onAdded(added)
    setStage('review')
    setLines((ls) => ls.filter((l) => !added.some((a) => a.name === l.name)))
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a backdrop click is a mouse shortcut; Escape and the Close button close the sheet from the keyboard
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="sheet menu-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="menu-title"
      >
        <button type="button" className="round sheet-close" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
        <h2 id="menu-title">Snap your menu</h2>
        <p className="sheet-lead">
          A photo of your price board or menu becomes items you can sell. You check every line
          before it’s added.
        </p>

        {stage === 'pick' || stage === 'reading' ? (
          <label className="menu-drop" data-busy={stage === 'reading' ? 'true' : undefined}>
            {preview ? (
              // biome-ignore lint/performance/noImgElement: a local preview of the chosen photo
              <img src={preview} alt="" />
            ) : (
              <Art name="kovi-key" size={110} />
            )}
            <span className="menu-drop-text">
              {stage === 'reading' ? (
                <>
                  <span className="menu-spinner" aria-hidden="true" /> Reading your menu
                </>
              ) : (
                <>
                  <Icon name="camera" size={18} /> Take or choose a photo
                </>
              )}
            </span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={stage === 'reading'}
              onChange={(e) => read(e.target.files?.[0])}
            />
          </label>
        ) : (
          <>
            <p className="field-help">
              {lines.length} found
              {currency !== 'USD' && currency !== 'UNKNOWN'
                ? `, priced in ${currency} and converted to dollars at Kova’s reference rate`
                : ''}
              . Untick anything that isn’t for sale.
            </p>
            <ul className="menu-lines">
              {lines.map((l, i) => (
                <li key={`${l.name}-${i}`} data-off={l.keep ? undefined : 'true'}>
                  <input
                    type="checkbox"
                    checked={l.keep}
                    onChange={(e) => update(i, { keep: e.target.checked })}
                    aria-label={`Add ${l.name}`}
                  />
                  <input
                    className="menu-name"
                    value={l.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                    aria-label="Name"
                  />
                  <span className="money-input money-input-sm">
                    <span>$</span>
                    <input
                      value={l.price}
                      onChange={(e) => update(i, { price: e.target.value })}
                      inputMode="decimal"
                      aria-label={`Price of ${l.name}`}
                    />
                  </span>
                  {originalText(l.original) ? (
                    <span className="menu-orig">{originalText(l.original)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
            <Pill
              icon="plus"
              onClick={add}
              disabled={stage === 'saving' || chosen.length === 0}
              wide
            >
              {stage === 'saving'
                ? 'Adding'
                : `Add ${chosen.length} ${chosen.length === 1 ? 'item' : 'items'}`}
            </Pill>
          </>
        )}
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </div>
  )
}
