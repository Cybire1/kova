import { failure, kovaForRoute, type SplitsToSign } from '@/lib/api'

/** What the shop's wallet signs to set these shares: { shares } → the Rules on KovaSplits. */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { shares?: unknown }
    return Response.json(
      await kovaForRoute<SplitsToSign>('/v1/splits/prepare', {
        method: 'POST',
        body: JSON.stringify({ shares: Array.isArray(body.shares) ? body.shares : [] }),
      }),
    )
  } catch (error) {
    return failure(error)
  }
}
