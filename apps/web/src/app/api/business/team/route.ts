import { ApiError, failure, kovaForRoute, type Merchant } from '@/lib/api'

/**
 * The people and agents who can spend the business's dollars: the team keys its owner made in
 * Keys, each with its own limit. A server without keys says so, rather than an empty team.
 */
export async function GET() {
  try {
    const shop = await kovaForRoute<Merchant>('/v1/account')
    const owner = shop.owner_address ?? shop.settlement_address
    try {
      const team = await kovaForRoute<{ data: unknown[] }>(`/v1/wallets/${owner}/keys?kind=team`)
      return Response.json({ available: true, data: team.data ?? [] })
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 405))
        return Response.json({ available: false, data: [] })
      throw error
    }
  } catch (error) {
    return failure(error)
  }
}
