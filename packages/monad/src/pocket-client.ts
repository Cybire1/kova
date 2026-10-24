import type { Address, Hex } from 'viem'
import { randomNonce } from './authorization.js'
import {
  normalizePhone,
  type PocketChange,
  pinProblem,
  pocketMessage,
  pocketPinCommitment,
} from './pocket.js'
import { parseAmount } from './tokens.js'

export interface PocketSpend {
  reference: string
  kind: 'till' | 'phone' | 'withdraw' | 'cashout'
  to: string
  amount: string
  status: 'pending' | 'paid' | 'failed'
  tx_hash?: Hex | null
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
      /** Where dialling "Cash out" sends the naira; only the owner sets it, in the app. */
      payout: PocketPayout | null
      /** Whether this server can cash out to naira at all. */
      cash_out: boolean
      spends: PocketSpend[]
    }
export interface PocketPayout {
  /** How the phone's menu names it: "OPay ••5678". */
  label: string
  bank_name: string
  account_name: string
  account_last4: string
}
export interface PocketInfo {
  enabled: boolean
  recovery?: boolean
  network: 'testnet' | 'mainnet'
  mode: 'sandbox' | 'live'
  dial: string | null
}
type Signer = (message: string) => Promise<Hex>
type Request = <T>(method: string, path: string, body?: unknown) => Promise<T>

/** Shared by web and iOS: exact amounts and network-bound approvals of secret PIN commitments. */
export function createPocketClient(chainId: number, request: Request) {
  const last = new Map<string, number>()
  const nextAt = (wallet: Address) => {
    const key = wallet.toLowerCase(),
      at = Math.max(Math.floor(Date.now() / 1000), (last.get(key) ?? 0) + 1)
    last.set(key, at)
    return at
  }
  const path = (wallet: Address) => `/v1/wallets/${wallet}/ussd-pocket`
  const signed = async (sign: Signer, change: Omit<PocketChange, 'chainId'>) => ({
    signed_at: change.signedAt,
    signature: await sign(pocketMessage({ ...change, chainId })),
  })
  const pinProof = (wallet: Address, pin: string) => {
    const problem = pinProblem(pin)
    if (problem) throw new Error(problem)
    const pin_nonce = randomNonce()
    return { pin_nonce, pinCommitment: pocketPinCommitment(wallet, chainId, pin, pin_nonce) }
  }
  return {
    info: () => request<PocketInfo>('GET', '/v1/ussd/info'),
    getPocket: (wallet: Address) => request<Pocket>('GET', path(wallet)),
    setUpPocket: async (
      sign: Signer,
      wallet: Address,
      input: { phone: string; pin: string; cap: string },
    ) => {
      const phone = normalizePhone(input.phone)
      if (!phone) throw new Error('Enter your number with its country code, like +2348012345678.')
      const pin = pinProof(wallet, input.pin)
      const proof = await signed(sign, {
        action: 'setup',
        wallet,
        phone,
        cap: parseAmount(input.cap),
        pinCommitment: pin.pinCommitment,
        signedAt: nextAt(wallet),
      })
      return request<Pocket>('PUT', path(wallet), {
        ...input,
        phone,
        pin_nonce: pin.pin_nonce,
        ...proof,
      })
    },
    confirmCode: (wallet: Address, code: string) =>
      request<Pocket>('POST', `${path(wallet)}/verify`, { code }),
    changePocket: async (sign: Signer, wallet: Address, input: { cap?: string; pin?: string }) => {
      const pin = input.pin === undefined ? undefined : pinProof(wallet, input.pin)
      const proof = await signed(sign, {
        action: 'update',
        wallet,
        cap: input.cap === undefined ? undefined : parseAmount(input.cap),
        pinCommitment: pin?.pinCommitment,
        signedAt: nextAt(wallet),
      })
      return request<Pocket>('PATCH', path(wallet), {
        ...input,
        ...(pin ? { pin_nonce: pin.pin_nonce } : {}),
        ...proof,
      })
    },
    takeBack: async (sign: Signer, wallet: Address, amount: string) => {
      const proof = await signed(sign, {
        action: 'withdraw',
        wallet,
        amount: parseAmount(amount),
        signedAt: nextAt(wallet),
      })
      return request<Pocket>('POST', `${path(wallet)}/withdraw`, { amount, ...proof })
    },
    /** The bank or mobile-money account the phone cashes out to; null removes it. */
    setPayout: async (
      sign: Signer,
      wallet: Address,
      account: { bankCode: string; accountNumber: string } | null,
    ) => {
      if (account && !/^\d{10}$/.test(account.accountNumber))
        throw new Error('An account number is 10 digits.')
      const proof = await signed(sign, {
        action: 'payout',
        wallet,
        bankCode: account?.bankCode,
        accountNumber: account?.accountNumber,
        signedAt: nextAt(wallet),
      })
      return request<Pocket>('PUT', `${path(wallet)}/payout`, {
        ...(account ? { bank_code: account.bankCode, account_number: account.accountNumber } : {}),
        ...proof,
      })
    },
    turnOff: async (sign: Signer, wallet: Address) => {
      const proof = await signed(sign, { action: 'close', wallet, signedAt: nextAt(wallet) })
      return request<Pocket>('DELETE', path(wallet), proof)
    },
  }
}
