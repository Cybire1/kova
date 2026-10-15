import { failure, kovaPublic } from '@/lib/api'

/** Test dollars for a browser wallet on testnet, so anyone can try paying a charge. The API rate-limits it. */
export async function POST(request: Request) {
  try {
    const { address } = (await request.json()) as { address?: string }
    return Response.json(
      await kovaPublic('/v1/faucet', { method: 'POST', body: JSON.stringify({ address }) }),
    )
  } catch (error) {
    return failure(error)
  }
}
