import { buyNonce } from '@kova/monad'
import { privateKeyToAccount } from 'viem/accounts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buyStock, formatShares, type TradeQuote } from './stocks-trade'

const account = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const stock = '0x8aD3c73F833d3F9A523aB01476625F269aEB7Cf0' as const
const ref = `0x${'ab'.repeat(32)}` as const

const quote = (nonce: `0x${string}`): TradeQuote => ({
  object: 'stock_quote',
  id: 'sq_1',
  side: 'buy',
  symbol: 'TSLAx',
  stock,
  amount_in: '50000000',
  amount_out: '124100000000000000',
  min_out: '122859000000000000',
  price: 402.71,
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  contract: '0x00000000000000000000000000000000000057c5',
  ref,
  buy: { nonce, valid_before: '1900000000' },
})

afterEach(() => vi.unstubAllGlobals())

describe('Buying a stock token', () => {
  it('signs only a nonce that commits to the quoted stock and the least it gets', async () => {
    const fetch = vi.fn(async () =>
      Response.json({ tx_hash: '0x01', shares: '124000000000000000' }),
    )
    vi.stubGlobal('fetch', fetch)
    await expect(buyStock(account, quote(`0x${'cd'.repeat(32)}`))).rejects.toThrow(
      /didn’t check out/,
    )
    expect(fetch).not.toHaveBeenCalled()

    const nonce = buyNonce(stock, 122_859_000_000_000_000n, ref)
    const done = await buyStock(account, quote(nonce))
    expect(done.received).toBe(124_000_000_000_000_000n)
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.authorization).toEqual({
      value: '50000000',
      valid_after: '0',
      valid_before: '1900000000',
      nonce,
    })
    expect(body.signature).toMatch(/^0x[0-9a-f]{130}$/)
  })

  it('reads shares the way people do', () => {
    expect(formatShares(124_100_000_000_000_000n)).toBe('0.1241')
    expect(formatShares(2_500_000_000_000_000_000n)).toBe('2.5')
  })
})
