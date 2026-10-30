import { schema, uuidv7 } from '@kova/db'
import {
  formatAmount,
  kovaRepeatAbi,
  kovaSplitsAbi,
  kovaSplitterAbi,
  REPEAT_MIN_EVERY,
  repeatPlanTypedData,
  repeatStopTypedData,
  type SplitShare,
  splitPermit,
  splitProblem,
  splitRulesTypedData,
} from '@kova/monad'
import { and, desc, eq, gt, isNull, lte, or } from 'drizzle-orm'
import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  type Hex,
  isAddressEqual,
  parseEventLogs,
  recoverTypedDataAddress,
} from 'viem'
import { network, publicClient, settlementToken } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { KovaError } from '../errors.js'
import { RefusedEstimate, sendFromRelayer } from '../relay.js'
import { forgetSplitter } from './splitters.js'

/**
 * Programmable payments (packages/monad programs.ts, apps/card/contracts KovaSplits and KovaRepeat).
 *
 * Splits: a shop shares out every sale as it lands (10% to savings, 5% to a partner, the rest to
 * the shop). Its charges are paid to its KovaSplitter, which the relayer submits each payment
 * through, so the split is in the same transaction; anything that reaches a splitter another way
 * (a Kova Card tap, a direct transfer) is shared out by `releaseSplitters` moments later.
 *
 * Repeat payments: a wallet signs one plan (who, how much, how often, from when, how many times)
 * and a permit for the most it can ever take; `collectDueRepeats` collects each payment when the
 * contract says it's due. Kova never holds the money, and the payer can stop at any time.
 */

type Merchant = typeof schema.merchants.$inferSelect

const SPLITS_MAX_GAS = 1_500_000n
const REPEAT_MAX_GAS = 600_000n
const SIGN_FOR = 600

const contractAt = (value: string | undefined) =>
  value && /^0x[0-9a-fA-F]{40}$/.test(value) ? getAddress(value) : null
export const splitsContract = () => contractAt(config.KOVA_SPLITS)
export const repeatContract = () => contractAt(config.KOVA_REPEAT)

function needSplits(): Address {
  const contract = splitsContract()
  if (!contract) throw new KovaError('not_found', 'Splits aren’t switched on yet.')
  return contract
}

function needRepeat(): Address {
  const contract = repeatContract()
  if (!contract) throw new KovaError('not_found', 'Repeat payments aren’t switched on yet.')
  return contract
}

async function hasCode(address: Address) {
  const code = await publicClient.getCode({ address }).catch(() => undefined)
  return Boolean(code && code !== '0x')
}

// ── Splits ─────────────────────────────────────────────────────────────────────────────────

export async function shopSplits(merchant: Merchant) {
  const contract = splitsContract()
  if (!contract) return { object: 'splits' as const, live: false as const }
  const owner = getAddress(merchant.settlementAddress)
  const splitter = await publicClient.readContract({
    address: contract,
    abi: kovaSplitsAbi,
    functionName: 'splitterOf',
    args: [owner],
  })
  let shares: SplitShare[] = []
  if (await hasCode(splitter)) {
    const [, to, bps] = await publicClient.readContract({
      address: splitter,
      abi: kovaSplitterAbi,
      functionName: 'rules',
    })
    shares = to.map((address, i) => ({
      to: getAddress(address),
      bps: bps[i] ?? 0,
      name: merchant.splitNames?.[address.toLowerCase()] ?? undefined,
    }))
  }
  return {
    object: 'splits' as const,
    live: true as const,
    contract,
    chain_id: network.chainId,
    owner,
    splitter,
    on: Boolean(merchant.splitterAddress) && shares.length > 0,
    shares,
    // Private takings pay a fresh address per sale, so they can't be split.
    private_takings: Boolean(merchant.stealthMetaAddress),
  }
}

function cleanShares(input: SplitShare[], owner: Address): SplitShare[] {
  const shares = input.map((s) => ({
    to: getAddress(s.to),
    bps: s.bps,
    name: s.name?.trim().slice(0, 40) || undefined,
  }))
  const problem = splitProblem(shares, owner)
  if (problem) throw new KovaError('invalid_request', problem)
  return shares
}

/** What the shop's wallet signs to set these shares (its Rules on KovaSplits). */
export async function prepareSplits(merchant: Merchant, input: SplitShare[]) {
  const contract = needSplits()
  const owner = getAddress(merchant.settlementAddress)
  const shares = cleanShares(input, owner)
  const nonce = await publicClient.readContract({
    address: contract,
    abi: kovaSplitsAbi,
    functionName: 'nonces',
    args: [owner],
  })
  return {
    contract,
    chain_id: network.chainId,
    owner,
    to: shares.map((s) => s.to),
    bps: shares.map((s) => s.bps),
    nonce: nonce.toString(),
    deadline: String(Math.floor(Date.now() / 1000) + SIGN_FOR),
  }
}

/** Saves the shares the shop signed: relayed to KovaSplits, then new charges are paid to the splitter. */
export async function saveSplits(
  merchant: Merchant,
  input: SplitShare[],
  deadline: string,
  signature: Hex,
) {
  const contract = needSplits()
  if (merchant.stealthMetaAddress)
    throw new KovaError(
      'invalid_request',
      'Splits can’t work with private takings: turn private takings off first.',
    )
  const owner = getAddress(merchant.settlementAddress)
  const shares = cleanShares(input, owner)
  const to = shares.map((s) => s.to)
  const bps = shares.map((s) => s.bps)
  const nonce = await publicClient.readContract({
    address: contract,
    abi: kovaSplitsAbi,
    functionName: 'nonces',
    args: [owner],
  })
  const signer = await recoverTypedDataAddress({
    ...splitRulesTypedData(network.chainId, contract, {
      owner,
      to,
      bps,
      nonce,
      deadline: BigInt(deadline),
    }),
    signature,
  }).catch(() => null)
  if (!signer || !isAddressEqual(signer, owner))
    throw new KovaError(
      'invalid_request',
      'Splits are set by the wallet the shop is paid into. Sign with that wallet.',
    )
  const receipt = await sendFromRelayer(
    contract,
    encodeFunctionData({
      abi: kovaSplitsAbi,
      functionName: 'setRules',
      args: [owner, to, bps, BigInt(deadline), signature],
    }),
    { maxGas: SPLITS_MAX_GAS },
  )
  if (receipt.status !== 'success')
    throw new KovaError('chain_error', 'The splits didn’t save. Nothing changed.', {
      tx_hash: receipt.transactionHash,
    })
  const splitter = (
    await publicClient.readContract({
      address: contract,
      abi: kovaSplitsAbi,
      functionName: 'splitterOf',
      args: [owner],
    })
  ).toLowerCase()
  const [updated] = await db
    .update(schema.merchants)
    .set({
      // No shares: charges go straight to the wallet again (the splitter stays, empty of rules).
      splitterAddress: shares.length ? splitter : null,
      splitNames: Object.fromEntries(
        shares.flatMap((s) => (s.name ? [[s.to.toLowerCase(), s.name]] : [])),
      ),
      updatedAt: new Date(),
    })
    .where(eq(schema.merchants.id, merchant.id))
    .returning()
  forgetSplitter(splitter)
  return { ...(await shopSplits(updated ?? merchant)), tx_hash: receipt.transactionHash }
}

/**
 * Shares out dollars that reached a splitter without going through it (a Kova Card tap pays the
 * charge's address straight from the holder's wallet; anyone can also send to it). Looks at what
 * was paid in the last quarter of an hour.
 */
export async function releaseSplitters() {
  const contract = splitsContract()
  if (!contract) return
  const recent = await db
    .selectDistinct({
      payTo: schema.paymentIntents.payTo,
      settlement: schema.merchants.settlementAddress,
    })
    .from(schema.paymentIntents)
    .innerJoin(schema.merchants, eq(schema.merchants.id, schema.paymentIntents.merchantId))
    .where(
      and(
        eq(schema.paymentIntents.status, 'paid'),
        gt(schema.paymentIntents.paidAt, new Date(Date.now() - 15 * 60_000)),
      ),
    )
  for (const row of recent) {
    const payTo = getAddress(row.payTo)
    const splitter = await publicClient.readContract({
      address: contract,
      abi: kovaSplitsAbi,
      functionName: 'splitterOf',
      args: [getAddress(row.settlement)],
    })
    if (!isAddressEqual(splitter, payTo)) continue
    const balance = await publicClient.readContract({
      address: settlementToken.address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [splitter],
    })
    if (balance === 0n) continue
    await sendFromRelayer(
      splitter,
      encodeFunctionData({ abi: kovaSplitterAbi, functionName: 'release' }),
      { maxGas: SPLITS_MAX_GAS },
    ).catch((error) => console.error('[splits] release failed; will retry', String(error)))
  }
}

// ── Repeat payments ─────────────────────────────────────────────────────────────────────────

export interface RepeatInput {
  payee: Address
  /** Dollars each time, as typed ("50.00"). */
  amount: bigint
  every: number
  /** Unix seconds of the first payment. */
  start: number
  times: number
  label?: string
}

const MAX_TIMES = 520
const MAX_EACH = 10_000_000_000n // $10,000

function checkPlan(payer: Address, p: RepeatInput) {
  if (isAddressEqual(payer, p.payee))
    throw new KovaError('invalid_request', 'A repeat payment goes to someone else.')
  if (p.amount <= 0n || p.amount > MAX_EACH)
    throw new KovaError('invalid_request', 'Each payment can be from $0.01 to $10,000.')
  if (!Number.isInteger(p.every) || p.every < REPEAT_MIN_EVERY)
    throw new KovaError('invalid_request', 'Payments can be at most hourly.')
  if (!Number.isInteger(p.times) || p.times < 1 || p.times > MAX_TIMES)
    throw new KovaError('invalid_request', `From 1 to ${MAX_TIMES} payments.`)
  const now = Math.floor(Date.now() / 1000)
  if (p.start < now - 600 || p.start > now + 366 * 86_400)
    throw new KovaError('invalid_request', 'Start today or within a year.')
}

const tokenNoncesAbi = [
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

/** What the payer signs: the plan, and a permit for the most it can ever take (amount × times). */
export async function prepareRepeat(payer: Address, input: RepeatInput) {
  const contract = needRepeat()
  checkPlan(payer, input)
  const [nonce, permitNonce] = await Promise.all([
    publicClient.readContract({
      address: contract,
      abi: kovaRepeatAbi,
      functionName: 'nonces',
      args: [payer],
    }),
    publicClient.readContract({
      address: settlementToken.address,
      abi: tokenNoncesAbi,
      functionName: 'nonces',
      args: [payer],
    }),
  ])
  return {
    contract,
    chain_id: network.chainId,
    token: settlementToken.address,
    nonce: nonce.toString(),
    permit_nonce: permitNonce.toString(),
    permit_value: (input.amount * BigInt(input.times)).toString(),
    deadline: String(Math.floor(Date.now() / 1000) + SIGN_FOR),
  }
}

/** Starts the plan the payer signed: relayed to KovaRepeat, the first payment paid if it's due now. */
export async function startRepeat(
  payer: Address,
  input: RepeatInput,
  deadline: string,
  signature: Hex,
  permit: { deadline: string; signature: Hex },
) {
  const contract = needRepeat()
  checkPlan(payer, input)
  const nonce = await publicClient.readContract({
    address: contract,
    abi: kovaRepeatAbi,
    functionName: 'nonces',
    args: [payer],
  })
  const signer = await recoverTypedDataAddress({
    ...repeatPlanTypedData(network.chainId, contract, {
      payer,
      payee: input.payee,
      amount: input.amount,
      every: input.every,
      start: input.start,
      times: input.times,
      nonce,
      deadline: BigInt(deadline),
    }),
    signature,
  }).catch(() => null)
  if (!signer || !isAddressEqual(signer, payer))
    throw new KovaError('invalid_request', 'The plan was not signed by the wallet paying.')
  const cap = input.amount * BigInt(input.times)
  let receipt: Awaited<ReturnType<typeof sendFromRelayer>>
  try {
    receipt = await sendFromRelayer(
      contract,
      encodeFunctionData({
        abi: kovaRepeatAbi,
        functionName: 'start',
        args: [
          payer,
          input.payee,
          input.amount,
          input.every,
          input.start,
          input.times,
          BigInt(deadline),
          signature,
          splitPermit(cap, BigInt(permit.deadline), permit.signature),
        ],
      }),
      { maxGas: REPEAT_MAX_GAS },
    )
  } catch (error) {
    if (error instanceof RefusedEstimate)
      throw new KovaError('invalid_request', 'That plan couldn’t start. Try again.')
    throw error
  }
  if (receipt.status !== 'success')
    throw new KovaError('chain_error', 'The plan didn’t start. No money moved.', {
      tx_hash: receipt.transactionHash,
    })
  const started = parseEventLogs({
    abi: kovaRepeatAbi,
    logs: receipt.logs,
    eventName: 'PlanStarted',
  })[0]
  if (!started) throw new KovaError('chain_error', 'The plan didn’t start. No money moved.')
  const paid = parseEventLogs({ abi: kovaRepeatAbi, logs: receipt.logs, eventName: 'PlanPaid' })[0]
  const plan = await readPlan(started.args.id)
  const [row] = await db
    .insert(schema.repeatPlans)
    .values({
      id: uuidv7(),
      network: network.id,
      planId: started.args.id,
      payer: getAddress(payer),
      payee: getAddress(input.payee),
      label: input.label?.trim().slice(0, 40) || null,
      amount: input.amount,
      every: input.every,
      times: input.times,
      left: plan.left,
      nextAt: new Date(Number(plan.next) * 1000),
      status: plan.left === 0 ? 'finished' : 'active',
      lastPaidAt: paid ? new Date() : null,
      // Due now but not paid: the wallet couldn't cover it yet; the keeper keeps trying.
      lastProblem: !paid && input.start <= Math.floor(Date.now() / 1000) ? 'short' : null,
      startTx: receipt.transactionHash,
    })
    .returning()
  if (!row)
    throw new KovaError('internal', 'The plan started on Monad but wasn’t saved. Contact Kova.')
  return serializeRepeat(row, payer, receipt.transactionHash)
}

async function readPlan(id: bigint) {
  return publicClient.readContract({
    address: needRepeat(),
    abi: kovaRepeatAbi,
    functionName: 'planOf',
    args: [id],
  })
}

type RepeatRow = typeof schema.repeatPlans.$inferSelect

export function serializeRepeat(row: RepeatRow, viewer: Address, txHash?: string) {
  return {
    object: 'repeat_payment' as const,
    id: row.id,
    plan_id: row.planId.toString(),
    role: isAddressEqual(getAddress(row.payer), viewer)
      ? ('paying' as const)
      : ('getting' as const),
    payer: row.payer,
    payee: row.payee,
    label: row.label,
    amount: formatAmount(row.amount),
    every: row.every,
    times: row.times,
    left: row.left,
    paid: row.times - row.left,
    next_at: row.status === 'active' ? row.nextAt.toISOString() : null,
    status: row.status,
    problem: row.lastProblem === 'short' ? 'The wallet didn’t have enough for the last one.' : null,
    last_paid_at: row.lastPaidAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    ...(txHash ? { tx_hash: txHash } : {}),
  }
}

export async function listRepeats(wallet: Address) {
  const rows = await db.query.repeatPlans.findMany({
    where: and(
      eq(schema.repeatPlans.network, network.id),
      or(
        eq(schema.repeatPlans.payer, getAddress(wallet)),
        eq(schema.repeatPlans.payee, getAddress(wallet)),
      ),
    ),
    orderBy: [desc(schema.repeatPlans.createdAt)],
    limit: 100,
  })
  return rows.map((r) => serializeRepeat(r, wallet))
}

async function ownedPlan(payer: Address, id: string) {
  const row = await db.query.repeatPlans.findFirst({
    where: and(eq(schema.repeatPlans.id, id), eq(schema.repeatPlans.payer, getAddress(payer))),
  })
  if (!row) throw new KovaError('not_found', 'No such repeat payment.')
  return row
}

/** What the payer signs to stop a plan. */
export async function prepareStopRepeat(payer: Address, id: string) {
  const contract = needRepeat()
  const row = await ownedPlan(payer, id)
  const nonce = await publicClient.readContract({
    address: contract,
    abi: kovaRepeatAbi,
    functionName: 'nonces',
    args: [payer],
  })
  return {
    contract,
    chain_id: network.chainId,
    plan_id: row.planId.toString(),
    nonce: nonce.toString(),
    deadline: String(Math.floor(Date.now() / 1000) + SIGN_FOR),
  }
}

export async function stopRepeat(payer: Address, id: string, deadline: string, signature: Hex) {
  const contract = needRepeat()
  const row = await ownedPlan(payer, id)
  if (row.status !== 'active') return serializeRepeat(row, payer)
  const nonce = await publicClient.readContract({
    address: contract,
    abi: kovaRepeatAbi,
    functionName: 'nonces',
    args: [payer],
  })
  const signer = await recoverTypedDataAddress({
    ...repeatStopTypedData(network.chainId, contract, {
      payer,
      id: row.planId,
      nonce,
      deadline: BigInt(deadline),
    }),
    signature,
  }).catch(() => null)
  if (!signer || !isAddressEqual(signer, payer))
    throw new KovaError('invalid_request', 'Only the wallet paying can stop it.')
  const receipt = await sendFromRelayer(
    contract,
    encodeFunctionData({
      abi: kovaRepeatAbi,
      functionName: 'stop',
      args: [row.planId, BigInt(deadline), signature],
    }),
    { maxGas: REPEAT_MAX_GAS },
  )
  if (receipt.status !== 'success')
    throw new KovaError('chain_error', 'It didn’t stop. Try again.', {
      tx_hash: receipt.transactionHash,
    })
  const [stopped] = await db
    .update(schema.repeatPlans)
    .set({ status: 'stopped', updatedAt: new Date() })
    .where(eq(schema.repeatPlans.id, row.id))
    .returning()
  return serializeRepeat(stopped ?? row, payer, receipt.transactionHash)
}

/** A payment that didn't go (the wallet was short) is tried again after this long. */
const RETRY_SHORT_MS = 30 * 60_000

/** Collects every repeat payment that's due, as the contract decides; the relayer pays the gas. */
export async function collectDueRepeats() {
  const contract = repeatContract()
  if (!contract) return
  const due = await db.query.repeatPlans.findMany({
    where: and(
      eq(schema.repeatPlans.network, network.id),
      eq(schema.repeatPlans.status, 'active'),
      lte(schema.repeatPlans.nextAt, new Date()),
      or(
        isNull(schema.repeatPlans.lastProblem),
        lte(schema.repeatPlans.updatedAt, new Date(Date.now() - RETRY_SHORT_MS)),
      ),
    ),
    limit: 25,
  })
  for (const row of due) {
    try {
      const isDue = await publicClient.readContract({
        address: contract,
        abi: kovaRepeatAbi,
        functionName: 'due',
        args: [row.planId],
      })
      if (isDue)
        await sendFromRelayer(
          contract,
          encodeFunctionData({ abi: kovaRepeatAbi, functionName: 'collect', args: [row.planId] }),
          { maxGas: REPEAT_MAX_GAS },
        )
      const plan = await readPlan(row.planId)
      await db
        .update(schema.repeatPlans)
        .set({
          left: plan.left,
          nextAt: new Date(Number(plan.next) * 1000),
          status: plan.stopped ? 'stopped' : plan.left === 0 ? 'finished' : 'active',
          lastProblem: null,
          ...(isDue ? { lastPaidAt: new Date() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.repeatPlans.id, row.id))
    } catch (error) {
      // Almost always the payer's wallet being short (the estimate refuses the transfer): try
      // again later, and say so on the plan.
      await db
        .update(schema.repeatPlans)
        .set({ lastProblem: 'short', updatedAt: new Date() })
        .where(eq(schema.repeatPlans.id, row.id))
      if (!(error instanceof RefusedEstimate))
        console.error('[repeat] collect failed', row.planId, String(error))
    }
  }
}
