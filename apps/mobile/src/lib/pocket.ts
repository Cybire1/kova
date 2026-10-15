import { type PocketChange, pocketMessage } from '@kova/monad'
import type { Address } from 'viem'
import { apiUrl } from './config'

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

type Signer = (message: string) => Promise<`0x${string}`>

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

const now = () => Math.floor(Date.now() / 1000)
const base = (dollars: string) => BigInt(Math.round(Number(dollars) * 1_000_000))

async function signed(sign: Signer, change: PocketChange) {
  return { signed_at: change.signedAt, signature: await sign(pocketMessage(change)) }
}

export const getPocket = (wallet: Address) =>
  call<Pocket>('GET', `/v1/wallets/${wallet}/ussd-pocket`)

export async function setUpPocket(
  sign: Signer,
  wallet: Address,
  input: { phone: string; pin: string; cap: string },
) {
  const proof = await signed(sign, {
    action: 'setup',
    wallet,
    phone: input.phone,
    cap: base(input.cap),
    signedAt: now(),
  })
  return call<Pocket>('PUT', `/v1/wallets/${wallet}/ussd-pocket`, { ...input, ...proof })
}

export const confirmCode = (wallet: Address, code: string) =>
  call<Pocket>('POST', `/v1/wallets/${wallet}/ussd-pocket/verify`, { code })

export async function changePocket(
  sign: Signer,
  wallet: Address,
  input: { cap?: string; pin?: string },
) {
  const proof = await signed(sign, {
    action: 'update',
    wallet,
    cap: input.cap === undefined ? undefined : base(input.cap),
    signedAt: now(),
  })
  return call<Pocket>('PATCH', `/v1/wallets/${wallet}/ussd-pocket`, { ...input, ...proof })
}

export async function takeBack(sign: Signer, wallet: Address, amount: string) {
  const proof = await signed(sign, {
    action: 'withdraw',
    wallet,
    amount: base(amount),
    signedAt: now(),
  })
  return call<Pocket>('POST', `/v1/wallets/${wallet}/ussd-pocket/withdraw`, { amount, ...proof })
}

export async function turnOff(sign: Signer, wallet: Address) {
  const proof = await signed(sign, { action: 'close', wallet, signedAt: now() })
  return call<Pocket>('DELETE', `/v1/wallets/${wallet}/ussd-pocket`, proof)
}
