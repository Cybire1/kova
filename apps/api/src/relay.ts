import {
  eip3009Abi,
  kovaSplitterAbi,
  type Token,
  type TransferAuthorization,
  transferAuthorizationTypedData,
  transferWithAuthorizationArgs,
} from '@kova/monad'
import {
  encodeFunctionData,
  type Hex,
  isAddressEqual,
  keccak256,
  recoverTypedDataAddress,
  type TransactionReceipt,
} from 'viem'
import { sendRawTransactionSync } from 'viem/actions'
import { feePayerAccount, network, publicClient, walletClient } from './chain.js'
import { config } from './config.js'
import { KovaError } from './errors.js'
import { splitterAt } from './services/splitters.js'

/**
 * Kova's relayer on Monad.
 *
 * Monad has no fee payer and no transfer memo, so Kova uses EIP-3009 for both: the payer signs a
 * transfer authorization on their phone or in their browser, and this relayer submits it and
 * pays the MON gas. Nobody needs MON to pay or to be paid. The authorization's nonce carries the
 * Kova memo of the charge it pays, which the token records on-chain (AuthorizationUsed).
 *
 * Every check that can be made for free is made before any gas is spent: the signature is
 * recovered here, and the call is estimated (which runs the token's own checks) before sending.
 * Latency matters, because this sits between a tap and a PAID screen: the happy path is one
 * round-trip to check (the estimate, with fees and the nonce already in hand) and one
 * eth_sendRawTransactionSync. The transaction is signed locally, with no network call.
 */

export interface Relayed {
  receipt: TransactionReceipt
  ms: number
}

export const relayReady = () => Boolean(walletClient && feePayerAccount)

/** Authorizations being submitted right now, so a double tap or a retry submits only once. */
const inFlight = new Map<string, Promise<Relayed>>()

/**
 * `zero`: a charge a stamp card made free is still paid, for $0, so it has its receipt on Monad.
 * Only a checkout for exactly $0 may ask for it; a plain send must move money.
 */
export function relayAuthorization(
  token: Token,
  authorization: TransferAuthorization,
  signature: Hex,
  options: { zero?: boolean; beforeBroadcast?: (hash: Hex) => Promise<void> } = {},
): Promise<Relayed> {
  const key = `${token.address}:${authorization.from}:${authorization.nonce}`.toLowerCase()
  const running = inFlight.get(key)
  if (running) return running
  const job = submit(
    token,
    authorization,
    signature,
    options.zero ?? false,
    options.beforeBroadcast,
  ).finally(() => inFlight.delete(key))
  inFlight.set(key, job)
  return job
}

async function submit(
  token: Token,
  authorization: TransferAuthorization,
  signature: Hex,
  zero: boolean,
  beforeBroadcast?: (hash: Hex) => Promise<void>,
): Promise<Relayed> {
  if (!walletClient || !feePayerAccount)
    throw new KovaError('chain_error', 'Payments are not switched on for this server yet.')
  const started = performance.now()

  const now = BigInt(Math.floor(Date.now() / 1000))
  if (authorization.value < 0n || (authorization.value === 0n && !zero))
    throw new KovaError('invalid_request', 'A payment has to move some money.')
  if (authorization.validAfter > now)
    throw new KovaError('invalid_request', 'This payment is not valid yet.')
  if (authorization.validBefore <= now + 5n)
    throw new KovaError('invalid_request', 'This approval ran out. Approve the payment again.')

  // A wrong signature costs nothing to spot here, and gas to learn on-chain.
  const signer = await recoverTypedDataAddress({
    ...transferAuthorizationTypedData(token, network.chainId, authorization),
    signature,
  }).catch(() => null)
  if (!signer || !isAddressEqual(signer, authorization.from))
    throw new KovaError('invalid_request', 'The approval was not signed by the wallet paying.')

  const args = transferWithAuthorizationArgs(authorization, signature)
  // A shop with splits is paid at its splitter: the same signed transfer goes through it, so the
  // sale is shared out in the same transaction (packages/monad programs.ts).
  const splitter = await splitterAt(authorization.to)
  const [from, , value, validAfter, validBefore, nonce, v, r, s] = args
  const target = splitter ?? token.address
  const data = splitter
    ? encodeFunctionData({
        abi: kovaSplitterAbi,
        functionName: 'collect',
        args: [from, value, validAfter, validBefore, nonce, v, r, s],
      })
    : encodeFunctionData({ abi: eip3009Abi, functionName: 'transferWithAuthorization', args })

  let receipt: TransactionReceipt
  try {
    receipt = await sendFromRelayer(target, data, { beforeBroadcast })
  } catch (error) {
    if (error instanceof RefusedEstimate)
      throw await explainRefusal(token, authorization, error.cause)
    throw error
  }
  if (receipt.status !== 'success')
    throw new KovaError('chain_error', 'The payment didn’t go through. No money moved.', {
      tx_hash: receipt.transactionHash,
    })
  return { receipt, ms: performance.now() - started }
}

/** The estimate refused the call: nothing was sent and no gas was spent. */
export class RefusedEstimate extends Error {
  constructor(readonly cause: unknown) {
    super('estimate refused')
  }
}

/** The estimate came back over the call's gas cap: nothing was sent. A cheaper route may fit. */
export class OverFeeCap extends KovaError {
  constructor(
    readonly gas: bigint,
    readonly cap: bigint,
  ) {
    super('policy_declined', 'This payment would cost more in fees than Kova covers.')
  }
}

/**
 * Sends one call from the relayer, the only path that spends its MON, so its nonce has one owner.
 * One round-trip to check (estimate, with fees and nonce alongside), a local signature, then one
 * eth_sendRawTransactionSync that returns the receipt.
 */
export async function sendFromRelayer(
  to: Hex,
  data: Hex,
  options: { maxGas?: bigint; beforeBroadcast?: (hash: Hex) => Promise<void> } = {},
): Promise<TransactionReceipt> {
  if (!walletClient || !feePayerAccount)
    throw new KovaError('chain_error', 'Payments are not switched on for this server yet.')
  let gas: bigint
  let fees: Fees
  let nonce: number
  try {
    // The estimate runs the token's own checks: an authorization that is used, expired, or
    // short of funds fails here, before Kova pays anything. Fees and the nonce come alongside it.
    ;[gas, fees, nonce] = await Promise.all([
      publicClient.estimateGas({ account: feePayerAccount, to, data }),
      currentFees(),
      nextNonce(),
    ])
  } catch (error) {
    resetNonce()
    throw new RefusedEstimate(error)
  }
  const cap = options.maxGas ?? config.KOVA_MAX_RELAY_GAS
  if (gas > cap) {
    resetNonce()
    console.warn('[relay] over the gas cap, not sent', { to, gas: String(gas), cap: String(cap) })
    throw new OverFeeCap(gas, cap)
  }

  // Monad charges for the gas limit, not the gas used, so ask for the estimate plus a sliver.
  const serializedTransaction = await feePayerAccount.signTransaction({
    chainId: network.chainId,
    type: 'eip1559',
    to,
    data,
    nonce,
    gas: gas + gas / 20n,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  })
  const hash = keccak256(serializedTransaction)
  // Persist a pocket's hash before any RPC can take the transaction. A failed persistence
  // callback aborts before broadcast; reserved relayer nonces must then be refreshed.
  try {
    await options.beforeBroadcast?.(hash)
  } catch (error) {
    resetNonce()
    throw error
  }
  try {
    return await sendRawTransactionSync(publicClient, { serializedTransaction, timeout: 6_000 })
  } catch (error) {
    // The node may have taken it and only been slow to answer: look for the receipt before giving up.
    const receipt = await publicClient
      .waitForTransactionReceipt({ hash, timeout: 8_000 })
      .catch(() => null)
    if (receipt) return receipt
    resetNonce()
    console.error('[relay] send failed', hash, shortMessage(error))
    throw new KovaError(
      'chain_error',
      'Monad did not confirm the payment in time. If it went through, it will show as paid in a moment.',
      { tx_hash: hash },
    )
  }
}

/** Why the token refused an authorization, in words a payer can act on. */
async function explainRefusal(
  token: Token,
  authorization: TransferAuthorization,
  error: unknown,
): Promise<KovaError> {
  const [used, balance] = await Promise.all([
    publicClient
      .readContract({
        address: token.address,
        abi: eip3009Abi,
        functionName: 'authorizationState',
        args: [authorization.from, authorization.nonce],
      })
      .catch(() => null),
    publicClient
      .readContract({
        address: token.address,
        abi: eip3009Abi,
        functionName: 'balanceOf',
        args: [authorization.from],
      })
      .catch(() => null),
  ])
  if (used) return new KovaError('conflict', 'This payment has already been made.')
  if (balance !== null && balance < authorization.value)
    return new KovaError('policy_declined', 'There isn’t enough money in this wallet to pay.', {
      balance: balance.toString(),
    })
  console.warn('[relay] refused', shortMessage(error))
  return new KovaError('chain_error', `${token.symbol} refused this payment. No money moved.`, {
    reason: shortMessage(error),
  })
}

interface Fees {
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
}

/**
 * The relayer's nonce, counted here rather than asked for on every payment. JavaScript runs one
 * payment's synchronous code at a time, so handing out `next++` is safe across concurrent payments.
 * Anything unexpected (a failed estimate, a send that never confirmed) re-reads it from the chain.
 */
let pending: { next: number } | Promise<{ next: number }> | undefined

async function nextNonce(): Promise<number> {
  if (!feePayerAccount)
    throw new KovaError('chain_error', 'Payments are not switched on for this server yet.')
  const account = feePayerAccount.address
  pending ??= publicClient
    .getTransactionCount({ address: account, blockTag: 'pending' })
    .then((next) => {
      const state = { next }
      pending = state
      return state
    })
  const state = await pending
  return state.next++
}

function resetNonce() {
  pending = undefined
}

/** Fee quotes change slowly on Monad; reusing one for a few seconds saves two calls per payment. */
let feeQuote: { fees: Fees; at: number } | undefined

async function currentFees(): Promise<Fees> {
  if (feeQuote && Date.now() - feeQuote.at < 10_000) return feeQuote.fees
  const { maxFeePerGas, maxPriorityFeePerGas } = await publicClient.estimateFeesPerGas()
  feeQuote = { fees: { maxFeePerGas, maxPriorityFeePerGas }, at: Date.now() }
  return feeQuote.fees
}

function shortMessage(error: unknown): string {
  const e = error as { shortMessage?: string; details?: string; message?: string }
  return [e.shortMessage ?? e.message ?? String(error), e.details]
    .filter(Boolean)
    .join(' | ')
    .slice(0, 300)
}
