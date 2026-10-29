import { failure, kovaPublic } from '@/lib/api'

/** A 60-second quote to buy or sell a stock token, for the visitor’s country. */
export async function POST(request: Request, context: { params: Promise<{ address: string }> }) {
  const { address } = await context.params
  try {
    return Response.json(
      await kovaPublic(`/v1/wallets/${encodeURIComponent(address)}/stocks/quote`, {
        method: 'POST',
        body: JSON.stringify(await request.json().catch(() => ({}))),
      }),
    )
  } catch (error) {
    return failure(error)
  }
}
