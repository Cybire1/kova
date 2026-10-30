import type { Address } from 'viem'

/**
 * Programmable payments on Monad: what wallets sign, and the contract calls Kova relays.
 *
 * Splits (KovaSplits / KovaSplitter): a shop's sales are shared out as they land, by rules the
 * shop signs: up to five shares, in basis points (1000 is 10%), the rest to the shop.
 *
 * Repeat payments (KovaRepeat): the payer signs one Plan (who, how much, how often, from when, how
 * many times at most) and a permit for the most it can ever take; each payment is collected when
 * due, never early, never more, and the payer can stop it at any time.
 */

export const MAX_SPLIT_SHARES = 5
/** Basis points in a whole: 10_000 is 100%. */
export const SPLIT_WHOLE = 10_000

export interface SplitShare {
  to: Address
  /** Basis points: 1000 is 10%. */
  bps: number
  /** What the shop calls it ("Savings", "Ada"); kept by Kova, not on Monad. */
  name?: string
}

/** What each share of `amount` (base units) comes to, and what the shop keeps, as the splitter rounds. */
export function splitAmount(amount: bigint, shares: { bps: number }[]) {
  const parts = shares.map((s) => (amount * BigInt(s.bps)) / BigInt(SPLIT_WHOLE))
  const sent = parts.reduce((a, b) => a + b, 0n)
  return { parts, kept: amount - sent }
}

/** Plain-words reasons a set of shares can't be saved, or null when it can. */
export function splitProblem(shares: SplitShare[], owner: Address): string | null {
  if (shares.length > MAX_SPLIT_SHARES) return `At most ${MAX_SPLIT_SHARES} shares.`
  const total = shares.reduce((a, s) => a + s.bps, 0)
  if (total > SPLIT_WHOLE) return 'The shares add up to more than everything.'
  const seen = new Set<string>()
  for (const s of shares) {
    if (!Number.isInteger(s.bps) || s.bps <= 0) return 'Every share needs a percentage.'
    const key = s.to.toLowerCase()
    if (key === owner.toLowerCase()) return 'The rest already goes to you; no need for a share.'
    if (seen.has(key)) return 'Each person or wallet can have one share.'
    seen.add(key)
  }
  return null
}

const splitsDomain = (chainId: number, contract: Address) => ({
  name: 'Kova Splits',
  version: '1',
  chainId,
  verifyingContract: contract,
})

/** What the shop's wallet signs to set its shares. */
export function splitRulesTypedData(
  chainId: number,
  contract: Address,
  message: { owner: Address; to: Address[]; bps: number[]; nonce: bigint; deadline: bigint },
) {
  return {
    domain: splitsDomain(chainId, contract),
    types: {
      Rules: [
        { name: 'owner', type: 'address' },
        { name: 'to', type: 'address[]' },
        { name: 'bps', type: 'uint16[]' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Rules' as const,
    message,
  }
}

export const kovaSplitsAbi = [
  {
    type: 'function',
    name: 'splitterOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'setRules',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'to', type: 'address[]' },
      { name: 'bps', type: 'uint16[]' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: 'splitter', type: 'address' }],
  },
] as const

export const kovaSplitterAbi = [
  {
    type: 'function',
    name: 'rules',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'shop', type: 'address' },
      { name: 'to', type: 'address[]' },
      { name: 'bps', type: 'uint16[]' },
    ],
  },
  {
    type: 'function',
    name: 'collect',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
  { type: 'function', name: 'release', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  {
    type: 'event',
    name: 'SharePaid',
    inputs: [
      { name: 'to', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Released',
    inputs: [
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'kept', type: 'uint256', indexed: false },
    ],
  },
] as const

// ── Repeat payments ─────────────────────────────────────────────────────────────────────────

/** The shortest gap the contract allows between payments. */
export const REPEAT_MIN_EVERY = 3600
export const DAY = 86_400

/** How often a plan pays, as people choose it. */
export const REPEAT_EVERY = [
  { id: 'week', seconds: 7 * DAY, label: 'Every week' },
  { id: 'fortnight', seconds: 14 * DAY, label: 'Every 2 weeks' },
  { id: 'month', seconds: 30 * DAY, label: 'Every 30 days' },
] as const

export function repeatEveryLabel(seconds: number): string {
  const known = REPEAT_EVERY.find((e) => e.seconds === seconds)
  if (known) return known.label
  const days = seconds / DAY
  return Number.isInteger(days) ? `Every ${days} days` : `Every ${Math.round(seconds / 3600)} hours`
}

const repeatDomain = (chainId: number, contract: Address) => ({
  name: 'Kova Repeat',
  version: '1',
  chainId,
  verifyingContract: contract,
})

export type RepeatPlanMessage = {
  payer: Address
  payee: Address
  /** Base units each time. */
  amount: bigint
  /** Seconds between payments. */
  every: number
  /** Unix seconds of the first payment. */
  start: number
  /** At most this many payments. */
  times: number
  nonce: bigint
  deadline: bigint
}

/** What the payer signs to start a plan. */
export function repeatPlanTypedData(
  chainId: number,
  contract: Address,
  message: RepeatPlanMessage,
) {
  return {
    domain: repeatDomain(chainId, contract),
    types: {
      Plan: [
        { name: 'payer', type: 'address' },
        { name: 'payee', type: 'address' },
        { name: 'amount', type: 'uint96' },
        { name: 'every', type: 'uint32' },
        { name: 'start', type: 'uint40' },
        { name: 'times', type: 'uint32' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Plan' as const,
    message,
  }
}

/** What the payer signs to stop a plan. */
export function repeatStopTypedData(
  chainId: number,
  contract: Address,
  message: { payer: Address; id: bigint; nonce: bigint; deadline: bigint },
) {
  return {
    domain: repeatDomain(chainId, contract),
    types: {
      Stop: [
        { name: 'payer', type: 'address' },
        { name: 'id', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Stop' as const,
    message,
  }
}

const planTuple = {
  type: 'tuple',
  components: [
    { name: 'payer', type: 'address' },
    { name: 'payee', type: 'address' },
    { name: 'amount', type: 'uint96' },
    { name: 'every', type: 'uint32' },
    { name: 'next', type: 'uint40' },
    { name: 'left', type: 'uint32' },
    { name: 'stopped', type: 'bool' },
  ],
} as const

export const kovaRepeatAbi = [
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: 'payer', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'start',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'payer', type: 'address' },
      { name: 'payee', type: 'address' },
      { name: 'amount', type: 'uint96' },
      { name: 'every', type: 'uint32' },
      { name: 'startAt', type: 'uint40' },
      { name: 'times', type: 'uint32' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
      {
        name: 'permit',
        type: 'tuple',
        components: [
          { name: 'value', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'v', type: 'uint8' },
          { name: 'r', type: 'bytes32' },
          { name: 's', type: 'bytes32' },
        ],
      },
    ],
    outputs: [{ name: 'id', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'collect',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'stop',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'planOf',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ ...planTuple, name: '' }],
  },
  {
    type: 'function',
    name: 'due',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'event',
    name: 'PlanStarted',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'payer', type: 'address', indexed: true },
      { name: 'payee', type: 'address', indexed: true },
      { name: 'amount', type: 'uint96', indexed: false },
      { name: 'every', type: 'uint32', indexed: false },
      { name: 'start', type: 'uint40', indexed: false },
      { name: 'times', type: 'uint32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PlanPaid',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'payer', type: 'address', indexed: true },
      { name: 'payee', type: 'address', indexed: true },
      { name: 'amount', type: 'uint96', indexed: false },
      { name: 'left', type: 'uint32', indexed: false },
    ],
  },
] as const
