'use client'

import { createContext, useContext, useEffect, useRef } from 'react'

/**
 * Money flows open as they do in the app: the screen rises over Home, the dock steps aside, and ×
 * closes it the way it came. Send is its own sheet (send.tsx); these are the rest.
 */
const FLOWS = [
  '/wallet/request',
  '/wallet/receive',
  '/wallet/cash-out',
  '/wallet/pay',
  '/wallet/add',
  '/wallet/convert-mon',
  '/wallet/repeat/new',
]

export const isFlow = (path: string) => {
  const bare = path.split(/[?#]/)[0] ?? path
  return FLOWS.some((f) => bare === f || bare.startsWith(`${f}/`))
}

/** The open flow's way out: plays the screen's exit, then goes to `href`. */
export const FlowContext = createContext<{ close: (href: string) => void } | null>(null)

export const useFlow = () => useContext(FlowContext)

/**
 * A flow's steps: each new one slides in from the side it comes from, forward from the right and
 * back from the left, so moving through a flow reads as moving through it.
 */
export function Steps({
  step,
  order,
  children,
}: {
  step: string
  order: readonly string[]
  children: React.ReactNode
}) {
  const last = useRef(step)
  const back = order.indexOf(step) < order.indexOf(last.current)
  useEffect(() => {
    last.current = step
  }, [step])
  return (
    <div key={step} className={`w-step${back ? ' w-step-back' : ''}`}>
      {children}
    </div>
  )
}
