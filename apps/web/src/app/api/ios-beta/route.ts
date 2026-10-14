import { ApiError, kovaPublic } from '@/lib/api'

/**
 * The iPhone beta's waitlist (the API's routes/ios-beta.ts), from the /iphone page and the cards
 * that lead to it: an email, a name if they gave one, and where they signed up from.
 */
const SOURCES = new Set(['iphone-page', 'home', 'try'])

export async function POST(request: Request) {
  const input = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const body = {
    email: typeof input.email === 'string' ? input.email : '',
    ...(typeof input.name === 'string' && input.name.trim() ? { name: input.name } : {}),
    source:
      typeof input.source === 'string' && SOURCES.has(input.source) ? input.source : 'iphone-page',
  }
  try {
    return Response.json(
      await kovaPublic('/v1/public/ios-beta', { method: 'POST', body: JSON.stringify(body) }),
    )
  } catch (error) {
    if (error instanceof ApiError)
      return Response.json(
        { error: error.message, code: error.code ?? null },
        { status: error.status >= 500 ? 502 : error.status },
      )
    return Response.json(
      { error: 'Kova is unreachable right now. Try again in a minute.' },
      { status: 502 },
    )
  }
}
