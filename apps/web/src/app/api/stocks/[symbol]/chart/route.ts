import { failure, kovaPublic } from '@/lib/api'

type Context = { params: Promise<{ symbol: string }> }

/** A stock's price history for ?range= (1D, 1W, 1M or 1Y). No points means none to show. */
export async function GET(request: Request, context: Context) {
  const { symbol } = await context.params
  const range = new URL(request.url).searchParams.get('range') ?? '1W'
  try {
    return Response.json(
      await kovaPublic(
        `/v1/stocks/${encodeURIComponent(symbol)}/chart?range=${encodeURIComponent(range)}`,
      ),
    )
  } catch (error) {
    return failure(error)
  }
}
