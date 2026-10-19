import { type Checkout, failure, kovaPublic } from '@/lib/api'

/**
 * Pays a charge with an authorization a browser wallet signed. Public like the charge itself:
 * Kova checks the signature is for exactly this charge before its relayer submits it.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  try {
    const signed = await request.json()
    return Response.json(
      await kovaPublic<Checkout>(`/v1/checkout/${encodeURIComponent(id)}/authorize`, {
        method: 'POST',
        body: JSON.stringify(signed),
      }),
    )
  } catch (error) {
    return failure(error)
  }
}
