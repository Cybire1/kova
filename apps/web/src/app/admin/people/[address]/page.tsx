import { explorerAddressUrl, explorerTxUrl, getNetwork } from '@kova/monad'
import type { Metadata } from 'next'
import Link from 'next/link'
import { admin, adminWallet, dashboardReady, type Person } from '@/lib/admin'
import { ApiError } from '@/lib/api'
import { network } from '@/lib/network'
import { ago, checkState, moneyState, naira, short, usd, when } from '../../format'
import { Failed, Gate, Tone, TopBar } from '../../parts'

export const metadata: Metadata = { title: 'Person' }

const chain = getNetwork(network)

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/** One person on Kova: their ID check and card, cash-outs, shops, keys and recent dollars. */
export default async function PersonPage({ params }: { params: Promise<{ address: string }> }) {
  const me = await adminWallet()
  if (!me) return <Gate ready={dashboardReady()} />
  const { address } = await params
  let p: Person | null = null
  let problem: string | null = null
  try {
    p = await admin<Person>(`/people/${encodeURIComponent(address)}`)
  } catch (error) {
    problem =
      error instanceof ApiError && error.status === 404
        ? 'Kova hasn’t seen this wallet.'
        : error instanceof Error
          ? error.message
          : 'Kova didn’t answer.'
  }

  return (
    <>
      <TopBar me={me} net={network} />
      <main className="adm-main">
        <Link href="/admin#people" className="adm-back">
          ← Everyone
        </Link>
        {!p ? (
          <Failed message={problem ?? 'Kova didn’t answer.'} />
        ) : (
          <>
            <div className="adm-person-head">
              <div>
                <h1>{p.check?.name ?? p.owner_name ?? p.shops[0]?.name ?? 'No name'}</h1>
                <p className="adm-addr">
                  <code>{p.address}</code>
                  <a href={explorerAddressUrl(chain, p.address)} target="_blank" rel="noreferrer">
                    Explorer ↗
                  </a>
                </p>
                {p.demo ? <Tone tone="wait">Kova’s demo wallet</Tone> : null}
              </div>
              <div className="adm-balance">
                <span>Balance</span>
                <strong className="adm-balance-value">{usd(p.balance)}</strong>
                <small>
                  Joined {when(p.first_seen)} · last seen {ago(p.last_seen)}
                </small>
              </div>
            </div>

            <div className="adm-grid">
              <section className="adm-card">
                <div className="adm-card-head">
                  <h2>ID check and card</h2>
                  {p.check ? (
                    <Tone tone={checkState(p.check.status).tone}>
                      {checkState(p.check.status).label}
                    </Tone>
                  ) : null}
                </div>
                {p.check ? (
                  <>
                    {p.check.card_problem || p.check.reason ? (
                      <p className="adm-warn">{p.check.card_problem ?? p.check.reason}</p>
                    ) : null}
                    <dl className="adm-dl">
                      <Row label="Name">{p.check.name ?? '—'}</Row>
                      <Row label="Email">{p.check.email ?? '—'}</Row>
                      <Row label="Phone">{p.check.phone ?? '—'}</Row>
                      <Row label="Own account at Nuvion">
                        {p.check.account ? 'Open' : 'Not yet'}
                      </Row>
                      <Row label="Started">{when(p.check.started)}</Row>
                      <Row label="Last change">{when(p.check.updated)}</Row>
                      <Row label="Card">
                        {p.cards.length
                          ? p.cards.map((c) => `•••• ${c.last_four} (${c.state})`).join(', ')
                          : p.check.status === 'approved'
                            ? 'Not made yet'
                            : '—'}
                      </Row>
                      <Row label="Top-ups">
                        {p.card_topups.count} · {usd(p.card_topups.amount)}
                      </Row>
                    </dl>
                  </>
                ) : (
                  <p className="adm-empty">Hasn’t started the ID check.</p>
                )}
              </section>

              <section className="adm-card">
                <div className="adm-card-head">
                  <h2>Shops, keys and phone</h2>
                </div>
                <dl className="adm-dl">
                  <Row label="Shops">
                    {p.shops.length
                      ? p.shops.map((s) => (
                          <span key={s.id} className="adm-line">
                            {s.name}{' '}
                            <span className="adm-dim">
                              /{s.slug} · {s.status}
                            </span>
                          </span>
                        ))
                      : '—'}
                  </Row>
                  <Row label="Spending keys">
                    {p.keys.length
                      ? p.keys.map((k) => (
                          <span key={`${k.kind}-${k.created_at}`} className="adm-line">
                            {k.label ?? k.kind}
                            {k.holder ? ` · ${k.holder}` : ''}{' '}
                            <span className="adm-dim">
                              {k.spend_limit ? `${usd(k.spend_limit, false)} limit · ` : ''}
                              {k.status}
                            </span>
                          </span>
                        ))
                      : '—'}
                  </Row>
                  <Row label="Phone (USSD)">
                    {p.phone
                      ? `${p.phone.phone}${p.phone.verified_at ? ' · verified' : ' · not verified'}`
                      : '—'}
                  </Row>
                </dl>
              </section>
            </div>

            <section className="adm-card">
              <div className="adm-card-head">
                <h2>Cash-outs</h2>
                <span className="adm-muted">
                  {p.naira.length} to naira · {p.payouts.length} abroad
                </span>
              </div>
              {p.naira.length + p.payouts.length ? (
                <div className="adm-table-wrap">
                  <table className="adm-table">
                    <thead>
                      <tr>
                        <th scope="col">When</th>
                        <th scope="col">Where</th>
                        <th scope="col" className="adm-num">
                          Sent
                        </th>
                        <th scope="col" className="adm-num">
                          They got
                        </th>
                        <th scope="col">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ...p.naira.map((n) => ({
                          id: n.id,
                          at: n.created_at,
                          where: `${n.bank ?? 'Nigerian bank'}${n.account_last4 ? ` ••${n.account_last4}` : ''}`,
                          sent: usd(n.amount),
                          got: naira(n.naira),
                          status: n.status,
                          failure: n.failure,
                        })),
                        ...p.payouts.map((o) => ({
                          id: o.id,
                          at: o.created_at,
                          where: `Abroad, in ${o.currency}`,
                          sent: usd(o.amount),
                          got: o.amount_to
                            ? `${(Number(o.amount_to) / 100).toLocaleString('en-US')} ${o.currency}`
                            : '—',
                          status: o.status,
                          failure: o.failure,
                        })),
                      ]
                        .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
                        .map((r) => {
                          const s = moneyState(r.status)
                          return (
                            <tr key={r.id}>
                              <td>{when(r.at)}</td>
                              <td>{r.where}</td>
                              <td className="adm-num">{r.sent}</td>
                              <td className="adm-num">{r.got}</td>
                              <td>
                                <Tone tone={s.tone}>{s.label}</Tone>
                                {r.failure ? <span className="adm-fail">{r.failure}</span> : null}
                              </td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="adm-empty">No cash-outs yet.</p>
              )}
            </section>

            <section className="adm-card">
              <div className="adm-card-head">
                <h2>Recent dollars</h2>
                <span className="adm-muted">Transfers on Monad, newest first</span>
              </div>
              {p.activity.length ? (
                <div className="adm-table-wrap">
                  <table className="adm-table">
                    <thead>
                      <tr>
                        <th scope="col">When</th>
                        <th scope="col">Direction</th>
                        <th scope="col">With</th>
                        <th scope="col" className="adm-num">
                          Amount
                        </th>
                        <th scope="col">Transaction</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.activity.map((a) => (
                        <tr key={`${a.tx_hash}-${a.other}-${a.amount}`}>
                          <td>{when(a.at)}</td>
                          <td>
                            <Tone tone={a.direction === 'in' ? 'good' : 'quiet'}>
                              {a.direction === 'in' ? 'In' : 'Out'}
                            </Tone>
                          </td>
                          <td>
                            <code>{short(a.other)}</code>
                          </td>
                          <td className="adm-num">
                            {a.direction === 'in' ? '+' : '−'}
                            {usd(a.amount)}
                          </td>
                          <td>
                            <a
                              href={explorerTxUrl(chain, a.tx_hash as `0x${string}`)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {a.tx_hash.slice(0, 10)}… ↗
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="adm-empty">No dollar transfers indexed for this wallet.</p>
              )}
            </section>
          </>
        )}
      </main>
    </>
  )
}
