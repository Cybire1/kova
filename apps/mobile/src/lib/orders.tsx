import * as Haptics from 'expo-haptics'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { AppState } from 'react-native'
import { collectOrder, listOrders, type Order, type OrderStatus, setOrderStatus } from './api'
import { useTerminal } from './terminal'

/**
 * The shop's stall orders, kept fresh while the phone is behind the counter. A newly paid
 * order buzzes the phone and shows a banner wherever you are, so nothing waits unseen.
 */
interface OrdersState {
  ready: boolean
  /** Paid, not handed over yet. */
  toHand: Order[]
  /** Placed, not paid yet. */
  waiting: Order[]
  /** Handed over. */
  done: Order[]
  /** The order that just came in, for the banner. */
  fresh: Order | null
  dismissFresh: () => void
  collect: (order: Order, collected?: boolean) => Promise<void>
  /** Moves an order along the counter: preparing, ready, collected, cancelled. */
  advance: (order: Order, status: OrderStatus) => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<OrdersState | null>(null)

export function useOrders(): OrdersState {
  const value = useContext(Ctx)
  if (!value) throw new Error('useOrders must be used inside <OrdersProvider>')
  return value
}

const isPaid = (o: Order) => o.payment_status === 'paid'
const isWaiting = (o: Order) =>
  o.payment_status === 'requires_payment' || o.payment_status === 'processing'

export function OrdersProvider({ children }: { children: ReactNode }) {
  const { canCharge } = useTerminal()
  const [orders, setOrders] = useState<Order[]>([])
  const [ready, setReady] = useState(false)
  const [fresh, setFresh] = useState<Order | null>(null)
  /** Orders already seen paid, so only new ones announce themselves. Null until the first load. */
  const seen = useRef<Set<string> | null>(null)
  /** Handed over on this phone and not yet confirmed by the server: a poll must not undo it. */
  const pending = useRef(new Map<string, string | null>())
  /** Moved along on this phone and not yet confirmed: Ready must not flicker back to New. */
  const moving = useRef(new Map<string, OrderStatus>())

  const refresh = useCallback(async () => {
    const list = await listOrders('all', 60).catch(() => null)
    if (!list) return
    const merged = list.map((o) => {
      const status = moving.current.get(o.id)
      const moved = status ? { ...o, status } : o
      return pending.current.has(o.id)
        ? { ...moved, collected_at: pending.current.get(o.id) ?? null }
        : moved
    })
    const paidNow = merged.filter(isPaid)
    if (seen.current) {
      const arrived = paidNow.filter((o) => !seen.current?.has(o.id) && !o.collected_at)
      if (arrived.length) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        setFresh(arrived[0] ?? null)
      }
    }
    seen.current = new Set(paidNow.map((o) => o.id))
    setOrders(merged)
    setReady(true)
  }, [])

  useEffect(() => {
    if (!canCharge) return
    void refresh()
    const id = setInterval(() => {
      if (AppState.currentState === 'active') void refresh()
    }, 4000)
    return () => clearInterval(id)
  }, [canCharge, refresh])

  const collect = useCallback(async (order: Order, collected = true) => {
    const at = collected ? new Date().toISOString() : null
    pending.current.set(order.id, at)
    setOrders((list) => list.map((o) => (o.id === order.id ? { ...o, collected_at: at } : o)))
    setFresh((f) => (f?.id === order.id ? null : f))
    try {
      await collectOrder(order.id, collected)
    } finally {
      pending.current.delete(order.id)
    }
  }, [])

  const advance = useCallback(
    async (order: Order, status: OrderStatus) => {
      if (status === 'collected') return collect(order, true)
      setOrders((list) => list.map((o) => (o.id === order.id ? { ...o, status } : o)))
      setFresh((f) => (f?.id === order.id ? null : f))
      void Haptics.selectionAsync()
      moving.current.set(order.id, status)
      try {
        await setOrderStatus(order.id, status)
      } catch {
        moving.current.delete(order.id)
        await refresh()
      } finally {
        moving.current.delete(order.id)
      }
    },
    [collect, refresh],
  )

  const value = useMemo<OrdersState>(
    () => ({
      ready,
      toHand: orders.filter((o) => isPaid(o) && !o.collected_at && o.status !== 'cancelled'),
      waiting: orders.filter(isWaiting),
      done: orders.filter((o) => o.collected_at),
      fresh,
      dismissFresh: () => setFresh(null),
      collect,
      advance,
      refresh,
    }),
    [ready, orders, fresh, collect, advance, refresh],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
