import { runMigrations } from '@kova/db'
import {
  buyNonce,
  kovaStocksAbi,
  receiveAuthorizationTypedData,
  stockAttestation,
  stockSellTypedData,
} from '@kova/monad'
import { type Address, decodeFunctionData, getAddress, type Hex, isAddressEqual } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Buying and selling xStocks through KovaStocks (services/stock-trades.ts): who may trade (by the
 * IP's country, from the offline table, and a signed statement), what a quote holds, and that the
 * call the relayer sends is exactly the one quoted, or nothing is sent. KyberSwap, xStocks, Monad
 * and the relayer are stood in for; quotes and statements are kept in a real database.
 *
 * Requires a local Postgres (DATABASE_URL); migrations are applied here.
 */

const KOVA_STOCKS = '0x00000000000000000000000000000000057c0c55' as Address
const TSLAX = '0x00000000000000000000000000000000000075a1' as Address
const NIGERIA = '41.58.1.1'
const KENYA = '41.90.64.1'
const US = '8.8.8.8'
const UK = '81.2.69.142'
const GERMANY = '85.214.132.117'
const NOWHERE = '10.0.0.1'

const state = vi.hoisted(() => ({
  /** Dollars a share, as KyberSwap's routes price it. */
  price: 400n,
  halted: false,
  /** Shares each wallet holds, 18 decimals. */
  held: new Map<string, bigint>(),
  /** When set, a swap through this pool is over the gas cap. */
  costlyPool: null as string | null,
  sent: [] as { to: string; data: Hex; maxGas?: bigint }[],
  routes: [] as { amountIn: bigint; exclude: string[] }[],
}))

vi.mock('../src/services/stocks.js', () => {
  const listing = {
    symbol: 'TSLAx',
    name: 'Tesla',
    ticker: 'TSLA',
    exchange: 'NASDAQ',
    logo: '',
    address: '0x00000000000000000000000000000000000075a1',
    period: 'market',
    halted: false,
  }
  return {
    findStock: vi.fn(async (symbol: string) =>
      symbol.toLowerCase() === 'tslax' ? listing : undefined,
    ),
    stockQuote: vi.fn(async () => ({ ...listing, price: 400, halted: state.halted })),
  }
})

/** KyberSwap: a share costs `state.price` dollars either way; the best pool first, left out the next. */
vi.mock('../src/services/swap.js', () => ({
  swapRoute: vi.fn(
    async (tokenIn: string, _out: string, amountIn: bigint, exclude: string[] = []) => {
      state.routes.push({ amountIn, exclude: [...exclude] })
      const buying = tokenIn.toLowerCase() !== '0x00000000000000000000000000000000000075a1'
      const amountOut = buying
        ? (amountIn * 10n ** 12n) / state.price
        : (amountIn * state.price) / 10n ** 12n
      const pool = exclude.includes('uniswap-v4') ? 'kuru' : 'uniswap-v4'
      return { amountIn, amountOut, summary: { pool } }
    },
  ),
  routeSources: (route: { summary: { pool: string } }) => [route.summary.pool],
  buildSwap: vi.fn(
    async (route: { amountIn: bigint; amountOut: bigint; summary: { pool: string } }) => ({
      data: `0x5a7e${route.amountIn.toString(16).padStart(64, '0')}${route.summary.pool === 'kuru' ? 'c0de' : 'ba1a'}`,
      amountOut: route.amountOut,
    }),
  ),
}))

vi.mock('../src/relay.js', async () => {
  const { kovaStocksAbi } = await import('@kova/monad')
  const viem = await import('viem')
  class OverFeeCap extends Error {}
  return {
    RefusedEstimate: class RefusedEstimate extends Error {},
    OverFeeCap,
    relayReady: () => true,
    relayAuthorization: vi.fn(),
    sendFromRelayer: vi.fn(async (to: string, data: Hex, options: { maxGas?: bigint } = {}) => {
      if (state.costlyPool === 'uniswap-v4' && data.includes('ba1a')) throw new OverFeeCap()
      state.sent.push({ to, data, maxGas: options.maxGas })
      // KovaStocks logs what it sent the wallet: here, exactly what was quoted's floor and a bit.
      const call = viem.decodeFunctionData({ abi: kovaStocksAbi, data })
      const log =
        call.functionName === 'buy'
          ? {
              topics: viem.encodeEventTopics({
                abi: kovaStocksAbi,
                eventName: 'Bought',
                args: { owner: call.args[0].owner, stock: call.args[1] },
              }),
              data: viem.encodeAbiParameters(
                [{ type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }],
                [call.args[0].value, call.args[2] + 1n, call.args[3]],
              ),
            }
          : call.functionName === 'sell'
            ? {
                topics: viem.encodeEventTopics({
                  abi: kovaStocksAbi,
                  eventName: 'Sold',
                  args: { owner: call.args[0].owner, stock: call.args[0].stock },
                }),
                data: viem.encodeAbiParameters(
                  [{ type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }],
                  [call.args[0].amount, call.args[0].minOut + 1n, call.args[0].ref],
                ),
              }
            : null
      return {
        status: 'success',
        transactionHash: viem.toHex(crypto.getRandomValues(new Uint8Array(32))),
        logs: log ? [{ address: to, ...log }] : [],
      }
    }),
  }
})

vi.mock('../src/chain.js', async (original) => {
  const real = (await original()) as Record<string, unknown>
  return {
    ...real,
    publicClient: {
      readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
        if (functionName === 'balanceOf')
          return state.held.get(String(args?.[0]).toLowerCase()) ?? 0n
        if (functionName === 'name') return 'Tesla xStock'
        if (functionName === 'nonces') return 0n
        if (functionName === 'eip712Domain') throw new Error('not EIP-5267')
        throw new Error(`unexpected read ${functionName}`)
      },
    },
  }
})

const { app } = await import('../src/index.js')
const { config } = await import('../src/config.js')
const { network, settlementToken } = await import('../src/chain.js')

const saved = {
  network: config.KOVA_NETWORK,
  trading: config.KOVA_STOCKS_TRADING,
  contract: config.KOVA_STOCKS_CONTRACT,
}

beforeAll(async () => {
  await runMigrations(config.DATABASE_URL)
})

beforeEach(() => {
  config.KOVA_NETWORK = 'mainnet'
  config.KOVA_STOCKS_TRADING = '1'
  config.KOVA_STOCKS_CONTRACT = KOVA_STOCKS
  state.price = 400n
  state.halted = false
  state.costlyPool = null
  state.sent.length = 0
  state.routes.length = 0
})

afterEach(() => {
  config.KOVA_NETWORK = saved.network
  config.KOVA_STOCKS_TRADING = saved.trading
  config.KOVA_STOCKS_CONTRACT = saved.contract
})

type Account = ReturnType<typeof privateKeyToAccount>
const newWallet = () => privateKeyToAccount(generatePrivateKey())

async function call(
  path: string,
  options: { ip?: string; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await app.request(`/v1${path}`, {
    method: options.body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': options.ip ?? NIGERIA },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

const message = (body: Record<string, unknown>) =>
  (body.error as { message?: string } | undefined)?.message

async function attested(wallet: Account = newWallet(), ip = NIGERIA) {
  const text = stockAttestation(wallet.address)
  const signature = await wallet.signMessage({ message: text })
  const res = await call(`/wallets/${wallet.address}/stocks/attest`, {
    ip,
    body: { message: text, signature },
  })
  expect(res.status).toBe(200)
  return wallet
}

interface Quote {
  id: string
  stock: Address
  amount_in: string
  amount_out: string
  min_out: string
  ref: Hex
  contract: Address
  expires_at: string
  buy?: { nonce: Hex; valid_before: number }
  sell?: { deadline: number; permit: { name: string; version: string; nonce: string } }
}

async function quoted(wallet: Account, side: 'buy' | 'sell', amount: bigint): Promise<Quote> {
  const res = await call(`/wallets/${wallet.address}/stocks/quote`, {
    body: { side, symbol: 'TSLAx', amount: amount.toString() },
  })
  expect(res.status, message(res.body)).toBe(200)
  return res.body as unknown as Quote
}

async function buyApproval(
  wallet: Account,
  q: Quote,
  change: Partial<{ to: Address; value: bigint; nonce: Hex; validBefore: bigint }> = {},
) {
  const authorization = {
    from: wallet.address,
    to: change.to ?? KOVA_STOCKS,
    value: change.value ?? BigInt(q.amount_in),
    validAfter: 0n,
    validBefore: change.validBefore ?? BigInt(q.buy?.valid_before ?? 0),
    nonce: change.nonce ?? (q.buy?.nonce as Hex),
  }
  const signature = await wallet.signTypedData(
    receiveAuthorizationTypedData(settlementToken, network.chainId, authorization),
  )
  return {
    quote_id: q.id,
    authorization: {
      value: authorization.value.toString(),
      valid_after: '0',
      valid_before: authorization.validBefore.toString(),
      nonce: authorization.nonce,
    },
    signature,
  }
}

async function sellOrder(wallet: Account, q: Quote, change: { minOut?: bigint } = {}) {
  const order = {
    owner: wallet.address,
    stock: getAddress(q.stock),
    amount: BigInt(q.amount_in),
    minOut: change.minOut ?? BigInt(q.min_out),
    deadline: BigInt(q.sell?.deadline ?? 0),
    ref: q.ref,
  }
  const orderSignature = await wallet.signTypedData(
    stockSellTypedData(KOVA_STOCKS, network.chainId, order),
  )
  const deadline = BigInt(q.sell?.deadline ?? 0)
  const permitSignature = await wallet.signTypedData({
    domain: {
      name: 'Tesla xStock',
      version: '1',
      chainId: network.chainId,
      verifyingContract: TSLAX,
    },
    types: {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Permit',
    message: {
      owner: wallet.address,
      spender: KOVA_STOCKS,
      value: order.amount,
      nonce: 0n,
      deadline,
    },
  })
  return {
    quote_id: q.id,
    order_signature: orderSignature,
    permit: { deadline: deadline.toString(), signature: permitSignature },
  }
}

describe('switched off', () => {
  it('answers live: false and sends nothing when KOVA_STOCKS_TRADING isn’t 1', async () => {
    config.KOVA_STOCKS_TRADING = '0'
    const wallet = newWallet()
    const access = await call(`/wallets/${wallet.address}/stocks/access`)
    expect(access.status).toBe(200)
    expect(access.body).toMatchObject({ object: 'stock_access', live: false, allowed: false })
    expect(access.body.attestation).toBe(stockAttestation(wallet.address))
    for (const route of ['attest', 'quote', 'buy', 'sell']) {
      const res = await call(`/wallets/${wallet.address}/stocks/${route}`, { body: {} })
      expect(res.status).toBe(409)
      expect(res.body.live).toBe(false)
    }
    expect(state.sent).toHaveLength(0)
  })

  it('is off without a contract, or off mainnet', async () => {
    const wallet = newWallet()
    config.KOVA_STOCKS_CONTRACT = undefined
    expect((await call(`/wallets/${wallet.address}/stocks/access`)).body.live).toBe(false)
    config.KOVA_STOCKS_CONTRACT = KOVA_STOCKS
    config.KOVA_NETWORK = 'testnet'
    expect((await call(`/wallets/${wallet.address}/stocks/access`)).body.live).toBe(false)
  })
})

describe('who may trade', () => {
  it('lets a wallet in Nigeria in, with the exact statement to sign', async () => {
    const wallet = newWallet()
    const res = await call(`/wallets/${wallet.address}/stocks/access`)
    expect(res.body).toEqual({
      object: 'stock_access',
      live: true,
      country: 'NG',
      allowed: true,
      reason: null,
      attested: false,
      attestation: stockAttestation(wallet.address),
    })
    expect(res.body.attestation).toContain(`Wallet: ${wallet.address}\nDate: `)
  })

  it('refuses the United States, the UK and the EU, saying why plainly', async () => {
    const wallet = newWallet()
    for (const [ip, where] of [
      [US, 'the United States'],
      [UK, 'the United Kingdom'],
      [GERMANY, 'Germany'],
    ] as const) {
      const access = await call(`/wallets/${wallet.address}/stocks/access`, { ip })
      expect(access.body).toMatchObject({
        allowed: false,
        reason: `Stock tokens aren’t available in ${where}.`,
      })
    }
    const text = stockAttestation(wallet.address)
    const attest = await call(`/wallets/${wallet.address}/stocks/attest`, {
      ip: US,
      body: { message: text, signature: await wallet.signMessage({ message: text }) },
    })
    expect(attest.status).toBe(403)
    expect(message(attest.body)).toBe('Stock tokens aren’t available in the United States.')
  })

  it('refuses a wallet that already signed once it’s in a blocked country', async () => {
    const wallet = await attested()
    const res = await call(`/wallets/${wallet.address}/stocks/quote`, {
      ip: US,
      body: { side: 'buy', symbol: 'TSLAx', amount: '10000000' },
    })
    expect(res.status).toBe(403)
    expect(message(res.body)).toBe('Stock tokens aren’t available in the United States.')
  })

  it('refuses a country it can’t tell', async () => {
    const wallet = newWallet()
    const access = await call(`/wallets/${wallet.address}/stocks/access`, { ip: NOWHERE })
    expect(access.body).toMatchObject({ country: null, allowed: false })
    expect(access.body.reason).toMatch(/can’t tell which country/)
    const quote = await call(`/wallets/${wallet.address}/stocks/quote`, {
      ip: NOWHERE,
      body: { side: 'buy', symbol: 'TSLAx', amount: '10000000' },
    })
    expect(quote.status).toBe(403)
  })
})

describe('the statement', () => {
  it('is needed before a quote', async () => {
    const wallet = newWallet()
    const res = await call(`/wallets/${wallet.address}/stocks/quote`, {
      body: { side: 'buy', symbol: 'TSLAx', amount: '10000000' },
    })
    expect(res.status).toBe(403)
    expect(message(res.body)).toBe('Confirm the statement about stock tokens first.')
  })

  it('must be the exact text, signed by the wallet itself, dated within a day', async () => {
    const wallet = newWallet()
    const path = `/wallets/${wallet.address}/stocks/attest`
    const text = stockAttestation(wallet.address)

    const edited = text.replace('not a US citizen', 'a US citizen')
    const wrongText = await call(path, {
      body: { message: edited, signature: await wallet.signMessage({ message: edited }) },
    })
    expect(wrongText.status).toBe(400)

    const someoneElse = await call(path, {
      body: { message: text, signature: await newWallet().signMessage({ message: text }) },
    })
    expect(someoneElse.status).toBe(403)

    const old = stockAttestation(
      wallet.address,
      new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10),
    )
    const stale = await call(path, {
      body: { message: old, signature: await wallet.signMessage({ message: old }) },
    })
    expect(stale.status).toBe(400)
    expect((await call(`/wallets/${wallet.address}/stocks/access`)).body.attested).toBe(false)

    const good = await call(path, {
      body: { message: text, signature: await wallet.signMessage({ message: text }) },
    })
    expect(good.status).toBe(200)
    expect(good.body).toMatchObject({ attested: true, country: 'NG' })
    expect((await call(`/wallets/${wallet.address}/stocks/access`)).body.attested).toBe(true)
  })

  it('is asked for again when the country changes', async () => {
    const wallet = await attested(newWallet(), NIGERIA)
    const access = await call(`/wallets/${wallet.address}/stocks/access`, { ip: KENYA })
    expect(access.body).toMatchObject({ country: 'KE', allowed: true, attested: false })
    const res = await call(`/wallets/${wallet.address}/stocks/quote`, {
      ip: KENYA,
      body: { side: 'buy', symbol: 'TSLAx', amount: '10000000' },
    })
    expect(res.status).toBe(403)
    expect(message(res.body)).toMatch(/somewhere new/)
    await attested(wallet, KENYA)
    expect(
      (await call(`/wallets/${wallet.address}/stocks/access`, { ip: KENYA })).body.attested,
    ).toBe(true)
  })
})

describe('quotes', () => {
  it('holds 60 seconds, at least 99% of the quote, with the nonce the buy signs', async () => {
    const wallet = await attested()
    const before = Date.now()
    const q = await quoted(wallet, 'buy', 10_000_000n)
    expect(BigInt(q.amount_out)).toBe(25_000_000_000_000_000n) // $10 at $400: 0.025 TSLAx
    expect(BigInt(q.min_out)).toBe((25_000_000_000_000_000n * 99n) / 100n)
    expect(q.contract).toBe(getAddress(KOVA_STOCKS))
    const expires = Date.parse(q.expires_at)
    expect(expires - before).toBeGreaterThanOrEqual(59_000)
    expect(expires - before).toBeLessThanOrEqual(61_000)
    expect(q.buy?.nonce).toBe(buyNonce(TSLAX, BigInt(q.min_out), q.ref))
    expect((q as unknown as { price: number }).price).toBe(400)
  })

  it('buys at most $1,000 and at least $1', async () => {
    const wallet = await attested()
    for (const amount of ['1000000001', '999999']) {
      const res = await call(`/wallets/${wallet.address}/stocks/quote`, {
        body: { side: 'buy', symbol: 'TSLAx', amount },
      })
      expect(res.status).toBe(400)
    }
    await quoted(wallet, 'buy', 1_000_000_000n)
  })

  it('quotes only stocks Kova has, and none that are paused', async () => {
    const wallet = await attested()
    const unknown = await call(`/wallets/${wallet.address}/stocks/quote`, {
      body: { side: 'buy', symbol: 'NOPEx', amount: '10000000' },
    })
    expect(unknown.status).toBe(404)
    state.halted = true
    const paused = await call(`/wallets/${wallet.address}/stocks/quote`, {
      body: { side: 'buy', symbol: 'TSLAx', amount: '10000000' },
    })
    expect(paused.status).toBe(409)
    expect(message(paused.body)).toBe('Trading in TSLAx is paused right now.')
  })

  it('sells no more than the wallet holds', async () => {
    const wallet = await attested()
    state.held.set(wallet.address.toLowerCase(), 10n ** 16n)
    const res = await call(`/wallets/${wallet.address}/stocks/quote`, {
      body: { side: 'sell', symbol: 'TSLAx', amount: String(2n * 10n ** 16n) },
    })
    expect(res.status).toBe(400)
  })
})

describe('buying', () => {
  it('relays exactly the quoted call, with a gas cap, and says the shares that arrived', async () => {
    const wallet = await attested()
    const q = await quoted(wallet, 'buy', 10_000_000n)
    const res = await call(`/wallets/${wallet.address}/stocks/buy`, {
      body: await buyApproval(wallet, q),
    })
    expect(res.status, message(res.body)).toBe(200)
    expect(state.sent).toHaveLength(1)
    const [sent] = state.sent
    expect(isAddressEqual(sent?.to as Address, KOVA_STOCKS)).toBe(true)
    expect(sent?.maxGas).toBe(5_000_000n)
    const decoded = decodeFunctionData({ abi: kovaStocksAbi, data: sent?.data as Hex })
    expect(decoded.functionName).toBe('buy')
    const [auth, stock, minOut, ref] = decoded.args as unknown as [
      { owner: Address; value: bigint; validBefore: bigint },
      Address,
      bigint,
      Hex,
    ]
    expect(auth.owner).toBe(wallet.address)
    expect(auth.value).toBe(10_000_000n)
    expect(auth.validBefore).toBe(BigInt(q.buy?.valid_before ?? 0))
    expect(stock).toBe(getAddress(TSLAX))
    expect(minOut).toBe(BigInt(q.min_out))
    expect(ref).toBe(q.ref)
    expect(res.body).toMatchObject({
      object: 'stock_trade',
      side: 'buy',
      shares: String(minOut + 1n),
    })
    expect(res.body.tx_hash).toMatch(/^0x[0-9a-f]{64}$/)

    const again = await call(`/wallets/${wallet.address}/stocks/buy`, {
      body: await buyApproval(wallet, q),
    })
    expect(again.status).toBe(409)
    expect(state.sent).toHaveLength(1)
  })

  it('refuses an approval that doesn’t match the quote, before anything is sent', async () => {
    const wallet = await attested()
    const q = await quoted(wallet, 'buy', 10_000_000n)
    const path = `/wallets/${wallet.address}/stocks/buy`
    const wrong = [
      await buyApproval(wallet, q, { value: 20_000_000n }),
      await buyApproval(wallet, q, { nonce: buyNonce(TSLAX, 1n, q.ref) }),
      await buyApproval(wallet, q, { to: '0x000000000000000000000000000000000000bad1' }),
      await buyApproval(wallet, q, { validBefore: BigInt(q.buy?.valid_before ?? 0) + 3600n }),
      await buyApproval(newWallet(), q),
    ]
    for (const body of wrong) {
      const res = await call(path, { body })
      expect([400, 403]).toContain(res.status)
    }
    // Another wallet's quote isn't this one's to use.
    const other = await attested()
    expect(
      (await call(`/wallets/${other.address}/stocks/buy`, { body: await buyApproval(wallet, q) }))
        .status,
    ).toBe(404)
    expect(state.sent).toHaveLength(0)
    // The quote is still good for the approval that matches it.
    expect((await call(path, { body: await buyApproval(wallet, q) })).status).toBe(200)
  })

  it('sends nothing when the price moved past the 1% since the quote', async () => {
    const wallet = await attested()
    const q = await quoted(wallet, 'buy', 10_000_000n)
    state.price = 410n
    const res = await call(`/wallets/${wallet.address}/stocks/buy`, {
      body: await buyApproval(wallet, q),
    })
    expect(res.status).toBe(409)
    expect(message(res.body)).toMatch(/price moved/)
    expect(state.sent).toHaveLength(0)
  })

  it('tries again without a pool too costly in gas', async () => {
    const wallet = await attested()
    const q = await quoted(wallet, 'buy', 10_000_000n)
    state.costlyPool = 'uniswap-v4'
    state.routes.length = 0
    const res = await call(`/wallets/${wallet.address}/stocks/buy`, {
      body: await buyApproval(wallet, q),
    })
    expect(res.status, message(res.body)).toBe(200)
    expect(state.routes.map((r) => r.exclude)).toEqual([[], ['uniswap-v4']])
    expect(state.sent).toHaveLength(1)
    expect(state.sent[0]?.data).toContain('c0de')
  })
})

describe('selling', () => {
  it('relays exactly the signed order, and says the dollars that arrived', async () => {
    const wallet = await attested()
    const shares = 25_000_000_000_000_000n
    state.held.set(wallet.address.toLowerCase(), shares)
    const q = await quoted(wallet, 'sell', shares)
    expect(BigInt(q.amount_out)).toBe(10_000_000n)
    expect(q.sell?.permit).toMatchObject({ name: 'Tesla xStock', version: '1', nonce: '0' })
    const res = await call(`/wallets/${wallet.address}/stocks/sell`, {
      body: await sellOrder(wallet, q),
    })
    expect(res.status, message(res.body)).toBe(200)
    expect(state.sent).toHaveLength(1)
    const decoded = decodeFunctionData({ abi: kovaStocksAbi, data: state.sent[0]?.data as Hex })
    expect(decoded.functionName).toBe('sell')
    const [order] = decoded.args as unknown as [
      {
        owner: Address
        stock: Address
        amount: bigint
        minOut: bigint
        deadline: bigint
        ref: Hex
      },
    ]
    expect(order).toEqual({
      owner: wallet.address,
      stock: getAddress(TSLAX),
      amount: shares,
      minOut: BigInt(q.min_out),
      deadline: BigInt(q.sell?.deadline ?? 0),
      ref: q.ref,
    })
    expect(res.body).toMatchObject({ side: 'sell', dollars: String(BigInt(q.min_out) + 1n) })
  })

  it('refuses an order that doesn’t match the quote, before anything is sent', async () => {
    const wallet = await attested()
    state.held.set(wallet.address.toLowerCase(), 10n ** 18n)
    const q = await quoted(wallet, 'sell', 10n ** 17n)
    const path = `/wallets/${wallet.address}/stocks/sell`
    const lower = await call(path, { body: await sellOrder(wallet, q, { minOut: 1n }) })
    expect(lower.status).toBe(403)
    const stranger = await call(path, { body: await sellOrder(newWallet(), q) })
    expect(stranger.status).toBe(403)
    expect(state.sent).toHaveLength(0)
  })
})
