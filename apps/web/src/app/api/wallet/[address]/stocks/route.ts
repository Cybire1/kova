import { failure, kovaPublic } from '@/lib/api'

type Context = { params: Promise<{ address: string }> }

/** The stocks a wallet owns on Monad mainnet, biggest first, with their total. */
export async function GET(_request: Request, context: Context) {
  const { address } = await context.params
  try {
    return Response.json(await kovaPublic(`/v1/wallets/${encodeURIComponent(address)}/stocks`))
  } catch (error) {
    return failure(error)
  }
}
