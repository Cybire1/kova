'use server'

import { ApiError, kovaPublic } from '@/lib/api'
import { cleanRef } from '@/lib/growth'

/**
 * One step of the way in from a source, for Kova's public numbers: the visit, or a new wallet.
 * Counts only; the API keeps no address, and limits each visitor (passed on with the proxy
 * secret) to a few an hour. True when there's nothing left to send: counted, or refused for good.
 */
export async function countTryStep(ref: string, step: 'visit' | 'wallet'): Promise<boolean> {
  const source = cleanRef(ref)
  if (!source || (step !== 'visit' && step !== 'wallet')) return true
  try {
    await kovaPublic('/v1/public/visits', {
      method: 'POST',
      body: JSON.stringify({ ref: source, step }),
    })
    return true
  } catch (error) {
    return error instanceof ApiError && (error.status === 400 || error.status === 429)
  }
}
