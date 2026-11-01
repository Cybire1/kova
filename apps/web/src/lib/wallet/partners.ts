import {
  getNetwork,
  getToken,
  type MoneyFeature,
  moneyActionMessage,
  type NetworkId,
  receiveAuthorizationTypedData,
  transferAuthorizationTypedData,
  vaultPermitTypedData,
} from '@kova/monad'
import { type Address, type Hex, type LocalAccount, toHex } from 'viem'

/**
 * Money in (a US account number), the dollar card and savings, from the browser. Reads go through
 * /api/wallet/:address/money/…; every change carries the wallet's own signature.
 */

export interface UsAccount {
  live: boolean
  sandbox: boolean
  provider: string
  requested: boolean
  status: 'none' | 'kyc' | 'active' | 'closed'
  kyc_status: string | null
  kyc_link: string | null
  tos_link: string | null
  arrives_as: string
  last_four: string | null
  details: {
    bank_name: string | null
    account_number: string | null
    routing_number: string | null
    beneficiary_name: string | null
    beneficiary_address: string | null
    rails: string[]
  } | null
}

export interface DollarCard {
  live: boolean
  sandbox: boolean
  provider: string
  requested: boolean
  /** intro: no card yet. checking: the ID check is with the issuer. fix: it didn't pass. card: ready. */
  stage: 'intro' | 'checking' | 'fix' | 'card'
  /** The most a wallet puts on its card in a day, base units. */
  daily_topup: string
  /** Kova's fee on a top-up, in basis points (50 = 0.5%), paid on top. */
  topup_fee_bps?: number
  reason?: string | null
  card?: {
    last_four: string
    /** mastercard, visa or other. */
    brand?: string
    exp_month: string | null
    exp_year: string | null
    frozen: boolean
    /** What the card can spend now, base units; null when the issuer didn't answer. */
    balance: string | null
    name: string
  }
  topups?: { today: string; left: string; treasury: Address }
  activity?: Array<{
    id: string
    kind: 'spend' | 'refund' | 'topup' | 'check'
    amount: string
    status: string
    title: string
    at: string
  }>
}

export interface CardDetails {
  /** mastercard, visa or other. */
  brand?: string
  number: string
  cvv: string
  exp_month: string
  exp_year: string
  name: string
}

export interface CardCheck {
  first_name: string
  last_name: string
  /** YYYY-MM-DD. */
  date_of_birth: string
  email: string
  phone: string
  nationality: string
  gender: 'm' | 'f'
  address: { line1: string; city: string; state: string; postal_code: string; country: string }
  document: {
    type: 'international_passport' | 'national_id' | 'drivers_license'
    number: string
    /** Base64, no data: prefix. */
    file: string
    mime: 'image/jpeg' | 'image/png' | 'application/pdf'
  }
}

export interface Savings {
  live: boolean
  test: boolean
  requested: boolean
  vault: {
    address: Address
    name: string
    version: string
    chain_id: number
    shares: string
    nonce: string
  } | null
  saver: Address | null
  balance: string
  deposited: string
  earned: string
  /** What savings can take from this wallet right now (the vault's cap), or null when it doesn't say. */
  room?: string | null
  /** What can come out right now: all of it, unless the vault is holding some back for a while. */
  withdrawable?: string | null
  /** What the vault paid over about the last week, a year's worth: 0.036 is 3.6%. */
  rate?: { yearly: number; days: number } | null
  /** Whether this wallet can put money in: savings can open to a few wallets first. */
  can_save?: boolean
  /** A partner's vault that hasn't been audited yet: the screen says so plainly. */
  beta?: boolean
  moves: Array<{ kind: 'in' | 'out'; amount: string; tx_hash: string; at: string }>
}

const base = (address: string) => `/api/wallet/${address}/money`

async function read<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null
  if (!response.ok || !body) throw new Error(body?.error ?? 'Kova didn’t answer. Try again.')
  return body
}

export const getUsAccount = (address: string) =>
  fetch(`${base(address)}/us-account`).then(read<UsAccount>)
export const getDollarCard = (address: string) =>
  fetch(`${base(address)}/dollar-card`).then(read<DollarCard>)
export const getSavings = (address: string) => fetch(`${base(address)}/savings`).then(read<Savings>)

type Sign = (message: string) => Promise<Hex>

/** A request only this wallet can make: its signature over the action, fresh to the second. */
async function signed(address: Address, sign: Sign, action: string, detail = '') {
  const signed_at = Math.floor(Date.now() / 1000)
  const signature = await sign(moneyActionMessage(address, action, signed_at, detail))
  return { signed_at, signature }
}

async function post<T>(address: string, path: string, body: unknown): Promise<T> {
  return fetch(`${base(address)}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(read<T>)
}

export async function requestAccess(address: Address, sign: Sign, feature: MoneyFeature) {
  return post<{ requested: true }>(address, 'access-requests', {
    feature,
    ...(await signed(address, sign, 'request-access', feature)),
  })
}

export async function openUsAccount(
  address: Address,
  sign: Sign,
  person: { full_name: string; email: string },
) {
  const proof = await signed(address, sign, 'open-us-account', person.email.trim().toLowerCase())
  return post<UsAccount>(address, 'us-account', { ...person, ...proof })
}

export async function viewUsAccount(address: Address, sign: Sign) {
  return post<UsAccount>(address, 'us-account/view', await signed(address, sign, 'view-us-account'))
}

/** Your details and ID photo, to the card issuer's check. */
export async function startCardCheck(address: Address, sign: Sign, check: CardCheck) {
  return post<DollarCard>(address, 'dollar-card/check', {
    ...check,
    ...(await signed(address, sign, 'dollar-card-check')),
  })
}

export async function setDollarCard(address: Address, sign: Sign, frozen: boolean) {
  return post<DollarCard>(address, 'dollar-card/settings', {
    frozen,
    ...(await signed(address, sign, 'dollar-card-settings', frozen ? 'freeze' : 'unfreeze')),
  })
}

/** The card's number, expiry and CVV, straight from the issuer. Shown, never stored. */
export async function revealDollarCard(address: Address, sign: Sign) {
  return post<CardDetails>(
    address,
    'dollar-card/reveal',
    await signed(address, sign, 'reveal-dollar-card'),
  )
}

/** Kova's fee on a top-up of `amount`, rounded up to the cent, as the API charges it. */
export function topUpFee(amount: bigint, bps: number) {
  const raw = (amount * BigInt(bps) + 9_999n) / 10_000n
  return ((raw + 9_999n) / 10_000n) * 10_000n
}

/** Onto the card: one signed transfer of `amount` plus Kova's fee to Kova; `amount` lands on the card. */
export async function topUpCard(
  network: NetworkId,
  account: LocalAccount,
  treasury: Address,
  amount: bigint,
  bps: number,
) {
  const value = amount + topUpFee(amount, bps)
  const token = getToken(network, 'AUSD')
  const message = {
    from: account.address,
    to: treasury,
    value,
    validAfter: 0n,
    validBefore: BigInt(Math.floor(Date.now() / 1000) + 600),
    nonce: toHex(crypto.getRandomValues(new Uint8Array(32))),
  }
  const signature = await account.signTypedData(
    transferAuthorizationTypedData(token, getNetwork(network).chainId, message),
  )
  return post<{ tx_hash: Hex; card: DollarCard }>(account.address, 'dollar-card/top-up', {
    amount: amount.toString(),
    to: treasury,
    value: value.toString(),
    valid_after: '0',
    valid_before: message.validBefore.toString(),
    nonce: message.nonce,
    signature,
  })
}

/** Into savings: one signed receiveWithAuthorization naming Kova's saver contract. */
export async function saveIn(
  network: NetworkId,
  account: LocalAccount,
  savings: Savings,
  value: bigint,
) {
  if (!savings.saver) throw new Error('Savings aren’t open yet.')
  const token = getToken(network, 'AUSD')
  const message = {
    from: account.address,
    to: savings.saver,
    value,
    validAfter: 0n,
    validBefore: BigInt(Math.floor(Date.now() / 1000) + 600),
    nonce: toHex(crypto.getRandomValues(new Uint8Array(32))),
  }
  const signature = await account.signTypedData(
    receiveAuthorizationTypedData(token, getNetwork(network).chainId, message),
  )
  return post<{ tx_hash: Hex }>(account.address, 'savings/in', {
    value: value.toString(),
    valid_after: '0',
    valid_before: message.validBefore.toString(),
    nonce: message.nonce,
    signature,
  })
}

/** Out of savings: a permit on the vault shares for Kova's saver, which sends them home. */
export async function saveOut(account: LocalAccount, savings: Savings, shares: bigint) {
  if (!savings.saver || !savings.vault) throw new Error('Savings aren’t open yet.')
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)
  const signature = await account.signTypedData(
    vaultPermitTypedData(
      {
        name: savings.vault.name,
        version: savings.vault.version,
        verifyingContract: savings.vault.address,
      },
      savings.vault.chain_id,
      {
        owner: account.address,
        spender: savings.saver,
        value: shares,
        nonce: BigInt(savings.vault.nonce),
        deadline,
      },
    ),
  )
  return post<{ tx_hash: Hex; amount: string }>(account.address, 'savings/out', {
    shares: shares.toString(),
    deadline: deadline.toString(),
    signature,
  })
}
