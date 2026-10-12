'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Checkout, OrderStatus } from '@/lib/api'
import { Art, Icon } from './brand'

type Order = NonNullable<Checkout['order']>

const STEPS: { status: OrderStatus; label: string }[] = [
  { status: 'new', label: 'Order in' },
  { status: 'preparing', label: 'Making it' },
  { status: 'ready', label: 'Ready' },
  { status: 'collected', label: 'Enjoy' },
]

/** A short two-note chime, made on the spot: no sound file to load. */
function chime(audio: AudioContext | null) {
  if (!audio) return
  void audio.resume().catch(() => {})
  const now = audio.currentTime
  for (const [i, hz] of [1318.5, 1760].entries()) {
    const tone = audio.createOscillator()
    const level = audio.createGain()
    tone.type = 'sine'
    tone.frequency.value = hz
    const at = now + i * 0.18
    level.gain.setValueAtTime(0.0001, at)
    level.gain.exponentialRampToValueAtTime(0.35, at + 0.02)
    level.gain.exponentialRampToValueAtTime(0.0001, at + 1.1)
    tone.connect(level).connect(audio.destination)
    tone.start(at)
    tone.stop(at + 1.2)
  }
}

/**
 * The buyer's side of the counter after paying: where the order is (in, being made, ready,
 * collected), checked every few seconds. When the shop marks it ready the page says so in big
 * letters, and chimes and buzzes the phone if it can, so nobody needs a buzzer on the table.
 */
export function OrderReady({ checkoutId, order: initial, shop }: { checkoutId: string; order: Order; shop: string }) {
  const [order, setOrder] = useState(initial)
  const [alerts, setAlerts] = useState<'off' | 'on'>('off')
  const [moment, setMoment] = useState(false)
  const audio = useRef<AudioContext | null>(null)
  const seen = useRef(initial.status)
  const status = order.status ?? 'new'
  const done = status === 'collected' || status === 'cancelled'

  // A tap anywhere lets the page make a sound later: browsers only allow audio after one.
  useEffect(() => {
    const unlock = () => {
      if (!audio.current) audio.current = new AudioContext()
      void audio.current.resume().catch(() => {})
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => window.removeEventListener('pointerdown', unlock)
  }, [])

  const announce = useCallback(() => {
    setMoment(true)
    chime(audio.current)
    navigator.vibrate?.([220, 120, 220, 120, 420])
    const title = document.title
    document.title = `Ready · ${shop}`
    setTimeout(() => {
      document.title = title
    }, 15_000)
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted')
      new Notification('Your order is ready', {
        body: order.table ? `${shop} is bringing it to table ${order.table}.` : `Collect it at the counter at ${shop}.`,
        icon: '/icon.png',
      })
  }, [order.table, shop])

  useEffect(() => {
    if (done) return
    const timer = setInterval(async () => {
      if (document.hidden && seen.current !== 'new' && seen.current !== 'preparing') return
      const r = await fetch(`/api/checkout/${encodeURIComponent(checkoutId)}`, { cache: 'no-store' }).catch(() => null)
      if (!r?.ok) return
      const next = ((await r.json()) as Checkout).order
      if (!next?.status) return
      if (next.status === 'ready' && seen.current !== 'ready') announce()
      seen.current = next.status
      setOrder(next)
    }, 3000)
    return () => clearInterval(timer)
  }, [checkoutId, done, announce])

  const turnOn = async () => {
    if (!audio.current) audio.current = new AudioContext()
    // Played once, quietly, so the buyer knows what to listen for.
    chime(audio.current)
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission().catch(() => {})
    setAlerts('on')
  }

  if (status === 'cancelled')
    return (
      <section className="ready ready-cancelled" aria-live="polite">
        <Art name="kovi-oops" size={84} />
        <h2>{shop} cancelled this order</h2>
        <p>Ask at the counter. They can refund you from their Kova.</p>
      </section>
    )

  const at = Math.max(
    0,
    STEPS.findIndex((s) => s.status === status),
  )
  const ready = status === 'ready'

  return (
    <section className="ready" data-ready={ready ? 'true' : undefined} data-moment={moment ? 'true' : undefined} aria-live="polite">
      {ready ? (
        <div className="ready-moment">
          <span className="ready-spark ready-spark-a" aria-hidden="true">
            <Art name="sparkle-8" size={28} />
          </span>
          <span className="ready-spark ready-spark-b" aria-hidden="true">
            <Art name="sparkle-4" size={22} />
          </span>
          <Art name="kovi-cheer" size={96} className="ready-kovi" />
          <p className="ready-kicker">{shop}</p>
          <h2>Your order is ready</h2>
          <p className="ready-where">{order.table ? `We’re bringing it to table ${order.table}.` : 'Collect it at the counter.'}</p>
        </div>
      ) : (
        <div className="ready-head">
          <p className="ready-kicker">{order.table ? `Table ${order.table}` : 'At the counter'}</p>
          <h2>{status === 'collected' ? 'All yours. Enjoy!' : status === 'preparing' ? `${shop} is making it` : `${shop} has your order`}</h2>
          {done ? null : (
            <p>{order.table ? `It comes to table ${order.table}. This page tells you when it’s ready.` : 'This page tells you the moment it’s ready. Keep it open.'}</p>
          )}
        </div>
      )}

      <ol className="ready-track" aria-label="Order progress">
        {STEPS.map((s, i) => (
          <li key={s.status} data-state={i < at ? 'done' : i === at ? 'now' : undefined}>
            <span className="ready-dot" aria-hidden="true">
              {i < at || (i === at && done) ? <Icon name="check" size={14} /> : null}
            </span>
            <span>{s.label}</span>
          </li>
        ))}
      </ol>

      {done || ready ? null : (
        <div className="ready-foot">
          <span className="ready-live">
            <span className="dot" /> Live
          </span>
          {alerts === 'on' ? (
            <span className="ready-alerts">
              <Icon name="bell" size={14} /> We’ll chime when it’s ready
            </span>
          ) : (
            <button type="button" className="mini" onClick={() => void turnOn()}>
              <Icon name="bell" size={14} /> Chime when it’s ready
            </button>
          )}
        </div>
      )}
    </section>
  )
}
