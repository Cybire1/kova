import type { Checkout } from '@/lib/api'
import { usd } from '@/lib/format'
import { Art } from './brand'
import { OrderReady } from './order-ready'
import { StampsAfterPay } from './stamp-card'

/**
 * A paid charge, as the payer sees it: the terminal's receipt and Kovi cheering, at a size that
 * leaves the words in view. A stall order then shows where it is at the counter, and the stamp
 * the payment earned.
 */
export function PaidReceipt({
  checkout: c,
  after = 'You can close this page.',
}: {
  checkout: Checkout
  after?: string
}) {
  const order = c.order
  // Someone paying for a friend's order isn't the one waiting for it.
  const waiting = order?.stall && order.status && !order.pay_for_me ? order : null
  return (
    <section className="paid paid-payer" aria-live="polite">
      <div className="receipt">
        <Art name="scene-paid-terminal" size={176} priority />
        <div className="receipt-text">
          <small>PAID</small>
          <strong>{usd(c.amount)}</strong>
        </div>
        <Art name="kovi-cheer" size={52} className="kovi-cheer" priority />
      </div>
      <h1>Paid to {c.merchant_name}</h1>
      {/* A stall order's card below says where it is; the amount is always said here. */}
      <p>
        {usd(c.amount)}
        {c.reference ? ` for ${c.reference}` : ''}.{waiting || !after ? '' : ` ${after}`}
      </p>
      {order?.reward ? (
        <p className="paid-reward">
          <strong>Free with your stamp card</strong> One {order.reward.name},{' '}
          {usd(order.reward.amount)} off
        </p>
      ) : null}
      {waiting?.stall ? (
        <div className="paid-order">
          <OrderReady checkoutId={c.id} order={waiting} shop={waiting.stall.name} />
          <StampsAfterPay
            slug={waiting.stall.slug}
            shop={waiting.stall.name}
            usedReward={Boolean(order?.reward)}
          />
        </div>
      ) : null}
    </section>
  )
}
