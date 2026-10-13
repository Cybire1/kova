import { decodeOfflinePayment, type OfflineCheck, offlinePaymentId, type OfflinePayment, verifyOfflinePayment } from '@kova/monad'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { type Address, isAddressEqual } from 'viem'
import { network, settlementToken } from './config'
import { handIn, OFFLINE_MAX, offlineStatus, reachable } from './offline-core'
import {
  offlineEntryId,
  type OfflineItem,
  offlineItems,
  offlineReady,
  onOfflineChange,
  openOfflineStore,
  patchOffline,
  putOffline,
} from './offline-store'
import { load, save } from './storage'
import { type Contact, isUnnamed, useWallet } from './wallet'

export type { OfflineItem }

/** What a code someone showed this phone turned out to be. */
export type Accepted =
  /** A payment to this wallet, checked and kept in the inbox. */
  | { kind: 'mine'; item: OfflineItem }
  /** One this wallet signed itself. */
  | { kind: 'own'; item: OfflineItem | null; payment: OfflinePayment }
  /** A genuine payment, but to someone else. */
  | { kind: 'theirs'; payment: OfflinePayment }
  | { kind: 'invalid'; reason: Extract<OfflineCheck, { ok: false }>['reason'] | 'not-a-code' | 'other-network' | 'no-wallet'; payment: OfflinePayment | null }

/**
 * Paying and getting paid with no signal. Knows whether Kova can be reached; keeps this wallet's
 * offline payments (outbox and inbox); and once the phone is online, hands every waiting one to
 * Kova, whichever phone gets there first, and follows each until it settles on Monad or its week
 * runs out. Shared by Home, Send, the scanner, the code and arrival screens, and Activity.
 */
interface Offline {
  /** No connection to Kova (or development says so): payments go as codes. */
  offline: boolean
  /** Development only: offline on purpose, to test and film it with the network on. */
  forced: boolean
  /** Every offline payment on this phone, newest first. */
  items: OfflineItem[]
  /** Those still waiting to settle (or retrying), newest first. */
  waiting: OfflineItem[]
  /** Base units this wallet has promised in codes that haven't settled. */
  outWaiting: bigint
  /** Base units promised to this wallet in codes that haven't settled. */
  inWaiting: bigint
  /** The last known balance less what waits to settle from it: all a code can safely promise. */
  spendable: bigint | null
  item: (id: string | undefined) => OfflineItem | undefined
  /** Signs a payment to them with no network (Face ID), and keeps it in the outbox until it settles. */
  pay: (to: Contact, amount: bigint) => Promise<OfflineItem>
  /** A code someone showed this phone: checked with no network, and kept if it pays this wallet. */
  accept: (code: string) => Promise<Accepted>
  /** Development only: pretend there's no signal, or stop pretending. */
  force: (on: boolean) => Promise<void>
  /** Asks Kova whether it can be reached now, and settles what's waiting if so. */
  checkNow: () => Promise<boolean>
}

const Ctx = createContext<Offline | null>(null)

export function useOffline(): Offline {
  const value = useContext(Ctx)
  if (!value) throw new Error('useOffline must be used inside <OfflineProvider>')
  return value
}

const FORCED = 'kova.dev.offline'
/** How long a payment that didn't settle waits before this phone tries it again. */
const RETRY_MS = 20_000
/** How often the phone checks it can reach Kova: soon after losing it, calmly while it has it. */
const CHECK_OFFLINE_MS = 5_000
const CHECK_ONLINE_MS = 15_000
/** How often waiting payments are handed in while online. */
const SETTLE_MS = 8_000

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`
const open = (i: OfflineItem) => i.status === 'waiting' || i.status === 'failed'

export function OfflineProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet()
  const { profile, balance, contacts, signOffline, recordOffline, refresh } = wallet
  const me = profile?.address ?? null

  const [items, setItems] = useState<OfflineItem[]>(offlineItems())
  const [reach, setReach] = useState<boolean | null>(null)
  // Development's switch: null until read, so nothing is handed in before the phone knows whether
  // it's pretending to have no signal.
  const [forcedState, setForced] = useState<boolean | null>(__DEV__ ? null : false)
  const forced = forcedState === true
  const offline = forced || reach === false
  const touched = useRef(false)

  useEffect(() => onOfflineChange(() => setItems(offlineItems())), [])
  useEffect(() => {
    void openOfflineStore(me)
  }, [me])

  // Development: offline on purpose survives a relaunch, until a dev link turns it off.
  useEffect(() => {
    if (!__DEV__) return
    void load<boolean>(FORCED, false).then((on) => {
      if (!touched.current) setForced(on === true)
    })
  }, [])
  const force = useCallback(async (on: boolean) => {
    if (!__DEV__) return
    touched.current = true
    setForced(on)
    await save(FORCED, on)
  }, [])

  const check = useCallback(async () => {
    const ok = await reachable()
    setReach(ok)
    return ok
  }, [])

  // Whether Kova answers: on launch, on coming back to the app, and on a clock that runs faster
  // while it doesn't, so getting signal back is noticed in seconds.
  useEffect(() => {
    let stopped = false
    const tick = async () => {
      if (AppState.currentState !== 'active') return
      const ok = await reachable()
      if (!stopped) setReach(ok)
    }
    void tick()
    const id = setInterval(tick, reach === false ? CHECK_OFFLINE_MS : CHECK_ONLINE_MS)
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void tick()
    })
    return () => {
      stopped = true
      clearInterval(id)
      sub.remove()
    }
  }, [reach])

  const nameFor = useCallback(
    (address: Address) => {
      const saved = contacts.find((c) => isAddressEqual(c.address, address))?.name
      return saved && !isUnnamed(saved) ? saved : null
    },
    [contacts],
  )

  // The newest wallet functions, for the settling loop, which outlives a render.
  const latest = useRef({ recordOffline, refresh, nameFor })
  latest.current = { recordOffline, refresh, nameFor }

  /** It settled: into activity as a normal payment, and the balance looks again. */
  const settled = useCallback(async (item: OfflineItem, outcome: { txHash: `0x${string}`; ms?: number; by: 'me' | 'them' }) => {
    const entryId = offlineEntryId(item.id)
    await patchOffline(item.id, {
      status: 'settled',
      txHash: outcome.txHash,
      by: outcome.by,
      settledAt: item.settledAt ?? Date.now(),
      entryId,
      problem: null,
      ...(outcome.ms ? { ms: outcome.ms } : {}),
    })
    const other = item.direction === 'out' ? item.to : item.from
    await latest.current.recordOffline({
      id: entryId,
      kind: item.direction === 'out' ? 'sent' : 'received',
      amount: item.amount,
      name: latest.current.nameFor(other) ?? item.name,
      detail: 'Paid with a code',
      address: other,
      txHash: outcome.txHash,
      ...(outcome.ms ? { ms: outcome.ms } : {}),
      at: item.at,
      offline: true,
    })
    void latest.current.refresh()
  }, [])

  // Hands every waiting payment to Kova, one at a time (the relayer signs them in turn).
  const busy = useRef(false)
  const settle = useCallback(async () => {
    if (busy.current || offline || forcedState === null || !me) return
    busy.current = true
    try {
      for (const item of offlineItems()) {
        const now = Date.now()
        if (item.status === 'expired' || (item.status === 'settled' && item.txHash)) continue
        if (open(item) && item.validBefore * 1000 <= now) {
          await patchOffline(item.id, { status: 'expired' })
          continue
        }
        // Settled by the other phone a moment ago: its transaction comes once Kova's index has it.
        if (item.status === 'settled') {
          const status = await offlineStatus(item.from, item.nonce)
          if (status?.txHash) await settled(item, { txHash: status.txHash, by: item.by ?? 'them' })
          continue
        }
        // Tried and refused: again in 20 s, then less and less often, never more than ten minutes apart.
        if (item.problem && now - item.problem.at < Math.min(RETRY_MS * 2 ** Math.min(Math.max(item.tries - 1, 0), 5), 600_000)) continue
        const result = await handIn(item.code)
        if (__DEV__) console.log(`[offline] ${item.direction === 'out' ? 'outbox' : 'inbox'} ${item.id.slice(0, 10)} handed in: ${result.kind}${'txHash' in result ? ` ${result.txHash}` : ''}`)
        if (result.kind === 'settled') await settled(item, { txHash: result.txHash, ms: result.ms, by: 'me' })
        else if (result.kind === 'already') {
          // The other phone got there first. Kova says which transaction it was.
          const status = await offlineStatus(item.from, item.nonce)
          if (status?.txHash) await settled(item, { txHash: status.txHash, by: 'them' })
          else await patchOffline(item.id, { status: 'settled', by: 'them', settledAt: now, problem: null })
        } else if (result.kind === 'short')
          await patchOffline(item.id, { status: 'failed', problem: { kind: 'balance', text: result.text, at: now }, tries: item.tries + 1 })
        else if (result.kind === 'expired') await patchOffline(item.id, { status: 'expired' })
        else if (result.kind === 'unreachable') {
          setReach(false)
          break
        } else await patchOffline(item.id, { problem: { kind: 'other', text: result.text, at: now }, tries: item.tries + 1, ...(result.retry ? {} : { status: 'failed' as const }) })
      }
    } finally {
      busy.current = false
    }
  }, [offline, forcedState, me, settled])

  // Online: settle at once, whenever something new comes in, and on a clock for the ones retrying.
  const count = items.length
  useEffect(() => {
    if (offline || forcedState === null || !me) return
    void settle()
    const id = setInterval(() => {
      if (AppState.currentState === 'active') void settle()
    }, SETTLE_MS)
    return () => clearInterval(id)
  }, [offline, forcedState, me, count, settle])

  const pay = useCallback(
    async (to: Contact, amount: bigint) => {
      if (!me) throw new Error('No wallet on this phone')
      if (amount > OFFLINE_MAX) throw new Error('One payment code carries $100 at most.')
      // Never promise more than the last known balance holds beyond the codes still waiting.
      const promised = offlineItems()
        .filter((i) => i.direction === 'out' && open(i))
        .reduce((total, i) => total + BigInt(i.amount), 0n)
      if (balance === null || amount > balance - promised) throw new Error('That’s more than you can promise offline. Send less.')
      const { code, payment } = await signOffline(to, amount)
      const item: OfflineItem = {
        id: offlinePaymentId(payment),
        direction: 'out',
        code,
        from: payment.authorization.from,
        to: payment.authorization.to,
        amount: amount.toString(),
        nonce: payment.authorization.nonce,
        validBefore: Number(payment.authorization.validBefore),
        name: to.name,
        claimed: payment.name,
        at: Date.now(),
        status: 'waiting',
        problem: null,
        tries: 0,
      }
      await putOffline(item)
      if (__DEV__) console.log(`[offline] signed ${amount} base units to ${to.address} with no network: ${item.id} code ${code}`)
      return item
    },
    [me, balance, signOffline],
  )

  const accept = useCallback(
    async (code: string): Promise<Accepted> => {
      const payment = decodeOfflinePayment(code)
      if (!payment) return { kind: 'invalid', reason: 'not-a-code', payment: null }
      if (payment.chainId !== network.chainId || !isAddressEqual(payment.token, settlementToken.address))
        return { kind: 'invalid', reason: 'other-network', payment }
      const check = await verifyOfflinePayment(payment)
      if (!check.ok) return { kind: 'invalid', reason: check.reason, payment }
      if (!me) return { kind: 'invalid', reason: 'no-wallet', payment }
      await offlineReady()
      const id = offlinePaymentId(payment)
      if (isAddressEqual(payment.authorization.from, me)) return { kind: 'own', item: offlineItems().find((i) => i.id === id) ?? null, payment }
      if (!isAddressEqual(payment.authorization.to, me)) return { kind: 'theirs', payment }
      const kept = offlineItems().find((i) => i.id === id)
      if (kept) return { kind: 'mine', item: kept }
      const from = payment.authorization.from
      const item: OfflineItem = {
        id,
        direction: 'in',
        code,
        from,
        to: payment.authorization.to,
        amount: payment.authorization.value.toString(),
        nonce: payment.authorization.nonce,
        validBefore: Number(payment.authorization.validBefore),
        name: nameFor(from) ?? payment.name ?? short(from),
        claimed: payment.name,
        at: Date.now(),
        status: 'waiting',
        problem: null,
        tries: 0,
      }
      await putOffline(item)
      if (__DEV__) console.log(`[offline] accepted ${item.amount} base units from ${from}, checked with no network: ${id}`)
      return { kind: 'mine', item }
    },
    [me, nameFor],
  )

  const checkNow = useCallback(async () => {
    const ok = await check()
    if (ok && !forced) void settle()
    return ok
  }, [check, forced, settle])

  const value = useMemo<Offline>(() => {
    const waiting = items.filter(open).sort((a, b) => b.at - a.at)
    const sum = (direction: 'out' | 'in') => waiting.filter((i) => i.direction === direction).reduce((total, i) => total + BigInt(i.amount), 0n)
    const outWaiting = sum('out')
    const inWaiting = sum('in')
    return {
      offline,
      forced,
      items,
      waiting,
      outWaiting,
      inWaiting,
      spendable: balance === null ? null : balance > outWaiting ? balance - outWaiting : 0n,
      item: (id) => (id ? items.find((i) => i.id === id) : undefined),
      pay,
      accept,
      force,
      checkNow,
    }
  }, [items, offline, forced, balance, pay, accept, force, checkNow])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Who the other side of an offline payment is, by your name for them first. */
export function useOfflineName(item: OfflineItem | undefined): { name: string; first: string; claimedOnly: boolean } {
  const { contacts } = useWallet()
  if (!item) return { name: '', first: '', claimedOnly: false }
  const other = item.direction === 'out' ? item.to : item.from
  const saved = contacts.find((c) => isAddressEqual(c.address, other))?.name
  const name = saved && !isUnnamed(saved) ? saved : item.direction === 'in' ? (item.claimed ?? short(other)) : item.name
  return {
    name,
    first: isUnnamed(name) || name.startsWith('0x') ? name : (name.split(' ')[0] ?? name),
    // For a code from someone you haven't named, the name is only their word.
    claimedOnly: item.direction === 'in' && !(saved && !isUnnamed(saved)) && Boolean(item.claimed),
  }
}
