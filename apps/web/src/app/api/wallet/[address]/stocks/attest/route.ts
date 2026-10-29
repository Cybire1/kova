import { failure, kovaPublic } from '@/lib/api'

/** The wallet’s signed statement about stock tokens, kept with the visitor’s country. */
export async function POST(request: Request, context: { params: Promise<{ address: string }> }) {
  const { address } = await context.params
  try {
    return Response.json(
      await kovaPublic(`/v1/wallets/${encodeURIComponent(address)}/stocks/attest`, {
        method: 'POST',
        body: JSON.stringify(await request.json().catch(() => ({}))),
      }),
    )
  } catch (error) {
    return failure(error)
  }
}
