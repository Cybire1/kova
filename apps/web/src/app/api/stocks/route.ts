import { failure, kovaPublic } from '@/lib/api'

/** Popular stocks, or up to 20 matching ?q=, priced by xStocks (Kova's API caches them). */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get('q')?.slice(0, 40) ?? ''
  try {
    return Response.json(await kovaPublic(`/v1/stocks${q ? `?q=${encodeURIComponent(q)}` : ''}`))
  } catch (error) {
    return failure(error)
  }
}
