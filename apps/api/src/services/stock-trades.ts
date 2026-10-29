import { schema, uuidv7 } from '@kova/db'
import {
  buyNonce,
  explorerTxUrl,
  kovaStocksAbi,
  receiveAuthorizationTypedData,
  STOCK_BUY_MAX,
  STOCK_BUY_MIN,
  STOCK_QUOTE_SECONDS,
  type StockSellOrder,
  stockAttestation,
  stockCountryBlock,
  stockMinOut,
  stockPermitAbi,
  stockSellTypedData,
} from '@kova/monad'
import { and, desc, eq } from 'drizzle-orm'
import geoip from 'geoip-country'
import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  type Hex,
  isAddressEqual,
  pad,
  parseEventLogs,
  parseSignature,
  recoverMessageAddress,
  serializeSignature,
  type TransactionReceipt,
  verifyTypedData,
} from 'viem'
import { network, publicClient, settlementToken } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { KovaError } from '../errors.js'
import { OverFeeCap, RefusedEstimate, sendFromRelayer } from '../relay.js'
import { canonicalIp } from './moonpay.js'
import { findStock, stockQuote } from './stocks.js'
import { buildSwap, routeSources, type SwapRoute, swapRoute } from './swap.js'

/**
 * Buying and selling xStocks through KovaStocks (docs/stocks-trading.md).
 *
 * A wallet may trade only from a country where xStocks are offered (by its IP, read from an
 * offline IP-to-country table; a country Kova can't tell is blocked), and only once it has signed
 * the self-certification for that country. A quote is kept here with its reference, for 60
 * seconds; the wallet's signature commits to the stock and the least it gets (min_out, 99% of
 * the quote), and the trade carried out is exactly the one quoted, or nothing moves.
 *
 * Buying: the wallet signs an EIP-3009 receiveWithAuthorization of its dollars to KovaStocks, the
 * nonce buyNonce(stock, minOut, ref). Selling: an EIP-712 Sell order on the KovaStocks domain and
 * an EIP-2612 permit on the stock. Either way Kova's relayer sends one call with a fresh KyberSwap
 * route, and KovaStocks checks what arrives and sends it all to the wallet.
 */

export const STOCK_MAX_GAS = 5_000_000n
/** The router's own floor under a fresh route; KovaStocks checks min_out itself. */
const SWAP_SLIPPAGE_BPS = 100
const DAY_MS = 86_400_000

type TradeRow = typeof schema.stockTrades.$inferSelect
type Side = 'buy' | 'sell'

/** Trading is on: switched on, with a contract, on Monad mainnet where the stocks are. */
export const tradingLive = (): boolean =>
  config.KOVA_STOCKS_TRADING === '1' &&
  Boolean(config.KOVA_STOCKS_CONTRACT) &&
  config.KOVA_NETWORK === 'mainnet'

export const TRADING_OFF = 'Buying and selling stocks isn’t open yet.'

function contract(): Address {
  if (!tradingLive() || !config.KOVA_STOCKS_CONTRACT)
    throw new KovaError('conflict', TRADING_OFF, { live: false })
  return getAddress(config.KOVA_STOCKS_CONTRACT)
}

/** The visitor's country (ISO code) from its IP, or null when Kova can't tell. */
export function countryOf(ip: string): string | null {
  const canonical = canonicalIp(ip)
  if (!canonical) return null
  return geoip.lookup(canonical)?.country ?? null
}

async function latestAttestation(wallet: Address) {
  const [row] = await db
    .select({ country: schema.stockAttestations.country })
    .from(schema.stockAttestations)
    .where(eq(schema.stockAttestations.wallet, getAddress(wallet)))
    .orderBy(desc(schema.stockAttestations.createdAt))
    .limit(1)
  return row
}

/** GET /wallets/:address/stocks/access */
export async function stockAccess(wallet: Address, ip: string) {
  const attestation = stockAttestation(wallet)
  // The country is said even while trading is off, so the location check can be tested live.
  if (!tradingLive())
    return {
      object: 'stock_access' as const,
      live: false,
      country: countryOf(ip),
      allowed: false,
      reason: TRADING_OFF,
      attested: false,
      attestation,
    }
  const country = countryOf(ip)
  const reason = stockCountryBlock(country)
  const latest = await latestAttestation(wallet)
  return {
    object: 'stock_access' as const,
    live: true,
    country,
    allowed: reason === null,
    reason,
    // Signed again when the country changes: the latest statement has to be from this one.
    attested: Boolean(country && latest && latest.country === country),
    attestation,
  }
}

/** Where the wallet is, if it may trade from there. Checked on every write. */
function allowedCountry(ip: string): string {
  const country = countryOf(ip)
  const reason = stockCountryBlock(country)
  if (reason || !country) throw new KovaError('forbidden', reason ?? TRADING_OFF, { country })
  return country
}

/** The country, if the wallet may trade from there and has signed its statement there. */
async function requireAccess(wallet: Address, ip: string): Promise<string> {
  const country = allowedCountry(ip)
  const latest = await latestAttestation(wallet)
  if (!latest || latest.country !== country)
    throw new KovaError(
      'forbidden',
      latest
        ? 'You’re somewhere new: confirm the statement about stock tokens again first.'
        : 'Confirm the statement about stock tokens first.',
      { attest: true, country },
    )
  return country
}

/** POST /wallets/:address/stocks/attest: the exact statement, signed by the wallet, dated within a day. */
export async function attest(wallet: Address, ip: string, message: string, signature: Hex) {
  contract()
  const country = allowedCountry(ip)
  const date = /\nDate: (\d{4}-\d{2}-\d{2})$/.exec(message)?.[1]
  if (!date || message !== stockAttestation(wallet, date))
    throw new KovaError('invalid_request', 'Sign the exact statement Kova shows, for this wallet.')
  const signedDay = Date.parse(`${date}T00:00:00Z`)
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(signedDay) || Math.abs(today - signedDay) > DAY_MS)
    throw new KovaError(
      'invalid_request',
      'That statement is dated too far from today. Sign it again.',
    )
  const signer = await recoverMessageAddress({ message, signature }).catch(() => null)
  if (!signer || !isAddressEqual(signer, wallet))
    throw new KovaError('forbidden', 'Only this wallet can sign its statement.')
  await db.insert(schema.stockAttestations).values({
    id: uuidv7(),
    wallet: getAddress(wallet),
    country,
    message,
    signature,
  })
  return { object: 'stock_attestation' as const, attested: true, country }
}

// --- Quotes ------------------------------------------------------------------------------------

/** A quote's reference on Monad: its id as 32 bytes, in the buy nonce, the Sell order and the events. */
const refOf = (id: string): Hex => pad(`0x${id.replace(/-/g, '')}`, { size: 32 })

/** The last second a signature for this quote may be carried out: its expiry and a minute to send it. */
const deadlineOf = (row: Pick<TradeRow, 'expiresAt'>): bigint =>
  BigInt(Math.floor(row.expiresAt.getTime() / 1000)) + 60n

const unreachable = () =>
  new KovaError('chain_error', 'Stock prices are unreachable right now. Try again in a moment.')

/** Dollars a share, from AUSD (6 decimals) and shares (18). */
function priceOf(dollars: bigint, shares: bigint): number {
  const value = Number(dollars) / 1e6 / (Number(shares) / 1e18)
  return Math.round(value * 10_000) / 10_000
}

/** The stock's EIP-2612 domain and the wallet's permit nonce, for signing the sale's permit. */
async function permitFor(stock: Address, wallet: Address) {
  const [name, nonce, domain] = await Promise.all([
    publicClient.readContract({ address: stock, abi: stockPermitAbi, functionName: 'name' }),
    publicClient.readContract({
      address: stock,
      abi: stockPermitAbi,
      functionName: 'nonces',
      args: [wallet],
    }),
    publicClient
      .readContract({ address: stock, abi: stockPermitAbi, functionName: 'eip712Domain' })
      .catch(() => null),
  ])
  return { name: domain?.[1] ?? name, version: domain?.[2] ?? '1', nonce: nonce.toString() }
}

/** POST /wallets/:address/stocks/quote */
export async function quote(
  wallet: Address,
  ip: string,
  input: { side: Side; symbol: string; amount: bigint },
) {
  const kovaStocks = contract()
  const country = await requireAccess(wallet, ip)
  const listing = await findStock(input.symbol).catch(() => {
    throw unreachable()
  })
  if (!listing) throw new KovaError('not_found', 'Kova doesn’t have that stock.')
  const live = await stockQuote(listing).catch(() => {
    throw unreachable()
  })
  if (live.halted)
    throw new KovaError('conflict', `Trading in ${listing.symbol} is paused right now.`)
  const stock = getAddress(listing.address)
  const dollar = getAddress(settlementToken.address)

  if (input.side === 'buy') {
    if (input.amount < STOCK_BUY_MIN)
      throw new KovaError('invalid_request', 'Buy at least $1 at a time.')
    if (input.amount > STOCK_BUY_MAX)
      throw new KovaError('invalid_request', 'Buy up to $1,000 at a time.')
  } else {
    if (input.amount <= 0n) throw new KovaError('invalid_request', 'Sell more than none.')
    const held = await publicClient
      .readContract({ address: stock, abi: erc20Abi, functionName: 'balanceOf', args: [wallet] })
      .catch(() => {
        throw unreachable()
      })
    if (held < input.amount)
      throw new KovaError('invalid_request', `You don’t have that many ${listing.symbol}.`)
  }

  const [tokenIn, tokenOut] = input.side === 'buy' ? [dollar, stock] : [stock, dollar]
  const route = await swapRoute(tokenIn, tokenOut, input.amount)
  if (route.amountOut <= 0n)
    throw new KovaError('conflict', `There’s no market for ${listing.symbol} right now.`)
  const id = uuidv7()
  const ref = refOf(id)
  const minOut = stockMinOut(route.amountOut)
  const price =
    input.side === 'buy'
      ? priceOf(input.amount, route.amountOut)
      : priceOf(route.amountOut, input.amount)
  const [row] = await db
    .insert(schema.stockTrades)
    .values({
      id,
      network: config.KOVA_NETWORK,
      wallet: getAddress(wallet),
      side: input.side,
      symbol: listing.symbol,
      stock,
      amountIn: input.amount,
      amountOut: route.amountOut,
      minOut,
      price: String(price),
      ref,
      country,
      expiresAt: new Date(Date.now() + STOCK_QUOTE_SECONDS * 1000),
    })
    .returning()
  const quoted = row as TradeRow
  const deadline = deadlineOf(quoted)
  return {
    object: 'stock_quote' as const,
    id,
    side: input.side,
    symbol: listing.symbol,
    stock,
    amount_in: quoted.amountIn.toString(),
    amount_out: quoted.amountOut.toString(),
    min_out: minOut.toString(),
    price,
    expires_at: quoted.expiresAt.toISOString(),
    contract: kovaStocks,
    ref,
    chain_id: network.chainId,
    ...(input.side === 'buy'
      ? {
          // A receiveWithAuthorization of the dollars, to KovaStocks, with this nonce.
          buy: {
            token: dollar,
            to: kovaStocks,
            value: quoted.amountIn.toString(),
            nonce: buyNonce(stock, minOut, ref),
            valid_before: Number(deadline),
          },
        }
      : {
          // A Sell order on the KovaStocks domain, and a permit on the stock for KovaStocks.
          sell: {
            deadline: Number(deadline),
            permit: {
              ...(await permitFor(stock, wallet).catch(() => {
                throw unreachable()
              })),
              spender: kovaStocks,
              value: quoted.amountIn.toString(),
            },
          },
        }),
  }
}

// --- Trades ------------------------------------------------------------------------------------

/** The wallet's own quote on this side, still unused and in date. */
async function openQuote(wallet: Address, id: string, side: Side): Promise<TradeRow> {
  const row = /^[0-9a-f-]{36}$/i.test(id)
    ? await db.query.stockTrades.findFirst({ where: eq(schema.stockTrades.id, id) })
    : undefined
  if (
    !row ||
    row.side !== side ||
    row.network !== config.KOVA_NETWORK ||
    !isAddressEqual(row.wallet as Address, wallet)
  )
    throw new KovaError('not_found', 'There’s no such quote for this wallet.')
  if (row.status !== 'quoted')
    throw new KovaError('conflict', 'This quote has been used. Get a fresh quote.')
  if (row.expiresAt < new Date())
    throw new KovaError('conflict', 'This quote ran out. Get a fresh quote.')
  return row
}

/** Takes the quote for one trade, so two requests can't both carry it out. */
async function claim(row: TradeRow): Promise<void> {
  const [claimed] = await db
    .update(schema.stockTrades)
    .set({ status: 'sending', updatedAt: new Date() })
    .where(and(eq(schema.stockTrades.id, row.id), eq(schema.stockTrades.status, 'quoted')))
    .returning({ id: schema.stockTrades.id })
  if (!claimed) throw new KovaError('conflict', 'This quote has been used. Get a fresh quote.')
}

async function settle(row: TradeRow, set: Partial<TradeRow>): Promise<void> {
  await db
    .update(schema.stockTrades)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(schema.stockTrades.id, row.id))
}

/**
 * Sends the trade with a fresh route that still meets min_out. KyberSwap picks the pool that pays
 * most, not the one cheapest in gas on Monad: a route over the gas cap is tried again without its
 * pools, up to twice, as cash-outs do. A trade refused before sending is marked failed; one whose
 * send is in doubt stays sending, to be read from the chain.
 */
async function relayTrade(
  row: TradeRow,
  kovaStocks: Address,
  call: (swap: Hex) => Hex,
): Promise<TransactionReceipt> {
  const dollar = getAddress(settlementToken.address)
  const stock = getAddress(row.stock)
  const [tokenIn, tokenOut] = row.side === 'buy' ? [dollar, stock] : [stock, dollar]
  const skipped: string[] = []
  let inDoubt = false
  try {
    for (let attempt = 0; ; attempt++) {
      const route: SwapRoute = await swapRoute(tokenIn, tokenOut, row.amountIn, skipped)
      if (route.amountOut < row.minOut)
        throw new KovaError(
          'conflict',
          'The price moved since your quote, so nothing moved. Get a fresh quote.',
        )
      const swap = await buildSwap(route, kovaStocks, SWAP_SLIPPAGE_BPS)
      try {
        inDoubt = true
        const receipt = await sendFromRelayer(kovaStocks, call(swap.data), {
          maxGas: STOCK_MAX_GAS,
        })
        inDoubt = false
        return receipt
      } catch (error) {
        if (error instanceof RefusedEstimate || error instanceof OverFeeCap) inDoubt = false
        // A pool that's too costly, or whose route no longer goes through (KyberSwap prices it a
        // moment ago; a thin pool can move), is left out and the next best tried, up to twice.
        const costly = routeSources(route).filter((source) => !skipped.includes(source))
        if (
          (error instanceof OverFeeCap || error instanceof RefusedEstimate) &&
          attempt < 2 &&
          costly.length > 0
        ) {
          console.warn(
            `[stocks] route ${error instanceof OverFeeCap ? 'over the gas cap' : 'refused'}, trying without`,
            costly.join(','),
          )
          skipped.push(...costly)
          continue
        }
        if (error instanceof RefusedEstimate) {
          const why = error.cause instanceof Error ? error.cause.message : String(error.cause)
          console.warn('[stocks] trade refused before sending', row.id, why.slice(0, 300))
          throw new KovaError(
            'chain_error',
            'The trade didn’t go through, so nothing moved. Try again in a moment.',
          )
        }
        if (error instanceof OverFeeCap)
          throw new KovaError(
            'chain_error',
            'This trade costs too much to carry out right now, so nothing moved. Try again in a few minutes.',
          )
        throw error
      }
    }
  } catch (error) {
    const failure = error instanceof Error ? error.message.slice(0, 300) : String(error)
    if (inDoubt) console.error('[stocks] send in doubt', row.id, failure)
    await settle(row, inDoubt ? { failure } : { status: 'failed', failure })
    throw error
  }
}

const v = (signature: ReturnType<typeof parseSignature>) =>
  Number(signature.v ?? BigInt(signature.yParity + 27))

const txUrl = (hash: Hex) => explorerTxUrl(network, hash)

/** POST /wallets/:address/stocks/buy: the wallet's dollars, for exactly the stock quoted. */
export async function buy(
  wallet: Address,
  ip: string,
  input: {
    quoteId: string
    authorization: { value: bigint; validAfter: bigint; validBefore: bigint; nonce: Hex }
    signature: Hex
  },
) {
  const kovaStocks = contract()
  await requireAccess(wallet, ip)
  const row = await openQuote(wallet, input.quoteId, 'buy')
  const { authorization } = input
  const stock = getAddress(row.stock)
  const now = BigInt(Math.floor(Date.now() / 1000))
  if (authorization.value !== row.amountIn)
    throw new KovaError('invalid_request', 'The amount doesn’t match the quote.')
  if (authorization.nonce.toLowerCase() !== buyNonce(stock, row.minOut, row.ref as Hex))
    throw new KovaError('invalid_request', 'That approval isn’t for this quote.')
  if (authorization.validBefore > deadlineOf(row))
    throw new KovaError('invalid_request', 'The approval can’t outlast the quote.')
  if (authorization.validBefore <= now || authorization.validAfter > now)
    throw new KovaError('invalid_request', 'That approval isn’t valid now. Sign it again.')
  // The signature is over the transfer to KovaStocks itself: another `to` doesn't recover.
  const signed = await verifyTypedData({
    address: wallet,
    ...receiveAuthorizationTypedData(settlementToken, network.chainId, {
      from: wallet,
      to: kovaStocks,
      ...authorization,
    }),
    signature: input.signature,
  }).catch(() => false)
  if (!signed)
    throw new KovaError('forbidden', 'That signature isn’t this wallet’s approval for this quote.')

  const signature = parseSignature(input.signature)
  await claim(row)
  const receipt = await relayTrade(row, kovaStocks, (swap) =>
    encodeFunctionData({
      abi: kovaStocksAbi,
      functionName: 'buy',
      args: [
        {
          owner: wallet,
          value: authorization.value,
          validAfter: authorization.validAfter,
          validBefore: authorization.validBefore,
          v: v(signature),
          r: signature.r,
          s: signature.s,
        },
        stock,
        row.minOut,
        row.ref as Hex,
        swap,
      ],
    }),
  )
  return finish(row, kovaStocks, receipt)
}

/** POST /wallets/:address/stocks/sell: the wallet's shares, for at least the dollars quoted. */
export async function sell(
  wallet: Address,
  ip: string,
  input: { quoteId: string; orderSignature: Hex; permit: { deadline: bigint; signature: Hex } },
) {
  const kovaStocks = contract()
  await requireAccess(wallet, ip)
  const row = await openQuote(wallet, input.quoteId, 'sell')
  const order: StockSellOrder = {
    owner: wallet,
    stock: getAddress(row.stock),
    amount: row.amountIn,
    minOut: row.minOut,
    deadline: deadlineOf(row),
    ref: row.ref as Hex,
  }
  const signed = await verifyTypedData({
    address: wallet,
    ...stockSellTypedData(kovaStocks, network.chainId, order),
    signature: input.orderSignature,
  }).catch(() => false)
  if (!signed)
    throw new KovaError('forbidden', 'That signature isn’t this wallet’s order for this quote.')
  if (input.permit.deadline <= BigInt(Math.floor(Date.now() / 1000)))
    throw new KovaError('invalid_request', 'That permit has run out. Sign it again.')

  const permit = parseSignature(input.permit.signature)
  await claim(row)
  const receipt = await relayTrade(row, kovaStocks, (swap) =>
    encodeFunctionData({
      abi: kovaStocksAbi,
      functionName: 'sell',
      args: [
        order,
        // KovaStocks takes r, s, v with v 27 or 28, whichever form the wallet signed in.
        serializeSignature(parseSignature(input.orderSignature)),
        { deadline: input.permit.deadline, v: v(permit), r: permit.r, s: permit.s },
        swap,
      ],
    }),
  )
  return finish(row, kovaStocks, receipt)
}

/** Records what came out, from KovaStocks' own event. */
async function finish(row: TradeRow, kovaStocks: Address, receipt: TransactionReceipt) {
  const hash = receipt.transactionHash
  if (receipt.status !== 'success') {
    await settle(row, { status: 'failed', txHash: hash, failure: 'reverted' })
    throw new KovaError('chain_error', 'The trade didn’t go through. Nothing moved.', {
      tx_hash: hash,
    })
  }
  const events = parseEventLogs({ abi: kovaStocksAbi, logs: receipt.logs }).filter(
    (log) => isAddressEqual(log.address, kovaStocks) && log.args.ref === row.ref,
  )
  const bought = events.find((log) => log.eventName === 'Bought')
  const sold = events.find((log) => log.eventName === 'Sold')
  const filled =
    bought?.eventName === 'Bought'
      ? bought.args.shares
      : sold?.eventName === 'Sold'
        ? sold.args.dollars
        : null
  // KovaStocks always logs the trade; without its event, say the least it was bound to get.
  if (filled === null) console.warn('[stocks] no trade event in', hash)
  await settle(row, { status: 'done', txHash: hash, filled: filled ?? row.minOut })
  const base = {
    object: 'stock_trade' as const,
    id: row.id,
    side: row.side,
    symbol: row.symbol,
    tx_hash: hash,
    tx_url: txUrl(hash),
  }
  const out = (filled ?? row.minOut).toString()
  return row.side === 'buy' ? { ...base, shares: out } : { ...base, dollars: out }
}
