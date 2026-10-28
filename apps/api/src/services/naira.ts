import { randomBytes } from 'node:crypto'
import { schema, uuidv7 } from '@kova/db'
import {
  eip3009Abi,
  encodeMemo,
  explorerTxUrl,
  formatAmount,
  type TransferAuthorization,
} from '@kova/monad'
import { and, asc, desc, eq, gt, inArray, lt } from 'drizzle-orm'
import {
  type Address,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  type Hex,
  isAddress,
  isAddressEqual,
  keccak256,
  pad,
  parseSignature,
} from 'viem'
import { feePayerAddress, network, publicClient, settlementToken, tokenFor } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { KovaError } from '../errors.js'
import { RefusedEstimate, relayAuthorization, relayReady, sendFromRelayer } from '../relay.js'
import {
  openOfframp,
  openOnramp,
  PajError,
  pajAccountName,
  pajBanks,
  pajOrder,
  pajRates,
  pajReady,
} from './paj.js'
import {
  accountName,
  type Bank,
  bankNamed,
  checkout,
  nigerianBanks,
  payment,
  paystackReady,
  paystackTestMode,
  transfer,
  transferRecipient,
  transferStatus,
} from './paystack.js'
import { rateBook } from './rates.js'
import { buildSwap, swapRoute } from './swap.js'

/**
 * Naira, in and out. Through PAJ where it's set up (Monad mainnet), else through Paystack.
 *
 * With PAJ (services/paj.ts):
 *
 * - **Cashing out.** PAJ confirms the bank account and opens an order for the USDC it will pay
 *   naira for. The wallet signs one EIP-3009 transfer of its AUSD to KovaCashOut, the nonce
 *   committing to PAJ's one-time address and that USDC; in one transaction the contract swaps the
 *   AUSD to USDC (KyberSwap), pays PAJ exactly, and sends the rest back. PAJ pays the bank.
 * - **Adding money in naira.** PAJ opens a bank account for this one payment; the payer transfers
 *   naira to it, and PAJ delivers AUSD to the wallet on Monad itself.
 *
 * With Paystack (services/paystack.ts):
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

/** Who moves the naira: PAJ once KovaCashOut is deployed for it, else Paystack. */
export function nairaPartner(): 'paj' | 'paystack' | null {
  if (pajReady() && config.KOVA_CASH_OUT) return 'paj'
  return paystackReady() ? 'paystack' : null
}

export const nairaReady = () => nairaPartner() !== null && relayReady() && Boolean(feePayerAddress)

/** Only Paystack moves pretend naira (a test key). */
export const nairaTestMode = () => nairaPartner() === 'paystack' && paystackTestMode()

/** A USSD pocket cashes out through the treasury, which only the Paystack route uses so far. */
export const pocketCashOutReady = () => nairaPartner() === 'paystack' && nairaReady()

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

/**
 * Kova asks PAJ for this much under the live swap quote (basis points), so the swap at payment time
 * can't come up short. What the swap doesn't need goes back to the wallet.
 */
const PAJ_MARGIN_BPS = 10n

/** Banks the partner pays out to, with the codes its cash-outs take. */
export async function nairaBanks(): Promise<Bank[]> {
  return nairaPartner() === 'paj' ? pajBanks() : nigerianBanks()
}

/** The name on an account at a bank, as the bank has it. */
export async function nameOnAccount(accountNumber: string, bankCode: string): Promise<string> {
  if (nairaPartner() !== 'paj') return accountName(accountNumber, bankCode)
  if (!(await pajBanks()).some((b) => b.code === bankCode))
    throw new KovaError('invalid_request', 'Pick your bank from the list.')
  return pajAccountName(bankCode, accountNumber, tokenFor('USDC').address)
}

export async function quoteCashOut(units: bigint) {
  if (nairaPartner() === 'paj') {
    const { offRamp } = await pajRates()
    // The swap to USDC costs about a basis point, and PAJ is asked for 0.1% under it.
    const rate = (offRamp * Number(10_000n - PAJ_MARGIN_BPS - 1n)) / 10_000
    const naira = toKobo(units, rate, 'down')
    return { market: offRamp, source: 'paj' as const, rate, gross: naira, fee: 0n, naira }
  }
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
  if (nairaPartner() === 'paj') {
    const { onRamp } = await pajRates()
    const naira = toKobo(units, onRamp, 'up')
    return { market: onRamp, source: 'paj' as const, rate: onRamp, base: naira, fee: 0n, naira }
  }
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

/** A PAJ cash-out's reference on Monad: its id as 32 bytes, in the nonce and KovaCashOut's events. */
const cashOutRef = (row: Pick<CashOutRow, 'id'>): Hex =>
  pad(`0x${row.id.replace(/-/g, '')}`, { size: 32 })

/**
 * What a PAJ cash-out's wallet signs as its nonce: KovaCashOut.nonceFor(payTo, pay, ref), so the
 * signature itself says where the USDC goes and how much.
 */
function pajCashOutNonce(row: CashOutRow): Hex {
  if (!row.partnerAddress || row.payUnits === null)
    throw new KovaError('internal', 'This cash-out has no PAJ order.')
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }],
      [getAddress(row.partnerAddress), row.payUnits, cashOutRef(row)],
    ),
  )
}

const cashOutContract = (): Address | null =>
  config.KOVA_CASH_OUT ? getAddress(config.KOVA_CASH_OUT) : null

export function serializeCashOut(row: CashOutRow) {
  const expired = row.status === 'quoted' && row.expiresAt < new Date()
  const paj = row.partner === 'paj'
  // 'refunding' is internal: to the wallet it has failed, and its dollars are on their way back.
  return {
    object: 'cash_out',
    id: row.id,
    partner: row.partner,
    amount: formatAmount(row.amount),
    naira: formatNaira(row.naira),
    naira_kobo: row.naira.toString(),
    rate: Number(row.rate).toFixed(2),
    fee: formatNaira(row.fee),
    bank_code: row.bankCode,
    bank_name: row.bankName,
    account_name: row.accountName,
    account_last4: row.accountNumber.slice(-4),
    status: expired ? 'expired' : row.status === 'refunding' ? 'failed' : row.status,
    /**
     * What the wallet signs: exactly this transfer, with this nonce. To Kova's treasury (Paystack),
     * or to KovaCashOut, the nonce naming PAJ's address and the USDC it gets (PAJ).
     */
    pay: {
      token: getAddress(settlementToken.address),
      to: paj ? cashOutContract() : feePayerAddress ? getAddress(feePayerAddress) : null,
      value: row.amount.toString(),
      nonce: paj ? pajCashOutNonce(row) : cashOutNonce(row),
      valid_before: Math.floor(row.expiresAt.getTime() / 1000),
    },
    tx_hash: row.txHash,
    tx_url: txUrl(row.txHash),
    refund_tx_hash: row.refundTxHash,
    refund_tx_url: txUrl(row.refundTxHash),
    failure: row.failure,
    test_mode: !paj && paystackTestMode(),
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
  if (nairaPartner() === 'paj') return createPajCashOut(wallet, input)
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
  if (row.partner === 'paj') return payPajCashOut(row, signed)
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

// ── Cashing out through PAJ ─────────────────────────────────────────────────────────────────

const cashOutAbi = [
  {
    type: 'function',
    name: 'cashOut',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'auth',
        type: 'tuple',
        components: [
          { name: 'owner', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'v', type: 'uint8' },
          { name: 'r', type: 'bytes32' },
          { name: 's', type: 'bytes32' },
        ],
      },
      {
        name: 'payout',
        type: 'tuple',
        components: [
          { name: 'payTo', type: 'address' },
          { name: 'pay', type: 'uint256' },
          { name: 'ref', type: 'bytes32' },
        ],
      },
      { name: 'swap', type: 'bytes' },
    ],
    outputs: [],
  },
] as const

/** Where PAJ posts order updates: this API's own public address. */
function pajWebhookUrl(): string | undefined {
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN
  const base = config.KOVA_API_PUBLIC_URL ?? (domain ? `https://${domain}` : undefined)
  return base ? `${base.replace(/\/$/, '')}/v1/paj/webhook` : undefined
}

/**
 * A quote: a live swap quote for the dollars, and a PAJ order for 0.1% under the USDC it returns.
 * PAJ confirms the account with the bank before it opens the order, so the name is the bank's.
 */
async function createPajCashOut(
  wallet: Address,
  input: { amount: bigint; bankCode: string; accountNumber: string },
): Promise<CashOutRow> {
  const bank = (await pajBanks()).find((b) => b.code === input.bankCode)
  if (!bank) throw new KovaError('invalid_request', 'Pick your bank from the list.')
  const usdc = tokenFor('USDC').address
  const route = await swapRoute(settlementToken.address, usdc, input.amount)
  const pay = (route.amountOut * (10_000n - PAJ_MARGIN_BPS)) / 10_000n
  const order = await openOfframp({
    bankCode: bank.code,
    accountNumber: input.accountNumber,
    usdc: pay,
    usdcAddress: usdc,
    webhookUrl: pajWebhookUrl(),
  })
  if (!isAddress(order.address))
    throw new KovaError('internal', 'PAJ didn’t give an address to pay. Try again.')
  const naira = BigInt(Math.floor(order.fiatAmount * 100))
  if (naira <= 0n) throw new KovaError('invalid_request', 'That’s too little to send to a bank.')
  const [row] = await db
    .insert(schema.cashOuts)
    .values({
      id: uuidv7(),
      network: config.KOVA_NETWORK,
      walletAddress: wallet.toLowerCase(),
      amount: input.amount,
      naira,
      // What each dollar the wallet signs comes to in naira, the swap included.
      rate: (order.fiatAmount / (Number(input.amount) / 1e6)).toFixed(4),
      fee: 0n,
      bankCode: bank.code,
      bankName: bank.name,
      accountNumber: input.accountNumber,
      accountName: order.accountName?.trim() || 'the account holder',
      partner: 'paj',
      partnerOrderId: order.id,
      partnerAddress: order.address.toLowerCase(),
      payUnits: pay,
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
    })
    .returning()
  if (!row) throw new KovaError('internal', 'The cash-out wasn’t saved.')
  return row
}

/**
 * The wallet signed its transfer to KovaCashOut: check it is exactly this cash-out's, then the
 * relayer carries it out. The contract swaps just enough AUSD for PAJ's USDC (plus a sliver),
 * pays PAJ's address, and sends everything else back, all in one transaction or not at all.
 */
async function payPajCashOut(
  row: CashOutRow,
  signed: { token: Address; authorization: TransferAuthorization; signature: Hex },
): Promise<CashOutRow> {
  if (row.status !== 'quoted') return row
  if (row.expiresAt < new Date())
    throw new KovaError(
      'conflict',
      'This quote ran out. Start the cash-out again for a fresh rate.',
    )
  const contract = cashOutContract()
  if (!contract || !row.partnerAddress || row.payUnits === null)
    throw new KovaError('conflict', 'Naira isn’t switched on for this server yet.')
  const { authorization } = signed
  if (!isAddressEqual(signed.token, settlementToken.address))
    throw new KovaError('invalid_request', 'Cash out in the dollar Kova settles in.')
  if (!isAddressEqual(authorization.from, row.walletAddress as Address))
    throw new KovaError('invalid_request', 'This cash-out is another wallet’s.')
  if (!isAddressEqual(authorization.to, contract))
    throw new KovaError('invalid_request', 'A cash-out goes to Kova’s cash-out contract.')
  if (authorization.value !== row.amount)
    throw new KovaError('invalid_request', 'The amount doesn’t match the cash-out.')
  if (authorization.nonce.toLowerCase() !== pajCashOutNonce(row).toLowerCase())
    throw new KovaError('invalid_request', 'That approval isn’t for this cash-out.')
  if (authorization.validBefore > BigInt(Math.floor(row.expiresAt.getTime() / 1000)) + 60n)
    throw new KovaError('invalid_request', 'The approval can’t outlast the quote.')

  // Swap only what PAJ's USDC needs, and a sliver over: the rest stays AUSD and goes home.
  const pay = row.payUnits
  const usdc = tokenFor('USDC').address
  const whole = await swapRoute(settlementToken.address, usdc, row.amount)
  if (whole.amountOut < pay)
    throw new KovaError(
      'conflict',
      'The dollar swap moved since your quote, so nothing moved. Start again for a fresh quote.',
    )
  let route = whole
  const enough = (pay * row.amount * 10_003n) / (whole.amountOut * 10_000n) + 1n
  if (enough < row.amount) {
    const part = await swapRoute(settlementToken.address, usdc, enough).catch(() => null)
    if (part && part.amountOut >= pay) route = part
  }
  const swap = await buildSwap(route, contract, 30)

  const signature = parseSignature(signed.signature)
  const data = encodeFunctionData({
    abi: cashOutAbi,
    functionName: 'cashOut',
    args: [
      {
        owner: getAddress(authorization.from),
        value: authorization.value,
        validAfter: authorization.validAfter,
        validBefore: authorization.validBefore,
        v: Number(signature.v ?? BigInt(signature.yParity + 27)),
        r: signature.r,
        s: signature.s,
      },
      { payTo: getAddress(row.partnerAddress), pay, ref: cashOutRef(row) },
      swap.data,
    ],
  })
  let receipt: Awaited<ReturnType<typeof sendFromRelayer>>
  try {
    receipt = await sendFromRelayer(contract, data, { maxGas: 3_000_000n })
  } catch (error) {
    if (error instanceof RefusedEstimate) {
      const why = error.cause instanceof Error ? error.cause.message : String(error.cause)
      console.warn('[naira] cash-out refused before sending', row.id, why.slice(0, 300))
      throw new KovaError(
        'chain_error',
        'The swap didn’t go through, so nothing moved. Try again in a moment.',
      )
    }
    throw error
  }
  if (receipt.status !== 'success')
    throw new KovaError('chain_error', 'Monad refused the cash-out. Nothing moved.')
  const [paying] = await db
    .update(schema.cashOuts)
    .set({ status: 'paying', txHash: receipt.transactionHash, updatedAt: new Date() })
    .where(and(eq(schema.cashOuts.id, row.id), eq(schema.cashOuts.status, 'quoted')))
    .returning()
  return (paying as CashOutRow | undefined) ?? ((await cashOutRow(row.id)) as CashOutRow)
}

/** PAJ has the USDC: ask PAJ whether the bank is paid. */
export async function refreshPajCashOut(row: CashOutRow): Promise<CashOutRow> {
  if (row.partner !== 'paj' || row.status !== 'paying' || !row.partnerOrderId) return row
  const order = await pajOrder(row.partnerOrderId).catch((error) => {
    console.warn('[naira] reading a PAJ order failed', row.partnerOrderId, String(error))
    return null
  })
  if (order?.status === 'COMPLETED')
    return updateCashOut(row, { status: 'paid', paidAt: new Date() })
  if (order?.status === 'ERROR') {
    console.error('[naira] PAJ couldn’t pay a cash-out: take it up with PAJ', row.id, order.id)
    return updateCashOut(row, {
      status: 'failed',
      failure: 'PAJ couldn’t pay the bank. Kova is getting your dollars back from PAJ.',
    })
  }
  return row
}

/** PAJ says an order moved (its webhook): read the order from PAJ and follow it. */
export async function pajOrderEvent(orderId: string): Promise<void> {
  const cashOut = await db.query.cashOuts.findFirst({
    where: eq(schema.cashOuts.partnerOrderId, orderId),
  })
  if (cashOut) {
    await refreshPajCashOut(cashOut)
    return
  }
  const topUp = await db.query.nairaTopUps.findFirst({
    where: eq(schema.nairaTopUps.partnerOrderId, orderId),
  })
  if (topUp) await refreshPajTopUp(topUp)
}

/** Cash-outs the bank hasn't confirmed yet: ask Paystack how each went. Old unused quotes expire. */
export async function checkPayingCashOuts(): Promise<void> {
  if (!nairaReady()) return
  const paying = await db.query.cashOuts.findMany({
    where: eq(schema.cashOuts.status, 'paying'),
    limit: 20,
  })
  for (const row of paying) {
    if (row.partner === 'paj') {
      await refreshPajCashOut(row)
      continue
    }
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
  const paj = row.partner === 'paj'
  return {
    object: 'naira_top_up',
    id: row.id,
    reference: row.reference,
    partner: row.partner,
    amount: formatAmount(row.amount),
    naira: formatNaira(row.naira),
    naira_kobo: row.naira.toString(),
    rate: Number(row.rate).toFixed(2),
    status: row.status,
    /** PAJ: the bank account opened for this one payment, and exactly what to send it. */
    bank_transfer:
      paj && row.accountNumber
        ? {
            bank_name: row.bankName,
            account_number: row.accountNumber,
            account_name: row.accountName,
            naira: formatNaira(row.naira),
            naira_kobo: row.naira.toString(),
          }
        : null,
    return_url: row.returnUrl,
    tx_hash: row.txHash,
    tx_url: txUrl(row.txHash),
    failure: row.failure,
    test_mode: !paj && paystackTestMode(),
    paid_at: row.paidAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  }
}

export async function startTopUp(
  wallet: Address,
  input: { amount: bigint; email?: string; callbackUrl: string },
) {
  requireNaira()
  if (input.amount < MIN_TOP_UP) throw new KovaError('invalid_request', 'Add at least $1.')
  if (input.amount > MAX_TOP_UP) throw new KovaError('invalid_request', 'Add up to $500 at a time.')
  if (nairaPartner() === 'paj') return startPajTopUp(wallet, input)
  const email = input.email
  if (!email) throw new KovaError('invalid_request', 'Add your email for Paystack’s receipt.')
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
      email: email.toLowerCase(),
      reference,
    })
    .returning()
  if (!row) throw new KovaError('internal', 'The top-up wasn’t saved.')
  const url = await checkout({
    email,
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
  if (row.partner === 'paj') return refreshPajTopUp(row)
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
    where: and(eq(schema.nairaTopUps.status, 'paid'), eq(schema.nairaTopUps.partner, 'paystack')),
    limit: 10,
  })
  for (const row of stuck) if (!row.txHash) await sendTopUp(row)
  // PAJ's payments still open (it keeps an unpaid one for three days): follow the oldest-checked.
  const open = await db.query.nairaTopUps.findMany({
    where: and(
      eq(schema.nairaTopUps.partner, 'paj'),
      inArray(schema.nairaTopUps.status, ['initialized', 'paid']),
      gt(schema.nairaTopUps.createdAt, new Date(Date.now() - 3 * 86_400_000)),
      lt(schema.nairaTopUps.updatedAt, new Date(Date.now() - 30_000)),
    ),
    orderBy: [asc(schema.nairaTopUps.updatedAt)],
    limit: 10,
  })
  for (const row of open) await refreshPajTopUp(row)
}

// ── Adding money in naira through PAJ ───────────────────────────────────────────────────────

/**
 * PAJ opens a bank account for this one payment and will send the dollars to the wallet itself.
 * The payer goes to Kova's page for it (the same `url` a Paystack checkout uses), which shows the
 * account and follows the payment.
 */
async function startPajTopUp(
  wallet: Address,
  input: { amount: bigint; email?: string; callbackUrl: string },
) {
  const id = uuidv7()
  const order = await openOnramp({
    amount: input.amount,
    mint: settlementToken.address,
    recipient: wallet,
    externalId: id,
    webhookUrl: pajWebhookUrl(),
  })
  if (!order.accountNumber)
    throw new KovaError('internal', 'PAJ didn’t give an account to pay. Try again.')
  const naira = BigInt(Math.round(order.fiatAmount * 100))
  const [row] = await db
    .insert(schema.nairaTopUps)
    .values({
      id,
      network: config.KOVA_NETWORK,
      walletAddress: wallet.toLowerCase(),
      amount: input.amount,
      naira,
      rate: Number(order.rate).toFixed(4),
      email: input.email?.toLowerCase() ?? '',
      reference: `kova_${randomBytes(16).toString('hex')}`,
      partner: 'paj',
      partnerOrderId: order.id,
      bankName: order.bank ?? null,
      accountNumber: order.accountNumber,
      accountName: order.accountName ?? null,
      returnUrl: input.callbackUrl,
    })
    .returning()
  if (!row) throw new KovaError('internal', 'The top-up wasn’t saved.')
  const url = `${new URL(input.callbackUrl).origin}/naira/pay/${row.reference}`
  return {
    url,
    row,
    quote: {
      market: order.rate,
      source: 'paj' as const,
      rate: order.rate,
      base: naira,
      fee: 0n,
      naira,
    },
  }
}

/** Where PAJ's payment is: waiting for the naira, received it, or delivered the dollars. */
async function refreshPajTopUp(row: TopUpRow): Promise<TopUpRow> {
  if (row.status === 'settled' || row.status === 'failed' || !row.partnerOrderId) return row
  let order: Awaited<ReturnType<typeof pajOrder>>
  try {
    order = await pajOrder(row.partnerOrderId)
  } catch (error) {
    // PAJ deletes a payment nobody made after three days.
    if (error instanceof PajError && error.status === 404 && row.status === 'initialized')
      return updateTopUp(row, {
        status: 'failed',
        failure: 'No naira arrived, and this payment’s account has closed. Nothing was charged.',
      })
    console.warn('[naira] reading a PAJ payment failed', row.partnerOrderId, String(error))
    return row
  }
  if (order.status === 'COMPLETED') {
    const hash =
      order.signature && /^0x[0-9a-fA-F]{64}$/.test(order.signature) ? order.signature : null
    return updateTopUp(row, {
      status: 'settled',
      paidAt: row.paidAt ?? new Date(),
      txHash: hash ?? row.txHash,
      failure: null,
    })
  }
  if (order.status === 'PROCESSING' && row.status === 'initialized')
    return updateTopUp(row, { status: 'paid', paidAt: new Date() })
  if (order.status === 'ERROR') {
    console.error('[naira] PAJ couldn’t complete a top-up: take it up with PAJ', row.id, order.id)
    return updateTopUp(row, {
      status: 'failed',
      failure: 'PAJ couldn’t complete this payment. Kova is following it up with PAJ.',
    })
  }
  // A read counts as a check, so the background job moves on to others.
  return updateTopUp(row, {})
}
