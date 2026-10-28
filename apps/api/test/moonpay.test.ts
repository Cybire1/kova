import { zeroAddress } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../src/config.js'
import { clearDepositCatalogue } from '../src/services/chain-deposits.js'
import { canonicalIp, clearMoonPayAddresses, moonPayTopUp, sign } from '../src/services/moonpay.js'

const wallet = '0x7171732ec724CF39b8e2ee08C762d04AFab36696'
const usdc = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const ausd = '0x00000000efe302beaa2b3e6e1b18d08d69a9012a'
const deposit = '0xd018209a01970c400a3ef32340a0617285c5ed00'
const saved = {
  network: config.KOVA_NETWORK,
  deposits: config.KOVA_CHAIN_DEPOSITS,
  relay: config.RELAY_API_KEY,
  publishable: config.MOONPAY_PUBLISHABLE_KEY,
  secret: config.MOONPAY_SECRET_KEY,
}

/** Relay as the deposit route sees it: Monad and Base open, and a quote for 50 USDC on Base. */
function relay() {
  const chain = (id: number, displayName: string, symbol: string, address: string) => ({
    id,
    displayName,
    vmType: 'evm',
    depositEnabled: true,
    depositAddressEnabled: true,
    solverCurrencies: [{ address, symbol, decimals: symbol === 'MON' ? 18 : 6 }],
  })
  const quote = {
    steps: [{ id: 'deposit', requestId: `0x${'2'.repeat(64)}`, depositAddress: deposit }],
    details: {
      recipient: wallet,
      currencyIn: {
        currency: { chainId: 8453, address: usdc, symbol: 'USDC', decimals: 6 },
        amount: '50000000',
      },
      currencyOut: {
        currency: { chainId: 143, address: ausd, symbol: 'AUSD', decimals: 6 },
        amount: '49970000',
        minimumAmount: '49800000',
      },
    },
  }
  const fetch = vi.fn(async (url: string) =>
    Response.json(
      url.endsWith('/chains')
        ? { chains: [chain(143, 'Monad', 'MON', zeroAddress), chain(8453, 'Base', 'USDC', usdc)] }
        : url.includes('/requests/')
          ? { requests: [] }
          : quote,
    ),
  )
  vi.stubGlobal('fetch', fetch)
  return fetch
}

beforeEach(() => {
  config.KOVA_NETWORK = 'mainnet'
  config.KOVA_CHAIN_DEPOSITS = '1'
  config.RELAY_API_KEY = 'test-relay-key'
  config.MOONPAY_PUBLISHABLE_KEY = 'pk_live_kova'
  config.MOONPAY_SECRET_KEY = 'sk_live_kova'
  clearDepositCatalogue()
  clearMoonPayAddresses()
})
afterEach(() => {
  config.KOVA_NETWORK = saved.network
  config.KOVA_CHAIN_DEPOSITS = saved.deposits
  config.RELAY_API_KEY = saved.relay
  config.MOONPAY_PUBLISHABLE_KEY = saved.publishable
  config.MOONPAY_SECRET_KEY = saved.secret
  vi.unstubAllGlobals()
})

describe('MoonPay signing', () => {
  it("matches MoonPay's own test vector (the query string, with its ?)", () => {
    expect(
      sign(
        'sk_test_DocsVector00',
        '?apiKey=pk_test_DocsVector00&currencyCode=eth&walletAddress=0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe',
      ),
    ).toBe('oIJxSghyzll/BLhUFdQZhkxf7DAS8REFaWr/ibO+K8Q=')
  })
  it('writes IPs the way MoonPay compares them', () => {
    expect(canonicalIp('203.0.113.42')).toBe('203.0.113.42')
    expect(canonicalIp('::ffff:203.0.113.42')).toBe('203.0.113.42')
    expect(canonicalIp('203.0.113.42:8080')).toBe('203.0.113.42')
    expect(canonicalIp('[2001:DB8:0:0::0001]:443')).toBe('2001:db8::1')
    expect(canonicalIp('local')).toBeNull()
  })
})

describe('MoonPay top-ups', () => {
  it("buys USDC on Base into the wallet's deposit address, signed and tied to the visitor's IP", async () => {
    relay()
    const top = await moonPayTopUp(wallet, 'NGN', {
      returnTo: 'https://mykova.app/wallet',
      clientIp: '::ffff:203.0.113.42',
    })
    expect(top).toMatchObject({ live: true, provider: 'MoonPay', min_usd: 20 })
    const url = new URL(top.url ?? '')
    expect(url.origin).toBe('https://buy.moonpay.com')
    const params = url.searchParams
    expect(params.get('apiKey')).toBe('pk_live_kova')
    expect(params.get('currencyCode')).toBe('usdc_base')
    expect(params.get('walletAddress')).toBe(deposit)
    expect(params.get('baseCurrencyCode')).toBe('ngn')
    expect(params.get('redirectURL')).toBe('https://mykova.app/wallet')
    expect(params.get('allowedIpAddress')).toBe(sign('sk_live_kova', '203.0.113.42'))
    // The signature covers everything before it, exactly as sent.
    const signed = url.search.slice(0, url.search.indexOf('&signature='))
    expect(params.get('signature')).toBe(sign('sk_live_kova', signed))
  })
  it('asks Relay for the address once, and leaves out what MoonPay would refuse', async () => {
    const fetch = relay()
    await moonPayTopUp(wallet, 'USD', { returnTo: 'kova://add-money', clientIp: 'local' })
    const top = await moonPayTopUp(wallet, 'XYZ', { dollars: 5 })
    const quotes = fetch.mock.calls.filter(([url]) => String(url).includes('/quote/'))
    expect(quotes).toHaveLength(1)
    const params = new URL(top.url ?? '').searchParams
    expect(params.get('baseCurrencyCode')).toBe('usd')
    expect(params.get('baseCurrencyAmount')).toBe('20')
    expect(params.has('redirectURL')).toBe(false)
    expect(params.has('allowedIpAddress')).toBe(false)
  })
  it('opens the sandbox with test keys', async () => {
    relay()
    config.MOONPAY_PUBLISHABLE_KEY = 'pk_test_kova'
    config.MOONPAY_SECRET_KEY = 'sk_test_kova'
    const top = await moonPayTopUp(wallet, 'USD')
    expect(new URL(top.url ?? '').origin).toBe('https://buy-sandbox.moonpay.com')
  })
  it('stays closed off mainnet, without keys, or with deposits switched off', async () => {
    const fetch = relay()
    config.KOVA_NETWORK = 'testnet'
    expect(await moonPayTopUp(wallet, 'USD')).toMatchObject({ live: false, url: null })
    config.KOVA_NETWORK = 'mainnet'
    config.KOVA_CHAIN_DEPOSITS = '0'
    expect(await moonPayTopUp(wallet, 'USD')).toMatchObject({ live: false, url: null })
    config.KOVA_CHAIN_DEPOSITS = '1'
    config.MOONPAY_SECRET_KEY = undefined
    expect(await moonPayTopUp(wallet, 'USD')).toMatchObject({ live: false, url: null })
    expect(fetch).not.toHaveBeenCalled()
  })
})
