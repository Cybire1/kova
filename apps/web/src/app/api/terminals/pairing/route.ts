import { failure, kovaForRoute, type TerminalPairing } from '@/lib/api'

/** A fresh one-time code for pairing a phone. The shop's key stays on this server. */
export async function POST() {
  try {
    return Response.json(
      await kovaForRoute<TerminalPairing>('/v1/terminals/pairings', { method: 'POST' }),
      { status: 201 },
    )
  } catch (error) {
    return failure(error)
  }
}
