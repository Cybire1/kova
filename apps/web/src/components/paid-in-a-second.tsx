'use client'

import { useEffect, useRef, useState } from 'react'
import { Art, Icon } from './brand'

/**
 * How a Kova payment goes, shown at the speed it goes. The three moves sit on one track; when the
 * section comes into view a coral line fills across them in about a second, which is how long the
 * real thing takes, each clock lights as it passes, and the last move is stamped paid. What that
 * second cost is its receipt underneath. "Run it again" replays it.
 */
export function PaidInASecond() {
  const ref = useRef<HTMLElement>(null)
  const [run, setRun] = useState(0)

  useEffect(() => {
    const section = ref.current
    if (!section) return
    const watch = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        setRun(1)
        watch.disconnect()
      },
      { threshold: 0.35 },
    )
    watch.observe(section)
    return () => watch.disconnect()
  }, [])

  return (
    <section className="lp-section lp-moves" id="how" ref={ref}>
      <div className="lp-moves-head">
        <h2 className="lp-h2">Three moves, and it’s paid</h2>
        <p className="lp-moves-lead">
          Start to finish, about a second. This is it, at the speed it happens.
        </p>
      </div>

      {/* Remounting the track restarts its animation. */}
      <ol className="lp-track" key={run} data-run={run > 0 ? 'true' : undefined}>
        <li className="lp-stop">
          <span className="lp-clock">0.0s</span>
          <div className="lp-frame lp-tint-teal">
            <Art name="badge-shop" size={112} />
            <span className="lp-price">$12.50</span>
          </div>
          <h3>Type the price</h3>
          <p>On Kova Terminal, on any phone. Add what it’s for if you like: “Two flat whites”.</p>
        </li>
        <li className="lp-stop">
          <span className="lp-clock">0.4s</span>
          <div className="lp-frame lp-tint-coral">
            <Art name="scene-faceid" size={200} />
          </div>
          <h3>They tap or scan</h3>
          <p>
            With Kova Pay it’s one tap and Face ID. Any Monad wallet can scan the code and pay, and
            Kova covers the network fee.
          </p>
        </li>
        <li className="lp-stop">
          <span className="lp-clock">0.9s</span>
          <div className="lp-frame lp-tint-paper">
            <Art name="kovi-catch" size={190} />
            <span className="lp-stamp" aria-hidden="true">
              Paid
            </span>
          </div>
          <h3>It lands</h3>
          <p>
            Your till shows Paid, your dashboard updates, and the dollars are already in your
            wallet.
          </p>
        </li>
      </ol>

      <div className="lp-tally-row">
        <dl className="lp-tally" aria-label="What that second cost">
          <div>
            <dt>From tap to settled</dt>
            <dd>about 1s</dd>
          </div>
          <div>
            <dt>Fees for your customer</dt>
            <dd className="lp-tally-zero">$0.00</dd>
          </div>
          <div>
            <dt>Card machines to buy</dt>
            <dd>0</dd>
          </div>
          <div>
            <dt>Wait for your money</dt>
            <dd>none, weekends too</dd>
          </div>
        </dl>
        <button type="button" className="lp-again" onClick={() => setRun((n) => n + 1)}>
          <Icon name="refresh" size={16} /> Run it again
        </button>
      </div>
    </section>
  )
}
