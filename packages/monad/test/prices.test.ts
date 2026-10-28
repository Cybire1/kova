import { describe, expect, it } from 'vitest'
import { monInDollars, priceFromRound } from '../src/prices.js'

describe('Chainlink prices', () => {
  const now = 1_800_000_000
  it('reads a fresh round at its decimals', () => {
    expect(priceFromRound([1n, 2_128_696n, 0n, BigInt(now - 32), 1n], 8, now)).toBeCloseTo(
      0.02128696,
      8,
    )
  })
  it('trusts no round that is stale or not positive', () => {
    expect(priceFromRound([1n, 2_128_696n, 0n, BigInt(now - 7201), 1n], 8, now)).toBeNull()
    expect(priceFromRound([1n, 0n, 0n, BigInt(now), 1n], 8, now)).toBeNull()
  })
  it('values MON in dollar base units', () => {
    // 49.35 MON at $0.0213 is about $1.05.
    expect(monInDollars(49_350_000_000_000_000_000n, 0.0213)).toBe(1_051_155n)
  })
})
