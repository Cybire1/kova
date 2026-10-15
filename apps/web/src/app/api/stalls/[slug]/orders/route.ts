import { failure, kovaPublic } from '@/lib/api'

/** A buyer's order from a stall page. Public: the stall's slug is all it needs. */
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params
  try {
    const order = await kovaPublic(`/v1/public/stalls/${encodeURIComponent(slug)}/orders`, {
      method: 'POST',
      body: await request.text(),
      // The API rate-limits by address; pass the buyer's, not this server's.
      headers: {
        'x-forwarded-for':
          request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown',
      },
    })
    return Response.json(order, { status: 201 })
  } catch (error) {
    return failure(error)
  }
}
