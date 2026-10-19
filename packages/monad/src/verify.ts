import {
  type Address,
  decodeEventLog,
  type Hex,
  isAddressEqual,
  type Log,
  type TransactionReceipt,
} from 'viem'
import { eip3009Abi } from './authorization.js'
import { decodeCardPayments } from './card.js'

export interface AuthorizedTransfer {
  authorizer: Address
  nonce: Hex
  to: Address
  value: bigint
  /** The AuthorizationUsed log. */
  logIndex: number
  /** The Transfer log it authorized. */
  transferLogIndex: number
}

/**
 * Pairs each AuthorizationUsed in a receipt with the Transfer it authorized: same token, same
 * sender, and the closest such Transfer in log order, each Transfer used once. The token emits
 * the two side by side, so a batch of several authorizations from one payer still pairs up
 * exactly. Anything else in the receipt is ignored.
 */
export function decodeAuthorizedTransfers(
  logs: readonly Log[],
  token: Address,
): AuthorizedTransfer[] {
  const used: { authorizer: Address; nonce: Hex; logIndex: number }[] = []
  const transfers: { from: Address; to: Address; value: bigint; logIndex: number }[] = []
  logs.forEach((log, position) => {
    if (!isAddressEqual(log.address, token)) return
    const logIndex = log.logIndex ?? position
    try {
      const event = decodeEventLog({ abi: eip3009Abi, data: log.data, topics: log.topics })
      if (event.eventName === 'AuthorizationUsed') used.push({ ...event.args, logIndex })
      else if (event.eventName === 'Transfer') transfers.push({ ...event.args, logIndex })
    } catch {
      // Not an event this token's ABI knows.
    }
  })
  const taken = new Set<number>()
  return used.flatMap((u) => {
    let best: (typeof transfers)[number] | undefined
    for (const t of transfers) {
      if (taken.has(t.logIndex) || !isAddressEqual(t.from, u.authorizer)) continue
      if (!best || Math.abs(t.logIndex - u.logIndex) < Math.abs(best.logIndex - u.logIndex))
        best = t
    }
    if (!best) return []
    taken.add(best.logIndex)
    return [
      {
        authorizer: u.authorizer,
        nonce: u.nonce,
        to: best.to,
        value: best.value,
        logIndex: u.logIndex,
        transferLogIndex: best.logIndex,
      },
    ]
  })
}

/**
 * Pairs each Kova Card payment with the Transfer it made: the KovaCard contract draws `amount`
 * from the holder's wallet to the shop and records the charge's memo beside it. Reported in the
 * same shape as an authorization, the holder as the authorizer and the memo as the nonce, so a
 * card tap settles and indexes exactly like any other Kova payment.
 */
export function decodeCardTransfers(
  logs: readonly Log[],
  token: Address,
  cardContract: Address | null | undefined,
): AuthorizedTransfer[] {
  const payments = decodeCardPayments(logs, cardContract ?? null)
  if (payments.length === 0) return []
  const transfers: { from: Address; to: Address; value: bigint; logIndex: number }[] = []
  logs.forEach((log, position) => {
    if (!isAddressEqual(log.address, token)) return
    try {
      const event = decodeEventLog({ abi: eip3009Abi, data: log.data, topics: log.topics })
      if (event.eventName === 'Transfer')
        transfers.push({ ...event.args, logIndex: log.logIndex ?? position })
    } catch {
      // Not a token event.
    }
  })
  const taken = new Set<number>()
  return payments.flatMap((p) => {
    const match = transfers
      .filter(
        (t) =>
          !taken.has(t.logIndex) &&
          isAddressEqual(t.from, p.holder) &&
          isAddressEqual(t.to, p.to) &&
          t.value === p.amount,
      )
      .sort((a, b) => Math.abs(a.logIndex - p.logIndex) - Math.abs(b.logIndex - p.logIndex))[0]
    if (!match) return []
    taken.add(match.logIndex)
    return [
      {
        authorizer: p.holder,
        nonce: p.memo,
        to: p.to,
        value: p.amount,
        logIndex: p.logIndex,
        transferLogIndex: match.logIndex,
      },
    ]
  })
}

export interface TokenTransfer {
  from: Address
  to: Address
  value: bigint
  logIndex: number
  /** The authorization nonce that moved it (a Kova memo for charges and refunds), if it was authorized by signature. */
  nonce: Hex | null
}

/**
 * Every Transfer of `token` in these logs, each with the nonce of the authorization that moved it.
 *
 * Decoding checks the event it actually got: viem's decodeEventLog picks the event by the log's
 * own signature and does not enforce an eventName, so an AuthorizationUsed log "decodes" too,
 * with no from or to.
 */
export function decodeTokenTransfers(
  logs: readonly Log[],
  token: Address,
  cardContract?: Address | null,
): TokenTransfer[] {
  const authorized = [
    ...decodeAuthorizedTransfers(logs, token),
    ...decodeCardTransfers(logs, token, cardContract),
  ]
  const transfers: TokenTransfer[] = []
  logs.forEach((log, position) => {
    if (!isAddressEqual(log.address, token)) return
    let event: ReturnType<typeof decodeEventLog<typeof eip3009Abi>>
    try {
      event = decodeEventLog({ abi: eip3009Abi, data: log.data, topics: log.topics })
    } catch {
      return
    }
    if (event.eventName !== 'Transfer') return
    const logIndex = log.logIndex ?? position
    transfers.push({
      from: event.args.from,
      to: event.args.to,
      value: event.args.value,
      logIndex,
      nonce: authorized.find((a) => a.transferLogIndex === logIndex)?.nonce ?? null,
    })
  })
  return transfers
}

export type PaymentStatus = 'paid' | 'pending' | 'failed' | 'unmatched' | 'memo_mismatch'

export interface ExpectedPayment {
  token: Address
  /** The merchant's settlement address. */
  payTo: Address
  amount: bigint
  /** The charge's Kova memo, which the authorization's nonce must equal. */
  memo: Hex
  /** The KovaCard contract, whose card payments count too. */
  cardContract?: Address | null
}

export interface PaymentVerdict {
  status: PaymentStatus
  payer?: Address
}

/**
 * Decides whether a receipt paid a charge: an authorization (or a Kova Card tap) carrying the charge's memo,
 * moving exactly the amount, in the right token, to the merchant. A transfer that matches on
 * everything but the memo is reported, never counted.
 */
export function verifyPayment(
  receipt: Pick<TransactionReceipt, 'status' | 'logs'>,
  expected: ExpectedPayment,
): PaymentVerdict {
  if (receipt.status !== 'success') return { status: 'failed' }
  const moves = [
    ...decodeAuthorizedTransfers(receipt.logs, expected.token),
    ...decodeCardTransfers(receipt.logs, expected.token, expected.cardContract),
  ]
  const exact = moves.find((m) => m.nonce.toLowerCase() === expected.memo.toLowerCase())
  if (exact) {
    if (!isAddressEqual(exact.to, expected.payTo) || exact.value !== expected.amount)
      return { status: 'unmatched' }
    return { status: 'paid', payer: exact.authorizer }
  }
  const lookalike = moves.find(
    (m) => isAddressEqual(m.to, expected.payTo) && m.value === expected.amount,
  )
  return lookalike
    ? { status: 'memo_mismatch', payer: lookalike.authorizer }
    : { status: 'unmatched' }
}
