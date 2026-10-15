import { ApiError, kovaPublic } from '@/lib/api'

/**
 * Naira in and out (the API's routes/naira.ts), passed through from the browser: rates, banks,
 * account names, quotes, cash-outs and naira top-ups. Only these paths go through, and Kova's own
 * checks do the rest: a cash-out is paid only by the wallet's signed transfer.
 */
const ADDRESS = '0x[0-9a-fA-F]{40}'
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const REFERENCE = 'kova_[0-9a-f]{32}'

const allowed: Record<'GET' | 'POST', RegExp[]> = {
  GET: [
    /^naira$/,
    /^naira\/banks$/,
    /^naira\/quote$/,
    new RegExp(`^cash-outs/${UUID}$`),
    new RegExp(`^wallets/${ADDRESS}/cash-outs$`),
    new RegExp(`^naira-top-ups/${REFERENCE}$`),
    new RegExp(`^wallets/${ADDRESS}/naira-top-ups$`),
  ],
  POST: [
    /^naira\/account$/,
    new RegExp(`^wallets/${ADDRESS}/cash-outs$`),
    new RegExp(`^cash-outs/${UUID}/pay$`),
    new RegExp(`^wallets/${ADDRESS}/naira-top-ups$`),
    new RegExp(`^naira-top-ups/${REFERENCE}/verify$`),
  ],
}

async function pass(request: Request, method: 'GET' | 'POST', segments: string[]) {
  const path = segments.join('/')
  if (!allowed[method].some((rule) => rule.test(path)))
    return Response.json({ error: 'No such naira endpoint.' }, { status: 404 })
  const query = new URL(request.url).search
  try {
    const body =
      method === 'POST' ? JSON.stringify(await request.json().catch(() => ({}))) : undefined
    return Response.json(
      await kovaPublic(`/v1/${path}${query}`, { method, ...(body ? { body } : {}) }),
    )
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
