import { type Currency, DEFAULT_CURRENCY, getNetwork, getToken, supportedTokens } from '@kova/monad'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  nonceManager,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { config } from './config.js'

export const network = getNetwork(config.KOVA_NETWORK)
export const rpcUrl = config.MONAD_RPC_URL ?? network.rpcUrl

/** The dollar Kova settles in on Monad: AUSD, Agora's dollar. */
export const settlementCurrency: Currency = DEFAULT_CURRENCY
export const settlementToken = getToken(config.KOVA_NETWORK, settlementCurrency)

/** Every token Kova accepts on this network. A transfer in anything else is not a Kova payment. */
export const acceptedTokens = supportedTokens(config.KOVA_NETWORK)

export function tokenFor(currency: Currency) {
  return getToken(config.KOVA_NETWORK, currency)
}

/**
 * Kova's relayer. Payers sign EIP-3009 authorizations and never hold MON; this account submits
 * them and pays the gas. It can only move money someone signed over, so a compromise costs gas
 * and nothing else. The nonce manager lets concurrent payments go out without colliding.
 */
export const feePayerAccount = config.KOVA_FEE_PAYER_PRIVATE_KEY
  ? privateKeyToAccount(config.KOVA_FEE_PAYER_PRIVATE_KEY as `0x${string}`, { nonceManager })
  : undefined

export const feePayerAddress: Address | undefined = feePayerAccount?.address

/**
 * Traces every upstream RPC call when KOVA_TRACE_RPC is set. The relay's cost is mostly the
 * calls it makes on our behalf, and they are invisible without this.
 */
const trace = process.env.KOVA_TRACE_RPC
  ? {
      onFetchRequest: async (request: Request) => {
        const body = (await request
          .clone()
          .json()
          .catch(() => ({}))) as { method?: string } | { method?: string }[]
        const methods = Array.isArray(body)
          ? body.map((entry) => entry.method).join(',')
          : body.method
        console.log(`[rpc] ${methods}`)
      },
    }
  : {}

/**
 * Public Monad RPCs allow about 25 requests a second per address, and Railway's outbound
 * addresses are shared, so the limit is sometimes someone else's traffic. Requests retry with
 * patience, and fail over to a second provider. Set MONAD_RPC_URL to a dedicated endpoint in
 * production.
 */
const backups: Record<typeof network.id, string[]> = {
  testnet: ['https://rpc.ankr.com/monad_testnet'],
  mainnet: ['https://rpc.ankr.com/monad'],
}
const endpoint = (url: string) =>
  http(url, { ...trace, timeout: 10_000, retryCount: 3, retryDelay: 400 })
const transport = fallback(
  [endpoint(rpcUrl), ...backups[network.id].filter((url) => url !== rpcUrl).map(endpoint)],
  {
    rank: false,
    retryCount: 2,
  },
)

/** Monad makes a block every ~0.3s, so receipts are polled far faster than viem's default. */
export const publicClient = createPublicClient({
  chain: network.chain,
  transport,
  pollingInterval: 200,
})

/** Signs and submits as the relayer. Undefined when this deployment has no relayer key. */
export const walletClient = feePayerAccount
  ? createWalletClient({
      account: feePayerAccount,
      chain: network.chain,
      transport,
      pollingInterval: 200,
    })
  : undefined
