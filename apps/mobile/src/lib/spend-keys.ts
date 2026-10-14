import {
  claimTypedData,
  linkTypedData,
  paymentTypedData,
  permitTypedData,
  spendKeyFromSignature,
  spendKeyMessage,
  unlinkTypedData,
  updateTypedData,
} from '@kova/monad'
import { type Address, getAddress, type Hex, maxUint256, type TypedDataDefinition } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { apiUrl } from './config'

/**
 * Spending keys in the app: allowances, team budgets and AI agents (the API's services/spend-keys.ts).
 * The owner switches a key on, freezes and removes it by signing with their wallet; an allowance's
 * own key is made from a signature of the recipient's wallet, so it is never stored anywhere and
 * the same passkey makes it again on any device.
 */

export type KeyKind = 'allowance' | 'team' | 'agent'

export interface SpendKey {
  id: string
  kind: KeyKind
  name: string
  owner: Address
  owner_name: string | null
  holder: Address | null
  holder_name: string | null
  key_address: Address | null
  status: 'invited' | 'accepted' | 'active' | 'frozen' | 'removed'
  frozen: boolean
  limit: string
  period: 'day' | 'week'
  daily_limit: string
  spent: string
  spent_today: string
  left: string
  ends_at: string
  rules: { per_payment: string; ask_above: string; payees: 'anyone' | Address[] } | null
  link_tx: string | null
  last_used_at: string | null
  created_at: string
}

export interface KeyPayment {
  id: string
  key: string
  key_name: string | null
  kind: string
  to: Address
  amount: string
  description: string | null
  status: string
  reason: string | null
  tx_hash: string | null
  created_at: string
  approve_message?: string
  decline_message?: string
}

export interface KeysList {
  data: SpendKey[]
  received: SpendKey[]
  approvals: KeyPayment[]
}

export interface KeyInvite {
  id: string
  kind: KeyKind
  name: string
  owner: Address
  owner_name: string | null
  limit: string
  period: 'day' | 'week'
  ends_at: string
  status: string
  holder: Address | null
  contract: Address
  chain_id: number
}

type Sign = (typedData: TypedDataDefinition) => Promise<Hex>
type SignMessage = (message: string) => Promise<Hex>

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const json = (await response.json().catch(() => ({}))) as { error?: { message?: string } } & T
  if (!response.ok) throw new Error(json.error?.message ?? 'Kova is unreachable. Nothing moved.')
  return json
}

export const listKeys = (wallet: Address) => api<KeysList>(`wallets/${wallet}/keys`)

export const keyPayments = (wallet: Address) =>
  api<{ data: KeyPayment[] }>(`wallets/${wallet}/key-payments`)

export function inviteSomeone(
  owner: Address,
  input: {
    kind: 'allowance' | 'team'
    name: string
    limit: string
    period: 'day' | 'week'
    days: number
    ownerName?: string
  },
) {
  return api<SpendKey & { code: string; path: string }>(`wallets/${owner}/key-invites`, {
    kind: input.kind,
    name: input.name,
    limit: input.limit,
    period: input.period,
    days: input.days,
    owner_name: input.ownerName,
  })
}

export function newAgent(
  owner: Address,
  input: {
    name: string
    limit: string
    period: 'day' | 'week'
    perPayment: string
    askAbove: string
    days: number
  },
) {
  return api<SpendKey>(`wallets/${owner}/agents`, {
    name: input.name,
    limit: input.limit,
    period: input.period,
    per_payment: input.perPayment,
    ask_above: input.askAbove,
    payees: 'anyone',
    days: input.days,
  })
}

interface LinkPlan {
  contract: Address
  chain_id: number
  holder: Address
  card: Address
  daily_limit: string
  nonce: string
  deadline: number
  permit: {
    needed: boolean
    nonce: string
    value: string
    token: { address: Address; domain: { name: string; version: string } }
  }
}

/**
 * Switches a key on: the owner's wallet signs KovaCard's Link (the key, its daily cap) and, the
 * first time, a permit that lets the contract draw on the wallet for payments both the key and
 * Kova sign. An agent's key comes back with its token, shown once.
 */
export async function switchOn(
  owner: Address,
  key: SpendKey,
  sign: Sign,
): Promise<SpendKey & { token: string | null }> {
  const plan = await api<LinkPlan>(`wallets/${owner}/keys/${key.id}/link`)
  const deadline = BigInt(plan.deadline)
  const holderSignature = await sign(
    linkTypedData(plan.chain_id, plan.contract, {
      holder: getAddress(plan.holder),
      card: getAddress(plan.card),
      dailyLimit: BigInt(plan.daily_limit),
      nonce: BigInt(plan.nonce),
      deadline,
    }) as TypedDataDefinition,
  )
  const permit = plan.permit.needed
    ? await sign(
        permitTypedData(plan.permit.token, plan.chain_id, {
          owner: getAddress(plan.holder),
          spender: plan.contract,
          value: maxUint256,
          nonce: BigInt(plan.permit.nonce),
          deadline,
        }) as TypedDataDefinition,
      )
    : null
  return api(`wallets/${owner}/keys/${key.id}/activate`, {
    holder_signature: holderSignature,
    permit: permit
      ? { value: maxUint256.toString(), deadline: plan.deadline, signature: permit }
      : null,
  })
}

interface UpdatePlan {
  contract: Address
  chain_id: number
  holder: Address
  card: Address
  daily_limit: string
  frozen: boolean
  nonce: string
  deadline: number
}

/** Freezes a key (Kova stops cosigning at once, Monad follows) or unfreezes it. */
export async function freeze(
  owner: Address,
  key: SpendKey,
  frozen: boolean,
  sign: Sign,
): Promise<SpendKey> {
  const plan = await api<UpdatePlan>(`wallets/${owner}/keys/${key.id}/freeze?frozen=${frozen}`)
  const signature = await sign(
    updateTypedData(plan.chain_id, plan.contract, {
      holder: getAddress(plan.holder),
      card: getAddress(plan.card),
      dailyLimit: BigInt(plan.daily_limit),
      frozen,
      nonce: BigInt(plan.nonce),
      deadline: BigInt(plan.deadline),
    }) as TypedDataDefinition,
  )
  return api(`wallets/${owner}/keys/${key.id}/freeze`, {
    frozen,
    deadline: plan.deadline,
    holder_signature: signature,
  })
}

type RemovePlan =
  | {
      on_chain: true
      contract: Address
      chain_id: number
      holder: Address
      card: Address
      nonce: string
      deadline: number
    }
  | { on_chain: false; message: string }

/** Removes a key for good: unlinked on Monad if it was on, or simply cancelled if it wasn't. */
export async function removeKey(
  owner: Address,
  key: SpendKey,
  sign: Sign,
  signMessage: SignMessage,
): Promise<void> {
  const plan = await api<RemovePlan>(`wallets/${owner}/keys/${key.id}/remove`)
  if (plan.on_chain) {
    const signature = await sign(
      unlinkTypedData(plan.chain_id, plan.contract, {
        holder: getAddress(plan.holder),
        card: getAddress(plan.card),
        nonce: BigInt(plan.nonce),
        deadline: BigInt(plan.deadline),
      }) as TypedDataDefinition,
    )
    await api(`wallets/${owner}/keys/${key.id}/remove`, { deadline: plan.deadline, signature })
    return
  }
  await api(`wallets/${owner}/keys/${key.id}/remove`, {
    signature: await signMessage(plan.message),
  })
}

/** The owner's yes or no to an agent's payment, signed exactly as Kova shows it. */
export async function answer(
  owner: Address,
  payment: KeyPayment,
  decision: 'approve' | 'decline',
  signMessage: SignMessage,
) {
  const message = decision === 'approve' ? payment.approve_message : payment.decline_message
  if (!message) throw new Error('This payment can’t be answered here.')
  return api<KeyPayment>(`wallets/${owner}/approvals/${payment.id}`, {
    decision,
    signature: await signMessage(message),
  })
}

export const inviteInfo = (code: string) =>
  api<KeyInvite>(`key-invites/${encodeURIComponent(code)}`)

/** The key an allowance or budget spends with, made from the holder's wallet signature. */
async function deviceKey(
  input: { keyId: string; owner: Address; holder: Address },
  signMessage: SignMessage,
) {
  const signature = await signMessage(spendKeyMessage(input))
  return privateKeyToAccount(spendKeyFromSignature(signature))
}

/**
 * Accepts an invite: this wallet makes the key (from its own signature) and the key signs that it
 * may be linked to the owner's wallet. It spends nothing until the owner switches it on.
 */
export async function accept(
  code: string,
  holder: Address,
  holderName: string,
  signMessage: SignMessage,
) {
  const invite = await inviteInfo(code)
  const key = await deviceKey({ keyId: invite.id, owner: invite.owner, holder }, signMessage)
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600)
  const claim = await key.signTypedData(
    claimTypedData(invite.chain_id, invite.contract, {
      card: key.address,
      holder: invite.owner,
      deadline,
    }) as never,
  )
  return api<SpendKey>(`key-invites/${encodeURIComponent(code)}/accept`, {
    holder,
    holder_name: holderName || undefined,
    key: key.address,
    claim_signature: claim,
    claim_deadline: Number(deadline),
  })
}

interface Prepared extends KeyPayment {
  typed_data: {
    domain: { chainId: number; verifyingContract: Address }
    message: { card: Address; to: Address; amount: string; memo: Hex; deadline: string }
  }
}

/** Spends from an allowance or budget: Kova checks it may, the key signs, Kova cosigns and pays. */
export async function spendFrom(
  key: SpendKey,
  holder: Address,
  input: { to?: Address; amount?: string; charge?: string; note?: string },
  signMessage: SignMessage,
): Promise<KeyPayment> {
  const prepared = await api<Prepared>(`keys/${key.id}/payments`, { holder, ...input })
  const account = await deviceKey({ keyId: key.id, owner: key.owner, holder }, signMessage)
  const m = prepared.typed_data.message
  const signature = await account.signTypedData(
    paymentTypedData(
      prepared.typed_data.domain.chainId,
      prepared.typed_data.domain.verifyingContract,
      {
        card: getAddress(m.card),
        to: getAddress(m.to),
        amount: BigInt(m.amount),
        memo: m.memo,
        deadline: BigInt(m.deadline),
      },
    ) as never,
  )
  return api<KeyPayment>(`key-payments/${prepared.id}/complete`, { signature })
}

/** "$24 left this week", "$5 left today". */
export function leftLine(key: SpendKey): string {
  return `$${key.left} left ${key.period === 'week' ? 'this week' : 'today'}`
}

export function limitLine(key: SpendKey): string {
  return `$${key.limit.replace(/\.00$/, '')} a ${key.period}`
}
