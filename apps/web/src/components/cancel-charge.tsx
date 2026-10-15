'use client'

import { useState, useTransition } from 'react'
import { cancelCharge } from '@/app/actions'

/** Stops an open charge from being paid. Asks once, inline. */
export function CancelCharge({ id }: { id: string }) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  if (!confirming)
    return (
      <button type="button" className="mini" onClick={() => setConfirming(true)}>
        Cancel this charge
      </button>
    )
  return (
    <fieldset className="inline-confirm" aria-label="Cancel this charge">
      <span>{error ?? 'The code stops working. Nothing has been paid.'}</span>
      <button
        type="button"
        className="mini"
        onClick={() => setConfirming(false)}
        disabled={pending}
      >
        Keep it
      </button>
      <button
        type="button"
        className="mini mini-danger"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await cancelCharge(id)
            if (result.error) setError(result.error)
          })
        }
      >
        {pending ? 'Canceling' : 'Cancel charge'}
      </button>
    </fieldset>
  )
}
