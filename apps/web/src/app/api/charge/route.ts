import { failure, kovaForRoute, type PaymentIntent } from '@/lib/api'

/** Starts a charge as the signed-in shop. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    amount?: string
    reference?: string
    idempotency_key?: string
  }
  if (!body.amount) return Response.json({ error: 'amount is required' }, { status: 400 })
  try {
    const intent = await kovaForRoute<PaymentIntent>('/v1/payment_intents', {
      method: 'POST',
      headers: body.idempotency_key ? { 'idempotency-key': body.idempotency_key } : {},
      body: JSON.stringify({
        amount: body.amount,
        ...(body.reference ? { reference: body.reference } : {}),
      }),
    })
    return Response.json(intent, { status: 201 })
  } catch (error) {
    return failure(error)
  }
}
