import { ApiError, kovaPublic } from '@/lib/api'

/**
 * Repeat payments (the API's routes/programs.ts), passed through from the browser: a wallet's
 * plans, and starting or stopping one. Only these paths go through, and Kova's own checks do the
 * rest: a plan starts only with the paying wallet's signatures, and only that wallet can stop it.
 */
const ADDRESS = '0x[0-9a-fA-F]{40}'
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

const allowed: Record<'GET' | 'POST', RegExp[]> = {
  GET: [new RegExp(`^wallets/${ADDRESS}/repeats$`)],
  POST: [
    new RegExp(`^wallets/${ADDRESS}/repeats/prepare$`),
    new RegExp(`^wallets/${ADDRESS}/repeats$`),
    new RegExp(`^wallets/${ADDRESS}/repeats/${UUID}/stop/prepare$`),
    new RegExp(`^wallets/${ADDRESS}/repeats/${UUID}/stop$`),
  ],
}

async function pass(request: Request, method: 'GET' | 'POST', segments: string[]) {
  const path = segments.join('/')
  if (!allowed[method].some((rule) => rule.test(path)))
    return Response.json({ error: 'No such repeat payments endpoint.' }, { status: 404 })
  try {
    const body =
      method === 'POST' ? JSON.stringify(await request.json().catch(() => ({}))) : undefined
    return Response.json(await kovaPublic(`/v1/${path}`, { method, ...(body ? { body } : {}) }))
  } catch (error) {
    if (error instanceof ApiError)
      return Response.json(
        { error: error.message, code: error.code ?? null },
        { status: error.status >= 500 ? 502 : error.status },
      )
    return Response.json({ error: 'Kova is unreachable. Nothing moved.' }, { status: 502 })
  }
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return pass(request, 'GET', (await context.params).path)
}

export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return pass(request, 'POST', (await context.params).path)
}
