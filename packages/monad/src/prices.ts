import type { Address } from 'viem'
import type { NetworkId } from './networks.js'

/**
 * Prices from Chainlink Data Feeds on Monad, read straight from the chain. Kova's balance counts
 * MON at Chainlink's MON / USD price, so what you hold shows as one total.
 */

/** Chainlink's MON / USD feed on Monad mainnet: 8 decimals, updated at least every hour. */
export const CHAINLINK_MON_USD: Partial<Record<NetworkId, Address>> = {
  mainnet: '0xBcD78f76005B7515837af6b50c7C52BCf73822fb',
}

export const chainlinkFeedAbi = [
  {
    type: 'function',
    name: 'latestRoundData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
] as const

/**
 * The price in a feed's latest round, or null when there's none to trust: not positive, or older
 * than `maxAgeS` (two missed hourly updates).
 */
export function priceFromRound(
  round: readonly [bigint, bigint, bigint, bigint, bigint],
  decimals = 8,
  nowS = Date.now() / 1000,
  maxAgeS = 7200,
): number | null {
  const [, answer, , updatedAt] = round
  if (answer <= 0n || nowS - Number(updatedAt) > maxAgeS) return null
  return Number(answer) / 10 ** decimals
}

/** What `wei` of MON is worth in dollar base units (6 decimals) at `usdPerMon`. */
export function monInDollars(wei: bigint, usdPerMon: number): bigint {
  return BigInt(Math.floor((Number(wei) / 1e18) * usdPerMon * 1e6))
}
