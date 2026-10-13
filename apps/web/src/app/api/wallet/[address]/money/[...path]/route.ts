import { failure, kovaPublic } from '@/lib/api'

/**
 * Money in, the dollar card and savings, passed through to Kova's API. Only these paths, so the
 * route can't be used to reach anything else; every change is signed by the wallet itself.
 */
const PATHS = new Set([
  'access-requests',
  'us-account',
  'us-account/view',
  'dollar-card',
  'dollar-card/settings',
  'dollar-card/reveal',
  'savings',
  'savings/in',
  'savings/out',
])

type Context = { params: Promise<{ address: string; path: string[] }> }

async function target(context: Context): Promise<string | null> {
  const { address, path } = await context.params
  const joined = path.join('/')
  if (!PATHS.has(joined) || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null
  return `/v1/wallets/${address}/${joined}`
}

export async function GET(_request: Request, context: Context) {
  const path = await target(context)
  if (!path) return Response.json({ error: 'Not found' }, { status: 404 })
  try {
    return Response.json(await kovaPublic(path))
  } catch (error) {
    return failure(error)
  }
}

export async function POST(request: Request, context: Context) {
  const path = await target(context)
  if (!path) return Response.json({ error: 'Not found' }, { status: 404 })
  try {
    return Response.json(await kovaPublic(path, { method: 'POST', body: JSON.stringify(await request.json()) }))
  } catch (error) {
    return failure(error)
  }
}
