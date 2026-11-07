import { networks, tokens } from '@kova/monad'
import { type Address, createPublicClient, erc20Abi, formatUnits, http } from 'viem'
import { NETWORK } from '../shared/config.js'

const network = networks[NETWORK]

export const client = createPublicClient({
  chain: network.chain,
  transport: http(network.rpcUrl, { timeout: 10_000, retryCount: 2 }),
})

/** The wallet's AUSD, in dollars ("1284.50"), read from Monad. Null when the read fails. */
export async function dollarsOf(owner: Address): Promise<string | null> {
  const ausd = tokens[NETWORK].AUSD
  if (!ausd) return null
  try {
    const units = await client.readContract({
      address: ausd.address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [owner],
    })
    return formatUnits(units, 6)
  } catch {
    return null
  }
}

/** Reads a website may make through Kova's provider, passed to Monad as they are. */
const READS = new Set([
  'eth_blockNumber',
  'eth_call',
  'eth_estimateGas',
  'eth_feeHistory',
  'eth_gasPrice',
  'eth_getBalance',
  'eth_getBlockByHash',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getLogs',
  'eth_getStorageAt',
  'eth_getTransactionByHash',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_maxPriorityFeePerGas',
  'web3_clientVersion',
])

export const isRead = (method: string) => READS.has(method)

export async function read(method: string, params: unknown): Promise<unknown> {
  const response = await fetch(network.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? [] }),
  })
  const json = (await response.json()) as { result?: unknown; error?: { message?: string } }
  if (json.error) throw new Error(json.error.message ?? 'Monad didn’t answer that.')
  return json.result
}
