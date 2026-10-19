import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'
import { KovaError } from '../errors.js'

/**
 * Paystack, for naira in and out (services/naira.ts): Nigerian banks and account names, transfers
 * to a bank account (cashing out), and card, bank-transfer or USSD payments (adding money in naira).
 * A test secret key runs it all in Paystack's test mode, with no real money. Amounts are kobo.
 */

const API = 'https://api.paystack.co'

export const paystackReady = () => Boolean(config.PAYSTACK_SECRET_KEY)
export const paystackTestMode = () => config.PAYSTACK_SECRET_KEY?.startsWith('sk_test_') ?? false

function requirePaystack(): string {
  if (!config.PAYSTACK_SECRET_KEY)
    throw new KovaError('conflict', 'Naira isn’t switched on for this server yet.')
  return config.PAYSTACK_SECRET_KEY
}

class PaystackError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function call<T>(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${requirePaystack()}`, 'content-type': 'application/json' },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(20_000),
  })
  const body = (await response.json().catch(() => ({}))) as {
    status?: boolean
    message?: string
    data?: T
  }
  if (!response.ok || body.status === false)
    throw new PaystackError(body.message ?? `Paystack answered ${response.status}`, response.status)
  return body.data as T
}

// ── Banks ───────────────────────────────────────────────────────────────────────────────────

export interface Bank {
  name: string
  code: string
}

let banks: { list: Bank[]; at: number } | null = null

/** Nigerian banks Paystack can pay, by name. Cached for a day. */
export async function nigerianBanks(): Promise<Bank[]> {
  if (banks && Date.now() - banks.at < 86_400_000) return banks.list
  const list: Bank[] = []
  for (let page = 1; page <= 10; page++) {
    const data = await call<
      { name: string; code: string; active: boolean; is_deleted?: boolean }[]
    >(`/bank?currency=NGN&perPage=100&page=${page}`)
    for (const bank of data)
      if (
        bank.active &&
        !bank.is_deleted &&
        !list.some((b) => b.code === bank.code && b.name === bank.name)
      )
        list.push({ name: bank.name, code: bank.code })
    if (data.length < 100) break
  }
  list.sort((a, b) => a.name.localeCompare(b.name))
  // Test mode looks up only three real accounts a day; Paystack's test bank has no such limit.
  if (paystackTestMode() && !list.some((b) => b.code === '001'))
    list.unshift({ name: 'Paystack Test Bank', code: '001' })
  banks = { list, at: Date.now() }
  return list
}

export async function bankNamed(code: string): Promise<Bank | undefined> {
  return (await nigerianBanks()).find((b) => b.code === code)
}

/** Names looked up recently, so a quote right after a look-up doesn't ask the bank again. */
const names = new Map<string, { name: string; at: number }>()

/** The name on a bank account, as the bank has it. */
export async function accountName(accountNumber: string, bankCode: string): Promise<string> {
  if (!/^\d{10}$/.test(accountNumber))
    throw new KovaError('invalid_request', 'A Nigerian account number has ten digits.')
  const key = `${bankCode}:${accountNumber}`
  const known = names.get(key)
  if (known && Date.now() - known.at < 30 * 60_000) return known.name
  try {
    const data = await call<{ account_name: string }>(
      `/bank/resolve?account_number=${accountNumber}&bank_code=${encodeURIComponent(bankCode)}`,
    )
    names.set(key, { name: data.account_name, at: Date.now() })
    return data.account_name
  } catch (error) {
    if (error instanceof PaystackError && /limit/i.test(error.message))
      throw new KovaError(
        'rate_limited',
        'The bank look-up is busy. Try again later, or use Paystack’s test bank in test mode.',
      )
    if (error instanceof PaystackError && error.status < 500)
      throw new KovaError(
        'invalid_request',
        'That account number and bank don’t match an account. Check them.',
      )
    throw error
  }
}

// ── Paying out ──────────────────────────────────────────────────────────────────────────────

export async function transferRecipient(input: {
  name: string
  accountNumber: string
  bankCode: string
}): Promise<string> {
  const data = await call<{ recipient_code: string }>('/transferrecipient', {
    method: 'POST',
    body: {
      type: 'nuban',
      name: input.name,
      account_number: input.accountNumber,
      bank_code: input.bankCode,
      currency: 'NGN',
    },
  })
  return data.recipient_code
}

export type TransferState =
  | 'success'
  | 'pending'
  | 'failed'
  | 'reversed'
  | 'otp'
  | 'abandoned'
  | 'blocked'
  | 'rejected'
  | 'received'

/** Sends naira from Kova's Paystack balance to a recipient. `reference` makes it happen once. */
export async function transfer(input: {
  kobo: bigint
  recipient: string
  reference: string
  reason: string
}) {
  const data = await call<{ transfer_code: string; status: TransferState }>('/transfer', {
    method: 'POST',
    body: {
      source: 'balance',
      amount: Number(input.kobo),
      recipient: input.recipient,
      reference: input.reference,
      reason: input.reason.slice(0, 100),
      currency: 'NGN',
    },
  })
  return { code: data.transfer_code, status: data.status }
}

export async function transferStatus(reference: string): Promise<TransferState> {
  return (
    await call<{ status: TransferState }>(`/transfer/verify/${encodeURIComponent(reference)}`)
  ).status
}

// ── Taking naira ────────────────────────────────────────────────────────────────────────────

/** Opens a Paystack checkout for naira: card, bank transfer or USSD. Returns where to send the payer. */
export async function checkout(input: {
  email: string
  kobo: bigint
  reference: string
  callbackUrl: string
  metadata: Record<string, string>
}): Promise<string> {
  const data = await call<{ authorization_url: string }>('/transaction/initialize', {
    method: 'POST',
    body: {
      email: input.email,
      amount: Number(input.kobo),
      reference: input.reference,
      callback_url: input.callbackUrl,
      currency: 'NGN',
      channels: ['card', 'bank_transfer', 'ussd', 'bank'],
      metadata: input.metadata,
    },
  })
  return data.authorization_url
}

export async function payment(
  reference: string,
): Promise<{ status: string; kobo: bigint; currency: string }> {
  const data = await call<{ status: string; amount: number; currency: string }>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
  )
  return { status: data.status, kobo: BigInt(data.amount), currency: data.currency }
}

/** Whether a webhook body came from Paystack: its HMAC-SHA512 under our secret key. */
export function webhookIsPaystack(body: string, signature: string | undefined): boolean {
  if (!signature || !config.PAYSTACK_SECRET_KEY) return false
  const expected = createHmac('sha512', config.PAYSTACK_SECRET_KEY).update(body).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && timingSafeEqual(a, b)
}
