import {
  moneyActionMessage,
  tokenByAddress,
  toSignedAuthorization,
  transferAuthorizationTypedData,
} from '@kova/monad'
import type { Address, Hex, LocalAccount } from 'viem'
import { apiUrl, network, networkId } from './config'
import {
  DEMO_API,
  demoAddRecipient,
  demoCashOutOn,
  demoPayout,
  demoQuote,
  demoRecipients,
} from './demo-cashout'

/**
 * Cash out through Nuvion: to banks, mobile money and wallets in 20+ countries. The API owns the
 * list of rails and the fields each needs (apps/api/src/services/payout-corridors.ts), so the
 * screens draw whatever it sends.
 */

export type FieldKind =
  | 'text'
  | 'digits'
  | 'email'
  | 'phone'
  | 'iban'
  | 'bic'
  | 'country'
  | 'select'
  | 'bank'

export interface PayoutField {
  key: string
  label: string
  kind: FieldKind
  placeholder?: string
  min?: number
  max?: number
  options?: { value: string; label: string }[]
  optional?: boolean
  /** A heading drawn above this field, where a new group starts. */
  section?: string
}

export interface Corridor {
  id: string
  country: string
  name: string
  flag: string
  currency: string
  title: string
  speed: string
  /** The country whose bank list the picker shows, when there is one. */
  banks: string | null
  fields: PayoutField[]
  min_to: number | null
  max_to: number | null
}

export interface PayoutsInfo {
  live: boolean
  min: string
  max: string
  fee_bps: number
  corridors: Corridor[]
}

export interface PayoutBank {
  name: string
  code: string
}

export interface Recipient {
  id: string
  corridor: string
  country: string
  currency: string
  name: string
  flag: string
  title: string
  speed: string
  holder_name: string
  label: string
}

export interface Payout {
  id: string
  amount: string
  fee: string
  currency: string
  amount_to: string
  rate: string
  recipient: Recipient | null
  status: 'quoted' | 'expired' | 'received' | 'sending' | 'paid' | 'failed'
  pay: { token: Address; to: Address | null; value: string; nonce: Hex; valid_before: number }
  tx_hash: string | null
  refund_tx_hash: string | null
  failure: string | null
  expires_at: string
  created_at: string
}

type Sign = (message: string) => Promise<Hex>

async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const base = demoCashOutOn() ? DEMO_API : apiUrl
  const response = await fetch(`${base}/v1${path}`, {
    method: init?.method ?? (init?.body === undefined ? 'GET' : 'POST'),
    ...(init?.body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }),
  })
  const json = (await response.json().catch(() => ({}))) as { error?: { message?: string } }
  if (!response.ok)
    throw new Error(json.error?.message ?? `Kova is unreachable (${response.status})`)
  return json as T
}

async function signed(address: Address, sign: Sign, action: string, detail = '') {
  const signed_at = Math.floor(Date.now() / 1000)
  return {
    signed_at,
    signature: await sign(moneyActionMessage(address, action, signed_at, detail)),
  }
}

export const getPayoutsInfo = () => api<PayoutsInfo>('/payouts')
export const getPayoutBanks = (country: string) =>
  api<{ data: PayoutBank[] }>(`/payouts/banks/${country}`).then((r) => r.data)
/** Rates, kept a minute: the ways out, the amount and the check all show the same one. */
const rates = new Map<string, { at: number; rate: Promise<number> }>()
export function getPayoutRate(currency: string): Promise<number> {
  const kept = rates.get(currency)
  if (kept && Date.now() - kept.at < 60_000) return kept.rate
  const rate = api<{ per_dollar: number }>(`/payouts/rates/${currency}`).then((r) => r.per_dollar)
  rates.set(currency, { at: Date.now(), rate })
  rate.catch(() => rates.delete(currency))
  return rate
}
export const getRecipients = (address: Address) =>
  demoCashOutOn()
    ? Promise.resolve(demoRecipients())
    : api<{ data: Recipient[] }>(`/wallets/${address}/payout-recipients`).then((r) => r.data)
export const getPayout = (id: string) =>
  demoCashOutOn() ? Promise.resolve().then(() => demoPayout(id)) : api<Payout>(`/payouts/${id}`)

/** Saves where to cash out to: the details go to Nuvion, signed by the wallet. */
export async function addRecipient(
  address: Address,
  sign: Sign,
  corridor: string,
  fields: Record<string, string>,
) {
  if (demoCashOutOn()) {
    const info = await getPayoutsInfo()
    const way = info.corridors.find((c) => c.id === corridor)
    if (!way) throw new Error('Pick where to cash out to.')
    return demoAddRecipient(way, fields)
  }
  return api<Recipient>(`/wallets/${address}/payout-recipients`, {
    body: { corridor, fields, ...(await signed(address, sign, 'payout-recipient', corridor)) },
  })
}

export async function removeRecipient(address: Address, sign: Sign, id: string) {
  return api<{ deleted: true }>(`/wallets/${address}/payout-recipients/${id}`, {
    method: 'DELETE',
    body: await signed(address, sign, 'payout-recipient-remove', id),
  })
}

/** A quote: the rate locked for a couple of minutes. */
export const quotePayout = (address: Address, recipientId: string, dollars: string) =>
  demoCashOutOn()
    ? demoQuote(recipientId, dollars)
    : api<Payout>(`/wallets/${address}/payouts`, {
        body: { recipient_id: recipientId, amount: dollars },
      })

/** Signs exactly this payout's transfer to Kova and hands it over: Kova relays it and pays out. */
export async function payPayout(account: LocalAccount, payout: Payout): Promise<Payout> {
  if (!payout.pay.to) throw new Error('Cashing out isn’t switched on yet.')
  const token = tokenByAddress(networkId, payout.pay.token)
  if (!token) throw new Error('This cash-out asks for a token Kova doesn’t use. Nothing moved.')
  const authorization = {
    from: account.address,
    to: payout.pay.to,
    value: BigInt(payout.pay.value),
    validAfter: 0n,
    validBefore: BigInt(payout.pay.valid_before),
    nonce: payout.pay.nonce,
  }
  const signature = await account.signTypedData(
    transferAuthorizationTypedData(token, network.chainId, authorization),
  )
  return api<Payout>(`/payouts/${payout.id}/pay`, {
    body: toSignedAuthorization(token.address, authorization, signature),
  })
}

/** "C$137.02", "KSh12,735.05", "$20.00": an amount in the currency it lands in. */
export function inCurrency(amount: string | number, currency: string): string {
  const n = typeof amount === 'number' ? amount : Number(amount.replace(/,/g, ''))
  if (currency === 'USDC')
    return `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      currencyDisplay: 'symbol',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n)
  } catch {
    return `${currency} ${n.toFixed(2)}`
  }
}
