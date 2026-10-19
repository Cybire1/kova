import { randomInt } from 'node:crypto'
import { schema, uuidv7 } from '@kova/db'
import {
  eip3009Abi,
  formatAmount,
  type PhoneApproval,
  type PhonePayment,
  type PhoneResolution,
  parseAmount,
  phoneInput,
  phoneMessage,
  phonePaymentNonce,
  transferAuthorizationTypedData,
} from '@kova/monad'
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import {
  type Address,
  erc20Abi,
  getAddress,
  type Hex,
  isAddressEqual,
  parseEventLogs,
  recoverMessageAddress,
  type TransactionReceipt,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { network, publicClient, settlementToken } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { KovaError } from '../errors.js'
import { decodeId, encodeId } from '../ids.js'
import { relayAuthorization, relayReady } from '../relay.js'
import { hashSecret, openKey, sealKey, secretMatches } from '../secrets.js'
import { sendSms, smsReady } from './sms.js'

type Payment = typeof schema.paymentLinks.$inferSelect
const rows = schema.paymentLinks
const accounts = schema.phoneAccounts
export const phonePaymentsReady = () =>
  Boolean(
    config.KOVA_PHONE_SEND_ENABLED === '1' &&
      config.KOVA_POCKET_MASTER_KEY &&
      smsReady() &&
      relayReady() &&
      (config.KOVA_NETWORK !== 'testnet' || config.AT_USERNAME === 'sandbox'),
  )
export function requirePhonePayments() {
  if (!phonePaymentsReady())
    throw new KovaError(
      'conflict',
      'Sending to a phone number isn’t available on this network yet.',
    )
}
export async function checkPhoneApproval(p: PhoneApproval, signature: Hex) {
  if (p.chainId !== network.chainId || Math.abs(Math.floor(Date.now() / 1000) - p.signedAt) > 300)
    throw new KovaError(
      'invalid_request',
      'That approval expired or belongs to another network. Try again.',
    )
  const signer = await recoverMessageAddress({ message: phoneMessage(p), signature }).catch(
    () => null,
  )
  if (!signer || !isAddressEqual(signer, p.wallet))
    throw new KovaError('forbidden', 'Approve this action with your Kova wallet.')
}
export function checkedPhone(input?: string) {
  const phone = input ? phoneInput(input) : null
  if (!phone || phone !== input)
    throw new KovaError(
      'invalid_request',
      'Enter the number with its country code, for example +2348012345678.',
    )
  return phone
}
async function phoneRegistration(phone: string) {
  const [account, pocket] = await Promise.all([
    db.query.phoneAccounts.findFirst({
      where: and(eq(accounts.phone, phone), eq(accounts.network, config.KOVA_NETWORK)),
    }),
    db.query.ussdPockets.findFirst({
      where: and(eq(schema.ussdPockets.phone, phone), eq(schema.ussdPockets.status, 'active')),
    }),
  ])
  // Conflicting identities never silently send to one of the wallets.
  if (account?.wallet && pocket && account.wallet !== pocket.ownerAddress)
    return { wallet: null, pocket: null }
  const wallet = account?.wallet ?? pocket?.ownerAddress
  return { wallet: wallet ? getAddress(wallet) : null, pocket }
}

/** Wallet identity remains separate from the address used to receive a phone payment. */
export async function verifiedWalletForPhone(phone: string): Promise<Address | null> {
  return (await phoneRegistration(phone)).wallet
}

export async function phonePaymentDestination(phone: string): Promise<PhoneResolution> {
  const { wallet, pocket } = await phoneRegistration(phone)
  if (!wallet) return { address: null, destination: null }
  if (pocket && config.KOVA_USSD_ENABLED === '1')
    return { address: getAddress(pocket.pocketAddress), destination: 'ussd-pocket' }
  return { address: wallet, destination: 'wallet' }
}
export async function phonePayment(id: string): Promise<Payment> {
  const uuid = decodeId('paymentLink', id)
  const row = uuid
    ? await db.query.paymentLinks.findFirst({
        where: and(
          eq(rows.id, uuid),
          eq(rows.network, config.KOVA_NETWORK),
          isNotNull(rows.recipientPhone),
        ),
      })
    : undefined
  if (!row) throw new KovaError('not_found', 'This phone payment doesn’t exist on this network.')
  return row
}
const origin = () =>
  (
    config.KOVA_PHONE_WEB_URL ??
    (config.KOVA_NETWORK === 'testnet' ? 'https://web-monad.up.railway.app' : 'https://mykova.app')
  ).replace(/\/$/, '')
export function serializePhonePayment(row: Payment): PhonePayment {
  const id = encodeId('paymentLink', row.id)
  return {
    id,
    network: row.network,
    status: row.status as PhonePayment['status'],
    amount: formatAmount(row.amount),
    phone: `${row.recipientPhone!.slice(0, 4)}…${row.recipientPhone!.slice(-3)}`,
    address: getAddress(row.linkAddress),
    sender: getAddress(row.senderAddress),
    sender_name: row.senderName,
    note: row.note,
    url: `${origin()}/wallet/phone/${id}`,
    sms_sent: Boolean(row.phoneSmsSentAt),
    tx_hash: row.claimTx as Hex | null,
  }
}
async function held(row: Payment) {
  return publicClient.readContract({
    address: settlementToken.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [getAddress(row.linkAddress)],
  })
}
export async function reservePhonePayment(p: PhoneApproval, key: Hex) {
  requirePhonePayments()
  const phone = checkedPhone(p.phone)
  if (!p.address || privateKeyToAccount(key).address.toLowerCase() !== p.address.toLowerCase())
    throw new KovaError('invalid_request', 'The payment address doesn’t match its recovery key.')
  const amount = parseAmount(p.amount ?? '0')
  if (amount < 10_000n || amount > 200_000_000n)
    throw new KovaError('invalid_request', 'Send between $0.01 and $200 to a phone number.')
  const existing = await db.query.paymentLinks.findFirst({
    where: eq(rows.linkAddress, p.address.toLowerCase()),
  })
  if (existing) {
    if (
      existing.recipientPhone !== phone ||
      existing.senderAddress !== p.wallet.toLowerCase() ||
      existing.amount !== amount ||
      existing.network !== config.KOVA_NETWORK
    )
      throw new KovaError('idempotency_conflict', 'That payment address is already in use.')
    return existing
  }
  const id = uuidv7()
  return db.transaction(async (tx) => {
    await tx
      .insert(accounts)
      .values({ id: uuidv7(), network: config.KOVA_NETWORK, phone })
      .onConflictDoNothing()
    const [created] = await tx
      .insert(rows)
      .values({
        id,
        network: config.KOVA_NETWORK,
        linkAddress: p.address!.toLowerCase(),
        senderAddress: p.wallet.toLowerCase(),
        senderName: p.name || null,
        note: p.note || null,
        amount,
        status: 'funding',
        recipientPhone: phone,
        phoneKey: sealKey(key, `phone:${id}`),
      })
      .onConflictDoNothing({ target: rows.linkAddress })
      .returning()
    if (created) return created
    const existing = await tx.query.paymentLinks.findFirst({
      where: eq(rows.linkAddress, p.address!.toLowerCase()),
    })
    if (
      !existing ||
      existing.recipientPhone !== phone ||
      existing.senderAddress !== p.wallet.toLowerCase() ||
      existing.amount !== amount ||
      existing.network !== config.KOVA_NETWORK
    )
      throw new KovaError('idempotency_conflict', 'That payment address is already in use.')
    return existing
  })
}
export async function confirmPhoneFunding(row: Payment): Promise<Payment> {
  if (row.status !== 'funding') return row
  const balance = await held(row)
  if (balance < row.amount) return row
  const [updated] = await db
    .update(rows)
    .set({ status: 'open' })
    .where(and(eq(rows.id, row.id), eq(rows.status, 'funding')))
    .returning()
  return updated ?? phonePayment(encodeId('paymentLink', row.id))
}
export async function invitePhoneRecipient(row: Payment, resend = false) {
  if (!phonePaymentsReady()) return row
  if (row.status !== 'open' || (row.phoneSmsSentAt && !resend)) return row
  if (row.phoneSmsSentAt && Date.now() - row.phoneSmsSentAt.getTime() < 60_000)
    throw new KovaError('rate_limited', 'Wait a minute before sending another invitation.')
  const preview = serializePhonePayment(row)
  const [attempt] = await db
    .update(rows)
    .set({ phoneSmsAttemptAt: new Date() })
    .where(
      and(
        eq(rows.id, row.id),
        eq(rows.status, 'open'),
        sql`(${rows.phoneSmsAttemptAt} is null or ${rows.phoneSmsAttemptAt} < now() - interval '60 seconds')`,
      ),
    )
    .returning()
  if (!attempt) return phonePayment(preview.id)
  // No spending key in the invitation. Opening the URL alone cannot move the dollars.
  await sendSms(
    row.recipientPhone!,
    `Kova${config.KOVA_NETWORK === 'testnet' ? ' TEST' : ''}: ${row.senderName?.slice(0, 40) || 'Someone'} sent you $${preview.amount}. Verify your number to claim: ${preview.url}`,
  )
  const [updated] = await db
    .update(rows)
    .set({ phoneSmsSentAt: new Date() })
    .where(eq(rows.id, row.id))
    .returning()
  return updated!
}
export async function requestPhoneCode(row: Payment, wallet: Address, phone: string) {
  requirePhonePayments()
  if (row.status !== 'open' || phone !== row.recipientPhone)
    throw new KovaError(
      'invalid_request',
      'Check the phone number and whether this payment is still waiting.',
    )
  const mapped = await verifiedWalletForPhone(phone)
  if (mapped && !isAddressEqual(mapped, wallet))
    throw new KovaError(
      'conflict',
      'This number is linked to another wallet. Open that Kova wallet to claim.',
    )
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const hash = await hashSecret(code)
  await db.transaction(async (tx) => {
    // One open challenge per number and wallet, even across app servers and invites. A code
    // requested by some other wallet (anyone holding the invite link) doesn't lock the recipient
    // out; the route's per-number limit keeps the total texts down.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`phone-otp:${config.KOVA_NETWORK}:${phone}`}))`,
    )
    const recent = await tx
      .select({ id: rows.id })
      .from(rows)
      .where(
        and(
          eq(rows.recipientPhone, phone),
          eq(rows.network, config.KOVA_NETWORK),
          eq(rows.phoneCodeWallet, wallet.toLowerCase()),
          isNotNull(rows.phoneCodeHash),
          sql`${rows.phoneCodeExpiresAt} > now()`,
        ),
      )
    if (recent.length)
      throw new KovaError(
        'rate_limited',
        'A code was already requested. Use it, or wait 10 minutes before requesting another.',
      )
    const [fresh] = await tx.select().from(rows).where(eq(rows.id, row.id)).for('update')
    if (fresh?.status !== 'open')
      throw new KovaError('conflict', 'This payment is no longer waiting.')
    await tx
      .update(rows)
      .set({
        phoneCodeHash: hash,
        phoneCodeExpiresAt: new Date(Date.now() + 600_000),
        phoneCodeTries: 0,
        phoneCodeWallet: wallet.toLowerCase(),
        phoneVerifiedWallet: null,
      })
      .where(eq(rows.id, row.id))
    // Keep the lock until provider acceptance, so a failed delivery rolls the challenge back.
    await sendSms(
      phone,
      `Kova${config.KOVA_NETWORK === 'testnet' ? ' TEST' : ''}: ${code} verifies your number to claim $${formatAmount(row.amount)}. Expires in 10 minutes. Do not share this code.`,
    )
  })
}
export async function verifyPhoneCode(row: Payment, wallet: Address, phone: string, code: string) {
  const error = await db.transaction(async (tx) => {
    const [fresh] = await tx.select().from(rows).where(eq(rows.id, row.id)).for('update')
    if (
      !fresh ||
      fresh.status !== 'open' ||
      phone !== fresh.recipientPhone ||
      fresh.phoneCodeWallet !== wallet.toLowerCase() ||
      !fresh.phoneCodeHash ||
      !fresh.phoneCodeExpiresAt ||
      fresh.phoneCodeExpiresAt.getTime() < Date.now() ||
      fresh.phoneCodeTries >= 5
    )
      return new KovaError(
        'invalid_request',
        'The verification code expired or is locked. Request a new code after its 10-minute window.',
      )
    if (!(await secretMatches(code, fresh.phoneCodeHash))) {
      await tx
        .update(rows)
        .set({ phoneCodeTries: fresh.phoneCodeTries + 1 })
        .where(eq(rows.id, row.id))
      return new KovaError('invalid_request', 'That verification code isn’t right.')
    }
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`phone-account:${config.KOVA_NETWORK}:${phone}`}))`,
    )
    const [account] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.phone, phone), eq(accounts.network, config.KOVA_NETWORK)))
      .for('update')
    const pocket = await tx.query.ussdPockets.findFirst({
      where: and(eq(schema.ussdPockets.phone, phone), eq(schema.ussdPockets.status, 'active')),
    })
    if (
      (account?.wallet && account.wallet !== wallet.toLowerCase()) ||
      (pocket && pocket.ownerAddress !== wallet.toLowerCase())
    )
      return new KovaError('conflict', 'This number is already linked to another Kova wallet.')
    await tx
      .update(accounts)
      .set({ wallet: wallet.toLowerCase(), verifiedAt: new Date() })
      .where(eq(accounts.id, account!.id))
    await tx
      .update(rows)
      .set({
        phoneVerifiedWallet: wallet.toLowerCase(),
        phoneCodeHash: null,
        phoneCodeExpiresAt: null,
      })
      .where(eq(rows.id, row.id))
    return null
  })
  // Failed attempts must COMMIT; throwing inside the transaction would erase them.
  if (error) throw error
}
function transferMatches(row: Payment, receipt: TransactionReceipt) {
  return (
    receipt.status === 'success' &&
    parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: receipt.logs }).some(
      (event) =>
        event.address.toLowerCase() === settlementToken.address.toLowerCase() &&
        event.args.from.toLowerCase() === row.linkAddress &&
        event.args.to.toLowerCase() === row.phoneOperationTo &&
        event.args.value === row.amount,
    )
  )
}
/**
 * A claim or return that was broadcast but never mined. Once its authorization has expired and the
 * token says it was never used, no transaction can carry it any more: clear the hash so the worker
 * signs a fresh one. The destination stays locked, as for a revert.
 */
async function releaseUnminedClaim(row: Payment): Promise<Payment | null> {
  if (!row.claimTx || !row.phoneOperationAt) return null
  if (row.phoneOperationAt + 330 >= Math.floor(Date.now() / 1000)) return null
  const used = await publicClient
    .readContract({
      address: settlementToken.address,
      abi: eip3009Abi,
      functionName: 'authorizationState',
      args: [
        getAddress(row.linkAddress),
        phonePaymentNonce(network.chainId, encodeId('paymentLink', row.id)),
      ],
    })
    .catch(() => null)
  if (used !== false) return null // used (a receipt is coming), or the RPC didn't answer
  const [updated] = await db
    .update(rows)
    .set({ claimTx: null, phoneOperationAt: null })
    .where(and(eq(rows.id, row.id), eq(rows.claimTx, row.claimTx)))
    .returning()
  return updated ?? null
}

export async function reconcilePhonePayment(row: Payment): Promise<Payment> {
  if (!['claiming', 'returning'].includes(row.status) || !row.claimTx) return row
  const receipt = await publicClient
    .getTransactionReceipt({ hash: row.claimTx as Hex })
    .catch(() => null)
  if (!receipt) return (await releaseUnminedClaim(row)) ?? row
  if (receipt.status === 'reverted') {
    // Keep the chosen destination locked; a retry cannot redirect an uncertain authorization.
    const [updated] = await db
      .update(rows)
      .set({ claimTx: null, phoneOperationAt: null })
      .where(and(eq(rows.id, row.id), eq(rows.claimTx, row.claimTx)))
      .returning()
    return updated ?? row
  }
  if (!transferMatches(row, receipt))
    throw new KovaError('chain_error', 'The receipt does not match this phone payment.')
  const [updated] = await db
    .update(rows)
    .set({
      status: row.status === 'returning' ? 'returned' : 'claimed',
      claimedBy: row.phoneOperationTo,
      claimedAt: new Date(),
    })
    .where(and(eq(rows.id, row.id), eq(rows.status, row.status), eq(rows.claimTx, row.claimTx)))
    .returning()
  return updated ?? phonePayment(encodeId('paymentLink', row.id))
}
export async function finishPhonePayment(
  row: Payment,
  wallet: Address,
  returning: boolean,
): Promise<Payment> {
  if (!config.KOVA_POCKET_MASTER_KEY)
    throw new KovaError('conflict', 'Phone payment recovery is unavailable.')
  if (returning && !isAddressEqual(wallet, getAddress(row.senderAddress)))
    throw new KovaError('forbidden', 'Only the sender can take this payment back.')
  if (!returning && row.phoneVerifiedWallet !== wallet.toLowerCase())
    throw new KovaError('forbidden', 'Verify the recipient phone number with this wallet first.')
  row = await reconcilePhonePayment(row)
  if (['claimed', 'returned'].includes(row.status)) return row
  row = await db.transaction(async (tx) => {
    const [fresh] = await tx.select().from(rows).where(eq(rows.id, row.id)).for('update')
    if (!fresh) throw new KovaError('not_found', 'Payment not found.')
    if (
      fresh.phoneOperationTo &&
      (fresh.phoneOperationTo !== wallet.toLowerCase() ||
        fresh.status !== (returning ? 'returning' : 'claiming'))
    )
      throw new KovaError(
        'conflict',
        'This payment is already being claimed or returned. Check its status.',
      )
    if (!['open', 'funding', 'claiming', 'returning'].includes(fresh.status)) return fresh
    const balance = await held(fresh)
    if (fresh.status === 'funding' && returning && balance > 0n) fresh.amount = balance
    if (balance < fresh.amount)
      throw new KovaError(
        'conflict',
        'The funds have not arrived yet, or settlement is still confirming.',
      )
    const at =
      fresh.phoneOperationAt && fresh.phoneOperationAt + 330 > Math.floor(Date.now() / 1000)
        ? fresh.phoneOperationAt
        : Math.floor(Date.now() / 1000)
    const [updated] = await tx
      .update(rows)
      .set({
        amount: fresh.amount,
        status: returning ? 'returning' : 'claiming',
        phoneOperationTo: wallet.toLowerCase(),
        phoneOperationAt: at,
      })
      .where(eq(rows.id, fresh.id))
      .returning()
    return updated!
  })
  if (['claimed', 'returned'].includes(row.status) || row.claimTx) return row
  const account = privateKeyToAccount(openKey(row.phoneKey!, `phone:${row.id}`))
  const authorization = {
    from: account.address,
    to: wallet,
    value: row.amount,
    validAfter: 0n,
    validBefore: BigInt(row.phoneOperationAt! + 300),
    nonce: phonePaymentNonce(network.chainId, encodeId('paymentLink', row.id)),
  }
  if (authorization.validBefore <= BigInt(Math.floor(Date.now() / 1000) + 5)) return row
  const signature = await account.signTypedData(
    transferAuthorizationTypedData(settlementToken, network.chainId, authorization),
  )
  try {
    const { receipt } = await relayAuthorization(settlementToken, authorization, signature, {
      beforeBroadcast: async (hash) => {
        await db
          .update(rows)
          .set({ claimTx: hash })
          .where(and(eq(rows.id, row.id), eq(rows.phoneOperationTo, wallet.toLowerCase())))
      },
    })
    const fresh = await phonePayment(encodeId('paymentLink', row.id))
    // Also supports immediate receipts from RPCs that lag on getTransactionReceipt.
    if (transferMatches(fresh, receipt)) {
      await db
        .update(rows)
        .set({
          status: returning ? 'returned' : 'claimed',
          claimedBy: wallet.toLowerCase(),
          claimedAt: new Date(),
        })
        .where(and(eq(rows.id, row.id), eq(rows.status, returning ? 'returning' : 'claiming')))
    }
  } catch {
    // Never free the reservation on an unknown broadcast; the background worker recovers it.
  }
  return phonePayment(encodeId('paymentLink', row.id))
}
let recovering = false
export async function recoverPhonePayments() {
  if (recovering || !config.KOVA_POCKET_MASTER_KEY) return
  recovering = true
  try {
    const pending = await db.query.paymentLinks.findMany({
      where: and(
        eq(rows.network, config.KOVA_NETWORK),
        isNotNull(rows.recipientPhone),
        sql`(${rows.status} in ('funding', 'claiming', 'returning') or (${rows.status} = 'open' and ${rows.phoneSmsSentAt} is null))`,
      ),
      limit: 30,
      // Never-checked rows first (Postgres sorts NULLs last by default), then the longest-waiting.
      orderBy: sql`${rows.phoneCheckedAt} asc nulls first`,
    })
    for (const item of pending) {
      try {
        await db.update(rows).set({ phoneCheckedAt: new Date() }).where(eq(rows.id, item.id))
        let row = await confirmPhoneFunding(item)
        row = await reconcilePhonePayment(row)
        if (row.status === 'open' && !row.phoneSmsSentAt) await invitePhoneRecipient(row)
        if (['claiming', 'returning'].includes(row.status) && !row.claimTx && row.phoneOperationTo)
          await finishPhonePayment(
            row,
            getAddress(row.phoneOperationTo),
            row.status === 'returning',
          )
      } catch {
        /* Retry later. No phone numbers, verification codes or keys in logs. */
      }
    }
  } finally {
    recovering = false
  }
}
