/**
 * A throwaway customer for scripts and tests: a fresh key, test dollars from a Kova API's
 * faucet, and payments signed exactly the way Kova Pay signs them. It never holds MON: Kova's
 * relayer pays the gas.
 */
import {
  eip3009Abi,
  networkByChainId,
  tokenByAddress,
  toSignedAuthorization,
  transferAuthorizationTypedData,
} from '@kova/monad'
import { type Address, createPublicClient, type Hex, http, type LocalAccount } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

export interface Checkout {
  id: string
  status: string
  amount: string
  amount_base: string
  currency: string
  network: string
  chain_id: number
  token: Address
  pay_to: Address
  memo: Hex
  merchant_name: string
  reference: string | null
  expires_at: string
}

export interface Paid extends Checkout {
  payment: { payer: Address; tx_hash: Hex; explorer_url: string; ms: number }
}

export const newCustomer = (): LocalAccount => privateKeyToAccount(generatePrivateKey())

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const body = (await response.json().catch(() => ({}))) as { error?: unknown }
  if (!response.ok)
    throw new Error(
      `${init?.method ?? 'GET'} ${url}: ${response.status} ${JSON.stringify(body.error ?? body)}`,
    )
  return body as T
}

export const getCheckout = (api: string, id: string) => call<Checkout>(`${api}/v1/checkout/${id}`)

/** Asks the API's faucet for test dollars and waits until they land. Returns the balance. */
export async function fund(api: string, address: Address): Promise<bigint> {
  const health = await call<{ chain_id: number; settlement_token: { address: Address } }>(
    `${api}/health`,
  )
  const network = networkByChainId(health.chain_id)
  const client = createPublicClient({ chain: network.chain, transport: http(network.rpcUrl) })
  await call(`${api}/v1/faucet`, { method: 'POST', body: JSON.stringify({ address }) })
  for (let i = 0; i < 80; i++) {
    const balance = await client.readContract({
      address: health.settlement_token.address,
      abi: eip3009Abi,
      functionName: 'balanceOf',
      args: [address],
    })
    if (balance > 0n) return balance
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`test dollars never reached ${address}`)
}

/** Pays a checkout as Kova Pay does: signs an authorization for exactly this charge and hands it to Kova. */
export async function pay(
  api: string,
  checkout: Checkout,
  customer: LocalAccount,
): Promise<Paid & { roundTripMs: number }> {
  const network = networkByChainId(checkout.chain_id)
  const token = tokenByAddress(network.id, checkout.token)
  if (!token) throw new Error(`${checkout.token} is not a dollar Kova settles in`)
  const authorization = {
    from: customer.address,
    to: checkout.pay_to,
    value: BigInt(checkout.amount_base),
    validAfter: 0n,
    // The approval dies with the charge.
    validBefore: BigInt(Math.floor(Date.parse(checkout.expires_at) / 1000)),
    nonce: checkout.memo,
  }
  const signature = await customer.signTypedData(
    transferAuthorizationTypedData(token, network.chainId, authorization),
  )
  const started = Date.now()
  const paid = await call<Paid>(`${api}/v1/checkout/${checkout.id}/authorize`, {
    method: 'POST',
    body: JSON.stringify(toSignedAuthorization(token.address, authorization, signature)),
  })
  return { ...paid, roundTripMs: Date.now() - started }
}
