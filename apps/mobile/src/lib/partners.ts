import {
  getToken,
  type MoneyFeature,
  moneyActionMessage,
  receiveAuthorizationTypedData,
  vaultPermitTypedData,
} from '@kova/monad'
import type { Address, Hex, TypedDataDefinition } from 'viem'
import { apiUrl, network, networkId } from './config'

/**
 * Money in (a US account number), the dollar card and savings: the parts of Kova that run through
 * partners. Reads are plain; every change carries the wallet's own signature (apps/api
 * src/routes/money.ts checks it).
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
  card: {
    last_four: string
    exp_month: string | null
    exp_year: string | null
    frozen: boolean
    daily_limit: string
  } | null
  transactions: Array<{ id: string; amount: string; status: string; merchant: string; at: string }>
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

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    `${apiUrl}/v1/wallets/${path}`,
    body === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
  )
  const json = (await response.json().catch(() => ({}))) as { error?: { message?: string } }
  if (!response.ok)
    throw new Error(json.error?.message ?? `Kova is unreachable (${response.status})`)
  return json as T
}

export const getUsAccount = (address: Address) => call<UsAccount>(`${address}/us-account`)
export const getDollarCard = (address: Address) => call<DollarCard>(`${address}/dollar-card`)
export const getSavings = (address: Address) => call<Savings>(`${address}/savings`)

type Sign = (message: string) => Promise<Hex>
type SignTyped = (typedData: TypedDataDefinition) => Promise<Hex>

async function signed(address: Address, sign: Sign, action: string, detail = '') {
  const signed_at = Math.floor(Date.now() / 1000)
  return {
    signed_at,
    signature: await sign(moneyActionMessage(address, action, signed_at, detail)),
  }
}

export async function requestAccess(address: Address, sign: Sign, feature: MoneyFeature) {
  return call<{ requested: true }>(`${address}/access-requests`, {
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
  return call<UsAccount>(`${address}/us-account`, { ...person, ...proof })
}

export async function viewUsAccount(address: Address, sign: Sign) {
  return call<UsAccount>(
    `${address}/us-account/view`,
    await signed(address, sign, 'view-us-account'),
  )
}

export async function issueDollarCard(address: Address, sign: Sign) {
  return call<DollarCard>(
    `${address}/dollar-card`,
    await signed(address, sign, 'issue-dollar-card'),
  )
}

export async function setDollarCard(
  address: Address,
  sign: Sign,
  change: { frozen?: boolean; daily_limit?: string },
) {
  const detail =
    `${change.frozen === undefined ? '' : change.frozen ? 'freeze' : 'unfreeze'}${change.daily_limit ? ` limit ${change.daily_limit}` : ''}`.trim()
  return call<DollarCard>(`${address}/dollar-card/settings`, {
    ...change,
    ...(await signed(address, sign, 'dollar-card-settings', detail)),
  })
}

/** The issuer's own page with the card's number, opened in the in-app browser. */
export async function revealDollarCard(address: Address, sign: Sign, origin: string) {
  return call<{ url: string; expires_at: string }>(`${address}/dollar-card/reveal`, {
    origin,
    ...(await signed(address, sign, 'reveal-dollar-card', origin)),
  })
}

const randomNonce = (): Hex =>
  `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('')}`

/** Into savings: one signed receiveWithAuthorization naming Kova's saver contract. */
export async function saveIn(
  address: Address,
  signTyped: SignTyped,
  savings: Savings,
  value: bigint,
) {
  if (!savings.saver) throw new Error('Savings aren’t open yet.')
  const token = getToken(networkId, 'AUSD')
  const message = {
    from: address,
    to: savings.saver,
    value,
    validAfter: 0n,
    validBefore: BigInt(Math.floor(Date.now() / 1000) + 600),
    nonce: randomNonce(),
  }
  const signature = await signTyped(
    receiveAuthorizationTypedData(
      token,
      network.chainId,
      message,
    ) as unknown as TypedDataDefinition,
  )
  return call<{ tx_hash: Hex }>(`${address}/savings/in`, {
    value: value.toString(),
    valid_after: '0',
    valid_before: message.validBefore.toString(),
    nonce: message.nonce,
    signature,
  })
}

/** Out of savings: a permit on the vault shares for Kova's saver, which sends them home. */
export async function saveOut(
  address: Address,
  signTyped: SignTyped,
  savings: Savings,
  shares: bigint,
) {
  if (!savings.saver || !savings.vault) throw new Error('Savings aren’t open yet.')
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)
  const signature = await signTyped(
    vaultPermitTypedData(
      {
        name: savings.vault.name,
        version: savings.vault.version,
        verifyingContract: savings.vault.address,
      },
      savings.vault.chain_id,
      {
        owner: address,
        spender: savings.saver,
        value: shares,
        nonce: BigInt(savings.vault.nonce),
        deadline,
      },
    ) as unknown as TypedDataDefinition,
  )
  return call<{ tx_hash: Hex; amount: string }>(`${address}/savings/out`, {
    shares: shares.toString(),
    deadline: deadline.toString(),
    signature,
  })
}
