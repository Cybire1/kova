import { type Address, encodeAbiParameters, getAddress, type Hex, keccak256 } from 'viem'

/**
 * Buying and selling xStocks (docs/stocks-trading.md): a wallet swaps its dollars for a stock token
 * on Monad, and back, through KovaStocks (apps/card/contracts/src/KovaStocks.sol) and KyberSwap,
 * with one signature each way. Kova's relayer carries it and pays the gas; the stock lands in the
 * wallet's own address. Shared by the API, the web and the iPhone, so all three hold the same
 * rules, the same text to sign and the same typed data.
 */

// --- Rules ----------------------------------------------------------------------------------

/** At most $1,000 a buy, in AUSD base units (6 decimals). */
export const STOCK_BUY_MAX = 1_000_000_000n
/** At least $1 a buy. */
export const STOCK_BUY_MIN = 1_000_000n
/** How long a quote holds, in seconds. */
export const STOCK_QUOTE_SECONDS = 60
/** The least a trade may get, against its quote: 99%, so at most 1% below. */
export const STOCK_MIN_OUT_BPS = 9_900n

/** The quote's amount, less the most a trade may fall short of it. */
export const stockMinOut = (quoted: bigint): bigint => (quoted * STOCK_MIN_OUT_BPS) / 10_000n

/**
 * Where xStocks aren't offered, by ISO country code: the US and its territories, the UK, Canada,
 * Australia, the EU and EEA, Switzerland, and sanctioned countries. A country Kova can't tell is
 * blocked too. Each with the name a sentence uses.
 */
export const STOCK_BLOCKED_COUNTRIES: Readonly<Record<string, string>> = {
  // The United States and its territories
  US: 'the United States',
  PR: 'Puerto Rico',
  GU: 'Guam',
  VI: 'the US Virgin Islands',
  AS: 'American Samoa',
  MP: 'the Northern Mariana Islands',
  UM: 'the US Minor Outlying Islands',
  GB: 'the United Kingdom',
  CA: 'Canada',
  AU: 'Australia',
  // The EU
  AT: 'Austria',
  BE: 'Belgium',
  BG: 'Bulgaria',
  HR: 'Croatia',
  CY: 'Cyprus',
  CZ: 'Czechia',
  DK: 'Denmark',
  EE: 'Estonia',
  FI: 'Finland',
  FR: 'France',
  DE: 'Germany',
  GR: 'Greece',
  HU: 'Hungary',
  IE: 'Ireland',
  IT: 'Italy',
  LV: 'Latvia',
  LT: 'Lithuania',
  LU: 'Luxembourg',
  MT: 'Malta',
  NL: 'the Netherlands',
  PL: 'Poland',
  PT: 'Portugal',
  RO: 'Romania',
  SK: 'Slovakia',
  SI: 'Slovenia',
  ES: 'Spain',
  SE: 'Sweden',
  // The rest of the EEA, and Switzerland
  IS: 'Iceland',
  LI: 'Liechtenstein',
  NO: 'Norway',
  CH: 'Switzerland',
  // Sanctioned
  CU: 'Cuba',
  IR: 'Iran',
  KP: 'North Korea',
  SY: 'Syria',
  RU: 'Russia',
  BY: 'Belarus',
}

/**
 * Why stock tokens aren't available where this visitor is, in plain words, or null when they are.
 * `country` is an ISO code; null (or anything not a code) means Kova couldn't tell, which blocks.
 */
export function stockCountryBlock(country: string | null | undefined): string | null {
  const code = country?.trim().toUpperCase()
  if (!code || !/^[A-Z]{2}$/.test(code))
    return 'Kova can’t tell which country you’re in, so stock tokens aren’t available.'
  const name = STOCK_BLOCKED_COUNTRIES[code]
  return name ? `Stock tokens aren’t available in ${name}.` : null
}

/** "2026-10-29": the date an attestation carries, in UTC. */
export const attestationDate = (at: Date = new Date()): string => at.toISOString().slice(0, 10)

/**
 * What a wallet signs (personal_sign) once before its first trade, and again when its country
 * changes: the exact text, with its address and the date filled in.
 */
export function stockAttestation(wallet: Address, date: string = attestationDate()): string {
  return [
    'Kova stock tokens',
    "I confirm I am not a US citizen, US resident or US taxpayer, and I don't live in a country where xStocks are restricted.",
    'I understand xStocks are tokens issued by Backed, not shares, that their price can fall, and that Kova gives no advice.',
    `Wallet: ${getAddress(wallet)}`,
    `Date: ${date}`,
  ].join('\n')
}

/** What Kova is, said beside every trade. No advice, no rankings, no performance claims. */
export const STOCK_NOT_ADVICE =
  'Kova doesn’t issue, sell or recommend stocks. This swaps your dollars for a token on Monad, issued by Backed.'

/** The plain warnings before every buy. */
export const STOCK_WARNINGS = [
  'Stock tokens are risky.',
  'They’re complex: a token issued by Backed, not a share.',
  'You can lose money.',
  'They aren’t for beginners.',
] as const

// --- KovaStocks -----------------------------------------------------------------------------

/**
 * The nonce a buy's EIP-3009 receiveWithAuthorization (to KovaStocks) carries, so the signature
 * itself commits to which stock and the least it gets: KovaStocks.buyNonce(stock, minOut, ref).
 */
export function buyNonce(stock: Address, minOut: bigint, ref: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }],
      [getAddress(stock), minOut, ref],
    ),
  )
}

/** A sale the wallet signs (EIP-712, on the KovaStocks domain). */
export interface StockSellOrder {
  owner: Address
  stock: Address
  /** Shares, base units (18 decimals). */
  amount: bigint
  /** The least AUSD it gets, base units (6 decimals). */
  minOut: bigint
  /** Unix seconds. */
  deadline: bigint
  ref: Hex
}

export const stockSellTypes = {
  Sell: [
    { name: 'owner', type: 'address' },
    { name: 'stock', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'minOut', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'ref', type: 'bytes32' },
  ],
} as const

export const KOVA_STOCKS_DOMAIN = { name: 'KovaStocks', version: '1' } as const

/** The EIP-712 payload a wallet signs to sell `order.amount` of a stock through KovaStocks. */
export function stockSellTypedData(contract: Address, chainId: number, order: StockSellOrder) {
  return {
    domain: { ...KOVA_STOCKS_DOMAIN, chainId, verifyingContract: getAddress(contract) },
    types: stockSellTypes,
    primaryType: 'Sell' as const,
    message: order,
  }
}

const authorizationTuple = {
  name: 'auth',
  type: 'tuple',
  components: [
    { name: 'owner', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'v', type: 'uint8' },
    { name: 'r', type: 'bytes32' },
    { name: 's', type: 'bytes32' },
  ],
} as const

const sellOrderComponents = [
  { name: 'owner', type: 'address' },
  { name: 'stock', type: 'address' },
  { name: 'amount', type: 'uint256' },
  { name: 'minOut', type: 'uint256' },
  { name: 'deadline', type: 'uint256' },
  { name: 'ref', type: 'bytes32' },
] as const

/** KovaStocks (apps/card/contracts/src/KovaStocks.sol). */
export const kovaStocksAbi = [
  {
    type: 'function',
    name: 'buyNonce',
    stateMutability: 'pure',
    inputs: [
      { name: 'stock', type: 'address' },
      { name: 'minOut', type: 'uint256' },
      { name: 'ref', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'buy',
    stateMutability: 'nonpayable',
    inputs: [
      authorizationTuple,
      { name: 'stock', type: 'address' },
      { name: 'minOut', type: 'uint256' },
      { name: 'ref', type: 'bytes32' },
      { name: 'swap', type: 'bytes' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'sell',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'order', type: 'tuple', components: sellOrderComponents },
      { name: 'orderSig', type: 'bytes' },
      {
        name: 'permit',
        type: 'tuple',
        components: [
          { name: 'deadline', type: 'uint256' },
          { name: 'v', type: 'uint8' },
          { name: 'r', type: 'bytes32' },
          { name: 's', type: 'bytes32' },
        ],
      },
      { name: 'swap', type: 'bytes' },
    ],
    outputs: [{ name: 'dollars', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'sellDigest',
    stateMutability: 'view',
    inputs: [{ name: 'order', type: 'tuple', components: sellOrderComponents }],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'used',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'ref', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'DOMAIN_SEPARATOR',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'SELL_TYPEHASH',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'dollar',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'router',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'relayer',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'event',
    name: 'Bought',
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'stock', type: 'address', indexed: true },
      { name: 'dollars', type: 'uint256', indexed: false },
      { name: 'shares', type: 'uint256', indexed: false },
      { name: 'ref', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Sold',
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'stock', type: 'address', indexed: true },
      { name: 'shares', type: 'uint256', indexed: false },
      { name: 'dollars', type: 'uint256', indexed: false },
      { name: 'ref', type: 'bytes32', indexed: false },
    ],
  },
  { type: 'error', name: 'OnlyRelayer', inputs: [] },
  { type: 'error', name: 'BadStock', inputs: [] },
  { type: 'error', name: 'BadSignature', inputs: [] },
  { type: 'error', name: 'Expired', inputs: [] },
  { type: 'error', name: 'AlreadyUsed', inputs: [] },
  { type: 'error', name: 'SwapFailed', inputs: [{ name: 'reason', type: 'bytes' }] },
  {
    type: 'error',
    name: 'Shortfall',
    inputs: [
      { name: 'got', type: 'uint256' },
      { name: 'needed', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'TokenRefused', inputs: [] },
] as const

/** EIP-2612 on a stock token: what the wallet's sell permit needs to know. */
export const stockPermitAbi = [
  {
    type: 'function',
    name: 'name',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'eip712Domain',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'fields', type: 'bytes1' },
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
      { name: 'salt', type: 'bytes32' },
      { name: 'extensions', type: 'uint256[]' },
    ],
  },
] as const
