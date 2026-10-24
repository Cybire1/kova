import { schema, uuidv7 } from '@kova/db'
import {
  eip3009Abi,
  encodeMemo,
  formatAmount,
  type PocketChange,
  pocketMessage,
  transferAuthorizationTypedData,
} from '@kova/monad'
import { and, desc, eq, gt, inArray, isNull, lt, ne, sql } from 'drizzle-orm'
import {
  type Address,
  erc20Abi,
  getAddress,
  type Hex,
  isAddressEqual,
  keccak256,
  parseEventLogs,
  recoverMessageAddress,
  type TransactionReceipt,
  toHex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { network, publicClient, settlementToken } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { KovaError } from '../errors.js'
import { relayAuthorization, relayReady } from '../relay.js'
import { hashSecret, openKey, sealKey, secretMatches } from '../secrets.js'
import type { PaymentIntent } from './intents.js'
import {
  type CashOutRow,
  dropPocketCashOut,
  formatNaira,
  nairaReady,
  receivePocketCashOut,
  whenCashOutEnds,
} from './naira.js'
import { verifiedWalletForPhone } from './phone-payments.js'
import { settleFromReceipt } from './settle.js'
import { sendSms, sendSmsLater, smsReady } from './sms.js'

export type Pocket = typeof schema.ussdPockets.$inferSelect
export type Spend = typeof schema.ussdSpends.$inferSelect

export const pocketsReady = () =>
  Boolean(
    config.KOVA_USSD_ENABLED === '1' &&
      config.KOVA_POCKET_MASTER_KEY &&
      smsReady() &&
      config.KOVA_USSD_CALLBACK_SECRET &&
      /^\*[\d*]+#$/.test(config.KOVA_USSD_CODE) &&
      relayReady() &&
      (config.KOVA_NETWORK !== 'testnet' || config.AT_USERNAME === 'sandbox'),
  )

/** Maximum daily spending limit. An ordinary token address cannot cap inbound transfers. */
export const MAX_CAP = 200_000_000n // $200
const PIN_TRIES = 3
const LOCK_MS = 15 * 60_000
const CODE_TTL_MS = 10 * 60_000
/** A signed approval is used at once; one older than this is refused. */
const SIGNATURE_MAX_AGE_S = 300

export function requirePockets() {
  if (!config.KOVA_POCKET_MASTER_KEY)
    throw new KovaError('conflict', 'USSD isn’t switched on for this server yet.')
}

export function requirePocketSetup() {
  if (!pocketsReady())
    throw new KovaError('conflict', 'USSD setup isn’t available on this network yet.')
}

type PocketTx = Parameters<Parameters<typeof db.transaction>[0]>[0]
async function lockedPocket(tx: PocketTx, id: string): Promise<Pocket> {
  const [pocket] = await tx
    .select()
    .from(schema.ussdPockets)
    .where(eq(schema.ussdPockets.id, id))
    .for('update')
  if (!pocket) throw new KovaError('not_found', 'This wallet has no USSD pocket.')
  return pocket
}

/** Checks a pocket change was signed by the wallet, recently, and after the last one accepted. */
export async function checkOwner(
  pocket: Pocket | undefined,
  change: PocketChange,
  signature: Hex,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  if (change.chainId !== network.chainId)
    throw new KovaError('invalid_request', 'That approval is for another network.')
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
  requirePocketSetup()
  if (input.cap <= 0n || input.cap > MAX_CAP)
    throw new KovaError(
      'invalid_request',
      `Choose a daily spending limit up to $${formatAmount(MAX_CAP)}.`,
    )
  const taken = await pocketForPhone(input.phone)
  const phoneWallet = await verifiedWalletForPhone(input.phone)
  if (phoneWallet && phoneWallet.toLowerCase() !== input.owner.toLowerCase())
    throw new KovaError('conflict', 'That number is already linked to another Kova wallet.')
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
      .where(
        and(
          eq(schema.ussdPockets.id, existing.id),
          lt(schema.ussdPockets.lastSignedAt, input.signedAt),
        ),
      )
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
      .onConflictDoNothing()
      .returning()
  }
  if (!pocket) throw new KovaError('conflict', 'That approval was already used. Try again.')
  await sendSms(
    input.phone,
    `Your Kova code is ${code}. It sets up paying by USSD from this number. Never share it.`,
  )
  return pocket
}

/** The code sent to the phone proves the owner has it; then the pocket is live. */
export async function confirmPhone(owner: Address, code: string): Promise<Pocket> {
  requirePocketSetup()
  const pocket = await pocketOf(owner)
  if (!pocket || pocket.status !== 'pending' || !pocket.codeHash || !pocket.codeExpiresAt)
    throw new KovaError('conflict', 'There’s no code waiting for this wallet. Start again.')
  // Return errors out of the transaction so a wrong-code counter is committed, not rolled back.
  const result = await db
    .transaction(async (tx) => {
      const current = await lockedPocket(tx, pocket.id)
      if (current.status !== 'pending' || !current.codeHash || !current.codeExpiresAt)
        return new KovaError('conflict', 'There’s no code waiting. Start again.')
      if (current.lockedUntil && current.lockedUntil > new Date())
        return new KovaError('rate_limited', 'Too many wrong codes. Try again in 15 minutes.')
      if (current.codeExpiresAt < new Date())
        return new KovaError('conflict', 'That code has expired. Start again for a new one.')
      if (!(await secretMatches(code, current.codeHash))) {
        const failed = current.failedPins + 1
        await tx
          .update(schema.ussdPockets)
          .set({
            failedPins: failed,
            lockedUntil: failed >= 5 ? new Date(Date.now() + LOCK_MS) : null,
            // A locked OTP expires permanently; it cannot be guessed further after the lock lifts.
            ...(failed >= 5 ? { codeExpiresAt: new Date(0) } : {}),
          })
          .where(eq(schema.ussdPockets.id, current.id))
        return new KovaError('invalid_request', 'That code isn’t right.')
      }
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`phone-account:${config.KOVA_NETWORK}:${current.phone}`}))`,
      )
      const account = await tx.query.phoneAccounts.findFirst({
        where: and(
          eq(schema.phoneAccounts.phone, current.phone),
          eq(schema.phoneAccounts.network, config.KOVA_NETWORK),
        ),
      })
      if (account?.wallet && account.wallet !== owner.toLowerCase())
        return new KovaError('conflict', 'That number is already linked to another Kova wallet.')
      const taken = await tx.query.ussdPockets.findFirst({
        where: and(
          eq(schema.ussdPockets.phone, current.phone),
          eq(schema.ussdPockets.status, 'active'),
          ne(schema.ussdPockets.id, current.id),
        ),
      })
      if (taken)
        return new KovaError('conflict', 'That number already pays from another Kova wallet.')
      const [live] = await tx
        .update(schema.ussdPockets)
        .set({
          status: 'active',
          codeHash: null,
          codeExpiresAt: null,
          failedPins: 0,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.ussdPockets.id, current.id))
        .returning()
      return live!
    })
    .catch((error) => {
      const cause = error as { cause?: { code?: string }; code?: string }
      if (cause.code === '23505' || cause.cause?.code === '23505')
        throw new KovaError('conflict', 'That number already pays from another Kova wallet.')
      throw error
    })
  if (result instanceof KovaError) throw result
  sendSmsLater(
    pocket.phone,
    `Kova: this number can now pay by USSD. Dial ${config.KOVA_USSD_CODE}. Enter your PIN only in the USSD menu, never in a message or call.`,
  )
  return result
}

export async function updatePocket(
  pocket: Pocket,
  change: { cap?: bigint; pin?: string; signedAt: number },
): Promise<Pocket> {
  if (change.cap !== undefined && (change.cap <= 0n || change.cap > MAX_CAP))
    throw new KovaError(
      'invalid_request',
      `Choose a daily spending limit up to $${formatAmount(MAX_CAP)}.`,
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
    .where(
      and(
        eq(schema.ussdPockets.id, pocket.id),
        lt(schema.ussdPockets.lastSignedAt, change.signedAt),
      ),
    )
    .returning()
  if (!updated) throw new KovaError('conflict', 'That approval was already used. Try again.')
  return updated
}

export interface PayoutAccount {
  bankCode: string
  bankName: string
  accountNumber: string
  accountName: string
}

/** The one account the phone can cash out to (null removes it). Only the owner's signature sets it. */
export async function setPayout(
  pocket: Pocket,
  account: PayoutAccount | null,
  signedAt: number,
): Promise<Pocket> {
  const [updated] = await db
    .update(schema.ussdPockets)
    .set({
      payoutBankCode: account?.bankCode ?? null,
      payoutBankName: account?.bankName ?? null,
      payoutAccountNumber: account?.accountNumber ?? null,
      payoutAccountName: account?.accountName ?? null,
      lastSignedAt: signedAt,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.ussdPockets.id, pocket.id), lt(schema.ussdPockets.lastSignedAt, signedAt)))
    .returning()
  if (!updated) throw new KovaError('conflict', 'That approval was already used. Try again.')
  return updated
}

export function payoutOf(pocket: Pocket): PayoutAccount | null {
  const { payoutBankCode, payoutBankName, payoutAccountNumber, payoutAccountName } = pocket
  if (!payoutBankCode || !payoutBankName || !payoutAccountNumber || !payoutAccountName) return null
  return {
    bankCode: payoutBankCode,
    bankName: payoutBankName,
    accountNumber: payoutAccountNumber,
    accountName: payoutAccountName,
  }
}

/**
 * How a payout account reads on a small screen: "OPay ••1234". Banks' short names come first
 * ("OPay Digital Services Limited (OPay)" is OPay); a long name is cut at a word.
 */
export function payoutLabel(account: Pick<PayoutAccount, 'bankName' | 'accountNumber'>) {
  const short = account.bankName.match(/\(([^)]+)\)\s*$/)?.[1] ?? account.bankName
  let name = ''
  for (const word of short.trim().split(/\s+/)) {
    if (`${name} ${word}`.trim().length > 20) break
    name = `${name} ${word}`.trim()
  }
  return `${name || short.slice(0, 20)} ••${account.accountNumber.slice(-4)}`
}

/** Turns USSD off for a pocket. Its key stays sealed, so money sent to it later can still come back. */
export async function closePocket(pocket: Pocket, signedAt: number): Promise<void> {
  await db.transaction(async (tx) => {
    const current = await lockedPocket(tx, pocket.id)
    if (signedAt <= current.lastSignedAt)
      throw new KovaError('conflict', 'That approval was already used.')
    const pending = await tx.query.ussdSpends.findFirst({
      where: and(
        eq(schema.ussdSpends.pocketId, current.id),
        eq(schema.ussdSpends.status, 'pending'),
      ),
    })
    if (pending)
      throw new KovaError(
        'conflict',
        'A payment is still confirming. Wait before closing your pocket.',
      )
    if ((await pocketBalance(current)) > 0n)
      throw new KovaError('conflict', 'Return the remaining dollars before closing your pocket.')
    await tx
      .update(schema.ussdPockets)
      .set({ status: 'closed', lastSignedAt: signedAt, updatedAt: new Date() })
      .where(eq(schema.ussdPockets.id, current.id))
  })
}

export type PinCheck = { ok: true } | { ok: false; locked: boolean; triesLeft: number }

/** Three wrong PINs lock the pocket for 15 minutes, and the owner gets a text. */
export async function checkPin(pocket: Pocket, pin: string): Promise<PinCheck> {
  let justLocked = false
  const result = await db.transaction(async (tx) => {
    const current = await lockedPocket(tx, pocket.id)
    if (current.status !== 'active' || (current.lockedUntil && current.lockedUntil > new Date()))
      return { ok: false as const, locked: true, triesLeft: 0 }
    if (await secretMatches(pin, current.pinHash)) {
      await tx
        .update(schema.ussdPockets)
        .set({ failedPins: 0, lockedUntil: null })
        .where(eq(schema.ussdPockets.id, current.id))
      return { ok: true as const }
    }
    const failed =
      (current.lockedUntil && current.lockedUntil <= new Date() ? 0 : current.failedPins) + 1
    justLocked = failed >= PIN_TRIES
    await tx
      .update(schema.ussdPockets)
      .set({ failedPins: failed, lockedUntil: justLocked ? new Date(Date.now() + LOCK_MS) : null })
      .where(eq(schema.ussdPockets.id, current.id))
    return { ok: false as const, locked: justLocked, triesLeft: Math.max(0, PIN_TRIES - failed) }
  })
  if (justLocked)
    sendSmsLater(
      pocket.phone,
      'Kova: three wrong PINs, so USSD payments from this number are paused for 15 minutes. If that wasn’t you, change your PIN in the app.',
    )
  return result
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
  kind: 'till' | 'phone' | 'withdraw' | 'cashout'
  to: Address
  toLabel: string
  amount: bigint
  intent?: PaymentIntent
  /** For a cash-out: the naira payout these dollars pay for. */
  cashOut?: Pick<CashOutRow, 'id'>
}

/**
 * Pays out of a pocket: the pocket's key signs an EIP-3009 transfer, Kova's relayer submits it.
 * One spend per session, so a phone network resending the last step never pays twice. Limits are
 * checked before anything is signed; taking money back to the owner's wallet is never limited.
 */
export async function spend(pocket: Pocket, request: SpendRequest): Promise<Spend> {
  requirePockets()
  if (request.kind !== 'withdraw') requirePocketSetup()
  await reconcilePocket(pocket)
  const reservation = await reserve(pocket, request).catch(async (error: unknown) => {
    // Refused before anything was signed (a limit, the balance): its cash-out ends here, unpaid.
    if (request.cashOut && !(error instanceof KovaError && error.code === 'idempotency_conflict'))
      await dropPocketCashOut(
        request.cashOut.id,
        error instanceof KovaError ? error.message : 'Refused.',
      )
    throw error
  })
  if (!reservation.fresh) return reservation.row
  return send(reservation.row, reservation.current, request)
}

/** Checks the limits and holds the amount: one row per session, inside the pocket's lock. */
function reserve(pocket: Pocket, request: SpendRequest) {
  return db.transaction(async (tx) => {
    const current = await lockedPocket(tx, pocket.id)
    const existing = await tx.query.ussdSpends.findFirst({
      where: eq(schema.ussdSpends.sessionId, request.sessionId),
    })
    if (existing) {
      if (
        existing.pocketId !== current.id ||
        existing.kind !== request.kind ||
        existing.toAddress !== request.to.toLowerCase() ||
        existing.amount !== request.amount ||
        existing.intentId !== (request.intent?.id ?? null) ||
        existing.cashOutId !== (request.cashOut?.id ?? null)
      )
        throw new KovaError(
          'idempotency_conflict',
          'That session already approved a different payment.',
        )
      return { row: existing, fresh: false, current }
    }
    if (request.amount <= 0n || (request.kind !== 'withdraw' && request.amount < 10_000n))
      throw new KovaError('invalid_request', 'Send at least a cent.')
    if (request.kind === 'withdraw') {
      if (!isAddressEqual(request.to, current.ownerAddress as Address))
        throw new KovaError('forbidden', 'Money can only be returned to the owning wallet.')
    } else {
      if (current.status !== 'active') throw new KovaError('conflict', 'This pocket is not active.')
      if (current.pinHash !== pocket.pinHash)
        throw new KovaError('conflict', 'Your PIN changed. Dial again.')
      if (current.lockedUntil && current.lockedUntil > new Date())
        throw new KovaError('rate_limited', 'This pocket is locked. Try again in 15 minutes.')
      const [used] = await tx
        .select({ total: sql<string>`coalesce(sum(${schema.ussdSpends.amount}),0)` })
        .from(schema.ussdSpends)
        .where(
          and(
            eq(schema.ussdSpends.pocketId, current.id),
            ne(schema.ussdSpends.kind, 'withdraw'),
            ne(schema.ussdSpends.status, 'failed'),
            gt(schema.ussdSpends.createdAt, new Date(Date.now() - 86_400_000)),
          ),
        )
      if (BigInt(used?.total ?? '0') + request.amount > current.cap)
        throw new KovaError(
          'rate_limited',
          `That’s over your $${formatAmount(current.cap)} daily limit.`,
        )
    }
    const [reserved] = await tx
      .select({ total: sql<string>`coalesce(sum(${schema.ussdSpends.amount}),0)` })
      .from(schema.ussdSpends)
      .where(
        and(eq(schema.ussdSpends.pocketId, current.id), eq(schema.ussdSpends.status, 'pending')),
      )
    if ((await pocketBalance(current)) - BigInt(reserved?.total ?? '0') < request.amount)
      throw new KovaError(
        'policy_declined',
        'Your pocket doesn’t have enough available dollars. A payment may still be confirming.',
      )
    const [row] = await tx
      .insert(schema.ussdSpends)
      .values({
        id: uuidv7(),
        pocketId: current.id,
        sessionId: request.sessionId,
        kind: request.kind,
        toAddress: request.to.toLowerCase(),
        toLabel: request.toLabel,
        amount: request.amount,
        intentId: request.intent?.id ?? null,
        cashOutId: request.cashOut?.id ?? null,
        reference: reference(),
      })
      .onConflictDoNothing()
      .returning()
    if (!row) throw new KovaError('idempotency_conflict', 'That session is already processing.')
    return { row, fresh: true, current }
  })
}

/** Signs the reserved spend with the pocket's key and has the relayer submit it. */
async function send(row: Spend, current: Pocket, request: SpendRequest): Promise<Spend> {
  let preparedHash: Hex | undefined
  try {
    const account = privateKeyToAccount(openKey(current.sealedKey, current.id))
    const authorization = {
      from: account.address,
      to: getAddress(request.to),
      value: request.amount,
      validAfter: 0n,
      validBefore: BigInt(Math.floor(row.createdAt.getTime() / 1000) + 300),
      nonce: spendNonce(current.id, request.sessionId, memoOf(request)),
    }
    const signature = await account.signTypedData(
      transferAuthorizationTypedData(settlementToken, network.chainId, authorization),
    )
    const { receipt } = await relayAuthorization(settlementToken, authorization, signature, {
      beforeBroadcast: async (hash) => {
        const [saved] = await db
          .update(schema.ussdSpends)
          .set({ txHash: hash, updatedAt: new Date() })
          .where(and(eq(schema.ussdSpends.id, row.id), eq(schema.ussdSpends.status, 'pending')))
          .returning()
        if (!saved) throw new KovaError('conflict', 'That payment reservation expired. Dial again.')
        preparedHash = hash
      },
    })
    return await recordPocketReceipt(current, { ...row, txHash: receipt.transactionHash }, receipt)
  } catch (error) {
    const detailsHash = error instanceof KovaError ? error.details?.tx_hash : undefined
    const hash =
      preparedHash ??
      (typeof detailsHash === 'string' && /^0x[\da-f]{64}$/i.test(detailsHash)
        ? (detailsHash as Hex)
        : undefined)
    if (hash) {
      const [pending] = await db
        .update(schema.ussdSpends)
        .set({ txHash: hash, updatedAt: new Date() })
        .where(and(eq(schema.ussdSpends.id, row.id), eq(schema.ussdSpends.status, 'pending')))
        .returning()
      if (pending) return await reconcileSpend(current, pending)
      return (await db.query.ussdSpends.findFirst({ where: eq(schema.ussdSpends.id, row.id) }))!
    }
    // No hash was ever persisted or broadcast: this is a definite pre-broadcast failure.
    const message =
      error instanceof KovaError ? error.message : 'The payment could not be prepared.'
    if (row.cashOutId) await dropPocketCashOut(row.cashOutId, message.slice(0, 500))
    await db
      .update(schema.ussdSpends)
      .set({ status: 'failed', failure: message.slice(0, 500), updatedAt: new Date() })
      .where(
        and(
          eq(schema.ussdSpends.id, row.id),
          eq(schema.ussdSpends.status, 'pending'),
          isNull(schema.ussdSpends.txHash),
        ),
      )
    throw error
  }
}

/** A spend's Kova memo: its charge's, or its cash-out's, so the transfer names what it pays for. */
function memoOf(spend: { intent?: PaymentIntent; cashOut?: Pick<CashOutRow, 'id'> }) {
  if (spend.intent) return spend.intent.memo
  if (spend.cashOut) return encodeMemo({ kind: 'cashout', id: spend.cashOut.id })
  return null
}

/** The EIP-3009 nonce a spend is signed with: its memo, or one per pocket and session. */
function spendNonce(pocketId: string, sessionId: string, memo?: string | null): Hex {
  return memo ? (memo as Hex) : keccak256(toHex(JSON.stringify([pocketId, sessionId])))
}

/**
 * A broadcast spend with no receipt after its authorization expired. If the token says the
 * authorization was never used, no transaction can ever carry it now (validBefore has passed),
 * so the reservation is released. If it was used, a receipt is still coming: stay pending.
 */
async function expireUnminedSpend(pocket: Pocket, row: Spend): Promise<Spend | null> {
  if (row.createdAt.getTime() + 330_000 >= Date.now()) return null
  let memo: string | null = null
  if (row.intentId) {
    const intent = await db.query.paymentIntents.findFirst({
      where: eq(schema.paymentIntents.id, row.intentId),
    })
    if (!intent) return null
    memo = intent.memo
  }
  if (row.cashOutId) memo = memoOf({ cashOut: { id: row.cashOutId } })
  const used = await publicClient
    .readContract({
      address: settlementToken.address,
      abi: eip3009Abi,
      functionName: 'authorizationState',
      args: [getAddress(pocket.pocketAddress), spendNonce(pocket.id, row.sessionId, memo)],
    })
    .catch(() => null)
  if (used !== false) return null // used, or the RPC didn't answer: decide on a later pass
  const [expired] = await db
    .update(schema.ussdSpends)
    .set({
      status: 'failed',
      failure: 'The payment was not confirmed on Monad and has expired. No money moved.',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.ussdSpends.id, row.id),
        eq(schema.ussdSpends.status, 'pending'),
        eq(schema.ussdSpends.txHash, row.txHash!),
      ),
    )
    .returning()
  if (expired?.cashOutId) await dropPocketCashOut(expired.cashOutId, expired.failure ?? 'Expired.')
  return expired ?? null
}

async function recordPocketReceipt(
  pocket: Pocket,
  row: Spend,
  receipt: TransactionReceipt,
): Promise<Spend> {
  const matches =
    receipt.status === 'success' &&
    parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: receipt.logs }).some(
      (log) =>
        isAddressEqual(log.address, settlementToken.address) &&
        isAddressEqual(log.args.from, pocket.pocketAddress as Address) &&
        isAddressEqual(log.args.to, row.toAddress as Address) &&
        log.args.value === row.amount,
    )
  if (matches && row.intentId) await settleFromReceipt(receipt)
  const [updated] = await db
    .update(schema.ussdSpends)
    .set({
      status: matches ? 'paid' : 'failed',
      txHash: receipt.transactionHash,
      failure: matches ? null : 'The transaction did not complete this payment.',
      updatedAt: new Date(),
    })
    .where(and(eq(schema.ussdSpends.id, row.id), eq(schema.ussdSpends.status, 'pending')))
    .returning()
  if (updated?.status === 'paid') notifySpend(pocket, updated)
  if (updated?.cashOutId) {
    if (updated.status === 'paid')
      // The naira goes out in the background: the phone's screen has seconds, Paystack may take more.
      void receivePocketCashOut(updated.cashOutId, receipt.transactionHash).catch((error) =>
        console.error('[ussd] cash-out payout failed', updated.cashOutId, error),
      )
    else await dropPocketCashOut(updated.cashOutId, updated.failure ?? 'The payment failed.')
  }
  return (
    updated ?? (await db.query.ussdSpends.findFirst({ where: eq(schema.ussdSpends.id, row.id) }))!
  )
}

async function reconcileSpend(pocket: Pocket, row: Spend): Promise<Spend> {
  if (!row.txHash) {
    if (row.createdAt.getTime() + 330_000 < Date.now()) {
      // The authorization expired, and beforeBroadcast cannot proceed once this CAS wins.
      const [expired] = await db
        .update(schema.ussdSpends)
        .set({
          status: 'failed',
          failure: 'The payment expired before it was sent.',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.ussdSpends.id, row.id),
            eq(schema.ussdSpends.status, 'pending'),
            isNull(schema.ussdSpends.txHash),
          ),
        )
        .returning()
      if (expired) {
        if (expired.cashOutId)
          await dropPocketCashOut(expired.cashOutId, 'Expired before it was sent.')
        return expired
      }
    }
    await db
      .update(schema.ussdSpends)
      .set({ updatedAt: new Date() })
      .where(and(eq(schema.ussdSpends.id, row.id), eq(schema.ussdSpends.status, 'pending')))
    return row
  }
  const receipt = await publicClient
    .getTransactionReceipt({ hash: row.txHash as Hex })
    .catch(() => null)
  if (receipt) return recordPocketReceipt(pocket, row, receipt)
  const expired = await expireUnminedSpend(pocket, row)
  if (expired) return expired
  await db
    .update(schema.ussdSpends)
    .set({ updatedAt: new Date() })
    .where(and(eq(schema.ussdSpends.id, row.id), eq(schema.ussdSpends.status, 'pending')))
  return row
}

let checkingPending = false
/** Recover delayed confirmations even after the user closes the browser or USSD session. */
export async function reconcilePendingPockets(): Promise<void> {
  if (checkingPending) return
  checkingPending = true
  try {
    const pending = await db.query.ussdSpends.findMany({
      where: eq(schema.ussdSpends.status, 'pending'),
      orderBy: (spends, { asc }) => [asc(spends.updatedAt)],
      limit: 50,
    })
    if (!pending.length) return
    const ids = [...new Set(pending.map((row) => row.pocketId))]
    const pockets = await db.query.ussdPockets.findMany({
      where: inArray(schema.ussdPockets.id, ids),
    })
    const byId = new Map(pockets.map((pocket) => [pocket.id, pocket]))
    const results = await Promise.allSettled(
      pending.map((row) => {
        const pocket = byId.get(row.pocketId)
        return pocket ? reconcileSpend(pocket, row) : Promise.resolve(row)
      }),
    )
    const failed = results.filter((result) => result.status === 'rejected').length
    if (failed) console.warn('[ussd] Pending receipt checks failed:', failed)
  } finally {
    checkingPending = false
  }
}

export async function reconcilePocket(pocket: Pocket): Promise<void> {
  const pending = await db.query.ussdSpends.findMany({
    where: and(eq(schema.ussdSpends.pocketId, pocket.id), eq(schema.ussdSpends.status, 'pending')),
    limit: 50,
  })
  await Promise.all(pending.map((row) => reconcileSpend(pocket, row)))
}

const maskPhone = (phone: string) => `${phone.slice(0, 4)}…${phone.slice(-3)}`
function notifySpend(pocket: Pocket, row: Spend): void {
  // A cash-out texts once the naira lands, or once its dollars are back (whenCashOutEnds, below).
  if (row.kind === 'cashout') return
  const to = row.kind === 'phone' ? maskPhone(row.toLabel) : row.toLabel
  sendSmsLater(
    pocket.phone,
    `Kova: ${row.kind === 'withdraw' ? 'returned' : 'paid'} $${formatAmount(row.amount)} to ${to}. Ref ${row.reference}.`,
  )
  if (row.kind === 'phone')
    sendSmsLater(
      row.toLabel,
      `Kova: you got $${formatAmount(row.amount)} from ${maskPhone(pocket.phone)}. Ref ${row.reference}. It’s in your Kova wallet.`,
    )
}

whenCashOutEnds(async (cashOut) => {
  const row = await db.query.ussdSpends.findFirst({
    where: eq(schema.ussdSpends.cashOutId, cashOut.id),
  })
  // Only a cash-out whose dollars left the pocket is news: one that never started was said on screen.
  if (!row || row.status !== 'paid') return
  const pocket = await db.query.ussdPockets.findFirst({
    where: eq(schema.ussdPockets.id, row.pocketId),
  })
  if (!pocket) return
  sendSmsLater(
    pocket.phone,
    cashOut.status === 'paid'
      ? `Kova: ${formatNaira(cashOut.naira)} sent to ${row.toLabel} for your $${formatAmount(row.amount)}. Ref ${row.reference}.`
      : `Kova: your cash-out of $${formatAmount(row.amount)} didn’t reach ${row.toLabel}, so the dollars are back in your pocket. Ref ${row.reference}.`,
  )
})

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
    to: row.kind === 'phone' ? maskPhone(row.toLabel) : row.toLabel,
    amount: formatAmount(row.amount),
    status: row.status,
    tx_hash: row.txHash,
    created_at: row.createdAt.toISOString(),
  }
}

export async function serializePocket(pocket: Pocket) {
  await reconcilePocket(pocket)
  const [balance, spent, spends] = await Promise.all([
    pocketBalance(pocket).catch(() => null),
    spentToday(pocket),
    recentSpends(pocket),
  ])
  const payout = payoutOf(pocket)
  return {
    object: 'ussd_pocket',
    status: pocket.status,
    phone: maskPhone(pocket.phone),
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
    payout: payout
      ? {
          label: payoutLabel(payout),
          bank_name: payout.bankName,
          account_name: payout.accountName,
          account_last4: payout.accountNumber.slice(-4),
        }
      : null,
    cash_out: nairaReady(),
    spends: spends.map(serializeSpend),
  }
}

/* ── Till codes ─────────────────────────────────────────────────────────────────────────────── */

/** The 6-digit code a till shows for a charge, made on first ask, gone when the charge expires. */
export async function tillCodeFor(intent: PaymentIntent): Promise<string | null> {
  if (
    !pocketsReady() ||
    intent.status !== 'requires_payment' ||
    intent.expiresAt < new Date() ||
    intent.network !== config.KOVA_NETWORK ||
    !isAddressEqual(intent.tokenAddress as Address, settlementToken.address) ||
    intent.amount < 10_000n ||
    typeof intent.metadata?.payer === 'string'
  )
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
  if (
    !intent ||
    intent.status !== 'requires_payment' ||
    intent.expiresAt < new Date() ||
    intent.network !== config.KOVA_NETWORK ||
    !isAddressEqual(intent.tokenAddress as Address, settlementToken.address) ||
    intent.amount < 10_000n ||
    typeof intent.metadata?.payer === 'string'
  )
    return null
  const merchant = await db.query.merchants.findFirst({
    where: eq(schema.merchants.id, intent.merchantId),
  })
  return { intent, merchantName: merchant?.name ?? 'the shop' }
}

/** Pockets that a phone send can land in: the owner's main wallet behind a verified number. */
export async function walletForPhone(phone: string): Promise<Address | null> {
  return verifiedWalletForPhone(phone)
}
