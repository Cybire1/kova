import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { schema, uuidv7 } from '@kova/db'
import {
  cardLastFour,
  cardPinMessage,
  cardPinProblem,
  claimTypedData,
  formatAmount,
  kovaCardAbi,
  kovaCardAddress,
  linkTypedData,
  NO_PERMIT,
  paymentTypedData,
  permitAbi,
  splitPermit,
  unlinkTypedData,
  updateTypedData,
} from '@kova/monad'
import { and, desc, eq, sql } from 'drizzle-orm'
import {
  type Address,
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  encodeFunctionData,
  getAddress,
  type Hex,
  isAddressEqual,
  recoverMessageAddress,
  recoverTypedDataAddress,
  type TransactionReceipt,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { network, publicClient, settlementToken } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { type ErrorCode, KovaError } from '../errors.js'
import { RefusedEstimate, relayReady, sendFromRelayer } from '../relay.js'
import type { PaymentIntent } from './intents.js'
import { settleFromReceipt } from './settle.js'

/**
 * Kova Cards on Monad.
 *
 * A card is an NFC chip with its own key. Linked to a wallet through the KovaCard contract, it
 * spends from that wallet when tapped at a Kova till, within the daily limit the holder set
 * on-chain. Kova's part is to cosign each tap after checking what the chain can't: the PIN, and
 * a freeze that should bite before any transaction confirms. Kova never holds the money and
 * cannot move it alone.
 *
 * Every change a holder makes (link, limit, freeze, unlink) is a signature from their wallet that
 * Kova relays, so nobody needs MON. The contract checks each one itself.
 */

export type CardRow = typeof schema.kovaCards.$inferSelect
export type TapRow = typeof schema.cardTaps.$inferSelect

export const cardContract: Address | null = kovaCardAddress(config.KOVA_NETWORK)
const cosigner = config.KOVA_CARD_COSIGNER_KEY
  ? privateKeyToAccount(config.KOVA_CARD_COSIGNER_KEY as Hex)
  : undefined

export const cardsReady = () => Boolean(cardContract && cosigner && relayReady())

/** The most a holder can let a card spend in a day. */
export const MAX_DAILY_LIMIT = 1_000_000_000n // $1,000
/** Taps up to this need no PIN, like a contactless bank card. */
export const NO_PIN_LIMIT = 25_000_000n // $25
const PIN_TRIES = 3
const LOCK_MS = 15 * 60_000
/** Signed changes are used at once; an older one is refused. */
const SIGNATURE_MAX_AGE_S = 300
/** A tap's signatures are good for this long: the card is on the reader for a second. */
const TAP_TTL_S = 120
/** Linking writes a card, an allowance and a permit; a tap reads and writes a little more than a transfer. */
const CARD_GAS = 400_000n

const scryptAsync = promisify(scrypt) as (secret: string, salt: Buffer, keylen: number) => Promise<Buffer>

async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scryptAsync(pin, salt, 32)
  return `${salt.toString('base64url')}.${hash.toString('base64url')}`
}

async function pinMatches(pin: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split('.')
  if (!salt || !hash) return false
  const expected = Buffer.from(hash, 'base64url')
  const given = await scryptAsync(pin, Buffer.from(salt, 'base64url'), expected.length)
  return timingSafeEqual(given, expected)
}

export function requireCards(): { contract: Address; cosigner: NonNullable<typeof cosigner> } {
  if (!cardContract || !cosigner || !relayReady())
    throw new KovaError('conflict', 'Kova Cards aren’t switched on for this server yet.')
  return { contract: cardContract, cosigner }
}

const nowS = () => Math.floor(Date.now() / 1000)

function freshDeadline(deadline: bigint) {
  const now = BigInt(nowS())
  if (deadline <= now + 5n) throw new KovaError('invalid_request', 'That approval ran out. Try again.')
  if (deadline > now + BigInt(SIGNATURE_MAX_AGE_S) * 2n)
    throw new KovaError('invalid_request', 'An approval for a card lasts ten minutes at most.')
}

function checkLimit(dailyLimit: bigint) {
  if (dailyLimit <= 0n || dailyLimit > MAX_DAILY_LIMIT)
    throw new KovaError('invalid_request', `A daily limit is between $0.01 and $${formatAmount(MAX_DAILY_LIMIT)}.`)
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

export interface OnChainCard {
  holder: Address
  dailyLimit: bigint
  spentToday: bigint
  frozen: boolean
  left: bigint
}

export async function onChainCard(card: Address): Promise<OnChainCard> {
  const { contract } = requireCards()
  const [holder, dailyLimit, spentToday, frozen, left] = await publicClient.readContract({
    address: contract,
    abi: kovaCardAbi,
    functionName: 'cardOf',
    args: [card],
  })
  return { holder, dailyLimit, spentToday, frozen, left }
}

export async function cardRow(card: Address): Promise<CardRow | undefined> {
  return db.query.kovaCards.findFirst({ where: eq(schema.kovaCards.address, card.toLowerCase()) })
}

export async function cardsOf(holder: Address): Promise<CardRow[]> {
  return db.query.kovaCards.findMany({
    where: and(eq(schema.kovaCards.holderAddress, holder.toLowerCase()), eq(schema.kovaCards.status, 'active')),
    orderBy: [desc(schema.kovaCards.createdAt)],
  })
}

/** What the next link, update or unlink signature from this wallet must carry. */
export async function holderNonce(holder: Address): Promise<bigint> {
  const { contract } = requireCards()
  return publicClient.readContract({ address: contract, abi: kovaCardAbi, functionName: 'nonces', args: [holder] })
}

/** The wallet's EIP-2612 nonce on the dollar, and what it has allowed the card contract to draw. */
export async function permitState(holder: Address): Promise<{ nonce: bigint; allowance: bigint }> {
  const { contract } = requireCards()
  const [nonce, allowance] = await Promise.all([
    publicClient.readContract({ address: settlementToken.address, abi: permitAbi, functionName: 'nonces', args: [holder] }),
    publicClient.readContract({
      address: settlementToken.address,
      abi: permitAbi,
      functionName: 'allowance',
      args: [holder, contract],
    }),
  ])
  return { nonce, allowance }
}

export async function serializeCard(row: CardRow) {
  const chain = await onChainCard(getAddress(row.address)).catch(() => null)
  const taps = await db.query.cardTaps.findMany({
    where: and(eq(schema.cardTaps.cardAddress, row.address), eq(schema.cardTaps.status, 'paid')),
    orderBy: [desc(schema.cardTaps.createdAt)],
    limit: 5,
  })
  const shops = taps.length
    ? await db
        .select({ intentId: schema.paymentIntents.id, name: schema.merchants.name })
        .from(schema.paymentIntents)
        .innerJoin(schema.merchants, eq(schema.merchants.id, schema.paymentIntents.merchantId))
        .where(sql`${schema.paymentIntents.id} in ${taps.map((t) => t.intentId)}`)
    : []
  const locked = row.lockedUntil && row.lockedUntil > new Date() ? row.lockedUntil.toISOString() : null
  return {
    object: 'card',
    address: getAddress(row.address),
    label: row.label,
    last_four: row.lastFour,
    holder: getAddress(row.holderAddress),
    // Frozen if either Kova or the chain says so: Kova's word bites first, the chain's is final.
    frozen: row.frozen || (chain?.frozen ?? false),
    daily_limit: chain ? formatAmount(chain.dailyLimit) : null,
    spent_today: chain ? formatAmount(chain.spentToday) : null,
    left_today: chain ? formatAmount(chain.left) : null,
    no_pin_limit: formatAmount(row.noPinLimit),
    pin_locked_until: locked,
    linked_at: row.createdAt.toISOString(),
    recent: taps.map((t) => ({
      amount: formatAmount(t.amount),
      shop: shops.find((s) => s.intentId === t.intentId)?.name ?? 'A shop',
      tx_hash: t.txHash,
      at: t.createdAt.toISOString(),
    })),
  }
}

// ── Holder changes ──────────────────────────────────────────────────────────────────────────

export interface LinkInput {
  holder: Address
  card: Address
  dailyLimit: bigint
  deadline: bigint
  holderSignature: Hex
  cardSignature: Hex
  permit: { value: bigint; deadline: bigint; signature: Hex } | null
  pin: string
  label?: string | undefined
}

export async function linkCard(input: LinkInput): Promise<CardRow> {
  const { contract } = requireCards()
  freshDeadline(input.deadline)
  checkLimit(input.dailyLimit)
  const pinProblem = cardPinProblem(input.pin)
  if (pinProblem) throw new KovaError('invalid_request', pinProblem)

  const existing = await cardRow(input.card)
  if (existing && existing.status === 'active' && !isAddressEqual(existing.holderAddress as Address, input.holder))
    throw new KovaError('conflict', 'That card is already linked to another Kova wallet.')

  // Every check that costs nothing happens before Kova spends gas.
  const nonce = await holderNonce(input.holder)
  const [holderSigner, cardSigner] = await Promise.all([
    recoverTypedDataAddress({
      ...linkTypedData(network.chainId, contract, {
        holder: input.holder,
        card: input.card,
        dailyLimit: input.dailyLimit,
        nonce,
        deadline: input.deadline,
      }),
      signature: input.holderSignature,
    }).catch(() => null),
    recoverTypedDataAddress({
      ...claimTypedData(network.chainId, contract, { card: input.card, holder: input.holder, deadline: input.deadline }),
      signature: input.cardSignature,
    }).catch(() => null),
  ])
  if (!holderSigner || !isAddressEqual(holderSigner, input.holder))
    throw new KovaError('invalid_request', 'The wallet’s approval doesn’t match. Try again.')
  if (!cardSigner || !isAddressEqual(cardSigner, input.card))
    throw new KovaError('invalid_request', 'The card’s signature doesn’t match. Hold the card still and try again.')

  const permit = input.permit ? splitPermit(input.permit.value, input.permit.deadline, input.permit.signature) : NO_PERMIT
  const data = encodeFunctionData({
    abi: kovaCardAbi,
    functionName: 'link',
    args: [input.holder, input.card, input.dailyLimit, input.deadline, input.holderSignature, input.cardSignature, permit],
  })
  const receipt = await sendCard(contract, data)

  const values = {
    network: config.KOVA_NETWORK,
    holderAddress: input.holder.toLowerCase(),
    label: input.label?.trim().slice(0, 40) || 'Kova Card',
    lastFour: cardLastFour(input.card),
    pinHash: await hashPin(input.pin),
    failedPins: 0,
    lockedUntil: null,
    noPinLimit: NO_PIN_LIMIT,
    frozen: false,
    status: 'active',
    linkTxHash: receipt.transactionHash,
    updatedAt: new Date(),
  }
  const [row] = await db
    .insert(schema.kovaCards)
    .values({ address: input.card.toLowerCase(), ...values })
    .onConflictDoUpdate({ target: schema.kovaCards.address, set: values })
    .returning()
  return row as CardRow
}

export async function updateCard(
  row: CardRow,
  input: { dailyLimit: bigint; frozen: boolean; deadline: bigint; holderSignature: Hex },
): Promise<CardRow> {
  const { contract } = requireCards()
  freshDeadline(input.deadline)
  checkLimit(input.dailyLimit)
  const holder = getAddress(row.holderAddress)
  const card = getAddress(row.address)
  const nonce = await holderNonce(holder)
  const signer = await recoverTypedDataAddress({
    ...updateTypedData(network.chainId, contract, {
      holder,
      card,
      dailyLimit: input.dailyLimit,
      frozen: input.frozen,
      nonce,
      deadline: input.deadline,
    }),
    signature: input.holderSignature,
  }).catch(() => null)
  if (!signer || !isAddressEqual(signer, holder))
    throw new KovaError('invalid_request', 'The wallet’s approval doesn’t match. Try again.')

  // A freeze bites now, before the chain confirms it: Kova stops cosigning this card at once.
  if (input.frozen && !row.frozen)
    await db
      .update(schema.kovaCards)
      .set({ frozen: true, updatedAt: new Date() })
      .where(eq(schema.kovaCards.address, row.address))

  const data = encodeFunctionData({
    abi: kovaCardAbi,
    functionName: 'update',
    args: [card, input.dailyLimit, input.frozen, input.deadline, input.holderSignature],
  })
  await sendCard(contract, data)
  const [updated] = await db
    .update(schema.kovaCards)
    .set({ frozen: input.frozen, updatedAt: new Date() })
    .where(eq(schema.kovaCards.address, row.address))
    .returning()
  return updated as CardRow
}

export async function unlinkCard(row: CardRow, input: { deadline: bigint; holderSignature: Hex }): Promise<void> {
  const { contract } = requireCards()
  freshDeadline(input.deadline)
  const holder = getAddress(row.holderAddress)
  const card = getAddress(row.address)
  const nonce = await holderNonce(holder)
  const signer = await recoverTypedDataAddress({
    ...unlinkTypedData(network.chainId, contract, { holder, card, nonce, deadline: input.deadline }),
    signature: input.holderSignature,
  }).catch(() => null)
  if (!signer || !isAddressEqual(signer, holder))
    throw new KovaError('invalid_request', 'The wallet’s approval doesn’t match. Try again.')
  // Off for Kova at once; the chain follows.
  await db
    .update(schema.kovaCards)
    .set({ frozen: true, updatedAt: new Date() })
    .where(eq(schema.kovaCards.address, row.address))
  await sendCard(
    contract,
    encodeFunctionData({ abi: kovaCardAbi, functionName: 'unlink', args: [card, input.deadline, input.holderSignature] }),
  )
  await db
    .update(schema.kovaCards)
    .set({ status: 'unlinked', updatedAt: new Date() })
    .where(eq(schema.kovaCards.address, row.address))
}

/** PIN changes seen recently, so the same signature can't change a PIN twice. */
const usedPinSignatures = new Map<string, number>()

export async function changePin(row: CardRow, input: { pin: string; signedAt: number; signature: Hex }): Promise<void> {
  const problem = cardPinProblem(input.pin)
  if (problem) throw new KovaError('invalid_request', problem)
  if (Math.abs(nowS() - input.signedAt) > SIGNATURE_MAX_AGE_S)
    throw new KovaError('invalid_request', 'That approval ran out. Try again.')
  const key = input.signature.toLowerCase()
  for (const [sig, at] of usedPinSignatures) if (nowS() - at > SIGNATURE_MAX_AGE_S * 2) usedPinSignatures.delete(sig)
  if (usedPinSignatures.has(key)) throw new KovaError('conflict', 'That approval was already used.')
  const holder = getAddress(row.holderAddress)
  const signer = await recoverMessageAddress({
    message: cardPinMessage({ card: getAddress(row.address), holder, signedAt: input.signedAt }),
    signature: input.signature,
  }).catch(() => null)
  if (!signer || !isAddressEqual(signer, holder))
    throw new KovaError('invalid_request', 'The wallet’s approval doesn’t match. Try again.')
  usedPinSignatures.set(key, nowS())
  await db
    .update(schema.kovaCards)
    .set({ pinHash: await hashPin(input.pin), failedPins: 0, lockedUntil: null, updatedAt: new Date() })
    .where(eq(schema.kovaCards.address, row.address))
}

// ── Taps ────────────────────────────────────────────────────────────────────────────────────

export interface PreparedTap {
  tap: TapRow
  typedData: ReturnType<typeof paymentTypedData>
}

/**
 * The till read a card: check it can pay this charge, and give back the exact payment for the
 * card to sign. Nothing moves yet.
 */
export async function prepareTap(input: {
  intent: PaymentIntent
  card: Address
  terminalId: string | null
}): Promise<PreparedTap> {
  const { contract } = requireCards()
  const { intent } = input
  if (intent.status !== 'requires_payment') throw new KovaError('conflict', 'This charge isn’t open any more.')
  if (intent.expiresAt < new Date()) throw new KovaError('conflict', 'This charge has expired. Start a new one.')
  if (!isAddressEqual(intent.tokenAddress as Address, settlementToken.address))
    throw new KovaError('invalid_request', 'Cards pay in Kova’s dollars only.')

  const row = await cardRow(input.card)
  if (!row || row.status !== 'active')
    throw new KovaError('not_found', 'This card isn’t linked to a Kova wallet. Link it in the Kova app.')
  if (row.frozen) throw new KovaError('policy_declined', 'This card is frozen. Its owner can unfreeze it in the Kova app.')
  if (row.lockedUntil && row.lockedUntil > new Date())
    throw new KovaError('policy_declined', 'Too many wrong PINs. This card is paused for a few minutes.')

  const chain = await onChainCard(input.card)
  if (!isAddressEqual(chain.holder, row.holderAddress as Address))
    throw new KovaError('not_found', 'This card isn’t linked to a Kova wallet. Link it in the Kova app.')
  if (chain.frozen) throw new KovaError('policy_declined', 'This card is frozen. Its owner can unfreeze it in the Kova app.')
  if (chain.left < intent.amount) {
    const limitLeft = chain.dailyLimit > chain.spentToday ? chain.dailyLimit - chain.spentToday : 0n
    throw new KovaError(
      'policy_declined',
      limitLeft < intent.amount
        ? `That’s over this card’s daily limit. It can spend $${formatAmount(limitLeft)} more today.`
        : 'There isn’t enough money in the wallet behind this card.',
    )
  }

  const deadline = nowS() + TAP_TTL_S
  const [tap] = await db
    .insert(schema.cardTaps)
    .values({
      id: uuidv7(),
      cardAddress: row.address,
      intentId: intent.id,
      terminalId: input.terminalId,
      amount: intent.amount,
      payTo: intent.payTo.toLowerCase(),
      memo: intent.memo,
      deadline,
      pinRequired: intent.amount > row.noPinLimit,
    })
    .returning()
  if (!tap) throw new KovaError('internal', 'The tap wasn’t saved.')
  return { tap, typedData: tapTypedData(contract, tap) }
}

export function tapTypedData(contract: Address, tap: TapRow) {
  return paymentTypedData(network.chainId, contract, {
    card: getAddress(tap.cardAddress),
    to: getAddress(tap.payTo),
    amount: tap.amount,
    memo: tap.memo as Hex,
    deadline: BigInt(tap.deadline),
  })
}

export async function getTap(id: string): Promise<TapRow | undefined> {
  return db.query.cardTaps.findFirst({ where: eq(schema.cardTaps.id, id) })
}

/** Three wrong PINs pause the card for 15 minutes. Counted in the database, so parallel guesses count too. */
async function checkPin(row: CardRow, pin: string | undefined): Promise<void> {
  if (!pin) throw new KovaError('invalid_request', 'Enter the card’s PIN.', { pin_required: true })
  if (await pinMatches(pin, row.pinHash)) {
    if (row.failedPins > 0)
      await db.update(schema.kovaCards).set({ failedPins: 0 }).where(eq(schema.kovaCards.address, row.address))
    return
  }
  const [after] = await db
    .update(schema.kovaCards)
    .set({ failedPins: sql`${schema.kovaCards.failedPins} + 1` })
    .where(eq(schema.kovaCards.address, row.address))
    .returning({ failed: schema.kovaCards.failedPins })
  const failed = after?.failed ?? PIN_TRIES
  if (failed >= PIN_TRIES) {
    await db
      .update(schema.kovaCards)
      .set({ failedPins: 0, lockedUntil: new Date(Date.now() + LOCK_MS) })
      .where(eq(schema.kovaCards.address, row.address))
    throw new KovaError('policy_declined', 'Too many wrong PINs. This card is paused for 15 minutes.')
  }
  const left = PIN_TRIES - failed
  throw new KovaError('invalid_request', `Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left.`, {
    pin_required: true,
    tries_left: left,
  })
}

export interface CompletedTap {
  tap: TapRow
  receipt: TransactionReceipt
  paymentId: string | undefined
}

/**
 * The card signed: check the PIN, cosign, and send the payment. A tap pays at most once: it is
 * claimed before anything is sent, and only one claim can win.
 */
export async function completeTap(
  tap: TapRow,
  input: { cardSignature: Hex; pin?: string | undefined },
): Promise<CompletedTap> {
  const { contract, cosigner: kova } = requireCards()
  if (tap.status === 'paid') throw new KovaError('conflict', 'This tap has already paid.')
  if (tap.status !== 'prepared') throw new KovaError('conflict', 'This tap didn’t go through. Tap the card again.')
  if (tap.deadline <= nowS() + 3) throw new KovaError('conflict', 'That tap took too long. Tap the card again.')

  const typedData = tapTypedData(contract, tap)
  const signer = await recoverTypedDataAddress({ ...typedData, signature: input.cardSignature }).catch(() => null)
  if (!signer || !isAddressEqual(signer, tap.cardAddress as Address))
    throw new KovaError('invalid_request', 'The card’s signature doesn’t match. Tap the card again.')

  const row = await cardRow(tap.cardAddress as Address)
  if (!row || row.status !== 'active') throw new KovaError('not_found', 'This card isn’t linked any more.')
  if (row.frozen) throw new KovaError('policy_declined', 'This card is frozen.')
  if (row.lockedUntil && row.lockedUntil > new Date())
    throw new KovaError('policy_declined', 'Too many wrong PINs. This card is paused for a few minutes.')
  if (tap.pinRequired) await checkPin(row, input.pin)

  const [claimed] = await db
    .update(schema.cardTaps)
    .set({ status: 'paying', updatedAt: new Date() })
    .where(and(eq(schema.cardTaps.id, tap.id), eq(schema.cardTaps.status, 'prepared')))
    .returning()
  if (!claimed) throw new KovaError('conflict', 'This tap is already being paid.')

  let receipt: TransactionReceipt
  try {
    const cosignature = await kova.signTypedData(typedData)
    const data = encodeFunctionData({
      abi: kovaCardAbi,
      functionName: 'pay',
      args: [
        getAddress(tap.cardAddress),
        getAddress(tap.payTo),
        tap.amount,
        tap.memo as Hex,
        BigInt(tap.deadline),
        input.cardSignature,
        cosignature,
      ],
    })
    receipt = await sendCard(contract, data)
  } catch (error) {
    // Nothing moved (or, after a slow node, the watcher will find it and settle the charge).
    const message = error instanceof Error ? error.message : String(error)
    await db
      .update(schema.cardTaps)
      .set({ status: 'failed', failure: message.slice(0, 500), updatedAt: new Date() })
      .where(eq(schema.cardTaps.id, tap.id))
    throw error
  }
  // The money has moved: from here on, the tap is paid whatever else happens.
  const [paid] = await db
    .update(schema.cardTaps)
    .set({ status: 'paid', txHash: receipt.transactionHash, updatedAt: new Date() })
    .where(eq(schema.cardTaps.id, tap.id))
    .returning()
  const settled = await settleFromReceipt(receipt)
  return { tap: paid as TapRow, receipt, paymentId: settled.paymentId }
}

// ── Sending ─────────────────────────────────────────────────────────────────────────────────

/** Relays a KovaCard call, turning the contract's refusals into words a person can act on. */
export async function sendCard(contract: Address, data: Hex): Promise<TransactionReceipt> {
  let receipt: TransactionReceipt
  try {
    receipt = await sendFromRelayer(contract, data, { maxGas: CARD_GAS })
  } catch (error) {
    if (error instanceof RefusedEstimate) throw explainCardRefusal(error.cause)
    throw error
  }
  if (receipt.status !== 'success')
    throw new KovaError('chain_error', 'Monad refused this. No money moved.', { tx_hash: receipt.transactionHash })
  return receipt
}

function explainCardRefusal(cause: unknown): KovaError {
  const name = revertName(cause)
  const words: Record<string, [ErrorCode, string]> = {
    Expired: ['invalid_request', 'That approval ran out. Try again.'],
    BadSignature: ['invalid_request', 'A signature didn’t match. Try again.'],
    CardTaken: ['conflict', 'That card is already linked to another Kova wallet.'],
    UnknownCard: ['not_found', 'This card isn’t linked to a Kova wallet.'],
    Frozen: ['policy_declined', 'This card is frozen.'],
    OverDailyLimit: ['policy_declined', 'That’s over this card’s daily limit.'],
    MemoUsed: ['conflict', 'This charge has already been paid.'],
    ZeroAmount: ['invalid_request', 'A payment has to move some money.'],
    TransferFailed: ['policy_declined', 'The wallet couldn’t cover this payment.'],
  }
  const known = name ? words[name] : undefined
  if (known) return new KovaError(known[0], known[1])
  // An ERC-20 revert (balance or allowance) has no KovaCard error.
  console.warn('[cards] refused', cause instanceof Error ? cause.message.slice(0, 300) : cause)
  return new KovaError('policy_declined', 'The wallet behind this card couldn’t cover this payment. No money moved.')
}

function revertName(cause: unknown): string | null {
  if (cause instanceof BaseError) {
    const reverted = cause.walk((e) => e instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName) return reverted.data.errorName
    const raw = cause.walk((e) => typeof (e as { data?: unknown }).data === 'string') as { data?: Hex } | null
    if (raw?.data && raw.data.length >= 10) {
      try {
        return decodeErrorResult({ abi: kovaCardAbi, data: raw.data }).errorName
      } catch {
        return null
      }
    }
  }
  return null
}
