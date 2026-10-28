import { createHmac, timingSafeEqual } from 'node:crypto'
import { type Address, formatUnits } from 'viem'
import { config } from '../config.js'
import { KovaError } from '../errors.js'
import type { Bank } from './paystack.js'

/**
 * PAJ (docs.paj.cash): naira in and out of stablecoins on Monad. Kova uses PAJ's orders, never its
 * standing bank-account addresses (those are Solana only):
 *
 * - **Cashing out:** an offramp order names the bank account and the USDC PAJ will receive. PAJ
 *   confirms the account with the bank first (the holder's name comes back), then returns a one-time
 *   Monad address and pays the naira once that USDC lands there.
 * - **Adding money:** an onramp order returns a bank account opened for this one payment. Once the
 *   naira arrives, PAJ delivers AUSD to the wallet on Monad itself; Kova's treasury sends nothing.
 *
 * Every call carries the business key (x-api-key). PAJ's rates already include its fee for Kova.
 */

export const pajReady = () => Boolean(config.PAJ_API_KEY)

export class PajError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** An onramp or offramp order, as PAJ returns it on creation, on read, and in its webhook. */
export interface PajOrder {
  id: string
  /** Offramp: the one-time address on Monad to send the USDC to. */
  address: string
  mint: string
  chain: string
  currency: string
  /** Whole tokens of `mint`. */
  amount: number
  usdcAmount: number
  /** Whole naira. */
  fiatAmount: number
  rate: number
  fee: number
  status: 'INIT' | 'PROCESSING' | 'COMPLETED' | 'ERROR' | (string & {})
  /** The transaction on Monad, once there is one. */
  signature?: string
  /** Onramp: the account to pay into. Offramp: the account PAJ pays. */
  accountNumber?: string
  accountName?: string
  bank?: string
  createdAt: string
}

async function call<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}) {
  const key = config.PAJ_API_KEY
  if (!key) throw new KovaError('conflict', 'Naira isn’t switched on for this server yet.')
  let res: Response
  try {
    res = await fetch(`${config.PAJ_API_URL}/pub/v2${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'x-api-key': key,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      // Opening an order asks the bank to confirm the account: PAJ suggests allowing 30 seconds.
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    throw new KovaError('internal', 'PAJ didn’t answer. Try again in a moment.')
  }
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  if (!res.ok) {
    // Validation failures carry one message per field, as an array.
    const said = (body as { message?: string | string[] } | null)?.message
    throw new PajError(
      res.status,
      Array.isArray(said) ? said.join(', ') : (said ?? `HTTP ${res.status}`),
    )
  }
  return body as T
}

/** PAJ's refusals, in words a person can act on. */
function explain(error: unknown): never {
  if (error instanceof PajError && error.status === 400) {
    if (/account/i.test(error.message))
      throw new KovaError(
        'invalid_request',
        'That account number and bank don’t match an account. Check them.',
      )
    throw new KovaError('invalid_request', `PAJ couldn’t take that: ${error.message}`)
  }
  if (error instanceof PajError) {
    console.error('[paj] refused', error.status, error.message)
    throw new KovaError('internal', 'PAJ couldn’t take that right now. Try again in a moment.')
  }
  throw error
}

let banks: { list: Bank[]; at: number } | null = null

/** Nigerian banks PAJ pays out to, by name, with the codes its orders take. Cached for a day. */
export async function pajBanks(): Promise<Bank[]> {
  if (banks && Date.now() - banks.at < 86_400_000) return banks.list
  const data = await call<{ name?: string; code?: string; logo?: string }[]>('/bank?country=NG')
  const list: Bank[] = []
  for (const bank of data)
    if (bank.name && bank.code && !list.some((b) => b.code === bank.code))
      list.push({
        name: bank.name.trim(),
        code: bank.code,
        logo: bank.logo?.startsWith('https://') ? bank.logo : null,
      })
  list.sort((a, b) => a.name.localeCompare(b.name))
  banks = { list, at: Date.now() }
  return list
}

let rates: { onRamp: number; offRamp: number; at: number } | null = null

/** Naira per dollar each way, PAJ's fee included. Re-read every minute: a rate is never locked. */
export async function pajRates(): Promise<{ onRamp: number; offRamp: number }> {
  if (rates && Date.now() - rates.at < 60_000) return rates
  const data = await call<{ onRampRate: { rate: number }; offRampRate: { rate: number } }>(
    '/rate?currency=NGN',
  )
  const onRamp = Number(data.onRampRate?.rate)
  const offRamp = Number(data.offRampRate?.rate)
  if (!(onRamp > 0) || !(offRamp > 0))
    throw new KovaError('internal', 'Kova can’t read the naira rate right now. Try again soon.')
  rates = { onRamp, offRamp, at: Date.now() }
  return rates
}

const whole = (units: bigint) => Number(formatUnits(units, 6))

/** An offramp order: PAJ pays the account once `usdc` (base units) lands at the order's address. */
export async function openOfframp(input: {
  bankCode: string
  accountNumber: string
  usdc: bigint
  usdcAddress: Address
  webhookUrl?: string
}): Promise<PajOrder> {
  return call<PajOrder>('/offramp', {
    method: 'POST',
    body: {
      bankCode: input.bankCode,
      accountNumber: input.accountNumber,
      currency: 'NGN',
      amount: whole(input.usdc),
      chain: 'MONAD',
      mint: input.usdcAddress,
      ...(input.webhookUrl ? { webhookURL: input.webhookUrl } : {}),
    },
  }).catch(explain)
}

/** An onramp order: a bank account for this one payment; PAJ sends `amount` of `mint` to `recipient`. */
export async function openOnramp(input: {
  amount: bigint
  mint: Address
  recipient: Address
  externalId: string
  webhookUrl?: string
}): Promise<PajOrder> {
  return call<PajOrder>('/onramp', {
    method: 'POST',
    body: {
      amount: whole(input.amount),
      currency: 'NGN',
      recipient: input.recipient,
      mint: input.mint,
      chain: 'MONAD',
      userExternalId: input.externalId,
      ...(input.webhookUrl ? { webhookURL: input.webhookUrl } : {}),
    },
  }).catch(explain)
}

/** An order as PAJ has it now: the only word Kova acts on. */
export async function pajOrder(id: string): Promise<PajOrder> {
  return call<PajOrder>(`/transaction/${encodeURIComponent(id)}`)
}

/** The holder's name on an account, as the bank has it (from opening an order PAJ confirms first). */
const names = new Map<string, { name: string; at: number }>()

export async function pajAccountName(
  bankCode: string,
  accountNumber: string,
  usdcAddress: Address,
): Promise<string> {
  const key = `${bankCode}:${accountNumber}`
  const known = names.get(key)
  if (known && Date.now() - known.at < 30 * 60_000) return known.name
  // PAJ names an account only by confirming it for an order. This one is never funded: PAJ
  // releases its address after two hours and deletes it after three days.
  const order = await openOfframp({ bankCode, accountNumber, usdc: 1_000_000n, usdcAddress })
  const name = order.accountName?.trim()
  if (!name)
    throw new KovaError('invalid_request', 'The bank didn’t name that account. Check the number.')
  names.set(key, { name, at: Date.now() })
  return name
}

/**
 * Whether a delivery is PAJ's: an HMAC-SHA256 over `{timestamp}.{raw body}` with the webhook secret,
 * signed within five minutes. Without a secret configured there is nothing to check (null); either
 * way a delivery only prompts Kova to read the order from PAJ's API.
 */
export function webhookIsPaj(
  raw: string,
  timestamp: string | undefined,
  signature: string | undefined,
): boolean | null {
  const secret = config.PAJ_WEBHOOK_SECRET
  if (!secret) return null
  if (!timestamp || !signature) return false
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false
  const expected = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex')
  const received =
    signature
      .split(',')
      .map((part) => part.trim())
      .find((part) => part.startsWith('v1='))
      ?.slice(3) ?? ''
  return (
    received.length === expected.length &&
    timingSafeEqual(Buffer.from(received), Buffer.from(expected))
  )
}
