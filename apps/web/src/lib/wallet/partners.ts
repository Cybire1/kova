import {
  getNetwork,
  getToken,
  type MoneyFeature,
  moneyActionMessage,
  type NetworkId,
  receiveAuthorizationTypedData,
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

export async function issueDollarCard(address: Address, sign: Sign) {
  return post<DollarCard>(address, 'dollar-card', await signed(address, sign, 'issue-dollar-card'))
}

export async function setDollarCard(
  address: Address,
  sign: Sign,
  change: { frozen?: boolean; daily_limit?: string },
) {
  const detail =
    `${change.frozen === undefined ? '' : change.frozen ? 'freeze' : 'unfreeze'}${change.daily_limit ? ` limit ${change.daily_limit}` : ''}`.trim()
  return post<DollarCard>(address, 'dollar-card/settings', {
    ...change,
    ...(await signed(address, sign, 'dollar-card-settings', detail)),
  })
}

export async function revealDollarCard(address: Address, sign: Sign) {
  const origin = window.location.origin
  return post<{ url: string; expires_at: string }>(address, 'dollar-card/reveal', {
    origin,
    ...(await signed(address, sign, 'reveal-dollar-card', origin)),
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
