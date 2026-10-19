import { createPocketClient } from '@kova/monad'
import type { Address } from 'viem'
import { apiUrl, network } from './config'

/**
 * The USSD pocket: a small dollar balance this wallet sets aside, to pay from any phone by dialling
 * Kova's code, even with no data. Every change is signed by the wallet's passkey.
 */

export interface PocketSpend {
  reference: string
  kind: 'till' | 'phone' | 'withdraw'
  to: string
  amount: string
  status: 'pending' | 'paid' | 'failed'
  created_at: string
}

export type Pocket =
  | { status: 'none'; dial: string }
  | {
      status: 'pending' | 'active'
      phone: string
      address: Address
      cap: string
      balance: string | null
      spent_today: string
      left_today: string
      locked_until: string | null
      dial: string
      spends: PocketSpend[]
    }

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await response.json().catch(() => ({}))) as { error?: { message?: string } }
  if (!response.ok)
    throw new Error(json.error?.message ?? `Kova is unreachable (${response.status})`)
  return json as T
}

export const { getPocket, setUpPocket, confirmCode, changePocket, takeBack, turnOff } =
  createPocketClient(network.chainId, call)
