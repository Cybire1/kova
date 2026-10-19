import { failure, kovaPublic, type StampCard } from '@/lib/api'

/** A wallet's stamp card at a stall. Public: the stall's slug and the wallet's address are all it needs. */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params
  const payer = new URL(request.url).searchParams.get('payer') ?? ''
  try {
    return Response.json(
      await kovaPublic<StampCard>(
        `/v1/public/stalls/${encodeURIComponent(slug)}/stamps?payer=${encodeURIComponent(payer)}`,
      ),
    )
  } catch (error) {
    return failure(error)
  }
}
