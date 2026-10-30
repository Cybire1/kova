import { ApiError, failure, kovaForRoute, type Merchant, type Splits } from '@/lib/api'
import { getSession } from '@/lib/session'

/**
 * The signed-in shop's splits, for the wallet screen that sets them (components/wallet/splits.tsx):
 * read with the shop's session key here, so the browser never holds it. Saving takes the signature
 * of the wallet the shop is paid into; Kova checks it before anything changes on Monad.
 */
export async function GET() {
  try {
    const [splits, shop, session] = await Promise.all([
      kovaForRoute<Splits>('/v1/splits'),
      kovaForRoute<Merchant>('/v1/account'),
      getSession(),
    ])
    return Response.json({ ...splits, shop_name: shop.name, demo: session?.demo ?? false })
  } catch (error) {
    return failure(error)
  }
}

/** Saves the shares the shop's wallet signed: { shares, deadline, signature }. */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    if (!Array.isArray(body.shares) || typeof body.deadline !== 'string')
      throw new ApiError('Those splits weren’t signed. Try again.', 400)
    return Response.json(
      await kovaForRoute<Splits>('/v1/splits', {
        method: 'POST',
        body: JSON.stringify({
          shares: body.shares,
          deadline: body.deadline,
          signature: body.signature,
        }),
      }),
    )
  } catch (error) {
    return failure(error)
  }
}
