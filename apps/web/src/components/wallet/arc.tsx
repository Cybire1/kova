'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Art, Icon } from '@/components/brand'
import { isUnnamed, short } from './provider'
import { Avatar } from './ui'

export type Leg = 'waiting' | 'flying' | 'landed'

const first = (name: string) => (isUnnamed(name) ? short(name) : (name.split(' ')[0] ?? name))

const FACE = 60
const KOVI = 70
const BASE = 104

/** The curve from your face to theirs, rising over the middle. */
function arc(width: number) {
  const from = { x: FACE / 2 + 4, y: BASE - FACE / 2 - 6 }
  return { from, via: { x: width / 2, y: -10 }, to: { x: width - FACE / 2 - 4, y: from.y } }
}

/**
 * You, Kovi's dotted arc, and them. Kovi hovers at the top while you check; on send he flies the
 * arc, the dots marching under him, and lands on their face, which gets a tick.
 */
export function ArcRoute({
  you,
  them,
  leg,
}: {
  /** Where the money starts: you, or (claiming a link) whoever sent it, labelled `you.label`. */
  you: { name: string; id: string; label?: string }
  them: { name: string; id: string }
  leg: Leg
}) {
  const box = useRef<HTMLDivElement>(null)
  const kovi = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const t = useRef(0.5)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    setWidth(el.clientWidth)
    return () => observer.disconnect()
  }, [])

  const { from, via, to } = arc(width)

  // Places Kovi at `u` along the curve, turned the way he flies.
  const place = useCallback(
    (u: number) => {
      const el = kovi.current
      if (!el || !width) return
      const { from, via, to } = arc(width)
      const a = 1 - u
      const x = a * a * from.x + 2 * a * u * via.x + u * u * to.x
      const y = a * a * from.y + 2 * a * u * via.y + u * u * to.y
      const dx = 2 * a * (via.x - from.x) + 2 * u * (to.x - via.x)
      const dy = 2 * a * (via.y - from.y) + 2 * u * (to.y - via.y)
      const land = Math.max(0, (u - 0.9) / 0.1)
      el.style.opacity = String(1 - land)
      el.style.transform = `translate(${x - KOVI / 2}px, ${y - KOVI / 2}px) rotate(${Math.atan2(dy, dx) * 0.8}rad) scale(${1 - land * 0.6})`
    },
    [width],
  )

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const legs: [number, number, (p: number) => number][] =
      leg === 'flying'
        ? [
            [0.04, 260, (p) => 1 - (1 - p) ** 2],
            [0.82, 1100, (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2)],
          ]
        : leg === 'landed'
          ? [[1, 260, (p) => 1 - (1 - p) ** 3]]
          : [[0.5, 500, (p) => 1 - (1 - p) ** 3]]
    if (reduced) {
      t.current = legs[legs.length - 1]?.[0] ?? 0.5
      place(t.current)
      return
    }
    let frame = 0
    let i = 0
    let began = performance.now()
    let start = t.current
    const step = (now: number) => {
      const current = legs[i]
      if (!current) return
      const [target, duration, ease] = current
      const p = Math.min(1, (now - began) / duration)
      t.current = start + (target - start) * ease(p)
      place(t.current)
      if (p < 1) frame = requestAnimationFrame(step)
      else if (++i < legs.length) {
        began = now
        start = t.current
        frame = requestAnimationFrame(step)
      }
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [leg, place])

  return (
    <div
      ref={box}
      className={`w-arc w-arc-${leg}`}
      aria-label={`From ${you.label ?? 'you'} to ${them.name}`}
      role="img"
    >
      {width ? (
        <svg width={width} height={BASE} className="w-arc-line" aria-hidden="true">
          <path
            d={`M${from.x} ${from.y} Q${via.x} ${via.y} ${to.x} ${to.y}`}
            fill="none"
            stroke="var(--ink)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="0.1 14"
          />
        </svg>
      ) : null}
      <span className="w-arc-face w-arc-you">
        <Avatar name={you.name} id={you.id} size={FACE} />
        <small>{you.label ?? 'You'}</small>
      </span>
      <span className="w-arc-face w-arc-them">
        <span className="w-arc-them-face">
          <Avatar name={them.name} id={them.id} size={FACE} />
          <span className="w-arc-tick">
            <Icon name="check" size={14} />
          </span>
        </span>
        <small>{first(them.name)}</small>
      </span>
      <div ref={kovi} className="w-arc-kovi">
        <Art name="kovi-ride" size={KOVI} className="w-arc-kovi-art" />
      </div>
    </div>
  )
}
