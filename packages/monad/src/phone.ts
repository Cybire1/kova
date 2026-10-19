import { type Address, type Hex, keccak256, toHex } from 'viem'
import { normalizePhone } from './pocket.js'

export type PhoneAction =
  | 'resolve'
  | 'reserve'
  | 'confirm'
  | 'otp'
  | 'verify'
  | 'claim'
  | 'return'
  | 'resend'
export interface PhoneApproval {
  action: PhoneAction
  chainId: number
  wallet: Address
  signedAt: number
  id?: string
  phone?: string
  address?: Address
  amount?: string
  name?: string
  note?: string
}

/** Exact, network-bound approvals shared by native, web and API. Never includes a PIN or OTP. */
export function phoneMessage(p: PhoneApproval): string {
  return `Kova phone payment v1\n${JSON.stringify({
    action: p.action,
    chainId: p.chainId,
    wallet: p.wallet.toLowerCase(),
    signedAt: p.signedAt,
    id: p.id ?? '',
    phone: p.phone ?? '',
    address: p.address?.toLowerCase() ?? '',
    amount: p.amount ?? '',
    name: p.name ?? '',
    note: p.note ?? '',
  })}`
}

/** Claim and cancellation compete for ONE token authorization, including across server restarts. */
export const phonePaymentNonce = (chainId: number, id: string): Hex =>
  keccak256(toHex(`kova.phone.v1:${chainId}:${id}`))

/** Require an explicit country code; never guess a recipient's country. */
export function phoneInput(text: string): string | null {
  const clean = text.trim().replace(/[\s().-]/g, '')
  if (
    !/^(?:\+|00)?[1-9]\d{7,14}$/.test(clean) ||
    (clean.startsWith('0') && !clean.startsWith('00'))
  )
    return null
  return normalizePhone(
    clean.startsWith('00') ? `+${clean.slice(2)}` : clean.startsWith('+') ? clean : `+${clean}`,
  )
}

export interface PhonePayment {
  id: string
  network: 'testnet' | 'mainnet'
  status: 'funding' | 'open' | 'claiming' | 'returning' | 'claimed' | 'returned'
  amount: string
  phone: string
  address: Address
  sender: Address
  sender_name: string | null
  note: string | null
  url: string
  sms_sent: boolean
  tx_hash: Hex | null
}

export interface PhoneResolution {
  address: Address | null
  destination: 'wallet' | 'ussd-pocket' | null
}

type Signer = (message: string) => Promise<Hex>
type Request = <T>(method: string, path: string, body?: unknown) => Promise<T>

export function createPhoneClient(chainId: number, request: Request) {
  async function approved<T>(
    sign: Signer,
    wallet: Address,
    action: PhoneAction,
    input: Omit<PhoneApproval, 'action' | 'chainId' | 'wallet' | 'signedAt'> = {},
    extra = {},
  ) {
    const approval: PhoneApproval = {
      ...input,
      action,
      chainId,
      wallet,
      signedAt: Math.floor(Date.now() / 1000),
    }
    return request<T>('POST', `/v1/phone/${action}`, {
      ...approval,
      ...extra,
      signature: await sign(phoneMessage(approval)),
    })
  }
  return {
    info: () =>
      request<{ enabled: boolean; network: 'mainnet' | 'testnet'; mode: 'sandbox' | 'live' }>(
        'GET',
        '/v1/phone/info',
      ),
    get: (id: string) =>
      request<PhonePayment>('GET', `/v1/phone/payments/${encodeURIComponent(id)}`),
    resolve: (sign: Signer, wallet: Address, phone: string) =>
      approved<PhoneResolution>(sign, wallet, 'resolve', { phone }),
    reserve: (
      sign: Signer,
      wallet: Address,
      input: { phone: string; address: Address; amount: string; name: string; note: string },
      key: Hex,
    ) => approved<PhonePayment>(sign, wallet, 'reserve', input, { key }),
    confirm: (sign: Signer, wallet: Address, id: string) =>
      approved<PhonePayment>(sign, wallet, 'confirm', { id }),
    resend: (sign: Signer, wallet: Address, id: string) =>
      approved<PhonePayment>(sign, wallet, 'resend', { id }),
    requestCode: (sign: Signer, wallet: Address, id: string, phone: string) =>
      approved<{ sent: true }>(sign, wallet, 'otp', { id, phone }),
    verify: (sign: Signer, wallet: Address, id: string, phone: string, code: string) =>
      approved<{ verified: true }>(sign, wallet, 'verify', { id, phone }, { code }),
    claim: (sign: Signer, wallet: Address, id: string) =>
      approved<PhonePayment>(sign, wallet, 'claim', { id }),
    takeBack: (sign: Signer, wallet: Address, id: string) =>
      approved<PhonePayment>(sign, wallet, 'return', { id }),
  }
}
