import { type SQL, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { type Address, erc20Abi, getAddress, isAddress } from 'viem'
import { publicClient, settlementToken } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { KovaError } from '../errors.js'
import { requireAdmin } from '../services/admin-auth.js'
import { demoAddresses } from '../services/demo.js'
import { cardIssueProblem } from '../services/dollar-card.js'
import { seen } from './stats.js'

/**
 * Kova's own dashboard (mykova.app/admin): who uses Kova on this network and where each person
 * stands. Kova's team only: x-kova-admin with KOVA_ADMIN_SECRET, or these routes don't exist. The
 * web server holds the secret and opens the page only to the wallets in KOVA_ADMIN_WALLETS.
 *
 * A person is a wallet that did something only Kova wallets do (stats.ts), or started a card check,
 * a cash-out, a spending key or a phone account. Kova keeps no names for most wallets: a name shows
 * only where the person gave one, for the card's ID check, a shop or a spending key.
 *
 *   GET /admin/overview            totals, new people by day, money moved, and what needs a look
 *   GET /admin/people?q=&page=     everyone, newest first, with live dollar balances
 *   GET /admin/people/:address     one person: ID check and card, cash-outs, shops, keys, activity
 */

const PAGE = 50

/** Rows from a raw query, whichever shape the driver returns them in. */
async function rows<T>(query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as T[] | { rows: T[] }
  return Array.isArray(result) ? result : result.rows
}

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null)
const num = (value: unknown) => Number(value ?? 0)
const units = (value: unknown) => String(value ?? '0').split('.')[0] || '0'

/** Everyone, with when they were first and last seen doing something with Kova. */
const everyone = sql`
  select address, min(at) as first_seen, max(at) as last_seen from (
    ${seen}
    union all select lower(wallet), created_at from card_holders
    union all select lower(wallet), created_at from payouts
    union all select lower(wallet_address), created_at from cash_outs
    union all select lower(owner_address), created_at from wallet_keys
    union all select lower(wallet), created_at from phone_accounts where wallet is not null
  ) s where address like '0x%' group by address`

/** Dollar balances on Monad, read in one multicall per 400 wallets; null where it can't be read. */
async function balances(addresses: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  for (let i = 0; i < addresses.length; i += 400) {
    const chunk = addresses.slice(i, i + 400)
    const results = await publicClient
      .multicall({
        allowFailure: true,
        contracts: chunk.map((address) => ({
          address: settlementToken.address,
          abi: erc20Abi,
          functionName: 'balanceOf' as const,
          args: [address as Address],
        })),
      })
      .catch(() => chunk.map(() => ({ status: 'failure' as const, result: undefined })))
    chunk.forEach((address, n) => {
      const r = results[n]
      out.set(address, r?.status === 'success' ? String(r.result) : null)
    })
  }
  return out
}

/** Held by everyone, cached a minute: it reads every wallet's balance. */
let held: { at: number; total: string; wallets: number } | null = null
async function heldByEveryone(addresses: string[]) {
  if (held && Date.now() - held.at < 60_000 && held.wallets === addresses.length) return held
  const all = await balances(addresses.slice(0, 5000))
  let total = 0n
  for (const v of all.values()) if (v) total += BigInt(v)
  held = { at: Date.now(), total: total.toString(), wallets: addresses.length }
  return held
}

interface Attention {
  kind: 'card' | 'check' | 'payout' | 'naira'
  wallet: string
  title: string
  detail: string | null
  since: string | null
}

async function attention(): Promise<Attention[]> {
  const [cards, checks, payouts, naira] = await Promise.all([
    rows<Record<string, unknown>>(sql`
      select h.id, lower(h.wallet) as wallet, h.reason, h.updated_at from card_holders h
      where h.status = 'approved'
        and not exists (select 1 from dollar_cards d where lower(d.wallet) = lower(h.wallet) and d.state <> 'closed')
        and h.updated_at < now() - interval '15 minutes'
      order by h.updated_at desc limit 50`),
    rows<Record<string, unknown>>(sql`
      select lower(wallet) as wallet, status, reason, updated_at from card_holders
      where reason is not null and status <> 'approved' and updated_at > now() - interval '30 days'
      order by updated_at desc limit 50`),
    rows<Record<string, unknown>>(sql`
      select lower(wallet) as wallet, status, amount, currency, failure, created_at from payouts
      where status in ('held', 'refunding')
         or (status in ('received', 'sending') and created_at < now() - interval '1 hour')
         or (status = 'failed' and tx_hash is not null and refund_tx_hash is null)
      order by created_at desc limit 50`),
    rows<Record<string, unknown>>(sql`
      select lower(wallet_address) as wallet, status, amount, failure, created_at from cash_outs
      where status = 'refunding'
         or (status in ('received', 'paying', 'settled') and created_at < now() - interval '1 hour')
         or (status = 'failed' and tx_hash is not null and refund_tx_hash is null)
      order by created_at desc limit 50`),
  ])
  return [
    ...cards.map((r) => ({
      kind: 'card' as const,
      wallet: String(r.wallet),
      title: 'ID approved, card not made',
      detail: cardIssueProblem(String(r.id)) ?? (r.reason ? String(r.reason) : null),
      since: iso(r.updated_at),
    })),
    ...checks.map((r) => ({
      kind: 'check' as const,
      wallet: String(r.wallet),
      title: r.status === 'failed' ? 'ID check failed' : 'ID check refused',
      detail: r.reason ? String(r.reason) : null,
      since: iso(r.updated_at),
    })),
    ...payouts.map((r) => ({
      kind: 'payout' as const,
      wallet: String(r.wallet),
      title: `Cash-out abroad ${r.status === 'failed' ? 'failed, not sent back yet' : `stuck at “${r.status}”`}`,
      detail: r.failure ? String(r.failure) : `${units(r.amount)} units, to ${r.currency}`,
      since: iso(r.created_at),
    })),
    ...naira.map((r) => ({
      kind: 'naira' as const,
      wallet: String(r.wallet),
      title: `Naira cash-out ${r.status === 'failed' ? 'failed, not sent back yet' : `stuck at “${r.status}”`}`,
      detail: r.failure ? String(r.failure) : null,
      since: iso(r.created_at),
    })),
  ].sort((a, b) => (b.since ?? '').localeCompare(a.since ?? ''))
}

function wallet(raw: string) {
  if (!isAddress(raw, { strict: false }))
    throw new KovaError('invalid_request', 'That isn’t a wallet address.')
  return raw.toLowerCase()
}

export const adminRoutes = new Hono()
  .get('/admin/overview', async (c) => {
    requireAdmin(c)
    const own = new Set((await demoAddresses()).map((a) => a.toLowerCase()))
    const people = await rows<{ address: string; first_seen: string }>(
      sql`select address, first_seen from (${everyone}) p`,
    )
    const others = people.filter((p) => !own.has(p.address))
    const now = Date.now()
    const since = (days: number) =>
      others.filter((p) => now - new Date(p.first_seen).getTime() < days * 86_400_000).length
    const today = new Date().toISOString().slice(0, 10)
    const daily = Array.from({ length: 30 }, (_, i) => {
      const day = new Date(now - (29 - i) * 86_400_000).toISOString().slice(0, 10)
      return {
        day,
        n: others.filter((p) => new Date(p.first_seen).toISOString().slice(0, 10) === day).length,
      }
    })
    const addresses = others.map((p) => p.address)
    const token = settlementToken.address.toLowerCase()
    const [active, money, card, live, wallets] = await Promise.all([
      rows<{ n: string }>(sql`
        select count(distinct a) as n from (
          select lower(from_address) as a from transfers where token_address = ${token} and created_at > now() - interval '7 days'
          union all select lower(to_address) from transfers where token_address = ${token} and created_at > now() - interval '7 days'
        ) t where a in (select address from (${everyone}) p)`),
      rows<Record<string, unknown>>(sql`select
        (select count(*) from payments where status = 'paid' and created_at > now() - interval '30 days') as payments,
        (select coalesce(sum(amount), 0) from payments where status = 'paid' and created_at > now() - interval '30 days') as payments_amount,
        (select count(*) from cash_outs where status = 'paid') as naira,
        (select coalesce(sum(amount), 0) from cash_outs where status = 'paid') as naira_amount,
        (select coalesce(sum(naira), 0) from cash_outs where status = 'paid') as naira_kobo,
        (select count(*) from payouts where status = 'paid') as abroad,
        (select coalesce(sum(amount), 0) from payouts where status = 'paid') as abroad_amount,
        (select count(*) from card_topups where status <> 'failed') as topups,
        (select coalesce(sum(amount), 0) from card_topups where status <> 'failed') as topups_amount,
        (select count(*) from merchants where status = 'active') as shops,
        (select count(*) from wallet_keys where status <> 'removed') as keys`),
      rows<{ status: string; n: string }>(
        sql`select status, count(*) as n from card_holders group by status`,
      ),
      rows<{ n: string }>(sql`select count(*) as n from dollar_cards where state <> 'closed'`),
      heldByEveryone(addresses).catch(() => null),
    ])
    const m = money[0] ?? {}
    const byStatus = Object.fromEntries(card.map((r) => [r.status, num(r.n)]))
    return c.json({
      network: config.KOVA_NETWORK,
      generated_at: new Date().toISOString(),
      people: {
        total: others.length,
        today: others.filter((p) => new Date(p.first_seen).toISOString().slice(0, 10) === today)
          .length,
        week: since(7),
        month: since(30),
        active_week: num(active[0]?.n),
        daily,
      },
      held: wallets ? { total: wallets.total, wallets: wallets.wallets } : null,
      money: {
        payments_30d: { count: num(m.payments), amount: units(m.payments_amount) },
        naira: { count: num(m.naira), amount: units(m.naira_amount), kobo: units(m.naira_kobo) },
        abroad: { count: num(m.abroad), amount: units(m.abroad_amount) },
        card_topups: { count: num(m.topups), amount: units(m.topups_amount) },
        shops: num(m.shops),
        keys: num(m.keys),
      },
      card: {
        not_sent: byStatus.incomplete ?? 0,
        reviewing: byStatus.pending ?? 0,
        approved: byStatus.approved ?? 0,
        failed: (byStatus.failed ?? 0) + (byStatus.blocked ?? 0),
        cards: num(live[0]?.n),
      },
      attention: await attention(),
    })
  })
  .get('/admin/people', async (c) => {
    requireAdmin(c)
    const q = (c.req.query('q') ?? '').trim().toLowerCase().slice(0, 80)
    const page = Math.max(1, Math.min(10_000, Number(c.req.query('page') ?? 1) || 1))
    const like = `%${q.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`
    const match = q
      ? sql`(p.address like ${like}
          or lower(coalesce(h.first_name, '') || ' ' || coalesce(h.last_name, '')) like ${like}
          or lower(coalesce(h.email, '')) like ${like}
          or exists (select 1 from merchants m where lower(m.owner_address) = p.address and lower(m.name) like ${like})
          or exists (select 1 from wallet_keys k where lower(k.owner_address) = p.address and lower(coalesce(k.owner_name, '')) like ${like}))`
      : sql`true`
    const base = sql`from (${everyone}) p left join card_holders h on lower(h.wallet) = p.address where ${match}`
    const [found, list] = await Promise.all([
      rows<{ n: string }>(sql`select count(*) as n ${base}`),
      rows<Record<string, unknown>>(sql`
        select p.address, p.first_seen, p.last_seen,
          h.status as check_status, h.first_name, h.last_name, h.email,
          (select count(*) from dollar_cards d where lower(d.wallet) = p.address and d.state <> 'closed') as cards,
          (select min(m.name) from merchants m where lower(m.owner_address) = p.address) as shop,
          (select count(*) from merchants m where lower(m.owner_address) = p.address) as shops,
          (select max(k.owner_name) from wallet_keys k where lower(k.owner_address) = p.address) as keys_name,
          (select count(*) from cash_outs o where lower(o.wallet_address) = p.address and o.status = 'paid') as naira,
          (select count(*) from payouts o where lower(o.wallet) = p.address and o.status = 'paid') as abroad
        ${base}
        order by p.first_seen desc
        limit ${PAGE} offset ${(page - 1) * PAGE}`),
    ])
    const own = new Set((await demoAddresses()).map((a) => a.toLowerCase()))
    const money = await balances(list.map((r) => String(r.address)))
    const total = num(found[0]?.n)
    return c.json({
      data: list.map((r) => {
        const address = String(r.address)
        const checked = [r.first_name, r.last_name].filter(Boolean).join(' ')
        return {
          address: getAddress(address),
          first_seen: iso(r.first_seen),
          last_seen: iso(r.last_seen),
          name: checked || (r.keys_name as string | null) || null,
          email: (r.email as string | null) ?? null,
          shop: (r.shop as string | null) ?? null,
          balance: money.get(address) ?? null,
          check: (r.check_status as string | null) ?? null,
          card: num(r.cards) > 0,
          shops: num(r.shops),
          cash_outs: num(r.naira) + num(r.abroad),
          demo: own.has(address),
        }
      }),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / PAGE)),
    })
  })
  .get('/admin/people/:address', async (c) => {
    requireAdmin(c)
    const address = wallet(c.req.param('address'))
    const token = settlementToken.address.toLowerCase()
    const [person, holder, card, payouts, naira, shops, keys, phone, activity, topups] =
      await Promise.all([
        rows<Record<string, unknown>>(
          sql`select first_seen, last_seen from (${everyone}) p where address = ${address}`,
        ),
        rows<Record<string, unknown>>(
          sql`select id, status, reason, first_name, last_name, email, phone, account_id, created_at, updated_at from card_holders where lower(wallet) = ${address} limit 1`,
        ),
        rows<Record<string, unknown>>(
          sql`select last_four, brand, state, created_at from dollar_cards where lower(wallet) = ${address} order by created_at desc limit 3`,
        ),
        rows<Record<string, unknown>>(
          sql`select id, amount, currency, amount_to, status, failure, created_at, paid_at from payouts where lower(wallet) = ${address} order by created_at desc limit 20`,
        ),
        rows<Record<string, unknown>>(
          sql`select id, amount, naira, bank_name, account_number, status, failure, created_at, paid_at from cash_outs where lower(wallet_address) = ${address} order by created_at desc limit 20`,
        ),
        rows<Record<string, unknown>>(
          sql`select id, name, slug, status, created_at from merchants where lower(owner_address) = ${address} order by created_at desc`,
        ),
        rows<Record<string, unknown>>(
          sql`select kind, label, holder_name, owner_name, status, spend_limit, created_at, last_used_at from wallet_keys where lower(owner_address) = ${address} order by created_at desc limit 30`,
        ),
        rows<Record<string, unknown>>(
          sql`select phone, verified_at from phone_accounts where lower(wallet) = ${address} order by created_at desc limit 1`,
        ),
        rows<Record<string, unknown>>(
          sql`select lower(from_address) as from_address, lower(to_address) as to_address, amount, tx_hash, created_at from transfers
              where token_address = ${token} and (lower(from_address) = ${address} or lower(to_address) = ${address})
              order by block_number desc, log_index desc limit 25`,
        ),
        rows<Record<string, unknown>>(
          sql`select count(*) as n, coalesce(sum(amount), 0) as amount from card_topups where lower(wallet) = ${address} and status <> 'failed'`,
        ),
      ])
    if (!person[0]) throw new KovaError('not_found', 'Kova hasn’t seen this wallet.')
    const money = await balances([address])
    const own = new Set((await demoAddresses()).map((a) => a.toLowerCase()))
    const h = holder[0]
    return c.json({
      address: getAddress(address),
      first_seen: iso(person[0].first_seen),
      last_seen: iso(person[0].last_seen),
      balance: money.get(address) ?? null,
      demo: own.has(address),
      check: h
        ? {
            status: String(h.status),
            reason: (h.reason as string | null) ?? null,
            card_problem: cardIssueProblem(String(h.id)),
            name: [h.first_name, h.last_name].filter(Boolean).join(' ') || null,
            email: (h.email as string | null) ?? null,
            phone: (h.phone as string | null) ?? null,
            account: !!h.account_id,
            started: iso(h.created_at),
            updated: iso(h.updated_at),
          }
        : null,
      cards: card.map((r) => ({
        last_four: String(r.last_four),
        brand: (r.brand as string | null) ?? null,
        state: String(r.state),
        created_at: iso(r.created_at),
      })),
      card_topups: { count: num(topups[0]?.n), amount: units(topups[0]?.amount) },
      payouts: payouts.map((r) => ({
        id: String(r.id),
        amount: units(r.amount),
        currency: String(r.currency),
        amount_to: r.amount_to === null ? null : String(r.amount_to),
        status: String(r.status),
        failure: (r.failure as string | null) ?? null,
        created_at: iso(r.created_at),
        paid_at: iso(r.paid_at),
      })),
      naira: naira.map((r) => ({
        id: String(r.id),
        amount: units(r.amount),
        naira: r.naira === null ? null : String(r.naira),
        bank: (r.bank_name as string | null) ?? null,
        account_last4: r.account_number ? String(r.account_number).slice(-4) : null,
        status: String(r.status),
        failure: (r.failure as string | null) ?? null,
        created_at: iso(r.created_at),
        paid_at: iso(r.paid_at),
      })),
      shops: shops.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        slug: String(r.slug),
        status: String(r.status),
        created_at: iso(r.created_at),
      })),
      keys: keys.map((r) => ({
        kind: String(r.kind),
        label: (r.label as string | null) ?? null,
        holder: (r.holder_name as string | null) ?? null,
        status: String(r.status),
        spend_limit: r.spend_limit === null ? null : units(r.spend_limit),
        created_at: iso(r.created_at),
        last_used_at: iso(r.last_used_at),
      })),
      owner_name: (keys.find((k) => k.owner_name)?.owner_name as string | undefined) ?? null,
      phone: phone[0]
        ? { phone: String(phone[0].phone), verified_at: iso(phone[0].verified_at) }
        : null,
      activity: activity.map((r) => ({
        direction: r.to_address === address ? 'in' : 'out',
        other: getAddress(String(r.to_address === address ? r.from_address : r.to_address)),
        amount: units(r.amount),
        tx_hash: String(r.tx_hash),
        at: iso(r.created_at),
      })),
    })
  })
