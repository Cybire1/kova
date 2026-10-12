import { type StealthKeys, stealthKeysMessage, stealthMetaAddress } from '@kova/monad'
import * as Haptics from 'expo-haptics'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { type Address, getAddress, isAddressEqual } from 'viem'
import { getOwnedShop, getPrivateTakings, type PrivateTakings, turnOffPrivateTakings, turnOnPrivateTakings } from './api'
import { formatUsd } from './money'
import { useStall } from './stall'
import {
  booksLink,
  findSales,
  keysFromSignature,
  type MoveOutcome,
  type MoveProgress,
  moveSales,
  type PrivateSale,
  viewFrom,
  waitingIn,
} from './takings-core'
import { foundFor, keepTakingsKeys, readSpendingKey, readTakingsView, rememberFound, type SavedView } from './takings-store'
import { useWallet } from './wallet'

/**
 * The shop's private takings, for the phone that owns the shop: whether they're on, the private
 * sales this phone has found with its own keys, and the one-tap move into the shop's wallet.
 * Shared by the Today screen, the shop's settings and Home, so all three tell the same story.
 */
interface Takings {
  /** This phone runs a shop its wallet owns. Private takings are for the owner alone. */
  owner: boolean
  /** Kova has answered at least once. */
  ready: boolean
  /** New charges pay one-time addresses. */
  enabled: boolean
  /** This phone holds this wallet's keys, so it can find and move private sales. */
  keysHere: boolean
  /** Kova pays new sales through keys this phone doesn't hold: turned on by another wallet. */
  otherKeys: boolean
  /** Private sales Kova lists that this phone can't open yet, for want of its keys. */
  unopened: number
  /** Found with this phone's viewing key, newest first. */
  sales: PrivateSale[]
  /** Base units waiting at one-time addresses. */
  waiting: bigint
  waitingCount: number
  /** The wallet the shop settles to, where moves go. */
  settlesTo: Address | null
  working: 'on' | 'off' | 'open' | null
  progress: MoveProgress | null
  /** The last move, until it's put away. */
  moved: (MoveOutcome & { at: number }) | null
  /** What went wrong last, and doing what, so each screen shows its own. */
  problem: { during: 'on' | 'off' | 'open' | 'move'; text: string } | null
  refresh: () => Promise<void>
  /** Signs once with the wallet to make the keys, and gives Kova the public half. */
  turnOn: () => Promise<boolean>
  /** New sales go straight to the wallet again. What's waiting stays the shop's to move. */
  turnOff: () => Promise<boolean>
  /** Makes this wallet's keys on this phone, for takings turned on elsewhere. */
  openHere: () => Promise<boolean>
  /** Moves every waiting sale into the shop's wallet. Face ID, then Kova pays the gas. */
  move: () => Promise<MoveOutcome | null>
  clearMoved: () => void
  /** The accountant's read-only link, once this phone has the keys. */
  booksLink: (shopName: string) => string | null
  /** Whether a charge was paid to one of the shop's private addresses. */
  isPrivate: (payTo: string) => boolean
}

const Ctx = createContext<Takings | null>(null)

export function useTakings(): Takings {
  const value = useContext(Ctx)
  if (!value) throw new Error('useTakings must be used inside <TakingsProvider>')
  return value
}

const words = (error: unknown) => (error instanceof Error && error.message ? error.message : 'That didn’t work. Try again.')

export function TakingsProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet()
  const stall = useStall()
  const me = wallet.profile?.address ?? null
  const shopId = stall.owned?.merchantId ?? null
  const owner = Boolean(me && shopId)

  const [saved, setSaved] = useState<SavedView | null>(null)
  const [reply, setReply] = useState<PrivateTakings | null>(null)
  const [sales, setSales] = useState<PrivateSale[]>([])
  const [settlesTo, setSettlesTo] = useState<Address | null>(null)
  const [working, setWorking] = useState<Takings['working']>(null)
  const [progress, setProgress] = useState<MoveProgress | null>(null)
  const [moved, setMoved] = useState<Takings['moved']>(null)
  const [problem, setProblem] = useState<Takings['problem']>(null)

  // Callbacks outlive the render that made them (a screen, or the dev link, holds on to one), so
  // they read the latest state from here.
  const live = useRef({ wallet, owner, shopId, saved, reply, sales, settlesTo, busy: false })
  live.current = { ...live.current, wallet, owner, shopId, saved, reply, sales, settlesTo }
  /** Bumped by every change, so an answer that left before it can't overwrite it. */
  const generation = useRef(0)
  const inflight = useRef<Promise<void> | null>(null)

  const keep = useCallback((next: SavedView | null) => {
    live.current.saved = next
    setSaved(next)
  }, [])

  const refresh = useCallback(() => {
    if (!live.current.owner) return Promise.resolve()
    if (inflight.current) return inflight.current
    const gen = generation.current
    const run: Promise<void> = (async () => {
      try {
        const [next, shop] = await Promise.all([getPrivateTakings(), live.current.settlesTo ? null : getOwnedShop().catch(() => null)])
        if (gen === generation.current && shop?.settlement_address) setSettlesTo(getAddress(shop.settlement_address))
        const keys = live.current.saved
        // Sales show as they're found, the waiting ones first, so a long history doesn't hold up the total.
        const show = (found: PrivateSale[]) => {
          if (gen !== generation.current) return
          setSales(found)
          setReply(next)
        }
        const found = keys ? await findSales(viewFrom(keys.view), next.receipts, await foundFor(keys.meta), show) : null
        if (keys && found?.found.length) await rememberFound(keys.meta, found.found)
        show(found?.sales ?? [])
      } catch (error) {
        // No signal, or Kova unreachable: keep showing what was there.
        if (__DEV__) console.log('[takings] refresh failed', words(error))
      }
    })().finally(() => {
      if (inflight.current === run) inflight.current = null
    })
    inflight.current = run
    return run
  }, [])

  /** After a change: anything already on its way is stale, so ask again. */
  const reload = useCallback(() => {
    generation.current += 1
    inflight.current = null
    return refresh()
  }, [refresh])

  // A different wallet or shop starts from nothing: its keys, if this phone has them, then Kova.
  useEffect(() => {
    generation.current += 1
    inflight.current = null
    keep(null)
    setReply(null)
    setSales([])
    setSettlesTo(null)
    setMoved(null)
    setProblem(null)
    if (!me || !shopId) return
    let current = true
    void readTakingsView(me, shopId).then((view) => {
      if (!current) return
      keep(view)
      void refresh()
    })
    return () => {
      current = false
    }
  }, [me, shopId, keep, refresh])

  useEffect(() => {
    if (!owner) return
    const sub = AppState.addEventListener('change', (state) => state === 'active' && void refresh())
    return () => sub.remove()
  }, [owner, refresh])

  /**
   * One signature from the wallet (the open session, or Face ID) of a message naming the shop makes
   * that shop's keys, the same every time, here and on the web; another shop gets its own.
   */
  const makeKeys = useCallback(async (): Promise<StealthKeys> => {
    const { wallet: signer, shopId: shop } = live.current
    const profile = signer.profile
    if (!profile || !shop) throw new Error('Open your wallet first.')
    const signature = await signer.signMessage(stealthKeysMessage(shop)).catch((error: unknown) => {
      throw new Error(/cancel/i.test(words(error)) ? 'Cancelled. Nothing changed.' : words(error))
    })
    const keys = keysFromSignature(signature)
    keep(await keepTakingsKeys(profile.address, shop, keys, profile.protected && !profile.demo))
    return keys
  }, [keep])

  /** The spending key, after Face ID; made again from the wallet if the Keychain lost it. */
  const spendingKeys = useCallback(
    async (total: bigint): Promise<StealthKeys> => {
      const { saved: view, shopId: shop, settlesTo, wallet: signer } = live.current
      if (view && shop) {
        const yours = !settlesTo || !signer.profile || isAddressEqual(settlesTo, signer.profile.address)
        const spending = await readSpendingKey(shop, `Move ${formatUsd(total)} to ${yours ? 'your wallet' : 'the shop’s wallet'}`)
        if (spending) {
          const keys = { spendingPrivateKey: spending, viewingPrivateKey: viewFrom(view.view).viewingPrivateKey }
          if (stealthMetaAddress(keys) === view.meta) return keys
        }
      }
      return makeKeys()
    },
    [makeKeys],
  )

  const act = useCallback(
    async (kind: NonNullable<Takings['working']>, run: () => Promise<void>) => {
      if (live.current.busy) return false
      live.current.busy = true
      setWorking(kind)
      setProblem(null)
      try {
        await run()
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        return true
      } catch (error) {
        setProblem({ during: kind, text: words(error) })
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
        return false
      } finally {
        live.current.busy = false
        setWorking(null)
      }
    },
    [],
  )

  const turnOn = useCallback(
    () =>
      act('on', async () => {
        const meta = stealthMetaAddress(await makeKeys())
        await turnOnPrivateTakings(meta)
        setReply((r) => ({ receipts: r?.receipts ?? [], enabled: true, meta_address: meta }))
        await reload()
      }),
    [act, makeKeys, reload],
  )

  const turnOff = useCallback(
    () =>
      act('off', async () => {
        await turnOffPrivateTakings()
        setReply((r) => ({ receipts: r?.receipts ?? [], enabled: false, meta_address: null }))
        await reload()
      }),
    [act, reload],
  )

  /** If Kova pays new sales through other keys, the card says so (otherKeys) and offers these. */
  const openHere = useCallback(
    () =>
      act('open', async () => {
        await makeKeys()
        await reload()
      }),
    [act, makeKeys, reload],
  )

  const move = useCallback(async () => {
    const pending = live.current.sales.filter((s) => !s.moved)
    if (!pending.length || live.current.busy) return null
    live.current.busy = true
    setProblem(null)
    setMoved(null)
    setProgress({ step: 'unlocking', done: 0, total: pending.length })
    try {
      const keys = await spendingKeys(waitingIn(pending).amount)
      const to = live.current.settlesTo ?? getAddress((await getOwnedShop()).settlement_address)
      const outcome = await moveSales({ keys, sales: pending, to, onProgress: setProgress })
      setMoved({ ...outcome, at: Date.now() })
      void Haptics.notificationAsync(outcome.count && !outcome.failed ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning)
      void live.current.wallet.refresh()
      await reload()
      return outcome
    } catch (error) {
      setProblem({ during: 'move', text: words(error) })
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      return null
    } finally {
      live.current.busy = false
      setProgress(null)
    }
  }, [spendingKeys, reload])

  const addresses = useMemo(() => new Set(sales.map((s) => s.stealth_address.toLowerCase())), [sales])
  const { amount: waiting, count: waitingCount } = useMemo(() => waitingIn(sales), [sales])
  const published = reply?.meta_address ?? null

  const value: Takings = {
    owner,
    ready: reply !== null,
    enabled: reply?.enabled ?? false,
    keysHere: saved !== null,
    otherKeys: Boolean(saved && published && published !== saved.meta),
    unopened: saved ? 0 : (reply?.receipts.filter((r) => !r.swept_tx).length ?? 0),
    sales,
    waiting,
    waitingCount,
    settlesTo,
    working,
    progress,
    moved,
    problem,
    refresh,
    turnOn,
    turnOff,
    openHere,
    move,
    clearMoved: () => setMoved(null),
    booksLink: (shopName) => (saved ? booksLink(saved.view, shopName) : null),
    isPrivate: (payTo) => addresses.has(payTo.toLowerCase()),
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
