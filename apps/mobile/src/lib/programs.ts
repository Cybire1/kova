import {
  parseAmount,
  permitTypedData,
  repeatPlanTypedData,
  repeatStopTypedData,
  splitRulesTypedData,
} from '@kova/monad'
import { type Address, getAddress, type Hex, type TypedDataDefinition } from 'viem'
import {
  prepareRepeat,
  prepareSplits,
  prepareStopRepeat,
  type RepeatPayment,
  type RepeatPlanInput,
  repeatsOf,
  type ShopSplits,
  type SplitShareOut,
  saveSplits,
  startRepeat,
  stopRepeat,
} from './api'
import { settlementToken } from './config'

/**
 * Programmable payments in the app (the API's services/programs.ts): repeat payments a wallet
 * signs once, and the splits a shop's wallet signs for every sale. Kova relays each signature
 * and pays the gas; nothing here moves money by itself.
 */

type Sign = (typedData: TypedDataDefinition) => Promise<Hex>

/**
 * Starts a repeat payment. The wallet signs two things: the plan (who, how much, how often, from
 * when, how many times at most) and a permit for exactly the most it can ever take.
 */
export async function startRepeatPlan(
  payer: Address,
  plan: RepeatPlanInput,
  sign: Sign,
): Promise<RepeatPayment> {
  const toSign = await prepareRepeat(payer, plan)
  const contract = getAddress(toSign.contract)
  const deadline = BigInt(toSign.deadline)
  const signature = await sign(
    repeatPlanTypedData(toSign.chain_id, contract, {
      payer: getAddress(payer),
      payee: getAddress(plan.payee),
      amount: parseAmount(plan.amount),
      every: plan.every,
      start: plan.start,
      times: plan.times,
      nonce: BigInt(toSign.nonce),
      deadline,
    }) as TypedDataDefinition,
  )
  const permit = await sign(
    permitTypedData(settlementToken, toSign.chain_id, {
      owner: getAddress(payer),
      spender: contract,
      value: BigInt(toSign.permit_value),
      nonce: BigInt(toSign.permit_nonce),
      deadline,
    }) as TypedDataDefinition,
  )
  return startRepeat(payer, {
    ...plan,
    deadline: toSign.deadline,
    signature,
    permit: { value: toSign.permit_value, deadline: toSign.deadline, signature: permit },
  })
}

/** Stops a plan for good: one signature, and no more payments go out. */
export async function stopRepeatPlan(
  payer: Address,
  repeat: RepeatPayment,
  sign: Sign,
): Promise<RepeatPayment> {
  const toSign = await prepareStopRepeat(payer, repeat.id)
  const signature = await sign(
    repeatStopTypedData(toSign.chain_id, getAddress(toSign.contract), {
      payer: getAddress(payer),
      id: BigInt(toSign.plan_id),
      nonce: BigInt(toSign.nonce),
      deadline: BigInt(toSign.deadline),
    }) as TypedDataDefinition,
  )
  return stopRepeat(payer, repeat.id, { deadline: toSign.deadline, signature })
}

/** Whether new repeat payments can start: Kova says so with the wallet's list. Null when it can't be reached. */
export async function repeatsSwitchedOn(payer: Address): Promise<boolean | null> {
  try {
    const list = await repeatsOf(payer)
    // An older API that doesn't say: assume on, and let a 404 on prepare say otherwise.
    return list.live ?? true
  } catch {
    return null
  }
}

/** Saves a shop's shares: its wallet signs the rules, Kova sets them on Monad. No shares turns splits off. */
export async function saveShopSplits(
  owner: Address,
  shares: SplitShareOut[],
  sign: Sign,
): Promise<ShopSplits> {
  const toSign = await prepareSplits(shares)
  if (getAddress(toSign.owner) !== getAddress(owner))
    throw new Error('Only the wallet your shop is paid into can sign its splits.')
  const signature = await sign(
    splitRulesTypedData(toSign.chain_id, getAddress(toSign.contract), {
      owner: getAddress(toSign.owner),
      to: toSign.to.map((a) => getAddress(a)),
      bps: toSign.bps,
      nonce: BigInt(toSign.nonce),
      deadline: BigInt(toSign.deadline),
    }) as TypedDataDefinition,
  )
  return saveSplits(shares, toSign.deadline, signature)
}

/** "10%", "12.5%", "0.25%" from basis points. */
export function percent(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`
}

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
