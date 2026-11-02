import { schema, uuidv7 } from '@kova/db'
import { formatAmount, type TransferAuthorization } from '@kova/monad'
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { type Address, type Hex, isAddressEqual } from 'viem'
import { settlementToken } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { KovaError } from '../errors.js'
import { relayAuthorization } from '../relay.js'
import { hasRequested } from './money.js'
import {
  accountBalance,
  addBookDetail,
  bookTransfer,
  businessContact,
  cardFee,
  cardPayments,
  cardSecrets,
  createIndividual,
  createPayee,
  entityStatus,
  findBookDetail,
  findVirtualCard,
  issueVirtualCard,
  NuvionRefused,
  nuvionSandbox,
  openUsdAccount,
  type Person,
  personContact,
  rootEntity,
  setCardFrozen,
  submitForReview,
  updateIndividual,
  uploadDocument,
} from './nuvion.js'

/**
 * The dollar card: a virtual USD card from Nuvion, topped up from the wallet.
 *
 * 1. The holder passes Nuvion's ID check once (their details, a photo of their ID and a proof of
 *    address go straight to Nuvion; Kova keeps the ids and whether they passed).
 * 2. Once they pass, Kova opens their card's USD account, makes Kova's pot able to pay it, covers
 *    the card fee from the pot and issues the card.
 * 3. A top-up is the wallet's signed transfer of AUSD to Kova's treasury on Monad, relayed like any
 *    payment, then the amount moved from the pot to the card by book transfer. The wallet sends the
 *    amount plus Kova's fee (KOVA_CARD_TOPUP_FEE_BPS, 0.5%); the card gets the amount. A wallet puts
 *    at most KOVA_CARD_DAILY_TOPUP on its card a UTC day, and one Monad transaction credits once.
 *
 * The card's number and CVV are read from Nuvion when the holder asks and never stored.
 */

const net = config.KOVA_NETWORK

export const dollarCardLive = () =>
  Boolean(config.NUVION_API_KEY && config.NUVION_POT_ACCOUNT && config.KOVA_CARD_TREASURY)

const dailyCap = () => BigInt(config.KOVA_CARD_DAILY_TOPUP)
/** The card's brand, from the first digits of its number (only the name is kept). */
export function cardBrand(number: string): 'mastercard' | 'visa' | 'other' {
  const two = Number(number.slice(0, 2))
  const four = Number(number.slice(0, 4))
  if (number.startsWith('4')) return 'visa'
  if ((two >= 51 && two <= 55) || (four >= 2221 && four <= 2720)) return 'mastercard'
  return 'other'
}

/** Base units (6 decimals) per cent. */
const CENT = 10_000n

/** Kova's fee on a top-up of `amount`: KOVA_CARD_TOPUP_FEE_BPS of it, rounded up to the cent. */
export function topUpFee(amount: bigint) {
  const raw = (amount * BigInt(config.KOVA_CARD_TOPUP_FEE_BPS) + 9_999n) / 10_000n
  return ((raw + CENT - 1n) / CENT) * CENT
}

type Holder = typeof schema.cardHolders.$inferSelect
type Card = typeof schema.dollarCards.$inferSelect

const PASSED = 'approved'
/** Sent to Nuvion and being reviewed. */
const REVIEWING = 'pending'
/** Made at Nuvion but never sent for review: a check that stopped part way, to finish. */
const UNSENT = 'incomplete'

/**
 * The national number Nuvion needs, by where the holder is from or lives: a NIN or BVN (11 digits)
 * in Nigeria, a Social Security number in the US, nothing elsewhere.
 */
export function idNumberFor(
  nationality: string,
  residence: string,
  given: { type: 'nin' | 'bvn' | 'ssn'; value: string } | undefined,
): Person['idNumber'] {
  const from = [nationality, residence]
  if (from.includes('NG')) {
    const value = given?.value.replace(/\s/g, '') ?? ''
    if ((given?.type !== 'nin' && given?.type !== 'bvn') || !/^\d{11}$/.test(value))
      throw new KovaError(
        'invalid_request',
        'Nuvion needs your NIN or BVN (11 digits) to check a Nigerian ID.',
      )
    return { type: given.type, value }
  }
  if (from.includes('US')) {
    const value = given?.value.replace(/[\s-]/g, '') ?? ''
    if (given?.type !== 'ssn' || !/^\d{9}$/.test(value))
      throw new KovaError('invalid_request', 'Nuvion needs your Social Security number (9 digits).')
    return { type: 'ssn', value }
  }
  return undefined
}

const isOwner = (wallet: Address) =>
  (config.KOVA_CARD_OWNER_WALLETS ?? '')
    .split(',')
    .some((a) => a.trim().toLowerCase() === wallet.toLowerCase())

/**
 * An owner's holder record: Kova's own business at Nuvion, approved already, since an owner's ID is
 * on file as that business and Nuvion won't take the same person again as a customer.
 */
async function ownerHolder(wallet: Address): Promise<Holder> {
  const [first, ...rest] = config.KOVA_CARD_OWNER_NAME.trim().split(/\s+/)
  await db
    .insert(schema.cardHolders)
    .values({
      id: uuidv7(),
      wallet: wallet.toLowerCase(),
      network: net,
      entityId: await rootEntity(),
      status: PASSED,
      firstName: first || 'Kova',
      lastName: rest.join(' ') || 'Team',
    })
    .onConflictDoNothing()
  return (await holderOf(wallet)) as Holder
}

async function holderOf(wallet: Address): Promise<Holder | null> {
  const row = await db.query.cardHolders.findFirst({
    where: and(
      eq(schema.cardHolders.wallet, wallet.toLowerCase()),
      eq(schema.cardHolders.network, net),
    ),
  })
  return row ?? null
}

async function cardOf(wallet: Address): Promise<Card | null> {
  const [row] = await db
    .select()
    .from(schema.dollarCards)
    .where(
      and(
        eq(schema.dollarCards.wallet, wallet.toLowerCase()),
        eq(schema.dollarCards.network, net),
        sql`${schema.dollarCards.state} <> 'closed'`,
      ),
    )
    .orderBy(desc(schema.dollarCards.createdAt))
    .limit(1)
  return row ?? null
}

/** The start of today in UTC, when a wallet's daily top-up allowance starts again. */
function startOfDay(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

async function toppedUpToday(wallet: Address): Promise<bigint> {
  const [row] = await db
    .select({ sum: sql<string>`coalesce(sum(${schema.cardTopups.amount}), 0)` })
    .from(schema.cardTopups)
    .where(
      and(
        eq(schema.cardTopups.wallet, wallet.toLowerCase()),
        eq(schema.cardTopups.network, net),
        gte(schema.cardTopups.createdAt, startOfDay()),
      ),
    )
  return BigInt(row?.sum ?? '0')
}

/** Refreshes a holder still being checked, and issues their card the first time they pass. */
async function advance(holder: Holder): Promise<Holder> {
  let row = holder
  if (row.status === REVIEWING || row.status === UNSENT) {
    const now = await entityStatus(row.entityId).catch(() => null)
    // Nuvion's word wins, but a check it never received keeps Kova's note of why it stopped.
    const reason = now && now.status === row.status ? (now.reason ?? row.reason) : now?.reason
    if (now && (now.status !== row.status || reason !== row.reason)) {
      row =
        (
          await db
            .update(schema.cardHolders)
            .set({ status: now.status, reason: reason ?? null, updatedAt: new Date() })
            .where(eq(schema.cardHolders.id, row.id))
            .returning()
        )[0] ?? row
    }
  }
  if (row.status === PASSED && !(await cardOf(row.wallet as Address))) row = await issueOnce(row)
  return row
}

/** Focus and foreground refreshes can arrive together; share the same issuance attempt. */
const issuing = new Map<string, Promise<Holder>>()
function issueOnce(holder: Holder): Promise<Holder> {
  const running = issuing.get(holder.id)
  if (running) return running
  const job = (async () => {
    const fresh = (await holderOf(holder.wallet as Address)) ?? holder
    return (await cardOf(holder.wallet as Address)) ? fresh : issue(fresh)
  })().finally(() => issuing.delete(holder.id))
  issuing.set(holder.id, job)
  return job
}

/** Opens the card's account, lets the pot pay it, covers the card fee and issues the card. */
async function issue(holder: Holder): Promise<Holder> {
  let row = holder
  if (!row.accountId) {
    const account = await openUsdAccount(row.entityId)
    row =
      (
        await db
          .update(schema.cardHolders)
          .set({ ...account, updatedAt: new Date() })
          .where(eq(schema.cardHolders.id, row.id))
          .returning()
      )[0] ?? row
  }
  if (!row.paymentDetailId && row.accountNumber) {
    // Already made on an earlier try? Reuse it rather than make a duplicate.
    const found = await findBookDetail(row.accountNumber).catch(() => null)
    if (found)
      row =
        (
          await db
            .update(schema.cardHolders)
            .set({ ...found, updatedAt: new Date() })
            .where(eq(schema.cardHolders.id, row.id))
            .returning()
        )[0] ?? row
  }
  if (isOwner(row.wallet as Address) && (!row.email || !row.phone || !row.counterpartyId)) {
    // An owner's card and payee carry Kova's own business email, phone and address.
    const contact = await businessContact(row.entityId)
    const counterpartyId =
      row.counterpartyId ?? (row.paymentDetailId ? null : await createPayee({ ...row, ...contact }))
    row =
      (
        await db
          .update(schema.cardHolders)
          .set({
            email: row.email ?? contact.email,
            phone: row.phone ?? contact.phone,
            ...(counterpartyId ? { counterpartyId } : {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.cardHolders.id, row.id))
          .returning()
      )[0] ?? row
  }
  if (!row.counterpartyId && !row.paymentDetailId) {
    // A check that reached Nuvion before Kova's payee was made: make it from what Nuvion holds.
    const contact = await personContact(row.entityId)
    row =
      (
        await db
          .update(schema.cardHolders)
          .set({ counterpartyId: await createPayee({ ...row, ...contact }), updatedAt: new Date() })
          .where(eq(schema.cardHolders.id, row.id))
          .returning()
      )[0] ?? row
  }
  if (!row.paymentDetailId) {
    if (!row.accountNumber)
      throw new KovaError('chain_error', 'The card’s account has no number yet. Try again shortly.')
    if (!row.counterpartyId)
      throw new KovaError('chain_error', 'This card holder has no payee at the issuer yet.')
    const payee = {
      paymentDetailId: await addBookDetail(
        row.counterpartyId,
        `${row.firstName} ${row.lastName}`,
        row.accountNumber,
      ),
    }
    row =
      (
        await db
          .update(schema.cardHolders)
          .set({ ...payee, updatedAt: new Date() })
          .where(eq(schema.cardHolders.id, row.id))
          .returning()
      )[0] ?? row
  }
  const accountId = row.accountId as string
  const existingCard = await findVirtualCard(row.entityId, accountId)
  const fee = existingCard ? 0 : await cardFee(accountId, row.entityId)
  if (fee > 0) {
    // Kova pays the issuer's card fee; the reference makes sure it's paid once per holder.
    await bookTransfer(
      {
        counterpartyId: row.counterpartyId as string,
        paymentDetailId: row.paymentDetailId as string,
      },
      fee,
      `kova-card-fee-${row.id}`,
      'Kova card fee',
    ).catch((e) => {
      if (!(e instanceof NuvionRefused && e.status === 409)) throw e
    })
  }
  if (!row.email || !row.phone)
    throw new KovaError('chain_error', 'The card issuer needs an email and phone for this card.')
  const cardId =
    existingCard ??
    (await issueVirtualCard(row.entityId, accountId, {
      ...row,
      email: row.email,
      phone: row.phone,
    }))
  const secrets = await cardSecrets(cardId, row.entityId)
  await db.insert(schema.dollarCards).values({
    id: uuidv7(),
    wallet: row.wallet,
    network: net,
    provider: 'nuvion',
    providerCardToken: cardId,
    lastFour: secrets.number.slice(-4),
    brand: cardBrand(secrets.number),
    expMonth: secrets.expMonth,
    expYear: secrets.expYear,
    state: secrets.status === 'blocked' ? 'paused' : 'open',
    dailyLimit: dailyCap(),
  })
  return row
}

export async function dollarCardFor(wallet: Address) {
  const live = dollarCardLive()
  const base = {
    object: 'dollar_card' as const,
    live,
    sandbox: live && nuvionSandbox(),
    provider: 'Nuvion',
    daily_topup: dailyCap().toString(),
    topup_fee_bps: config.KOVA_CARD_TOPUP_FEE_BPS,
  }
  if (!live)
    return {
      ...base,
      requested: await hasRequested(wallet, 'dollar_card'),
      stage: 'intro' as const,
    }
  let holder = await holderOf(wallet)
  if (!holder && isOwner(wallet)) holder = await ownerHolder(wallet).catch(() => null)
  if (holder)
    holder = await advance(holder).catch(async (error) => {
      console.error('[dollar-card]', error)
      // Approval may have been saved before a later issuer request failed.
      return (await holderOf(wallet)) ?? holder
    })
  let card = await cardOf(wallet)
  if (card && !card.brand && holder) {
    // A card made before Kova kept its brand: work it out once.
    const brand = await cardSecrets(card.providerCardToken, holder.entityId)
      .then((s) => cardBrand(s.number))
      .catch(() => null)
    if (brand) {
      await db
        .update(schema.dollarCards)
        .set({ brand, updatedAt: new Date() })
        .where(eq(schema.dollarCards.id, card.id))
      card = { ...card, brand }
    }
  }
  if (!holder || !card)
    return {
      ...base,
      requested: false,
      stage: !holder
        ? ('intro' as const)
        : holder.status === PASSED || holder.status === REVIEWING
          ? ('checking' as const)
          : ('fix' as const),
      // Never reviewed (it stopped before Nuvion had everything), as against reviewed and refused.
      unfinished: holder?.status === UNSENT,
      approved: holder?.status === PASSED,
      reason: holder?.reason ?? null,
    }

  const [cents, payments, today, topups] = await Promise.all([
    holder.accountId ? accountBalance(holder.accountId, holder.entityId).catch(() => null) : null,
    cardPayments(card.providerCardToken, holder.entityId).catch(() => []),
    toppedUpToday(wallet),
    db
      .select()
      .from(schema.cardTopups)
      .where(
        and(eq(schema.cardTopups.wallet, wallet.toLowerCase()), eq(schema.cardTopups.network, net)),
      )
      .orderBy(desc(schema.cardTopups.createdAt))
      .limit(20),
  ])
  const activity = [
    ...payments.map((p) => ({
      id: p.id,
      kind: p.check ? ('check' as const) : p.cents < 0 ? ('spend' as const) : ('refund' as const),
      amount: (BigInt(p.cents) * CENT).toString(),
      status: p.status,
      title: p.merchant,
      at: p.at.toISOString(),
    })),
    ...topups.map((t) => ({
      id: t.id,
      kind: 'topup' as const,
      amount: t.amount.toString(),
      status:
        t.status === 'credited' ? 'successful' : t.status === 'failed' ? 'pending' : 'pending',
      title: 'Top up from Kova',
      at: t.createdAt.toISOString(),
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 20)
  const left = dailyCap() > today ? dailyCap() - today : 0n
  return {
    ...base,
    requested: false,
    stage: 'card' as const,
    card: {
      last_four: card.lastFour,
      brand: card.brand ?? 'other',
      exp_month: card.expMonth,
      exp_year: card.expYear,
      frozen: card.state === 'paused',
      balance: cents === null ? null : (BigInt(cents) * CENT).toString(),
      name: `${holder.firstName} ${holder.lastName}`,
    },
    topups: { today: today.toString(), left: left.toString(), treasury: config.KOVA_CARD_TREASURY },
    activity,
  }
}

/** A file for Nuvion, base64 without the data: prefix. */
type Upload = { base64: string; mime: string; backBase64?: string }

/**
 * Sends the holder's details, ID and proof of address to Nuvion's check. Safe to send again: a
 * check that stopped part way carries on where Nuvion has it, and one Nuvion is already reviewing
 * just answers where it is. A refusal is kept as the reason, so the card screen says what to fix.
 */
export async function startCheck(
  wallet: Address,
  person: Person,
  files: { identity: Upload; address: Upload },
) {
  if (!dollarCardLive())
    throw new KovaError('conflict', 'The dollar card isn’t switched on for this server yet.')
  const mine = and(
    eq(schema.cardHolders.wallet, wallet.toLowerCase()),
    eq(schema.cardHolders.network, net),
  )
  let existing = await holderOf(wallet)
  // Where Nuvion has it now: an earlier try may have got further than Kova recorded.
  if (existing) existing = await advance(existing).catch(() => existing)
  // Already with Nuvion: nothing to send again (a payee it lacks is made when the card is issued).
  if (existing && (existing.status === PASSED || existing.status === REVIEWING))
    return dollarCardFor(wallet)
  try {
    let entityId: string
    let personId: string | null
    if (existing) {
      ;({ entityId, personId } = existing)
      await updateIndividual(entityId, person)
    } else {
      ;({ entityId, personId } = await createIndividual(person))
      await db.insert(schema.cardHolders).values({
        id: uuidv7(),
        wallet: wallet.toLowerCase(),
        network: net,
        entityId,
        personId,
        status: UNSENT,
        firstName: person.firstName,
        lastName: person.lastName,
        email: person.email,
        phone: person.phone,
      })
    }
    await uploadDocument(entityId, personId, 'identity', files.identity)
    await uploadDocument(entityId, personId, 'proof_of_address', files.address)
    await submitForReview(entityId)
    // Kova's payee for this holder, made now while their address is in hand (it isn't kept).
    const counterpartyId = existing?.counterpartyId ?? (await createPayee(person))
    await db
      .update(schema.cardHolders)
      .set({
        status: REVIEWING,
        reason: null,
        counterpartyId,
        firstName: person.firstName,
        lastName: person.lastName,
        email: person.email,
        phone: person.phone,
        updatedAt: new Date(),
      })
      .where(mine)
  } catch (e) {
    if (!(e instanceof NuvionRefused)) throw e
    console.error('[dollar-card] check refused:', e.status, e.code ?? '', e.message)
    await db
      .update(schema.cardHolders)
      .set({ reason: e.message, updatedAt: new Date() })
      .where(mine)
    throw new KovaError('invalid_request', `The card issuer couldn’t take that: ${e.message}`)
  }
  return dollarCardFor(wallet)
}

/** Wallets topping up right now, so two taps at once can't both slip under the daily cap. */
const toppingUp = new Map<string, Promise<unknown>>()

/**
 * A top-up of `amount` onto the card: the wallet's signed transfer of amount + fee to Kova's
 * treasury, relayed, then `amount` moved onto the card. If the move onto the card fails, the dollars
 * are already Kova's and `creditTopups` keeps trying, so the card always gets what was paid for.
 */
export async function topUp(
  wallet: Address,
  amount: bigint,
  authorization: TransferAuthorization,
  signature: Hex,
) {
  const key = wallet.toLowerCase()
  if (toppingUp.has(key))
    throw new KovaError('conflict', 'A top-up is already on its way. Give it a second.')
  const job = (async () => {
    const treasury = config.KOVA_CARD_TREASURY
    if (!dollarCardLive() || !treasury)
      throw new KovaError('conflict', 'The dollar card isn’t switched on for this server yet.')
    const holder = await holderOf(wallet)
    const card = await cardOf(wallet)
    if (!holder?.paymentDetailId || !card)
      throw new KovaError('not_found', 'This wallet has no dollar card yet.')
    if (
      !isAddressEqual(authorization.from, wallet) ||
      !isAddressEqual(authorization.to, treasury as Address)
    )
      throw new KovaError('invalid_request', 'That top-up isn’t addressed to your card.')
    const value = amount
    if (value <= 0n || value % CENT !== 0n)
      throw new KovaError('invalid_request', 'Top up a whole number of cents, more than $0.00.')
    const fee = topUpFee(value)
    if (authorization.value !== value + fee)
      throw new KovaError(
        'invalid_request',
        `A $${formatAmount(value)} top-up is $${formatAmount(value + fee)} with Kova’s fee. Approve that amount.`,
      )
    const today = await toppedUpToday(wallet)
    if (today + value > dailyCap()) {
      const left = dailyCap() > today ? dailyCap() - today : 0n
      throw new KovaError(
        'policy_declined',
        left === 0n
          ? `You’ve topped up $${formatAmount(dailyCap())} today, the most for a day. Try again tomorrow.`
          : `You can top up $${formatAmount(left)} more today.`,
      )
    }
    const { receipt } = await relayAuthorization(settlementToken, authorization, signature)
    if (receipt.status !== 'success')
      throw new KovaError('chain_error', 'The top-up didn’t go through. Nothing was taken.')
    const reference = `kova-topup-${receipt.transactionHash.slice(2, 34)}`
    const [row] = await db
      .insert(schema.cardTopups)
      .values({
        id: uuidv7(),
        wallet: key,
        network: net,
        amount: value,
        fee,
        txHash: receipt.transactionHash,
        reference,
      })
      .onConflictDoNothing()
      .returning()
    if (row) await credit(row, holder)
    return { tx_hash: receipt.transactionHash, card: await dollarCardFor(wallet) }
  })()
  toppingUp.set(key, job)
  try {
    return await job
  } finally {
    toppingUp.delete(key)
  }
}

async function credit(row: typeof schema.cardTopups.$inferSelect, holder: Holder) {
  try {
    const transferId = await bookTransfer(
      {
        counterpartyId: holder.counterpartyId as string,
        paymentDetailId: holder.paymentDetailId as string,
      },
      Number(row.amount / CENT),
      row.reference,
      'Kova card top-up',
    )
    await db
      .update(schema.cardTopups)
      .set({ status: 'credited', transferId, problem: null, updatedAt: new Date() })
      .where(eq(schema.cardTopups.id, row.id))
  } catch (e) {
    // 409: a transfer with this reference already exists, so the card already has it.
    const done = e instanceof NuvionRefused && e.status === 409
    await db
      .update(schema.cardTopups)
      .set(
        done
          ? { status: 'credited', problem: null, updatedAt: new Date() }
          : {
              status: 'failed',
              problem: (e as Error).message.slice(0, 500),
              updatedAt: new Date(),
            },
      )
      .where(eq(schema.cardTopups.id, row.id))
  }
}

/** Moves onto cards whatever was paid but didn't reach the card yet (run every minute). */
export async function creditTopups() {
  if (!dollarCardLive()) return
  const due = await db
    .select()
    .from(schema.cardTopups)
    .where(
      and(
        eq(schema.cardTopups.network, net),
        inArray(schema.cardTopups.status, ['paid', 'failed']),
      ),
    )
    .limit(20)
  for (const row of due) {
    const holder = await holderOf(row.wallet as Address)
    if (holder?.paymentDetailId) await credit(row, holder)
  }
}

export async function setDollarCard(wallet: Address, frozen: boolean) {
  const holder = await holderOf(wallet)
  const card = await cardOf(wallet)
  if (!card || !holder) throw new KovaError('not_found', 'This wallet has no dollar card yet.')
  await setCardFrozen(card.providerCardToken, frozen, holder.entityId)
  await db
    .update(schema.dollarCards)
    .set({ state: frozen ? 'paused' : 'open', updatedAt: new Date() })
    .where(eq(schema.dollarCards.id, card.id))
  return dollarCardFor(wallet)
}

/** The card's number, expiry and CVV, read from Nuvion for the holder and never kept. */
export async function revealDollarCard(wallet: Address) {
  const holder = await holderOf(wallet)
  const card = await cardOf(wallet)
  if (!card || !holder) throw new KovaError('not_found', 'This wallet has no dollar card yet.')
  const s = await cardSecrets(card.providerCardToken, holder.entityId)
  return {
    object: 'dollar_card_details' as const,
    number: s.number,
    cvv: s.cvv,
    exp_month: s.expMonth,
    exp_year: s.expYear,
    name: s.name,
    brand: cardBrand(s.number),
  }
}
