import { failure, kovaPublic } from '@/lib/api'

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  const target = `/${path.join('/')}`
  const info = target === '/v1/ussd/info' && request.method === 'GET'
  const pocket =
    /^\/v1\/wallets\/0x[\da-fA-F]{40}\/ussd-pocket(?:\/(?:verify|withdraw|payout))?$/.test(target)
  if (!info && !pocket) return Response.json({ error: 'Not found' }, { status: 404 })
  try {
    const body = request.method === 'GET' ? undefined : JSON.stringify(await request.json())
    return Response.json(await kovaPublic(target, { method: request.method, body }))
  } catch (error) {
    return failure(error)
  }
}
export const GET = proxy
export const PUT = proxy
export const PATCH = proxy
export const POST = proxy
export const DELETE = proxy
