import { failure, kovaForRoute } from '@/lib/api'

/**
 * The business's book, as the signed-in shop: people, payroll runs and each person's pay,
 * suppliers and what they were paid. Every path is checked before it's forwarded.
 */
const SEGMENT = /^[a-z0-9_]{1,64}$/
const ALLOWED = [
  /^people$/,
  /^people\/[a-z0-9_]+$/,
  /^payroll$/,
  /^payroll\/[a-z0-9_]+$/,
  /^payroll\/[a-z0-9_]+\/payments\/[a-z0-9_]+$/,
  /^suppliers$/,
  /^suppliers\/[a-z0-9_]+$/,
  /^suppliers\/[a-z0-9_]+\/payments$/,
  /^supplier_payments$/,
]

type Context = { params: Promise<{ path: string[] }> }

async function forward(request: Request, context: Context, method: 'GET' | 'POST' | 'DELETE') {
  const { path } = await context.params
  const joined = path.join('/')
  if (!path.every((s) => SEGMENT.test(s)) || !ALLOWED.some((r) => r.test(joined)))
    return Response.json({ error: 'Not found' }, { status: 404 })
  const query = new URL(request.url).searchParams
  const supplier = query.get('supplier')
  const search = supplier && SEGMENT.test(supplier) ? `?supplier=${supplier}` : ''
  try {
    return Response.json(
      await kovaForRoute(`/v1/business/${joined}${search}`, {
        method,
        ...(method === 'POST'
          ? { body: JSON.stringify(await request.json().catch(() => ({}))) }
          : {}),
      }),
    )
  } catch (error) {
    return failure(error)
  }
}

export const GET = (request: Request, context: Context) => forward(request, context, 'GET')
export const POST = (request: Request, context: Context) => forward(request, context, 'POST')
export const DELETE = (request: Request, context: Context) => forward(request, context, 'DELETE')
