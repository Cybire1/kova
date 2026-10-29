'use client'

import {
  buyNonce,
  getNetwork,
  getToken,
  receiveAuthorizationTypedData,
  stockPermitAbi,
  stockSellTypedData,
  vaultPermitTypedData,
  XSTOCK_DECIMALS,
} from '@kova/monad'
import { useCallback, useEffect, useState } from 'react'
import {
  type Address,
  createPublicClient,
  formatUnits,
  type Hex,
  http,
  type LocalAccount,
  parseUnits,
} from 'viem'

/**
 * Buying and selling xStocks from the web wallet (docs/stocks-trading.md). Every call goes through
 * this site's /api/wallet/:address/stocks/… routes, which vouch for the visitor's country to Kova's
 * API. The wallet signs each trade itself: an EIP-3009 authorization to buy, a Sell order and a
 * permit to sell. xStocks live on Monad mainnet whatever network the wallet runs on, so the
 * signatures name mainnet.
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
  /** Buy: shares. Sell: dollars. */
  amount_out: string
  /** The least it gets: amount_out less 1%. */
  min_out: string
  /** Dollars a share. */
  price: number | string
  expires_at: string | number
  /** KovaStocks, which carries out the trade. */
  contract: Address
  ref: Hex
  buy?: { nonce: Hex; valid_before: string }
  sell?: {
    deadline: string
    /** The stock's EIP-2612 domain and this wallet's nonce, when the API reads them. */
    permit?: { name: string; version?: string; nonce: string }
  }
}

export interface Traded {
  tx_hash: Hex
  /** Buy: shares received. Sell: dollars received. Base units. */
  received: bigint
}

const base = (address: string) => `/api/wallet/${address}/stocks`

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
  })
  const json = (await response.json().catch(() => null)) as (T & { error?: string }) | null
  if (!response.ok || !json) throw new Error(json?.error ?? 'Kova didn’t answer. Try again.')
  return json
}

export const getStockAccess = (address: string) => call<StockAccess>(`${base(address)}/access`)

/** The one-time confirmation: the wallet signs the exact text it was shown (personal_sign). */
export async function attestStocks(
  address: string,
  message: string,
  sign: (message: string) => Promise<Hex>,
) {
  const signature = await sign(message)
  return call<{ attested: true }>(`${base(address)}/attest`, { message, signature })
}

export const quoteStock = (address: string, side: TradeSide, symbol: string, amount: bigint) =>
  call<TradeQuote>(`${base(address)}/quote`, { side, symbol, amount: amount.toString() })

/**
 * Buys: the wallet lets KovaStocks receive exactly the quoted dollars, with a nonce that commits to
 * which stock and the least it gets. The nonce is worked out here, not taken on trust: a quote whose
 * nonce says otherwise is refused before anything is signed.
 */
export async function buyStock(account: LocalAccount, quote: TradeQuote): Promise<Traded> {
  if (quote.side !== 'buy' || !quote.buy) throw new Error('That price was for selling. Try again.')
  const minOut = BigInt(quote.min_out)
  const nonce = buyNonce(quote.stock, minOut, quote.ref)
  if (quote.buy.nonce && quote.buy.nonce.toLowerCase() !== nonce.toLowerCase())
    throw new Error('That price didn’t check out, so nothing was signed. Try again.')
  const message = {
    from: account.address,
    to: quote.contract,
    value: BigInt(quote.amount_in),
    validAfter: 0n,
    validBefore: BigInt(quote.buy.valid_before),
    nonce,
  }
  const signature = await account.signTypedData(
    receiveAuthorizationTypedData(
      getToken(STOCKS_NETWORK.id, 'AUSD'),
      STOCKS_NETWORK.chainId,
      message,
    ),
  )
  const done = await call<{ tx_hash: Hex; shares: string }>(`${base(account.address)}/buy`, {
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

/**
 * The stock's permit domain and this wallet's permit nonce: from the quote when the API sends
 * them, else read on Monad (its EIP-5267 domain where it has one, else name() and version "1").
 */
async function permitOf(quote: TradeQuote, owner: Address) {
  const given = quote.sell?.permit
  if (given) return { name: given.name, version: given.version ?? '1', nonce: BigInt(given.nonce) }
  mainnet ??= createPublicClient({ chain: STOCKS_NETWORK.chain, transport: http() })
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

/**
 * Sells: an order on KovaStocks naming the stock, the shares and the least it pays, and a permit
 * on the stock for exactly those shares. The dollars can only go back to this wallet.
 */
export async function sellStock(account: LocalAccount, quote: TradeQuote): Promise<Traded> {
  if (quote.side !== 'sell' || !quote.sell) throw new Error('That price was for buying. Try again.')
  const amount = BigInt(quote.amount_in)
  const deadline = BigInt(quote.sell.deadline)
  const permit = await permitOf(quote, account.address)
  const orderSignature = await account.signTypedData(
    stockSellTypedData(quote.contract, STOCKS_NETWORK.chainId, {
      owner: account.address,
      stock: quote.stock,
      amount,
      minOut: BigInt(quote.min_out),
      deadline,
      ref: quote.ref,
    }),
  )
  const permitSignature = await account.signTypedData(
    vaultPermitTypedData(
      { name: permit.name, version: permit.version, verifyingContract: quote.stock },
      STOCKS_NETWORK.chainId,
      {
        owner: account.address,
        spender: quote.contract,
        value: amount,
        nonce: permit.nonce,
        deadline,
      },
    ),
  )
  const done = await call<{ tx_hash: Hex; dollars: string }>(`${base(account.address)}/sell`, {
    quote_id: quote.id,
    order_signature: orderSignature,
    permit: { deadline: deadline.toString(), signature: permitSignature },
  })
  return { tx_hash: done.tx_hash, received: BigInt(done.dollars) }
}

// --- Reading it ----------------------------------------------------------------------------

/** When a quote stops holding, in ms since 1970: an ISO date, or seconds or ms as a number. */
export function expiresAt(quote: Pick<TradeQuote, 'expires_at'>): number {
  const v = quote.expires_at
  const n = typeof v === 'number' ? v : /^\d+$/.test(v) ? Number(v) : Number.NaN
  if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n
  const parsed = Date.parse(String(v))
  return Number.isFinite(parsed) ? parsed : Date.now() + 60_000
}

/** Shares as people read them: "0.0248", "1.2346", "12.5". Four significant places below one. */
export function formatShares(units: bigint): string {
  const n = Number(formatUnits(units, XSTOCK_DECIMALS))
  if (n === 0) return '0'
  const text = n >= 1 ? n.toFixed(4) : n.toPrecision(4)
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text
}

/** Typed shares ("0.25") as base units, or 0 for anything that isn't a number. */
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

export function countryName(code: string | null): string | null {
  if (!code) return null
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

const kept = new Map<string, StockAccess>()

/** Whether this wallet can trade stocks here, kept for the visit so the stock page doesn't flicker. */
export function useStockAccess(address: string | undefined) {
  const [access, setAccess] = useState<StockAccess | null>(() =>
    address ? (kept.get(address) ?? null) : null,
  )
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!address) return
    let live = true
    getStockAccess(address)
      .then((a) => {
        kept.set(address, a)
        if (live) setAccess(a)
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [address])
  const update = useCallback(
    (a: StockAccess) => {
      if (address) kept.set(address, a)
      setAccess(a)
    },
    [address],
  )
  return { access, failed, setAccess: update }
}
