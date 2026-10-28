import { failure, kovaPublic } from '@/lib/api'

/** A card or bank top-up link for this wallet (MoonPay or Ramp Network), made for this visitor. */
export async function GET(request: Request, context: { params: Promise<{ address: string }> }) {
  const { address } = await context.params
  const query = new URL(request.url).search
  try {
    return Response.json(
      await kovaPublic(`/v1/wallets/${encodeURIComponent(address)}/top-up${query}`),
    )
  } catch (error) {
    return failure(error)
  }
}
