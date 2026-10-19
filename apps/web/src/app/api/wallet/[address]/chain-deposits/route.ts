import { failure, kovaPublic } from '@/lib/api'

export async function GET(_request: Request, context: { params: Promise<{ address: string }> }) {
  const { address } = await context.params
  try {
    return Response.json(
      await kovaPublic(`/v1/wallets/${encodeURIComponent(address)}/chain-deposits`),
    )
  } catch (error) {
    return failure(error)
  }
}
