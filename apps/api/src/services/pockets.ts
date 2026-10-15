import { schema, uuidv7 } from '@kova/db'
import {
  formatAmount,
  type PocketAction,
  pocketMessage,
  randomNonce,
  transferAuthorizationTypedData,
} from '@kova/monad'
import { and, desc, eq, gt, lt, ne, sql } from 'drizzle-orm'
import {
  type Address,
  erc20Abi,
  getAddress,
  type Hex,
  isAddressEqual,
  recoverMessageAddress,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { network, publicClient, settlementToken } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { KovaError } from '../errors.js'
import { relayAuthorization } from '../relay.js'
import { hashSecret, openKey, sealKey, secretMatches } from '../secrets.js'
import type { PaymentIntent } from './intents.js'
import { settleFromReceipt } from './settle.js'
import { sendSms, sendSmsLater } from './sms.js'

export type Pocket = typeof schema.ussdPockets.$inferSelect
export type Spend = typeof schema.ussdSpends.$inferSelect

export const pocketsReady = () => Boolean(config.KOVA_POCKET_MASTER_KEY)

/** A pocket holds at most this much, so what USSD can lose is always small. */
export const MAX_CAP = 200_000_000n // $200
const PIN_TRIES = 3
const LOCK_MS = 15 * 60_000
const CODE_TTL_MS = 10 * 60_000
/** A signed approval is used at once; one older than this is refused. */
const SIGNATURE_MAX_AGE_S = 300

export function requirePockets() {
  if (!pocketsReady())
    throw new KovaError('conflict', 'USSD isn’t switched on for this server yet.')
}

/** Checks a pocket change was signed by the wallet, recently, and after the last one accepted. */
export async function checkOwner(
  pocket: Pocket | undefined,
  change: {
    action: PocketAction
    wallet: Address
    phone?: string
    cap?: bigint
    amount?: bigint
    signedAt: number
  },
  signature: Hex,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - change.signedAt) > SIGNATURE_MAX_AGE_S)
    throw new KovaError('invalid_request', 'That approval is too old. Try again.')
  if (pocket && change.signedAt <= pocket.lastSignedAt)
    throw new KovaError('invalid_request', 'That approval was already used.')
  const signer = await recoverMessageAddress({ message: pocketMessage(change), signature }).catch(
    () => null,
  )
  if (!signer || !isAddressEqual(signer, change.wallet))
    throw new KovaError('forbidden', 'Only the wallet itself can change its pocket.')
}

export async function pocketOf(owner: Address): Promise<Pocket | undefined> {
  return db.query.ussdPockets.findFirst({
    where: eq(schema.ussdPockets.ownerAddress, owner.toLowerCase()),
  })
}

/** The live pocket a phone number dials into. */
export async function pocketForPhone(phone: string): Promise<Pocket | undefined> {
  return db.query.ussdPockets.findFirst({
    where: and(eq(schema.ussdPockets.phone, phone), eq(schema.ussdPockets.status, 'active')),
  })
}

export async function pocketBalance(pocket: Pocket): Promise<bigint> {
  return publicClient.readContract({
    address: settlementToken.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [pocket.pocketAddress as Address],
  })
}

/** What the pocket has spent in the last 24 hours, not counting money taken back to the wallet. */
export async function spentToday(pocket: Pocket): Promise<bigint> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${schema.ussdSpends.amount}), 0)` })
    .from(schema.ussdSpends)
    .where(
      and(
        eq(schema.ussdSpends.pocketId, pocket.id),
        ne(schema.ussdSpends.kind, 'withdraw'),
        ne(schema.ussdSpends.status, 'failed'),
        gt(schema.ussdSpends.createdAt, new Date(Date.now() - 86_400_000)),
      ),
    )
  return BigInt(row?.total ?? '0')
}

function newCode(): string {
  const bytes = new Uint32Array(1)
  globalThis.crypto.getRandomValues(bytes)
  return String((bytes[0] ?? 0) % 1_000_000).padStart(6, '0')
}

/**
 * Sets up a pocket, or starts again with a new phone, PIN or cap: the pocket keeps its address
 * (and anything in it), and goes back to pending until the phone's code is entered.
 */
export async function setUpPocket(input: {
  owner: Address
  phone: string
  pin: string
  cap: bigint
  signedAt: number
}) {
  if (input.cap <= 0n || input.cap > MAX_CAP)
    throw new KovaError(
      'invalid_request',
      `A pocket can hold up to ${formatAmount(MAX_CAP)} dollars.`,
    )
  const taken = await pocketForPhone(input.phone)
  if (taken && taken.ownerAddress !== input.owner.toLowerCase())
    throw new KovaError('conflict', 'That number already pays from another Kova wallet.')

  const code = newCode()
  const [pinHash, codeHash] = await Promise.all([hashSecret(input.pin), hashSecret(code)])
  const existing = await pocketOf(input.owner)
  const values = {
    phone: input.phone,
    pinHash,
    cap: input.cap,
    status: 'pending',
    codeHash,
    codeExpiresAt: new Date(Date.now() + CODE_TTL_MS),
    failedPins: 0,
    lockedUntil: null,
    lastSignedAt: input.signedAt,
    updatedAt: new Date(),
  }
  let pocket: Pocket | undefined
  if (existing) {
    ;[pocket] = await db
      .update(schema.ussdPockets)
      .set(values)
      .where(eq(schema.ussdPockets.id, existing.id))
      .returning()
  } else {
    const id = uuidv7()
    const key = generatePrivateKey()
    ;[pocket] = await db
      .insert(schema.ussdPockets)
      .values({
        id,
        ownerAddress: input.owner.toLowerCase(),
        pocketAddress: privateKeyToAccount(key).address.toLowerCase(),
        sealedKey: sealKey(key, id),
        ...values,
      })
      .returning()
  }
  if (!pocket) throw new KovaError('internal', 'The pocket wasn’t saved.')
  await sendSms(
    input.phone,
    `Your Kova code is ${code}. It sets up paying by USSD from this number. Never share it.`,
  )
  return pocket
}

/** The code sent to the phone proves the owner has it; then the pocket is live. */
export async function confirmPhone(owner: Address, code: string): Promise<Pocket> {
  const pocket = await pocketOf(owner)
  if (!pocket || pocket.status !== 'pending' || !pocket.codeHash || !pocket.codeExpiresAt)
    throw new KovaError('conflict', 'There’s no code waiting for this wallet. Start again.')
  if (pocket.lockedUntil && pocket.lockedUntil > new Date())
    throw new KovaError('rate_limited', 'Too many wrong codes. Start again in a few minutes.')
  if (pocket.codeExpiresAt < new Date())
    throw new KovaError('conflict', 'That code has expired. Start again for a new one.')
  if (!(await secretMatches(code, pocket.codeHash))) {
    const failed = pocket.failedPins + 1
    await db
      .update(schema.ussdPockets)
      .set({
        failedPins: failed >= 5 ? 0 : failed,
        lockedUntil: failed >= 5 ? new Date(Date.now() + LOCK_MS) : null,
      })
      .where(eq(schema.ussdPockets.id, pocket.id))
    throw new KovaError('invalid_request', 'That code isn’t right.')
  }
  const taken = await pocketForPhone(pocket.phone)
  if (taken && taken.id !== pocket.id)
    throw new KovaError('conflict', 'That number already pays from another Kova wallet.')
  const [live] = await db
    .update(schema.ussdPockets)
    .set({
      status: 'active',
      codeHash: null,
      codeExpiresAt: null,
      failedPins: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.ussdPockets.id, pocket.id))
    .returning()
  sendSmsLater(
    pocket.phone,
    `Kova: this number can now pay by USSD. Dial ${config.KOVA_USSD_CODE}. Kova never asks for your PIN.`,
  )
  return live as Pocket
}

export async function updatePocket(
  pocket: Pocket,
  change: { cap?: bigint; pin?: string; signedAt: number },
): Promise<Pocket> {
  if (change.cap !== undefined && (change.cap <= 0n || change.cap > MAX_CAP))
    throw new KovaError(
      'invalid_request',
      `A pocket can hold up to ${formatAmount(MAX_CAP)} dollars.`,
    )
  const [updated] = await db
    .update(schema.ussdPockets)
    .set({
      ...(change.cap !== undefined ? { cap: change.cap } : {}),
      ...(change.pin
        ? { pinHash: await hashSecret(change.pin), failedPins: 0, lockedUntil: null }
        : {}),
      lastSignedAt: change.signedAt,
      updatedAt: new Date(),
    })
    .where(eq(schema.ussdPockets.id, pocket.id))
    .returning()
  return updated as Pocket
}

/** Turns USSD off for a pocket. Its key stays sealed, so money sent to it later can still come back. */
export async function closePocket(pocket: Pocket, signedAt: number): Promise<void> {
  await db
    .update(schema.ussdPockets)
    .set({ status: 'closed', lastSignedAt: signedAt, updatedAt: new Date() })
    .where(eq(schema.ussdPockets.id, pocket.id))
}

export type PinCheck = { ok: true } | { ok: false; locked: boolean; triesLeft: number }

/** Three wrong PINs lock the pocket for 15 minutes, and the owner gets a text. */
export async function checkPin(pocket: Pocket, pin: string): Promise<PinCheck> {
  if (pocket.lockedUntil && pocket.lockedUntil > new Date())
    return { ok: false, locked: true, triesLeft: 0 }
  if (await secretMatches(pin, pocket.pinHash)) {
    if (pocket.failedPins > 0)
      await db
        .update(schema.ussdPockets)
        .set({ failedPins: 0 })
        .where(eq(schema.ussdPockets.id, pocket.id))
    return { ok: true }
  }
  const failed = pocket.failedPins + 1
  const locked = failed >= PIN_TRIES
  await db
    .update(schema.ussdPockets)
    .set({
      failedPins: locked ? 0 : failed,
      lockedUntil: locked ? new Date(Date.now() + LOCK_MS) : null,
    })
    .where(eq(schema.ussdPockets.id, pocket.id))
  if (locked)
    sendSmsLater(
      pocket.phone,
      'Kova: three wrong PINs, so USSD payments from this number are paused for 15 minutes. If that wasn’t you, change your PIN in the app.',
    )
  return { ok: false, locked, triesLeft: PIN_TRIES - failed }
}

/** A short reference people can read out: K + 5 characters. */
function reference(): string {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
  const bytes = new Uint8Array(5)
  globalThis.crypto.getRandomValues(bytes)
  return `K${[...bytes].map((b) => alphabet[b % alphabet.length]).join('')}`
}

export interface SpendRequest {
  sessionId: string
  kind: 'till' | 'phone' | 'withdraw'
  to: Address
  toLabel: string
  amount: bigint
  intent?: PaymentIntent
}

/**
 * Pays out of a pocket: the pocket's key signs an EIP-3009 transfer, Kova's relayer submits it.
 * One spend per session, so a phone network resending the last step never pays twice. Limits are
 * checked before anything is signed; taking money back to the owner's wallet is never limited.
 */
export async function spend(pocket: Pocket, request: SpendRequest): Promise<Spend> {
  const existing = await db.query.ussdSpends.findFirst({
    where: eq(schema.ussdSpends.sessionId, request.sessionId),
  })
  // Session ids are unique per phone network session; one that belongs to another pocket is refused.
  if (existing) {
    if (existing.pocketId !== pocket.id)
      throw new KovaError('conflict', 'That session belongs to another pocket.')
    return existing
  }
  if (request.amount <= 0n) throw new KovaError('invalid_request', 'Send at least a cent.')
  if (request.kind !== 'withdraw') {
    if (request.amount > pocket.cap)
      throw new KovaError(
        'invalid_request',
        `Your pocket pays up to $${formatAmount(pocket.cap)} at a time.`,
      )
    if ((await spentToday(pocket)) + request.amount > pocket.cap)
      throw new KovaError('rate_limited', `That’s over your $${formatAmount(pocket.cap)} a day.`)
  }
  if ((await pocketBalance(pocket)) < request.amount)
    throw new KovaError('policy_declined', 'Your pocket doesn’t have enough.')

  const [row] = await db
    .insert(schema.ussdSpends)
    .values({
      id: uuidv7(),
      pocketId: pocket.id,
      sessionId: request.sessionId,
      kind: request.kind,
      toAddress: request.to.toLowerCase(),
      toLabel: request.toLabel,
      amount: request.amount,
      intentId: request.intent?.id ?? null,
      reference: reference(),
    })
    .onConflictDoNothing()
    .returning()
  // Another request for the same session got there first.
  if (!row)
    return (await db.query.ussdSpends.findFirst({
      where: eq(schema.ussdSpends.sessionId, request.sessionId),
    })) as Spend

  try {
    const account = privateKeyToAccount(openKey(pocket.sealedKey, pocket.id))
    const authorization = {
      from: account.address,
      to: getAddress(request.to),
      value: request.amount,
      validAfter: 0n,
      validBefore: BigInt(Math.floor(Date.now() / 1000) + 300),
      nonce: request.intent ? (request.intent.memo as Hex) : randomNonce(),
    }
    const signature = await account.signTypedData(
      transferAuthorizationTypedData(settlementToken, network.chainId, authorization),
    )
    const { receipt } = await relayAuthorization(settlementToken, authorization, signature)
    if (request.intent) await settleFromReceipt(receipt)
    const [paid] = await db
      .update(schema.ussdSpends)
      .set({ status: 'paid', txHash: receipt.transactionHash, updatedAt: new Date() })
      .where(eq(schema.ussdSpends.id, row.id))
      .returning()
    return paid as Spend
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db
      .update(schema.ussdSpends)
      .set({ status: 'failed', failure: message.slice(0, 500), updatedAt: new Date() })
      .where(eq(schema.ussdSpends.id, row.id))
    throw error
  }
}

/** The spend a USSD session already made, if any. */
export async function spendForSession(
  pocket: Pocket,
  sessionId: string,
): Promise<Spend | undefined> {
  return db.query.ussdSpends.findFirst({
    where: and(
      eq(schema.ussdSpends.pocketId, pocket.id),
      eq(schema.ussdSpends.sessionId, sessionId),
    ),
  })
}

export async function recentSpends(pocket: Pocket, count = 10): Promise<Spend[]> {
  return db.query.ussdSpends.findMany({
    where: eq(schema.ussdSpends.pocketId, pocket.id),
    orderBy: [desc(schema.ussdSpends.createdAt)],
    limit: count,
  })
}

export function serializeSpend(row: Spend) {
  return {
    object: 'pocket_spend',
    reference: row.reference,
    kind: row.kind,
    to: row.toLabel,
    amount: formatAmount(row.amount),
    status: row.status,
    tx_hash: row.txHash,
    created_at: row.createdAt.toISOString(),
  }
}

export async function serializePocket(pocket: Pocket) {
  const [balance, spent, spends] = await Promise.all([
    pocketBalance(pocket).catch(() => null),
    spentToday(pocket),
    recentSpends(pocket),
  ])
  return {
    object: 'ussd_pocket',
    status: pocket.status,
    phone: pocket.phone,
    address: getAddress(pocket.pocketAddress),
    cap: formatAmount(pocket.cap),
    balance: balance === null ? null : formatAmount(balance),
    spent_today: formatAmount(spent),
    left_today: formatAmount(pocket.cap > spent ? pocket.cap - spent : 0n),
    locked_until:
      pocket.lockedUntil && pocket.lockedUntil > new Date()
        ? pocket.lockedUntil.toISOString()
        : null,
    dial: config.KOVA_USSD_CODE,
    spends: spends.map(serializeSpend),
  }
}

/* ── Till codes ─────────────────────────────────────────────────────────────────────────────── */

/** The 6-digit code a till shows for a charge, made on first ask, gone when the charge expires. */
export async function tillCodeFor(intent: PaymentIntent): Promise<string | null> {
  if (!pocketsReady() || intent.status !== 'requires_payment' || intent.expiresAt < new Date())
    return null
  const existing = await db.query.ussdTillCodes.findFirst({
    where: eq(schema.ussdTillCodes.intentId, intent.id),
  })
  if (existing) return existing.code
  await db.delete(schema.ussdTillCodes).where(lt(schema.ussdTillCodes.expiresAt, new Date()))
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode()
    const [row] = await db
      .insert(schema.ussdTillCodes)
      .values({ code, intentId: intent.id, expiresAt: intent.expiresAt })
      .onConflictDoNothing()
      .returning()
    if (row) return row.code
    const raced = await db.query.ussdTillCodes.findFirst({
      where: eq(schema.ussdTillCodes.intentId, intent.id),
    })
    if (raced) return raced.code
  }
  return null
}

/** The charge a till code stands for, while it can still be paid. */
export async function intentForTillCode(
  code: string,
): Promise<{ intent: PaymentIntent; merchantName: string } | null> {
  const row = await db.query.ussdTillCodes.findFirst({ where: eq(schema.ussdTillCodes.code, code) })
  if (!row || row.expiresAt < new Date()) return null
  const intent = await db.query.paymentIntents.findFirst({
    where: eq(schema.paymentIntents.id, row.intentId),
  })
  if (!intent || intent.status !== 'requires_payment' || intent.expiresAt < new Date()) return null
  const merchant = await db.query.merchants.findFirst({
    where: eq(schema.merchants.id, intent.merchantId),
  })
  return { intent, merchantName: merchant?.name ?? 'the shop' }
}

/** Pockets that a phone send can land in: the owner's main wallet behind a verified number. */
export async function walletForPhone(phone: string): Promise<Address | null> {
  const pocket = await pocketForPhone(phone)
  return pocket ? getAddress(pocket.ownerAddress) : null
}
