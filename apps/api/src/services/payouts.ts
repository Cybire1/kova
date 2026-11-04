import { schema, uuidv7 } from '@kova/db'
import {
  eip3009Abi,
  encodeMemo,
  explorerTxUrl,
  formatAmount,
  type TransferAuthorization,
} from '@kova/monad'
import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import { type Address, encodeFunctionData, getAddress, type Hex, isAddressEqual } from 'viem'
import { feePayerAddress, network, publicClient, settlementToken } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { KovaError } from '../errors.js'
import { relayAuthorization, relayReady, sendFromRelayer } from '../relay.js'
import {
  bankCodes,
  counterpartyAddressReady,
  createRecipient,
  fxQuote,
  type NuvionBank,
  NuvionRefused,
  type NuvionTransfer,
  payoutByReference,
  payoutTransfer,
  potCents,
  sendPayout,
} from './nuvion.js'
import { type Corridor, corridorById, recipientFor } from './payout-corridors.js'

/**
 * Cash-outs through Nuvion, to banks, mobile money and wallets in 20+ countries.
 *
 * 1. A recipient is saved once: their details go to Nuvion (a counterparty of Kova's and one payment
 *    detail); Kova keeps the ids and a masked label.
 * 2. A quote locks Nuvion's rate for a few minutes and fixes what the account gets.
 * 3. The wallet signs an EIP-3009 transfer of the dollars to Kova's treasury (the relayer); Kova
 *    relays it, then pays the account out of its USD pot at Nuvion, converted at the quote.
 * 4. Nuvion pays asynchronously: `settlePayouts` follows each transfer to paid, and if Nuvion refuses
 *    or fails it, sends the dollars back to the wallet.
 *
 * Paid once: the transfer's reference is the payout's id, and Nuvion refuses a second transfer with
 * it. Refunded once: the refund's hash is kept before it's sent. Nothing leaves a wallet unless Kova's
 * pot already holds what the account is owed.
 */

const net = config.KOVA_NETWORK
const CENT = 10_000n
export const MIN_PAYOUT = 1_000_000n // $1
export const MAX_PAYOUT = 500_000_000n // $500
/** A USD payout's quote, with no rate to move, holds this long. */
const USD_QUOTE_MS = 10 * 60_000
/** Kova's quote ends this long before Nuvion's, so a signature never reaches a stale rate. */
const QUOTE_MARGIN_MS = 20_000

type Row = typeof schema.payouts.$inferSelect
type Recipient = typeof schema.payoutRecipients.$inferSelect

export const payoutsLive = () =>
  Boolean(config.NUVION_API_KEY && config.NUVION_POT_ACCOUNT && relayReady() && feePayerAddress)

function requireLive() {
  if (!payoutsLive())
    throw new KovaError('conflict', 'Cashing out isn’t switched on for this server yet.')
}

/** Where a payout's dollars go on Monad: the relayer, which can send them back if it fails. */
function treasury(): Address {
  if (!feePayerAddress)
    throw new KovaError('conflict', 'Cashing out isn’t switched on for this server yet.')
  return feePayerAddress
}

const txUrl = (hash: string | null) => (hash ? explorerTxUrl(network, hash as Hex) : null)
export const payoutNonce = (row: Pick<Row, 'id'>) => encodeMemo({ kind: 'cashout', id: row.id })
const referenceOf = (row: Pick<Row, 'id'>) => `kova-out-${row.id.replace(/-/g, '')}`

/** Kova's fee on `amount`, rounded up to the cent. */
export function payoutFee(amount: bigint): bigint {
  const raw = (amount * BigInt(config.KOVA_PAYOUT_FEE_BPS) + 9_999n) / 10_000n
  return ((raw + CENT - 1n) / CENT) * CENT
}

// --- Banks and rates -------------------------------------------------------------------------------

const banks = new Map<string, { list: NuvionBank[]; at: number }>()

/** A country's banks, as the picker lists them (Nuvion's directory, kept for a day). */
export async function payoutBanks(country: string): Promise<NuvionBank[]> {
  requireLive()
  const code = country.toUpperCase()
  const kept = banks.get(code)
  if (kept && Date.now() - kept.at < 24 * 3_600_000) return kept.list
  const list = (await bankCodes(code)).sort((a, b) => a.bank_name.localeCompare(b.bank_name))
  banks.set(code, { list, at: Date.now() })
  return list
}

const rates = new Map<string, { rate: number; at: number }>()

/**
 * What a dollar comes to in `currency` right now, for the amount screen as someone types (a real
 * quote locks it at the next step). USD is 1; others come from a $100 quote, kept a minute.
 */
export async function payoutRate(currency: string): Promise<number> {
  requireLive()
  if (currency === 'USD') return 1
  const code = currency === 'USDC' ? 'USC' : currency
  const kept = rates.get(code)
  if (kept && Date.now() - kept.at < 60_000) return kept.rate
  const q = await fxQuote(code, 10_000)
  rates.set(code, { rate: q.rate, at: Date.now() })
  return q.rate
}

// --- Recipients ------------------------------------------------------------------------------------

export function serializeRecipient(r: Recipient) {
  const corridor = corridorById(r.corridor)
  return {
    object: 'payout_recipient',
    id: r.id,
    corridor: r.corridor,
    country: r.country,
    currency: r.currency === 'USC' ? 'USDC' : r.currency,
    name: corridor?.name ?? r.country,
    flag: corridor?.flag ?? '🏦',
    title: corridor?.title ?? '',
    speed: corridor?.speed ?? '',
    holder_name: r.holderName,
    label: r.label,
    created_at: r.createdAt.toISOString(),
  }
}

/**
 * Saves where a wallet cashes out to: checks the fields for the rail, then gives them to Nuvion. A
 * detail Nuvion won't take is refused here, before any money could move.
 */
export async function addRecipient(
  wallet: Address,
  corridorId: string,
  values: Record<string, unknown>,
): Promise<Recipient> {
  requireLive()
  const corridor = corridorById(corridorId)
  if (!corridor) throw new KovaError('invalid_request', 'Pick where to cash out to.')
  let bank: { bank_name: string; code: string } | undefined
  if (corridor.bankList) {
    const picked = typeof values.bank === 'string' ? values.bank : ''
    const found = (await payoutBanks(corridor.bankList.country)).find(
      (b) => b[corridor.bankList?.key as keyof NuvionBank] === picked,
    )
    if (found) bank = { bank_name: found.bank_name, code: picked }
  }
  const input = recipientFor(corridor, values, bank)
  let ids: { counterpartyId: string; paymentDetailId: string }
  try {
    ids = await createRecipient(input.person, input.detail)
  } catch (e) {
    if (!(e instanceof NuvionRefused)) throw e
    console.error('[payouts] recipient refused:', e.status, e.code ?? '', e.message)
    throw new KovaError('invalid_request', `The bank details weren’t accepted: ${e.message}`)
  }
  const [row] = await db
    .insert(schema.payoutRecipients)
    .values({
      id: uuidv7(),
      wallet: wallet.toLowerCase(),
      network: net,
      corridor: corridor.id,
      country: input.country,
      currency: corridor.currency,
      holderName: input.person.holderName,
      label: input.label,
      ...ids,
    })
    .returning()
  if (!row) throw new KovaError('internal', 'Kova couldn’t save that. Try again.')
  // The same account added again (to fix it) replaces the older copy in the list, unless a
  // payout to the older copy is still moving: that one needs its recipient to finish.
  const older = await db
    .select({ id: schema.payoutRecipients.id })
    .from(schema.payoutRecipients)
    .where(
      and(
        eq(schema.payoutRecipients.wallet, row.wallet),
        eq(schema.payoutRecipients.network, net),
        eq(schema.payoutRecipients.corridor, row.corridor),
        eq(schema.payoutRecipients.label, row.label),
        ne(schema.payoutRecipients.id, row.id),
      ),
    )
  if (older.length) {
    const moving = await db
      .select({ id: schema.payouts.recipientId })
      .from(schema.payouts)
      .where(
        and(
          inArray(
            schema.payouts.recipientId,
            older.map((o) => o.id),
          ),
          inArray(schema.payouts.status, ['received', 'sending', 'refunding']),
        ),
      )
    const busy = new Set(moving.map((m) => m.id))
    const done = older.map((o) => o.id).filter((id) => !busy.has(id))
    if (done.length)
      await db.delete(schema.payoutRecipients).where(inArray(schema.payoutRecipients.id, done))
  }
  return row
}

export async function recipientsOf(wallet: Address): Promise<Recipient[]> {
  return db
    .select()
    .from(schema.payoutRecipients)
    .where(
      and(
        eq(schema.payoutRecipients.wallet, wallet.toLowerCase()),
        eq(schema.payoutRecipients.network, net),
      ),
    )
    .orderBy(desc(schema.payoutRecipients.createdAt))
    .limit(50)
}

export async function removeRecipient(wallet: Address, id: string) {
  await db
    .delete(schema.payoutRecipients)
    .where(
      and(
        eq(schema.payoutRecipients.id, id),
        eq(schema.payoutRecipients.wallet, wallet.toLowerCase()),
      ),
    )
}

async function recipientRow(id: string): Promise<Recipient | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined
  return db.query.payoutRecipients.findFirst({ where: eq(schema.payoutRecipients.id, id) })
}

// --- Payouts ---------------------------------------------------------------------------------------

/** Formats an amount in a currency's smallest unit (two decimals for all of Nuvion's). */
const minor = (n: bigint) => {
  const whole = n / 100n
  const cents = (n % 100n).toString().padStart(2, '0')
  return `${whole.toLocaleString('en-US')}.${cents}`
}

export function serializePayout(row: Row, recipient?: Recipient | null) {
  const expired = row.status === 'quoted' && row.expiresAt < new Date()
  return {
    object: 'payout',
    id: row.id,
    amount: formatAmount(row.amount),
    fee: formatAmount(row.fee),
    currency: row.currency === 'USC' ? 'USDC' : row.currency,
    /** What the account receives, in its currency. */
    amount_to: minor(row.amountTo),
    amount_to_minor: row.amountTo.toString(),
    rate: row.rate,
    recipient: recipient ? serializeRecipient(recipient) : null,
    // 'refunding' is internal: to the wallet it has failed, and its dollars are on their way back.
    status: expired ? 'expired' : row.status === 'refunding' ? 'failed' : row.status,
    pay: {
      token: getAddress(settlementToken.address),
      to: feePayerAddress ? getAddress(feePayerAddress) : null,
      value: row.amount.toString(),
      nonce: payoutNonce(row),
      valid_before: Math.floor(row.expiresAt.getTime() / 1000),
    },
    tx_hash: row.txHash,
    tx_url: txUrl(row.txHash),
    refund_tx_hash: row.refundTxHash,
    refund_tx_url: txUrl(row.refundTxHash),
    failure: row.failure,
    expires_at: row.expiresAt.toISOString(),
    paid_at: row.paidAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  }
}

/** Checks a quote's amount against the rail's own limits on what the account receives. */
function withinRail(corridor: Corridor, amountTo: bigint, currency: string) {
  if (corridor.minTo && amountTo < BigInt(corridor.minTo))
    throw new KovaError(
      'invalid_request',
      `${corridor.title} takes at least ${currency} ${minor(BigInt(corridor.minTo))}. Cash out a little more.`,
    )
  if (corridor.maxTo && amountTo > BigInt(corridor.maxTo))
    throw new KovaError(
      'invalid_request',
      `${corridor.title} takes at most ${currency} ${minor(BigInt(corridor.maxTo))} at a time.`,
    )
}

/** A quoted payout of `amount` dollars to a saved recipient: the rate is locked for a few minutes. */
export async function quotePayout(
  wallet: Address,
  recipientId: string,
  amount: bigint,
): Promise<{ row: Row; recipient: Recipient }> {
  requireLive()
  const recipient = await recipientRow(recipientId)
  if (!recipient || recipient.wallet !== wallet.toLowerCase() || recipient.network !== net)
    throw new KovaError('not_found', 'Pick where to cash out to.')
  const corridor = corridorById(recipient.corridor)
  if (!corridor) throw new KovaError('conflict', 'Kova doesn’t pay out that way any more.')
  // Accounts saved before Kova asked for them have no state or postal code: Nuvion fails those.
  if ((await counterpartyAddressReady(recipient.counterpartyId)) === false)
    throw new KovaError(
      'invalid_request',
      'Add this account again: Kova now needs your state and postal code.',
    )
  if (amount % CENT !== 0n) throw new KovaError('invalid_request', 'Cash out whole cents.')
  if (amount < MIN_PAYOUT) throw new KovaError('invalid_request', 'Cash out at least $1.')
  if (amount > MAX_PAYOUT) throw new KovaError('invalid_request', 'Cash out up to $500 at a time.')
  const fee = payoutFee(amount)
  const cents = Number((amount - fee) / CENT)
  let amountTo: bigint
  let rate: number
  let fxQuoteId: string | null = null
  let expiresAt = new Date(Date.now() + USD_QUOTE_MS)
  if (corridor.currency === 'USD') {
    amountTo = BigInt(cents)
    rate = 1
  } else {
    const q = await fxQuote(corridor.currency, cents)
    amountTo = BigInt(q.amountTo)
    rate = q.rate
    fxQuoteId = q.id
    expiresAt = new Date(q.expiresAt.getTime() - QUOTE_MARGIN_MS)
  }
  withinRail(corridor, amountTo, corridor.currency === 'USC' ? 'USDC' : corridor.currency)
  const [row] = await db
    .insert(schema.payouts)
    .values({
      id: uuidv7(),
      network: net,
      wallet: wallet.toLowerCase(),
      recipientId: recipient.id,
      amount,
      fee,
      currency: corridor.currency,
      amountTo,
      rate: rate.toString(),
      fxQuoteId,
      expiresAt,
    })
    .returning()
  if (!row) throw new KovaError('internal', 'Kova couldn’t save that quote. Try again.')
  return { row, recipient }
}

export async function payoutRow(id: string): Promise<Row | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined
  return db.query.payouts.findFirst({ where: eq(schema.payouts.id, id) })
}

export async function payoutWithRecipient(row: Row) {
  return serializePayout(row, (await recipientRow(row.recipientId)) ?? null)
}

export async function payoutsOf(wallet: Address): Promise<Row[]> {
  return db
    .select()
    .from(schema.payouts)
    .where(and(eq(schema.payouts.wallet, wallet.toLowerCase()), eq(schema.payouts.network, net)))
    .orderBy(desc(schema.payouts.createdAt))
    .limit(30)
}

/** Moves a payout forward only from the status it was read in, so two workers never both act. */
async function move(row: Row, from: string, values: Partial<typeof schema.payouts.$inferInsert>) {
  const [next] = await db
    .update(schema.payouts)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(schema.payouts.id, row.id), eq(schema.payouts.status, from)))
    .returning()
  return next ?? null
}

/**
 * The wallet signed the transfer: check it is exactly this payout's, make sure Kova's pot can pay it,
 * relay it to Monad, and pay the account. It happens once: the nonce is this payout's memo, the
 * token accepts it once, and the status only moves forward.
 */
export async function payPayout(
  row: Row,
  signed: { token: Address; authorization: TransferAuthorization; signature: Hex },
): Promise<Row> {
  requireLive()
  if (row.status !== 'quoted') return row
  if (row.expiresAt < new Date())
    throw new KovaError('conflict', 'This rate ran out. Get a fresh quote and approve again.')
  const { authorization } = signed
  if (!isAddressEqual(signed.token, settlementToken.address))
    throw new KovaError('invalid_request', 'Cash out in the dollar Kova settles in.')
  if (!isAddressEqual(authorization.from, row.wallet as Address))
    throw new KovaError('invalid_request', 'This cash-out is another wallet’s.')
  if (!isAddressEqual(authorization.to, treasury()))
    throw new KovaError('invalid_request', 'A cash-out goes to Kova’s treasury.')
  if (authorization.value !== row.amount)
    throw new KovaError('invalid_request', 'The amount doesn’t match the cash-out.')
  if (authorization.nonce.toLowerCase() !== payoutNonce(row).toLowerCase())
    throw new KovaError('invalid_request', 'That approval isn’t for this cash-out.')
  if (authorization.validBefore > BigInt(Math.floor(row.expiresAt.getTime() / 1000)) + 60n)
    throw new KovaError('invalid_request', 'The approval can’t outlast the quote.')

  // Kova pays the account from its pot: it must hold this, and every payout still on its way.
  const cents = Number((row.amount - row.fee) / CENT)
  const [held, owed] = await Promise.all([potCents(), centsOwed()])
  if (held < owed + cents) {
    console.error('[payouts] the pot is short', { held, owed, cents })
    throw new KovaError(
      'conflict',
      'Cashing out is paused for a moment. Nothing left your wallet. Try again later.',
    )
  }

  const { receipt } = await relayAuthorization(settlementToken, authorization, signed.signature)
  if (receipt.status !== 'success')
    throw new KovaError('chain_error', 'The transfer didn’t go through. Nothing left your wallet.')
  const received = await move(row, 'quoted', {
    status: 'received',
    txHash: receipt.transactionHash,
  })
  if (!received) return (await payoutRow(row.id)) as Row
  return send(received)
}

/** Cents already taken from wallets and not yet paid out by Nuvion. */
async function centsOwed(): Promise<number> {
  const rows = await db
    .select({ amount: schema.payouts.amount, fee: schema.payouts.fee })
    .from(schema.payouts)
    .where(and(eq(schema.payouts.network, net), eq(schema.payouts.status, 'received')))
  return rows.reduce((sum, r) => sum + Number((r.amount - r.fee) / CENT), 0)
}

/** True when Nuvion refused for good (it won't change on a retry); false when it didn't answer. */
const refusedForGood = (e: unknown) =>
  e instanceof NuvionRefused &&
  e.status >= 400 &&
  e.status < 500 &&
  ![408, 409, 429].includes(e.status)

/** Nuvion's own word that the rate it was given ran out or was used. */
const staleQuote = (e: unknown) =>
  e instanceof NuvionRefused && /fx|quote/i.test(`${e.code ?? ''} ${e.message}`)

/** Asks Nuvion to pay a received payout. Safe to call again: the reference makes it happen once. */
async function send(row: Row): Promise<Row> {
  const recipient = await recipientRow(row.recipientId)
  const corridor = recipient && corridorById(recipient.corridor)
  if (!recipient || !corridor) return refund(row, 'Kova lost where this was going.')
  const reference = referenceOf(row)
  const cents = Number((row.amount - row.fee) / CENT)
  const pay = (fxQuoteId: string | null) =>
    sendPayout({
      counterpartyId: recipient.counterpartyId,
      paymentDetailId: recipient.paymentDetailId,
      paymentType: corridor.method,
      cents,
      reference,
      fxQuoteId,
    })
  let transfer: NuvionTransfer
  try {
    transfer = await pay(row.fxQuoteId)
  } catch (e) {
    if (e instanceof NuvionRefused && e.status === 409) {
      // Sent before (a retry after no answer): find it by its reference.
      const found = await payoutByReference(reference)
      if (!found) return row
      transfer = found
    } else if (staleQuote(e) && row.currency !== 'USD') {
      // The locked rate ran out between Monad and Nuvion: pay at today's rate, and say so.
      try {
        const q = await fxQuote(row.currency, cents)
        const updated = await move(row, 'received', {
          fxQuoteId: q.id,
          amountTo: BigInt(q.amountTo),
          rate: q.rate.toString(),
        })
        if (!updated) return (await payoutRow(row.id)) as Row
        row = updated
        transfer = await pay(q.id)
      } catch (again) {
        if (refusedForGood(again) && !(again instanceof NuvionRefused && again.status === 409))
          return refund(row, `The payout was refused: ${(again as Error).message}`)
        return row
      }
    } else if (refusedForGood(e)) {
      console.error('[payouts] payout refused:', row.id, (e as Error).message)
      return refund(row, `The payout was refused: ${(e as Error).message}`)
    } else {
      // No answer: still 'received', and settlePayouts asks again with the same reference.
      console.error('[payouts] Nuvion didn’t answer; trying again later', row.id)
      return row
    }
  }
  const sending = await move(row, 'received', {
    status: 'sending',
    transferId: transfer.id,
    ...(transfer.fee !== null ? { providerFee: BigInt(transfer.fee) } : {}),
  })
  if (!sending) return (await payoutRow(row.id)) as Row
  return follow(sending, transfer)
}

/** Reads where Nuvion has the transfer, and moves the payout to paid, or back to the wallet. */
async function follow(row: Row, known?: NuvionTransfer): Promise<Row> {
  if (!row.transferId) return row
  const transfer = known ?? (await payoutTransfer(row.transferId).catch(() => null))
  if (!transfer) return row
  if (transfer.status === 'successful')
    return (
      (await move(row, 'sending', { status: 'paid', paidAt: new Date(), failure: null })) ?? row
    )
  if (transfer.status === 'failed' || transfer.status === 'reversed')
    return refund(
      row,
      transfer.statusReason
        ? `The bank didn’t take it (${transfer.statusReason.replace(/_/g, ' ')}).`
        : 'The bank didn’t take it.',
    )
  return row
}

/**
 * Sends a failed payout's dollars back to the wallet, from the relayer. The hash is kept before the
 * transaction can leave, so a refund is checked, never sent twice.
 */
async function refund(row: Row, reason: string): Promise<Row> {
  // One sentence, ended, before the next one is put after it.
  const why = /[.!?]$/.test(reason.trim()) ? reason.trim() : `${reason.trim()}.`
  const from = row.status
  if (from !== 'refunding') {
    const marked = await move(row, from, {
      status: 'refunding',
      failure: `${why} Kova is sending your dollars back.`,
    })
    if (!marked) return (await payoutRow(row.id)) as Row
    row = marked
  }
  if (row.refundTxHash) {
    const sent = await publicClient
      .getTransactionReceipt({ hash: row.refundTxHash as Hex })
      .catch(() => null)
    if (sent?.status === 'success')
      return (
        (await move(row, 'refunding', {
          status: 'failed',
          failure: `${why} Your dollars went back to your wallet.`,
        })) ?? row
      )
    if (!sent) {
      // Sent and not on Monad yet: never send a second time on a guess.
      console.error('[payouts] a refund was sent with no receipt yet:', row.id)
      return row
    }
  }
  try {
    const receipt = await sendFromRelayer(
      settlementToken.address,
      encodeFunctionData({
        abi: eip3009Abi,
        functionName: 'transfer',
        args: [getAddress(row.wallet), row.amount],
      }),
      {
        beforeBroadcast: async (hash) => {
          await db
            .update(schema.payouts)
            .set({ refundTxHash: hash, updatedAt: new Date() })
            .where(eq(schema.payouts.id, row.id))
        },
      },
    )
    if (receipt.status !== 'success') {
      await db
        .update(schema.payouts)
        .set({ refundTxHash: null, updatedAt: new Date() })
        .where(eq(schema.payouts.id, row.id))
      return row
    }
    return (
      (await move(row, 'refunding', {
        status: 'failed',
        refundTxHash: receipt.transactionHash,
        failure: `${why} Your dollars went back to your wallet.`,
      })) ?? row
    )
  } catch (e) {
    console.error('[payouts] refund failed; trying again later', row.id, (e as Error).message)
    return row
  }
}

/** Carries every payout on its way one step further (run every 30 seconds). */
export async function settlePayouts() {
  if (!payoutsLive()) return
  const due = await db
    .select()
    .from(schema.payouts)
    .where(
      and(
        eq(schema.payouts.network, net),
        inArray(schema.payouts.status, ['received', 'sending', 'refunding']),
      ),
    )
    .limit(25)
  for (const row of due) {
    try {
      if (row.status === 'received') await send(row)
      else if (row.status === 'sending') await follow(row)
      else
        await refund(
          row,
          (row.failure ?? 'The payout didn’t go through.').replace(
            / Kova is sending your dollars back\.$/,
            '',
          ),
        )
    } catch (e) {
      console.error('[payouts] settling', row.id, (e as Error).message)
    }
  }
}
