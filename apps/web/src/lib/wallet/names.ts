'use client'

import { nadNameInput, resolveNadName } from '@kova/monad'
import { useEffect, useState } from 'react'
import type { Address } from 'viem'

export type NadLookup =
  | { name: string; typed: boolean; state: 'looking' | 'none' | 'unreachable' }
  | { name: string; typed: boolean; state: 'found'; address: Address }

/**
 * The .nad name in the Send field, looked up on Monad as you type. `typed` when they wrote
 * ".nad" themselves; a plain word is tried as a name too, quietly, beside your people.
 */
export function useNadName(text: string): NadLookup | null {
  const typed = nadNameInput(text)
  const name = typed ?? nadNameInput(text, true)
  const [done, setDone] = useState<{ name: string; address: Address | null; failed?: true } | null>(
    null,
  )
  useEffect(() => {
    if (!name) return
    let live = true
    const wait = setTimeout(() => {
      resolveNadName(name).then(
        (address) => live && setDone({ name, address }),
        () => live && setDone({ name, address: null, failed: true }),
      )
    }, 250)
    return () => {
      live = false
      clearTimeout(wait)
    }
  }, [name])
  if (!name) return null
  const base = { name, typed: Boolean(typed) }
  if (done?.name !== name) return { ...base, state: 'looking' }
  if (done.failed) return { ...base, state: 'unreachable' }
  return done.address
    ? { ...base, state: 'found', address: done.address }
    : { ...base, state: 'none' }
}
