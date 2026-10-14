import { ApiError, kovaPublic } from '@/lib/api'

/**
 * Spending keys (allowances, team budgets, AI agents), passed through to Kova's API. Only these
 * paths go through: every write is signed by a wallet or a key, and Kova checks each signature.
 */
const ALLOWED = [
  /^keys\/config$/,
  /^wallets\/0x[0-9a-fA-F]{40}\/(keys|key-invites|agents|approvals|key-payments)$/,
  /^wallets\/0x[0-9a-fA-F]{40}\/keys\/[0-9a-f-]{36}\/(link|activate|freeze|remove)$/,
  /^wallets\/0x[0-9a-fA-F]{40}\/approvals\/[0-9a-f-]{36}$/,
  /^key-invites\/[A-Za-z0-9_-]{8,64}(\/accept)?$/,
  /^keys\/[0-9a-f-]{36}\/payments$/,
  /^key-payments\/[0-9a-f-]{36}\/complete$/,
]

async function pass(request: Request, params: Promise<{ path: string[] }>) {
  const path = (await params).path.join('/')
  if (!ALLOWED.some((re) => re.test(path)))
    return Response.json({ error: 'No such endpoint.' }, { status: 404 })
  const query = new URL(request.url).search
  try {
    return Response.json(
      await kovaPublic(`/v1/${path}${query}`, {
        method: request.method,
        ...(request.method === 'POST'
          ? { body: JSON.stringify(await request.json().catch(() => ({}))) }
          : {}),
      }),
    )
  } catch (error) {
    if (error instanceof ApiError)
      return Response.json(
        { error: error.message, code: error.code ?? null, details: error.details ?? null },
        { status: error.status >= 500 ? 502 : error.status },
      )
    return Response.json({ error: 'Kova is unreachable. Nothing moved.' }, { status: 502 })
  }
}

export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return pass(request, ctx.params)
}

export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return pass(request, ctx.params)
}
