import type { Metadata } from 'next'
import { Art, Brand, Icon, Pill } from '@/components/brand'
import { Notice } from '@/components/notice'
import { PaidReceipt } from '@/components/paid-receipt'
import { PayFlow } from '@/components/pay-flow'
import { type Checkout, kovaPublic } from '@/lib/api'
import { usd } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Pay' }

/**
 * What a customer sees after scanning a terminal's code. Public: the charge id is the only
 * credential. Kova Pay opens it as a deep link; any browser wallet can pay it by signing the
 * same authorization Kova Pay signs, and Kova's relayer pays the gas either way.
 */
export default async function PayPage(context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params

  let c: Checkout
  try {
    c = await kovaPublic<Checkout>(`/v1/checkout/${encodeURIComponent(id)}`)
  } catch {
    return (
      <Notice title="This charge isn’t available">
        <p>The link may be incomplete. Ask the shop to show the code again.</p>
      </Notice>
    )
  }

  if (c.status === 'paid')
    return (
      <main className="page page-narrow pay-page">
        <header className="topbar">
          <Brand />
        </header>
        <PaidReceipt checkout={c} />
      </main>
    )

  if (c.status !== 'requires_payment' && c.status !== 'processing')
    return (
      <Notice title="This charge has closed">
        <p>Nothing was taken. Ask {c.merchant_name} to start a new one.</p>
      </Notice>
    )

  return (
    <main className="page page-narrow pay-page">
      <header className="topbar">
        <Brand />
      </header>

      <PayFlow
        checkout={c}
        testnet={c.network === 'testnet'}
        privyAppId={process.env.PRIVY_APP_ID ?? null}
      >
        <section className="card payee">
          <Art name="badge-shop" size={64} priority />
          <p className="await-label" style={{ marginTop: '0.5rem' }}>
            {c.order?.pay_for_me && c.order.customer_name
              ? `${c.order.customer_name} asked you to pay for their order at ${c.order.stall?.name ?? c.merchant_name}`
              : c.order?.stall
                ? `Your order from ${c.order.stall.name}`
                : `Pay ${c.merchant_name}`}
          </p>
          <p className="await-amount">{usd(c.amount)}</p>
          {c.order?.table ? (
            <span className="chip chip-table">
              <Icon name="stall" size={14} /> Table {c.order.table}
            </span>
          ) : null}
          {c.order ? (
            <ul className="pay-lines">
              {c.order.lines.map((l) => (
                <li key={l.item_id}>
                  <span>
                    {l.quantity > 1 ? `${l.quantity} × ` : ''}
                    {l.name}
                  </span>
                  <span>{usd(Number(l.unit_price) * l.quantity)}</span>
                </li>
              ))}
              {c.order.reward ? (
                <li className="pay-reward">
                  <span>Free with your stamp card</span>
                  <span>−{usd(c.order.reward.amount)}</span>
                </li>
              ) : null}
              {c.order.note ? <li className="pay-note">“{c.order.note}”</li> : null}
            </ul>
          ) : c.reference ? (
            <p className="await-label">{c.reference}</p>
          ) : null}
          {c.order?.reward ? (
            <p className="pay-reward-help">
              {Number(c.amount) === 0
                ? 'It’s on the house. You still approve it, so you get a receipt.'
                : 'Your stamp card took it off.'}{' '}
              Pay with the wallet that holds the card.
            </p>
          ) : null}
          {c.network==='mainnet'?<Pill href={`kova://pay/${c.id}`} icon="tap" tone="coral" wide>
            Pay with the Kova app
          </Pill>:null}
          {/* The same wallet in the browser, opened with the app's passkey (or made here in a moment). */}
          <Pill
            href={`/wallet/pay/${c.id}`}
            icon="arrow"
            tone="light"
            wide
            className="pay-kova-web"
          >
            {c.network==='testnet'?'Pay with my test wallet':'Pay with my Kova wallet'}
          </Pill>
          {c.ussd ? (
            <div
              className="pay-ussd"
              style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid #14242833' }}
            >
              <strong>Pay by USSD</strong>
              <p>
                Dial <strong>{c.ussd.dial}</strong>, choose <strong>2 · Pay a till</strong>, then
                enter:
              </p>
              <p
                aria-label={`USSD payment code ${c.ussd.code}`}
                style={{
                  fontSize: '2rem',
                  fontWeight: 700,
                  letterSpacing: '.15em',
                  margin: '.5rem 0',
                }}
              >
                {c.ussd.code}
              </p>
              <p className="fineprint">
                Your USSD pocket needs enough dollars. Enter your PIN to approve the amount shown in
                the menu.
              </p>
            </div>
          ) : null}
        </section>
      </PayFlow>
    </main>
  )
}
