import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { type Checkout, getCheckout, type OrderStatus } from './api'
import { load, save } from './storage'

/**
 * Stall orders this phone paid for, followed until they're ready: the café buzzer, without the
 * buzzer. Wherever you are in Kova, the moment the counter marks your order ready the phone
 * says so, with the table it's coming to or the counter to collect it from.
 *
 * Orders are kept on the phone, so a relaunch keeps following them. Each is followed for a few
 * hours at most: an order nobody marked ready is not worth asking about forever.
 */
export interface Watched {
  /** The charge it was paid with: the buyer's handle on the order. */
  checkout: string
  stall: string
  table: string | null
  /** "Croissant, 2 × Flat white" */
  items: string
  status: OrderStatus
  paidAt: number
  /** Already shown as ready, so it's announced once. */
  announced?: boolean
}

const KEY = 'kova.orders.watched.v1'
const FOLLOW_MS = 3 * 60 * 60_000
const EVERY_MS = 3000

let watched: Watched[] = []
let loaded = false
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
  void save(KEY, watched)
}

function update(checkout: string, change: Partial<Watched>) {
  watched = watched.map((w) => (w.checkout === checkout ? { ...w, ...change } : w))
  emit()
}

const following = (w: Watched) =>
  (w.status === 'new' || w.status === 'preparing') && Date.now() - w.paidAt < FOLLOW_MS

/** Starts following a stall order just paid on this phone, unless it was paid for someone else. */
export function watchOrder(checkout: Checkout) {
  const order = checkout.order
  if (!order?.stall || !order.status || order.pay_for_me) return
  const next: Watched = {
    checkout: checkout.id,
    stall: order.stall.name,
    table: order.table ?? null,
    items: order.lines
      .map((l) => (l.quantity > 1 ? `${l.quantity} × ${l.name}` : l.name))
      .join(', '),
    status: order.status,
    paidAt: Date.now(),
  }
  watched = [
    next,
    ...watched.filter((w) => w.checkout !== checkout.id && Date.now() - w.paidAt < FOLLOW_MS),
  ].slice(0, 10)
  emit()
}

/** One followed order, live. Null when this phone isn't following it. */
export function useWatchedOrder(checkout: string | undefined): Watched | null {
  const [value, setValue] = useState<Watched | null>(null)
  useEffect(() => {
    const listener = () =>
      setValue(checkout ? (watched.find((w) => w.checkout === checkout) ?? null) : null)
    listener()
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [checkout])
  return value
}

/** Development only: shows an order as ready without a counter, to see the moment on a simulator. */
export function devMarkReady(checkout: string) {
  if (!__DEV__) return
  update(checkout, { status: 'ready' })
}

/** Mounted once at the root: asks after followed orders, and shows the moment one is ready. */
export function OrderWatcher() {
  useEffect(() => {
    let stopped = false
    const check = async () => {
      if (!loaded) {
        watched = (await load<Watched[]>(KEY, [])).filter((w) => Date.now() - w.paidAt < FOLLOW_MS)
        loaded = true
        emit()
      }
      if (AppState.currentState !== 'active') return
      for (const w of watched.filter(following)) {
        const latest = await getCheckout(w.checkout).catch(() => null)
        const status = latest?.order?.status
        if (stopped || !status || status === w.status) continue
        update(w.checkout, { status })
      }
      // Announce outside the loop, so an order marked ready while the app was away shows on return.
      const ready = watched.find(
        (w) => w.status === 'ready' && !w.announced && Date.now() - w.paidAt < FOLLOW_MS,
      )
      if (ready && !stopped) {
        update(ready.checkout, { announced: true })
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        router.push({ pathname: '/ready/[id]', params: { id: ready.checkout } })
      }
    }
    void check()
    const id = setInterval(() => void check(), EVERY_MS)
    const sub = AppState.addEventListener('change', (state) => state === 'active' && void check())
    return () => {
      stopped = true
      clearInterval(id)
      sub.remove()
    }
  }, [])
  return null
}
