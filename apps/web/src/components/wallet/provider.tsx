'use client'

import type { PasskeyCredentialMetadata } from '@category-labs/mera'
import type { NetworkId } from '@kova/monad'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { type Address, getAddress, isAddress, type LocalAccount } from 'viem'
import {
  createKovaPasskey,
  openKovaPasskey,
  openSigningSession,
  passkeyProblem,
} from '@/lib/passkey'
import { openVault, sealAndUpload, type VaultContents } from '@/lib/vault'
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
import { endSession, sessionAccount, spend, startSession } from '@/lib/wallet/session'

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
  send: (to: Contact, amount: bigint, note?: string) => Promise<Moved>
  /** Sends a link's dollars to its one-time address (Send as a link). */
  fundLink: (link: KeptLink) => Promise<Moved>
  /** Whether a private note to them can be read by them (they've published a note key). */
  noteReaches: (address: string) => Promise<boolean>
  /** Opens private notes after a reload: the note key lives in memory, so it takes the passkey. */
  readNotes: () => Promise<void>
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

/** The wallet's first backup and its note key, for a wallet made outside the WalletProvider. */
export function settleNewWallet(
  profile: Profile,
  account: LocalAccount,
  vaultSecret: Uint8Array | null,
) {
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
    async (to: Contact, amount: bigint, note?: string) => {
      if (!profile) throw new Error('Open your wallet first.')
      const text = note?.trim()
      // Sealed for them and for you; if they have no note key yet, for you alone.
      const [account, theirs] = await Promise.all([
        unlock(amount),
        text ? fetchNoteKey(getAddress(to.address)) : null,
      ])
      const secret = vaultSecret.current
      const sealing =
        text && secret ? { text, mine: noteKeys(secret).publicKey, theirs } : undefined
      const moved = await sendMoney(network, account, getAddress(to.address), amount, sealing)
      spend(amount)
      remember(moved.hash, {
        ...(sealing ? { private: sealing.theirs ? ('both' as const) : ('you' as const) } : {}),
        name: to.name,
        detail: text || 'Sent',
        ms: moved.ms,
        kind: 'sent',
        to: to.address,
        amount: amount.toString(),
        at: Date.now(),
        explorer: moved.explorer,
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
    (t: IndexedTransfer): string | null => {
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
    for (const t of transfers) {
      const out = t.from.toLowerCase() === me
      const incoming = t.to.toLowerCase() === me
      if (!out && !incoming) continue
      indexed.add(t.tx_hash.toLowerCase())
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
      if (out) {
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
      })
    }
    return entries.sort((a, b) => b.at - a.at)
  }, [linkAddresses, nameFor, noteSecret, notes, openFor, profile, transfers])

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
      if (!people.has(key))
        people.set(key, {
          address: getAddress(entry.address),
          name: nameFor(entry.address) ?? short(entry.address),
        })
    }
    for (const c of saved) {
      const key = c.address.toLowerCase()
      people.set(key, { ...people.get(key), ...c, address: getAddress(c.address) })
    }
    return [...people.values()]
  }, [activity, linkAddresses, nameFor, saved])

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
