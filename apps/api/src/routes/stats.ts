import { schema } from '@kova/db'
import { formatAmount } from '@kova/monad'
import { type SQL, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { feePayerAddress, settlementToken } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { KovaError } from '../errors.js'
import { clientIp, limit } from '../limits.js'
import { demoAddresses } from '../services/demo.js'

/**
 * Public numbers: how many people use Kova on this network, what they've paid and sent, what they've
 * cashed out to naira, and where new people came from. Only totals leave the server: never an address, a name or an amount by person.
 *
 * A person is a wallet that did something only Kova wallets do: made its passkey vault, published a
 * note key, took test dollars, paid a Kova charge, made or claimed a link, or owns a shop. Each network
 * has its own database, so this API's numbers are this network's.
 *
 * Money moved is read off the chain (the watcher's index of every dollar transfer): each transfer
 * into or out of a person's wallet, so sends, payments, cash-outs, deposits and top-ups all count,
 * each once. Kova's demo wallets and its treasury (testnet's free test dollars) are left out.
 */

/** The daily series' length; the SQL below says the same 14 days. */
const DAYS = 14

interface Numbers {
  network: string
  people: number
  people_7d: number
  shops: number
  payments: number
  volume: string
  /** Dollar transfers into or out of people's wallets, and the dollars they moved. */
  moved: number
  moved_volume: string
  links: number
  links_claimed: number
  /** Cash-outs to naira that reached the bank: how many, the dollars they took, the naira they paid. */
  cash_outs: number
  cash_out_volume: string
  cash_out_naira: string
  daily: { date: string; people: number; payments: number; cash_outs: number; moved: number }[]
  sources: { ref: string; visits: number; wallets: number }[]
  updated_at: string
}

let cached: { at: number; numbers: Numbers } | null = null

/** Rows from a raw query, whichever shape the driver returns them in. */
async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as T[] | { rows: T[] }
  return Array.isArray(result) ? result : result.rows
}

async function count(query: ReturnType<typeof sql>): Promise<number> {
  const [row] = await rows<Record<string, unknown>>(query)
  return Number(row ? Object.values(row)[0] : 0)
}

/** Every Kova wallet, first seen: the signals only Kova wallets leave. */
const seen = sql`
  select lower(id) as address, created_at as at from wallet_vaults
  union all select lower(address), created_at from note_keys
  union all select lower(address), claimed_at from test_dollar_claims
  union all select lower(payer_address), created_at from payments where status = 'paid'
  union all select lower(sender_address), created_at from payment_links
  union all select lower(claimed_by), claimed_at from payment_links where claimed_by is not null
  union all select lower(owner_address), created_at from merchants where owner_address is not null`

async function compute(): Promise<Numbers> {
  // Kova's own demo account (the one App Review signs into) buys and sells to stay lived-in: its
  // wallets, shops and purchases are left out, so these numbers are other people's.
  const own = await demoAddresses()
  const notOwn = (column: SQL) =>
    own.length
      ? sql`${column} not in (${sql.join(
          own.map((a) => sql`${a}`),
          sql`, `,
        )})`
      : sql`true`
  const people = sql`select address, min(at) as first from (${seen}) s where address like '0x%' and ${notOwn(sql`address`)} group by address`
  const paidByOthers = sql`status = 'paid' and ${notOwn(sql`lower(payer_address)`)}`
  // Every dollar transfer that touched a person's wallet, with the demo wallets and the treasury
  // (which hands out testnet's free test dollars) on neither side.
  const kova = [...own, ...(feePayerAddress ? [feePayerAddress.toLowerCase()] : [])]
  const notKova = (column: SQL) =>
    kova.length
      ? sql`${column} not in (${sql.join(
          kova.map((a) => sql`${a}`),
          sql`, `,
        )})`
      : sql`true`
  const wallets = sql`select address from (${people}) w`
  const moves = sql`select amount, created_at from transfers where token_address = ${settlementToken.address.toLowerCase()} and (from_address in (${wallets}) or to_address in (${wallets})) and ${notKova(sql`from_address`)} and ${notKova(sql`to_address`)}`
  const cashedOut = sql`status = 'paid' and ${notOwn(sql`lower(wallet_address)`)}`
  const [
    total,
    recent,
    shops,
    payments,
    volume,
    links,
    claimed,
    cashOuts,
    cashOutDollars,
    kobo,
    moved,
    movedDollars,
  ] = await Promise.all([
    count(sql`select count(*) from (${people}) p`),
    count(sql`select count(*) from (${people}) p where first > now() - interval '7 days'`),
    count(
      sql`select count(*) from merchants where status = 'active' and ${notOwn(sql`coalesce(lower(owner_address), '')`)} and ${notOwn(sql`lower(settlement_address)`)}`,
    ),
    count(sql`select count(*) from payments where ${paidByOthers}`),
    count(sql`select coalesce(sum(amount), 0) from payments where ${paidByOthers}`),
    count(sql`select count(*) from payment_links`),
    count(sql`select count(*) from payment_links where status = 'claimed'`),
    count(sql`select count(*) from cash_outs where ${cashedOut}`),
    count(sql`select coalesce(sum(amount), 0) from cash_outs where ${cashedOut}`),
    count(sql`select coalesce(sum(naira), 0) from cash_outs where ${cashedOut}`),
    count(sql`select count(*) from (${moves}) m`),
    count(sql`select coalesce(sum(amount), 0) from (${moves}) m`),
  ])
  const newPeople = await rows<{ day: string; n: string }>(
    sql`select to_char(date_trunc('day', first), 'YYYY-MM-DD') as day, count(*) as n from (${people}) p where first > now() - interval '14 days' group by 1`,
  )
  const paid = await rows<{ day: string; n: string }>(
    sql`select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, count(*) as n from payments where ${paidByOthers} and created_at > now() - interval '14 days' group by 1`,
  )
  const cashed = await rows<{ day: string; n: string }>(
    sql`select to_char(date_trunc('day', paid_at), 'YYYY-MM-DD') as day, count(*) as n from cash_outs where ${cashedOut} and paid_at > now() - interval '14 days' group by 1`,
  )
  const movedDaily = await rows<{ day: string; n: string }>(
    sql`select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, count(*) as n from (${moves}) m where created_at > now() - interval '14 days' group by 1`,
  )
  const daily = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(Date.now() - (DAYS - 1 - i) * 86_400_000).toISOString().slice(0, 10)
    return {
      date: d,
      people: Number(newPeople.find((r) => r.day === d)?.n ?? 0),
      payments: Number(paid.find((r) => r.day === d)?.n ?? 0),
      cash_outs: Number(cashed.find((r) => r.day === d)?.n ?? 0),
      moved: Number(movedDaily.find((r) => r.day === d)?.n ?? 0),
    }
  })
  const sources = await db
    .select({
      ref: schema.referralCounts.ref,
      visits: sql<number>`sum(${schema.referralCounts.visits})`,
      wallets: sql<number>`sum(${schema.referralCounts.wallets})`,
    })
    .from(schema.referralCounts)
    .groupBy(schema.referralCounts.ref)
  return {
    network: config.KOVA_NETWORK,
    people: total,
    people_7d: recent,
    shops,
    payments,
    volume: formatAmount(BigInt(volume)),
    moved,
    moved_volume: formatAmount(BigInt(movedDollars)),
    links,
    links_claimed: claimed,
    cash_outs: cashOuts,
    cash_out_volume: formatAmount(BigInt(cashOutDollars)),
    cash_out_naira: (kobo / 100).toFixed(2),
    daily,
    sources: sources
      .map((s) => ({ ref: s.ref, visits: Number(s.visits), wallets: Number(s.wallets) }))
      .sort((a, b) => b.wallets - a.wallets || b.visits - a.visits)
      .slice(0, 12),
    updated_at: new Date().toISOString(),
  }
}

const visitBody = z.object({
  /** Where they came from: a short label from the link they followed, like "x" or "monad-discord". */
  ref: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9_-]{0,31}$/),
  /** visit: they opened /try; wallet: that browser now has a Kova wallet. Counted once per browser. */
  step: z.enum(['visit', 'wallet']),
})

export const statsRoutes = new Hono()
  /** Public: this network's numbers, a minute fresh. */
  .get('/public/stats', async (c) => {
    if (!cached || Date.now() - cached.at > 60_000)
      cached = { at: Date.now(), numbers: await compute() }
    return c.json({ object: 'stats', ...cached.numbers })
  })

  /** Public: one step of the funnel from a source. Counts only; nothing about the person is kept. */
  .post('/public/visits', async (c) => {
    limit(`visit-ip:${clientIp(c)}`, 20, 3_600_000, 'Thanks, counted.')
    const parsed = visitBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) throw new KovaError('invalid_request', 'Expected { ref, step }')
    const { ref, step } = parsed.data
    const day = new Date().toISOString().slice(0, 10)
    await db
      .insert(schema.referralCounts)
      .values({ ref, day, visits: step === 'visit' ? 1 : 0, wallets: step === 'wallet' ? 1 : 0 })
      .onConflictDoUpdate({
        target: [schema.referralCounts.ref, schema.referralCounts.day],
        set:
          step === 'visit'
            ? { visits: sql`${schema.referralCounts.visits} + 1` }
            : { wallets: sql`${schema.referralCounts.wallets} + 1` },
      })
    return c.json({ object: 'visit', ref, step })
  })
