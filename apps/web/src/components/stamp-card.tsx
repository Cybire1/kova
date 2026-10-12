'use client'

import { useEffect, useState } from 'react'
import type { StampCard as Card } from '@/lib/api'
import { knownPayer } from '@/lib/payer'
import { Art, Icon, LogoMark } from './brand'

/**
 * A wallet's stamp card at a stall, read from the shop's paid orders. `payer` is undefined until
 * the browser has been asked, null when no wallet has paid from here.
 */
export function useStampCard(slug: string, enabled = true) {
  const [payer, setPayer] = useState<string | null | undefined>(undefined)
  const [card, setCard] = useState<Card | null>(null)

  useEffect(() => {
    setPayer(enabled ? knownPayer() : null)
  }, [enabled])

  useEffect(() => {
    if (!payer) return
    let live = true
    fetch(`/api/stalls/${encodeURIComponent(slug)}/stamps?payer=${payer}`, { cache: 'no-store' })
      .then(async (r) => (r.ok ? ((await r.json()) as Card) : null))
      .then((c) => live && setCard(c))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [slug, payer])

  return { payer, card }
}

/**
 * The stamp card, as the buyer sees it: a row of stamps, one per paid order, then the free one.
 * With no wallet known in this browser it's a blank card that says how to start it.
 */
export function StampCard({
  every,
  stamps,
  ready,
  known,
  shop,
  fresh,
  justUsed,
}: {
  every: number
  stamps: number
  ready: boolean
  /** A wallet has paid from this browser, so these are its stamps. */
  known: boolean
  shop: string
  /** The stamp this payment just added: it lands with a thump. */
  fresh?: boolean
  /** This payment spent a full card: a new one starts. */
  justUsed?: boolean
}) {
  const filled = Math.min(stamps, every)
  const left = every - filled
  return (
    <section className="stamps" data-ready={ready ? 'true' : undefined} aria-label={`Stamp card at ${shop}`}>
      <span className="stamps-kovi" aria-hidden="true">
        <Art name="kovi-peek" size={80} />
      </span>
      <div className="stamps-head">
        <p className="stamps-kicker">Stamp card</p>
        <h2>
          {justUsed
            ? 'Card used. Enjoy the free one.'
            : ready
              ? 'Your card is full'
              : known
                ? `${filled} of ${every} stamps`
                : `Collect ${every} stamps, get one free`}
        </h2>
        <p className="stamps-line">
          {justUsed
            ? 'A fresh card starts with your next order here.'
            : ready
              ? 'The cheapest thing on your next order is free. Pay with the same wallet to use it.'
              : known
                ? `${left} more ${left === 1 ? 'order' : 'orders'} and the cheapest thing on the next one is free.`
                : 'Pay with Kova to start your card. No sign-up: the wallet you pay with is the card.'}
        </p>
      </div>
      <ol className="stamps-row" style={{ '--stamps': every + 1 } as React.CSSProperties}>
        {Array.from({ length: every }, (_, i) => {
          const on = !justUsed && i < filled
          return (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: stamps are positions on the card
              key={i}
              className="stamp"
              data-on={on ? 'true' : undefined}
              data-fresh={on && fresh && i === filled - 1 ? 'true' : undefined}
              aria-label={on ? `Stamp ${i + 1}` : `Stamp ${i + 1}, empty`}
            >
              {on ? <LogoMark size={20} stem="#fff" wave="var(--ink)" /> : <span>{i + 1}</span>}
            </li>
          )
        })}
        <li className="stamp stamp-free" data-on={ready && !justUsed ? 'true' : undefined} aria-label="Then one free">
          <Icon name="bag" size={14} />
          <span>Free</span>
        </li>
      </ol>
    </section>
  )
}

/** The card after a payment: the stamp it earned, or the fresh card a free item started. */
export function StampsAfterPay({ slug, shop, usedReward }: { slug: string; shop: string; usedReward: boolean }) {
  const { payer, card } = useStampCard(slug)
  if (!payer || !card?.every) return null
  return <StampCard every={card.every} stamps={card.stamps} ready={card.ready} known shop={shop} fresh={!usedReward} justUsed={usedReward && card.stamps === 0} />
}
