import { failure, kovaPublic } from '@/lib/api'

/** Whether an offline payment has settled, asked by its sender and nonce: the code never comes here. */
export async function GET(
  request: Request,
  context: { params: Promise<{ from: string; nonce: string }> },
) {
  const { from, nonce } = await context.params
  if (!/^0x[0-9a-fA-F]{40}$/.test(from) || !/^0x[0-9a-fA-F]{64}$/.test(nonce))
    return Response.json({ error: 'Expected a sender address and a nonce.' }, { status: 400 })
  const token = new URL(request.url).searchParams.get('token')
  const query = token && /^0x[0-9a-fA-F]{40}$/.test(token) ? `?token=${token}` : ''
  try {
    return Response.json(await kovaPublic(`/v1/public/offline-payments/${from}/${nonce}${query}`))
  } catch (error) {
    return failure(error)
  }
}
