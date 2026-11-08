import { afterEach, describe, expect, it } from 'vitest'
import { config } from '../src/config.js'
import { duffelKeyFits, money } from '../src/services/duffel.js'

/**
 * Kova Travel's two money rules: a Duffel key only works on its own network, and what Kova
 * charges is the supplier's price plus Kova's margin, rounded up to the cent.
 */

const savedMarkup = config.KOVA_TRAVEL_MARKUP_BPS

afterEach(() => {
  config.KOVA_TRAVEL_MARKUP_BPS = savedMarkup
})

describe('Duffel key and network', () => {
  it('takes only a live key on mainnet', () => {
    expect(duffelKeyFits('duffel_live_abc', 'mainnet')).toBe(true)
    expect(duffelKeyFits('duffel_test_abc', 'mainnet')).toBe(false)
  })

  it('takes only a test key on testnet', () => {
    expect(duffelKeyFits('duffel_test_abc', 'testnet')).toBe(true)
    expect(duffelKeyFits('duffel_live_abc', 'testnet')).toBe(false)
  })

  it('is off with no key or a malformed one', () => {
    expect(duffelKeyFits(undefined, 'mainnet')).toBe(false)
    expect(duffelKeyFits('', 'testnet')).toBe(false)
    expect(duffelKeyFits('live_abc', 'mainnet')).toBe(false)
  })
})

describe('what Kova Travel charges', () => {
  it('sells at cost with no margin set', () => {
    config.KOVA_TRAVEL_MARKUP_BPS = 0
    expect(money('412.30', 'USD')).toEqual({ usd: '412.30', amount: '412.30', currency: 'USD' })
  })

  it('adds the margin and rounds up to the cent', () => {
    config.KOVA_TRAVEL_MARKUP_BPS = 300
    // 412.30 × 1.03 = 424.669 → $424.67, and the supplier is still paid 412.30.
    expect(money('412.30', 'USD')).toEqual({ usd: '424.67', amount: '412.30', currency: 'USD' })
    // 100 × 1.03 is 103.00000000000001 in floating point: still $103.00, never $103.01.
    expect(money('100.00', 'USD')?.usd).toBe('103.00')
  })

  it('refuses a currency Kova has no rate for', () => {
    config.KOVA_TRAVEL_MARKUP_BPS = 300
    expect(money('500', 'XYZ')).toBeNull()
  })
})
