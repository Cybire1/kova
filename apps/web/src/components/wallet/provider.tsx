'use client'

import type { PasskeyCredentialMetadata } from '@category-labs/mera'
import type { NetworkId } from '@kova/monad'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { type Address, getAddress, isAddress, isAddressEqual, type LocalAccount } from 'viem'
import {
  createKovaPasskey,
  openKovaPasskey,
  openSigningSession,
  passkeyProblem,
} from '@/lib/passkey'
import { type ViewKey, viewOf } from '@/lib/takings'
import { openVault, sealAndUpload, type VaultContents } from '@/lib/vault'
import { countNewWallet } from '@/lib/try-count'
import {
  balanceOf,
  type ChargeToPay,
  addTestDollars as fetchTestDollars,
  type IndexedTransfer,
  type Moved,
  payCharge,
  sendMoney,
  transfersAfter,
} from '@/lib/wallet/chain'
import { type KeptLink, keptLinks, linksFrom } from '@/lib/wallet/dollar-links'
import {
  type DisplayCurrency,
  guessCurrency,
  isDisplayCurrency,
  type LiveRates,
  type Rates,
  ratesFrom,
} from '@/lib/wallet/money'
import { fetchNoteKey, noteKeys, openNote, publishNoteKey } from '@/lib/wallet/notes'
import {
  announcedSince,
  emptyLedger,
  fetchPrivateKey,
  holdings,
  lookForPayments,
  type MovedIn,
  moveIn as moveInPayments,
  oneTimeAddress,
  type PrivateLedger,
  privateKeys,
  publishPrivateKey,
  readLedger,
  senderOf,
  writeLedger,
} from '@/lib/wallet/private'
import {
  endSession,
  onSessionChange,
  sessionAccount,
  spend,
  startSession,
} from '@/lib/wallet/session'

/**
 * Kova Pay on the web: your wallet, from your passkey, the one the Kova app uses.
 *
 * This is the app's wallet (apps/mobile src/lib/wallet.tsx) for a browser. Nothing secret is kept:
 * the browser remembers only who you are (address, name, currency, which passkey) so your balance
 * and history show without a prompt. Moving money asks the passkey, and then a signing session
 * approves small amounts for a few minutes, in memory only. Your history is Kova's index of
 * Monad, so it's the same on every device; names and notes you add are sealed in your vault.
 */

export interface Profile {
  address: Address
  name: string
  currency: DisplayCurrency
  passkey: PasskeyCredentialMetadata
  createdAt: number
}

export type EntryKind = 'paid' | 'sent' | 'received' | 'added'

export interface Entry {
  id: string
  kind: EntryKind
  /** Base units (6 decimals). */
  amount: string
  name: string
  detail: string
  /** The other side: who you paid, or who paid you. */
  address?: string
  txHash: string
  explorer?: string
  /** How long a payment made here took, when this browser made it. */
  ms?: number
  at: number
  /** `detail` is a private note: readable by both of you, or (they had no note key) by you alone. */
  private?: 'both' | 'you'
  /** A private note this browser can't open until the passkey is used (the key lives in memory). */
  locked?: boolean
  /** Money into or out of one of your links (Send as a link), not a person. */
  link?: boolean
  /**
   * Sent or received privately: the one-time address it went to, which only the recipient's keys
   * can tell is theirs. `address` is still the person, when known.
   */
  oneTime?: string
  /** Received privately and still at its one-time address: Move in brings it to the balance. */
  waiting?: boolean
  /** The move that brought a private payment into the wallet. */
  movedIn?: { txHash: string; explorer: string; at: number }
}

export interface ShopToday {
  name: string
  today: { total: string; count: number } | null
}

export interface Contact {
  address: string
  name: string
  currency?: DisplayCurrency
}

/** What this browser adds to a payment it made: who it was for and what for. Chain history has neither. */
interface Note {
  name: string
  detail: string
  ms: number
  kind: 'paid' | 'sent'
  to: string
  amount: string
  at: number
  explorer: string
  private?: 'both' | 'you'
  /** A private send: the one-time address it went to (`to` is the person). */
  oneTime?: string
}

const PROFILE = 'kova.web.profile.v1'
const HIDE = 'kova.web.hideBalance.v1'
const notesKey = (address: string) => `kova.web.notes.v1.${address.toLowerCase()}`
const shopKey = (address: string) => `kova.web.shop.v1.${address.toLowerCase()}`

const read = <T,>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode or full storage: this browser just won't remember.
  }
}

export const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`
export const isUnnamed = (name: string) => name.startsWith('0x')
const ZERO = '0x0000000000000000000000000000000000000000'

interface WalletValue {
  network: NetworkId
  /** The shop this browser is signed in to, with today's takings: the shop is a part of the wallet. */
  shop: ShopToday | null
  /** The shop this wallet opened or signed in to here before, when it isn't signed in right now. */
  knownShop: string | null
  rememberShop: (name: string) => void
  status: 'loading' | 'none' | 'ready'
  profile: Profile | null
  balance: bigint | null
  activity: Entry[]
  contacts: Contact[]
  rates: Rates
  liveRates: LiveRates | null
  hideBalance: boolean
  setHideBalance: (hide: boolean) => void
  /** A new passkey and wallet, as "Create my wallet" in the app. */
  create: (name: string, currency: DisplayCurrency) => Promise<void>
  /** The wallet an existing passkey holds: the app's, or one made here before. */
  open: () => Promise<{ named: boolean }>
  /** Sends to a person; `privately` sends to a one-time address only they can tell is theirs. */
  send: (
    to: Contact,
    amount: bigint,
    note?: string,
    options?: { privately?: boolean },
  ) => Promise<Moved>
  /** Sends a link's dollars to its one-time address (Send as a link). */
  fundLink: (link: KeptLink) => Promise<Moved>
  /** Whether a private note to them can be read by them (they've published a note key). */
  noteReaches: (address: string) => Promise<boolean>
  /** Opens private notes after a reload: the note key lives in memory, so it takes the passkey. */
  readNotes: () => Promise<void>
  /** Whether they can be sent to privately: they've published a key their own wallet signed. */
  privateReaches: (address: string) => Promise<boolean>
  /** Whether anyone can send to this wallet privately (its key is published); null until known. */
  privateReceiving: boolean | null
  /** Private dollars this wallet's keys found, still at their one-time addresses. */
  privateBalance: bigint
  /** How many private payments are waiting to move in. */
  privateWaiting: number
  /** The keys are open in this tab, so new private payments are found as they land. */
  privateOpen: boolean
  /** Kova announced private payments this wallet's keys haven't looked through yet. */
  privateUnchecked: boolean
  /** Opens the keys (with the passkey if the wallet is locked) and looks for private payments. */
  checkPrivate: () => Promise<void>
  /** One pass of looking after private payments: new ones, who sent them, what they still hold. */
  tickPrivate: () => Promise<void>
  /** Brings every private payment into the wallet's balance. */
  moveIn: () => Promise<MovedIn>
  /** A move in under way. */
  movingIn: { done: number; total: number } | null
  payCheckout: (charge: ChargeToPay) => Promise<Moved>
  addTestDollars: () => Promise<bigint>
  /** Signs a message with this wallet, such as Kova's shop sign-in (EIP-4361). Moves no money. */
  signMessage: (message: string) => Promise<`0x${string}`>
  /** Locks the wallet now: the next payment asks for the passkey. */
  lock: () => void
  setName: (name: string) => void
  setCurrency: (currency: DisplayCurrency) => void
  renameContact: (address: string, name: string) => void
  signOut: () => void
  refresh: () => Promise<void>
}

/**
 * A new passkey and the wallet it holds, remembered on this browser with its session open. Used
 * by "Create my wallet", and by a guest keeping their dollars after paying with email or Google
 * (components/keep-in-kova.tsx), where no WalletProvider is mounted: /wallet picks it up after.
 */
export async function makeWallet(name: string, currency: DisplayCurrency) {
  const clean = name.trim()
  const made = await createKovaPasskey(clean).catch((error) => {
    throw new Error(passkeyProblem(error))
  })
  const { session, account } = await openSigningSession(made.prfOutput)
  startSession(session, account)
  const profile: Profile = {
    address: account.address,
    name: clean,
    currency,
    passkey: made.credential,
    createdAt: Date.now(),
  }
  write(PROFILE, profile)
  return { profile, account, vaultSecret: made.vaultSecret }
}

/**
 * The wallet's first backup, its note key and its private-receiving key, for a wallet made outside
 * the WalletProvider.
 */
export function settleNewWallet(
  profile: Profile,
  account: LocalAccount,
  vaultSecret: Uint8Array | null,
) {
  void privateKeys(account)
    .then((keys) => publishPrivateKey(account, keys))
    .catch(() => {})
  if (!vaultSecret) return
  void sealAndUpload(vaultSecret, {
    v: 1,
    name: profile.name,
    currency: profile.currency,
    contacts: [],
  }).catch(() => {})
  void publishNoteKey(account, vaultSecret).catch(() => {})
}

const WalletContext = createContext<WalletValue | null>(null)

export function useWallet(): WalletValue {
  const value = useContext(WalletContext)
  if (!value) throw new Error('useWallet needs a WalletProvider')
  return value
}

export function WalletProvider({
  network,
  shop,
  initialRates,
  children,
}: {
  network: NetworkId
  shop: ShopToday | null
  initialRates: LiveRates | null
  children: React.ReactNode
}) {
  const [status, setStatus] = useState<WalletValue['status']>('loading')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [balance, setBalance] = useState<bigint | null>(null)
  const [transfers, setTransfers] = useState<IndexedTransfer[]>([])
  const [notes, setNotes] = useState<Record<string, Note>>({})
  const [saved, setSaved] = useState<Contact[]>([])
  const [hideBalance, setHide] = useState(false)
  const [liveRates, setLiveRates] = useState<LiveRates | null>(initialRates)
  const [knownShop, setKnownShop] = useState<string | null>(null)
  const cursor = useRef('0')
  const vaultSecret = useRef<Uint8Array | null>(null)
  const vaultDirty = useRef(false)
  const [noteSecret, setNoteSecret] = useState<Uint8Array | null>(null)
  /** The one-time addresses of links this wallet sent: money to and from them is a link, not a person. */
  const [linkAddresses, setLinkAddresses] = useState<Set<string>>(() => new Set())
  /** The wallet on screen, for work that finishes after it may have changed. */
  const current = useRef<string | null>(null)
  current.current = profile?.address ?? null
  /**
   * The private-receiving view key, for the wallet it was made for: it finds private payments and
   * can move none. In memory only, made again from the wallet whenever it opens.
   */
  const [privateView, setPrivateView] = useState<{ address: string; view: ViewKey } | null>(null)
  const making = useRef<string | null>(null)
  /** Whether the wallet's private-receiving key is published, once known. */
  const [receiving, setReceiving] = useState<{ address: string; on: boolean } | null>(null)
  /** The private payments this browser found for the wallet, and how far through Kova's feed it got. */
  const [ledger, setLedger] = useState<PrivateLedger>(emptyLedger)
  const ledgerRef = useRef(ledger)
  /** What each found one-time address holds now, as Monad last said. */
  const [held, setHeld] = useState<Map<string, bigint>>(() => new Map())
  const heldRef = useRef(held)
  const [unchecked, setUnchecked] = useState(false)
  const [movingIn, setMovingIn] = useState<{ done: number; total: number } | null>(null)
  const transfersRef = useRef(transfers)
  transfersRef.current = transfers
  const lastLooks = useRef({ held: 0, feed: 0 })
  const scanning = useRef(false)

  /** The passkey handed over the vault secret: keep it (in memory), open notes, publish the note key. */
  const takeVault = useCallback((secret: Uint8Array, account: LocalAccount) => {
    vaultSecret.current = secret
    setNoteSecret(noteKeys(secret).secretKey)
    void publishNoteKey(account, secret).catch(() => {})
  }, [])

  // Who you are on this browser, if you've opened your wallet here before.
  useEffect(() => {
    const stored = read<Profile>(PROFILE)
    if (stored && isAddress(stored.address) && isDisplayCurrency(stored.currency)) {
      setProfile(stored)
      setNotes(read<Record<string, Note>>(notesKey(stored.address)) ?? {})
      setKnownShop(read<string>(shopKey(stored.address)))
      setStatus('ready')
    } else setStatus('none')
    setHide(read<boolean>(HIDE) ?? false)
  }, [])

  // Whenever the wallet opens (made here, the passkey, a payment approved), its private-receiving
  // keys come from it too, with no prompt: the view half stays for this tab, and Kova gets the
  // public key, signed, so anyone can send to it privately.
  useEffect(() => {
    const take = () => {
      const account = sessionAccount(0n)
      if (!account || making.current === account.address) return
      making.current = account.address
      void privateKeys(account)
        .then((keys) => {
          setPrivateView({ address: account.address, view: viewOf(keys) })
          return publishPrivateKey(account, keys).then(() =>
            setReceiving({ address: account.address, on: true }),
          )
        })
        .catch(() => {
          // The session ended part way, or Kova didn't answer: the next opening tries again.
          if (making.current === account.address) making.current = null
        })
    }
    take()
    return onSessionChange(take)
  }, [])

  const keepLedger = useCallback((wallet: string, next: PrivateLedger) => {
    if (!current.current || !isAddressEqual(getAddress(current.current), getAddress(wallet))) return
    ledgerRef.current = next
    setLedger(next)
    writeLedger(wallet, next)
  }, [])

  const keepHeld = useCallback((update: (held: Map<string, bigint>) => void) => {
    const next = new Map(heldRef.current)
    update(next)
    heldRef.current = next
    setHeld(next)
  }, [])

  // Each wallet's private payments, as this browser found them, and whether its key is published.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a different wallet has another ledger
  useEffect(() => {
    if (!profile) return
    const wallet = profile.address
    const stored = readLedger(wallet)
    ledgerRef.current = stored
    setLedger(stored)
    heldRef.current = new Map()
    setHeld(heldRef.current)
    setUnchecked(false)
    lastLooks.current = { held: 0, feed: 0 }
    void fetchPrivateKey(wallet).then((meta) => {
      if (current.current !== wallet) return
      // Published a moment ago by the opening wallet: an answer from before that doesn't undo it.
      setReceiving((known) =>
        known?.address === wallet && known.on ? known : { address: wallet, on: meta !== null },
      )
    })
  }, [profile?.address])

  const rates = useMemo(() => ratesFrom(liveRates), [liveRates])

  // Rates change every fifteen minutes at most.
  useEffect(() => {
    const load = () =>
      fetch('/api/rates', { cache: 'no-store' })
        .then((r) => (r.ok ? (r.json() as Promise<LiveRates>) : null))
        .then((r) => r && setLiveRates(r))
        .catch(() => {})
    const timer = setInterval(load, 15 * 60_000)
    return () => clearInterval(timer)
  }, [])

  const refreshBalance = useCallback(async () => {
    if (!profile) return
    const next = await balanceOf(network, profile.address).catch(() => null)
    if (next !== null) setBalance(next)
  }, [network, profile])

  /** New history since the last look, a page at a time until it's caught up. */
  const refreshActivity = useCallback(async () => {
    if (!profile) return
    for (let page = 0; page < 20; page++) {
      const batch = await transfersAfter(profile.address, cursor.current).catch(() => null)
      if (!batch) return
      if (batch.data.length) {
        setTransfers((current) => {
          const seen = new Set(current.map((t) => t.id))
          return [...current, ...batch.data.filter((t) => !seen.has(t.id))]
        })
      }
      cursor.current = batch.indexed_through
      if (!batch.has_more) return
    }
  }, [profile])

  const refresh = useCallback(async () => {
    await Promise.all([refreshBalance(), refreshActivity()])
  }, [refreshBalance, refreshActivity])

  // A fresh history for each wallet, then live: the balance every few seconds, arrivals as they land.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a different wallet starts history over; renaming yourself doesn't
  useEffect(() => {
    if (!profile) return
    cursor.current = '0'
    setTransfers([])
    setBalance(null)
    void refresh()
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const timer = setInterval(tick, 5_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [profile?.address])

  // Links made here and in the app: this browser's keys, and Kova's list of the wallet's links.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a different wallet reloads them
  useEffect(() => {
    if (!profile) return
    const load = () => {
      const here = Object.values(keptLinks()).map((l) => l.address.toLowerCase())
      setLinkAddresses((current) => new Set([...current, ...here]))
    }
    load()
    void linksFrom(profile.address)
      .then((links) =>
        setLinkAddresses(
          (current) => new Set([...current, ...links.map((l) => l.link_address.toLowerCase())]),
        ),
      )
      .catch(() => {})
    window.addEventListener('kova-links', load)
    return () => window.removeEventListener('kova-links', load)
  }, [profile?.address])

  const keepProfile = useCallback((next: Profile) => {
    setProfile(next)
    write(PROFILE, next)
  }, [])

  /** Seals who you are and your people, when the passkey has handed over the vault key. */
  const backUp = useCallback((next: VaultContents) => {
    const secret = vaultSecret.current
    if (!secret) {
      vaultDirty.current = true
      return
    }
    vaultDirty.current = false
    void sealAndUpload(secret, next).catch(() => {
      vaultDirty.current = true
    })
  }, [])

  const vaultContents = useCallback(
    (p: Profile, people: Contact[]): VaultContents => ({
      v: 1,
      name: p.name,
      currency: p.currency,
      contacts: people.map((c) => ({
        address: c.address,
        name: c.name,
        ...(c.currency ? { currency: c.currency } : {}),
      })),
    }),
    [],
  )

  const create = useCallback(
    async (name: string, currency: DisplayCurrency) => {
      const { profile: next, account, vaultSecret: secret } = await makeWallet(name, currency)
      if (secret) takeVault(secret, account)
      keepProfile(next)
      // Came by /try? Kova's public numbers count one more new wallet for where they came from.
      countNewWallet(next.address)
      setSaved([])
      setNotes({})
      setStatus('ready')
      backUp(vaultContents(next, []))
    },
    [backUp, keepProfile, takeVault, vaultContents],
  )

  const open = useCallback(async () => {
    const asserted = await openKovaPasskey().catch((error) => {
      throw new Error(passkeyProblem(error))
    })
    const { session, account } = await openSigningSession(asserted.prfOutput)
    startSession(session, account)
    vaultSecret.current = asserted.vaultSecret
    if (asserted.vaultSecret) takeVault(asserted.vaultSecret, account)
    // Who you are comes back from the vault this passkey sealed, in the app or here.
    const backup = asserted.vaultSecret
      ? await openVault(asserted.vaultSecret).catch(() => null)
      : null
    const people = (backup?.contacts ?? [])
      .filter((c) => isAddress(c.address))
      .map((c) => ({ ...c, currency: isDisplayCurrency(c.currency) ? c.currency : undefined }))
    const next: Profile = {
      address: account.address,
      name: backup?.name ?? '',
      currency: isDisplayCurrency(backup?.currency) ? backup.currency : guessCurrency(),
      passkey: asserted.credential,
      createdAt: Date.now(),
    }
    keepProfile(next)
    setSaved(people)
    setNotes(read<Record<string, Note>>(notesKey(account.address)) ?? {})
    setKnownShop(read<string>(shopKey(account.address)))
    setStatus('ready')
    return { named: Boolean(next.name) }
  }, [keepProfile, takeVault])

  /**
   * The account to approve `amount` with: the open session if it covers it, else the passkey
   * again. The passkey must open this same wallet; another passkey would be another wallet.
   */
  const unlock = useCallback(
    async (amount: bigint): Promise<LocalAccount> => {
      if (!profile) throw new Error('Open your wallet first.')
      const open = sessionAccount(amount)
      if (open) return open
      const asserted = await openKovaPasskey(profile.passkey).catch((error) => {
        throw new Error(passkeyProblem(error))
      })
      const { session, account } = await openSigningSession(asserted.prfOutput)
      if (account.address !== profile.address) {
        session.end()
        throw new Error(
          'That passkey opens a different Kova wallet. Choose the one for this wallet.',
        )
      }
      startSession(session, account)
      if (asserted.vaultSecret) {
        takeVault(asserted.vaultSecret, account)
        if (vaultDirty.current) backUp(vaultContents(profile, saved))
      }
      return account
    },
    [backUp, profile, saved, takeVault, vaultContents],
  )

  const noteReaches = useCallback(
    async (address: string) => (await fetchNoteKey(getAddress(address))) !== null,
    [],
  )

  const readNotes = useCallback(async () => {
    if (!profile) throw new Error('Open your wallet first.')
    const asserted = await openKovaPasskey(profile.passkey).catch((error) => {
      throw new Error(passkeyProblem(error))
    })
    const { session, account } = await openSigningSession(asserted.prfOutput)
    if (account.address !== profile.address) {
      session.end()
      throw new Error('That passkey opens a different Kova wallet. Choose the one for this wallet.')
    }
    startSession(session, account)
    if (!asserted.vaultSecret)
      throw new Error('This passkey can’t open private notes in this browser.')
    takeVault(asserted.vaultSecret, account)
  }, [profile, takeVault])

  /** The view key, if it was made for the wallet on screen. */
  const viewNow =
    privateView && profile && isAddressEqual(getAddress(privateView.address), profile.address)
      ? privateView.view
      : null

  /** Looks through Kova's feed since the last look, with `view`, for this wallet's private payments. */
  const lookWith = useCallback(
    async (view: ViewKey) => {
      const wallet = current.current
      if (!wallet || scanning.current) return
      scanning.current = true
      try {
        const me = wallet.toLowerCase()
        const sent = new Set(
          transfersRef.current
            .filter((t) => t.from.toLowerCase() === me)
            .map((t) => t.to.toLowerCase()),
        )
        const next = await lookForPayments(
          view,
          ledgerRef.current,
          sent,
          () => current.current !== wallet,
        )
        if (!next || current.current !== wallet) return
        if (next !== ledgerRef.current) keepLedger(wallet, next)
        lastLooks.current.feed = Date.now()
        setUnchecked(false)
      } finally {
        scanning.current = false
      }
    },
    [keepLedger],
  )

  /** Who sent each private payment, and their note, once Kova's index has it. */
  const fillSenders = useCallback(async () => {
    const wallet = current.current
    const missing = ledgerRef.current.found.filter((f) => f.from === undefined)
    if (!wallet || !missing.length) return
    const answers = await Promise.all(missing.map((f) => senderOf(f).catch(() => null)))
    const known = new Map<string, NonNullable<(typeof answers)[number]>>()
    for (const [i, f] of missing.entries()) {
      const answer = answers[i]
      if (answer) known.set(f.address.toLowerCase(), answer)
    }
    if (!known.size || current.current !== wallet) return
    const latest = ledgerRef.current
    keepLedger(wallet, {
      ...latest,
      found: latest.found.map((f) => ({ ...f, ...known.get(f.address.toLowerCase()) })),
    })
  }, [keepLedger])

  /** One-time addresses that hold nothing now: remembered, so they're never read again. */
  const markEmptied = useCallback(
    (wallet: string, addresses: Iterable<string>) => {
      const emptied = new Set([...addresses].map((a) => a.toLowerCase()))
      const latest = ledgerRef.current
      if (!latest.found.some((f) => !f.emptied && emptied.has(f.address.toLowerCase()))) return
      keepLedger(wallet, {
        ...latest,
        found: latest.found.map((f) =>
          emptied.has(f.address.toLowerCase()) ? { ...f, emptied: true } : f,
        ),
      })
    },
    [keepLedger],
  )

  /** What the found addresses hold now, read from Monad: all but the ones already moved in. */
  const refreshHeld = useCallback(async () => {
    const wallet = current.current
    const open = ledgerRef.current.found
      .filter((f) => !f.emptied && heldRef.current.get(f.address.toLowerCase()) !== 0n)
      .map((f) => f.address)
    if (!wallet || !open.length) return
    lastLooks.current.held = Date.now()
    const read = await holdings(network, open)
    if (current.current !== wallet) return
    keepHeld((held) => {
      for (const [address, value] of read) held.set(address, value)
    })
    // Empty, and Kova's index shows it moving into this wallet (here, or from the app): done with.
    const me = wallet.toLowerCase()
    const movedIn = new Set(
      transfersRef.current
        .filter((t) => t.to.toLowerCase() === me)
        .map((t) => t.from.toLowerCase()),
    )
    markEmptied(
      wallet,
      [...read].filter(([address, value]) => value === 0n && movedIn.has(address)).map(([a]) => a),
    )
  }, [keepHeld, markEmptied, network])

  const tickPrivate = useCallback(async () => {
    if (!current.current) return
    const now = Date.now()
    if (viewNow) await lookWith(viewNow).catch(() => {})
    else if (now - lastLooks.current.feed > 30_000) {
      // No keys in this tab: Kova's feed can still say whether there's anything new to look at.
      lastLooks.current.feed = now
      const wallet = current.current
      const fresh = await announcedSince(ledgerRef.current.cursor).catch(() => false)
      if (current.current === wallet) setUnchecked(fresh)
    }
    await fillSenders().catch(() => {})
    const unread = ledgerRef.current.found.some(
      (f) => !heldRef.current.has(f.address.toLowerCase()),
    )
    if (unread || now - lastLooks.current.held > 20_000) await refreshHeld().catch(() => {})
  }, [fillSenders, lookWith, refreshHeld, viewNow])

  const checkPrivate = useCallback(async () => {
    if (!profile) throw new Error('Open your wallet first.')
    const account = await unlock(0n)
    const keys = await privateKeys(account)
    const view = viewOf(keys)
    making.current = account.address
    setPrivateView({ address: account.address, view })
    void publishPrivateKey(account, keys)
      .then(() => setReceiving({ address: account.address, on: true }))
      .catch(() => {})
    await lookWith(view)
    await fillSenders().catch(() => {})
    await refreshHeld().catch(() => {})
  }, [fillSenders, lookWith, profile, refreshHeld, unlock])

  const privateReaches = useCallback(
    async (address: string) => (await fetchPrivateKey(getAddress(address))) !== null,
    [],
  )

  const moveIn = useCallback(async () => {
    if (!profile) throw new Error('Open your wallet first.')
    const wallet = profile.address
    const waiting = ledgerRef.current.found.filter(
      (f) => !f.emptied && heldRef.current.get(f.address.toLowerCase()) !== 0n,
    )
    if (!waiting.length) throw new Error('Nothing private is waiting to move in.')
    // The spending key comes from the open wallet: moving your own dollars in needs no limit.
    const account = await unlock(0n)
    const keys = await privateKeys(account)
    setMovingIn({ done: 0, total: waiting.length })
    try {
      const moved = await moveInPayments(network, keys, waiting, wallet, (done, total) =>
        setMovingIn({ done, total }),
      )
      if (current.current === wallet) {
        keepHeld((held) => {
          for (const address of moved.emptied) held.set(address, 0n)
        })
        markEmptied(wallet, moved.emptied)
      }
      // The balance first, so a payment waiting on these dollars can go on at once.
      await refreshBalance().catch(() => {})
      void refreshActivity()
      if (moved.count === 0 && moved.problem) throw new Error(moved.problem)
      return moved
    } finally {
      setMovingIn(null)
    }
  }, [keepHeld, markEmptied, network, profile, refreshActivity, refreshBalance, unlock])

  const remember = useCallback(
    (hash: string, note: Note) => {
      if (!profile) return
      setNotes((current) => {
        const next = { ...current, [hash.toLowerCase()]: note }
        write(notesKey(profile.address), next)
        return next
      })
    },
    [profile],
  )

  const rememberContact = useCallback(
    (person: Contact) => {
      if (!profile) return
      setSaved((current) => {
        const rest = current.filter((c) => c.address.toLowerCase() !== person.address.toLowerCase())
        const known = current.find((c) => c.address.toLowerCase() === person.address.toLowerCase())
        const next = [
          { ...known, ...person, name: isUnnamed(person.name) && known ? known.name : person.name },
          ...rest,
        ].slice(0, 50)
        backUp(vaultContents(profile, next))
        return next
      })
    },
    [backUp, profile, vaultContents],
  )

  const send = useCallback(
    async (to: Contact, amount: bigint, note?: string, options: { privately?: boolean } = {}) => {
      if (!profile) throw new Error('Open your wallet first.')
      const text = note?.trim()
      const person = getAddress(to.address)
      // Sealed for them and for you; if they have no note key yet, for you alone.
      const [account, theirs, meta] = await Promise.all([
        unlock(amount),
        text ? fetchNoteKey(person) : null,
        options.privately ? fetchPrivateKey(person) : null,
      ])
      // Privately only to a key their own wallet signed: never one Kova could have swapped in.
      if (options.privately && !meta)
        throw new Error(
          `Kova couldn’t confirm ${isUnnamed(to.name) ? 'their' : `${to.name.split(' ')[0]}’s`} private key. Turn off Send privately to send it the usual way.`,
        )
      const secret = vaultSecret.current
      const sealing =
        text && secret ? { text, mine: noteKeys(secret).publicKey, theirs } : undefined
      // A fresh one-time address only they can tell is theirs, and what they need to find it.
      const oneTime = meta ? oneTimeAddress(meta) : null
      const moved = await sendMoney(
        network,
        account,
        oneTime?.address ?? person,
        amount,
        sealing,
        oneTime?.announcement,
      )
      spend(amount)
      remember(moved.hash, {
        ...(sealing ? { private: sealing.theirs ? ('both' as const) : ('you' as const) } : {}),
        name: to.name,
        detail: text || (oneTime ? 'Sent privately' : 'Sent'),
        ms: moved.ms,
        kind: 'sent',
        to: to.address,
        amount: amount.toString(),
        at: Date.now(),
        explorer: moved.explorer,
        ...(oneTime ? { oneTime: oneTime.address } : {}),
      })
      if (!isUnnamed(to.name)) rememberContact(to)
      void refresh()
      return moved
    },
    [network, profile, refresh, remember, rememberContact, unlock],
  )

  const fundLink = useCallback(
    async (link: KeptLink) => {
      if (!profile) throw new Error('Open your wallet first.')
      const amount = BigInt(link.amount)
      const account = await unlock(amount)
      const moved = await sendMoney(network, account, link.address, amount)
      spend(amount)
      remember(moved.hash, {
        name: 'Link',
        detail: link.note || 'Sent as a link',
        ms: moved.ms,
        kind: 'sent',
        to: link.address,
        amount: amount.toString(),
        at: Date.now(),
        explorer: moved.explorer,
      })
      void refresh()
      return moved
    },
    [network, profile, refresh, remember, unlock],
  )

  const payCheckout = useCallback(
    async (charge: ChargeToPay) => {
      if (!profile) throw new Error('Open your wallet first.')
      const amount = BigInt(charge.amount_base)
      const account = await unlock(amount)
      const moved = await payCharge(network, account, charge)
      spend(amount)
      remember(moved.hash, {
        name: charge.order?.stall?.name ?? charge.merchant_name,
        detail: charge.reference ?? 'Scan to pay',
        ms: moved.ms,
        kind: 'paid',
        to: charge.pay_to,
        amount: charge.amount_base,
        at: Date.now(),
        explorer: moved.explorer,
      })
      void refresh()
      return moved
    },
    [network, profile, refresh, remember, unlock],
  )

  const addTestDollars = useCallback(async () => {
    if (!profile) throw new Error('Open your wallet first.')
    const next = await fetchTestDollars(network, profile.address)
    setBalance(next)
    void refreshActivity()
    return next
  }, [network, profile, refreshActivity])

  const signMessage = useCallback(
    async (message: string) => (await unlock(0n)).signMessage({ message }),
    [unlock],
  )

  const lock = useCallback(() => endSession(), [])

  const setName = useCallback(
    (name: string) => {
      if (!profile) return
      const next = { ...profile, name: name.trim() }
      keepProfile(next)
      backUp(vaultContents(next, saved))
    },
    [backUp, keepProfile, profile, saved, vaultContents],
  )

  const setCurrency = useCallback(
    (currency: DisplayCurrency) => {
      if (!profile) return
      const next = { ...profile, currency }
      keepProfile(next)
      backUp(vaultContents(next, saved))
    },
    [backUp, keepProfile, profile, saved, vaultContents],
  )

  const renameContact = useCallback(
    (address: string, name: string) => rememberContact({ address, name: name.trim() }),
    [rememberContact],
  )

  const signOut = useCallback(() => {
    endSession()
    vaultSecret.current = null
    making.current = null
    setPrivateView(null)
    setReceiving(null)
    try {
      localStorage.removeItem(PROFILE)
    } catch {}
    setProfile(null)
    setBalance(null)
    setTransfers([])
    setSaved([])
    setNotes({})
    setStatus('none')
  }, [])

  const rememberShop = useCallback(
    (name: string) => {
      if (!profile) return
      setKnownShop(name)
      write(shopKey(profile.address), name)
    },
    [profile],
  )

  const setHideBalance = useCallback((hide: boolean) => {
    setHide(hide)
    write(HIDE, hide)
  }, [])

  // The chain says what moved; this browser and your vault say who and what for.
  const nameFor = useCallback(
    (address: string) => {
      const known = saved.find((c) => c.address.toLowerCase() === address.toLowerCase())
      return known?.name && !isUnnamed(known.name) ? known.name : null
    },
    [saved],
  )

  // Notes opened once per transfer, not on every render.
  const opened = useRef(new Map<string, string | null>())
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new key means notes that failed may open now
  useEffect(() => {
    opened.current = new Map()
  }, [noteSecret])
  const openFor = useCallback(
    (
      t: Pick<IndexedTransfer, 'tx_hash' | 'note' | 'from' | 'to' | 'amount_base'>,
    ): string | null => {
      if (!t.note || !noteSecret) return null
      const hit = opened.current.get(t.tx_hash)
      if (hit !== undefined) return hit
      let text: string | null = null
      try {
        text = openNote(
          t.note.sealed,
          {
            from: getAddress(t.from),
            to: getAddress(t.to),
            value: BigInt(t.amount_base),
            nonce: t.note.auth_nonce,
          },
          noteSecret,
        )
      } catch {
        text = null
      }
      opened.current.set(t.tx_hash, text)
      return text
    },
    [noteSecret],
  )

  const activity = useMemo<Entry[]>(() => {
    if (!profile) return []
    const me = profile.address.toLowerCase()
    const entries: Entry[] = []
    const indexed = new Set<string>()
    // Private payments to you, found by your keys, at their one-time addresses.
    const found = new Set(ledger.found.map((f) => f.address.toLowerCase()))
    const sentPrivately = new Set(ledger.sentTo)
    /** Moves from a one-time address into the wallet: a private payment's last step, not a payment. */
    const movedIn = new Map<string, NonNullable<Entry['movedIn']>>()
    for (const t of transfers) {
      const out = t.from.toLowerCase() === me
      const incoming = t.to.toLowerCase() === me
      if (!out && !incoming) continue
      indexed.add(t.tx_hash.toLowerCase())
      if (incoming && found.has(t.from.toLowerCase())) {
        movedIn.set(t.from.toLowerCase(), {
          txHash: t.tx_hash,
          explorer: t.explorer_url,
          at: Date.parse(t.created_at),
        })
        continue
      }
      const note = notes[t.tx_hash.toLowerCase()]
      const at = note?.at ?? Date.parse(t.created_at)
      const sealed = note ? null : openFor(t)
      const locked = !note && !!t.note && !noteSecret
      const secret: Partial<Entry> = note?.private
        ? { private: note.private }
        : sealed !== null
          ? { private: t.note?.sealed.to ? 'both' : 'you' }
          : locked
            ? { locked: true }
            : {}
      const link = linkAddresses.has((out ? t.to : t.from).toLowerCase())
      // Sent privately: to a one-time address, whoever it's for (their name, if sent from here).
      const oneTime =
        note?.oneTime ?? (out && sentPrivately.has(t.to.toLowerCase()) ? t.to : undefined)
      if (out && oneTime) {
        entries.push({
          id: t.id,
          kind: 'sent',
          amount: t.amount_base,
          name: note ? note.name : '',
          detail: note?.detail ?? sealed ?? (locked ? 'Private note' : 'Sent privately'),
          ...secret,
          ...(note ? { address: note.to } : {}),
          oneTime: getAddress(oneTime),
          txHash: t.tx_hash,
          explorer: t.explorer_url,
          ...(note ? { ms: note.ms } : {}),
          at,
        })
      } else if (out) {
        const paid = t.kind === 'payment'
        entries.push({
          id: t.id,
          kind: paid ? 'paid' : 'sent',
          amount: t.amount_base,
          name:
            note?.name ?? t.shop?.name ?? (link ? 'Link' : null) ?? nameFor(t.to) ?? short(t.to),
          detail:
            note?.detail ??
            sealed ??
            (locked
              ? 'Private note'
              : (t.shop?.reference ?? (paid ? 'Scan to pay' : link ? 'Sent as a link' : 'Sent'))),
          ...secret,
          ...(link ? { link: true } : {}),
          address: t.to,
          txHash: t.tx_hash,
          explorer: t.explorer_url,
          ...(note ? { ms: note.ms } : {}),
          at,
        })
      } else {
        entries.push({
          id: t.id,
          kind: t.faucet ? 'added' : 'received',
          amount: t.amount_base,
          name: t.faucet
            ? 'Test dollars'
            : t.kind === 'refund'
              ? 'Refund'
              : link
                ? 'Your link'
                : (nameFor(t.from) ?? short(t.from)),
          detail:
            sealed ??
            (locked
              ? 'Private note'
              : t.faucet
                ? 'AUSD test faucet'
                : t.kind === 'refund'
                  ? 'Money back'
                  : link
                    ? 'Taken back'
                    : 'Arrived'),
          ...(sealed !== null ? { private: 'both' as const } : locked ? { locked: true } : {}),
          ...(link ? { link: true } : {}),
          address: t.from,
          txHash: t.tx_hash,
          explorer: t.explorer_url,
          at,
        })
      }
    }
    // A payment made a moment ago shows before Kova's index catches up with it.
    for (const [hash, note] of Object.entries(notes)) {
      if (indexed.has(hash)) continue
      entries.push({
        id: `${hash}:pending`,
        kind: note.kind,
        amount: note.amount,
        name: note.name,
        detail: note.detail,
        address: note.to,
        txHash: hash,
        explorer: note.explorer,
        ms: note.ms,
        at: note.at,
        ...(note.private ? { private: note.private } : {}),
        ...(linkAddresses.has(note.to.toLowerCase()) ? { link: true } : {}),
        ...(note.oneTime ? { oneTime: note.oneTime } : {}),
      })
    }
    // Paid to you privately: who from (Kova's index of the one-time address knows), their note,
    // and whether it's still there or moved in.
    for (const f of ledger.found) {
      const key = f.address.toLowerCase()
      const moved = movedIn.get(key)
      const holds = f.emptied ? 0n : held.get(key)
      const waiting = holds === undefined ? !moved : holds > 0n
      const sealed =
        f.note && f.from
          ? openFor({
              tx_hash: f.tx,
              note: f.note,
              from: f.from,
              to: f.address,
              amount_base: f.amount,
            })
          : null
      const locked = Boolean(f.note) && !noteSecret
      entries.push({
        id: `private:${key}`,
        kind: 'received',
        amount: f.amount,
        name: f.from ? (nameFor(f.from) ?? short(getAddress(f.from))) : '',
        detail: sealed ?? (locked ? 'Private note' : waiting ? 'Waiting to move in' : 'Moved in'),
        ...(sealed !== null ? { private: 'both' as const } : locked ? { locked: true } : {}),
        ...(f.from ? { address: getAddress(f.from) } : {}),
        oneTime: getAddress(f.address),
        waiting,
        ...(moved ? { movedIn: moved } : {}),
        txHash: f.tx,
        explorer: f.explorer,
        at: f.at,
      })
    }
    return entries.sort((a, b) => b.at - a.at)
  }, [held, ledger, linkAddresses, nameFor, noteSecret, notes, openFor, profile, transfers])

  /** Everyone you've paid or been paid by, plus the people you've named, most recent first. */
  const contacts = useMemo<Contact[]>(() => {
    const people = new Map<string, Contact>()
    for (const entry of activity) {
      if (
        (entry.kind !== 'sent' && entry.kind !== 'received') ||
        !entry.address ||
        entry.address.toLowerCase() === ZERO ||
        linkAddresses.has(entry.address.toLowerCase())
      )
        continue
      const key = entry.address.toLowerCase()
      // The name this browser kept with the payment until the vault opens with its own.
      if (!people.has(key))
        people.set(key, {
          address: getAddress(entry.address),
          name:
            nameFor(entry.address) ??
            (!entry.name || isUnnamed(entry.name) ? short(entry.address) : entry.name),
        })
    }
    for (const c of saved) {
      const key = c.address.toLowerCase()
      people.set(key, { ...people.get(key), ...c, address: getAddress(c.address) })
    }
    return [...people.values()]
  }, [activity, linkAddresses, nameFor, saved])

  /** What waits at one-time addresses: as Monad last said, or as announced until it has. */
  const privateBalance = useMemo(
    () =>
      activity.reduce(
        (sum, e) =>
          e.oneTime && e.kind === 'received' && e.waiting
            ? sum + (held.get(e.oneTime.toLowerCase()) ?? BigInt(e.amount))
            : sum,
        0n,
      ),
    [activity, held],
  )
  const privateWaiting = useMemo(
    () => activity.filter((e) => e.oneTime && e.kind === 'received' && e.waiting).length,
    [activity],
  )
  const privateReceiving =
    receiving && profile && isAddressEqual(getAddress(receiving.address), profile.address)
      ? receiving.on
      : null
  const privateOpen = viewNow !== null

  const value = useMemo<WalletValue>(
    () => ({
      network,
      shop,
      knownShop,
      rememberShop,
      status,
      profile,
      balance,
      activity,
      contacts,
      rates,
      liveRates,
      hideBalance,
      setHideBalance,
      create,
      open,
      send,
      fundLink,
      noteReaches,
      readNotes,
      privateReaches,
      privateReceiving,
      privateBalance,
      privateWaiting,
      privateOpen,
      privateUnchecked: unchecked && !privateOpen,
      checkPrivate,
      tickPrivate,
      moveIn,
      movingIn,
      payCheckout,
      addTestDollars,
      signMessage,
      lock,
      setName,
      setCurrency,
      renameContact,
      signOut,
      refresh,
    }),
    [
      network,
      shop,
      knownShop,
      rememberShop,
      status,
      profile,
      balance,
      activity,
      contacts,
      rates,
      liveRates,
      hideBalance,
      setHideBalance,
      create,
      open,
      send,
      fundLink,
      noteReaches,
      readNotes,
      privateReaches,
      privateReceiving,
      privateBalance,
      privateWaiting,
      privateOpen,
      unchecked,
      checkPrivate,
      tickPrivate,
      moveIn,
      movingIn,
      payCheckout,
      addTestDollars,
      signMessage,
      lock,
      setName,
      setCurrency,
      renameContact,
      signOut,
      refresh,
    ],
  )

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}
