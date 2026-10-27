import { type Address, getAddress, type Hex, isAddressEqual, isHex } from 'viem'
import { KovaError } from '../errors.js'

/**
 * Swaps on Monad through KyberSwap's aggregator, for a cash-out: AUSD to the USDC PAJ pays naira
 * for. A route is read, then built for KovaCashOut as the router's caller and recipient. The
 * contract only calls the one router it was deployed with and checks the USDC that arrives itself,
 * so nothing here is trusted for the amount.
 */

const KYBER = 'https://aggregator-api.kyberswap.com/monad/api/v1'
/** KyberSwap's MetaAggregationRouterV2 on Monad: the router KovaCashOut is deployed with. */
export const KYBER_ROUTER: Address = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5'

const headers = { 'x-client-id': 'kova', 'content-type': 'application/json' }

export interface SwapRoute {
  amountIn: bigint
  amountOut: bigint
  /** KyberSwap's route, handed back as-is to build it. */
  summary: unknown
}

async function kyber<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${KYBER}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new KovaError('internal', 'The dollar swap didn’t answer. Try again in a moment.')
  }
  const body = (await res.json().catch(() => null)) as { code?: number; message?: string; data?: T }
  if (!res.ok || body?.code !== 0 || !body.data) {
    console.error('[swap] kyberswap refused', res.status, body?.code, body?.message)
    throw new KovaError('internal', 'There’s no dollar swap available right now. Try again soon.')
  }
  return body.data
}

/** What `amountIn` of `tokenIn` buys in `tokenOut` right now. */
export async function swapRoute(
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
): Promise<SwapRoute> {
  const data = await kyber<{ routeSummary: { amountOut: string }; routerAddress: string }>(
    `/routes?tokenIn=${tokenIn}&tokenOut=${tokenOut}&amountIn=${amountIn}`,
  )
  if (!isAddressEqual(getAddress(data.routerAddress), KYBER_ROUTER))
    throw new KovaError('internal', 'The dollar swap moved to a router Kova doesn’t use.')
  return { amountIn, amountOut: BigInt(data.routeSummary.amountOut), summary: data.routeSummary }
}

/**
 * The router call for a route, with `account` as its caller and recipient. `slippageBps` bounds
 * the router's own minimum; the contract still checks what arrives against the cash-out.
 */
export async function buildSwap(
  route: SwapRoute,
  account: Address,
  slippageBps: number,
): Promise<{ data: Hex; amountOut: bigint }> {
  const built = await kyber<{ data: string; amountOut: string; routerAddress: string }>(
    '/route/build',
    {
      method: 'POST',
      body: JSON.stringify({
        routeSummary: route.summary,
        sender: account,
        recipient: account,
        slippageTolerance: slippageBps,
        source: 'kova',
      }),
    },
  )
  if (!isAddressEqual(getAddress(built.routerAddress), KYBER_ROUTER) || !isHex(built.data))
    throw new KovaError('internal', 'The dollar swap came back in a shape Kova doesn’t use.')
  return { data: built.data, amountOut: BigInt(built.amountOut) }
}
