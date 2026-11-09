import { explorerAddressUrl, getNetwork } from '@kova/monad'
import Link from 'next/link'
import type { Attention, Overview, PersonRow } from '@/lib/admin'
import { network } from '@/lib/network'
import { signOut } from './actions'
import { ago, checkState, naira, short, usd } from './format'

export const addressLink = (address: string) => explorerAddressUrl(getNetwork(network), address)

export function Tone({
  tone,
  children,
}: {
  tone: 'quiet' | 'wait' | 'good' | 'bad'
  children: React.ReactNode
}) {
  return (
    <span className="adm-chip" data-tone={tone}>
      {children}
    </span>
  )
}

/** The bar across the top: where this is, which network, who's signed in. */
export function TopBar({ me, net }: { me: string; net: string }) {
  return (
    <header className="adm-top">
      <Link href="/admin" className="adm-brand">
        <span className="adm-mark" aria-hidden="true">
          K
        </span>
        <span>
          <strong>Kova</strong>
          <small>Dashboard</small>
        </span>
      </Link>
      <span className="adm-net" data-net={net}>
        {net === 'mainnet' ? 'Monad mainnet' : 'Monad testnet'}
      </span>
      <span className="adm-top-gap" />
      <span className="adm-me" title={me}>
        Signed in as <code>{short(me)}</code>
      </span>
      <form action={signOut}>
        <button type="submit" className="adm-ghost">
          Sign out
        </button>
      </form>
    </header>
  )
}

function Kpi({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: string
  note?: string
  tone?: 'teal' | 'coral'
}) {
  return (
    <div className="adm-kpi" data-tone={tone}>
      <span className="adm-kpi-label">{label}</span>
      <strong className="adm-kpi-value">{value}</strong>
      {note ? <span className="adm-kpi-note">{note}</span> : null}
    </div>
  )
}

export function Kpis({ o }: { o: Overview }) {
  const cashOuts = o.money.naira.count + o.money.abroad.count
  const cashed = (BigInt(o.money.naira.amount) + BigInt(o.money.abroad.amount)).toString()
  return (
    <section className="adm-kpis" aria-label="Totals">
      <Kpi
        label="People"
        value={o.people.total.toLocaleString('en-US')}
        note={`${o.people.today} new today`}
      />
      <Kpi
        label="New in 7 days"
        value={o.people.week.toLocaleString('en-US')}
        note={`${o.people.month} in 30 days`}
      />
      <Kpi
        label="Moved money in 7 days"
        value={o.people.active_week.toLocaleString('en-US')}
        note="wallets with a transfer in or out"
      />
      <Kpi
        label="Held in Kova wallets"
        value={o.held ? usd(o.held.total, false) : '—'}
        note={o.held ? `across ${o.held.wallets.toLocaleString('en-US')} wallets` : 'couldn’t read'}
        tone="teal"
      />
      <Kpi
        label="Cashed out"
        value={usd(cashed, false)}
        note={`${cashOuts} cash-outs · ${naira(o.money.naira.kobo)} to banks`}
      />
      <Kpi
        label="Needs a look"
        value={String(o.attention.length)}
        note={o.attention.length ? 'see the list' : 'nothing stuck'}
        tone={o.attention.length ? 'coral' : undefined}
      />
    </section>
  )
}

/** New people a day for 30 days, as bars on one fixed scale. */
export function Signups({ daily }: { daily: Overview['people']['daily'] }) {
  const max = Math.max(1, ...daily.map((d) => d.n))
  const W = 600
  const H = 140
  const gap = 4
  const bar = (W - gap * (daily.length - 1)) / daily.length
  const total = daily.reduce((s, d) => s + d.n, 0)
  const label = (day: string) =>
    new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return (
    <section className="adm-card">
      <div className="adm-card-head">
        <h2>New people</h2>
        <span className="adm-muted">{total} in 30 days</span>
      </div>
      <svg
        className="adm-bars"
        viewBox={`0 0 ${W} ${H + 22}`}
        role="img"
        aria-label={`New people a day for 30 days, most on one day: ${max}`}
      >
        <line x1="0" x2={W} y1={H} y2={H} className="adm-axis" />
        {daily.map((d, i) => {
          const h = d.n ? Math.max(3, (d.n / max) * (H - 8)) : 0
          const x = i * (bar + gap)
          return (
            <g key={d.day}>
              <title>{`${label(d.day)}: ${d.n} new`}</title>
              <rect x={x} y={0} width={bar} height={H} className="adm-hit" />
              {h ? (
                <rect
                  x={x}
                  y={H - h}
                  width={bar}
                  height={h}
                  rx={3}
                  className={i === daily.length - 1 ? 'adm-bar adm-bar-now' : 'adm-bar'}
                />
              ) : null}
            </g>
          )
        })}
        <text x="0" y={H + 17} className="adm-tick">
          {label(daily[0]?.day ?? '')}
        </text>
        <text x={W} y={H + 17} textAnchor="end" className="adm-tick">
          Today
        </text>
        <text x={W} y="12" textAnchor="end" className="adm-tick">
          {max} a day at most
        </text>
      </svg>
    </section>
  )
}

/** The ID check and card, as a row of counts from not sent to card made. */
export function CardFunnel({ o }: { o: Overview }) {
  const steps = [
    { label: 'Not sent', n: o.card.not_sent, tone: 'quiet' as const },
    { label: 'Reviewing', n: o.card.reviewing, tone: 'wait' as const },
    { label: 'Approved', n: o.card.approved, tone: 'good' as const },
    { label: 'Cards made', n: o.card.cards, tone: 'good' as const },
    { label: 'Failed', n: o.card.failed, tone: 'bad' as const },
  ]
  return (
    <section className="adm-card">
      <div className="adm-card-head">
        <h2>ID check and dollar card</h2>
        <span className="adm-muted">
          {o.money.card_topups.count} top-ups · {usd(o.money.card_topups.amount, false)}
        </span>
      </div>
      <ol className="adm-funnel">
        {steps.map((s) => (
          <li key={s.label} data-tone={s.tone}>
            <strong>{s.n}</strong>
            <span>{s.label}</span>
          </li>
        ))}
      </ol>
      <dl className="adm-facts">
        <div>
          <dt>Payments, 30 days</dt>
          <dd>
            {o.money.payments_30d.count} · {usd(o.money.payments_30d.amount, false)}
          </dd>
        </div>
        <div>
          <dt>Naira cash-outs</dt>
          <dd>
            {o.money.naira.count} · {usd(o.money.naira.amount, false)}
          </dd>
        </div>
        <div>
          <dt>Cash-outs abroad</dt>
          <dd>
            {o.money.abroad.count} · {usd(o.money.abroad.amount, false)}
          </dd>
        </div>
        <div>
          <dt>Shops · spending keys</dt>
          <dd>
            {o.money.shops} · {o.money.keys}
          </dd>
        </div>
      </dl>
    </section>
  )
}

const KIND: Record<Attention['kind'], string> = {
  card: 'Card',
  check: 'ID check',
  payout: 'Abroad',
  naira: 'Naira',
}

/** Who's stuck, newest first: each row opens the person. */
export function NeedsALook({ items }: { items: Attention[] }) {
  return (
    <section className="adm-card adm-attention">
      <div className="adm-card-head">
        <h2>Needs a look</h2>
        <span className="adm-muted">{items.length ? `${items.length} open` : 'All clear'}</span>
      </div>
      {items.length ? (
        <ul className="adm-alerts">
          {items.slice(0, 30).map((a) => (
            <li key={`${a.kind}-${a.wallet}-${a.since}`}>
              <Link href={`/admin/people/${a.wallet}`} className="adm-alert">
                <span className="adm-alert-kind" data-kind={a.kind}>
                  {KIND[a.kind]}
                </span>
                <span className="adm-alert-text">
                  <strong>{a.title}</strong>
                  {a.detail ? <span>{a.detail}</span> : null}
                </span>
                <span className="adm-alert-side">
                  <code>{short(a.wallet)}</code>
                  <small>{ago(a.since)}</small>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="adm-empty">Nothing stuck: no cards waiting, no cash-outs held.</p>
      )}
    </section>
  )
}

/** Everyone, newest first, with search and pages. */
export function PeopleTable({
  rows,
  q,
  page,
  pages,
  total,
}: {
  rows: PersonRow[]
  q: string
  page: number
  pages: number
  total: number
}) {
  const href = (p: number) =>
    `/admin?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}#people`
  return (
    <section className="adm-card adm-people" id="people">
      <div className="adm-card-head">
        <h2>People</h2>
        <form className="adm-search" action="/admin#people" method="get">
          <label htmlFor="adm-q" className="adm-sr">
            Search people
          </label>
          <input
            id="adm-q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Wallet, name, email or shop"
            autoComplete="off"
          />
          <button type="submit" className="adm-ghost">
            Search
          </button>
        </form>
      </div>
      <p className="adm-muted adm-count">
        {q ? `${total} found for “${q}”` : `${total.toLocaleString('en-US')} people, newest first`}.
        Kova keeps names only where people gave one: the card’s ID check, a shop or a spending key.
      </p>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Wallet</th>
              <th scope="col">Joined</th>
              <th scope="col">Last seen</th>
              <th scope="col" className="adm-num">
                Balance
              </th>
              <th scope="col">ID check</th>
              <th scope="col">Card</th>
              <th scope="col" className="adm-num">
                Cash-outs
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const check = checkState(r.check)
              return (
                <tr key={r.address}>
                  <td>
                    <Link href={`/admin/people/${r.address}`} className="adm-person">
                      <strong>{r.name ?? r.shop ?? 'No name'}</strong>
                      <span>
                        {[r.email, r.name && r.shop ? r.shop : null, r.demo ? 'Kova demo' : null]
                          .filter(Boolean)
                          .join(' · ') || ' '}
                      </span>
                    </Link>
                  </td>
                  <td>
                    <code>{short(r.address)}</code>
                  </td>
                  <td>{ago(r.first_seen)}</td>
                  <td>{ago(r.last_seen)}</td>
                  <td className="adm-num">{usd(r.balance)}</td>
                  <td>
                    {r.check ? (
                      <Tone tone={check.tone}>{check.label}</Tone>
                    ) : (
                      <span className="adm-dim">—</span>
                    )}
                  </td>
                  <td>
                    {r.card ? <Tone tone="good">Made</Tone> : <span className="adm-dim">—</span>}
                  </td>
                  <td className="adm-num">{r.cash_outs || <span className="adm-dim">0</span>}</td>
                </tr>
              )
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="adm-empty">
                  {q ? 'Nobody matches that.' : 'Nobody yet.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <nav className="adm-pager" aria-label="Pages">
          {page > 1 ? (
            <Link href={href(page - 1)} className="adm-ghost">
              Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="adm-muted">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={href(page + 1)} className="adm-ghost">
              Older
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </section>
  )
}

/** Not signed in: where to open it from. */
export function Gate({ ready }: { ready: boolean }) {
  return (
    <main className="adm-gate">
      <span className="adm-mark adm-mark-big" aria-hidden="true">
        K
      </span>
      <h1>Kova’s dashboard</h1>
      {ready ? (
        <>
          <p>
            For Kova’s team. Open it from your wallet: it signs once, and this browser stays in for
            12 hours.
          </p>
          <Link href="/wallet/admin" className="adm-solid">
            Open from my wallet
          </Link>
        </>
      ) : (
        <p>
          Not set up on this server yet. It needs KOVA_ADMIN_WALLETS and KOVA_ADMIN_SECRET in the
          web service, and the same KOVA_ADMIN_SECRET in the API.
        </p>
      )}
    </main>
  )
}

export function Failed({ message }: { message: string }) {
  return (
    <section className="adm-card adm-failed" role="alert">
      <h2>The dashboard couldn’t load</h2>
      <p>{message}</p>
    </section>
  )
}

export { addressLink as explorer }
