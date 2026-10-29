import { failure, kovaPublic } from '@/lib/api'

/**
 * May this wallet buy and sell stock tokens from where the visitor is, and the statement it signs
 * first. The API reads the country from the visitor's IP, which this server vouches for.
 */
export async function GET(_request: Request, context: { params: Promise<{ address: string }> }) {
  const { address } = await context.params
  try {
    return Response.json(
      await kovaPublic(`/v1/wallets/${encodeURIComponent(address)}/stocks/access`),
    )
  } catch (error) {
    return failure(error)
  }
}
