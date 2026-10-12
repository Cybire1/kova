import { failure, kovaForRoute, type PrivateTakings } from '@/lib/api'

/** The shop's private takings, for the page that keeps them live: whether on, and every sale. */
export async function GET() {
  try {
    return Response.json(await kovaForRoute<PrivateTakings>('/v1/private_takings'))
  } catch (error) {
    return failure(error)
  }
}
