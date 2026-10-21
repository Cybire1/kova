import { failure, kovaPublic } from '@/lib/api'

type Context = { params: Promise<{ symbol: string }> }

/** One stock, priced, with where its market is right now. */
export async function GET(_request: Request, context: Context) {
  const { symbol } = await context.params
  try {
    return Response.json(await kovaPublic(`/v1/stocks/${encodeURIComponent(symbol)}`))
  } catch (error) {
    return failure(error)
  }
}
