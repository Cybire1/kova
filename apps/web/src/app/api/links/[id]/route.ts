import { failure, kovaPublic } from '@/lib/api'

/** What a link page shows: who sent it, how much, the note, and whether it was claimed. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  try {
    return Response.json(await kovaPublic(`/v1/public/links/${encodeURIComponent(id)}`))
  } catch (error) {
    return failure(error)
  }
}
