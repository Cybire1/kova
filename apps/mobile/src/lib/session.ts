import type { Secp256k1SigningSession } from '@category-labs/mera'
import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import type { LocalAccount } from 'viem'

/**
 * Kova Pay's signing session. After one Face ID the wallet can approve payments without asking
 * again, the way a contactless card works: small amounts, for a few minutes, while Kova Pay is on
 * screen. It ends by itself when the app goes to the background, after three quiet minutes, or
 * once it has approved $150; anything over $50 always asks for Face ID. Ending zeroes the key.
 */
export const SESSION_IDLE_MS = 3 * 60_000
export const TAP_LIMIT = 50_000_000n
export const SESSION_LIMIT = 150_000_000n

interface Live {
  session: Secp256k1SigningSession
  account: LocalAccount
  lastUsed: number
  spent: bigint
}

let live: Live | null = null
const listeners = new Set<() => void>()
const notify = () => {
  for (const listener of listeners) listener()
}

export function startSession(session: Secp256k1SigningSession, account: LocalAccount) {
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

export const sessionOpen = () => live !== null && Date.now() - live.lastUsed <= SESSION_IDLE_MS

/** Whether a payment of `amount` would go through without Face ID right now. No side effects. */
export const sessionCovers = (amount: bigint) =>
  sessionOpen() && live !== null && amount <= TAP_LIMIT && live.spent + amount <= SESSION_LIMIT

export interface SessionState {
  open: boolean
  /** Until the quiet limit ends it. */
  msLeft: number
  /** The most one payment can be without Face ID right now. */
  canApprove: bigint
}

export function sessionState(now = Date.now()): SessionState {
  if (!live) return { open: false, msLeft: 0, canApprove: 0n }
  const msLeft = SESSION_IDLE_MS - (now - live.lastUsed)
  if (msLeft <= 0) return { open: false, msLeft: 0, canApprove: 0n }
  const left = SESSION_LIMIT - live.spent
  return { open: true, msLeft, canApprove: left < TAP_LIMIT ? left : TAP_LIMIT }
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

/** Re-renders when the session opens or closes, so the screen can say whether Face ID will ask. */
export function useSessionCovers(amount: bigint): boolean {
  const [covered, setCovered] = useState(() => sessionCovers(amount))
  useEffect(() => {
    const check = () => setCovered(sessionCovers(amount))
    check()
    const unsubscribe = onSessionChange(check)
    // The idle limit passes without an event, so look again now and then.
    const timer = setInterval(check, 15_000)
    return () => {
      unsubscribe()
      clearInterval(timer)
    }
  }, [amount])
  return covered
}

export function onSessionChange(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// Leaving the screen ends it: a phone in a pocket never has a live key.
AppState.addEventListener('change', (state) => {
  if (state !== 'active') endSession()
})
