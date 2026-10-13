import { schema, uuidv7 } from '@kova/db'
import { explorerTxUrl, formatAmount, parseAmount } from '@kova/monad'
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { type Address, getAddress, type Hash, isAddress, isAddressEqual, isHash, parseAbi, parseEventLogs } from 'viem'
import { z } from 'zod'
import { requireApiKey, requireMerchantKey } from '../auth.js'
import { network, publicClient, settlementToken } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { KovaError } from '../errors.js'
import { decodeId, encodeId } from '../ids.js'

/**
 * Kova for Business: the shop's payroll, its suppliers, and what its team spends.
 *
 * Kova never moves a business's dollars here. The owner's wallet signs every payment on their own
 * phone or browser (one Face ID for a whole payroll), Kova relays it like any other transfer and
 * pays the gas, and these routes keep the business's own book: who was paid, how much, and the
 * transaction, each checked against Monad before it counts as paid.
 *
 * Payroll goes privately: each person's pay goes to a one-time address made from their own
 * private-receiving key, announced with nobody named. So Monad shows the business paying
 * addresses no one can tie to its people; only this book, the business's own, says who they are.
 */

const MAX_PAY = 100_000_000_000n // $100,000 for one payment
const MAX_PEOPLE = 200
const CURRENCIES = ['USD', 'EUR', 'GBP', 'NGN', 'KES', 'MXN'] as const

const transferAbi = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)'])

type Merchant = typeof schema.merchants.$inferSelect

const money = (value: string) => {
  try {
    const base = parseAmount(value)
    if (base <= 0n) throw new Error()
    if (base > MAX_PAY) throw new KovaError('invalid_request', 'One payment can be $100,000 at most.')
    return base
  } catch (error) {
    if (error instanceof KovaError) throw error
    throw new KovaError('invalid_request', `“${value}” isn’t an amount. Use dollars, like 250 or 12.50.`)
  }
}

const wallet = (value: string) => {
  if (!isAddress(value)) throw new KovaError('invalid_request', 'That isn’t a wallet address. It starts with 0x and has 40 more characters.')
  return getAddress(value)
}

const startOfMonth = () => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

const startOfDay = () => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

async function body<T extends z.ZodTypeAny>(c: { req: { json: () => Promise<unknown> } }, shape: T): Promise<z.infer<T>> {
  const parsed = shape.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new KovaError('invalid_request', issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'That request didn’t make sense.')
  }
  return parsed.data
}

/** Who pays for the business: its owner's wallet, or where its sales settle. */
function payers(merchant: Merchant): Address[] {
  return [merchant.ownerAddress, merchant.settlementAddress].filter((a): a is string => Boolean(a)).map((a) => getAddress(a))
}

/**
 * Checks on Monad that `hash` moved exactly `amount` of the business's dollar from one of its own
 * wallets to `to`. A transfer Kova just relayed is already final, so this reads its receipt; a
 * moment's grace covers an RPC that hasn't caught up.
 */
async function confirmTransfer(merchant: Merchant, hash: Hash, to: Address, amount: bigint) {
  let receipt: Awaited<ReturnType<typeof publicClient.getTransactionReceipt>> | null = null
  for (let i = 0; i < 6 && !receipt; i++) {
    receipt = await publicClient.getTransactionReceipt({ hash }).catch(() => null)
    if (!receipt) await new Promise((r) => setTimeout(r, 500))
  }
  if (!receipt) throw new KovaError('not_found', 'Monad doesn’t have that transaction yet. Try again in a moment.')
  if (receipt.status !== 'success') throw new KovaError('invalid_request', 'That transaction failed on Monad, so nothing was paid.')
  const from = payers(merchant)
  const moved = parseEventLogs({ abi: transferAbi, logs: receipt.logs, eventName: 'Transfer' }).some(
    (log) =>
      isAddressEqual(log.address, settlementToken.address) &&
      isAddressEqual(log.args.to, to) &&
      log.args.value === amount &&
      from.some((f) => isAddressEqual(f, log.args.from)),
  )
  if (!moved) throw new KovaError('invalid_request', 'That transaction didn’t pay this amount from the business to them.')
}

// --- What the routes return ------------------------------------------------------------------------

const person = (p: typeof schema.payrollPeople.$inferSelect) => ({
  id: encodeId('payrollPerson', p.id),
  name: p.name,
  wallet_address: getAddress(p.walletAddress),
  amount: p.amount === null ? null : formatAmount(p.amount),
})

const payment = (p: typeof schema.payrollPayments.$inferSelect) => ({
  id: encodeId('payrollPayment', p.id),
  person: p.personId ? encodeId('payrollPerson', p.personId) : null,
  name: p.name,
  amount: formatAmount(p.amount),
  status: p.status as 'pending' | 'paid' | 'failed',
  stealth_address: p.stealthAddress ? getAddress(p.stealthAddress) : null,
  tx_hash: p.txHash,
  explorer_url: p.txHash ? explorerTxUrl(network, p.txHash as Hash) : null,
  failure: p.failure,
  paid_at: p.paidAt?.toISOString() ?? null,
})

function run(r: typeof schema.payrollRuns.$inferSelect, payments: (typeof schema.payrollPayments.$inferSelect)[]) {
  const mine = payments.filter((p) => p.runId === r.id)
  const paid = mine.filter((p) => p.status === 'paid')
  return {
    id: encodeId('payrollRun', r.id),
    label: r.label,
    total: formatAmount(r.total),
    paid_total: formatAmount(paid.reduce((sum, p) => sum + p.amount, 0n)),
    people: mine.length,
    paid: paid.length,
    failed: mine.filter((p) => p.status === 'failed').length,
    status: paid.length === mine.length ? ('paid' as const) : mine.some((p) => p.status === 'pending') ? ('paying' as const) : ('partial' as const),
    created_at: r.createdAt.toISOString(),
    payments: mine.map(payment),
  }
}

const supplier = (
  s: typeof schema.suppliers.$inferSelect,
  stats?: { total: bigint; count: number; last: Date | null },
) => ({
  id: encodeId('supplier', s.id),
  name: s.name,
  wallet_address: getAddress(s.walletAddress),
  country: s.country,
  currency: s.currency,
  paid_total: formatAmount(stats?.total ?? 0n),
  payments: stats?.count ?? 0,
  last_paid_at: stats?.last?.toISOString() ?? null,
})

const supplierPayment = (p: typeof schema.supplierPayments.$inferSelect, name?: string) => ({
  id: encodeId('supplierPayment', p.id),
  supplier: encodeId('supplier', p.supplierId),
  ...(name ? { supplier_name: name } : {}),
  amount: formatAmount(p.amount),
  note: p.note,
  tx_hash: p.txHash,
  explorer_url: explorerTxUrl(network, p.txHash as Hash),
  paid_at: p.createdAt.toISOString(),
})

async function runsOf(merchantId: string, limit: number) {
  const runs = await db
    .select()
    .from(schema.payrollRuns)
    .where(and(eq(schema.payrollRuns.merchantId, merchantId), eq(schema.payrollRuns.network, config.KOVA_NETWORK)))
    .orderBy(desc(schema.payrollRuns.createdAt))
    .limit(limit)
  const payments = runs.length
    ? await db
        .select()
        .from(schema.payrollPayments)
        .where(
          inArray(
            schema.payrollPayments.runId,
            runs.map((r) => r.id),
          ),
        )
        .orderBy(schema.payrollPayments.createdAt)
    : []
  return runs.map((r) => run(r, payments))
}

async function ownRun(merchantId: string, id: string) {
  const uuid = decodeId('payrollRun', id)
  const found = uuid
    ? await db.query.payrollRuns.findFirst({ where: and(eq(schema.payrollRuns.id, uuid), eq(schema.payrollRuns.merchantId, merchantId)) })
    : null
  if (!found) throw new KovaError('not_found', 'No such payroll.')
  return found
}

async function ownSupplier(merchantId: string, id: string) {
  const uuid = decodeId('supplier', id)
  const found = uuid
    ? await db.query.suppliers.findFirst({ where: and(eq(schema.suppliers.id, uuid), eq(schema.suppliers.merchantId, merchantId)) })
    : null
  if (!found) throw new KovaError('not_found', 'No such supplier.')
  return found
}

// --- Routes ----------------------------------------------------------------------------------------

const personBody = z.object({
  name: z.string().trim().min(1).max(60),
  wallet_address: z.string().trim(),
  amount: z.string().trim().max(20).nullish(),
})

const runBody = z.object({
  label: z.string().trim().min(1).max(60),
  payments: z
    .array(z.object({ person: z.string().nullish(), name: z.string().trim().min(1).max(60), amount: z.string().trim().max(20) }))
    .min(1)
    .max(MAX_PEOPLE),
})

const paidBody = z.union([
  z.object({ stealth_address: z.string(), tx_hash: z.string() }),
  z.object({ failure: z.string().trim().min(1).max(300) }),
])

const supplierBody = z.object({
  name: z.string().trim().min(1).max(80),
  wallet_address: z.string().trim(),
  country: z.string().trim().max(60).nullish(),
  currency: z.enum(CURRENCIES).default('USD'),
})

const supplierPaymentBody = z.object({
  amount: z.string().trim().max(20),
  tx_hash: z.string(),
  note: z.string().trim().max(140).nullish(),
})

export const businessRoutes = new Hono()
  /** The business at a glance: this month's payroll and suppliers, and who pays for it. */
  .get('/business', requireApiKey, requireMerchantKey, async (c) => {
    const merchant = c.get('merchant')
    const month = startOfMonth()
    const [payroll, people, suppliersPaid, supplierCount] = await Promise.all([
      db
        .select({
          total: sql<string>`coalesce(sum(${schema.payrollPayments.amount}), 0)`,
          count: sql<number>`count(*)::int`,
          runs: sql<number>`count(distinct ${schema.payrollPayments.runId})::int`,
        })
        .from(schema.payrollPayments)
        .innerJoin(schema.payrollRuns, eq(schema.payrollRuns.id, schema.payrollPayments.runId))
        .where(
          and(
            eq(schema.payrollRuns.merchantId, merchant.id),
            eq(schema.payrollRuns.network, config.KOVA_NETWORK),
            eq(schema.payrollPayments.status, 'paid'),
            gte(schema.payrollPayments.paidAt, month),
          ),
        ),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.payrollPeople)
        .where(eq(schema.payrollPeople.merchantId, merchant.id)),
      db
        .select({
          total: sql<string>`coalesce(sum(${schema.supplierPayments.amount}), 0)`,
          count: sql<number>`count(*)::int`,
          today: sql<string>`coalesce(sum(${schema.supplierPayments.amount}) filter (where ${schema.supplierPayments.createdAt} >= ${startOfDay().toISOString()}::timestamptz), 0)`,
        })
        .from(schema.supplierPayments)
        .where(
          and(
            eq(schema.supplierPayments.merchantId, merchant.id),
            eq(schema.supplierPayments.network, config.KOVA_NETWORK),
            gte(schema.supplierPayments.createdAt, month),
          ),
        ),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.suppliers)
        .where(eq(schema.suppliers.merchantId, merchant.id)),
    ])
    return c.json({
      object: 'business',
      name: merchant.name,
      owner_address: merchant.ownerAddress ? getAddress(merchant.ownerAddress) : null,
      settlement_address: getAddress(merchant.settlementAddress),
      month_starts: month.toISOString(),
      payroll: {
        paid_this_month: formatAmount(BigInt(payroll[0]?.total ?? '0')),
        payments_this_month: payroll[0]?.count ?? 0,
        runs_this_month: payroll[0]?.runs ?? 0,
        people: people[0]?.count ?? 0,
      },
      suppliers: {
        paid_this_month: formatAmount(BigInt(suppliersPaid[0]?.total ?? '0')),
        paid_today: formatAmount(BigInt(suppliersPaid[0]?.today ?? '0')),
        payments_this_month: suppliersPaid[0]?.count ?? 0,
        count: supplierCount[0]?.count ?? 0,
      },
    })
  })

  // --- Payroll ---

  .get('/business/people', requireApiKey, requireMerchantKey, async (c) => {
    const merchant = c.get('merchant')
    const rows = await db.query.payrollPeople.findMany({
      where: eq(schema.payrollPeople.merchantId, merchant.id),
      orderBy: schema.payrollPeople.name,
    })
    return c.json({ object: 'list', data: rows.map(person) })
  })

  /** Adds someone to the payroll book, or updates their name and usual pay. */
  .post('/business/people', requireApiKey, requireMerchantKey, async (c) => {
    const merchant = c.get('merchant')
    const input = await body(c, personBody)
    const address = wallet(input.wallet_address)
    const amount = input.amount ? money(input.amount) : null
    if (payers(merchant).some((p) => isAddressEqual(p, address)))
      throw new KovaError('invalid_request', 'That’s the business’s own wallet. Add the wallet of the person you pay.')
    const [row] = await db
      .insert(schema.payrollPeople)
      .values({ id: uuidv7(), merchantId: merchant.id, name: input.name, walletAddress: address.toLowerCase(), amount })
      .onConflictDoUpdate({
        target: [schema.payrollPeople.merchantId, schema.payrollPeople.walletAddress],
        set: { name: input.name, amount, updatedAt: new Date() },
      })
      .returning()
    return c.json(person(row as typeof schema.payrollPeople.$inferSelect), 201)
  })

  .delete('/business/people/:id', requireApiKey, requireMerchantKey, async (c) => {
    const merchant = c.get('merchant')
    const uuid = decodeId('payrollPerson', c.req.param('id'))
    if (!uuid) throw new KovaError('not_found', 'No such person.')
    // Their past pay stays in the book under their name; only the person row goes.
    await db.update(schema.payrollPayments).set({ personId: null }).where(eq(schema.payrollPayments.personId, uuid))
    const gone = await db
      .delete(schema.payrollPeople)
      .where(and(eq(schema.payrollPeople.id, uuid), eq(schema.payrollPeople.merchantId, merchant.id)))
      .returning({ id: schema.payrollPeople.id })
    if (!gone.length) throw new KovaError('not_found', 'No such person.')
    return c.json({ deleted: true })
  })

  .get('/business/payroll', requireApiKey, requireMerchantKey, async (c) => {
    const merchant = c.get('merchant')
    return c.json({ object: 'list', data: await runsOf(merchant.id, 50) })
  })

  .get('/business/payroll/:id', requireApiKey, requireMerchantKey, async (c) => {
    const merchant = c.get('merchant')
    const found = await ownRun(merchant.id, c.req.param('id'))
    const payments = await db.select().from(schema.payrollPayments).where(eq(schema.payrollPayments.runId, found.id)).orderBy(schema.payrollPayments.createdAt)
    return c.json(run(found, payments))
  })

  /**
   * Starts a payroll: the book's entry for it, each person pending. The owner's wallet then signs
   * every payment at once and reports each one as it lands (below).
   */
  .post('/business/payroll', requireApiKey, requireMerchantKey, async (c) => {
    const merchant = c.get('merchant')
    const input = await body(c, runBody)
    const lines = input.payments.map((p) => ({
      personId: p.person ? decodeId('payrollPerson', p.person) : null,
      name: p.name,
      amount: money(p.amount),
    }))
    const total = lines.reduce((sum, l) => sum + l.amount, 0n)
    const runId = uuidv7()
    const created = await db.transaction(async (tx) => {
      const [r] = await tx
        .insert(schema.payrollRuns)
        .values({ id: runId, merchantId: merchant.id, network: config.KOVA_NETWORK, label: input.label, total })
        .returning()
      const payments = await tx
        .insert(schema.payrollPayments)
        .values(lines.map((l) => ({ id: uuidv7(), runId, personId: l.personId, name: l.name, amount: l.amount })))
        .returning()
      return { r: r as typeof schema.payrollRuns.$inferSelect, payments }
    })
    return c.json(run(created.r, created.payments), 201)
  })

  /** One person's pay landed (checked on Monad), or couldn't be sent. */
  .post('/business/payroll/:id/payments/:payment', requireApiKey, requireMerchantKey, async (c) => {
    const merchant = c.get('merchant')
    const found = await ownRun(merchant.id, c.req.param('id'))
    const paymentId = decodeId('payrollPayment', c.req.param('payment'))
    const row = paymentId
      ? await db.query.payrollPayments.findFirst({ where: and(eq(schema.payrollPayments.id, paymentId), eq(schema.payrollPayments.runId, found.id)) })
      : null
    if (!row) throw new KovaError('not_found', 'No such payment in this payroll.')
    if (row.status === 'paid') return c.json(payment(row))
    const input = await body(c, paidBody)
    if ('failure' in input) {
      const [failed] = await db
        .update(schema.payrollPayments)
        .set({ status: 'failed', failure: input.failure })
        .where(eq(schema.payrollPayments.id, row.id))
        .returning()
      return c.json(payment(failed as typeof schema.payrollPayments.$inferSelect))
    }
    if (!isHash(input.tx_hash)) throw new KovaError('invalid_request', 'tx_hash isn’t a transaction hash.')
    const to = wallet(input.stealth_address)
    await confirmTransfer(merchant, input.tx_hash, to, row.amount)
    const [paid] = await db
      .update(schema.payrollPayments)
      .set({ status: 'paid', failure: null, stealthAddress: to.toLowerCase(), txHash: input.tx_hash, paidAt: new Date() })
      .where(eq(schema.payrollPayments.id, row.id))
      .returning()
    return c.json(payment(paid as typeof schema.payrollPayments.$inferSelect))
  })

  // --- Suppliers ---

  .get('/business/suppliers', requireApiKey, requireMerchantKey, async (c) => {
    const merchant = c.get('merchant')
    const [rows, stats] = await Promise.all([
      db.query.suppliers.findMany({ where: eq(schema.suppliers.merchantId, merchant.id), orderBy: schema.suppliers.name }),
      db
        .select({
          supplierId: schema.supplierPayments.supplierId,
          total: sql<string>`sum(${schema.supplierPayments.amount})`,
          count: sql<number>`count(*)::int`,
          last: sql<Date | null>`max(${schema.supplierPayments.createdAt})`,
        })
        .from(schema.supplierPayments)
        .where(and(eq(schema.supplierPayments.merchantId, merchant.id), eq(schema.supplierPayments.network, config.KOVA_NETWORK)))
        .groupBy(schema.supplierPayments.supplierId),
    ])
    const bySupplier = new Map(stats.map((s) => [s.supplierId, { total: BigInt(s.total ?? '0'), count: s.count, last: s.last ? new Date(s.last) : null }]))
    return c.json({ object: 'list', data: rows.map((s) => supplier(s, bySupplier.get(s.id))) })
  })

  .post('/business/suppliers', requireApiKey, requireMerchantKey, async (c) => {
    const merchant = c.get('merchant')
    const input = await body(c, supplierBody)
    const address = wallet(input.wallet_address)
    if (payers(merchant).some((p) => isAddressEqual(p, address)))
      throw new KovaError('invalid_request', 'That’s the business’s own wallet. Add your supplier’s wallet.')
    const [row] = await db
      .insert(schema.suppliers)
      .values({
        id: uuidv7(),
        merchantId: merchant.id,
        name: input.name,
        walletAddress: address.toLowerCase(),
        country: input.country || null,
        currency: input.currency,
      })
      .onConflictDoUpdate({
        target: [schema.suppliers.merchantId, schema.suppliers.walletAddress],
        set: { name: input.name, country: input.country || null, currency: input.currency, updatedAt: new Date() },
      })
      .returning()
    return c.json(supplier(row as typeof schema.suppliers.$inferSelect), 201)
  })

  .delete('/business/suppliers/:id', requireApiKey, requireMerchantKey, async (c) => {
    const merchant = c.get('merchant')
    const found = await ownSupplier(merchant.id, c.req.param('id'))
    const paid = await db.query.supplierPayments.findFirst({ where: eq(schema.supplierPayments.supplierId, found.id) })
    if (paid) throw new KovaError('conflict', 'This supplier has payments in your book, so they stay. Rename them instead.')
    await db.delete(schema.suppliers).where(eq(schema.suppliers.id, found.id))
    return c.json({ deleted: true })
  })

  /** Every supplier payment, newest first, or one supplier's with ?supplier=. */
  .get('/business/supplier_payments', requireApiKey, requireMerchantKey, async (c) => {
    const merchant = c.get('merchant')
    const filter = c.req.query('supplier')
    const supplierId = filter ? decodeId('supplier', filter) : null
    if (filter && !supplierId) throw new KovaError('not_found', 'No such supplier.')
    const rows = await db
      .select({ p: schema.supplierPayments, name: schema.suppliers.name })
      .from(schema.supplierPayments)
      .innerJoin(schema.suppliers, eq(schema.suppliers.id, schema.supplierPayments.supplierId))
      .where(
        and(
          eq(schema.supplierPayments.merchantId, merchant.id),
          eq(schema.supplierPayments.network, config.KOVA_NETWORK),
          supplierId ? eq(schema.supplierPayments.supplierId, supplierId) : undefined,
        ),
      )
      .orderBy(desc(schema.supplierPayments.createdAt))
      .limit(100)
    return c.json({ object: 'list', data: rows.map((r) => supplierPayment(r.p, r.name)) })
  })

  /** A supplier was paid: recorded once Monad shows the business's dollars reached them. */
  .post('/business/suppliers/:id/payments', requireApiKey, requireMerchantKey, async (c) => {
    const merchant = c.get('merchant')
    const found = await ownSupplier(merchant.id, c.req.param('id'))
    const input = await body(c, supplierPaymentBody)
    if (!isHash(input.tx_hash)) throw new KovaError('invalid_request', 'tx_hash isn’t a transaction hash.')
    const amount = money(input.amount)
    const existing = await db.query.supplierPayments.findFirst({ where: eq(schema.supplierPayments.txHash, input.tx_hash) })
    if (existing) {
      if (existing.merchantId !== merchant.id) throw new KovaError('conflict', 'That transaction is already in another book.')
      return c.json(supplierPayment(existing, found.name))
    }
    await confirmTransfer(merchant, input.tx_hash, getAddress(found.walletAddress), amount)
    const [row] = await db
      .insert(schema.supplierPayments)
      .values({
        id: uuidv7(),
        merchantId: merchant.id,
        supplierId: found.id,
        network: config.KOVA_NETWORK,
        amount,
        note: input.note || null,
        txHash: input.tx_hash,
      })
      .returning()
    return c.json(supplierPayment(row as typeof schema.supplierPayments.$inferSelect, found.name), 201)
  })
