import { failure, kovaForRoute } from '@/lib/api'

/** The business at a glance: this month's payroll and suppliers. */
export async function GET() {
  try {
    return Response.json(await kovaForRoute('/v1/business'))
  } catch (error) {
    return failure(error)
  }
}
