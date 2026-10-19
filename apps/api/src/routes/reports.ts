import { schema } from '@kova/db'
import { formatAmount } from '@kova/monad'
import { and, desc, eq, ilike, inArray, lt, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireApiKey } from '../auth.js'
import { db } from '../db.js'
import { KovaError } from '../errors.js'
import { encodeId } from '../ids.js'
import { serializeIntent } from '../services/intents.js'
import { ordersForIntents } from '../services/orders.js'

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z
    .enum(['requires_payment', 'processing', 'paid', 'held', 'failed', 'canceled', 'expired'])
    .optional(),
  /** Cursor: return intents created strictly before this ISO timestamp. */
  before: z.string().datetime().optional(),
  /** Search the shop's own reference. */
  q: z.string().trim().max(100).optional(),
})

/**
 * The shop's time zone decides what "today" and "noon" mean. Intl and Postgres read the same
 * IANA database, so a zone Intl accepts is one Postgres knows. None given: UTC.
 */
function zone(tz: string | undefined) {
  if (!tz) return 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    throw new KovaError('invalid_request', `Unknown time zone: ${tz}`)
  }
}

/** Merchant-facing reads: the transaction feed and the day's totals. */
export const reportRoutes = new Hono()
  .use(requireApiKey)
  .get('/payment_intents', async (c) => {
    const parsed = listQuery.safeParse(c.req.query())
    if (!parsed.success)
      throw new KovaError('invalid_request', 'Invalid query', { issues: parsed.error.issues })
    const { limit, status, before, q } = parsed.data
    const merchantId = c.get('merchant').id

    const rows = await db.query.paymentIntents.findMany({
      where: and(
        eq(schema.paymentIntents.merchantId, merchantId),
        status ? eq(schema.paymentIntents.status, status) : undefined,
        before ? lt(schema.paymentIntents.createdAt, new Date(before)) : undefined,
        q
          ? ilike(schema.paymentIntents.reference, `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`)
          : undefined,
      ),
      orderBy: desc(schema.paymentIntents.createdAt),
      limit: limit + 1,
    })

    const page = rows.slice(0, limit)
    // Name the terminal that took each charge, so a feed can say "Front counter".
    const terminalIds = [...new Set(page.flatMap((r) => (r.terminalId ? [r.terminalId] : [])))]
    const terminals = terminalIds.length
      ? await db.query.terminals.findMany({ where: inArray(schema.terminals.id, terminalIds) })
      : []
    const names = new Map(terminals.map((t) => [t.id, t.name]))
    const orders = await ordersForIntents(page.map((r) => r.id))

    return c.json({
      object: 'list',
      data: page.map((r) => ({
        ...serializeIntent(r),
        terminal: r.terminalId
          ? { id: encodeId('terminal', r.terminalId), name: names.get(r.terminalId) ?? 'Terminal' }
          : null,
        order: orders.get(r.id) ?? null,
      })),
      has_more: rows.length > limit,
      next_before: page.at(-1)?.createdAt.toISOString() ?? null,
    })
  })
  /**
   * Everything the dashboard overview shows, in one call: today (by hour and by terminal), the
   * last fourteen days, and the shop's lifetime totals. "Today" is the shop's own day, from
   * local midnight in `tz`.
   */
  .get('/summary', async (c) => {
    const merchantId = c.get('merchant').id
    const tz = zone(c.req.query('tz'))
    const midnight = sql`timezone(${tz}, date_trunc('day', timezone(${tz}, now())))`
    const paid = and(
      eq(schema.paymentIntents.merchantId, merchantId),
      eq(schema.paymentIntents.status, 'paid'),
    )
    const totals = {
      total: sql<string>`coalesce(sum(${schema.paymentIntents.amount}), 0)`,
      count: sql<number>`count(*)::int`,
    }

    const [[today], [allTime], [open], last, hourly, daily, byTerminal, byStall] =
      await Promise.all([
        db
          .select(totals)
          .from(schema.paymentIntents)
          .where(and(paid, sql`${schema.paymentIntents.paidAt} >= ${midnight}`)),
        db.select(totals).from(schema.paymentIntents).where(paid),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.paymentIntents)
          .where(
            and(
              eq(schema.paymentIntents.merchantId, merchantId),
              inArray(schema.paymentIntents.status, ['requires_payment', 'processing']),
            ),
          ),
        db.query.paymentIntents.findFirst({
          where: paid,
          orderBy: desc(schema.paymentIntents.paidAt),
        }),
        db.execute<{ hour: number; total: string; count: number }>(sql`
        select h.hour::int as hour, coalesce(sum(i.amount), 0)::text as total, count(i.id)::int as count
        from generate_series(0, 23) as h(hour)
        left join payment_intents i
          on i.merchant_id = ${merchantId} and i.status = 'paid'
         and i.paid_at >= ${midnight}
         and extract(hour from timezone(${tz}, i.paid_at)) = h.hour
        group by h.hour
        order by h.hour
      `),
        db.execute<{ day: string; total: string; count: number }>(sql`
        select to_char(d.day, 'YYYY-MM-DD') as day, coalesce(sum(i.amount), 0)::text as total, count(i.id)::int as count
        from generate_series(timezone(${tz}, now())::date - 13, timezone(${tz}, now())::date, interval '1 day') as d(day)
        left join payment_intents i
          on i.merchant_id = ${merchantId} and i.status = 'paid'
         and timezone(${tz}, i.paid_at)::date = d.day
        group by d.day
        order by d.day
      `),
        db.execute<{
          terminal_id: string | null
          name: string | null
          total: string
          count: number
        }>(sql`
        select i.terminal_id, t.name, coalesce(sum(i.amount), 0)::text as total, count(*)::int as count
        from payment_intents i
        left join terminals t on t.id = i.terminal_id
        where i.merchant_id = ${merchantId} and i.status = 'paid' and i.paid_at >= ${midnight}
          and not exists (select 1 from orders o where o.intent_id = i.id and o.stall_id is not null)
        group by i.terminal_id, t.name
        order by sum(i.amount) desc
      `),
        db.execute<{
          stall_id: string
          name: string
          slug: string
          total: string
          count: number
        }>(sql`
        select s.id as stall_id, s.name, s.slug, coalesce(sum(i.amount), 0)::text as total, count(*)::int as count
        from orders o
        join payment_intents i on i.id = o.intent_id
        join stalls s on s.id = o.stall_id
        where o.merchant_id = ${merchantId} and i.status = 'paid' and i.paid_at >= ${midnight}
        group by s.id, s.name, s.slug
        order by sum(i.amount) desc
      `),
      ])

    const merchant = c.get('merchant')
    return c.json({
      merchant: {
        id: encodeId('merchant', merchant.id),
        name: merchant.name,
        settlement_address: merchant.settlementAddress,
        network: merchant.network,
        livemode: !merchant.isTest,
      },
      timezone: tz,
      today: { total: formatAmount(BigInt(today?.total ?? 0)), count: today?.count ?? 0 },
      all_time: { total: formatAmount(BigInt(allTime?.total ?? 0)), count: allTime?.count ?? 0 },
      open_intents: open?.count ?? 0,
      last_paid_at: last?.paidAt?.toISOString() ?? null,
      hourly: [...hourly].map((h) => ({
        hour: h.hour,
        total: formatAmount(BigInt(h.total)),
        count: h.count,
      })),
      daily: [...daily].map((d) => ({
        date: d.day,
        total: formatAmount(BigInt(d.total)),
        count: d.count,
      })),
      /** Today's takings per stall. */
      by_stall: [...byStall].map((s) => ({
        stall: { id: encodeId('stall', s.stall_id), name: s.name, slug: s.slug },
        total: formatAmount(BigInt(s.total)),
        count: s.count,
      })),
      /** Today's takings per terminal; `terminal: null` is everything else taken through the API. */
      by_terminal: [...byTerminal].map((t) => ({
        terminal: t.terminal_id
          ? { id: encodeId('terminal', t.terminal_id), name: t.name ?? 'Terminal' }
          : null,
        total: formatAmount(BigInt(t.total)),
        count: t.count,
      })),
    })
  })
