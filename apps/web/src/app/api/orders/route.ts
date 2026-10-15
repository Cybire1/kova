import { failure, kovaForRoute, type Order } from '@/lib/api'

export async function GET() {
  try {
    return Response.json(
      (await kovaForRoute<{ data: Order[] }>('/v1/orders?limit=30&source=stall')).data,
    )
  } catch (error) {
    return failure(error)
  }
}
