import type { Metadata } from 'next'
import Link from 'next/link'
import { toString as qrSvg } from 'qrcode'
import { Art, Icon } from '@/components/brand'
import { CancelCharge } from '@/components/cancel-charge'
import { CopyField } from '@/components/copy'
import { clock, statusText } from '@/components/payment-row'
import { WatchPaid } from '@/components/watch-paid'
import { ApiError, kova, type PaymentDetail } from '@/lib/api'
import { publicUrl } from '@/lib/url'
import { usd } from '@/lib/format'

export const metadata: Metadata = { title: 'Payment' }

const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`
const stamp = (iso: string) => `${new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${clock(iso)}`

export default async function PaymentPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  let p: PaymentDetail
  try {
    p = await kova<PaymentDetail>(`/v1/payment_intents/${encodeURIComponent(id)}`)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404)
      return (
        <section className="card empty big-empty">
          <Art name="kovi-oops" size={140} />
          <h3>No such payment</h3>
          <p>It may belong to another shop, or the link is incomplete.</p>
          <Link className="textlink" href="/dashboard/payments">
            Back to payments
          </Link>
        </section>
      )
    throw error
  }

  const open = p.status === 'requires_payment' || p.status === 'processing'
  const payLink = `${await publicUrl()}/pay/${p.id}`
  const qr = open ? await qrSvg(payLink, { type: 'svg', margin: 0, color: { dark: '#0b1a1d', light: '#ffffff' } }) : null
  const took = p.paid_at ? (new Date(p.paid_at).getTime() - new Date(p.created_at).getTime()) / 1000 : null

  const steps: { label: string; at?: string; state: 'done' | 'now' | 'off' }[] = [
    { label: 'Charge started', at: p.created_at, state: 'done' },
    p.status === 'paid'
      ? { label: 'Paid and settled on Monad', at: p.paid_at ?? undefined, state: 'done' }
      : open
        ? { label: 'Waiting for the customer', state: 'now' }
        : { label: statusText[p.status], at: p.status === 'expired' ? p.expires_at : undefined, state: 'off' },
  ]

  return (
    <>
      <Link href="/dashboard/payments" className="backlink">
        <Icon name="back" size={16} /> Payments
      </Link>

      <div className="detail">
        <div className="stack">
          <section className="card detail-hero" data-status={p.status}>
            <span className="status-chip" data-status={p.status}>
              {p.status === 'paid' ? <Icon name="check" size={14} /> : null}
              {statusText[p.status]}
            </span>
            <p className="detail-amount">{usd(p.amount)}</p>
            <p className="detail-for">{p.reference ?? 'No note'}</p>
            {took !== null && took < 3600 ? <p className="detail-took">Paid {took < 60 ? `${took.toFixed(1)} seconds` : `${Math.round(took / 60)} minutes`} after it was started</p> : null}
          </section>

          <section className="card" aria-label="Timeline">
            <div className="card-head">
              <h2>Timeline</h2>
            </div>
            <ol className="timeline">
              {steps.map((s) => (
                <li key={s.label} data-state={s.state}>
                  <span className="timeline-dot" />
                  <span>
                    <strong>{s.label}</strong>
                    {s.at ? <span>{stamp(s.at)}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section className="card" aria-label="Details">
            <div className="card-head">
              <h2>Details</h2>
            </div>
            <dl className="facts">
              <div>
                <dt>Charge</dt>
                <dd>
                  <code>{p.id}</code>
                </dd>
              </div>
              <div>
                <dt>Taken on</dt>
                <dd>{p.terminal ? p.terminal.name : 'Dashboard or API'}</dd>
              </div>
              <div>
                <dt>Settles in</dt>
                <dd>{p.currency} on Monad {p.network === 'testnet' ? 'testnet' : ''}</dd>
              </div>
              <div>
                <dt>Paid to</dt>
                <dd>
                  <code title={p.pay_to}>{short(p.pay_to)}</code>
                </dd>
              </div>
              {p.payment ? (
                <>
                  <div>
                    <dt>Paid by</dt>
                    <dd>
                      <code title={p.payment.payer}>{short(p.payment.payer)}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Transaction</dt>
                    <dd>
                      <a className="textlink" href={p.payment.explorer_url} target="_blank" rel="noreferrer">
                        {short(p.payment.tx_hash)} <Icon name="external" size={14} />
                      </a>
                    </dd>
                  </div>
                  {p.payment.block_number ? (
                    <div>
                      <dt>Block</dt>
                      <dd>{Number(p.payment.block_number).toLocaleString()}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Fee</dt>
                    <dd>$0.00 to the customer, covered by Kova</dd>
                  </div>
                </>
              ) : null}
            </dl>
          </section>
        </div>

        <aside className="dash-side">
          {open && qr ? (
            <section className="card payqr" aria-label="Pay this charge">
              <div className="card-head">
                <h2>Waiting for payment</h2>
              </div>
              {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally generated SVG */}
              <div className="qr qr-big" dangerouslySetInnerHTML={{ __html: qr }} />
              <p className="code-meta">Scan with Kova Pay or any Monad wallet. Code expires {clock(p.expires_at)}.</p>
              <CopyField label="Pay link" value={payLink} />
              <div className="payqr-cancel">
                <CancelCharge id={p.id} />
              </div>
              <WatchPaid id={p.id} />
            </section>
          ) : (
            <>
              {p.status === 'paid' ? (
                <section className="card paid-card" aria-label="Receipt">
                  <div className="receipt">
                    <Art name="scene-paid-terminal" size={250} />
                    <div className="receipt-text">
                      <small>PAID</small>
                      <strong>{usd(p.amount)}</strong>
                    </div>
                    <Art name="kovi-cheer" size={72} className="kovi-cheer kovi-cheer-sm" />
                  </div>
                  <p>Settled to your address{p.terminal ? ` from ${p.terminal.name}` : ''}.</p>
                </section>
              ) : null}
            <section className="card memo" aria-label="Memo">
              <div className="card-head">
                <h2>On-chain memo</h2>
              </div>
              <p className="code-meta memo-note">
                The payment carries this memo, so it’s matched to this charge without trusting anyone’s word.
              </p>
              <div className="memo-field">
                <CopyField label="Memo" value={p.memo} />
              </div>
            </section>
            </>
          )}
        </aside>
      </div>
    </>
  )
}
