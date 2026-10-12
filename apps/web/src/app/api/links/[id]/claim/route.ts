import { failure, kovaPublic } from '@/lib/api'

/**
 * Claims a link with a transfer the link's key signed in the browser, of everything at its address
 * to the claimer's wallet (or back to the sender). Only the signature comes here, never the key;
 * Kova's relayer submits it and pays the gas.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  try {
    return Response.json(
      await kovaPublic(`/v1/public/links/${encodeURIComponent(id)}/claim`, {
        method: 'POST',
        body: JSON.stringify(await request.json()),
      }),
    )
  } catch (error) {
    return failure(error)
  }
}
