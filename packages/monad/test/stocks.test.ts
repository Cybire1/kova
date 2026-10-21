import type { PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import {
  ringFill,
  shareLabel,
  shareOfDollars,
  sharesOf,
  stockBalances,
  stockName,
} from '../src/stocks.js'

const TSLA = '0x8aD3c73F833d3F9A523aB01476625F269aEB7Cf0'
const NVDA = '0x0000000000000000000000000000000000000002'
const WALLET = '0x1111111111111111111111111111111111111111'

describe('stocks', () => {
  it('says how much of a share someone owns, as a person would', () => {
    expect(shareLabel(0.05)).toBe('1/20 of a share')
    expect(shareLabel(0.1)).toBe('1/10 of a share')
    expect(shareLabel(0.37)).toBe('0.37 of a share')
    expect(shareLabel(1)).toBe('1 share')
    expect(shareLabel(2.5)).toBe('2.5 shares')
    expect(shareLabel(0)).toBe('No shares')
    expect(shareOfDollars(5, 378.4)).toBe('1/76 of a share')
  })

  it('fills the ring with the part past the last whole share', () => {
    expect(ringFill(0.05)).toBeCloseTo(0.05)
    expect(ringFill(2.25)).toBeCloseTo(0.25)
    expect(ringFill(3)).toBe(1)
    expect(ringFill(0)).toBe(0)
  })

  it('names stocks the way people say them', () => {
    expect(stockName('TSLAx', 'Tesla xStock')).toBe('Tesla')
    expect(stockName('SPYx', 'SP500 xStock')).toBe('S&P 500')
    expect(stockName('AMZNx', 'Amazon.com xStock')).toBe('Amazon')
  })

  it('reads 18-decimal balances as shares', () => {
    expect(sharesOf(50_000_000_000_000_000n)).toBe(0.05)
    expect(sharesOf(2_500_000_000_000_000_000n)).toBe(2.5)
  })

  it('keeps only the stocks a wallet holds, and skips what it cannot read', async () => {
    const multicall = vi.fn(async () => [
      { status: 'success', result: 50_000_000_000_000_000n },
      { status: 'failure', error: new Error('reverted') },
    ])
    const client = { multicall } as unknown as PublicClient
    const found = await stockBalances(WALLET, [{ address: TSLA }, { address: NVDA }], client)
    expect([...found]).toEqual([[TSLA, 50_000_000_000_000_000n]])
  })
})
