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
  /** Pools to leave out (KyberSwap's source names), for a route that costs less gas on Monad. */
  exclude: string[] = [],
): Promise<SwapRoute> {
  const skip = exclude.length > 0 ? `&excludedSources=${encodeURIComponent(exclude.join(','))}` : ''
  const data = await kyber<{ routeSummary: { amountOut: string }; routerAddress: string }>(
    `/routes?tokenIn=${tokenIn}&tokenOut=${tokenOut}&amountIn=${amountIn}${skip}`,
  )
  if (!isAddressEqual(getAddress(data.routerAddress), KYBER_ROUTER))
    throw new KovaError('internal', 'The dollar swap moved to a router Kova doesn’t use.')
  return { amountIn, amountOut: BigInt(data.routeSummary.amountOut), summary: data.routeSummary }
}

/** The pools a route swaps through, by KyberSwap's source names. */
export function routeSources(route: SwapRoute): string[] {
  const paths = (route.summary as { route?: Array<Array<{ exchange?: unknown }>> } | null)?.route
  const names = (paths ?? []).flat().map((hop) => hop.exchange)
  return [...new Set(names.filter((n): n is string => typeof n === 'string' && n.length > 0))]
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

const prices = new Map<string, { price: number; at: number }>()
const reading = new Map<string, Promise<number>>()

/**
 * What one `tokenIn` buys in `tokenOut` now, from a $100 route: served from memory and re-read
 * behind the scenes once it's a minute old, so quoting a cash-out waits on no swap. The payment
 * itself builds a real route and the contract checks what arrives.
 */
export async function swapPrice(tokenIn: Address, tokenOut: Address): Promise<number> {
  const key = `${tokenIn}:${tokenOut}`.toLowerCase()
  const known = prices.get(key)
  const age = known ? Date.now() - known.at : Number.POSITIVE_INFINITY
  if (age > 60_000 && !reading.has(key))
    reading.set(
      key,
      swapRoute(tokenIn, tokenOut, 100_000_000n)
        .then((r) => {
          const price = Number(r.amountOut) / 100_000_000
          prices.set(key, { price, at: Date.now() })
          return price
        })
        .finally(() => reading.delete(key)),
    )
  if (known && age < 10 * 60_000) {
    reading.get(key)?.catch(() => {})
    return known.price
  }
  return reading.get(key) as Promise<number>
}

/** KovaCashOut's one entry: a signed AUSD transfer in, a swap, and exactly `pay` USDC out (apps/card/contracts). */
export const cashOutAbi = [
  {
    type: 'function',
    name: 'cashOut',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'auth',
        type: 'tuple',
        components: [
          { name: 'owner', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'v', type: 'uint8' },
          { name: 'r', type: 'bytes32' },
          { name: 's', type: 'bytes32' },
        ],
      },
      {
        name: 'payout',
        type: 'tuple',
        components: [
          { name: 'payTo', type: 'address' },
          { name: 'pay', type: 'uint256' },
          { name: 'ref', type: 'bytes32' },
        ],
      },
      { name: 'swap', type: 'bytes' },
    ],
    outputs: [],
  },
] as const
