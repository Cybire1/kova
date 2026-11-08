import { ApiError, kovaPublic } from '@/lib/api'

/**
 * Cash-outs through Nuvion (the API's routes/payouts.ts), passed through from the browser: the
 * rails, banks, rates, saved accounts, quotes and payouts. Only these paths go through, and Kova's
 * own checks do the rest: saving an account takes the wallet's signature, and a payout is paid only
 * by the wallet's signed transfer.
 */
const ADDRESS = '0x[0-9a-fA-F]{40}'
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

const allowed: Record<'GET' | 'POST' | 'DELETE', RegExp[]> = {
  GET: [
    /^payouts$/,
    /^payouts\/banks\/[A-Za-z]{2}$/,
    /^payouts\/rates\/[A-Za-z]{3,4}$/,
    new RegExp(`^payouts/${UUID}$`),
    new RegExp(`^wallets/${ADDRESS}/payout-recipients$`),
    new RegExp(`^wallets/${ADDRESS}/payouts$`),
  ],
  POST: [
    new RegExp(`^wallets/${ADDRESS}/payout-recipients$`),
    new RegExp(`^wallets/${ADDRESS}/payouts$`),
    new RegExp(`^payouts/${UUID}/pay$`),
  ],
  DELETE: [new RegExp(`^wallets/${ADDRESS}/payout-recipients/${UUID}$`)],
}

async function pass(request: Request, method: 'GET' | 'POST' | 'DELETE', segments: string[]) {
  const path = segments.join('/')
  if (!allowed[method].some((rule) => rule.test(path)))
    return Response.json({ error: 'No such cash-out endpoint.' }, { status: 404 })
  try {
    const body =
      method === 'GET' ? undefined : JSON.stringify(await request.json().catch(() => ({})))
    return Response.json(await kovaPublic(`/v1/${path}`, { method, ...(body ? { body } : {}) }))
  } catch (error) {
    if (error instanceof ApiError)
      return Response.json(
        {
          error: error.message,
          code: error.code ?? null,
          // The ID check's status, when that's what stopped a cash-out.
          verification: error.details?.verification ?? null,
        },
        { status: error.status >= 500 ? 502 : error.status },
      )
    return Response.json({ error: 'Kova is unreachable. Nothing moved.' }, { status: 502 })
  }
}

type Ctx = { params: Promise<{ path: string[] }> }
export async function GET(request: Request, context: Ctx) {
  return pass(request, 'GET', (await context.params).path)
}
export async function POST(request: Request, context: Ctx) {
  return pass(request, 'POST', (await context.params).path)
}
export async function DELETE(request: Request, context: Ctx) {
  return pass(request, 'DELETE', (await context.params).path)
}
