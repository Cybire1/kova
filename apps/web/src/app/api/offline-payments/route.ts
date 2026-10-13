import { parseSignedAuthorization, toSignedAuthorization } from '@kova/monad'
import { ApiError, kovaPublic } from '@/lib/api'

/**
 * Hands in an offline payment: one someone signed on their phone with no signal, which anyone
 * holding its code can settle. Only the signed transfer comes here (never a note or anything
 * else), and it goes to Kova marked offline, so it gets the week and the $100 cap that offline
 * payments have. Kova's relayer settles it on Monad and pays the gas. Kova's error code comes back
 * too, so the page can tell "already paid" (409) and "the sender is short" from a failure.
 */
export async function POST(request: Request) {
  const signed = parseSignedAuthorization(await request.json().catch(() => null))
  if (!signed)
    return Response.json(
      { error: 'That isn’t a signed payment.', code: 'invalid_request' },
      { status: 400 },
    )
  try {
    return Response.json(
      await kovaPublic('/v1/transfers', {
        method: 'POST',
        body: JSON.stringify({
          ...toSignedAuthorization(signed.token, signed.authorization, signed.signature),
          offline: true,
        }),
      }),
    )
  } catch (error) {
    if (error instanceof ApiError)
      return Response.json(
        { error: error.message, code: error.code ?? null, details: error.details ?? null },
        { status: error.status >= 500 ? 502 : error.status },
      )
    return Response.json({ error: 'Kova is unreachable. Nothing moved.' }, { status: 502 })
  }
}
