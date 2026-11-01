import { ApiError, kovaPublic } from '@/lib/api'

/**
 * "Try Kova on a basic phone" (the API's services/ussd-demo.ts), passed through from the browser:
 * start a demo phone, press keys, read its texts and the till. Only these paths go through, and the
 * visitor's address is vouched for so the API's limits count each visitor, not this server.
 */
const allowed: Record<'GET' | 'POST', RegExp[]> = {
  GET: [/^state$/],
  POST: [/^start$/, /^press$/, /^till$/],
}
const upstream: Record<string, string> = {
  start: '/v1/ussd/demo',
  press: '/v1/ussd/demo/press',
  till: '/v1/ussd/demo/till',
  state: '/v1/ussd/demo/state',
}

async function pass(request: Request, method: 'GET' | 'POST', segments: string[]) {
  const path = segments.join('/')
  if (!allowed[method].some((rule) => rule.test(path)))
    return Response.json({ error: 'No such endpoint.' }, { status: 404 })
  const query = new URL(request.url).search
  try {
    const body =
      method === 'POST' ? JSON.stringify(await request.json().catch(() => ({}))) : undefined
    return Response.json(
      await kovaPublic(`${upstream[path]}${method === 'GET' ? query : ''}`, {
        method,
        ...(body ? { body } : {}),
      }),
    )
  } catch (error) {
    if (error instanceof ApiError)
      return Response.json(
        { error: error.message, code: error.code ?? null },
        { status: error.status >= 500 ? 502 : error.status },
      )
    return Response.json({ error: 'Kova is unreachable. Try again.' }, { status: 502 })
  }
}

export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return pass(request, 'GET', (await ctx.params).path)
}

export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return pass(request, 'POST', (await ctx.params).path)
}
