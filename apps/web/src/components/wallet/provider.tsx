'use client'

import type { PasskeyCredentialMetadata } from '@category-labs/mera'
import {
  generateStealthAddress,
  type NetworkId,
  type StealthKeys,
  stealthMemoMessage,
  stealthMetaAddress,
} from '@kova/monad'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { type Address, getAddress, isAddress, isAddressEqual, type LocalAccount } from 'viem'
import { generatePrivateKey } from 'viem/accounts'
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
  type CashOutToPay,
  payCharge,
  payCashOut,
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
  type FoundPayment,
  fetchPrivateKey,
  gatherInto,
  holdings,
  lookForPayments,
  type MovedIn,
  moveIn as moveInPayments,
  oneTimeAccount,
  type PrivateLedger,
  planSpend,
  privateKeys,
  privatePayment,
  publishPrivateKey,
  readLedger,
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
  /** Who it's from rests on the payment's memo alone: shown as unconfirmed. */
  unconfirmed?: boolean
  /** Paid out of your private dollars, straight from a one-time address, not your balance. */
  fromPrivate?: boolean
  /** Spent privately (a shop, or a private send): what was left stays private as change. */
  used?: boolean
  /** ERC-5564's Announcement of this private payment on Monad, once Kova has posted it. */
  announced?: string
}

/** Where a payment comes from: your balance, or your private dollars at their one-time addresses. */
export type PayFrom = 'balance' | 'private'

/** How far paying from private dollars has got: gathering them into one address first, then paying. */
export type PrivateStep = 'gathering' | 'paying'

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
  /** Paid from private dollars. */
  fromPrivate?: boolean
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
  /**
   * Sends to a person; `privately` sends to a one-time address only they can tell is theirs, with
   * who it's from and the note sealed inside it. `from: 'private'` pays it from private dollars.
   */
  send: (
    to: Contact,
    amount: bigint,
    note?: string,
    options?: { privately?: boolean; from?: PayFrom; onStep?: (step: PrivateStep) => void },
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
  /** The most any one of those addresses holds: more than that, and they're gathered first. */
  privateLargest: bigint
  /** How many one-time addresses still hold private dollars. */
  privateWaiting: number
  /** The Announcement on Monad of a private payment you sent, by its one-time address. */
  announcedSend: (oneTime: string) => string | null
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
  /** Pays a shop's charge, from your balance or (`from: 'private'`) from private dollars. */
  /** Cashes out to a Nigerian bank: signs the quote's exact transfer to Kova's treasury, and Kova pays the naira. */
  cashOutNaira: (cashOut: CashOutToPay) => Promise<CashOutToPay>
  payCheckout: (
    charge: ChargeToPay,
    options?: { from?: PayFrom; onStep?: (step: PrivateStep) => void },
  ) => Promise<Moved>
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

/** Your people from the vault and from this page: this page's word wins for the same address. */
function mergePeople(vault: Contact[], here: Contact[]): Contact[] {
  const seen = new Set(here.map((c) => c.address.toLowerCase()))
  return [...here, ...vault.filter((c) => !seen.has(c.address.toLowerCase()))].slice(0, 50)
}

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
  /**
   * Whether this page has read the vault. After a reload it hasn't: your people are in the vault,
   * not here, and a backup made before reading it would replace them with only today's.
   */
  const vaultRead = useRef(false)
  const savedRef = useRef(saved)
  savedRef.current = saved
  const [noteSecret, setNoteSecret] = useState<Uint8Array | null>(null)
  /** The one-time addresses of links this wallet sent: money to and from them is a link, not a person. */
  const [linkAddresses, setLinkAddresses] = useState<Set<string>>(() => new Set())
  /** The wallet on screen, for work that finishes after it may have changed. */
  const current = useRef<string | null>(null)
  current.current = profile?.address ?? null
  const profileRef = useRef(profile)
  profileRef.current = profile
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
  const notesRef = useRef(notes)
  notesRef.current = notes
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
    // No key yet, or the vault not read yet on this page: saved once it has been (catchUpVault).
    if (!secret || !vaultRead.current) {
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

  /**
   * The passkey handed over the vault key on a page that hasn't read the vault (after a reload):
   * your people come back from it, joined with any added here since, and then anything waiting
   * is saved, so a backup adds to them rather than replacing them.
   */
  const catchUpVault = useCallback(
    async (secret: Uint8Array) => {
      const wallet = current.current
      if (!vaultRead.current) {
        const backup = await openVault(secret).catch(() => undefined)
        // Unreadable just now: nothing is saved over it, and the next opening tries again.
        if (backup === undefined || current.current !== wallet) return
        vaultRead.current = true
        const people = (backup?.contacts ?? [])
          .filter((c) => isAddress(c.address))
          .map((c) => ({ ...c, currency: isDisplayCurrency(c.currency) ? c.currency : undefined }))
        // Joined with whoever this page has now, even someone added while the vault was read.
        setSaved((here) => {
          const merged = mergePeople(people, here)
          const p = profileRef.current
          if (vaultDirty.current && p) backUp(vaultContents(p, merged))
          return merged
        })
        return
      }
      const p = profileRef.current
      if (vaultDirty.current && p) backUp(vaultContents(p, savedRef.current))
    },
    [backUp, vaultContents],
  )

  const create = useCallback(
    async (name: string, currency: DisplayCurrency) => {
      const { profile: next, account, vaultSecret: secret } = await makeWallet(name, currency)
      // A new wallet's vault is this page's to write: there's nothing in it to read first.
      vaultRead.current = true
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
      ? await openVault(asserted.vaultSecret).catch(() => undefined)
      : null
    vaultRead.current = backup !== undefined
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
        void catchUpVault(asserted.vaultSecret)
      }
      return account
    },
    [catchUpVault, profile, takeVault],
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
    void catchUpVault(asserted.vaultSecret)
  }, [catchUpVault, profile, takeVault])

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
        // Where this wallet sent money: Kova's index of it, and the private sends made here a
        // moment ago, before Kova has indexed them (their Announcement may come first).
        const sent = new Set([
          ...transfersRef.current
            .filter((t) => t.from.toLowerCase() === me)
            .map((t) => t.to.toLowerCase()),
          ...Object.values(notesRef.current).flatMap((n) =>
            n.oneTime ? [n.oneTime.toLowerCase()] : [],
          ),
        ])
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
    const unread = ledgerRef.current.found.some(
      (f) => !f.emptied && !heldRef.current.has(f.address.toLowerCase()),
    )
    if (unread || now - lastLooks.current.held > 20_000) await refreshHeld().catch(() => {})
  }, [lookWith, refreshHeld, viewNow])

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
    await refreshHeld().catch(() => {})
  }, [lookWith, profile, refreshHeld, unlock])

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

  /**
   * The one-time address to pay `amount` from, as its own account: the smallest that holds enough.
   * When no one address does, the fewest are gathered into a new address of yours first (its memo,
   * sealed for you, says it's your change, signed by your wallet), and that one pays.
   */
  const privateSource = useCallback(
    async (
      wallet: LocalAccount,
      keys: StealthKeys,
      amount: bigint,
      onStep?: (step: PrivateStep) => void,
    ): Promise<{ account: LocalAccount; source: FoundPayment }> => {
      const me = wallet.address
      const candidates = ledgerRef.current.found.filter((f) => !f.emptied)
      const read = await holdings(
        network,
        candidates.map((f) => f.address),
      )
      keepHeld((held) => {
        for (const [address, value] of read) held.set(address, value)
      })
      const plan = planSpend(
        candidates.map((payment) => ({
          payment,
          held: read.get(payment.address.toLowerCase()) ?? 0n,
        })),
        amount,
      )
      if (!plan) throw new Error('Your private dollars don’t cover this any more. Nothing moved.')
      if ('from' in plan) return { account: oneTimeAccount(keys, plan.from), source: plan.from }
      onStep?.('gathering')
      const mine = stealthMetaAddress(keys)
      const ephemeral = generatePrivateKey()
      const proof = await wallet.signMessage({
        message: stealthMemoMessage(generateStealthAddress(mine, ephemeral).stealthAddress),
      })
      const name = profileRef.current?.name
      const change = privatePayment(
        mine,
        { from: me, ...(name ? { name } : {}), kind: 'change', proof },
        ephemeral,
      )
      const gathered = await gatherInto(
        network,
        keys,
        plan.gather,
        change.address,
        change.announcement,
      )
      // The new address is yours from now on: in the ledger at once, before Kova's feed lists it.
      const found: FoundPayment = {
        id: '',
        address: change.address,
        ephemeral: change.announcement.ephemeral_public_key,
        amount: gathered.amount.toString(),
        tx: gathered.tx ?? '',
        explorer: gathered.explorer ?? '',
        at: Date.now(),
        from: me,
        proven: 'signed',
        kind: 'change',
        ...(name ? { name } : {}),
      }
      const moved = new Set(gathered.moved)
      const latest = ledgerRef.current
      keepLedger(me, {
        ...latest,
        found: [
          ...latest.found.map((f) =>
            moved.has(f.address.toLowerCase()) ? { ...f, emptied: true, used: true } : f,
          ),
          found,
        ],
      })
      keepHeld((held) => {
        for (const address of moved) held.set(address, 0n)
        held.set(change.address.toLowerCase(), gathered.amount)
      })
      if (gathered.amount < amount)
        throw new Error(
          'Not all your private dollars could be gathered just now. They’re safe and still private, together at one address of yours. Try again.',
        )
      return { account: oneTimeAccount(keys, found), source: found }
    },
    [keepHeld, keepLedger, network],
  )

  /** After paying from a one-time address: it's been used, and holds only the change, if any. */
  const spentFrom = useCallback(
    async (source: FoundPayment) => {
      const wallet = current.current
      if (!wallet) return
      const key = source.address.toLowerCase()
      const left = await balanceOf(network, getAddress(source.address)).catch(() => null)
      if (left !== null)
        keepHeld((held) => {
          held.set(key, left)
        })
      const latest = ledgerRef.current
      keepLedger(wallet, {
        ...latest,
        found: latest.found.map((f) =>
          f.address.toLowerCase() === key
            ? { ...f, used: true, ...(left === 0n ? { emptied: true } : {}) }
            : f,
        ),
      })
    },
    [keepHeld, keepLedger, network],
  )

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
    async (
      to: Contact,
      amount: bigint,
      note?: string,
      options: { privately?: boolean; from?: PayFrom; onStep?: (step: PrivateStep) => void } = {},
    ) => {
      if (!profile) throw new Error('Open your wallet first.')
      const text = note?.trim()
      const person = getAddress(to.address)
      const privately = options.privately === true
      const fromPrivate = privately && options.from === 'private'
      // A plain send's note is sealed for them and for you (for you alone if they have no note key);
      // a private send's note rides inside its sealed memo instead.
      const [account, theirs, meta] = await Promise.all([
        unlock(amount),
        text && !privately ? fetchNoteKey(person) : null,
        privately ? fetchPrivateKey(person) : null,
      ])
      // Privately only to a key their own wallet signed: never one Kova could have swapped in.
      if (privately && !meta)
        throw new Error(
          `Kova couldn’t confirm ${isUnnamed(to.name) ? 'their' : `${to.name.split(' ')[0]}’s`} private key. Turn off Send privately to send it the usual way.`,
        )
      const secret = vaultSecret.current
      const sealing =
        text && secret && !privately
          ? { text, mine: noteKeys(secret).publicKey, theirs }
          : undefined
      let moved: Moved
      let oneTime: Address | null = null
      if (meta) {
        // Who it's from, your name and your note, sealed so only they can open it: nobody has to
        // ask Kova who paid them.
        const memo = {
          from: profile.address,
          ...(profile.name ? { name: profile.name } : {}),
          ...(text ? { note: text } : {}),
          kind: 'send' as const,
        }
        if (fromPrivate) {
          const keys = await privateKeys(account)
          const { account: payer, source } = await privateSource(
            account,
            keys,
            amount,
            options.onStep,
          )
          // Monad shows the dollars leaving a one-time address, not you, so your wallet signs for
          // its new address inside the memo: they see it's really from you.
          const ephemeral = generatePrivateKey()
          const proof = await account.signMessage({
            message: stealthMemoMessage(generateStealthAddress(meta, ephemeral).stealthAddress),
          })
          const payment = privatePayment(meta, { ...memo, proof }, ephemeral)
          options.onStep?.('paying')
          moved = await sendMoney(
            network,
            payer,
            payment.address,
            amount,
            undefined,
            payment.announcement,
          )
          oneTime = payment.address
          void spentFrom(source)
        } else {
          const payment = privatePayment(meta, memo)
          moved = await sendMoney(
            network,
            account,
            payment.address,
            amount,
            undefined,
            payment.announcement,
          )
          oneTime = payment.address
        }
      } else moved = await sendMoney(network, account, person, amount, sealing)
      spend(amount)
      remember(moved.hash, {
        ...(sealing ? { private: sealing.theirs ? ('both' as const) : ('you' as const) } : {}),
        ...(oneTime && text ? { private: 'both' as const } : {}),
        name: to.name,
        detail: text || (oneTime ? 'Sent privately' : 'Sent'),
        ms: moved.ms,
        kind: 'sent',
        to: to.address,
        amount: amount.toString(),
        at: Date.now(),
        explorer: moved.explorer,
        ...(oneTime ? { oneTime } : {}),
        ...(fromPrivate ? { fromPrivate: true } : {}),
      })
      if (!isUnnamed(to.name)) rememberContact(to)
      void refresh()
      return moved
    },
    [network, privateSource, profile, refresh, remember, rememberContact, spentFrom, unlock],
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
    async (
      charge: ChargeToPay,
      options: { from?: PayFrom; onStep?: (step: PrivateStep) => void } = {},
    ) => {
      if (!profile) throw new Error('Open your wallet first.')
      const amount = BigInt(charge.amount_base)
      const account = await unlock(amount)
      const fromPrivate = options.from === 'private'
      let moved: Moved
      if (fromPrivate) {
        // The charge is paid exactly as from the wallet, signed by a one-time address instead:
        // the shop gets paid, and Monad can't tie the payment to you.
        const keys = await privateKeys(account)
        const { account: payer, source } = await privateSource(
          account,
          keys,
          amount,
          options.onStep,
        )
        options.onStep?.('paying')
        moved = await payCharge(network, payer, charge)
        void spentFrom(source)
      } else moved = await payCharge(network, account, charge)
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
        ...(fromPrivate ? { fromPrivate: true } : {}),
      })
      void refresh()
      return moved
    },
    [network, privateSource, profile, refresh, remember, spentFrom, unlock],
  )

  const cashOutNaira = useCallback(
    async (cashOut: CashOutToPay) => {
      if (!profile) throw new Error('Open your wallet first.')
      const amount = BigInt(cashOut.pay.value)
      const account = await unlock(amount)
      const paid = await payCashOut(network, account, cashOut)
      spend(amount)
      if (paid.tx_hash)
        remember(paid.tx_hash, {
          name: `Cash out to ${cashOut.bank_name}`,
          detail: `${cashOut.naira} to ····${cashOut.account_last4}`,
          ms: paid.ms,
          kind: 'sent',
          to: cashOut.pay.to ?? '',
          amount: cashOut.pay.value,
          at: Date.now(),
          explorer: paid.tx_url ?? '',
        })
      void refresh()
      return paid
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
    vaultRead.current = false
    vaultDirty.current = false
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
        const announced = ledger.announced[oneTime.toLowerCase()]
        entries.push({
          id: t.id,
          kind: 'sent',
          amount: t.amount_base,
          name: note ? note.name : '',
          detail: note?.detail ?? sealed ?? (locked ? 'Private note' : 'Sent privately'),
          ...secret,
          ...(note ? { address: note.to } : {}),
          oneTime: getAddress(oneTime),
          ...(announced ? { announced } : {}),
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
            note?.name ??
            t.shop?.name ??
            (link ? 'Link' : null) ??
            (t.kind === 'cashout' ? 'Cash out to naira' : null) ??
            nameFor(t.to) ??
            short(t.to),
          detail:
            note?.detail ??
            sealed ??
            (locked
              ? 'Private note'
              : (t.shop?.reference ??
                (paid ? 'Scan to pay' : link ? 'Sent as a link' : t.kind === 'cashout' ? 'To a Nigerian bank' : 'Sent'))),
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
          kind: t.faucet || t.naira === 'top_up' ? 'added' : 'received',
          amount: t.amount_base,
          name: t.faucet
            ? 'Test dollars'
            : t.naira === 'top_up'
              ? 'Added from your bank'
              : t.naira === 'cash_out_refund'
                ? 'Cash-out returned'
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
                : t.naira === 'top_up'
                  ? 'Naira, through Paystack'
                  : t.naira === 'cash_out_refund'
                    ? 'The bank couldn’t take it'
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
        ...(note.oneTime && ledger.announced[note.oneTime.toLowerCase()]
          ? { announced: ledger.announced[note.oneTime.toLowerCase()] }
          : {}),
        // Paid from a one-time address, so Kova's index of your wallet never lists it: this is
        // its only record, here.
        ...(note.fromPrivate ? { fromPrivate: true } : {}),
      })
    }
    // Paid to you privately: who from and their note (the payment's own sealed memo says, opened
    // with your key), and whether it's still there, spent privately or moved in. Your change from
    // gathering is your own money, not a payment to you.
    for (const f of ledger.found) {
      if (f.kind === 'change') continue
      const key = f.address.toLowerCase()
      const moved = movedIn.get(key)
      const holds = f.emptied ? 0n : held.get(key)
      const waiting = holds === undefined ? !moved : holds > 0n
      entries.push({
        id: `private:${key}`,
        kind: 'received',
        amount: f.amount,
        name: f.from ? (nameFor(f.from) ?? f.name ?? short(getAddress(f.from))) : (f.name ?? ''),
        detail:
          f.note ??
          (waiting
            ? 'Ready to spend'
            : moved
              ? 'Moved in'
              : f.used
                ? 'Spent privately'
                : 'Moved in'),
        ...(f.note ? { private: 'both' as const } : {}),
        ...(f.from ? { address: getAddress(f.from) } : {}),
        ...(f.proven === 'claimed' ? { unconfirmed: true } : {}),
        oneTime: getAddress(f.address),
        waiting,
        ...(moved ? { movedIn: moved } : {}),
        ...(f.used ? { used: true } : {}),
        ...(f.announced ? { announced: f.announced } : {}),
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

  /**
   * What each one-time address of yours holds (your change too): as Monad last said, or as
   * announced until it has, and nothing once it's moved in.
   */
  const privateHeld = useMemo(() => {
    const me = profile?.address.toLowerCase()
    const movedFrom = new Set(
      transfers.filter((t) => t.to.toLowerCase() === me).map((t) => t.from.toLowerCase()),
    )
    return ledger.found
      .filter((f) => !f.emptied)
      .map((f) => {
        const key = f.address.toLowerCase()
        return held.get(key) ?? (movedFrom.has(key) ? 0n : BigInt(f.amount))
      })
      .filter((value) => value > 0n)
  }, [held, ledger, profile?.address, transfers])
  const privateBalance = useMemo(() => privateHeld.reduce((sum, v) => sum + v, 0n), [privateHeld])
  const privateLargest = useMemo(
    () => privateHeld.reduce((most, v) => (v > most ? v : most), 0n),
    [privateHeld],
  )
  const privateWaiting = privateHeld.length
  const announcedSend = useCallback(
    (oneTime: string) => ledger.announced[oneTime.toLowerCase()] ?? null,
    [ledger.announced],
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
      privateLargest,
      privateWaiting,
      announcedSend,
      privateOpen,
      privateUnchecked: unchecked && !privateOpen,
      checkPrivate,
      tickPrivate,
      moveIn,
      movingIn,
      payCheckout,
      cashOutNaira,
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
      privateLargest,
      privateWaiting,
      announcedSend,
      privateOpen,
      unchecked,
      checkPrivate,
      tickPrivate,
      moveIn,
      movingIn,
      payCheckout,
      cashOutNaira,
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
