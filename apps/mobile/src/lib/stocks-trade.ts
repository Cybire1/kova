import {
  buyNonce,
  getNetwork,
  getToken,
  receiveAuthorizationTypedData,
  STOCK_BLOCKED_COUNTRIES,
  stockPermitAbi,
  stockSellTypedData,
  vaultPermitTypedData,
  XSTOCK_DECIMALS,
} from '@kova/monad'
import {
  type Address,
  createPublicClient,
  formatUnits,
  type Hex,
  http,
  parseUnits,
  type TypedDataDefinition,
} from 'viem'
import { monad } from 'viem/chains'
import { apiUrl } from './config'

/**
 * Buying and selling xStocks from the app (docs/stocks-trading.md), straight to Kova's API, which
 * reads this phone's country from its IP. The wallet signs each trade itself: an EIP-3009
 * authorization to buy, a Sell order and a permit to sell. xStocks live on Monad mainnet whatever
 * network the app runs on, so the signatures name mainnet. The web does the same in
 * apps/web/src/lib/wallet/stocks-trade.ts.
 */

export const STOCKS_NETWORK = getNetwork('mainnet')

export interface StockAccess {
  object: 'stock_access'
  live: boolean
  country: string | null
  allowed: boolean
  reason: string | null
  attested: boolean
  /** The exact text to sign, with the wallet and today's date filled in. */
  attestation: string
}

export type TradeSide = 'buy' | 'sell'

export interface TradeQuote {
  object: 'stock_quote'
  id: string
  side: TradeSide
  symbol: string
  stock: Address
  /** Buy: dollars (6 decimals). Sell: shares (18 decimals). Base units, as text. */
  amount_in: string
  amount_out: string
  min_out: string
  price: number | string
  expires_at: string | number
  contract: Address
  ref: Hex
  buy?: { nonce: Hex; valid_before: string }
  sell?: { deadline: string; permit?: { name: string; version?: string; nonce: string } }
}

export interface Traded {
  tx_hash: Hex
  /** Buy: shares received. Sell: dollars received. Base units. */
  received: bigint
}

type SignTyped = (typedData: TypedDataDefinition) => Promise<Hex>

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    `${apiUrl}/v1/wallets/${path}`,
    body === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
  )
  const json = (await response.json().catch(() => ({}))) as { error?: { message?: string } }
  if (!response.ok)
    throw new Error(json.error?.message ?? `Kova is unreachable (${response.status})`)
  return json as T
}

export const getStockAccess = (address: Address) => call<StockAccess>(`${address}/stocks/access`)

/** The one-time confirmation: the wallet signs the exact text it was shown (personal_sign). */
export async function attestStocks(
  address: Address,
  message: string,
  sign: (message: string) => Promise<Hex>,
) {
  const signature = await sign(message)
  return call<{ attested: true }>(`${address}/stocks/attest`, { message, signature })
}

export const quoteStock = (address: Address, side: TradeSide, symbol: string, amount: bigint) =>
  call<TradeQuote>(`${address}/stocks/quote`, { side, symbol, amount: amount.toString() })

/**
 * Buys: the wallet lets KovaStocks receive exactly the quoted dollars, with a nonce worked out here
 * that commits to which stock and the least it gets. A quote whose nonce says otherwise is refused
 * before anything is signed.
 */
export async function buyStock(
  address: Address,
  signTyped: SignTyped,
  quote: TradeQuote,
): Promise<Traded> {
  if (quote.side !== 'buy' || !quote.buy) throw new Error('That price was for selling. Try again.')
  const nonce = buyNonce(quote.stock, BigInt(quote.min_out), quote.ref)
  if (quote.buy.nonce && quote.buy.nonce.toLowerCase() !== nonce.toLowerCase())
    throw new Error('That price didn’t check out, so nothing was signed. Try again.')
  const message = {
    from: address,
    to: quote.contract,
    value: BigInt(quote.amount_in),
    validAfter: 0n,
    validBefore: BigInt(quote.buy.valid_before),
    nonce,
  }
  const signature = await signTyped(
    receiveAuthorizationTypedData(
      getToken(STOCKS_NETWORK.id, 'AUSD'),
      STOCKS_NETWORK.chainId,
      message,
    ) as unknown as TypedDataDefinition,
  )
  const done = await call<{ tx_hash: Hex; shares: string }>(`${address}/stocks/buy`, {
    quote_id: quote.id,
    authorization: {
      value: message.value.toString(),
      valid_after: '0',
      valid_before: message.validBefore.toString(),
      nonce,
    },
    signature,
  })
  return { tx_hash: done.tx_hash, received: BigInt(done.shares) }
}

let mainnet: ReturnType<typeof createPublicClient> | null = null

/** The stock's permit domain and this wallet's nonce: from the quote, else read on Monad. */
async function permitOf(quote: TradeQuote, owner: Address) {
  const given = quote.sell?.permit
  if (given) return { name: given.name, version: given.version ?? '1', nonce: BigInt(given.nonce) }
  // The app's own viem chain object: @kova/monad's copy is the same chain from another install.
  mainnet ??= createPublicClient({ chain: monad, transport: http(STOCKS_NETWORK.rpcUrl) })
  const client = mainnet
  const read = { address: quote.stock, abi: stockPermitAbi } as const
  const [domain, nonce] = await Promise.all([
    client
      .readContract({ ...read, functionName: 'eip712Domain' })
      .then(([, name, version]) => ({ name, version }))
      .catch(async () => ({
        name: await client.readContract({ ...read, functionName: 'name' }),
        version: '1',
      })),
    client.readContract({ ...read, functionName: 'nonces', args: [owner] }),
  ])
  return { ...domain, nonce }
}

/** Sells: an order on KovaStocks and a permit on the stock for exactly those shares. */
export async function sellStock(
  address: Address,
  signTyped: SignTyped,
  quote: TradeQuote,
): Promise<Traded> {
  if (quote.side !== 'sell' || !quote.sell) throw new Error('That price was for buying. Try again.')
  const amount = BigInt(quote.amount_in)
  const deadline = BigInt(quote.sell.deadline)
  const permit = await permitOf(quote, address)
  const orderSignature = await signTyped(
    stockSellTypedData(quote.contract, STOCKS_NETWORK.chainId, {
      owner: address,
      stock: quote.stock,
      amount,
      minOut: BigInt(quote.min_out),
      deadline,
      ref: quote.ref,
    }) as unknown as TypedDataDefinition,
  )
  const permitSignature = await signTyped(
    vaultPermitTypedData(
      { name: permit.name, version: permit.version, verifyingContract: quote.stock },
      STOCKS_NETWORK.chainId,
      { owner: address, spender: quote.contract, value: amount, nonce: permit.nonce, deadline },
    ) as unknown as TypedDataDefinition,
  )
  const done = await call<{ tx_hash: Hex; dollars: string }>(`${address}/stocks/sell`, {
    quote_id: quote.id,
    order_signature: orderSignature,
    permit: { deadline: deadline.toString(), signature: permitSignature },
  })
  return { tx_hash: done.tx_hash, received: BigInt(done.dollars) }
}

// --- Reading it ----------------------------------------------------------------------------

/** When a quote stops holding, in ms: an ISO date, or seconds or ms as a number. */
export function expiresAt(quote: Pick<TradeQuote, 'expires_at'>): number {
  const v = quote.expires_at
  const n = typeof v === 'number' ? v : /^\d+$/.test(v) ? Number(v) : Number.NaN
  if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n
  const parsed = Date.parse(String(v))
  return Number.isFinite(parsed) ? parsed : Date.now() + 60_000
}

/** Shares as people read them: "0.0248", "1.2346", "12.5". */
export function formatShares(units: bigint): string {
  const n = Number(formatUnits(units, XSTOCK_DECIMALS))
  if (n === 0) return '0'
  const text = n >= 1 ? n.toFixed(4) : n.toPrecision(4)
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text
}

export function sharesToUnits(typed: string): bigint {
  try {
    return typed && Number(typed) > 0 ? parseUnits(typed, XSTOCK_DECIMALS) : 0n
  } catch {
    return 0n
  }
}

/** Base units as text for the keypad: up to 6 places, never rounded up past what's owned. */
export function unitsToTyped(units: bigint): string {
  const text = formatUnits(units - (units % 10n ** 12n), XSTOCK_DECIMALS)
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text
}

/** "the United States", "Nigeria". */
export function countryName(code: string | null): string | null {
  if (!code) return null
  const upper = code.toUpperCase()
  if (STOCK_BLOCKED_COUNTRIES[upper]) return STOCK_BLOCKED_COUNTRIES[upper]
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(upper) ?? code
  } catch {
    return code
  }
}

/** The last access read per wallet, so the stock screen opens on Buy and Sell, not a gap. */
export const keptAccess = new Map<string, StockAccess>()
