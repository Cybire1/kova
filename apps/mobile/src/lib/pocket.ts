import { createPocketClient } from '@kova/monad'
import { apiUrl, network } from './config'

/**
 * The USSD pocket: a small dollar balance this wallet sets aside, to pay from any phone by dialling
 * Kova's code, even with no data. Every change is signed by the wallet's passkey.
 */

export type { Pocket, PocketPayout, PocketSpend } from '@kova/monad'

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

export const { getPocket, setUpPocket, confirmCode, changePocket, setPayout, takeBack, turnOff } =
  createPocketClient(network.chainId, call)
