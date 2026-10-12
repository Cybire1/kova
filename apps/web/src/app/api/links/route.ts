import { failure, kovaPublic } from '@/lib/api'

/**
 * Records a link once the sender's wallet has sent its dollars to the link's address: Kova reads
 * the amount from Monad. The link's key never comes here; only its address does.
 */
export async function POST(request: Request) {
  try {
    return Response.json(
      await kovaPublic('/v1/links', { method: 'POST', body: JSON.stringify(await request.json()) }),
    )
  } catch (error) {
    return failure(error)
  }
}

/** A sender's links, newest first, with whether each was claimed. */
export async function GET(request: Request) {
  const sender = new URL(request.url).searchParams.get('sender') ?? ''
  try {
    return Response.json(await kovaPublic(`/v1/links?sender=${encodeURIComponent(sender)}`))
  } catch (error) {
    return failure(error)
  }
}
