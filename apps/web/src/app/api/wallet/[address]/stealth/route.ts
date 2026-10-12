import { failure, kovaPublic } from '@/lib/api'

type Context = { params: Promise<{ address: string }> }

/**
 * A wallet's private-receiving key (`st:eth:0x…`) and the wallet's own signature over it, so a
 * sender can check Kova never swapped it before sending privately.
 */
export async function GET(_request: Request, context: Context) {
  const { address } = await context.params
  try {
    return Response.json(await kovaPublic(`/v1/wallets/${encodeURIComponent(address)}/stealth`))
  } catch (error) {
    return failure(error)
  }
}

/** Publishes this wallet's private-receiving key, signed by the wallet (the API checks it). */
export async function PUT(request: Request, context: Context) {
  const { address } = await context.params
  try {
    return Response.json(
      await kovaPublic(`/v1/wallets/${encodeURIComponent(address)}/stealth`, {
        method: 'PUT',
        body: JSON.stringify(await request.json()),
      }),
    )
  } catch (error) {
    return failure(error)
  }
}
