import type { Metadata } from 'next'
import Link from 'next/link'
import { Art, Brand, Icon, type IconName, Pill } from '@/components/brand'
import { LiveUpdated } from '@/components/stats-view'
import {
  type Day,
  dollars,
  type Network,
  type NetworkStats,
  naira,
  PUBLIC_API,
  readStats,
  sourceName,
  together,
  whole,
} from '@/lib/growth'
import { apiUrl, publicApiUrl, network as siteNetwork } from '@/lib/network'
import '@/styles/growth.css'

/** The API holds its numbers a minute; so does this page. */
export const revalidate = 60

export const metadata: Metadata = {
  title: { absolute: 'Kova, live' },
  description:
    'How many people use Kova on Monad, the money they’ve moved and what they’ve cashed out to naira: counted on each network, money read off the chain, updated every minute. Totals only.',
}

const NETWORKS: Network[] = ['mainnet', 'testnet']

async function statsFrom(base: string): Promise<NetworkStats | null> {
  try {
    const response = await fetch(`${base.replace(/\/+$/, '')}/v1/public/stats`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(5000),
    })
    return response.ok ? readStats(await response.json()) : null
  } catch {
    return null
  }
}

/**
 * One network's numbers. This site's own network asks its own API first (the address it already
 * uses), the other asks that network's public API; whichever answers must say it is that network,
 * so the same database is never counted twice.
 */
async function statsFor(network: Network): Promise<NetworkStats | null> {
  const here: Network = siteNetwork
  const own = network === here ? [apiUrl, publicApiUrl] : []
  const bases = [...new Set([...own, PUBLIC_API[network]].filter((b): b is string => Boolean(b)))]
  for (const base of bases) {
    const stats = await statsFrom(base)
    if (stats?.network === network) return stats
  }
  return null
}

/** The last 14 UTC dates, for a chart frame before any numbers have come in. */
function lastDays(): Day[] {
  return Array.from({ length: 14 }, (_, i) => ({
    date: new Date(Date.now() - (13 - i) * 86_400_000).toISOString().slice(0, 10),
    people: 0,
    payments: 0,
    cash_outs: 0,
    moved: 0,
  }))
}

const dayName = (date: string, style: 'short' | 'long' = 'short') =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: style === 'long' ? 'long' : 'short',
    day: 'numeric',
  })

export default async function StatsPage() {
  const [mainnet, testnet] = await Promise.all([statsFor('mainnet'), statsFor('testnet')])
  const nets: Record<Network, NetworkStats | null> = { mainnet, testnet }
  const parts = NETWORKS.flatMap((n) => (nets[n] ? [nets[n]] : []))
  const all = together(parts)
  const known = parts.length > 0
  const sources = all.sources.filter((s) => s.visits > 0 || s.wallets > 0).slice(0, 6)

  return (
    <main className="gr-page gr-stats">
      <header className="gr-top">
        <Brand />
        <Pill href="/try?ref=stats" icon="arrow" tone="coral" className="gr-top-pill">
          Try Kova
        </Pill>
      </header>

      <div className="gr-st-grid">
        <section className="gr-st-intro">
          <p className="gr-eyebrow">On Monad, mainnet and testnet</p>
          <h1 className="gr-title">Kova, live</h1>
          <p className="gr-lead">
            Everyone using Kova, the money they’ve moved and what they’ve cashed out to naira. Money
            is mainnet’s, read off the chain; testnet’s is test dollars and says so.
          </p>
        </section>

        <section className="gr-people" aria-labelledby="gr-people-label">
          <svg
            className="gr-people-rings"
            width="260"
            height="260"
            viewBox="-130 -130 260 260"
            aria-hidden="true"
          >
            {[124, 96, 68, 40].map((r) => (
              <circle key={r} r={r} fill="none" stroke="var(--teal-deep)" strokeWidth="2" />
            ))}
          </svg>
          <Art name="kovi-cheer" size={84} className="gr-people-kovi" />
          <p className="gr-people-label" id="gr-people-label">
            People using Kova
          </p>
          <p className="gr-people-number" style={sizeFor(known ? whole(all.people) : '—')}>
            {known ? <Rolling value={whole(all.people)} /> : <span className="gr-dash">—</span>}
          </p>
          <p className="gr-people-week">
            {known ? (
              <span className="gr-chip-week">+{whole(all.people_7d)} this week</span>
            ) : (
              <span className="gr-chip-week">Numbers will appear here</span>
            )}
          </p>
          <NewPeople days={known ? all.daily : lastDays()} known={known} />
          <ul className="gr-split" aria-label="By network">
            {NETWORKS.map((n) => {
              const s = nets[n]
              return (
                <li key={n} data-net={n} data-missing={s ? undefined : 'true'}>
                  <span className="gr-split-name">
                    <span className="gr-net-dot" aria-hidden="true" />
                    {n === 'mainnet' ? 'Mainnet' : 'Testnet'}
                  </span>
                  {s ? (
                    <strong>{whole(s.people)}</strong>
                  ) : (
                    <span className="gr-split-later">Numbers will appear here</span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        <div className="gr-st-fresh">
          <LiveUpdated at={all.updated_at} />
        </div>

        <section className="gr-cards" aria-label="What people do with Kova">
          {/* Money leads with mainnet's: testnet's is test dollars, given on the line below. */}
          <Stat
            icon="tap"
            tone="coral"
            label="Transactions"
            value={mainnet ? whole(mainnet.moved) : null}
            extra="Sends, payments, deposits"
            split={split(nets, (s) => whole(s.moved), {
              mainnet: 'on mainnet',
              testnet: 'on testnet',
            })}
          />
          <Stat
            icon="bolt"
            tone="teal"
            label="Money moved"
            value={mainnet ? dollars(Number(mainnet.moved_volume)) : null}
            extra="In and out of wallets"
            split={split(nets, (s) => dollars(Number(s.moved_volume)), {
              mainnet: 'on mainnet',
              testnet: 'test dollars',
            })}
          />
          <Stat
            icon="stall"
            tone="teal"
            label="Shops open"
            value={known ? whole(all.shops) : null}
            split={split(nets, (s) => whole(s.shops))}
          />
          <Stat
            icon="link"
            tone="coral"
            label="Links sent"
            value={known ? whole(all.links) : null}
            extra={known ? `${whole(all.links_claimed)} claimed` : undefined}
            split={split(nets, (s) => whole(s.links))}
          />
          {/* Cash-outs lead with mainnet's: testnet's go through Paystack's test mode, no naira. */}
          <Stat
            icon="out"
            tone="coral"
            label="Cashed out"
            value={mainnet ? dollars(Number(mainnet.cash_out_volume)) : null}
            extra={mainnet ? `${whole(mainnet.cash_outs)} to Nigerian banks` : undefined}
            split={split(nets, (s) => dollars(Number(s.cash_out_volume)), {
              mainnet: 'on mainnet',
              testnet: 'test dollars',
            })}
          />
          <Stat
            icon="down"
            tone="teal"
            label="Naira paid out"
            value={mainnet ? naira(Number(mainnet.cash_out_naira)) : null}
            split={split(nets, (s) => naira(Number(s.cash_out_naira)), {
              mainnet: 'to banks',
              testnet: 'test',
            })}
          />
        </section>

        <section className="gr-charts" aria-label="The last 14 days">
          <Bars
            title="Transactions on mainnet"
            unit={['transaction', 'transactions']}
            days={mainnet ? mainnet.daily : lastDays()}
            pick="moved"
            known={Boolean(mainnet)}
          />
          <Bars
            title="Cash-outs to naira"
            unit={['cash-out', 'cash-outs']}
            days={mainnet ? mainnet.daily : lastDays()}
            pick="cash_outs"
            known={Boolean(mainnet)}
          />
        </section>

        <section className="gr-sources" aria-labelledby="gr-sources-title">
          <h2 className="gr-h2" id="gr-sources-title">
            Where new people come from
          </h2>
          <p className="gr-sub">
            The links people follow to try Kova: who opened one, and who went on to make a wallet.
          </p>
          {sources.length ? (
            <table className="gr-src">
              <thead>
                <tr>
                  <th scope="col">From</th>
                  <th scope="col">Visits</th>
                  <th scope="col">Wallets</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => {
                  const name = sourceName(s.ref)
                  return (
                    <tr key={s.ref}>
                      <th scope="row">
                        <span className="gr-src-name">{name}</span>
                        <span className="gr-src-ref">
                          {s.ref === 'direct' ? 'no link label' : `ref=${s.ref}`}
                        </span>
                      </th>
                      <td>{whole(s.visits)}</td>
                      <td>
                        <strong>{whole(s.wallets)}</strong>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <p className="gr-src-empty">
              {known
                ? 'Nobody has followed a labelled link yet. Every post can carry one: /try?ref=your-name.'
                : 'Numbers will appear here.'}
            </p>
          )}
        </section>

        <aside className="gr-honest" aria-label="About these numbers">
          <Icon name="info" size={20} />
          <p>
            Counts include our own testing. Every number comes from Kova’s database on each network;
            nothing here identifies a person. Someone on both networks counts once on each, and
            testnet’s money is test dollars.
          </p>
        </aside>

        <section className="gr-cta" aria-labelledby="gr-cta-title">
          <Art name="kovi-peek" size={180} className="gr-cta-peek" />
          <h2 className="gr-cta-title" id="gr-cta-title">
            Try Kova in a minute
          </h2>
          <p>
            Make a wallet with Face ID, buy a croissant with free test dollars and send a friend $1
            by link. Each payment settles in about a second.
          </p>
          <Pill href="/try?ref=stats" icon="arrow" tone="coral">
            Try Kova in a minute
          </Pill>
        </section>
      </div>

      <footer className="gr-foot">
        <Brand />
        <nav aria-label="More">
          <Link href="/">About Kova</Link>
          <Link href="/wallet">Open my wallet</Link>
          <Link href="/try?ref=stats">Try Kova</Link>
        </nav>
      </footer>
    </main>
  )
}

/** How many characters a big number has, so its card can size it to fit (growth.css). */
const sizeFor = (text: string) => ({ '--chars': Math.max(text.length, 3) }) as React.CSSProperties

/**
 * A number on reels, like a till's: each digit rolls up into place when the page lands, and to its
 * new value when the numbers move. Server-drawn, so the real number is there before any script.
 */
function Rolling({ value }: { value: string }) {
  const chars = value.split('')
  return (
    <span className="gr-roll" role="img" aria-label={value}>
      {chars.map((ch, i) => {
        // Keyed from the right, so the units stay the units when the number grows a digit.
        const key = chars.length - i
        return /\d/.test(ch) ? (
          <span key={key} className="gr-roll-digit" aria-hidden="true">
            <span
              className="gr-roll-reel"
              style={{
                transform: `translateY(${-Number(ch) * 10}%)`,
                animationDelay: `${i * 45}ms`,
              }}
            >
              {'0123456789'.split('').map((d) => (
                <span key={d}>{d}</span>
              ))}
            </span>
          </span>
        ) : (
          <span key={`s${key}`} className="gr-roll-sep" aria-hidden="true">
            {ch}
          </span>
        )
      })}
    </span>
  )
}

/**
 * New people over the last 14 days, drawn small on the people card itself: the card's own story,
 * where it had only empty teal before. Today's bar is the solid one.
 */
function NewPeople({ days, known }: { days: Day[]; known: boolean }) {
  const values = days.map((d) => d.people)
  const max = Math.max(0, ...values)
  const total = values.reduce((sum, v) => sum + v, 0)
  return (
    <div className="gr-people-days">
      <p className="gr-people-days-head">
        <span>New people, last 14 days</span>
        <strong>{known ? whole(total) : '—'}</strong>
      </p>
      <ol className="gr-people-bars" aria-label="New people each day, the last 14 days">
        {days.map((d, i) => {
          const today = i === days.length - 1
          const height = max > 0 && d.people > 0 ? Math.max((d.people / max) * 100, 8) : 0
          return (
            <li
              key={d.date}
              aria-label={`${today ? 'Today' : dayName(d.date, 'long')}: ${whole(d.people)}`}
            >
              <span
                className={height > 0 ? 'gr-people-bar' : 'gr-people-bar-none'}
                data-today={today ? 'true' : undefined}
                style={
                  height > 0 ? { height: `${height}%`, animationDelay: `${i * 35}ms` } : undefined
                }
              />
            </li>
          )
        })}
      </ol>
    </div>
  )
}

interface SplitRow {
  net: Network
  value: string | null
  suffix: string
}

/** A card's number on each network, in the same order as the people card: mainnet, then testnet. */
function split(
  nets: Record<Network, NetworkStats | null>,
  pick: (s: NetworkStats) => string,
  suffix: Record<Network, string> = { mainnet: 'mainnet', testnet: 'testnet' },
): SplitRow[] {
  return NETWORKS.map((net) => {
    const s = nets[net]
    return { net, value: s ? pick(s) : null, suffix: suffix[net] }
  })
}

function Stat({
  icon,
  tone,
  label,
  value,
  extra,
  split,
}: {
  icon: IconName
  tone: 'coral' | 'teal'
  label: string
  value: string | null
  extra?: string
  split: SplitRow[]
}) {
  return (
    <article className="gr-stat" data-tone={tone}>
      <div className="gr-stat-head">
        <span className="gr-stat-icon" aria-hidden="true">
          <Icon name={icon} size={17} />
        </span>
        <h2 className="gr-stat-label">{label}</h2>
      </div>
      <p className="gr-stat-value" style={sizeFor(value ?? '—')}>
        {value ? <Rolling value={value} /> : <span className="gr-dash">—</span>}
      </p>
      {extra ? <p className="gr-stat-extra">{extra}</p> : null}
      <ul className="gr-stat-split" aria-label={`${label} on each network`}>
        {split.map((s) => (
          <li key={s.net} data-net={s.net} data-missing={s.value === null ? 'true' : undefined}>
            <span className="gr-net-dot" aria-hidden="true" />
            {s.value === null ? (
              <span>{s.net === 'mainnet' ? 'Mainnet' : 'Testnet'}: soon</span>
            ) : (
              <span>
                <strong>{s.value}</strong> {s.suffix}
              </span>
            )}
          </li>
        ))}
      </ul>
    </article>
  )
}

/**
 * Fourteen days as bars, one series each, today at the right in its strong colour. A day with
 * nothing draws a small dashed stub, so a quiet day reads as quiet rather than missing.
 */
function Bars({
  title,
  unit,
  days,
  pick,
  known,
}: {
  title: string
  unit: [string, string]
  days: Day[]
  pick: 'people' | 'payments' | 'cash_outs' | 'moved'
  known: boolean
}) {
  const values = days.map((d) => d[pick])
  const max = Math.max(0, ...values)
  const total = values.reduce((sum, v) => sum + v, 0)
  const peak = max > 0 ? values.lastIndexOf(max) : -1
  const first = days[0]
  return (
    <section className="gr-chart" data-series={pick} aria-label={`${title}, the last 14 days`}>
      <div className="gr-chart-head">
        <h2 className="gr-chart-title">{title}</h2>
        <p className="gr-chart-total">
          {!known
            ? 'Numbers will appear here'
            : total
              ? `${whole(total)} in 14 days`
              : 'None in the last 14 days'}
        </p>
      </div>
      <ol className="gr-bars" data-empty={max === 0 ? 'true' : undefined}>
        {days.map((d, i) => {
          const v = d[pick]
          const height = max > 0 && v > 0 ? Math.max((v / max) * 100, 9) : 0
          const today = i === days.length - 1
          const label = `${today ? 'Today' : dayName(d.date, 'long')}: ${whole(v)} ${v === 1 ? unit[0] : unit[1]}`
          return (
            <li
              key={d.date}
              className="gr-bar"
              data-today={today ? 'true' : undefined}
              tabIndex={known ? 0 : -1}
              aria-label={known ? label : undefined}
            >
              {known ? (
                <span className="gr-tip" aria-hidden="true">
                  <strong>{whole(v)}</strong>
                  {today ? 'Today' : dayName(d.date)}
                </span>
              ) : null}
              <span className="gr-col">
                {i === peak ? <span className="gr-peak">{whole(v)}</span> : null}
                {height > 0 ? (
                  <span
                    className="gr-fill"
                    style={{ height: `${height}%`, animationDelay: `${i * 35}ms` }}
                  />
                ) : (
                  <span className="gr-stub" />
                )}
              </span>
            </li>
          )
        })}
      </ol>
      <div className="gr-axis" aria-hidden="true">
        <span>{first ? dayName(first.date) : ''}</span>
        <span>Today</span>
      </div>
    </section>
  )
}
