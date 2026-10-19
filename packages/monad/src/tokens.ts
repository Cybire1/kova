import { type Address, formatUnits, getAddress, isAddressEqual, parseUnits } from 'viem'
import type { NetworkId } from './networks.js'

/**
 * The dollars Kova settles in on Monad. AUSD, Agora's dollar, is the default: it is what
 * Kova's cross-border story runs on. Both tokens have 6 decimals and support EIP-3009, so a
 * payer signs and Kova's relayer submits, and nobody needs MON for gas.
 */
export const currencies = ['AUSD', 'USDC'] as const
export type Currency = (typeof currencies)[number]

export const DEFAULT_CURRENCY: Currency = 'AUSD'

/** Every dollar Kova settles in on Monad has 6 decimals. */
export const TOKEN_DECIMALS = 6

export interface Token {
  currency: Currency
  symbol: string
  address: Address
  decimals: 6
  /** The token's EIP-712 domain, as its contract reports it (EIP-5267). Signing against any other name fails. */
  domain: { name: string; version: string }
}

const token = (
  currency: Currency,
  symbol: string,
  address: string,
  domain: Token['domain'],
): Token => ({
  currency,
  symbol,
  address: getAddress(address),
  decimals: 6,
  domain,
})

/**
 * Domains were read off chain on 2026-09-24 and checked against each token's DOMAIN_SEPARATOR:
 * AUSD signs as "Agora Dollar" version "1"; Circle's USDC (FiatTokenV2_2) as "USDC" version "2".
 * Agora's testnet faucet (requestFunds(recipient), 10,000 AUSD a call) is at AUSD_TESTNET_FAUCET;
 * Circle's (faucet.circle.com) sends 20 USDC every two hours.
 */
export const tokens: Record<NetworkId, Partial<Record<Currency, Token>>> = {
  mainnet: {
    AUSD: token('AUSD', 'AUSD', '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a', {
      name: 'Agora Dollar',
      version: '1',
    }),
    USDC: token('USDC', 'USDC', '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', {
      name: 'USDC',
      version: '2',
    }),
  },
  testnet: {
    AUSD: token('AUSD', 'AUSD', '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC', {
      name: 'Agora Dollar',
      version: '1',
    }),
    USDC: token('USDC', 'USDC', '0x534b2f3A21130d7a60830c2Df862319e593943A3', {
      name: 'USDC',
      version: '2',
    }),
  },
}

export const AUSD_TESTNET_FAUCET = getAddress('0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C')

/** Kova's test dollars on testnet: five a day for each wallet, from Kova's own testnet treasury. */
export const TEST_DOLLARS_A_DAY = 5_000_000n

export function isCurrency(value: string): value is Currency {
  return (currencies as readonly string[]).includes(value)
}

export function getToken(network: NetworkId, currency: Currency = DEFAULT_CURRENCY): Token {
  const found = tokens[network][currency]
  if (!found) throw new Error(`${currency} is not available on Monad ${network}`)
  return found
}

export function supportedTokens(network: NetworkId): Token[] {
  return Object.values(tokens[network]).filter((t): t is Token => Boolean(t))
}

export function tokenByAddress(network: NetworkId, address: Address): Token | undefined {
  return supportedTokens(network).find((t) => isAddressEqual(t.address, address))
}

const AMOUNT_RE = /^(0|[1-9]\d{0,14})(\.\d{1,6})?$/

/**
 * Parses a decimal amount string ("25.00") into base units. Strict: no exponents, signs,
 * separators, leading zeros, or more than 6 decimals, so API input can never be ambiguous.
 */
export function parseAmount(amount: string): bigint {
  if (!AMOUNT_RE.test(amount)) throw new Error(`Invalid amount: ${JSON.stringify(amount)}`)
  return parseUnits(amount, TOKEN_DECIMALS)
}

/** Formats base units as a fixed 2+ decimal string ("25.00", "0.000031"). */
export function formatAmount(units: bigint): string {
  const s = formatUnits(units, TOKEN_DECIMALS)
  const [whole, frac = ''] = s.split('.')
  return `${whole}.${frac.padEnd(2, '0')}`
}
