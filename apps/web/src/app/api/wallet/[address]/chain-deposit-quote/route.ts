import { failure, kovaPublic } from '@/lib/api'

export async function POST(request: Request, context: { params: Promise<{ address: string }> }) {
  const { address } = await context.params
  try {
    return Response.json(
      await kovaPublic(`/v1/wallets/${encodeURIComponent(address)}/chain-deposit-quote`, {
        method: 'POST',
        body: JSON.stringify(await request.json()),
      }),
    )
  } catch (error) {
    return failure(error)
  }
}
