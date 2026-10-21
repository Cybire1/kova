import { failure, kovaPublic } from '@/lib/api'

type Context = { params: Promise<{ address: string }> }

/** The stocks this wallet asked to be told it can buy. */
export async function GET(_request: Request, context: Context) {
  const { address } = await context.params
  try {
    return Response.json(
      await kovaPublic(`/v1/wallets/${encodeURIComponent(address)}/stock-alerts`),
    )
  } catch (error) {
    return failure(error)
  }
}

/** Tell this wallet the day it can buy a stock: { symbol }. */
export async function POST(request: Request, context: Context) {
  const { address } = await context.params
  try {
    return Response.json(
      await kovaPublic(`/v1/wallets/${encodeURIComponent(address)}/stock-alerts`, {
        method: 'POST',
        body: JSON.stringify(await request.json().catch(() => ({}))),
      }),
    )
  } catch (error) {
    return failure(error)
  }
}
