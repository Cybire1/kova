import { failure, kovaForRoute, type MenuImport } from '@/lib/api'

/** Snap your menu: the photo goes to Kova to be read; the seller reviews what comes back. */
export async function POST(request: Request) {
  try {
    const body = await request.text()
    return Response.json(
      await kovaForRoute<MenuImport>('/v1/catalog/import', { method: 'POST', body }),
    )
  } catch (error) {
    return failure(error)
  }
}
