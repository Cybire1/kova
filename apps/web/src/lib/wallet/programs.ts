import {
  getToken,
  type NetworkId,
  parseAmount,
  permitTypedData,
  repeatPlanTypedData,
  repeatStopTypedData,
  splitRulesTypedData,
  tokenByAddress,
} from '@kova/monad'
import { type Address, getAddress, type Hex, type TypedDataDefinition } from 'viem'
import type { SplitShareOut, Splits, SplitsToSign } from '@/lib/api'

/**
 * Programmable payments on the web (the API's services/programs.ts): repeat payments, which the
 * paying wallet signs once (the plan, and a permit for the most it can ever take), and a shop's
 * splits, which the wallet the shop is paid into signs. Kova relays both and pays the gas.
 */

type Sign = (typedData: TypedDataDefinition) => Promise<Hex>

/** Kova answered that this isn't switched on here yet (its contract isn't set). */
export class SwitchedOff extends Error {}

/** The browser isn't signed in to a shop (the shop's routes need its session). */
export class SignedOut extends Error {}

async function call<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).catch(() => null)
  if (!response) throw new Error('Kova is unreachable. Check your connection and try again.')
  const json = (await response.json().catch(() => ({}))) as { error?: string } & T
  if (!response.ok) {
    const message = json.error ?? 'Kova is unreachable. Nothing moved.'
    if (response.status === 404 && /switched on/i.test(message)) throw new SwitchedOff(message)
    if (response.status === 401) throw new SignedOut(message)
    throw new Error(message)
  }
  return json
}

// ── Repeat payments ─────────────────────────────────────────────────────────────────────────

export interface RepeatPayment {
  object: 'repeat_payment'
  id: string
  plan_id: string
  /** This wallet pays it, or is paid by it. */
  role: 'paying' | 'getting'
  payer: Address
  payee: Address
  label: string | null
  /** Dollars each time, "50.00". */
  amount: string
  /** Seconds between payments. */
  every: number
  times: number
  left: number
  paid: number
  next_at: string | null
  status: 'active' | 'stopped' | 'finished'
  /** Set when the last one didn't go: the paying wallet was short. */
  problem: string | null
  last_paid_at: string | null
  created_at: string
  tx_hash?: string
}

export interface RepeatInput {
  payee: Address
  /** Dollars each time, "50.00". */
  amount: string
  every: number
  /** Unix seconds of the first payment. */
  start: number
  times: number
  label?: string
}

interface RepeatToSign {
  contract: Address
  chain_id: number
  token: Address
  nonce: string
  permit_nonce: string
  permit_value: string
  deadline: string
}

const repeats = (wallet: Address) => `/api/repeats/wallets/${wallet}/repeats`

/**
 * This wallet's plans, both ways. Throws SwitchedOff when Kova isn't running repeat payments
 * here yet (`live: false`, or an older API that answers 404).
 */
export async function listRepeats(wallet: Address): Promise<RepeatPayment[]> {
  const list = await call<{ live?: boolean; data: RepeatPayment[] }>(repeats(wallet))
  if (list.live === false) throw new SwitchedOff('Repeat payments aren’t switched on yet.')
  return list.data ?? []
}

/** Where a start is: signing the plan, signing the most it can take, or Kova starting it on Monad. */
export type RepeatPhase = 'plan' | 'limit' | 'start'

/**
 * Starts a repeat payment: Kova says what to sign, the wallet signs the plan and then a permit
 * for what its plans can take (this one's most, plus what its other plans still can; the value is
 * Kova's, sent back as it came), and Kova relays both to KovaRepeat, which caps each plan itself.
 */
export async function startRepeat(
  network: NetworkId,
  payer: Address,
  input: RepeatInput,
  sign: Sign,
  onPhase?: (phase: RepeatPhase) => void,
): Promise<RepeatPayment> {
  const plan = {
    payee: getAddress(input.payee),
    amount: input.amount,
    every: input.every,
    start: input.start,
    times: input.times,
    ...(input.label?.trim() ? { label: input.label.trim() } : {}),
  }
  const ready = await call<RepeatToSign>(`${repeats(payer)}/prepare`, plan)
  const deadline = BigInt(ready.deadline)
  onPhase?.('plan')
  const signature = await sign(
    repeatPlanTypedData(ready.chain_id, ready.contract, {
      payer,
      payee: plan.payee,
      amount: parseAmount(plan.amount),
      every: plan.every,
      start: plan.start,
      times: plan.times,
      nonce: BigInt(ready.nonce),
      deadline,
    }) as TypedDataDefinition,
  )
  onPhase?.('limit')
  const token = tokenByAddress(network, ready.token) ?? getToken(network, 'AUSD')
  const permit = await sign(
    permitTypedData(token, ready.chain_id, {
      owner: payer,
      spender: ready.contract,
      value: BigInt(ready.permit_value),
      nonce: BigInt(ready.permit_nonce),
      deadline,
    }) as TypedDataDefinition,
  )
  onPhase?.('start')
  return call<RepeatPayment>(repeats(payer), {
    ...plan,
    deadline: ready.deadline,
    signature,
    permit: { value: ready.permit_value, deadline: ready.deadline, signature: permit },
  })
}

/** Stops a plan for good: the paying wallet signs Stop, and no payment goes after it. */
export async function stopRepeat(payer: Address, id: string, sign: Sign): Promise<RepeatPayment> {
  const ready = await call<{
    contract: Address
    chain_id: number
    plan_id: string
    nonce: string
    deadline: string
  }>(`${repeats(payer)}/${id}/stop/prepare`, {})
  const signature = await sign(
    repeatStopTypedData(ready.chain_id, ready.contract, {
      payer,
      id: BigInt(ready.plan_id),
      nonce: BigInt(ready.nonce),
      deadline: BigInt(ready.deadline),
    }) as TypedDataDefinition,
  )
  return call<RepeatPayment>(`${repeats(payer)}/${id}/stop`, {
    deadline: ready.deadline,
    signature,
  })
}

// ── Splits ──────────────────────────────────────────────────────────────────────────────────

export type ShopSplits = Splits & { shop_name: string; demo: boolean }

export const getSplits = () => call<ShopSplits>('/api/splits')

/**
 * Saves a shop's shares (none turns splits off): Kova says what to sign, the wallet the shop is
 * paid into signs the Rules, and Kova relays them to KovaSplits.
 */
export async function saveSplits(shares: SplitShareOut[], sign: Sign): Promise<ShopSplits> {
  const clean = shares.map((s) => ({
    to: getAddress(s.to),
    bps: s.bps,
    ...(s.name?.trim() ? { name: s.name.trim() } : {}),
  }))
  const ready = await call<SplitsToSign>('/api/splits/prepare', { shares: clean })
  const signature = await sign(
    splitRulesTypedData(ready.chain_id, ready.contract, {
      owner: getAddress(ready.owner),
      to: ready.to.map((a) => getAddress(a)),
      bps: ready.bps,
      nonce: BigInt(ready.nonce),
      deadline: BigInt(ready.deadline),
    }) as TypedDataDefinition,
  )
  return call<ShopSplits>('/api/splits', { shares: clean, deadline: ready.deadline, signature })
}
