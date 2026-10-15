import { explorerAddressUrl } from '@kova/monad'
import { type Address, hexToString } from 'viem'
import { network, publicClient } from '../chain.js'
import { config } from '../config.js'
import { PER_USD } from './ai.js'

/**
 * Kova's reference exchange rates.
 *
 * A Chainlink CRE workflow publishes them to KovaRates on Monad: every node of the DON reads
 * two independent sources and cross-checks them, and the DON writes the median (apps/rates).
 * This reads them back, for the apps to show local prices and for Kova Travel to price fares.
 * Nothing is ever converted; rates only label dollar amounts (DECISIONS D-012). If the contract
 * can't be read, the last rates stand, and before any have been read, the published table.
 */
const kovaRatesAbi = [
  {
    type: 'function',
    name: 'allRates',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'codes', type: 'bytes3[]' },
      { name: 'perUsdE8', type: 'uint256[]' },
      { name: 'asOf', type: 'uint64[]' },
    ],
  },
] as const

export interface Rate {
  perUsd: number
  /** When the DON published it. Null for the fixed table. */
  asOf: string | null
}

export interface RateBook {
  source: 'chainlink' | 'table'
  contract: Address | null
  rates: Record<string, Rate>
}

const table = (): Record<string, Rate> =>
  Object.fromEntries(
    Object.entries(PER_USD).map(([code, perUsd]) => [code, { perUsd, asOf: null }]),
  )

let book: RateBook = { source: 'table', contract: null, rates: table() }
let readAt = 0

export async function rateBook(): Promise<RateBook> {
  const address = config.KOVA_RATES_ADDRESS as Address | undefined
  if (!address || Date.now() - readAt < 60_000) return book
  readAt = Date.now()
  try {
    const [codes, values, asOf] = await publicClient.readContract({
      address,
      abi: kovaRatesAbi,
      functionName: 'allRates',
    })
    const rates = { ...book.rates }
    codes.forEach((code, i) => {
      const currency = hexToString(code, { size: 3 })
      const perUsd = Number(values[i]) / 1e8
      if (!(perUsd > 0)) return
      rates[currency] = { perUsd, asOf: new Date(Number(asOf[i]) * 1000).toISOString() }
      // Kova Travel prices fares with these too.
      PER_USD[currency] = perUsd
    })
    book = { source: 'chainlink', contract: address, rates }
  } catch (error) {
    console.warn(
      '[rates] KovaRates unreadable; keeping the last rates:',
      error instanceof Error ? error.message.split('\n')[0] : error,
    )
  }
  return book
}

export function serializeRates(current: RateBook) {
  return {
    object: 'rates',
    source: current.source,
    chain: network.name,
    contract: current.contract,
    contract_url: current.contract ? explorerAddressUrl(network, current.contract) : null,
    rates: Object.fromEntries(
      Object.entries(current.rates).map(([code, r]) => [
        code,
        { per_usd: r.perUsd, as_of: r.asOf },
      ]),
    ),
  }
}
