'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { Art, Icon } from '@/components/brand'
import { useArrivals } from '@/lib/wallet/arrivals'
import { formatUsd } from '@/lib/wallet/money'
import { type Entry, useWallet } from './provider'

export function ArrivalNotice() {
  const { profile, activity, activityReady, privateScanReady } = useWallet()
  const { arrival, dismiss } = useArrivals(
    profile?.address,
    activity,
    activityReady,
    privateScanReady,
  )
  return arrival ? <ArrivalDialog key={arrival.id} entry={arrival} onDismiss={dismiss} /> : null
}

function ArrivalDialog({ entry, onDismiss }: { entry: Entry; onDismiss(): void }) {
  const { hideBalance } = useWallet()
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = dialog.current
    if (!node || node.open) return
    if (typeof node.showModal === 'function') node.showModal()
    else node.setAttribute('open', '')
    // The card itself takes focus, so no control wears a focus ring the moment it opens; Tab
    // still reaches Close and Done.
    node.focus()
  }, [])
  const privately = Boolean(entry.oneTime)
  return (
    <dialog
      ref={dialog}
      tabIndex={-1}
      className="w-arrival"
      aria-labelledby="w-arrival-title"
      aria-describedby="w-arrival-detail"
      onCancel={(event) => {
        event.preventDefault()
        onDismiss()
      }}
    >
      <div className="w-arrival-top">
        <span className="w-arrival-chip">
          {privately ? (
            <>
              <Icon name="lock" size={14} /> Private payment
            </>
          ) : (
            'Just arrived'
          )}
        </span>
        <button
          type="button"
          className="round"
          aria-label="Close payment received"
          onClick={onDismiss}
        >
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className="w-arrival-art" aria-hidden="true">
        {[12, 28, 47, 65, 82].map((left, index) => (
          <span
            key={left}
            className="w-arrival-coin"
            style={{ left: `${left}%`, animationDelay: `${index * 130}ms` }}
          >
            <Art name="coin-usd" size={28} />
          </span>
        ))}
        <Art name="kovi-catch" size={190} />
        <span className="w-arrival-yay">Yay!</span>
      </div>
      <h2 id="w-arrival-title">
        {entry.kind === 'added'
          ? 'Money’s in.'
          : `${entry.name || 'Someone'} ${privately ? 'paid you privately' : 'paid you'}`}
      </h2>
      {entry.unconfirmed ? (
        <p className="w-fine">Sender unconfirmed: only their sealed note says it’s them.</p>
      ) : null}
      <p className="w-arrival-amount">
        {hideBalance ? '••••' : formatUsd(BigInt(entry.amount), { sign: true })}
      </p>
      <p id="w-arrival-detail">
        {privately
          ? 'Ready to spend privately. These dollars stay separate from your main balance.'
          : 'Added to your balance.'}
      </p>
      {entry.private && !entry.locked ? (
        <blockquote className="w-arrival-note">{entry.detail}</blockquote>
      ) : null}
      <button type="button" className="pill pill-block" data-tone="ink" onClick={onDismiss}>
        Done <Icon name="check" size={18} />
      </button>
      <Link
        className="textlink"
        href={`/wallet/activity/${encodeURIComponent(entry.id)}`}
        onClick={onDismiss}
      >
        {privately ? 'See private payment' : 'View payment'}
      </Link>
    </dialog>
  )
}
