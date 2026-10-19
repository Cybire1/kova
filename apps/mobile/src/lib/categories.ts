import { useEffect, useRef, useState } from 'react'
import { categorize, type SpendingCategory } from './api'
import { load, save } from './storage'
import type { Entry } from './wallet'

/**
 * Where the money went. Payments to shops are sorted by Jev from what was bought and where;
 * money sent to people is always "Family and friends". Each answer is kept on the phone, so a
 * payment is only ever asked about once.
 */
export const categoryInfo: Record<SpendingCategory, { label: string; color: string }> = {
  food: { label: 'Eating out', color: '#D46558' },
  groceries: { label: 'Groceries', color: '#46878B' },
  travel: { label: 'Travel', color: '#376B70' },
  transport: { label: 'Getting around', color: '#8FB9BB' },
  shopping: { label: 'Shopping', color: '#EBB3AA' },
  bills: { label: 'Bills and airtime', color: '#566568' },
  health: { label: 'Health', color: '#A94B40' },
  people: { label: 'Family and friends', color: '#E8C35A' },
  other: { label: 'Other', color: '#B9B6AF' },
}

const STORE = 'kova.categories.v1'

const spending = (e: Entry) => e.kind === 'paid' || e.kind === 'sent'

export function useSpendingCategories(activity: Entry[]) {
  const [known, setKnown] = useState<Record<string, SpendingCategory>>({})
  const asking = useRef(false)

  useEffect(() => {
    void load<Record<string, SpendingCategory>>(STORE, {}).then(setKnown)
  }, [])

  useEffect(() => {
    if (asking.current) return
    const unknown = activity.filter((e) => e.kind === 'paid' && !known[e.id]).slice(0, 40)
    if (unknown.length === 0) return
    asking.current = true
    categorize(unknown.map((e) => ({ id: e.id, text: `Paid ${e.name}: ${e.detail}` })))
      .then((r) => {
        if (!r.ready || Object.keys(r.data).length === 0) return
        setKnown((prev) => {
          const next = { ...prev, ...r.data }
          void save(STORE, next)
          return next
        })
      })
      .catch(() => {})
      .finally(() => {
        asking.current = false
      })
  }, [activity, known])

  /** An entry's category, or null while it hasn't been sorted yet. */
  const of = (e: Entry): SpendingCategory | null =>
    e.kind === 'sent' ? 'people' : e.kind === 'paid' ? (known[e.id] ?? null) : null
  return { of, spending }
}
