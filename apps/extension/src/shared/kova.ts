import { kovaCardAddress, networks, paymentTypedData } from '@kova/monad'
import { type Address, getAddress, type Hex, isAddressEqual } from 'viem'
import { API, NETWORK } from './config.js'
import type { ApiKey, ApiPayment } from './types.js'

/** Kova's API, called from the background (its host permission skips CORS). */
export async function kova<T>(path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API}/v1/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch {
    throw new Error('Kova is unreachable. Nothing moved.')
  }
  const json = (await response.json().catch(() => ({}))) as {
    error?: { message?: string } | string
  } & T
  if (!response.ok) {
    const e = json.error
    throw new Error(
      (typeof e === 'string' ? e : e?.message) ?? 'Kova didn’t take that. Nothing moved.',
    )
  }
  return json
}

export interface KeysConfig {
  ready: boolean
  x402_ready: boolean
  x402_payer?: Address | null
  contract: Address | null
  chain_id: number
}

export interface Prepared extends ApiPayment {
  typed_data: {
    domain: { name: string; version: string; chainId: number; verifyingContract: Address }
    message: { card: Address; to: Address; amount: string; memo: Hex; deadline: string }
  }
}

export interface Expected {
  card: Address
  to: Address
  amount: bigint
}

/**
 * Before a site's key signs anything Kova sends back, rebuild the payment here from what the person
 * approved, and refuse if Kova's version differs in any field: the network, the KovaCard contract,
 * the key, who's paid, how much, or a deadline more than ten minutes away. The key signs the
 * rebuilt one, never Kova's object.
 */
export function checkedPayment(prepared: Prepared, expected: Expected, nowS: number) {
  const chainId = networks[NETWORK].chainId
  const contract = kovaCardAddress(NETWORK)
  const d = prepared.typed_data.domain
  const m = prepared.typed_data.message
  const problem = (why: string) => new Error(`Kova sent a payment that doesn’t match (${why}).`)
  if (!contract) throw problem('no contract on this network')
  if (d.chainId !== chainId) throw problem('network')
  if (!isAddressEqual(d.verifyingContract, contract)) throw problem('contract')
  if (d.name !== 'Kova Card' || d.version !== '1') throw problem('domain')
  if (!isAddressEqual(m.card, expected.card)) throw problem('key')
  if (!isAddressEqual(m.to, expected.to)) throw problem('recipient')
  if (BigInt(m.amount) !== expected.amount) throw problem('amount')
  const deadline = BigInt(m.deadline)
  if (deadline <= BigInt(nowS) || deadline > BigInt(nowS + 600)) throw problem('deadline')
  if (!/^0x[0-9a-fA-F]{64}$/.test(m.memo)) throw problem('memo')
  return paymentTypedData(chainId, contract, {
    card: getAddress(m.card),
    to: getAddress(m.to),
    amount: expected.amount,
    memo: m.memo,
    deadline,
  })
}

export const keysOf = (owner: Address) =>
  kova<{ data: ApiKey[] }>(`wallets/${owner}/keys?kind=site`)

export const keyPaymentsOf = (owner: Address) =>
  kova<{ data: ApiPayment[] }>(`wallets/${owner}/key-payments`)
