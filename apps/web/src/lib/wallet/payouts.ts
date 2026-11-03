import {
  getNetwork,
  getToken,
  moneyActionMessage,
  type NetworkId,
  type TransferAuthorization,
  toSignedAuthorization,
  transferAuthorizationTypedData,
} from '@kova/monad'
import type { Address, Hex, LocalAccount } from 'viem'

/**
 * Cash out through Nuvion: to banks, mobile money and wallets in 20+ countries, the same rails the
 * app uses. The API owns the list and the fields each needs (services/payout-corridors.ts); calls
 * pass through /api/payouts.
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
  pay: { token: string; to: string | null; value: string; nonce: Hex; valid_before: number }
  tx_hash: string | null
  refund_tx_hash: string | null
  failure: string | null
  expires_at: string
  created_at: string
}

type Sign = (message: string) => Promise<Hex>

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(`/api/payouts/${path}`, {
    method: init?.method ?? (init?.body === undefined ? 'GET' : 'POST'),
    ...(init?.body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }),
  })
  const json = (await response.json().catch(() => null)) as (T & { error?: string }) | null
  if (!response.ok || !json) throw new Error(json?.error ?? 'Kova didn’t answer. Try again.')
  return json
}

async function signed(address: Address, sign: Sign, action: string, detail = '') {
  const signed_at = Math.floor(Date.now() / 1000)
  return {
    signed_at,
    signature: await sign(moneyActionMessage(address, action, signed_at, detail)),
  }
}

export const getPayoutsInfo = () => call<PayoutsInfo>('payouts')
export const getPayoutBanks = (country: string) =>
  call<{ data: PayoutBank[] }>(`payouts/banks/${country}`).then((r) => r.data)
export const getPayoutRate = (currency: string) =>
  call<{ per_dollar: number }>(`payouts/rates/${currency}`).then((r) => r.per_dollar)
export const getRecipients = (address: Address) =>
  call<{ data: Recipient[] }>(`wallets/${address}/payout-recipients`).then((r) => r.data)
export const getPayout = (id: string) => call<Payout>(`payouts/${id}`)

export async function addRecipient(
  address: Address,
  sign: Sign,
  corridor: string,
  fields: Record<string, string>,
) {
  return call<Recipient>(`wallets/${address}/payout-recipients`, {
    body: { corridor, fields, ...(await signed(address, sign, 'payout-recipient', corridor)) },
  })
}

export const quotePayout = (address: Address, recipientId: string, dollars: string) =>
  call<Payout>(`wallets/${address}/payouts`, {
    body: { recipient_id: recipientId, amount: dollars },
  })

/** Signs exactly this payout's transfer to Kova and hands it over: Kova relays it and pays out. */
export async function payPayout(
  network: NetworkId,
  account: LocalAccount,
  payout: Payout,
): Promise<Payout> {
  if (!payout.pay.to) throw new Error('Cashing out isn’t switched on yet.')
  const token = getToken(network, 'AUSD')
  const authorization: TransferAuthorization = {
    from: account.address,
    to: payout.pay.to as Address,
    value: BigInt(payout.pay.value),
    validAfter: 0n,
    validBefore: BigInt(payout.pay.valid_before),
    nonce: payout.pay.nonce,
  }
  const signature = await account.signTypedData(
    transferAuthorizationTypedData(token, getNetwork(network).chainId, authorization),
  )
  return call<Payout>(`payouts/${payout.id}/pay`, {
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

/** A country's ways out in a few words: "Interac · Bank account", "M-Pesa · Bank account". */
export function waysOut(rails: Corridor[]): string {
  return [
    ...new Set(
      rails.map((r) =>
        r.title.includes('Interac')
          ? 'Interac'
          : r.title.startsWith('M-Pesa')
            ? 'M-Pesa'
            : r.title.startsWith('Mobile money')
              ? 'Mobile money'
              : r.title.startsWith('Wire')
                ? 'Wire'
                : r.title.startsWith('SWIFT')
                  ? 'SWIFT, in dollars'
                  : r.title.startsWith('USDC')
                    ? 'Base, Ethereum, Polygon, Solana'
                    : r.title.startsWith('Another Nuvion')
                      ? 'Instant, in dollars'
                      : r.title.startsWith('Bank or e-wallet')
                        ? 'Bank or e-wallet'
                        : 'Bank account',
      ),
    ),
  ].join(' · ')
}
