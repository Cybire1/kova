import type {
  ChainDepositActivity,
  ChainDepositQuote,
  ChainDepositRequest,
  ChainDepositSources,
  DepositChain,
} from '@kova/monad'
import { formatUnits, isAddress, parseUnits, zeroAddress } from 'viem'
import { z } from 'zod'
import { config } from '../config.js'
import { KovaError } from '../errors.js'

const RELAY = 'https://api.relay.link'
const AUSD = '0x00000000efe302beaa2b3e6e1b18d08d69a9012a'
/** The networks people use most, first and in this order; every other network Relay takes
 * deposit addresses on follows, A to Z. */
const FEATURED = [143, 8453, 1, 42161, 10, 137, 56, 43114, 792703809, 728126428, 8253038, 5042]
/** Coins accepted on any network, besides each EVM network's own coin. */
const SYMBOLS = new Set([
  'MON',
  'USDC',
  'USDT',
  'USDT0',
  'USD₮0',
  'USDe',
  'ETH',
  'WETH',
  'SOL',
  'BTC',
  'TRX',
  'BNB',
  'POL',
  'AVAX',
])
const integer = z.string().regex(/^\d{1,78}$/)
const currency = z.object({
  chainId: z.number().int(),
  address: z.string().min(1).max(128),
  symbol: z.string().min(1).max(16),
  decimals: z.number().int().min(0).max(36),
})
const balance = z.object({ currency, amount: integer, minimumAmount: integer.optional() })
const chainsResponse = z.object({
  chains: z.array(
    z.object({
      id: z.number().int(),
      displayName: z.string(),
      vmType: z.string(),
      disabled: z.boolean().optional(),
      depositEnabled: z.boolean().optional(),
      depositAddressEnabled: z.boolean().optional(),
      solverCurrencies: z.array(currency.omit({ chainId: true })).optional(),
    }),
  ),
})
const quoteResponse = z.object({
  steps: z.array(
    z.object({
      id: z.string(),
      requestId: z.string().optional(),
      depositAddress: z.string().optional(),
    }),
  ),
  details: z.object({
    recipient: z.string(),
    currencyIn: balance,
    currencyOut: balance,
    timeEstimate: z.number().nonnegative().optional(),
  }),
  fees: z
    .object({ relayer: z.object({ amountUsd: z.string().regex(/^\d+(\.\d+)?$/) }).optional() })
    .optional(),
})

async function relay(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${RELAY}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(config.RELAY_API_KEY ? { 'x-api-key': config.RELAY_API_KEY } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new KovaError('chain_error', 'The deposit provider didn’t answer. Please try again.')
  }
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    if (response.status === 429)
      throw new KovaError('rate_limited', 'Too many deposit requests. Try again shortly.')
    const code = (body as { errorCode?: string } | null)?.errorCode
    if (code === 'AMOUNT_TOO_LOW' || code === 'INSUFFICIENT_AMOUNT')
      throw new KovaError(
        'invalid_request',
        'That deposit is too small for this route. Try a larger amount.',
      )
    throw new KovaError(
      'chain_error',
      'No deposit route is available for that token and amount right now. Try another token or amount.',
    )
  }
  return body
}

function enabled(tracking = false) {
  if (config.KOVA_NETWORK !== 'mainnet')
    throw new KovaError('conflict', 'Deposits from other chains only run on mainnet.', {
      mainnet_only: true,
    })
  if (!tracking && config.KOVA_CHAIN_DEPOSITS !== '1')
    throw new KovaError('conflict', 'Deposits are temporarily paused.')
  if (!config.RELAY_API_KEY)
    throw new KovaError('conflict', 'Crypto deposits are being connected. Please try again later.')
}

// Cache only the capability catalogue, never a quote or a wallet's address. A failed refresh
// fails closed instead of continuing to advertise disabled chains.
let catalogue: { until: number; chains: DepositChain[] } | undefined
export function clearDepositCatalogue() {
  catalogue = undefined
}

async function depositChains(): Promise<DepositChain[]> {
  if (catalogue && catalogue.until > Date.now()) return catalogue.chains
  const parsed = chainsResponse.safeParse(await relay('/chains'))
  if (!parsed.success)
    throw new KovaError('chain_error', 'The deposit provider returned an unreadable token list.')
  const rank = (id: number) => (FEATURED.includes(id) ? FEATURED.indexOf(id) : FEATURED.length)
  const chains = parsed.data.chains
    .flatMap((chain) => {
      const { id } = chain
      if (
        chain.disabled ||
        !chain.depositEnabled ||
        !chain.depositAddressEnabled ||
        !['evm', 'svm', 'tvm', 'bvm'].includes(chain.vmType)
      )
        return []
      const native = (t: { address: string }) => chain.vmType === 'evm' && t.address === zeroAddress
      const allowed = (chain.solverCurrencies ?? []).filter(
        (t) => SYMBOLS.has(t.symbol) || native(t),
      )
      const tokens = allowed
        // One chip per coin: Arc lists USDC twice (its own coin, and an ERC-20 view of the same
        // balance), so keep the network's own, which is what wallets send.
        .filter((t) => native(t) || !allowed.some((u) => u.symbol === t.symbol && native(u)))
        .filter((t, i, all) => all.findIndex((u) => u.symbol === t.symbol) === i)
        .sort((a, b) => {
          const priority =
            id === 143 ? ['MON', 'USDC', 'USDT0'] : ['USDC', 'USDT', 'USDT0', 'USD₮0']
          return (
            (priority.indexOf(a.symbol) < 0 ? 99 : priority.indexOf(a.symbol)) -
            (priority.indexOf(b.symbol) < 0 ? 99 : priority.indexOf(b.symbol))
          )
        })
      return tokens.length
        ? [{ id, name: chain.displayName, vm: chain.vmType as DepositChain['vm'], tokens }]
        : []
    })
    .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name))
  // Even if an origin works, do not offer it while Monad itself is disabled.
  if (!chains.some((c) => c.id === 143)) return []
  // A nonempty key is not sufficient: verify tracking access before advertising deposits.
  const tracking = z
    .object({ requests: z.array(z.unknown()) })
    .safeParse(await relay(`/requests/v3?recipient=${zeroAddress}&limit=1`))
  if (!tracking.success)
    throw new KovaError('chain_error', 'Deposit tracking is temporarily unavailable.')
  catalogue = { chains, until: Date.now() + 60_000 }
  return chains
}

export async function chainDepositSources(): Promise<ChainDepositSources> {
  const tracking = config.KOVA_NETWORK === 'mainnet' && Boolean(config.RELAY_API_KEY)
  const off =
    config.KOVA_NETWORK !== 'mainnet'
      ? 'Deposits from other chains only run on mainnet.'
      : config.KOVA_CHAIN_DEPOSITS !== '1'
        ? 'Deposits are temporarily paused.'
        : !config.RELAY_API_KEY
          ? 'Crypto deposits are being connected. Please try again later.'
          : null
  if (off)
    return {
      live: false,
      tracking,
      network: config.KOVA_NETWORK,
      reason: off,
      arrives_as: 'AUSD',
      chains: [],
    }
  const chains = await depositChains()
  return {
    live: chains.length > 0,
    tracking,
    network: config.KOVA_NETWORK,
    reason: chains.length ? null : 'Deposits to Monad are temporarily unavailable.',
    arrives_as: 'AUSD',
    chains,
  }
}

export const chainDepositBody = z.object({
  chain_id: z.number().int(),
  token: z.string().min(1).max(128),
  amount: z
    .string()
    .max(80)
    .regex(/^(0|[1-9]\d*)(\.\d+)?$/),
  refund_to: z.string().trim().min(1).max(128),
})

function validAddress(address: string, vm: DepositChain['vm']): boolean {
  if (vm === 'evm')
    return isAddress(address, { strict: false }) && address.toLowerCase() !== zeroAddress
  if (vm === 'svm')
    return (
      /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) &&
      address !== '11111111111111111111111111111111'
    )
  if (vm === 'tvm')
    return (
      /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address) &&
      address !== 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'
    )
  return (
    /^(bc1[ac-hj-np-z02-9]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(address) &&
    address !== 'bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8'
  )
}

export async function chainDepositQuote(
  wallet: string,
  input: ChainDepositRequest,
): Promise<ChainDepositQuote> {
  enabled()
  const body = chainDepositBody.safeParse(input)
  if (!body.success)
    throw new KovaError('invalid_request', 'Choose a chain, token, amount and refund address.')
  const chain = (await depositChains()).find((c) => c.id === body.data.chain_id)
  const token = chain?.tokens.find((t) =>
    chain.vm === 'evm'
      ? t.address.toLowerCase() === body.data.token.toLowerCase()
      : t.address === body.data.token,
  )
  if (!chain || !token)
    throw new KovaError(
      'invalid_request',
      'That token is not available for deposits on this network.',
    )
  if (!validAddress(body.data.refund_to, chain.vm))
    throw new KovaError(
      'invalid_request',
      `Enter a refund wallet address on ${chain.name} that you control.`,
    )
  const fraction = body.data.amount.split('.')[1] ?? ''
  if (fraction.length > token.decimals)
    throw new KovaError(
      'invalid_request',
      `${token.symbol} supports at most ${token.decimals} decimal places.`,
    )
  const amount = parseUnits(body.data.amount, token.decimals)
  if (amount <= 0n || amount >= 2n ** 256n)
    throw new KovaError('invalid_request', 'Enter a positive deposit amount.')
  const parsed = quoteResponse.safeParse(
    await relay('/quote/v2', {
      method: 'POST',
      body: JSON.stringify({
        // Non-EVM origins require a native origin address for user; recipient stays the Kova EVM wallet.
        user: chain.vm === 'evm' ? wallet : body.data.refund_to,
        recipient: wallet,
        originChainId: chain.id,
        originCurrency: token.address,
        destinationChainId: 143,
        destinationCurrency: AUSD,
        amount: amount.toString(),
        tradeType: 'EXACT_INPUT',
        useDepositAddress: true,
        refundTo: body.data.refund_to,
        slippageTolerance: '50',
      }),
    }),
  )
  if (!parsed.success)
    throw new KovaError('chain_error', 'The deposit quote was incomplete. Please try again.')
  const { details, steps, fees } = parsed.data
  const deposit = steps.find((s) => s.id === 'deposit')
  const incoming = details.currencyIn
  const outgoing = details.currencyOut
  const sameToken =
    chain.vm === 'evm'
      ? incoming.currency.address.toLowerCase() === token.address.toLowerCase()
      : incoming.currency.address === token.address
  // Never display a provider address unless the full route matches this wallet's request.
  if (
    !deposit?.depositAddress ||
    !validAddress(deposit.depositAddress, chain.vm) ||
    !deposit.requestId ||
    !/^0x[\da-f]{64}$/i.test(deposit.requestId) ||
    details.recipient.toLowerCase() !== wallet.toLowerCase() ||
    incoming.currency.chainId !== chain.id ||
    !sameToken ||
    incoming.currency.decimals !== token.decimals ||
    BigInt(incoming.amount) !== amount ||
    outgoing.currency.chainId !== 143 ||
    outgoing.currency.address.toLowerCase() !== AUSD ||
    outgoing.currency.decimals !== 6 ||
    !outgoing.minimumAmount ||
    BigInt(outgoing.minimumAmount) <= 0n ||
    BigInt(outgoing.minimumAmount) > BigInt(outgoing.amount) ||
    BigInt(outgoing.minimumAmount) < (BigInt(outgoing.amount) * 9950n) / 10000n
  )
    throw new KovaError(
      'chain_error',
      'The deposit quote didn’t match your wallet or token. Please try again.',
    )
  return {
    provider: 'relay',
    request_id: deposit.requestId,
    address: deposit.depositAddress,
    chain,
    token,
    amount: formatUnits(amount, token.decimals),
    expected_ausd: formatUnits(BigInt(outgoing.amount), 6),
    minimum_ausd: formatUnits(BigInt(outgoing.minimumAmount), 6),
    route_fee_usd: fees?.relayer?.amountUsd ?? null,
    time_estimate_seconds: details.timeEstimate ?? null,
    refund_to: body.data.refund_to,
    quoted_at: new Date().toISOString(),
    pricing: 'estimate',
  }
}

const tx = z.object({ txHash: z.string(), chainId: z.number(), status: z.string().optional() })
const route = z.object({ destination: z.object({ outputCurrency: balance }).optional() })
const requestsResponse = z.object({
  requests: z.array(
    z.object({
      id: z.string(),
      recipient: z.string(),
      status: z.enum([
        'waiting',
        'depositing',
        'pending',
        'submitted',
        'success',
        'refund',
        'failure',
      ]),
      depositAddress: z
        .object({ address: z.string(), depositTxHash: z.string().nullish() })
        .nullish(),
      data: z.object({
        inTxs: z.array(tx).optional(),
        outTxs: z.array(tx).optional(),
        route: z.object({ quoted: route.optional(), actual: route.nullish() }).optional(),
      }),
      createdAt: z.string(),
    }),
  ),
})

/** Query by recipient, not the original quote ID: open addresses regenerate requests on deposit. */
export async function chainDepositActivity(wallet: string): Promise<ChainDepositActivity[]> {
  enabled(true)
  const query = new URLSearchParams({
    recipient: wallet,
    destinationChainId: '143',
    currencyOutAddress: AUSD,
    limit: '20',
    sortBy: 'createdAt',
    sortDirection: 'desc',
  })
  const parsed = requestsResponse.safeParse(await relay(`/requests/v3?${query}`))
  if (!parsed.success)
    throw new KovaError('chain_error', 'Deposit tracking is temporarily unavailable.')
  return parsed.data.requests.flatMap((r) => {
    const output =
      r.data.route?.quoted?.destination?.outputCurrency ??
      r.data.route?.actual?.destination?.outputCurrency
    if (
      r.recipient.toLowerCase() !== wallet.toLowerCase() ||
      !r.depositAddress ||
      output?.currency.chainId !== 143 ||
      output.currency.address.toLowerCase() !== AUSD ||
      output.currency.decimals !== 6
    )
      return []
    const actual = r.data.route?.actual?.destination?.outputCurrency
    if (
      actual &&
      (actual.currency.chainId !== 143 ||
        actual.currency.address.toLowerCase() !== AUSD ||
        actual.currency.decimals !== 6)
    )
      return []
    return [
      {
        id: r.id,
        status: r.status,
        source_chain_id: r.data.inTxs?.[0]?.chainId ?? null,
        deposit_address: r.depositAddress.address,
        deposit_tx: r.depositAddress.depositTxHash ?? r.data.inTxs?.[0]?.txHash ?? null,
        destination_tx:
          r.data.outTxs?.find((t) => t.chainId === 143 && t.status === 'success')?.txHash ?? null,
        received_ausd:
          r.status === 'success' &&
          actual?.currency.address.toLowerCase() === AUSD &&
          actual.currency.chainId === 143 &&
          actual.currency.decimals === 6
            ? formatUnits(BigInt(actual.amount), 6)
            : null,
        created_at: r.createdAt,
      },
    ]
  })
}
