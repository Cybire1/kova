import { type StealthKeys, stealthMetaAddress } from '@kova/monad'
import * as Haptics from 'expo-haptics'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { formatUsd } from './money'
import { readNote } from './notes'
import {
  advance,
  feedAfter,
  findMine,
  type MoveInOutcome,
  moveIn as moveInCore,
  type PrivateReceipt,
  readHeld,
  receiptOf,
  receivingKeys,
  transferInto,
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

/**
 * This wallet's private dollars: payments people sent it privately, each waiting at a one-time
 * address only this wallet's keys can open. The phone finds them in Kova's public feed with its
 * viewing key (Kova can't tell whose they are), shows them beside the balance, puts each in your
 * activity as it arrives, and moves them into the balance in one tap. Shared by Home, the Private
 * screen, receipts, and the pay and send flows that can move them in first.
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
  problem: { during: 'setup' | 'move'; text: string } | null
  refresh: () => Promise<void>
  /** Makes this wallet's keys on this phone (the open wallet, or Face ID) and gives Kova the public half. */
  setUp: () => Promise<boolean>
  /**
   * Moves every waiting private payment into the balance. `openWallet`: to pay right after, so the
   * wallet itself unlocks (one Face ID for both) rather than the private keys alone.
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

const words = (error: unknown) => (error instanceof Error && error.message ? error.message : 'That didn’t work. Try again.')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
/** How often the phone looks at Kova's feed while it's open. */
const EVERY_MS = 5000
/** How long a payment's sender is looked for in Kova's index, which trails Monad by seconds. */
const LOOKUP_FOR_MS = 10 * 60_000

/**
 * Who sent it and their note, from Kova's index of the chain. A payment found the moment it lands
 * gets a few tries, since the index trails Monad by a second or so.
 */
async function fillIn(receipt: PrivateReceipt, tries: number): Promise<PrivateReceipt> {
  for (let i = 0; i < tries; i += 1) {
    const transfer = await transferInto(receipt).catch(() => null)
    if (transfer) {
      const note = transfer.note
        ? await readNote(transfer.note, { from: transfer.from, to: receipt.stealthAddress, value: BigInt(receipt.amount) })
        : null
      return { ...receipt, from: transfer.from, note, sealed: Boolean(transfer.note) }
    }
    if (i < tries - 1) await sleep(800)
  }
  return receipt
}

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
      if (!owner || !keys) return
      // Kova takes the key quietly, and again a minute later if it couldn't be reached.
      if (live.current.published !== true && Date.now() - publishTried.current > 60_000) {
        publishTried.current = Date.now()
        void publishReceiving(keys).then((ok) => {
          if (gen === generation.current) setPublished(ok)
        })
      }

      const state = await loadScan(owner, keys.meta)
      if (state.cursor === null && state.since === null) state.since = await freshSince(owner, keys.meta)
      const items = await feedAfter(state.cursor)
      const mine = await findMine(viewFromKey(keys.view), items, { checked: new Set(state.checked), since: state.since })
      const next = advance(items, state.cursor)
      const known = new Set(state.receipts.map((r) => r.id))
      const added: PrivateReceipt[] = []
      for (const item of mine) if (!known.has(item.id)) added.push(await fillIn(receiptOf(item), 4))
      // A sender the index hadn't seen yet last time (for a while; after that it stays "Someone").
      const earlier = await Promise.all(state.receipts.map((r) => (r.from || Date.now() - r.at > LOOKUP_FOR_MS ? r : fillIn(r, 1))))
      // A move in made while this look was running stays recorded.
      const movedHere = new Map(live.current.receipts.filter((r) => r.movedTx).map((r) => [r.id, r.movedTx]))
      let all = [...added, ...earlier]
        .map((r) => (!r.movedTx && movedHere.has(r.id) ? { ...r, held: '0', movedTx: movedHere.get(r.id) } : r))
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
      if (gen !== generation.current) return
      // Into your activity first, then remembered: a payment is never remembered without being shown.
      // Whatever turns up once the first look is done is news: the newest one gets its arrival screen.
      const newest = added.reduce<PrivateReceipt | null>((n, r) => (!n || r.at > n.at ? r : n), null)
      for (const r of added) await w.receivedPrivately(r, state.caughtUp && r === newest)
      const updated = { ...state, cursor: next.cursor, checked: next.recent, caughtUp: true, receipts: all }
      if (JSON.stringify(updated) !== JSON.stringify(state)) await saveScan(updated)
      setReceipts((shown) => (JSON.stringify(shown) === JSON.stringify(all) ? shown : all))
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
      const view = await makeReceiving(profile.address, w.signMessage, profile.protected && !profile.demo)
      setSaved(view)
      live.current.saved = view
      const ok = await publishReceiving(view)
      setPublished(ok)
      if (!ok) throw new Error('Your keys are ready, but Kova couldn’t be reached to share them. It tries again by itself.')
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
  const spendingKeys = useCallback(async (total: bigint, openWallet: boolean): Promise<StealthKeys> => {
    const { wallet: w, saved: view } = live.current
    const profile = w.profile
    if (!profile) throw new Error('Open your wallet first.')
    if (sessionOpen() || openWallet || !view) return receivingKeys(profile.address, w.signMessage)
    const spending = await readReceivingSpendKey(profile.address, `Move ${formatUsd(total)} into your balance`)
    if (spending) {
      const keys = { spendingPrivateKey: spending, viewingPrivateKey: viewFromKey(view.view).viewingPrivateKey }
      if (stealthMetaAddress(keys) === view.meta) return keys
    }
    return receivingKeys(profile.address, w.signMessage)
  }, [])

  const moveIn = useCallback(
    async (options: { openWallet?: boolean } = {}) => {
      const w = live.current.wallet
      const profile = w.profile
      const pending = live.current.receipts.filter((r) => BigInt(r.held) > 0n)
      if (!profile || !pending.length || live.current.busy) return null
      live.current.busy = true
      setProblem(null)
      setMoved(null)
      setProgress({ step: 'unlocking', done: 0, total: pending.length })
      try {
        const keys = await spendingKeys(waitingIn(pending).amount, options.openWallet ?? false)
        const view = live.current.saved
        if (view && stealthMetaAddress(keys) !== view.meta) throw new Error('These keys don’t open your private payments. Nothing moved.')
        const outcome = await moveInCore({ keys, receipts: pending, to: profile.address, onProgress: setProgress })
        const movedBy = new Map(outcome.moved.map((m) => [m.stealthAddress.toLowerCase(), m.txHash]))
        const next = live.current.receipts.map((r) => {
          const key = r.stealthAddress.toLowerCase()
          const tx = movedBy.get(key)
          const held = outcome.held.get(key)
          return tx ? { ...r, held: '0', movedTx: tx } : held !== undefined ? { ...r, held: held.toString() } : r
        })
        setReceipts(next)
        live.current.receipts = next
        if (view) {
          const state = await loadScan(profile.address, view.meta)
          await saveScan({ ...state, receipts: next })
        }
        setMoved({ ...outcome, at: Date.now() })
        void Haptics.notificationAsync(
          outcome.count && !outcome.failed ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning,
        )
        await w.refresh()
        return outcome
      } catch (error) {
        setProblem({ during: 'move', text: /cancel/i.test(words(error)) ? 'Cancelled. Nothing moved.' : words(error) })
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
        return null
      } finally {
        live.current.busy = false
        setProgress(null)
      }
    },
    [spendingKeys],
  )

  const { amount: waiting, count: waitingCount } = useMemo(() => waitingIn(receipts), [receipts])
  const byAddress = useMemo(() => new Map(receipts.map((r) => [r.stealthAddress.toLowerCase(), r])), [receipts])

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
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
