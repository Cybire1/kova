import { failure, kovaPublic } from '@/lib/api'

/**
 * Every shop's private sales, a page at a time, with no shop named: what an accountant's view
 * looks through for its own. Nothing about the view comes here; its key stays in the browser.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const query = new URLSearchParams({ limit: '1000' })
  const after = params.get('after')
  if (after) query.set('after', after)
  try {
    return Response.json(await kovaPublic(`/v1/public/stealth/announcements?${query}`))
  } catch (error) {
    return failure(error)
  }
}
