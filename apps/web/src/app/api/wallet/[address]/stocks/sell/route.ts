import { failure, kovaPublic } from '@/lib/api'

/** Sells exactly the quoted shares with the wallet’s signed order and permit. */
export async function POST(request: Request, context: { params: Promise<{ address: string }> }) {
  const { address } = await context.params
  try {
    return Response.json(
      await kovaPublic(`/v1/wallets/${encodeURIComponent(address)}/stocks/sell`, {
        method: 'POST',
        body: JSON.stringify(await request.json().catch(() => ({}))),
      }),
    )
  } catch (error) {
    return failure(error)
  }
}
