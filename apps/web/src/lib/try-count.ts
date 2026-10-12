import { countTryStep } from '@/app/try/actions'
import { cleanRef, REF_KEY, TRY_KEY } from './growth'

/**
 * A wallet just made in this browser after /try counts as a new one for the source /try kept,
 * once, by the same rule as the checklist (components/try-checklist.tsx): only when this browser
 * had no wallet on its first visit. Nothing about the wallet leaves the browser but the count.
 */
export function countNewWallet(address: string) {
  try {
    const ref = cleanRef(JSON.parse(localStorage.getItem(REF_KEY) ?? 'null'))
    const memory = JSON.parse(localStorage.getItem(TRY_KEY) ?? '{}') as { first?: number; had?: boolean; wallet?: string }
    if (!ref || !memory.first || memory.had || memory.wallet) return
    localStorage.setItem(TRY_KEY, JSON.stringify({ ...memory, wallet: address }))
    void countTryStep(ref, 'wallet')
      .then((counted) => {
        if (counted) return
        const now = JSON.parse(localStorage.getItem(TRY_KEY) ?? '{}')
        localStorage.setItem(TRY_KEY, JSON.stringify({ ...now, wallet: undefined }))
      })
      .catch(() => {})
  } catch {
    // Private mode or full storage: nothing is remembered, so nothing is counted.
  }
}
