import { failure, kovaPublic } from '@/lib/api'

/** Buys exactly the quoted stock with the wallet’s signed approval. Kova’s relayer pays the gas. */
export async function POST(request: Request, context: { params: Promise<{ address: string }> }) {
  const { address } = await context.params
  try {
    return Response.json(
      await kovaPublic(`/v1/wallets/${encodeURIComponent(address)}/stocks/buy`, {
        method: 'POST',
        body: JSON.stringify(await request.json().catch(() => ({}))),
      }),
    )
  } catch (error) {
    return failure(error)
  }
}
