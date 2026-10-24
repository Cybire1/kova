import { randomBytes } from 'node:crypto'
import { schema, uuidv7 } from '@kova/db'
import {
  eip3009Abi,
  encodeMemo,
  explorerTxUrl,
  formatAmount,
  type TransferAuthorization,
} from '@kova/monad'
import { and, desc, eq, inArray, lt } from 'drizzle-orm'
import { type Address, encodeFunctionData, getAddress, type Hex, isAddressEqual } from 'viem'
import { feePayerAddress, network, publicClient, settlementToken } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { KovaError } from '../errors.js'
import { relayAuthorization, relayReady, sendFromRelayer } from '../relay.js'
import {
  accountName,
  bankNamed,
  checkout,
  payment,
  paystackReady,
  paystackTestMode,
  transfer,
  transferRecipient,
  transferStatus,
} from './paystack.js'
import { rateBook } from './rates.js'

/**
 * Naira, in and out, through Paystack (services/paystack.ts):
 *
 * - **Adding money in naira.** Someone pays naira by bank transfer, card or USSD on Paystack's
 *   checkout. Once Paystack confirms it (the payer's return, or its signed webhook), Kova's
 *   treasury sends the dollars to the wallet on Monad, once.
 * - **Cashing out.** A wallet turns dollars into naira in a Nigerian bank account. Kova quotes the
 *   naira and the bank names the account; the wallet signs an EIP-3009 transfer of exactly those
 *   dollars to Kova's treasury, its nonce the cash-out's own Kova memo, so it settles this
 *   cash-out and nothing else, once. Once it lands on Monad, Paystack pays the account; if the bank
 *   can't take it, the treasury sends the dollars back.
 *
 * Quotes start from the market rate Kova already shows (rates.ts: Chainlink CRE on Monad, or the
 * published table) with a spread each way (KOVA_NAIRA_SPREAD). The treasury is the relayer, which
 * also pays the gas. In production the exchange is a licensed partner's; with a Paystack test key
 * the naira side is Paystack's test mode, and no real naira moves.
 */

export type CashOutRow = typeof schema.cashOuts.$inferSelect
export type TopUpRow = typeof schema.nairaTopUps.$inferSelect

export const nairaReady = () => paystackReady() && relayReady() && Boolean(feePayerAddress)

function requireNaira() {
  if (!nairaReady()) throw new KovaError('conflict', 'Naira isn’t switched on for this server yet.')
}

/** Kova's treasury, where cash-out dollars go: the relayer. */
export function treasury(): Address {
  if (!feePayerAddress)
    throw new KovaError('conflict', 'Naira isn’t switched on for this server yet.')
  return feePayerAddress
}

const QUOTE_TTL_MS = 15 * 60_000
export const MIN_CASH_OUT = 1_000_000n // $1
export const MAX_CASH_OUT = 500_000_000n // $500
export const MIN_TOP_UP = 1_000_000n // $1
export const MAX_TOP_UP = 500_000_000n // $500

/** The market's naira per dollar, now, and where it came from. */
async function marketRate(): Promise<{ perUsd: number; source: 'chainlink' | 'table' }> {
  const book = await rateBook()
  const ngn = book.rates.NGN?.perUsd
  if (!ngn || !(ngn > 0))
    throw new KovaError('internal', 'Kova can’t read the naira rate right now. Try again soon.')
  return { perUsd: ngn, source: book.source }
}

/** Paystack's fee for one bank transfer out, by size, in kobo. */
function transferFee(kobo: bigint): bigint {
  if (kobo <= 500_000n) return 1_000n // ₦10 up to ₦5,000
  if (kobo <= 5_000_000n) return 2_500n // ₦25 up to ₦50,000
  return 5_000n // ₦50 above
}

/** Paystack's fee for taking a local payment, in kobo: 1.5%, plus ₦100 from ₦2,500, at most ₦2,000. */
function collectionFee(kobo: bigint): bigint {
  const fee = (kobo * 15n) / 1000n + (kobo >= 250_000n ? 10_000n : 0n)
  return fee > 200_000n ? 200_000n : fee
}

const toKobo = (units: bigint, rate: number, round: 'down' | 'up') => {
  const value = (Number(units) / 1e6) * rate * 100
  return BigInt(round === 'down' ? Math.floor(value) : Math.ceil(value))
}

export const formatNaira = (k: bigint) =>
  `₦${(Number(k) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export async function quoteCashOut(units: bigint) {
  const market = await marketRate()
  const rate = market.perUsd * (1 - config.KOVA_NAIRA_SPREAD)
  const gross = toKobo(units, rate, 'down')
  const fee = transferFee(gross)
  return {
    market: market.perUsd,
    source: market.source,
    rate,
    gross,
    fee,
    naira: gross > fee ? gross - fee : 0n,
  }
}

export async function quoteTopUp(units: bigint) {
  const market = await marketRate()
  const rate = market.perUsd * (1 + config.KOVA_NAIRA_SPREAD)
  const base = toKobo(units, rate, 'up')
  // Paystack takes its fee from what it collects, so the payer covers it: the wallet gets every dollar.
  let naira = base
  for (let i = 0; i < 3; i++) naira = base + collectionFee(naira)
  return { market: market.perUsd, source: market.source, rate, base, fee: naira - base, naira }
}

const txUrl = (hash: string | null) => (hash ? explorerTxUrl(network, hash as Hex) : null)

// ── Cashing out ─────────────────────────────────────────────────────────────────────────────

/** The cash-out's own memo, carried as the EIP-3009 nonce: it pays this cash-out only, once. */
export const cashOutNonce = (row: Pick<CashOutRow, 'id'>) =>
  encodeMemo({ kind: 'cashout', id: row.id })

export function serializeCashOut(row: CashOutRow) {
  const expired = row.status === 'quoted' && row.expiresAt < new Date()
  // 'refunding' is internal: to the wallet it has failed, and its dollars are on their way back.
  return {
    object: 'cash_out',
    id: row.id,
    amount: formatAmount(row.amount),
    naira: formatNaira(row.naira),
    naira_kobo: row.naira.toString(),
    rate: Number(row.rate).toFixed(2),
    fee: formatNaira(row.fee),
    bank_name: row.bankName,
    account_name: row.accountName,
    account_last4: row.accountNumber.slice(-4),
    status: expired ? 'expired' : row.status === 'refunding' ? 'failed' : row.status,
    /** What the wallet signs: exactly this transfer, to Kova's treasury, with this nonce. */
    pay: {
      token: getAddress(settlementToken.address),
      to: feePayerAddress ? getAddress(feePayerAddress) : null,
      value: row.amount.toString(),
      nonce: cashOutNonce(row),
      valid_before: Math.floor(row.expiresAt.getTime() / 1000),
    },
    tx_hash: row.txHash,
    tx_url: txUrl(row.txHash),
    refund_tx_hash: row.refundTxHash,
    refund_tx_url: txUrl(row.refundTxHash),
    failure: row.failure,
    test_mode: paystackTestMode(),
    expires_at: row.expiresAt.toISOString(),
    paid_at: row.paidAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  }
}

export async function createCashOut(
  wallet: Address,
  input: { amount: bigint; bankCode: string; accountNumber: string },
): Promise<CashOutRow> {
  requireNaira()
  if (input.amount < MIN_CASH_OUT) throw new KovaError('invalid_request', 'Cash out at least $1.')
  if (input.amount > MAX_CASH_OUT)
    throw new KovaError('invalid_request', 'Cash out up to $500 at a time.')
  const bank = await bankNamed(input.bankCode)
  if (!bank) throw new KovaError('invalid_request', 'Pick your bank from the list.')
  const name = await accountName(input.accountNumber, bank.code)
  const quote = await quoteCashOut(input.amount)
  if (quote.naira <= 0n)
    throw new KovaError('invalid_request', 'That’s too little to send to a bank.')
  const [row] = await db
    .insert(schema.cashOuts)
    .values({
      id: uuidv7(),
      network: config.KOVA_NETWORK,
      walletAddress: wallet.toLowerCase(),
      amount: input.amount,
      naira: quote.naira,
      rate: quote.rate.toFixed(4),
      fee: quote.fee,
      bankCode: bank.code,
      bankName: bank.name,
      accountNumber: input.accountNumber,
      accountName: name,
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
    })
    .returning()
  if (!row) throw new KovaError('internal', 'The cash-out wasn’t saved.')
  return row
}

export async function cashOutRow(id: string): Promise<CashOutRow | undefined> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return undefined
  return db.query.cashOuts.findFirst({ where: eq(schema.cashOuts.id, id) })
}

export async function cashOutsOf(wallet: Address): Promise<CashOutRow[]> {
  return db.query.cashOuts.findMany({
    where: eq(schema.cashOuts.walletAddress, wallet.toLowerCase()),
    orderBy: [desc(schema.cashOuts.createdAt)],
    limit: 20,
  })
}

/** Told when a cash-out ends, paid or failed: a USSD pocket texts its phone (services/pockets.ts). */
let onCashOutEnded: ((row: CashOutRow) => void) | null = null
export function whenCashOutEnds(listener: (row: CashOutRow) => void) {
  onCashOutEnded = listener
}

async function updateCashOut(
  row: CashOutRow,
  values: Partial<typeof schema.cashOuts.$inferInsert>,
) {
  const [updated] = await db
    .update(schema.cashOuts)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(schema.cashOuts.id, row.id))
    .returning()
  if (updated && (values.status === 'paid' || values.status === 'failed')) {
    try {
      onCashOutEnded?.(updated as CashOutRow)
    } catch (error) {
      console.error('[naira] cash-out listener failed', row.id, error)
    }
  }
  return updated as CashOutRow
}

// ── Cashing out from a USSD pocket ──────────────────────────────────────────────────────────

/**
 * A phone with no data cashes out its pocket: to the one account the owner saved, at a fresh
 * quote. The pocket's own key pays the dollars to the treasury (services/pockets.ts spend, with
 * this cash-out's memo as the nonce); receivePocketCashOut then pays the naira out.
 */
export async function createPocketCashOut(
  pocketAddress: Address,
  amount: bigint,
  account: { bankCode: string; bankName: string; accountNumber: string; accountName: string },
): Promise<CashOutRow> {
  requireNaira()
  if (amount < MIN_CASH_OUT) throw new KovaError('invalid_request', 'Cash out at least $1.')
  if (amount > MAX_CASH_OUT)
    throw new KovaError('invalid_request', 'Cash out up to $500 at a time.')
  const quote = await quoteCashOut(amount)
  if (quote.naira <= 0n)
    throw new KovaError('invalid_request', 'That’s too little to send to a bank.')
  const [row] = await db
    .insert(schema.cashOuts)
    .values({
      id: uuidv7(),
      network: config.KOVA_NETWORK,
      walletAddress: pocketAddress.toLowerCase(),
      amount,
      naira: quote.naira,
      rate: quote.rate.toFixed(4),
      fee: quote.fee,
      bankCode: account.bankCode,
      bankName: account.bankName,
      accountNumber: account.accountNumber,
      accountName: account.accountName,
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
    })
    .returning()
  if (!row) throw new KovaError('internal', 'The cash-out wasn’t saved.')
  return row
}

/**
 * The pocket's dollars reached the treasury on Monad: pay the naira out. The dollars have
 * arrived, so a quote that ran out while they were confirming is still honoured.
 */
export async function receivePocketCashOut(id: string, txHash: Hex): Promise<CashOutRow | null> {
  const [received] = await db
    .update(schema.cashOuts)
    .set({ status: 'received', txHash, updatedAt: new Date() })
    .where(and(eq(schema.cashOuts.id, id), inArray(schema.cashOuts.status, ['quoted', 'expired'])))
    .returning()
  if (!received) return (await cashOutRow(id)) ?? null
  return payOut(received)
}

/** The pocket's payment never happened: nothing moved, so the cash-out simply ends. */
export async function dropPocketCashOut(id: string, why: string): Promise<void> {
  const row = await cashOutRow(id)
  if (!row || (row.status !== 'quoted' && row.status !== 'expired')) return
  await updateCashOut(row, { status: 'failed', failure: why })
}

/** The treasury sends dollars it holds, through the relayer's one send path (one nonce owner). */
async function sendDollars(to: Address, amount: bigint): Promise<Hex> {
  const stock = await publicClient.readContract({
    address: settlementToken.address,
    abi: eip3009Abi,
    functionName: 'balanceOf',
    args: [treasury()],
  })
  if (stock < amount) {
    console.error(
      `[naira] the treasury holds ${formatAmount(stock)} AUSD, needs ${formatAmount(amount)}: top up ${treasury()}`,
    )
    throw new KovaError(
      'chain_error',
      'Kova’s dollars are being topped up. Yours will follow shortly.',
    )
  }
  const receipt = await sendFromRelayer(
    settlementToken.address,
    encodeFunctionData({ abi: eip3009Abi, functionName: 'transfer', args: [to, amount] }),
  )
  if (receipt.status !== 'success')
    throw new KovaError('chain_error', 'Monad refused the transfer.')
  return receipt.transactionHash
}

/**
 * The bank transfer failed: the dollars go back to the wallet. If the treasury can't send them
 * right now, the cash-out stays 'refunding' and the background job tries again until it can.
 */
async function refundCashOut(row: CashOutRow, why: string): Promise<CashOutRow> {
  if (row.refundTxHash) return updateCashOut(row, { status: 'failed' })
  try {
    const hash = await sendDollars(getAddress(row.walletAddress), row.amount)
    return updateCashOut(row, {
      status: 'failed',
      refundTxHash: hash,
      failure: `${why} Your dollars went back to your wallet.`,
    })
  } catch (error) {
    console.error(
      '[naira] refund failed; retrying later',
      row.id,
      error instanceof Error ? error.message : error,
    )
    return updateCashOut(row, {
      status: 'refunding',
      failure: `${why} Kova is sending your dollars back.`,
    })
  }
}

/** The part of a failure that says why, without what happened to the dollars after. */
const whyOf = (failure: string | null) =>
  (failure ?? 'The bank transfer didn’t go through.').replace(
    / Kova is sending your dollars back\.$/,
    '',
  )

/**
 * The wallet signed the transfer: check it is exactly this cash-out's, relay it to Monad, and pay
 * the naira out. It happens once: the nonce is this cash-out's memo, the token accepts it once,
 * and the status only moves forward.
 */
export async function payCashOut(
  row: CashOutRow,
  signed: { token: Address; authorization: TransferAuthorization; signature: Hex },
): Promise<CashOutRow> {
  requireNaira()
  if (row.status !== 'quoted') return row
  if (row.expiresAt < new Date())
    throw new KovaError(
      'conflict',
      'This quote ran out. Start the cash-out again for a fresh rate.',
    )
  const { authorization } = signed
  if (!isAddressEqual(signed.token, settlementToken.address))
    throw new KovaError('invalid_request', 'Cash out in the dollar Kova settles in.')
  if (!isAddressEqual(authorization.from, row.walletAddress as Address))
    throw new KovaError('invalid_request', 'This cash-out is another wallet’s.')
  if (!isAddressEqual(authorization.to, treasury()))
    throw new KovaError('invalid_request', 'A cash-out goes to Kova’s treasury.')
  if (authorization.value !== row.amount)
    throw new KovaError('invalid_request', 'The amount doesn’t match the cash-out.')
  if (authorization.nonce.toLowerCase() !== cashOutNonce(row).toLowerCase())
    throw new KovaError('invalid_request', 'That approval isn’t for this cash-out.')
  if (authorization.validBefore > BigInt(Math.floor(row.expiresAt.getTime() / 1000)) + 60n)
    throw new KovaError('invalid_request', 'The approval can’t outlast the quote.')

  const { receipt } = await relayAuthorization(settlementToken, authorization, signed.signature)
  const [received] = await db
    .update(schema.cashOuts)
    .set({ status: 'received', txHash: receipt.transactionHash, updatedAt: new Date() })
    .where(and(eq(schema.cashOuts.id, row.id), eq(schema.cashOuts.status, 'quoted')))
    .returning()
  if (!received) return (await cashOutRow(row.id)) as CashOutRow
  return payOut(received)
}

async function payOut(row: CashOutRow): Promise<CashOutRow> {
  try {
    const recipient =
      row.recipientCode ??
      (await transferRecipient({
        name: row.accountName,
        accountNumber: row.accountNumber,
        bankCode: row.bankCode,
      }))
    if (!row.recipientCode) row = await updateCashOut(row, { recipientCode: recipient })
    const sent = await transfer({
      kobo: row.naira,
      recipient,
      reference: row.id,
      reason: 'Kova cash-out',
    })
    if (sent.status === 'success')
      return updateCashOut(row, { status: 'paid', transferCode: sent.code, paidAt: new Date() })
    if (['failed', 'reversed', 'rejected', 'blocked'].includes(sent.status))
      return refundCashOut(
        await updateCashOut(row, { transferCode: sent.code }),
        'The bank transfer didn’t go through.',
      )
    return updateCashOut(row, { status: 'paying', transferCode: sent.code })
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error)
    console.error('[naira] payout failed', row.id, said)
    return refundCashOut(
      row,
      /starter business/i.test(said)
        ? 'Naira payouts aren’t open on Kova’s Paystack account yet.'
        : `Paystack couldn’t send it (${said.slice(0, 120)}).`,
    )
  }
}

/** Cash-outs the bank hasn't confirmed yet: ask Paystack how each went. Old unused quotes expire. */
export async function checkPayingCashOuts(): Promise<void> {
  if (!nairaReady()) return
  const paying = await db.query.cashOuts.findMany({
    where: eq(schema.cashOuts.status, 'paying'),
    limit: 20,
  })
  for (const row of paying) {
    const state = await transferStatus(row.id).catch(() => null)
    if (state === 'success') await updateCashOut(row, { status: 'paid', paidAt: new Date() })
    else if (state === 'failed' || state === 'reversed')
      await refundCashOut(row, 'The bank sent it back.')
  }
  // Dollars that arrived but whose payout never started (a restart mid-way): pay them out now.
  const stuck = await db.query.cashOuts.findMany({
    where: and(
      eq(schema.cashOuts.status, 'received'),
      lt(schema.cashOuts.updatedAt, new Date(Date.now() - 2 * 60_000)),
    ),
    limit: 10,
  })
  for (const row of stuck) await payOut(row)
  // Refunds the treasury couldn't send at the time.
  const owed = await db.query.cashOuts.findMany({
    where: eq(schema.cashOuts.status, 'refunding'),
    limit: 10,
  })
  for (const row of owed) await refundCashOut(row, whyOf(row.failure))
  await db
    .update(schema.cashOuts)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(
      and(
        eq(schema.cashOuts.status, 'quoted'),
        lt(schema.cashOuts.expiresAt, new Date(Date.now() - 60 * 60_000)),
      ),
    )
}

export async function cashOutTransferEvent(reference: string, event: string): Promise<void> {
  const row = await cashOutRow(reference)
  if (!row || (row.status !== 'paying' && row.status !== 'received')) return
  if (event === 'transfer.success') await updateCashOut(row, { status: 'paid', paidAt: new Date() })
  else if (event === 'transfer.failed' || event === 'transfer.reversed')
    await refundCashOut(row, 'The bank sent it back.')
}

// ── Adding money in naira ───────────────────────────────────────────────────────────────────

export function serializeTopUp(row: TopUpRow) {
  return {
    object: 'naira_top_up',
    id: row.id,
    reference: row.reference,
    amount: formatAmount(row.amount),
    naira: formatNaira(row.naira),
    naira_kobo: row.naira.toString(),
    rate: Number(row.rate).toFixed(2),
    status: row.status,
    tx_hash: row.txHash,
    tx_url: txUrl(row.txHash),
    failure: row.failure,
    test_mode: paystackTestMode(),
    paid_at: row.paidAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  }
}

export async function startTopUp(
  wallet: Address,
  input: { amount: bigint; email: string; callbackUrl: string },
) {
  requireNaira()
  if (input.amount < MIN_TOP_UP) throw new KovaError('invalid_request', 'Add at least $1.')
  if (input.amount > MAX_TOP_UP) throw new KovaError('invalid_request', 'Add up to $500 at a time.')
  const quote = await quoteTopUp(input.amount)
  const reference = `kova_${randomBytes(16).toString('hex')}`
  const [row] = await db
    .insert(schema.nairaTopUps)
    .values({
      id: uuidv7(),
      network: config.KOVA_NETWORK,
      walletAddress: wallet.toLowerCase(),
      amount: input.amount,
      naira: quote.naira,
      rate: quote.rate.toFixed(4),
      email: input.email.toLowerCase(),
      reference,
    })
    .returning()
  if (!row) throw new KovaError('internal', 'The top-up wasn’t saved.')
  const url = await checkout({
    email: input.email,
    kobo: quote.naira,
    reference,
    callbackUrl: input.callbackUrl,
    metadata: { kova: 'top_up', dollars: formatAmount(input.amount), wallet: wallet.toLowerCase() },
  })
  return { url, row, quote }
}

export async function topUpRow(reference: string): Promise<TopUpRow | undefined> {
  if (!/^kova_[0-9a-f]{32}$/.test(reference)) return undefined
  return db.query.nairaTopUps.findFirst({ where: eq(schema.nairaTopUps.reference, reference) })
}

export async function topUpsOf(wallet: Address): Promise<TopUpRow[]> {
  return db.query.nairaTopUps.findMany({
    where: eq(schema.nairaTopUps.walletAddress, wallet.toLowerCase()),
    orderBy: [desc(schema.nairaTopUps.createdAt)],
    limit: 20,
  })
}

async function updateTopUp(row: TopUpRow, values: Partial<typeof schema.nairaTopUps.$inferInsert>) {
  const [updated] = await db
    .update(schema.nairaTopUps)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(schema.nairaTopUps.id, row.id))
    .returning()
  return updated as TopUpRow
}

/**
 * Paystack says the naira arrived (the payer came back, or its webhook): send the wallet its
 * dollars from Kova's treasury, once.
 */
export async function settleTopUp(reference: string): Promise<TopUpRow> {
  requireNaira()
  const row = await topUpRow(reference)
  if (!row) throw new KovaError('not_found', 'No such naira payment.')
  if (row.status === 'settled' || row.status === 'failed') return row
  if (row.status === 'paid') return row.txHash ? row : sendTopUp(row)
  const paid = await payment(reference)
  if (paid.status !== 'success') {
    // "abandoned" is Paystack's word for a checkout nobody finished yet: the payer may still pay.
    if (paid.status === 'failed' || paid.status === 'reversed')
      return updateTopUp(row, {
        status: 'failed',
        failure: `Paystack says the payment ${paid.status}. No naira was taken.`,
      })
    return row
  }
  if (paid.currency !== 'NGN' || paid.kobo < row.naira)
    throw new KovaError('conflict', 'The naira Paystack took doesn’t match the top-up.')

  // Claim it, so the payer's return and the webhook can't both send the dollars.
  const [claimed] = await db
    .update(schema.nairaTopUps)
    .set({ status: 'paid', paidAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.nairaTopUps.id, row.id), eq(schema.nairaTopUps.status, 'initialized')))
    .returning()
  if (!claimed) return (await topUpRow(reference)) as TopUpRow
  return sendTopUp(claimed)
}

async function sendTopUp(row: TopUpRow): Promise<TopUpRow> {
  try {
    const hash = await sendDollars(getAddress(row.walletAddress), row.amount)
    return updateTopUp(row, { status: 'settled', txHash: hash, failure: null })
  } catch (error) {
    console.error('[naira] sending a top-up failed', row.id, error)
    return updateTopUp(row, {
      failure: 'Your naira arrived. Your dollars are on their way; Kova retries in a minute.',
    })
  }
}

/** Naira that arrived but whose dollars haven't gone out yet (a node hiccup, an empty treasury): try again. */
export async function retryTopUps(): Promise<void> {
  if (!nairaReady()) return
  const stuck = await db.query.nairaTopUps.findMany({
    where: eq(schema.nairaTopUps.status, 'paid'),
    limit: 10,
  })
  for (const row of stuck) if (!row.txHash) await sendTopUp(row)
}
