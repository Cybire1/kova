import {
  type Address,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  fallback,
  formatUnits,
  getAddress,
  type Hash,
  type Hex,
  http,
  isAddress,
  isAddressEqual,
  type LocalAccount,
  type PublicClient,
  parseUnits,
  zeroAddress,
} from 'viem'
import {
  randomNonce,
  type SignedAuthorization,
  toSignedAuthorization,
  transferAuthorizationTypedData,
} from './authorization.js'
import type {
  ChainDepositActivity,
  ChainDepositQuote,
  ChainDepositSources,
} from './chain-deposits.js'
import {
  ConversionNotSent,
  formatMon,
  monClient,
  type PendingMonConversion,
} from './mon-conversion.js'
import { getNetwork, type NetworkId } from './networks.js'
import { monInDollars } from './prices.js'
import { providerTokenCall } from './provider-account.js'
import { tokenByAddress } from './tokens.js'

/**
 * Other tokens: what a Kova wallet holds on Monad besides its dollars (AUSD) and MON. Kova shows
 * them, says when one arrives, and turns the ones its deposit route takes into dollars: the token
 * goes to the wallet's own Relay deposit address, and AUSD comes back to the same wallet.
 */

/** How Kova values a token: a dollar each, at MON's price, or not at all (no price it trusts). */
export type TokenWorth = 'dollar' | 'mon' | null

export interface WalletToken {
  symbol: string
  name: string
  /** One character for its coin, the same on the web and the phone. */
  glyph: string
  address: Address
  decimals: number
  worth: TokenWorth
  /**
   * Below this, a balance is dust, about a cent: the Other tokens screen lists it, but it gets no
   * Home card and no arrival moment. Dust is how address-poisoning scams arrive.
   */
  dust: bigint
}

const listed = (
  symbol: string,
  name: string,
  glyph: string,
  address: string,
  decimals: number,
  worth: TokenWorth,
  dust: bigint,
): WalletToken => ({ symbol, name, glyph, address: getAddress(address), decimals, worth, dust })

const CENT = 10_000n

/**
 * The tokens Kova shows, each read off its contract on 2026-10-28 (name, symbol, decimals). Only
 * these ever show, so a token someone airdrops to bait a wallet never does. AUSD is the balance
 * itself and MON has its own card, so neither is here.
 */
export const WALLET_TOKENS: Record<NetworkId, WalletToken[]> = {
  mainnet: [
    listed(
      'USDC',
      'USD Coin',
      '$',
      '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
      6,
      'dollar',
      CENT,
    ),
    listed(
      'USDT0',
      'Tether USD',
      '₮',
      '0xe7cd86e13ac4309349f30b3435a9d337750fc82d',
      6,
      'dollar',
      CENT,
    ),
    listed(
      'mUSD',
      'MetaMask USD',
      '$',
      '0xaca92e438df0b2401ff60da7e4337b687a2435da',
      6,
      'dollar',
      CENT,
    ),
    // As for MON itself (MIN_MON_CARD_BALANCE): under one MON is gas dust.
    listed(
      'WMON',
      'Wrapped MON',
      'M',
      '0x3bd359c1119da7da1d913d1c4d2b7c461115433a',
      18,
      'mon',
      10n ** 18n,
    ),
    listed(
      'WETH',
      'Wrapped Ether',
      'Ξ',
      '0xee8c0e9f1bffb4eb878d8f15f368a02a35481242',
      18,
      null,
      10n ** 13n,
    ),
    listed('WBTC', 'Wrapped BTC', '₿', '0x0555e30da8f98308edb960aa94c0db47230d2b9c', 8, null, 10n),
    listed(
      'cbBTC',
      'Coinbase Wrapped BTC',
      '₿',
      '0xd18b7ec58cdf4876f6afebd3ed1730e4ce10414b',
      8,
      null,
      10n,
    ),
  ],
  testnet: [
    listed(
      'USDC',
      'USD Coin',
      '$',
      '0x534b2f3A21130d7a60830c2Df862319e593943A3',
      6,
      'dollar',
      CENT,
    ),
  ],
}

/** Enough to show on Home and to announce: more than dust. */
export const worthMentioning = (token: WalletToken, amount: bigint) => amount >= token.dust

const clients: Partial<Record<NetworkId, PublicClient>> = { mainnet: monClient }
const backupRpc: Record<NetworkId, string> = {
  mainnet: 'https://rpc.ankr.com/monad',
  testnet: 'https://rpc.ankr.com/monad_testnet',
}

/** A client for reading balances: Monad's own RPC, Ankr's if it stumbles. */
export function tokenClient(network: NetworkId): PublicClient {
  let made = clients[network]
  if (!made) {
    const { chain, rpcUrl } = getNetwork(network)
    made = createPublicClient({
      chain,
      transport: fallback([
        http(rpcUrl, { timeout: 8000 }),
        http(backupRpc[network], { timeout: 8000 }),
      ]),
    })
    clients[network] = made
  }
  return made
}

/**
 * Base units of each listed token, by lowercase address, as strings so they keep in JSON. A token
 * that couldn't be read is missing, never zero.
 */
export type TokenHoldings = Record<string, string>

export interface HeldToken {
  token: WalletToken
  amount: bigint
}

/** Every listed token's balance, in one multicall. */
export async function readWalletTokens(
  wallet: Address,
  network: NetworkId,
  client: PublicClient = tokenClient(network),
): Promise<TokenHoldings> {
  const list = WALLET_TOKENS[network]
  const owner = getAddress(wallet)
  const results = await client.multicall({
    allowFailure: true,
    contracts: list.map((t) => ({
      address: t.address,
      abi: erc20Abi,
      functionName: 'balanceOf' as const,
      args: [owner] as const,
    })),
  })
  const holdings: TokenHoldings = {}
  list.forEach((token, i) => {
    const r = results[i]
    if (r?.status === 'success' && typeof r.result === 'bigint')
      holdings[token.address.toLowerCase()] = r.result.toString()
  })
  return holdings
}

const amountIn = (holdings: TokenHoldings | null, token: WalletToken): bigint | null => {
  const text = holdings?.[token.address.toLowerCase()]
  return text !== undefined && /^\d{1,78}$/.test(text) ? BigInt(text) : null
}

/** The tokens with a balance, in the list's order. */
export function heldTokens(network: NetworkId, holdings: TokenHoldings | null): HeldToken[] {
  return WALLET_TOKENS[network].flatMap((token) => {
    const amount = amountIn(holdings, token)
    return amount ? [{ token, amount }] : []
  })
}

export interface TokenArrival extends HeldToken {
  /** One per balance it arrived into, so the same arrival is never announced twice. */
  id: string
}

/**
 * What arrived between two looks: each token whose balance went up by more than dust, by how much.
 * Nothing on a first look (no `before`), and nothing for a token either look couldn't read, so a
 * flaky read never announces money that was already there.
 */
export function tokenArrivals(
  network: NetworkId,
  before: TokenHoldings | null,
  after: TokenHoldings,
): TokenArrival[] {
  if (!before) return []
  return WALLET_TOKENS[network].flatMap((token) => {
    const was = amountIn(before, token)
    const now = amountIn(after, token)
    return was !== null && now !== null && worthMentioning(token, now - was)
      ? [{ id: `${token.address.toLowerCase()}:${now}`, token, amount: now - was }]
      : []
  })
}

/** The next look to keep: what was read now, and the last known balance of anything that wasn't. */
export const keptHoldings = (
  before: TokenHoldings | null,
  after: TokenHoldings,
): TokenHoldings => ({
  ...before,
  ...after,
})

/** Where the last look is kept, so each arrival is announced once, even across visits. */
export const walletTokensKey = (wallet: string, network: NetworkId) =>
  `kova.wallet-tokens.v1.${network}.${wallet.toLowerCase()}`
/** A conversion on its way (Monad mainnet only). */
export const tokenConversionKey = (wallet: string) =>
  `kova.token-conversion.v1.${wallet.toLowerCase()}`

function scale(amount: bigint, from: number, to: number): bigint {
  return from >= to ? amount / 10n ** BigInt(from - to) : amount * 10n ** BigInt(to - from)
}

/** What `amount` is worth in dollar base units (6 decimals), or null when Kova has no price for it. */
export function tokenInDollars(
  token: WalletToken,
  amount: bigint,
  usdPerMon: number | null,
): bigint | null {
  if (token.worth === 'dollar') return scale(amount, token.decimals, 6)
  if (token.worth === 'mon' && usdPerMon)
    return monInDollars(scale(amount, token.decimals, 18), usdPerMon)
  return null
}

/** "5.00", "1,250.5", "0.0042", "<0.000001": enough to see what's there, never a false zero. */
export function formatTokenAmount(token: WalletToken, amount: bigint): string {
  const [whole = '0', fraction = ''] = formatUnits(amount, token.decimals).split('.')
  const kept = fraction.slice(0, 6).replace(/0+$/, '')
  if (amount > 0n && whole === '0' && !/[1-9]/.test(kept)) return '<0.000001'
  const shown = token.worth === 'dollar' ? kept.padEnd(2, '0') : kept
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return shown ? `${grouped}.${shown}` : grouped
}

/** The exact amount, for an input: every decimal the token has, none it doesn't. */
export const exactTokenAmount = (token: WalletToken, amount: bigint) =>
  formatUnits(amount, token.decimals)

const sameAddress = (a: string, b: Address) =>
  isAddress(a, { strict: false }) && isAddressEqual(getAddress(a), b)

/**
 * The tokens Kova's deposit route turns into dollars here: the ones the API lists for Monad
 * itself, as it lists them today, never assumed.
 */
export function convertibleTokens(
  network: NetworkId,
  sources: ChainDepositSources | null,
): WalletToken[] {
  if (!sources?.live || sources.network !== network) return []
  const monad = sources.chains.find((c) => c.id === getNetwork(network).chainId && c.vm === 'evm')
  if (!monad) return []
  return WALLET_TOKENS[network].filter((token) =>
    monad.tokens.some(
      (d) => sameAddress(d.address, token.address) && d.decimals === token.decimals,
    ),
  )
}

/** Kova's relayer pays the fee for the dollars it settles in (USDC); other tokens pay it in MON. */
export const kovaPaysFee = (token: WalletToken) => Boolean(tokenByAddress('mainnet', token.address))

export interface TokenConversionPlan {
  wallet: Address
  token: WalletToken
  quote: ChainDepositQuote
  amount: bigint
  /** Kova's relayer submits a signed transfer and pays its fee; otherwise the wallet pays in MON. */
  gasless: boolean
  gas: bigint
  gasPrice: bigint
  /** In MON (wei); 0 when Kova pays it. */
  networkFee: bigint
  preparedAt: number
}

/** Public recovery information only; never a key or a signed transfer. */
export interface PendingTokenConversion extends PendingMonConversion {
  symbol: string
  token: Address
  hash: Hash
}

const mainnet = getNetwork('mainnet')

function validateQuote(
  wallet: Address,
  token: WalletToken,
  amount: bigint,
  quote: ChainDepositQuote,
) {
  const age = Date.now() - Date.parse(quote.quoted_at)
  let quoted: bigint | null = null
  try {
    quoted = parseUnits(quote.amount, token.decimals)
  } catch {}
  const deposit = isAddress(quote.address, { strict: false }) ? getAddress(quote.address) : null
  if (
    !WALLET_TOKENS.mainnet.some((t) => isAddressEqual(t.address, token.address)) ||
    quote.provider !== 'relay' ||
    quote.chain.id !== mainnet.chainId ||
    quote.chain.vm !== 'evm' ||
    !sameAddress(quote.token.address, token.address) ||
    quote.token.decimals !== token.decimals ||
    !deposit ||
    isAddressEqual(deposit, zeroAddress) ||
    isAddressEqual(deposit, wallet) ||
    isAddressEqual(deposit, token.address) ||
    !sameAddress(quote.refund_to, wallet) ||
    !/^0x[0-9a-f]{64}$/i.test(quote.request_id) ||
    quoted !== amount ||
    !Number.isFinite(age) ||
    age < -5000 ||
    age > 120_000
  )
    throw new Error('This conversion quote has changed or expired. Preview it again.')
}

const transferData = (to: Address, amount: bigint): Hex =>
  encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, amount] })

const balanceOf = (token: WalletToken, wallet: Address) =>
  monClient.readContract({
    address: token.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [wallet],
  })

const needsMon = (token: WalletToken) =>
  `Kova can’t pay the network fee for ${token.symbol}, so turning it into dollars needs a little MON in this wallet.`

/** The conversion, checked and priced, before anything is signed. */
export async function prepareTokenConversion(
  wallet: Address,
  token: WalletToken,
  amountText: string,
  quote: ChainDepositQuote,
): Promise<TokenConversionPlan> {
  if (!new RegExp(`^(0|[1-9]\\d*)(\\.\\d{1,${token.decimals}})?$`).test(amountText))
    throw new Error(`Enter a ${token.symbol} amount with up to ${token.decimals} decimal places.`)
  const amount = parseUnits(amountText, token.decimals)
  if (amount <= 0n) throw new Error(`Enter a positive ${token.symbol} amount.`)
  validateQuote(wallet, token, amount, quote)
  const held = await balanceOf(token, wallet)
  if (held < amount)
    throw new Error(
      `You have ${formatTokenAmount(token, held)} ${token.symbol} to turn into dollars.`,
    )
  const preparedAt = Date.now()
  if (kovaPaysFee(token))
    return {
      wallet,
      token,
      quote,
      amount,
      gasless: true,
      gas: 0n,
      gasPrice: 0n,
      networkFee: 0n,
      preparedAt,
    }
  const [price, mon] = await Promise.all([
    monClient.getGasPrice(),
    monClient.getBalance({ address: wallet }),
  ])
  const estimate = await monClient
    .estimateGas({
      account: wallet,
      to: token.address,
      data: transferData(getAddress(quote.address), amount),
    })
    .catch(() => null)
  if (estimate === null)
    throw new Error(mon === 0n ? needsMon(token) : 'Couldn’t work out the network fee. Try again.')
  const gas = (estimate * 120n + 99n) / 100n
  const gasPrice = price * 2n
  const networkFee = gas * gasPrice
  if (mon < networkFee) throw new Error(`${needsMon(token)} Up to ${formatMon(networkFee)} MON.`)
  return { wallet, token, quote, amount, gasless: false, gas, gasPrice, networkFee, preparedAt }
}

/**
 * Called only by the explicit confirmation. `relay` hands a signed transfer to Kova's relayer
 * (POST /v1/transfers) and returns its hash. Anything refused before it's sent is a
 * ConversionNotSent, so the caller knows it's safe to start again.
 */
export async function sendTokenConversion(
  plan: TokenConversionPlan,
  account: LocalAccount,
  relay: (signed: SignedAuthorization) => Promise<Hash>,
): Promise<Hash> {
  let signed: SignedAuthorization | null = null
  let call: { to: Address; data: Hex; gas: bigint; gasPrice: bigint } | null = null
  try {
    validateQuote(plan.wallet, plan.token, plan.amount, plan.quote)
    if (!isAddressEqual(account.address, plan.wallet))
      throw new Error('Open the wallet that holds these tokens.')
    const deposit = getAddress(plan.quote.address)
    const [held, chainId] = await Promise.all([
      balanceOf(plan.token, plan.wallet),
      monClient.getChainId(),
    ])
    if (chainId !== mainnet.chainId) throw new Error('This conversion requires Monad mainnet.')
    if (held < plan.amount)
      throw new Error(`Your ${plan.token.symbol} balance changed. Preview the conversion again.`)
    const kova = plan.gasless ? tokenByAddress('mainnet', plan.token.address) : undefined
    if (plan.gasless) {
      if (!kova) throw new Error('Preview the conversion again.')
      const authorization = {
        from: plan.wallet,
        to: deposit,
        value: plan.amount,
        validAfter: 0n,
        validBefore: BigInt(Math.floor(Date.now() / 1000) + 600),
        nonce: randomNonce(),
      }
      const signature = await account.signTypedData(
        transferAuthorizationTypedData(kova, mainnet.chainId, authorization),
      )
      signed = toSignedAuthorization(kova.address, authorization, signature)
    } else {
      if (plan.gas <= 0n || plan.gasPrice <= 0n || plan.networkFee !== plan.gas * plan.gasPrice)
        throw new Error('Preview the conversion again to confirm the network fee.')
      const [mon, price] = await Promise.all([
        monClient.getBalance({ address: plan.wallet }),
        monClient.getGasPrice(),
      ])
      if (mon < plan.networkFee)
        throw new Error('Your MON balance changed. Preview the conversion again.')
      if (price > plan.gasPrice)
        throw new Error('The network fee changed. Preview the conversion again.')
      call = {
        to: plan.token.address,
        data: transferData(deposit, plan.amount),
        gas: plan.gas,
        gasPrice: plan.gasPrice,
      }
    }
  } catch (error) {
    throw new ConversionNotSent(
      error instanceof Error ? error.message : 'Couldn’t check this conversion. Try again.',
    )
  }
  if (signed) return relay(signed)
  if (!call) throw new ConversionNotSent('Preview the conversion again.')
  const remote = providerTokenCall(account, call)
  if (remote) return remote
  return createWalletClient({
    account,
    chain: mainnet.chain,
    transport: http(mainnet.rpcUrl, { retryCount: 0 }),
  }).sendTransaction(call)
}

/** The conversion's record once its transfer is on its way. */
export function pendingTokenConversion(
  plan: TokenConversionPlan,
  hash: Hash,
): PendingTokenConversion {
  return {
    wallet: plan.wallet,
    requestId: plan.quote.request_id,
    depositAddress: plan.quote.address,
    amount: plan.quote.amount,
    startedAt: Date.parse(plan.quote.quoted_at),
    hash,
    symbol: plan.token.symbol,
    token: plan.token.address,
  }
}

export function tokenConversionStatus(
  symbol: string,
  activity: ChainDepositActivity | null,
): string {
  if (activity?.status === 'success') return 'Dollars added'
  if (activity?.status === 'refund') return `Sending your ${symbol} back`
  if (activity?.status === 'failure') return 'Conversion needs attention'
  return `Turning ${symbol} into dollars`
}
