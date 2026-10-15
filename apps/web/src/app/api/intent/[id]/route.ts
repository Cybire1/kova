import { failure, kovaForRoute, type PaymentIntent } from '@/lib/api'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  try {
    return Response.json(
      await kovaForRoute<PaymentIntent>(`/v1/payment_intents/${encodeURIComponent(id)}`),
    )
  } catch (error) {
    return failure(error)
  }
}
