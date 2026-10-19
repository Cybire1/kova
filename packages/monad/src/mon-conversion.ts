import {
  type Address,
  type Hash,
  type LocalAccount,
  type PublicClient,
  createPublicClient,
  createWalletClient,
  fallback,
  formatEther,
  getAddress,
  http,
  isAddress,
  isAddressEqual,
  parseEther,
  zeroAddress,
} from 'viem'
import type { ChainDepositActivity, ChainDepositQuote } from './chain-deposits.js'
import { getNetwork } from './networks.js'
import { providerNativeTransfer } from './provider-account.js'

const network = getNetwork('mainnet')
export const monClient: PublicClient = createPublicClient({
  chain: network.chain,
  transport: fallback([
    http(network.rpcUrl, { timeout: 8000 }),
    http('https://rpc.ankr.com/monad', { timeout: 8000 }),
  ]),
})

export interface MonConversionPlan {
  wallet: Address
  quote: ChainDepositQuote
  value: bigint
  gas: bigint
  gasPrice: bigint
  networkFee: bigint
  preparedAt: number
}

/** Public recovery information only; never a key or a signed transaction. */
export interface PendingMonConversion {
  wallet: Address
  requestId: string
  depositAddress: string
  amount: string
  startedAt: number
  hash?: Hash
}

class ConversionNotSent extends Error {}
export function conversionWasNotSent(error: unknown): boolean {
  let cause = error
  for (let depth = 0; depth < 8 && cause && typeof cause === 'object'; depth++) {
    if (cause instanceof ConversionNotSent || ('code' in cause && cause.code === 4001)) return true
    cause = 'cause' in cause ? cause.cause : null
  }
  return false
}

export const monConversionKey = (wallet: string) => `kova.mon-conversion.v1.${wallet.toLowerCase()}`
export const monCardDismissalKey = (wallet: string) =>
  `kova.mon-card-dismissed.v1.${wallet.toLowerCase()}`
export const MIN_MON_CARD_BALANCE = 10n ** 18n

/** Gas dust never creates a home card. A fresh deposit can bring back a dismissed card. */
export function monCardVisible(
  balance: bigint | null,
  dismissedAt: bigint | null,
  completed: boolean,
): boolean {
  return (
    !completed &&
    balance !== null &&
    balance >= MIN_MON_CARD_BALANCE &&
    (dismissedAt === null || balance > dismissedAt)
  )
}

export function conversionActivity(
  pending: PendingMonConversion | null,
  activity: ChainDepositActivity[],
) {
  if (!pending) return null
  // Open deposit addresses are reused. Match this transaction, never a previous successful
  // conversion at the same address, even if Relay regenerated the request ID.
  if (pending.hash)
    return activity.find((d) => d.deposit_tx?.toLowerCase() === pending.hash!.toLowerCase()) ?? null
  return (
    activity.find(
      (d) => d.id === pending.requestId && Date.parse(d.created_at) >= pending.startedAt - 5000,
    ) ?? null
  )
}

export function formatMon(value: bigint): string {
  const exact = formatEther(value)
  if (value > 0n && value < 10n ** 12n) return '<0.000001'
  const [whole, fraction] = exact.split('.')
  const decimal = fraction?.slice(0, 6).replace(/0+$/, '')
  return decimal ? `${whole}.${decimal}` : whole!
}

export function conversionStatus(activity: ChainDepositActivity | null): string {
  if (activity?.status === 'success') return 'Dollars added'
  if (activity?.status === 'refund') return 'Refund in progress'
  if (activity?.status === 'failure') return 'Conversion needs attention'
  return 'Converting MON to dollars'
}

export async function maxMonConversion(wallet: Address): Promise<string> {
  const [held, price] = await Promise.all([
    monClient.getBalance({ address: wallet }),
    monClient.getGasPrice(),
  ])
  // Keep a conservative reserve; the actual deposit transaction is estimated for the preview.
  const available = held - price * 2n * 100_000n
  if (available <= 0n) throw new Error('There isn’t enough MON to cover the network fee yet.')
  return formatEther(available)
}

function validateQuote(wallet: Address, amount: bigint, quote: ChainDepositQuote) {
  const age = Date.now() - Date.parse(quote.quoted_at)
  if (
    quote.provider !== 'relay' ||
    quote.chain.id !== 143 ||
    quote.chain.vm !== 'evm' ||
    quote.token.address.toLowerCase() !== zeroAddress ||
    quote.token.decimals !== 18 ||
    !isAddress(quote.address) ||
    isAddressEqual(getAddress(quote.address), wallet) ||
    quote.address.toLowerCase() === zeroAddress ||
    !isAddress(quote.refund_to) ||
    !isAddressEqual(getAddress(quote.refund_to), wallet) ||
    !/^0x[0-9a-f]{64}$/i.test(quote.request_id) ||
    parseEther(quote.amount) !== amount ||
    !Number.isFinite(age) ||
    age < -5000 ||
    age > 120_000
  )
    throw new Error('This conversion quote has changed or expired. Preview it again.')
}

export async function prepareMonConversion(
  wallet: Address,
  amount: string,
  quote: ChainDepositQuote,
): Promise<MonConversionPlan> {
  if (!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(amount))
    throw new Error('Enter a MON amount with up to 18 decimal places.')
  const value = parseEther(amount)
  if (value <= 0n) throw new Error('Enter a positive MON amount.')
  validateQuote(wallet, value, quote)
  const [estimate, price, held] = await Promise.all([
    monClient.estimateGas({ account: wallet, to: getAddress(quote.address), value }),
    monClient.getGasPrice(),
    monClient.getBalance({ address: wallet }),
  ])
  const gas = (estimate * 120n + 99n) / 100n
  const gasPrice = price * 2n
  const networkFee = gas * gasPrice
  if (held < value + networkFee)
    throw new Error('Leave a little MON for the network fee, or tap Max.')
  return { wallet, quote, value, gas, gasPrice, networkFee, preparedAt: Date.now() }
}

/** Called only by the explicit conversion confirmation, never by balance polling. */
export async function sendMonConversion(
  plan: MonConversionPlan,
  account: LocalAccount,
): Promise<Hash> {
  try {
    validateQuote(plan.wallet, plan.value, plan.quote)
    if (!isAddressEqual(account.address, plan.wallet))
      throw new Error('Open the wallet that holds this MON.')
    if (plan.gas <= 0n || plan.gasPrice <= 0n || plan.networkFee !== plan.gas * plan.gasPrice)
      throw new Error('Preview the conversion again to confirm the network fee.')
    const [held, price, chainId] = await Promise.all([
      monClient.getBalance({ address: plan.wallet }),
      monClient.getGasPrice(),
      monClient.getChainId(),
    ])
    if (chainId !== 143) throw new Error('This conversion requires Monad mainnet.')
    if (held < plan.value + plan.networkFee)
      throw new Error('Your MON balance changed. Preview the conversion again.')
    if (price > plan.gasPrice)
      throw new Error('The network fee changed. Preview the conversion again.')
  } catch (error) {
    throw new ConversionNotSent(
      error instanceof Error ? error.message : 'Couldn’t check this conversion. Try again.',
    )
  }
  const transaction = {
    to: getAddress(plan.quote.address),
    value: plan.value,
    gas: plan.gas,
    gasPrice: plan.gasPrice,
  }
  const remote = providerNativeTransfer(account, transaction)
  if (remote) return remote
  return createWalletClient({
    account,
    chain: network.chain,
    transport: http(network.rpcUrl, { retryCount: 0 }),
  }).sendTransaction(transaction)
}
