import {
  type PaymentRoute,
  type RouteInput,
  routePayment,
  type StealthKeys,
  stealthMetaAddress,
} from '@kova/monad'
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
import type { LocalAccount } from 'viem'
import { getBalance } from './chain'
import { formatUsd } from './money'
import {
  advance,
  feedAfter,
  findMine,
  gather,
  holdingsOf,
  type MoveInOutcome,
  moveIn as moveInCore,
  oneTimeAccount,
  type PrivateReceipt,
  planSpend,
  readHeld,
  readReceipt,
  receivingKeys,
  viewFromKey,
  waitingIn,
} from './private-core'
import {
  freshSince,
  isPublished,
  loadScan,
  makeReceiving,
  onReceivingChange,
  publishReceiving,
  readReceivingSpendKey,
  readReceivingView,
  type SavedReceiving,
  saveScan,
} from './private-store'
import { sessionOpen } from './session'
import type { MoveProgress } from './takings-core'
import { useWallet } from './wallet'

/** Where a payment comes from, as the privacy router decides it (@kova/monad). */
export type Route = PaymentRoute<PrivateReceipt>

/** Paying with private dollars, step by step. */
export interface SpendProgress {
  /** 'gathering': several addresses put together into one first. 'moving': just enough moving into the balance first. */
  step: 'unlocking' | 'gathering' | 'moving' | 'paying'
  done?: number
  total?: number
  /** What's moving into the balance. */
  amount?: bigint
}

/** How a routed payment is made: from the balance, or signed by one of this wallet's one-time addresses. */
export interface PayWays<T> {
  fromBalance: () => Promise<T>
  fromPrivate: (account: LocalAccount) => Promise<T>
}

/**
 * This wallet's private dollars: payments people sent it privately, each at a one-time address only
 * this wallet's keys can open. The phone finds them in Kova's public feed with its viewing key (Kova
 * can't tell whose they are), opens each one's sealed memo itself, and puts each in your activity as
 * it arrives. They count in your balance like any dollars, and there is nothing to move: the privacy
 * router picks where each payment comes from, paying straight from those addresses when it can, and
 * moving just enough into the balance first only when nothing else covers it. Moving them to the
 * main wallet is a button on the Private dollars screen. Shared by Home, the Private screen, receipts,
 * and the pay and send flows.
 */
interface PrivateDollars {
  /** This phone holds this wallet's private-receiving keys, so it can find and move private payments. */
  keysHere: boolean
  /** Kova has this wallet's key, so anyone can send to it privately. Null until the phone knows. */
  published: boolean | null
  /** The cached receipts are loaded: what the screens show is real, not empty for want of a look. */
  ready: boolean
  /** Found with this wallet's viewing key, newest first. */
  receipts: PrivateReceipt[]
  /** Base units waiting at one-time addresses. */
  waiting: bigint
  waitingCount: number
  /** Making the keys on this phone. */
  working: boolean
  progress: MoveProgress | null
  /** The last move in, until it's put away. */
  moved: (MoveInOutcome & { at: number }) | null
  problem: { during: 'setup' | 'move' | 'spend'; text: string } | null
  /** A payment from private dollars, step by step, while it runs. */
  spending: SpendProgress | null
  /** Whether private dollars pay `amount` from one address, need gathering first, or don't cover it. */
  coverFor: (amount: bigint) => 'single' | 'gather' | null
  /** Where a payment comes from, by the privacy router, with this phone's private dollars. */
  route: (input: Omit<RouteInput<PrivateReceipt>, 'holdings'>) => Route
  /**
   * Makes a payment the way `route` says: from the balance; from private dollars; or from the balance
   * after just enough private dollars move into it.
   */
  pay: <T>(route: Route, amount: bigint, ways: PayWays<T>) => Promise<T>
  /**
   * Pays `amount` from private dollars: the wallet opens (once) to make the keys, the smallest
   * address that covers it signs the payment (several are gathered into one first), and the change
   * stays there, still private.
   */
  spendFrom: <T>(amount: bigint, pay: (account: LocalAccount) => Promise<T>) => Promise<T>
  /**
   * Moves the fewest whole addresses that make up `shortfall` into the balance, for a payment that
   * goes right after (the wallet opens for both at once). That move is public on Monad.
   */
  moveInFor: (shortfall: bigint) => Promise<MoveInOutcome>
  /** Kova's Announcement on Monad of the payment to this one-time address, once posted. */
  announcementAt: (oneTime: string | undefined) => string | null
  refresh: () => Promise<void>
  /** Makes this wallet's keys on this phone (the open wallet, or Face ID) and gives Kova the public half. */
  setUp: () => Promise<boolean>
  /**
   * Makes every private dollar public: each address moves what it holds into the wallet itself.
   * `openWallet`: the wallet itself unlocks (one Face ID) rather than the private keys alone.
   */
  moveIn: (options?: { openWallet?: boolean }) => Promise<MoveInOutcome | null>
  clearMoved: () => void
  /** The private payment that went to this one-time address. */
  receiptAt: (oneTime: string | undefined) => PrivateReceipt | undefined
}

const Ctx = createContext<PrivateDollars | null>(null)

export function usePrivate(): PrivateDollars {
  const value = useContext(Ctx)
  if (!value) throw new Error('usePrivate must be used inside <PrivateProvider>')
  return value
}

const words = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'That didn’t work. Try again.'
/** Whether this wallet's first private arrival has been explained: once per wallet, never again. */
export const explainedKey = (wallet: string) => `kova.private.explained.v1.${wallet.toLowerCase()}`

/** How often the phone looks at Kova's feed while it's open. */
const EVERY_MS = 5000

export function PrivateProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet()
  const me = wallet.profile?.address ?? null

  const [saved, setSaved] = useState<SavedReceiving | null>(null)
  const [published, setPublished] = useState<boolean | null>(null)
  const [ready, setReady] = useState(false)
  const [receipts, setReceipts] = useState<PrivateReceipt[]>([])
  const [working, setWorking] = useState(false)
  const [progress, setProgress] = useState<MoveProgress | null>(null)
  const [moved, setMoved] = useState<PrivateDollars['moved']>(null)
  const [problem, setProblem] = useState<PrivateDollars['problem']>(null)
  const [spending, setSpending] = useState<SpendProgress | null>(null)
  const [announced, setAnnounced] = useState<Record<string, string>>({})

  // Callbacks outlive the render that made them (a screen or the dev link holds one), so they read
  // the latest state from here.
  const live = useRef({ wallet, saved, receipts, published, busy: false })
  live.current = { ...live.current, wallet, saved, receipts, published }
  /** Bumped when the wallet changes, so a look that started before can't write over it. */
  const generation = useRef(0)
  const inflight = useRef<Promise<void> | null>(null)
  /** When Kova was last asked to take the key: once a minute at most while it can't. */
  const publishTried = useRef(0)

  const refresh = useCallback(() => {
    if (inflight.current) return inflight.current
    const gen = generation.current
    const run: Promise<void> = (async () => {
      const { wallet: w, saved: keys } = live.current
      const owner = w.profile?.address
      // Paying or moving from these addresses right now: look again once that's done.
      if (!owner || !keys || live.current.busy) return
      // Kova takes the key quietly, and again a minute later if it couldn't be reached.
      if (live.current.published !== true && Date.now() - publishTried.current > 60_000) {
        publishTried.current = Date.now()
        void publishReceiving(keys).then((ok) => {
          if (gen === generation.current) setPublished(ok)
        })
      }

      const state = await loadScan(owner, keys.meta)
      if (state.cursor === null && state.since === null)
        state.since = await freshSince(owner, keys.meta)
      const items = await feedAfter(state.cursor)
      const view = viewFromKey(keys.view)
      const mine = await findMine(view, items, {
        checked: new Set(state.checked),
        since: state.since,
      })
      const next = advance(items, state.cursor)
      // By address: a gathering made here is known before Kova lists it.
      const byAddress = new Map(state.receipts.map((r) => [r.stealthAddress.toLowerCase(), r]))
      const added: PrivateReceipt[] = []
      for (const item of mine) {
        const key = item.stealth_address.toLowerCase()
        const known = byAddress.get(key)
        if (known) {
          if (known.id.startsWith('local:')) byAddress.set(key, { ...known, id: item.id })
          continue
        }
        // Who sent it and their note come out of its sealed memo, opened here: nothing is asked of Kova.
        const receipt = await readReceipt(view.viewingPrivateKey, item)
        added.push(receipt)
        byAddress.set(key, receipt)
      }
      // Kova's Announcements on Monad, a few seconds after each payment: for payments here, and for
      // private sends from here (their addresses are in your activity).
      const watched = new Set([
        ...byAddress.keys(),
        ...w.activity.flatMap((e) => (e.privately && e.oneTime ? [e.oneTime.toLowerCase()] : [])),
      ])
      const announcements = { ...(state.announced ?? {}) }
      for (const item of items) {
        const key = item.stealth_address.toLowerCase()
        if (item.announce_url && watched.has(key)) announcements[key] = item.announce_url
      }
      let all = [...byAddress.values()]
        .map((r) => {
          const url = announcements[r.stealthAddress.toLowerCase()]
          return url && !r.announceUrl ? { ...r, announceUrl: url } : r
        })
        .sort((a, b) => b.at - a.at)
      // What's still at each address, read from Monad: moved in here, on the web or on another phone, it reads 0.
      const unmoved = all.filter((r) => BigInt(r.held) > 0n)
      if (unmoved.length) {
        const held = await readHeld(unmoved)
        all = all.map((r) => {
          const now = held.get(r.stealthAddress.toLowerCase())
          return now === undefined ? r : { ...r, held: now.toString() }
        })
      }
      if (gen !== generation.current || live.current.busy) return
      // Into your activity first, then remembered: a payment is never remembered without being shown.
      // Whatever turns up once the first look is done is news: the newest one gets its arrival screen.
      // Your own private dollars gathered into one address aren't a payment to you.
      const payments = added.filter((r) => r.kind !== 'change')
      const newest = payments.reduce<PrivateReceipt | null>(
        (n, r) => (!n || r.at > n.at ? r : n),
        null,
      )
      for (const r of payments) await w.receivedPrivately(r, state.caughtUp && r === newest)
      const updated = {
        ...state,
        cursor: next.cursor,
        checked: next.recent,
        caughtUp: true,
        receipts: all,
        announced: announcements,
      }
      if (JSON.stringify(updated) !== JSON.stringify(state)) await saveScan(updated)
      setReceipts((shown) => (JSON.stringify(shown) === JSON.stringify(all) ? shown : all))
      setAnnounced((shown) =>
        JSON.stringify(shown) === JSON.stringify(announcements) ? shown : announcements,
      )
      setReady(true)
    })()
      .catch((error) => {
        // No signal, or Kova unreachable: keep showing what was there.
        if (__DEV__) console.log('[private] look failed', words(error))
      })
      .finally(() => {
        if (inflight.current === run) inflight.current = null
      })
    inflight.current = run
    return run
  }, [])

  // A different wallet starts from nothing: its keys, if this phone has them, and what it found before.
  useEffect(() => {
    generation.current += 1
    inflight.current = null
    setSaved(null)
    setPublished(null)
    setReady(false)
    setReceipts([])
    setMoved(null)
    setProblem(null)
    if (!me) return
    let current = true
    const load = async () => {
      const view = await readReceivingView(me)
      if (!current) return
      setSaved(view)
      live.current.saved = view
      if (!view) return setReady(true)
      setPublished(await isPublished(view))
      const state = await loadScan(me, view.meta)
      if (!current) return
      setReceipts(state.receipts)
      setAnnounced(state.announced ?? {})
      setReady(true)
      void refresh()
    }
    void load()
    // The keys are made when the wallet opens, or Kova takes them: look again.
    const unsubscribe = onReceivingChange(() => void load())
    return () => {
      current = false
      unsubscribe()
    }
  }, [me, refresh])

  useEffect(() => {
    if (!me || !saved) return
    const id = setInterval(() => {
      if (AppState.currentState === 'active') void refresh()
    }, EVERY_MS)
    const sub = AppState.addEventListener('change', (state) => state === 'active' && void refresh())
    return () => {
      clearInterval(id)
      sub.remove()
    }
  }, [me, saved, refresh])

  const setUp = useCallback(async () => {
    const w = live.current.wallet
    const profile = w.profile
    if (!profile || live.current.busy) return false
    live.current.busy = true
    setWorking(true)
    setProblem(null)
    try {
      const view = await makeReceiving(
        profile.address,
        w.signMessage,
        profile.protected && !profile.demo,
      )
      setSaved(view)
      live.current.saved = view
      const ok = await publishReceiving(view)
      setPublished(ok)
      if (!ok)
        throw new Error(
          'Your keys are ready, but Kova couldn’t be reached to share them. It tries again by itself.',
        )
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      void refresh()
      return true
    } catch (error) {
      const text = /cancel/i.test(words(error)) ? 'Cancelled. Nothing changed.' : words(error)
      setProblem({ during: 'setup', text })
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      return false
    } finally {
      live.current.busy = false
      setWorking(false)
    }
  }, [refresh])

  /**
   * The keys that open the one-time addresses. With the wallet open (or opening it, to pay right
   * after) they come from its account, with no extra Face ID; otherwise the spending key comes out
   * of the Keychain behind Face ID, and the wallet makes it again if the Keychain lost it.
   */
  const spendingKeys = useCallback(
    async (total: bigint, openWallet: boolean): Promise<StealthKeys> => {
      const { wallet: w, saved: view } = live.current
      const profile = w.profile
      if (!profile) throw new Error('Open your wallet first.')
      if (sessionOpen() || openWallet || !view) return receivingKeys(profile.address, w.signMessage)
      const spending = await readReceivingSpendKey(
        profile.address,
        `Move ${formatUsd(total)} into your balance`,
      )
      if (spending) {
        const keys = {
          spendingPrivateKey: spending,
          viewingPrivateKey: viewFromKey(view.view).viewingPrivateKey,
        }
        if (stealthMetaAddress(keys) === view.meta) return keys
      }
      return receivingKeys(profile.address, w.signMessage)
    },
    [],
  )

  /** Remembers what the private dollars hold now, here and on the phone. */
  const keepReceipts = useCallback(async (next: PrivateReceipt[]) => {
    const { wallet: w, saved: view } = live.current
    setReceipts(next)
    live.current.receipts = next
    if (!w.profile || !view) return
    const state = await loadScan(w.profile.address, view.meta)
    await saveScan({ ...state, receipts: next })
  }, [])

  /**
   * Moves these private payments into the wallet: each address signs its own move of everything it
   * holds, and Kova covers the fee. What each holds afterwards is remembered, and the balance read.
   */
  const moveSome = useCallback(
    async (
      pending: PrivateReceipt[],
      openWallet: boolean,
      onProgress: (progress: MoveProgress) => void,
    ) => {
      const w = live.current.wallet
      const profile = w.profile
      if (!profile) throw new Error('Open your wallet first.')
      const keys = await spendingKeys(waitingIn(pending).amount, openWallet)
      const view = live.current.saved
      if (view && stealthMetaAddress(keys) !== view.meta)
        throw new Error('These keys don’t open your private dollars. Nothing moved.')
      const outcome = await moveInCore({ keys, receipts: pending, to: profile.address, onProgress })
      const movedBy = new Map(outcome.moved.map((m) => [m.stealthAddress.toLowerCase(), m.txHash]))
      await keepReceipts(
        live.current.receipts.map((r) => {
          const key = r.stealthAddress.toLowerCase()
          const tx = movedBy.get(key)
          const held = outcome.held.get(key)
          return tx
            ? { ...r, held: '0', movedTx: tx }
            : held !== undefined
              ? { ...r, held: held.toString() }
              : r
        }),
      )
      await w.refresh()
      return outcome
    },
    [spendingKeys, keepReceipts],
  )

  const moveIn = useCallback(
    async (options: { openWallet?: boolean } = {}) => {
      const pending = live.current.receipts.filter((r) => BigInt(r.held) > 0n)
      if (!live.current.wallet.profile || !pending.length || live.current.busy) return null
      live.current.busy = true
      setProblem(null)
      setMoved(null)
      setProgress({ step: 'unlocking', done: 0, total: pending.length })
      try {
        const outcome = await moveSome(pending, options.openWallet ?? false, setProgress)
        setMoved({ ...outcome, at: Date.now() })
        void Haptics.notificationAsync(
          outcome.count && !outcome.failed
            ? Haptics.NotificationFeedbackType.Success
            : Haptics.NotificationFeedbackType.Warning,
        )
        return outcome
      } catch (error) {
        setProblem({
          during: 'move',
          text: /cancel/i.test(words(error)) ? 'Cancelled. Nothing moved.' : words(error),
        })
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
        return null
      } finally {
        live.current.busy = false
        setProgress(null)
      }
    },
    [moveSome],
  )

  const moveInFor = useCallback(
    async (shortfall: bigint) => {
      const { wallet: w, saved: view } = live.current
      if (!w.profile || !view) throw new Error('Set up private dollars on this phone first.')
      // Let a look that's running finish, then hold the addresses until the move is done.
      if (inflight.current) await inflight.current
      if (live.current.busy)
        throw new Error('Your private dollars are busy for a moment. Try again.')
      live.current.busy = true
      setProblem(null)
      setSpending({ step: 'unlocking' })
      try {
        // What each address holds now, read from Monad, then the fewest that make up the difference.
        const funded = live.current.receipts.filter((r) => BigInt(r.held) > 0n)
        const held = await readHeld(funded)
        const fresh = funded.map((r) => {
          const now = held.get(r.stealthAddress.toLowerCase())
          return now === undefined ? r : { ...r, held: now.toString() }
        })
        const plan = planSpend(fresh, shortfall)
        if (!plan)
          throw new Error(
            'Your private dollars don’t make up the difference any more. Nothing was paid.',
          )
        const move = 'from' in plan ? [plan.from] : plan.gather
        setSpending({ step: 'moving', amount: waitingIn(move).amount })
        const outcome = await moveSome(move, true, () => {})
        if (outcome.amount < shortfall)
          throw new Error(
            outcome.count
              ? `Only ${formatUsd(outcome.amount)} moved into your balance just now. Nothing was paid; try again.`
              : (outcome.reason ??
                  'Your private dollars didn’t move just now. Nothing was paid; try again.'),
          )
        return outcome
      } catch (error) {
        const text = /cancel/i.test(words(error)) ? 'Cancelled. Nothing was paid.' : words(error)
        setProblem({ during: 'spend', text })
        throw new Error(text)
      } finally {
        live.current.busy = false
        setSpending(null)
      }
    },
    [moveSome],
  )

  const spendFrom = useCallback(
    async <T,>(amount: bigint, pay: (account: LocalAccount) => Promise<T>): Promise<T> => {
      const { wallet: w, saved: view } = live.current
      const profile = w.profile
      if (!profile || !view) throw new Error('Set up private dollars on this phone first.')
      // Let a look that's running finish, then hold the addresses until the payment is done.
      if (inflight.current) await inflight.current
      if (live.current.busy)
        throw new Error('Your private dollars are busy for a moment. Try again.')
      live.current.busy = true
      setProblem(null)
      setSpending({ step: 'unlocking' })
      try {
        // The wallet opens once: its account makes the keys, and vouches for a gathering.
        const keys = await receivingKeys(profile.address, w.signMessage)
        if (stealthMetaAddress(keys) !== view.meta)
          throw new Error('These keys don’t open your private dollars. Nothing was paid.')
        // What each address holds now, read from Monad.
        let receipts = live.current.receipts
        const held = await readHeld(receipts.filter((r) => BigInt(r.held) > 0n))
        receipts = receipts.map((r) => {
          const now = held.get(r.stealthAddress.toLowerCase())
          return now === undefined ? r : { ...r, held: now.toString() }
        })
        const plan = planSpend(receipts, amount)
        if (!plan)
          throw new Error('Your private dollars don’t cover this any more. Nothing was paid.')
        let from: PrivateReceipt
        if ('from' in plan) from = plan.from
        else {
          setSpending({ step: 'gathering', done: 0, total: plan.gather.length })
          const gathered = await gather({
            keys,
            meta: view.meta,
            sources: plan.gather,
            me: profile.address,
            name: profile.name || null,
            sign: w.signMessage,
            onProgress: (done, total) => setSpending({ step: 'gathering', done, total }),
          })
          const emptied = new Set(gathered.moved.map((m) => m.from.toLowerCase()))
          receipts = [
            gathered.receipt,
            ...receipts.map((r) =>
              emptied.has(r.stealthAddress.toLowerCase()) ? { ...r, held: '0' } : r,
            ),
          ]
          await keepReceipts(receipts)
          from = gathered.receipt
        }
        setSpending({ step: 'paying' })
        const result = await pay(oneTimeAccount(keys, from))
        // The change stays at that address, still private.
        const left = await getBalance(from.stealthAddress).catch(() => BigInt(from.held) - amount)
        await keepReceipts(
          receipts.map((r) =>
            r.stealthAddress === from.stealthAddress
              ? { ...r, held: (left < 0n ? 0n : left).toString() }
              : r,
          ),
        )
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        return result
      } catch (error) {
        const text = /cancel/i.test(words(error)) ? 'Cancelled. Nothing was paid.' : words(error)
        setProblem({ during: 'spend', text })
        throw new Error(text)
      } finally {
        live.current.busy = false
        setSpending(null)
      }
    },
    [keepReceipts],
  )

  /** The router's way: from the balance, from private dollars, or the balance once just enough moved in first. */
  const pay = useCallback(
    async <T,>(route: Route, amount: bigint, ways: PayWays<T>): Promise<T> => {
      if (route.from === 'private') return spendFrom(amount, ways.fromPrivate)
      if (route.from === 'top-up') await moveInFor(route.shortfall)
      return ways.fromBalance()
    },
    [spendFrom, moveInFor],
  )

  const { amount: waiting, count: waitingCount } = useMemo(() => waitingIn(receipts), [receipts])
  const byAddress = useMemo(
    () => new Map(receipts.map((r) => [r.stealthAddress.toLowerCase(), r])),
    [receipts],
  )
  // Only what this phone's keys can open: without them, the router knows of no private dollars.
  const holdings = useMemo(() => (saved ? holdingsOf(receipts) : []), [saved, receipts])

  const value: PrivateDollars = {
    keysHere: saved !== null,
    published,
    ready,
    receipts,
    waiting,
    waitingCount,
    working,
    progress,
    moved,
    problem,
    refresh,
    setUp,
    moveIn,
    clearMoved: () => setMoved(null),
    receiptAt: (oneTime) => (oneTime ? byAddress.get(oneTime.toLowerCase()) : undefined),
    spending,
    coverFor: (amount) => {
      if (!saved || amount <= 0n) return null
      const plan = planSpend(receipts, amount)
      return plan ? ('from' in plan ? 'single' : 'gather') : null
    },
    route: (input) => routePayment({ ...input, holdings }),
    pay,
    spendFrom,
    moveInFor,
    announcementAt: (oneTime) =>
      oneTime
        ? (announced[oneTime.toLowerCase()] ??
          byAddress.get(oneTime.toLowerCase())?.announceUrl ??
          null)
        : null,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
