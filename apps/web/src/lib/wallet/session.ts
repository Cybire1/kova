import { useEffect, useState } from 'react'
import type { LocalAccount } from 'viem'

/**
 * The signing session, as the app has it (apps/mobile src/lib/session.ts): after one passkey
 * prompt the wallet approves small payments without asking again, the way a contactless card
 * does. It ends after three quiet minutes, once it has approved $150, or when the page closes;
 * anything over $50 always asks. Ending zeroes the key: it only ever lived in this tab's memory.
 */
export const SESSION_IDLE_MS = 3 * 60_000
export const TAP_LIMIT = 50_000_000n
export const SESSION_LIMIT = 150_000_000n

interface Live {
  session: { end(): void }
  account: LocalAccount
  lastUsed: number
  spent: bigint
}

let live: Live | null = null
const listeners = new Set<() => void>()
const notify = () => {
  for (const listener of listeners) listener()
}

export function startSession(session: { end(): void }, account: LocalAccount) {
  endSession()
  live = { session, account, lastUsed: Date.now(), spent: 0n }
  notify()
}

export function endSession() {
  if (!live) return
  live.session.end()
  live = null
  notify()
}

/** The session's account, if it can approve `amount` without asking. */
export function sessionAccount(amount: bigint): LocalAccount | null {
  if (!live) return null
  if (Date.now() - live.lastUsed > SESSION_IDLE_MS) {
    endSession()
    return null
  }
  if (amount > TAP_LIMIT || live.spent + amount > SESSION_LIMIT) return null
  return live.account
}

/** Counts a payment the session approved, and keeps it alive. */
export function spend(amount: bigint) {
  if (!live) return
  live.spent += amount
  live.lastUsed = Date.now()
  notify()
}

export interface SessionState {
  open: boolean
  msLeft: number
  /** The most one payment can be without the passkey right now. */
  canApprove: bigint
}

export function sessionState(now = Date.now()): SessionState {
  if (!live) return { open: false, msLeft: 0, canApprove: 0n }
  const msLeft = SESSION_IDLE_MS - (now - live.lastUsed)
  if (msLeft <= 0) return { open: false, msLeft: 0, canApprove: 0n }
  const left = SESSION_LIMIT - live.spent
  return { open: true, msLeft, canApprove: left < TAP_LIMIT ? left : TAP_LIMIT }
}

export const sessionCovers = (amount: bigint) => {
  const state = sessionState()
  return state.open && amount <= state.canApprove
}

export function onSessionChange(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The session as it stands, ticking each second while it's open, for a live countdown. */
export function useSessionState(): SessionState {
  const [state, setState] = useState(() => sessionState())
  useEffect(() => {
    const tick = () => setState(sessionState())
    const unsubscribe = onSessionChange(tick)
    const timer = setInterval(tick, 1000)
    return () => {
      unsubscribe()
      clearInterval(timer)
    }
  }, [])
  return state
}
