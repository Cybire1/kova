import { zeroAddress } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../src/config.js'
import {
  chainDepositActivity,
  chainDepositQuote,
  chainDepositSources,
  clearDepositCatalogue,
} from '../src/services/chain-deposits.js'

const wallet = '0x7171732ec724CF39b8e2ee08C762d04AFab36696'
const other = '0x1111111111111111111111111111111111111111'
const ausd = '0x00000000efe302beaa2b3e6e1b18d08d69a9012a'
const usdc = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const sol = '11111111111111111111111111111111'
const address = '0xd018209a01970c400a3ef32340a0617285c5ed00'
const saved = {
  network: config.KOVA_NETWORK,
  enabled: config.KOVA_CHAIN_DEPOSITS,
  key: config.RELAY_API_KEY,
}
const catalogue = () => ({
  chains: [
    {
      id: 143,
      displayName: 'Monad',
      vmType: 'evm',
      depositEnabled: true,
      depositAddressEnabled: true,
      solverCurrencies: [{ address: zeroAddress, symbol: 'MON', decimals: 18 }],
    },
    {
      id: 8453,
      displayName: 'Base',
      vmType: 'evm',
      depositEnabled: true,
      depositAddressEnabled: true,
      solverCurrencies: [
        { address: usdc, symbol: 'USDC', decimals: 6 },
        { address: other, symbol: 'FAKE', decimals: 6 },
      ],
    },
    {
      id: 792703809,
      displayName: 'Solana',
      vmType: 'svm',
      depositEnabled: true,
      depositAddressEnabled: true,
      solverCurrencies: [{ address: sol, symbol: 'SOL', decimals: 9 }],
    },
  ],
})
const inBalance = {
  currency: { chainId: 8453, address: usdc, symbol: 'USDC', decimals: 6 },
  amount: '25000000',
  minimumAmount: '25000000',
}
const outBalance = {
  currency: { chainId: 143, address: ausd, symbol: 'AUSD', decimals: 6 },
  amount: '24962456',
  minimumAmount: '24837644',
}
const quote = () => ({
  steps: [{ id: 'deposit', requestId: `0x${'1'.repeat(64)}`, depositAddress: address }],
  details: {
    recipient: wallet,
    currencyIn: structuredClone(inBalance),
    currencyOut: structuredClone(outBalance),
    timeEstimate: 1,
  },
  fees: { relayer: { amountUsd: '0.028872' } },
})
const input = () => ({ chain_id: 8453, token: usdc, amount: '25', refund_to: wallet })
function provider(answer: unknown = quote()) {
  const fetch = vi.fn(async (url: string) =>
    Response.json(
      url.endsWith('/chains')
        ? catalogue()
        : url.includes(`recipient=${zeroAddress}`)
          ? { requests: [] }
          : answer,
    ),
  )
  vi.stubGlobal('fetch', fetch)
  return fetch
}

beforeEach(() => {
  config.KOVA_NETWORK = 'mainnet'
  config.KOVA_CHAIN_DEPOSITS = '1'
  config.RELAY_API_KEY = 'test-relay-key'
  clearDepositCatalogue()
})
afterEach(() => {
  config.KOVA_NETWORK = saved.network
  config.KOVA_CHAIN_DEPOSITS = saved.enabled
  config.RELAY_API_KEY = saved.key
  clearDepositCatalogue()
  vi.unstubAllGlobals()
})

describe('deposit availability', () => {
  it('does not advertise deposits when a configured key cannot access tracking', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/chains')
          ? Response.json(catalogue())
          : Response.json({ errorCode: 'UNAUTHORIZED' }, { status: 403 }),
      ),
    )
    await expect(chainDepositSources()).rejects.toMatchObject({ code: 'chain_error' })
  })
  it('keeps deposit addresses unavailable until tracking credentials are configured', async () => {
    const fetch = provider()
    config.RELAY_API_KEY = undefined
    expect(await chainDepositSources()).toMatchObject({ live: false, chains: [] })
    await expect(chainDepositQuote(wallet, input())).rejects.toMatchObject({ code: 'conflict' })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('never requests real addresses on testnet', async () => {
    const fetch = provider()
    config.KOVA_NETWORK = 'testnet'
    expect(await chainDepositSources()).toMatchObject({ live: false, chains: [] })
    await expect(chainDepositQuote(wallet, input())).rejects.toMatchObject({ code: 'conflict' })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('obeys the server pause switch', async () => {
    const fetch = provider()
    config.KOVA_CHAIN_DEPOSITS = '0'
    expect(await chainDepositSources()).toMatchObject({
      live: false,
      reason: 'Deposits are temporarily paused.',
    })
    await expect(chainDepositQuote(wallet, input())).rejects.toMatchObject({ code: 'conflict' })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('offers MON first and only solver-depositable, allowed tokens', async () => {
    const fetch = provider()
    const sources = await chainDepositSources()
    expect(sources.chains[0]).toMatchObject({ id: 143, tokens: [{ symbol: 'MON' }] })
    expect(sources.chains[1]?.tokens.map((t) => t.symbol)).toEqual(['USDC'])
    await chainDepositSources()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('offers every network that takes deposit addresses: the main ones first, then A to Z', async () => {
    const network = (
      id: number,
      displayName: string,
      solverCurrencies: { address: string; symbol: string; decimals: number }[],
    ) => ({
      id,
      displayName,
      vmType: 'evm',
      depositEnabled: true,
      depositAddressEnabled: true,
      solverCurrencies,
    })
    const c = catalogue()
    c.chains.push(
      network(57073, 'Ink', [{ address: zeroAddress, symbol: 'ETH', decimals: 18 }]),
      network(33139, 'ApeChain', [{ address: zeroAddress, symbol: 'APE', decimals: 18 }]),
      network(5042, 'Arc', [
        { address: '0x3600000000000000000000000000000000000000', symbol: 'USDC', decimals: 6 },
        { address: zeroAddress, symbol: 'USDC', decimals: 18 },
      ]),
      {
        ...network(1088, 'Metis', [{ address: other, symbol: 'WETH', decimals: 18 }]),
        depositAddressEnabled: false,
      },
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => Response.json(url.endsWith('/chains') ? c : { requests: [] })),
    )
    const sources = await chainDepositSources()
    expect(sources.chains.map((chain) => chain.name)).toEqual([
      'Monad',
      'Base',
      'Solana',
      'Arc',
      'ApeChain',
      'Ink',
    ])
    // Arc's two USDC entries are one balance: one chip, the network's own coin.
    expect(sources.chains[3]?.tokens).toEqual([
      { address: zeroAddress, symbol: 'USDC', decimals: 18 },
    ])
    expect(sources.chains[4]?.tokens.map((t) => t.symbol)).toEqual(['APE'])
  })
  it('closes every route when Monad is disabled', async () => {
    const c = catalogue()
    if (c.chains[0]) c.chains[0].depositEnabled = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(c)),
    )
    expect(await chainDepositSources()).toMatchObject({ live: false, chains: [] })
  })
})

describe('deposit quotes', () => {
  it('pins AUSD, Monad, recipient, input precision, refunds and slippage server-side', async () => {
    const fetch = provider()
    const made = await chainDepositQuote(wallet, input())
    expect(made).toMatchObject({
      address,
      expected_ausd: '24.962456',
      minimum_ausd: '24.837644',
      route_fee_usd: '0.028872',
      refund_to: wallet,
      pricing: 'estimate',
    })
    const [url, init] = fetch.mock.calls.find(([url]) => url.endsWith('/quote/v2')) as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('https://api.relay.link/quote/v2')
    expect(JSON.parse(init.body as string)).toEqual({
      user: wallet,
      recipient: wallet,
      originChainId: 8453,
      originCurrency: usdc,
      destinationChainId: 143,
      destinationCurrency: ausd,
      amount: '25000000',
      tradeType: 'EXACT_INPUT',
      useDepositAddress: true,
      refundTo: wallet,
      slippageTolerance: '50',
    })
    expect(init.headers).toMatchObject({ 'x-api-key': 'test-relay-key' })
  })
  it('converts MON on Monad through the same flow with exact 18-decimal amounts', async () => {
    const q = quote()
    q.details.currencyIn = {
      currency: { chainId: 143, address: zeroAddress, symbol: 'MON', decimals: 18 },
      amount: '1000000000000000000001',
      minimumAmount: '1000000000000000000001',
    }
    provider(q)
    expect(
      await chainDepositQuote(wallet, {
        ...input(),
        chain_id: 143,
        token: zeroAddress,
        amount: '1000.000000000000000001',
      }),
    ).toMatchObject({ token: { symbol: 'MON' }, amount: '1000.000000000000000001' })
  })
  it.each(['0', '-1', '1e6', '0.0000001', '1.2345678', '9'.repeat(79), '9'.repeat(78)])(
    'rejects invalid or unsafe amount %s',
    async (amount) => {
      const fetch = provider()
      await expect(chainDepositQuote(wallet, { ...input(), amount })).rejects.toMatchObject({
        code: 'invalid_request',
      })
      expect(fetch.mock.calls.every(([url]) => !url.endsWith('/quote/v2'))).toBe(true)
    },
  )
  it('rejects unsupported chains and tokens before asking for an address', async () => {
    const fetch = provider()
    await expect(chainDepositQuote(wallet, { ...input(), chain_id: 999 })).rejects.toMatchObject({
      code: 'invalid_request',
    })
    await expect(chainDepositQuote(wallet, { ...input(), token: other })).rejects.toMatchObject({
      code: 'invalid_request',
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it.each(['', zeroAddress, '11111111111111111111111111111111'])(
    'requires an explicit user-controlled refund wallet (%s)',
    async (refund_to) => {
      provider()
      await expect(chainDepositQuote(wallet, { ...input(), refund_to })).rejects.toMatchObject({
        code: 'invalid_request',
      })
    },
  )
  it.each([
    'recipient',
    'source-chain',
    'source-token',
    'source-amount',
    'destination-chain',
    'destination-token',
    'destination-decimals',
    'minimum',
    'address',
    'request-id',
    'slippage',
  ])('rejects a quote with wrong %s', async (wrong) => {
    const q = quote()
    if (wrong === 'recipient') q.details.recipient = other
    if (wrong === 'source-chain') q.details.currencyIn.currency.chainId = 1
    if (wrong === 'source-token') q.details.currencyIn.currency.address = other
    if (wrong === 'source-amount') q.details.currencyIn.amount = '24000000'
    if (wrong === 'destination-chain') q.details.currencyOut.currency.chainId = 1
    if (wrong === 'destination-token') q.details.currencyOut.currency.address = other
    if (wrong === 'destination-decimals') q.details.currencyOut.currency.decimals = 18
    if (wrong === 'minimum') q.details.currencyOut.minimumAmount = '0'
    if (wrong === 'address' && q.steps[0]) q.steps[0].depositAddress = 'not-an-address'
    if (wrong === 'request-id' && q.steps[0]) q.steps[0].requestId = 'unknown'
    if (wrong === 'slippage') q.details.currencyOut.minimumAmount = '20000000'
    provider(q)
    await expect(chainDepositQuote(wallet, input())).rejects.toMatchObject({ code: 'chain_error' })
  })
  it('returns a clear error for routes below their minimum', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/chains')
          ? Response.json(catalogue())
          : url.includes(`recipient=${zeroAddress}`)
            ? Response.json({ requests: [] })
            : Response.json({ errorCode: 'AMOUNT_TOO_LOW' }, { status: 400 }),
      ),
    )
    await expect(chainDepositQuote(wallet, input())).rejects.toThrow('too small')
  })
})

function request(id: string, status = 'success') {
  return {
    id,
    status,
    recipient: wallet,
    createdAt: '2026-10-18T10:00:00Z',
    depositAddress: { address, depositTxHash: 'source-tx' },
    data: {
      inTxs: [{ txHash: 'source-tx', chainId: 8453 }],
      outTxs: [{ txHash: 'destination-tx', chainId: 143, status: 'success' }],
      route: {
        quoted: { destination: { outputCurrency: structuredClone(outBalance) } },
        actual: {
          destination: { outputCurrency: { ...structuredClone(outBalance), amount: '24900000' } },
        },
      },
    },
  }
}

describe('deposit tracking', () => {
  it('keeps tracking existing funds while new deposits are paused', async () => {
    config.KOVA_CHAIN_DEPOSITS = '0'
    provider({ requests: [] })
    expect(await chainDepositActivity(wallet)).toEqual([])
    expect(await chainDepositSources()).toMatchObject({ live: false, tracking: true })
  })
  it('tracks regenerated requests separately, filters recipient/token, and only reports actual successful AUSD', async () => {
    const failed = request('failed', 'failure')
    const refunded = request('refunded', 'refund')
    const wrongWallet = { ...request('wrong-wallet'), recipient: other }
    const wrongToken = request('wrong-token')
    wrongToken.data.route.quoted.destination.outputCurrency.currency.address = other
    const fetch = provider({
      requests: [
        request('first'),
        request('regenerated'),
        request('pending', 'pending'),
        failed,
        refunded,
        wrongWallet,
        wrongToken,
      ],
    })
    const activity = await chainDepositActivity(wallet)
    expect(activity.map((d) => [d.id, d.status, d.received_ausd])).toEqual([
      ['first', 'success', '24.9'],
      ['regenerated', 'success', '24.9'],
      ['pending', 'pending', null],
      ['failed', 'failure', null],
      ['refunded', 'refund', null],
    ])
    const url = new URL(fetch.mock.calls[0]?.[0] ?? '')
    expect(url.pathname).toBe('/requests/v3')
    expect(url.searchParams.get('recipient')).toBe(wallet)
    expect(url.searchParams.get('currencyOutAddress')).toBe(ausd)
  })
  it('never substitutes an estimate for an actual received amount', async () => {
    const r = request('first')
    ;(r.data.route as { actual?: unknown }).actual = undefined
    provider({ requests: [r] })
    expect((await chainDepositActivity(wallet))[0]?.received_ausd).toBeNull()
  })
  it('fails visibly if the provider cannot track deposits', async () => {
    provider({ unexpected: 'response' })
    await expect(chainDepositActivity(wallet)).rejects.toThrow('tracking')
  })
})
