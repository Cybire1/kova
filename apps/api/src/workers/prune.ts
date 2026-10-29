import { sql } from 'drizzle-orm'
import { feePayerAddress } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { cardContract } from '../services/cards.js'

/**
 * Keeps the transfer index from filling the database. The watcher indexes every AUSD and USDC
 * transfer on Monad, so any wallet can ask what arrived; on mainnet that's everyone's traffic,
 * and on 29 Oct 2026 it filled the 5 GB disk. Every transfer that touches Kova stays: a wallet
 * that published its note key (every Kova wallet does as it opens), a shop, a card, a pocket, a
 * link, a private payment, a cash-out, Kova's relayer or contracts. A transfer between two
 * strangers stays for KOVA_TRANSFER_DAYS (7), long enough for any wallet to catch up, then goes:
 * at about 280,000 a day on mainnet (Oct 2026), a week is about 1.4 GB.
 *
 * Off until KOVA_PRUNE_TRANSFERS=1: `pnpm --filter @kova/api prune:transfers` says first how many
 * rows it would remove.
 */

/** Every address that is Kova's or a Kova customer's, lowercased, from the tables that name them. */
const kovaAddresses = (fixed: string[]) => sql`
  select lower(a) as a from (
    select unnest(array[${sql.join(
      fixed.map((a) => sql`${a}`),
      sql`, `,
    )}]::text[]) as a
    union all select settlement_address from merchants
    union all select owner_address from merchants
    union all select payer_address from payments
    union all select address from note_keys
    union all select address from wallet_stealth_keys
    union all select stealth_address from stealth_announcements
    union all select from_address from stealth_announcements
    union all select stealth_address from stealth_payments
    union all select from_address from payment_notes
    union all select to_address from payment_notes
    union all select link_address from payment_links
    union all select sender_address from payment_links
    union all select wallet from phone_accounts
    union all select owner_address from ussd_pockets
    union all select pocket_address from ussd_pockets
    union all select address from kova_cards
    union all select holder_address from kova_cards
    union all select wallet_address from cash_outs
    union all select partner_address from cash_outs
    union all select wallet_address from naira_top_ups
    union all select wallet from savings_moves
    union all select wallet_address from payroll_people
    union all select stealth_address from payroll_payments
    union all select wallet_address from suppliers
    union all select owner_address from wallet_keys
    union all select key_address from wallet_keys
    union all select holder_address from wallet_keys
    union all select address from test_dollar_claims
    union all select payer_address from orders
  ) known
  where a is not null`

function fixedAddresses(): string[] {
  return [
    feePayerAddress,
    cardContract,
    config.KOVA_CASH_OUT,
    config.KOVA_SAVER,
    config.KOVA_SAVINGS_VAULT,
  ].flatMap((a) =>
    typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a) ? [a.toLowerCase()] : [],
  )
}

/** Transfers between strangers older than this many days go. */
export const keptDays = () => config.KOVA_TRANSFER_DAYS

const strangers = (days: number) => sql`
  t.network = ${config.KOVA_NETWORK}
  and t.created_at < now() - make_interval(days => ${days})
  and t.from_address not in (select a from kova)
  and t.to_address not in (select a from kova)`

/** How many rows a prune would remove, and how many it keeps. */
export async function pruneReport(days = keptDays()) {
  const [row] = (await db.execute(sql`
    with kova as materialized (${kovaAddresses(fixedAddresses())})
    select
      count(*) filter (where ${strangers(days)}) as old_strangers,
      count(*) as total,
      pg_size_pretty(pg_total_relation_size('transfers')) as size
    from transfers t
    where t.network = ${config.KOVA_NETWORK}`)) as unknown as {
    old_strangers: string
    total: string
    size: string
  }[]
  return {
    remove: Number(row?.old_strangers ?? 0),
    total: Number(row?.total ?? 0),
    size: row?.size ?? 'unknown',
  }
}

/** Removes old transfers between strangers, a batch at a time so the table never locks for long. */
export async function pruneTransfers(days = keptDays(), batch = 20_000): Promise<number> {
  let removed = 0
  for (;;) {
    const gone = (await db.execute(sql`
      with kova as materialized (${kovaAddresses(fixedAddresses())}),
      doomed as (select t.id from transfers t where ${strangers(days)} limit ${batch})
      delete from transfers where id in (select id from doomed)
      returning 1`)) as unknown as unknown[]
    removed += gone.length
    if (gone.length < batch) return removed
  }
}

/** Once a day, and once ten minutes after starting. */
export function startPruner(): void {
  if (config.KOVA_PRUNE_TRANSFERS !== '1') return
  const run = () =>
    void pruneTransfers()
      .then((n) => n > 0 && console.log(`[prune] removed ${n} old transfers between strangers`))
      .catch((error) => console.error('[prune] will retry tomorrow', error))
  setTimeout(run, 10 * 60_000)
  setInterval(run, 24 * 60 * 60_000)
}
