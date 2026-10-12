import { failure, kovaPublic } from '@/lib/api'

/**
 * Every private payment on Kova, a page at a time, with no one named: shops' private sales and
 * people's private sends, in one feed. An accountant's view looks through it for its shop's, and a
 * wallet for its own. Nothing about the looker comes here; their key stays in the browser.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const asked = Number(params.get('limit') ?? 1000)
  const limit = Number.isInteger(asked) ? Math.min(Math.max(asked, 1), 1000) : 1000
  const query = new URLSearchParams({ limit: String(limit) })
  const after = params.get('after')
  if (after) query.set('after', after)
  try {
    return Response.json(await kovaPublic(`/v1/public/stealth/announcements?${query}`))
  } catch (error) {
    return failure(error)
  }
}
