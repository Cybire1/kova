import { createPasskeyWithPrfOutput, getPasskeyPrfOutput, isMeraError } from '@category-labs/mera'
import {
  generateStealthAddress,
  generateStealthPayment,
  type OfflinePayment,
  type StealthMemo,
  stealthMemoMessage,
} from '@kova/monad'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { base64urlnopad } from '@scure/base'
import * as SecureStore from 'expo-secure-store'
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
import {
  type Address,
  getAddress,
  hexToBytes,
  isAddress,
  isAddressEqual,
  type LocalAccount,
  type TypedDataDefinition,
} from 'viem'
import { generatePrivateKey } from 'viem/accounts'
import { type Checkout, demoSignIn } from './api'
import { confirmWithFace } from './auth'
import {
  type CashOutToPay,
  claimLink,
  fundFromFaucet,
  getBalance,
  getMonBalance,
  incomingSince,
  type PaymentLink,
  payCashOut,
  payCharge,
  recordLink,
  sendMoney,
} from './chain'
import { passkeyDomain } from './config'
import { useGoogleWallet } from './google-wallet'
import { openSigningSession } from './keys'
import { type DisplayCurrency, formatUsd } from './money'
import { ensureNoteKey, myNoteKeys, readNote, theirNoteKey } from './notes'
import { signOfflinePayment } from './offline-core'
import { offlineArrival, offlineEntryId } from './offline-store'
import { kovaWebAuthnClient, takeVaultOutput } from './passkey'
import { forgetLink, linkArrival, linkKey, markClaiming, newLinkKey, setLinkId } from './paylinks'
import { fetchReceivingKey, type PrivateReceipt, UntrustedKey } from './private-core'
import { ensureReceiving, forgetReceiving, isPrivateAddress, resetScan } from './private-store'
import { endSession, sessionAccount, spend, startSession } from './session'
import { load, remove, save } from './storage'
import { forgetTakingsKeys, isTakingsAddress } from './takings-store'
import { forgetVaultSecret, keepVaultSecret, openVault, saveVault } from './vault'

/**
 * The wallet is a passkey (Mera). Creating it takes one Face ID: the passkey, which iCloud
 * Keychain keeps and carries to your next phone, gives Kova a 32-byte secret, and the Monad
 * account is derived from it. No seed phrase, and nothing for Kova's servers to hold.
 *
 * On this phone the secret waits in the Keychain behind Face ID. Approving a payment opens a
 * short signing session (see session.ts), so a few small payments in a row need one Face ID.
 * On a new phone, the same passkey brings the same wallet back.
 */

const PRF = 'kova.monad.prf.v1'
/** Development only: a wallet made without the passkey sheet keeps its key here, so it still signs after a reload. */
const DEV_PRF = 'kova.dev.prf'
/** The App Review demo account's secret, which stands where a passkey's PRF output would. */
const DEMO_PRF = 'kova.demo.prf.v1'
const PROFILE = 'kova.profile.v1'
// History, balance and the block cursor belong to one chain, so the Monad build keeps its own.
const ACTIVITY = 'kova.monad.activity.v1'
const CONTACTS = 'kova.contacts.v1'
const CURSOR = 'kova.monad.cursor.v1'
const BALANCE = 'kova.monad.balance.v1'

export interface Profile {
  name: string
  address: Address
  currency: DisplayCurrency
  /** Whether the key needs biometrics to read. False only on a dev simulator without Face ID. */
  protected: boolean
  /** When the wallet was created on this phone (ms). Older wallets predate this field. */
  createdAt?: number
  /** The passkey this wallet comes from, so Kova asks for that one and no other. */
  passkey?: { credentialId: string; transports?: readonly string[] }
  /** The App Review demo account: opened with a username and password, on testnet only. */
  demo?: boolean
  auth?: 'google'
  email?: string
}

export type EntryKind = 'paid' | 'sent' | 'received' | 'added'

export interface Entry {
  id: string
  kind: EntryKind
  /** Base units, as a string for storage. */
  amount: string
  name: string
  detail: string
  address?: Address
  txHash?: string
  ms?: number
  at: number
  /** `detail` is a private note: readable by both of you, or (when they had no note key) by you alone. */
  private?: 'both' | 'you'
  /** Money into or out of a link: its address is a one-time key, never a person to pay again. */
  link?: boolean
  /** The shop's private takings coming home from the one-time address a sale was paid to. */
  takings?: boolean
  /**
   * Sent or received privately: the dollars went to a one-time address only the recipient's keys
   * can open, so Monad shows who sent how much, but not to whom.
   */
  privately?: boolean
  /** That one-time address. */
  oneTime?: Address
  /** Paid or sent from private dollars, signed by one of this wallet's one-time addresses: the wallet itself never shows. */
  fromPrivate?: boolean
  /** Received privately, and only its memo says who from: nothing proves it. */
  unconfirmed?: boolean
  /** Signed with no signal and carried as a code; settled on Monad once a phone was online. */
  offline?: boolean
}

export interface Contact {
  address: Address
  name: string
  currency?: DisplayCurrency
}

/** A contact we only know by address: shown as "0x12ab…cdef" until you give them a name. */
export const isUnnamed = (name: string) => name.startsWith('0x')

export interface Arrival {
  amount: bigint
  name: string
  address: Address
  hash: string
  /** Their private note, opened on this phone. */
  note?: string
  /** It arrived privately, at a one-time address only this wallet can open. */
  privately?: boolean
  oneTime?: Address
  /** Only the memo says who it's from. */
  unconfirmed?: boolean
}

type Status = 'loading' | 'none' | 'ready'

interface Wallet {
  status: Status
  profile: Profile | null
  balance: bigint | null
  monBalance: bigint | null
  activity: Entry[]
  contacts: Contact[]
  arrival: Arrival | null
  clearArrival: () => void
  refresh: () => Promise<void>
  /** Makes a passkey, and the wallet with it. One Face ID. */
  create: (name: string, currency: DisplayCurrency) => Promise<void>
  /**
   * Development only: a wallet from a random secret, without the passkey sheet a simulator can't
   * be tapped through, so the dev link reaches every screen. It keeps no secret: its session is
   * all it has, and it ends with the app.
   */
  createForDev?: (name: string, currency: DisplayCurrency) => Promise<void>
  /**
   * Opens the App Review demo account (testnet): Kova checks the username and password and gives
   * back the wallet's secret, which this phone keeps instead of a passkey's.
   */
  signInDemo: (username: string, password: string) => Promise<void>
  /** Brings a wallet back from its passkey, on this phone or a new one. The name may be empty. */
  restore: () => Promise<Profile>
  signInGoogle: () => Promise<Profile>
  googleEnabled: boolean
  googleBusy: boolean
  setName: (name: string) => Promise<void>
  setCurrency: (currency: DisplayCurrency) => Promise<void>
  addMoney: () => Promise<void>
  /** `signer`: one of this wallet's one-time addresses pays instead (private dollars), and the wallet never shows. */
  payCheckout: (checkout: Checkout, options?: { signer?: LocalAccount }) => Promise<Entry>
  /** Cashes out to a Nigerian bank: signs the quote's exact transfer to Kova's treasury; Kova pays the naira (app/cash-out.tsx). */
  cashOutNaira: (cashOut: CashOutToPay) => Promise<CashOutToPay>
  /**
   * Sends dollars to a person. `privately`: to a fresh one-time address made from their published
   * key, checked against their own signature first; Monad shows the amount, but not who got it.
   */
  send: (
    to: Contact,
    amount: bigint,
    note?: string,
    options?: { privately?: boolean; signer?: LocalAccount },
  ) => Promise<Entry>
  /**
   * A private payment this wallet's viewing key found: into your activity as received, and when it
   * arrived while the app is open (`celebrate`), the arrival screen, marked private.
   */
  receivedPrivately: (receipt: PrivateReceipt, celebrate: boolean) => Promise<void>
  /**
   * Sends dollars as a link: a fresh one-time key, the dollars sent to its address, and the link
   * recorded with Kova. The key comes back to be shared and stays in this phone's Keychain.
   */
  makeLink: (
    amount: bigint,
    note?: string,
  ) => Promise<{ link: PaymentLink; key: `0x${string}`; entry: Entry }>
  /**
   * Signs a payment with no network (one Face ID, or the open session): the signed payment is a code
   * to show or share, and settles on Monad once either phone is online. Nothing leaves the phone here.
   */
  signOffline: (to: Contact, amount: bigint) => Promise<{ code: string; payment: OfflinePayment }>
  /** An offline payment that settled, into your activity (once, whoever saw it first). */
  recordOffline: (entry: Entry) => Promise<void>
  /** Claims a link someone sent into this wallet. */
  claimFromLink: (
    link: PaymentLink,
    key: `0x${string}`,
  ) => Promise<{ link: PaymentLink; entry: Entry }>
  /** Takes back a link you sent that no one has claimed: everything at it comes home. */
  takeBack: (link: PaymentLink) => Promise<PaymentLink>
  /** Whether a private note to them can be read by them (they've published a note key). */
  noteReaches: (address: Address) => Promise<boolean>
  rememberContact: (contact: Contact) => Promise<void>
  /** Your own name for someone. It replaces their address everywhere, past payments included. */
  renameContact: (address: Address, name: string) => Promise<void>
  /**
   * Signs a message as this wallet (the open session, or Face ID): Kova's shop sign-in and shop
   * ownership, which the web checks the same way. It moves no money.
   */
  signMessage: (message: string) => Promise<`0x${string}`>
  /**
   * Signs EIP-712 typed data as this wallet (the open session, or Face ID): the Kova Card's link,
   * limit, freeze and unlink approvals, and the permit that lets a linked card spend. Each says
   * exactly what it allows; none moves money by itself.
   */
  signTypedData: (typedData: TypedDataDefinition) => Promise<`0x${string}`>
  /**
   * The wallet, opened for `amount`: the open session when it covers it, or Face ID asked once
   * ("Approve $X"). Kova for Business signs a whole payroll with the one approval.
   */
  approve: (amount: bigint) => Promise<LocalAccount>
  signOut: () => Promise<void>
}

const WalletContext = createContext<Wallet | null>(null)

export function useWallet(): Wallet {
  const wallet = useContext(WalletContext)
  if (!wallet) throw new Error('useWallet must be used inside <WalletProvider>')
  return wallet
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/** Keeps the passkey's secret on this phone, readable only after Face ID. */
async function keep(prf: Uint8Array) {
  await SecureStore.setItemAsync(PRF, base64urlnopad.encode(prf), {
    requireAuthentication: true,
    keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
  })
}

/** What went wrong with a passkey, in words someone can act on. */
function passkeyProblem(error: unknown): string {
  if (isMeraError(error) && error.code === 'PRF_UNAVAILABLE')
    return 'This phone’s passkeys can’t hold a wallet yet. Kova needs iOS 18 or later, with iCloud Keychain on.'
  const message = error instanceof Error ? error.message : ''
  if (/cancel/i.test(message)) return 'Cancelled. Nothing was changed.'
  return 'The passkey didn’t open. Try again.'
}

/**
 * Opens a signing session from the passkey's secret, and checks it is this wallet's. `locked`: the
 * keys made from it are kept behind Face ID (false only for the demo account and dev wallets).
 */
async function begin(prf: Uint8Array, expected?: Address, locked = true): Promise<LocalAccount> {
  const { session, account } = await openSigningSession(prf)
  prf.fill(0)
  if (expected && !isAddressEqual(account.address, expected)) {
    session.end()
    throw new Error('That passkey belongs to a different Kova wallet.')
  }
  startSession(session, account)
  // So people can send this wallet private notes. Quiet: a note key is a nicety, not a payment.
  void ensureNoteKey(account).catch((error) => {
    if (__DEV__)
      console.log('[notes] key not published', error instanceof Error ? error.message : error)
  })
  // So people can send this wallet dollars privately: its private-receiving keys, made once with the
  // account that's open anyway, and their public half given to Kova. Quiet, like the note key.
  void ensureReceiving(account, locked).catch((error) => {
    if (__DEV__)
      console.log('[private] keys not ready', error instanceof Error ? error.message : error)
  })
  return account
}

/** Their private-receiving key, checked against their own signature, or why a private send to them can't go. */
async function theirReceivingKey(to: Contact): Promise<string> {
  const first = isUnnamed(to.name) ? 'They' : to.name.split(' ')[0]
  let meta: string | null
  try {
    meta = await fetchReceivingKey(to.address)
  } catch (error) {
    if (error instanceof UntrustedKey)
      throw new Error(
        `Kova gave a private key for ${isUnnamed(to.name) ? 'them' : first} that they didn’t sign, so it wasn’t used.`,
      )
    throw new Error('Kova couldn’t be reached to send privately.')
  }
  if (!meta) throw new Error(`${first} can’t receive privately yet. Send it normally instead.`)
  return meta
}

const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`

export function WalletProvider({ children }: { children: ReactNode }) {
  const {
    connect: connectGoogle,
    logout: logoutGoogle,
    enabled: googleEnabled,
    busy: googleBusy,
  } = useGoogleWallet()
  const [status, setStatus] = useState<Status>('loading')
  const [googleAdopting, setGoogleAdopting] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [balance, setBalance] = useState<bigint | null>(null)
  const [monHeld, setMonHeld] = useState<{ address: string; value: bigint } | null>(null)
  const [activity, setActivity] = useState<Entry[]>([])
  const [savedContacts, setSavedContacts] = useState<Contact[]>([])
  const [arrival, setArrival] = useState<Arrival | null>(null)

  useEffect(() => {
    void (async () => {
      const [p, a, c, b] = await Promise.all([
        load<Profile | null>(PROFILE, null),
        load<Entry[]>(ACTIVITY, []),
        load<Contact[]>(CONTACTS, []),
        load<string | null>(BALANCE, null),
      ])
      // Show the last known balance at once; the chain confirms it moments later.
      if (b !== null) setBalance(BigInt(b))
      setActivity(a)
      setSavedContacts(c.filter((x) => isAddress(x.address)))
      setProfile(p)
      setStatus(p ? 'ready' : 'none')
    })()
  }, [])

  const shownRef = useRef<Entry[]>([])
  shownRef.current = activity

  const record = useCallback(async (entry: Entry) => {
    setActivity((prev) => {
      if (entry.txHash && prev.some((e) => e.txHash === entry.txHash && e.kind === entry.kind))
        return prev
      // Newest first, in the order things happened: a private payment found later still sits at its own time.
      const at = prev.findIndex((e) => e.at <= entry.at)
      const next = (
        at === -1 ? [...prev, entry] : [...prev.slice(0, at), entry, ...prev.slice(at)]
      ).slice(0, 200)
      void save(ACTIVITY, next)
      return next
    })
  }, [])

  const refresh = useCallback(async () => {
    if (!profile) return
    try {
      const [latest, mon] = await Promise.all([
        getBalance(profile.address).catch(() => null),
        getMonBalance(profile.address).catch(() => null),
      ])
      if (latest !== null) {
        setBalance(latest)
        void save(BALANCE, latest.toString())
      }
      if (mon !== null) setMonHeld({ address: profile.address, value: mon })
    } catch (error) {
      // Offline: keep showing the last known balance.
      if (__DEV__) {
        const e = error as {
          shortMessage?: string
          details?: string
          cause?: { message?: string; details?: string }
        }
        console.log(
          '[wallet] balance refresh failed',
          e.shortMessage,
          '|',
          e.details,
          '|',
          e.cause?.message,
          '|',
          e.cause?.details,
        )
      }
    }
  }, [profile])

  const contacts = useMemo(() => {
    const seen = new Map<string, Contact>()
    // Tokens are minted from the zero address (the testnet faucet): that is not a person.
    const zero = '0x0000000000000000000000000000000000000000'
    for (const e of activity) {
      // Nor is a sender only a private memo names: anyone could have written it.
      if (e.address?.toLowerCase() === zero || e.link || e.takings || e.unconfirmed) continue
      if (
        (e.kind === 'sent' || e.kind === 'received') &&
        e.address &&
        !seen.has(e.address.toLowerCase())
      )
        seen.set(e.address.toLowerCase(), { address: e.address, name: e.name })
    }
    for (const c of savedContacts) {
      const key = c.address.toLowerCase()
      seen.set(key, { ...seen.get(key), ...c })
    }
    return [...seen.values()]
  }, [activity, savedContacts])

  // Back up the vault a moment after the owner changes their name, currency or a contact: the
  // changes that set `edited`, not the ones that come from loading or restoring.
  const edited = useRef(false)
  useEffect(() => {
    if (!edited.current || !profile?.name) return
    const timer = setTimeout(() => {
      edited.current = false
      void saveVault({
        v: 1,
        name: profile.name,
        currency: profile.currency,
        contacts: savedContacts,
      }).catch(() => {})
    }, 1500)
    return () => clearTimeout(timer)
  }, [profile?.name, profile?.currency, savedContacts])

  // The names you gave people, applied to every payment with them, past ones included.
  const named = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of savedContacts) if (!isUnnamed(c.name)) map.set(c.address.toLowerCase(), c.name)
    return map
  }, [savedContacts])
  const shownActivity = useMemo(
    () =>
      activity.map((e) => {
        const name =
          (e.kind === 'sent' || e.kind === 'received') && e.address
            ? named.get(e.address.toLowerCase())
            : undefined
        return name && name !== e.name ? { ...e, name } : e
      }),
    [activity, named],
  )

  const nameFor = useCallback(
    (address: Address) => contacts.find((c) => isAddressEqual(c.address, address))?.name,
    [contacts],
  )

  // Watch for money arriving while the app is open. Kova's index of the chain answers; a wallet
  // with no cursor yet (new, or restored on a fresh phone) gets everything it ever received.
  useEffect(() => {
    if (!profile) return
    let stopped = false
    let busy = false
    const tick = async () => {
      if (busy || AppState.currentState !== 'active') return
      busy = true
      try {
        const saved = await load<string | null>(CURSOR, null)
        const cursor = saved && /^\d+$/.test(saved) ? BigInt(saved) : 0n
        const { transfers, head } = await incomingSince(profile.address, cursor)
        if (stopped) return
        await save(CURSOR, head.toString())
        for (const t of transfers) {
          // This wallet's own private dollars, moved in from one of its one-time addresses: they're in
          // your activity already, from when they arrived privately, so they're not news twice.
          if (await isPrivateAddress(t.from)) continue
          // One of this phone's offline payments settling: it had its arrival screen when its code was
          // scanned, so it goes into activity quietly, as itself.
          const offline = await offlineArrival(t.from, t.amount, t.hash)
          if (offline) {
            const known = nameFor(t.from)
            await record({
              id: offline.entryId ?? offlineEntryId(offline.id),
              kind: 'received',
              amount: t.amount.toString(),
              name: known && !isUnnamed(known) ? known : offline.name,
              detail: 'Paid with a code',
              address: t.from,
              txHash: t.hash,
              ...(offline.ms ? { ms: offline.ms } : {}),
              at: offline.at,
              offline: true,
            })
            continue
          }
          const note = t.note
            ? await readNote(t.note, { from: t.from, to: profile.address, value: t.amount })
            : null
          const refund = t.kind === 'refund'
          // The cent or so a cash-out's conversion returns: recorded quietly, never a "paid you".
          const change = t.naira === 'cash_out_change'
          // Money out of a link: your own coming back, or one claimed here a moment ago.
          const fromLink = linkArrival(t.from)
          // The shop's own takings, moved home from a sale's one-time address: no stranger, and no surprise.
          const fromTakings = !fromLink && (await isTakingsAddress(t.from))
          const name = t.faucet
            ? 'Test dollars'
            : t.naira === 'top_up'
              ? 'Added from your bank'
              : t.naira === 'cash_out_refund'
                ? 'Cash-out returned'
                : change
                  ? 'Cash-out change'
                  : refund
                    ? 'Refund'
                    : fromTakings
                      ? 'Private takings'
                      : (fromLink?.name ??
                        nameFor(t.from) ??
                        `${t.from.slice(0, 6)}…${t.from.slice(-4)}`)
          await record({
            id: newId(),
            kind: t.faucet || t.naira === 'top_up' ? 'added' : 'received',
            amount: t.amount.toString(),
            name,
            detail:
              note ??
              (t.faucet
                ? 'AUSD test faucet'
                : change
                  ? 'Left over from the conversion'
                  : refund
                    ? 'Money back from a booking'
                    : fromTakings
                      ? 'From a private sale'
                      : (fromLink?.detail ?? 'Arrived')),
            address: t.from,
            txHash: t.hash,
            at: Date.now(),
            ...(note ? { private: 'both' as const } : {}),
            ...(fromLink ? { link: true } : {}),
            ...(fromTakings ? { takings: true } : {}),
          })
          // Already in your activity (claimed here, say): it had its celebration.
          const seen = shownRef.current.some(
            (e) => e.txHash?.toLowerCase() === t.hash.toLowerCase() && e.kind === 'received',
          )
          // Less than a cent isn't news, and a cash-out's change isn't someone paying you.
          if (
            !t.faucet &&
            !fromLink?.quiet &&
            !fromTakings &&
            !change &&
            t.amount >= 10_000n &&
            !seen
          )
            setArrival({
              amount: t.amount,
              name,
              address: t.from,
              hash: t.hash,
              ...(note ? { note } : {}),
            })
        }
        if (transfers.length) void refresh()
      } catch (error) {
        // Try again on the next tick.
        if (__DEV__)
          console.log(
            '[wallet] incoming scan failed',
            error instanceof Error ? error.message.split('\n')[0] : error,
          )
      } finally {
        busy = false
      }
    }
    void tick()
    const id = setInterval(tick, 4000)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [profile, nameFor, record, refresh])

  // The balance refreshes on its own clock, so a failed request (common on the first call after
  // launch) is retried in seconds rather than waiting on anything else.
  useEffect(() => {
    if (!profile) return
    void refresh()
    const id = setInterval(() => {
      if (AppState.currentState === 'active') void refresh()
    }, 6000)
    return () => clearInterval(id)
  }, [profile, refresh])

  /**
   * The account that signs a payment of `amount`. Inside a live session it answers at once;
   * otherwise Face ID opens the Keychain, and a new session starts. Every signature goes through here.
   */
  const unlock = useCallback(
    async (amount: bigint) => {
      if (!profile) throw new Error('No wallet on this phone')
      const open = sessionAccount(amount)
      if (open) return open
      if (profile.auth === 'google') {
        if (
          !(await confirmWithFace(
            amount > 0n ? `Approve ${formatUsd(amount)}` : 'Open your Google wallet',
          ))
        )
          throw new Error('Cancelled. Nothing was signed.')
        const connected = await connectGoogle(profile.address)
        await keepVaultSecret(connected.vaultSecret)
        startSession(connected.session, connected.account)
        void ensureNoteKey(connected.account).catch(() => {})
        void ensureReceiving(connected.account, true).catch(() => {})
        return connected.account
      }
      if (profile.demo) {
        // A shared test wallet: its secret came from a password, so a passkey would add nothing.
        const demo = await SecureStore.getItemAsync(DEMO_PRF).catch(() => null)
        if (!demo) throw new Error('Sign in to the demo account again.')
        return begin(base64urlnopad.decode(demo), profile.address, false)
      }
      if (__DEV__ && !profile.protected) {
        const dev = await SecureStore.getItemAsync(DEV_PRF).catch(() => null)
        if (dev) return begin(base64urlnopad.decode(dev), profile.address, false)
      }
      const stored = await SecureStore.getItemAsync(PRF, {
        requireAuthentication: true,
        authenticationPrompt: amount > 0n ? `Approve ${formatUsd(amount)}` : 'Open your wallet',
      }).catch(() => {
        throw new Error('Face ID was cancelled. Nothing was paid.')
      })
      if (stored) return begin(base64urlnopad.decode(stored), profile.address)
      // The Keychain copy is gone (a new passcode, a restored phone): ask the passkey itself.
      const asserted = await getPasskeyPrfOutput({
        rpId: passkeyDomain,
        ...(profile.passkey ? { credential: profile.passkey } : {}),
        webAuthnClient: kovaWebAuthnClient,
      }).catch((error) => {
        throw new Error(passkeyProblem(error))
      })
      const vault = takeVaultOutput()
      if (vault) await keepVaultSecret(vault)
      await keep(asserted.prfOutput)
      return begin(asserted.prfOutput, profile.address)
    },
    [profile, connectGoogle],
  )

  const create = useCallback(async (name: string, currency: DisplayCurrency) => {
    const clean = name.trim()
    const created = await createPasskeyWithPrfOutput({
      rp: { id: passkeyDomain, name: 'Kova' },
      user: { name: clean, displayName: clean },
      webAuthnClient: kovaWebAuthnClient,
    }).catch((error) => {
      throw new Error(passkeyProblem(error))
    })
    const vault = takeVaultOutput()
    if (vault) await keepVaultSecret(vault)
    await keep(created.prfOutput)
    const account = await begin(created.prfOutput)
    const next: Profile = {
      name: clean,
      address: account.address,
      currency,
      protected: true,
      createdAt: Date.now(),
      passkey: {
        credentialId: created.credentialId,
        ...(created.transports ? { transports: created.transports } : {}),
      },
    }
    await save(PROFILE, next)
    setProfile(next)
    setBalance(0n)
    setStatus('ready')
    void saveVault({ v: 1, name: next.name, currency: next.currency, contacts: [] }).catch(() => {})
  }, [])

  const restore = useCallback(async () => {
    const asserted = await getPasskeyPrfOutput({
      rpId: passkeyDomain,
      webAuthnClient: kovaWebAuthnClient,
    }).catch((error) => {
      throw new Error(passkeyProblem(error))
    })
    const vault = takeVaultOutput()
    if (vault) await keepVaultSecret(vault)
    await keep(asserted.prfOutput)
    const account = await begin(asserted.prfOutput)
    // Who you are comes back from the vault this passkey sealed, if it sealed one.
    const backup = vault ? await openVault(vault).catch(() => null) : null
    const restoredContacts = (backup?.contacts ?? []).filter((c) =>
      isAddress(c.address),
    ) as Contact[]
    if (restoredContacts.length) {
      setSavedContacts(restoredContacts)
      await save(CONTACTS, restoredContacts)
    }
    // A fresh history for this wallet: Kova's index of the chain brings back what arrived, and the
    // private-payments feed what arrived privately.
    await remove(ACTIVITY, CURSOR, BALANCE)
    await resetScan()
    const next: Profile = {
      name: backup?.name ?? '',
      address: account.address,
      currency: (backup?.currency as DisplayCurrency | undefined) ?? 'USD',
      protected: true,
      createdAt: Date.now(),
      passkey: { credentialId: asserted.credentialId },
    }
    await save(PROFILE, next)
    setActivity([])
    setProfile(next)
    setBalance(null)
    setStatus('ready')
    return next
  }, [])

  const signInGoogle = useCallback(async () => {
    if (profile && profile.auth !== 'google')
      throw new Error('Sign out of the current wallet before opening a Google wallet.')
    setGoogleAdopting(true)
    let connected: Awaited<ReturnType<typeof connectGoogle>> | null = null
    try {
      connected = await connectGoogle(profile?.address)
      const backup = await openVault(connected.vaultSecret)
      await keepVaultSecret(connected.vaultSecret)
      const people = (backup?.contacts ?? []).filter((c) => isAddress(c.address)) as Contact[]
      await remove(ACTIVITY, CURSOR, BALANCE)
      await resetScan()
      const next: Profile = {
        address: connected.account.address,
        auth: 'google',
        email: connected.email,
        name: backup?.name ?? (connected.name || 'Your wallet'),
        currency: (backup?.currency as DisplayCurrency | undefined) ?? 'USD',
        protected: true,
        createdAt: profile?.createdAt ?? Date.now(),
      }
      await save(CONTACTS, people)
      await save(PROFILE, next)
      startSession(connected.session, connected.account)
      void ensureNoteKey(connected.account).catch(() => {})
      void ensureReceiving(connected.account, true).catch(() => {})
      setSavedContacts(people)
      setActivity([])
      setBalance(null)
      setProfile(next)
      setStatus('ready')
      if (!backup)
        void saveVault({ v: 1, name: next.name, currency: next.currency, contacts: people }).catch(
          () => {},
        )
      return next
    } catch (error) {
      connected?.session.end()
      throw error
    } finally {
      setGoogleAdopting(false)
    }
  }, [connectGoogle, profile])

  const setName = useCallback(
    async (name: string) => {
      if (!profile || name.trim().length < 2) return
      const next = { ...profile, name: name.trim() }
      await save(PROFILE, next)
      edited.current = true
      setProfile(next)
    },
    [profile],
  )

  const setCurrency = useCallback(
    async (currency: DisplayCurrency) => {
      if (!profile) return
      const next = { ...profile, currency }
      await save(PROFILE, next)
      edited.current = true
      setProfile(next)
    },
    [profile],
  )

  const addMoney = useCallback(async () => {
    if (!profile) return
    await fundFromFaucet(profile.address)
    await refresh()
  }, [profile, refresh])

  const payCheckout = useCallback(
    async (checkout: Checkout, options: { signer?: LocalAccount } = {}) => {
      const amount = BigInt(checkout.amount_base)
      // From private dollars, the one-time address signs exactly as the wallet would.
      const account = options.signer ?? (await unlock(amount))
      // Kova submits the signed payment and settles it before answering, so paid means paid.
      const { hash, ms } = await payCharge(account, checkout)
      if (!options.signer) spend(amount)
      const entry: Entry = {
        id: newId(),
        kind: 'paid',
        amount: checkout.amount_base,
        name: checkout.order?.stall?.name ?? checkout.merchant_name,
        detail: checkout.reference ?? 'Scan to pay',
        address: getAddress(checkout.pay_to),
        txHash: hash,
        ms,
        at: Date.now(),
        ...(options.signer ? { fromPrivate: true } : {}),
      }
      await record(entry)
      void refresh()
      return entry
    },
    [unlock, record, refresh],
  )

  const cashOutNaira = useCallback(
    async (cashOut: CashOutToPay) => {
      const amount = BigInt(cashOut.pay.value)
      const account = await unlock(amount)
      const paid = await payCashOut(account, cashOut)
      spend(amount)
      if (paid.tx_hash)
        await record({
          id: newId(),
          kind: 'sent',
          amount: cashOut.pay.value,
          name: `Cash out to ${cashOut.bank_name}`,
          detail: `${cashOut.naira} to ••••${cashOut.account_last4}`,
          ...(cashOut.pay.to ? { address: getAddress(cashOut.pay.to) } : {}),
          txHash: paid.tx_hash,
          ms: paid.ms,
          at: Date.now(),
        })
      void refresh()
      return paid
    },
    [unlock, record, refresh],
  )

  const rememberContact = useCallback(async (contact: Contact) => {
    setSavedContacts((prev) => {
      const before = prev.find((c) => isAddressEqual(c.address, contact.address))
      // Paying someone by address must not wipe the name you gave them.
      const name =
        isUnnamed(contact.name) && before && !isUnnamed(before.name) ? before.name : contact.name
      const merged = { ...before, ...contact, name, currency: contact.currency ?? before?.currency }
      const next = [
        merged,
        ...prev.filter((c) => !isAddressEqual(c.address, contact.address)),
      ].slice(0, 50)
      void save(CONTACTS, next)
      edited.current = true
      return next
    })
  }, [])

  const renameContact = useCallback(async (address: Address, name: string) => {
    const clean = name.trim()
    if (!clean || !isAddress(address)) return
    setSavedContacts((prev) => {
      const before = prev.find((c) => isAddressEqual(c.address, address))
      const next = before
        ? prev.map((c) => (c === before ? { ...c, name: clean } : c))
        : [{ address, name: clean }, ...prev].slice(0, 50)
      void save(CONTACTS, next)
      edited.current = true
      return next
    })
  }, [])

  const send = useCallback(
    async (
      to: Contact,
      amount: bigint,
      note?: string,
      options: { privately?: boolean; signer?: LocalAccount } = {},
    ) => {
      const text = note?.trim()
      if (!profile) throw new Error('No wallet on this phone')
      // A signer without privately is Send to any wallet: one of your one-time addresses pays them
      // plainly, so whoever is paid sees that address, never yours, and the note stays with you.
      const plainFromPrivate = Boolean(options.signer && !options.privately)
      // Privately: their key is checked before anything is signed, then a one-time address is made
      // for this payment alone, with a memo sealed to it (you, your name, your note) that only their
      // viewing key opens. Kova announces it without them.
      const meta = options.privately ? await theirReceivingKey(to) : null
      let stealth: ReturnType<typeof generateStealthPayment> | null = null
      if (meta) {
        const memo: StealthMemo = {
          from: profile.address,
          ...(profile.name ? { name: profile.name } : {}),
          ...(text ? { note: text } : {}),
          kind: 'send',
        }
        if (options.signer) {
          // From private dollars, Monad shows a one-time address paying: the wallet's own signature in
          // the memo is what tells them it's you.
          const e = generatePrivateKey()
          const address = generateStealthAddress(meta, e).stealthAddress
          const proof = await (await unlock(0n)).signMessage({
            message: stealthMemoMessage(address),
          })
          stealth = generateStealthPayment(meta, { ...memo, proof }, e)
        } else stealth = generateStealthPayment(meta, memo)
      }
      // A note on a private send travels in its memo; on any other, sealed for them and for you (or
      // for you alone when they have no note key yet). From private dollars to a plain wallet, it's
      // kept here only: sealed to your key, it would tie the payment to you.
      const seal = Boolean(text && !stealth && !plainFromPrivate)
      const [account, mine, theirs] = await Promise.all([
        options.signer ?? unlock(amount),
        seal ? myNoteKeys() : null,
        seal ? theirNoteKey(to.address) : null,
      ])
      const sealing = text && mine ? { text, mine: mine.publicKey, theirs } : undefined
      const { hash, ms } = await sendMoney(
        account,
        stealth?.stealthAddress ?? to.address,
        amount,
        sealing,
        stealth
          ? {
              ephemeralPublicKey: stealth.ephemeralPublicKey,
              viewTag: stealth.viewTag,
              sealed: stealth.sealed,
            }
          : undefined,
      )
      if (!options.signer) spend(amount)
      const entry: Entry = {
        id: newId(),
        kind: 'sent',
        amount: amount.toString(),
        name: to.name,
        detail:
          text ||
          (stealth ? 'Sent privately' : plainFromPrivate ? 'Sent from private dollars' : 'Sent'),
        address: to.address,
        txHash: hash,
        ms,
        at: Date.now(),
        ...(sealing ? { private: sealing.theirs ? ('both' as const) : ('you' as const) } : {}),
        ...(stealth
          ? {
              privately: true,
              oneTime: stealth.stealthAddress,
              ...(text ? { private: 'both' as const } : {}),
            }
          : {}),
        ...(options.signer ? { fromPrivate: true } : {}),
      }
      await record(entry)
      await rememberContact(to)
      void refresh()
      return entry
    },
    [profile, unlock, record, rememberContact, refresh],
  )

  const makeLink = useCallback(
    async (amount: bigint, note?: string) => {
      if (!profile) throw new Error('No wallet on this phone')
      const text = note?.trim() || null
      const account = await unlock(amount)
      // The key is in the Keychain before a cent moves, so the dollars can always be taken back.
      const { key, address } = await newLinkKey(amount, text)
      let sent: Awaited<ReturnType<typeof sendMoney>>
      try {
        sent = await sendMoney(account, address, amount)
      } catch (error) {
        await forgetLink(address)
        throw error
      }
      spend(amount)
      const entry: Entry = {
        id: newId(),
        kind: 'sent',
        amount: amount.toString(),
        name: 'Link',
        detail: text ?? 'For anyone with the link',
        address,
        txHash: sent.hash,
        ms: sent.ms,
        at: Date.now(),
        link: true,
      }
      await record(entry)
      void refresh()
      // Kova reads the amount from the chain; a moment after the send, a node may not show it yet.
      let link: PaymentLink | null = null
      for (let i = 0; !link; i++) {
        try {
          link = await recordLink({
            link_address: address,
            sender_address: profile.address,
            ...(profile.name ? { sender_name: profile.name } : {}),
            ...(text ? { note: text } : {}),
            display_currency: profile.currency,
          })
        } catch (error) {
          if (i >= 6)
            throw new Error(
              'The dollars are in your link, but Kova couldn’t save it yet. Find it in Your links to share it.',
            )
          await new Promise((r) => setTimeout(r, 700))
          if (__DEV__)
            console.log('[links] record retry', error instanceof Error ? error.message : error)
        }
      }
      await setLinkId(address, link.id)
      return { link, key, entry }
    },
    [profile, unlock, record, refresh],
  )

  const signOffline = useCallback(
    async (to: Contact, amount: bigint) => {
      if (!profile) throw new Error('No wallet on this phone')
      if (profile.auth === 'google')
        throw new Error(
          'Offline payments need a passkey wallet. Connect to the internet to pay with Google.',
        )
      const account = await unlock(amount)
      const signed = await signOfflinePayment(account, to.address, amount, profile.name || null)
      spend(amount)
      await rememberContact(to)
      return signed
    },
    [profile, unlock, rememberContact],
  )

  const claimFromLink = useCallback(
    async (link: PaymentLink, key: `0x${string}`) => {
      if (!profile) throw new Error('Make your Kova wallet first, then claim it.')
      const name =
        link.sender_name?.trim() ||
        `${link.sender_address.slice(0, 6)}…${link.sender_address.slice(-4)}`
      await markClaiming(link.link_address, name)
      const claimed = await claimLink(link, key, profile.address)
      const entry: Entry = {
        id: newId(),
        kind: 'received',
        amount: BigInt(Math.round(Number(claimed.amount) * 1e6)).toString(),
        name: isAddressEqual(link.sender_address, profile.address) ? 'Your link' : name,
        detail: link.note ?? 'Claimed from a link',
        address: link.link_address,
        ...(claimed.claim_tx ? { txHash: claimed.claim_tx } : {}),
        ms: claimed.ms,
        at: Date.now(),
        link: true,
      }
      await record(entry)
      void refresh()
      return { link: claimed, entry }
    },
    [profile, record, refresh],
  )

  const takeBack = useCallback(
    async (link: PaymentLink) => {
      if (!profile) throw new Error('No wallet on this phone')
      const key = await linkKey(link.link_address)
      if (!key)
        throw new Error(
          'This phone doesn’t have the key to this link. Open the link itself to take it back.',
        )
      await markClaiming(link.link_address, 'Your link')
      const back = await claimLink(link, key, profile.address)
      await record({
        id: newId(),
        kind: 'received',
        amount: BigInt(Math.round(Number(back.amount) * 1e6)).toString(),
        name: 'Your link',
        detail: 'Taken back',
        address: link.link_address,
        ...(back.claim_tx ? { txHash: back.claim_tx } : {}),
        ms: back.ms,
        at: Date.now(),
        link: true,
      })
      void refresh()
      return back
    },
    [profile, record, refresh],
  )

  const receivedPrivately = useCallback(
    async (receipt: PrivateReceipt, celebrate: boolean) => {
      const from = receipt.from
      // Your name for them; else what they call themselves in the memo; else their address.
      const known = from ? nameFor(from) : undefined
      const name =
        known && !isUnnamed(known)
          ? known
          : (receipt.senderName ?? (from ? shortAddress(from) : 'Someone'))
      const unconfirmed = receipt.proven === 'claimed'
      const amount = BigInt(receipt.amount)
      await record({
        id: newId(),
        kind: 'received',
        amount: amount.toString(),
        name,
        detail: receipt.note ?? 'Received privately',
        ...(from ? { address: from } : {}),
        txHash: receipt.txHash,
        at: Math.min(receipt.at, Date.now()),
        ...(receipt.note ? { private: 'both' as const } : {}),
        privately: true,
        oneTime: receipt.stealthAddress,
        ...(unconfirmed ? { unconfirmed: true } : {}),
      })
      if (celebrate)
        setArrival({
          amount,
          name,
          address: from ?? receipt.stealthAddress,
          hash: receipt.txHash,
          ...(receipt.note ? { note: receipt.note } : {}),
          privately: true,
          oneTime: receipt.stealthAddress,
          ...(unconfirmed ? { unconfirmed: true } : {}),
        })
    },
    [nameFor, record],
  )

  const signOut = useCallback(async () => {
    // The passkey itself stays in iCloud Keychain: it can bring this wallet back at any time.
    endSession()
    // Best effort: an offline or failed Google logout must never leave this wallet's keys behind.
    await logoutGoogle().catch(() => {})
    await SecureStore.deleteItemAsync(PRF)
    await SecureStore.deleteItemAsync(DEV_PRF).catch(() => {})
    await SecureStore.deleteItemAsync(DEMO_PRF).catch(() => {})
    await forgetVaultSecret()
    // The shop's private takings keys and this wallet's private-receiving keys come from this wallet:
    // the next one makes its own.
    await forgetTakingsKeys()
    await forgetReceiving()
    await remove(PROFILE, ACTIVITY, CONTACTS, CURSOR, BALANCE)
    setProfile(null)
    setBalance(null)
    setActivity([])
    setSavedContacts([])
    setStatus('none')
  }, [logoutGoogle])

  const signMessage = useCallback(
    async (message: string) => (await unlock(0n)).signMessage({ message }),
    [unlock],
  )
  const signTypedData = useCallback(
    async (typedData: TypedDataDefinition) => (await unlock(0n)).signTypedData(typedData),
    [unlock],
  )

  const createForDev = useCallback(async (name: string, currency: DisplayCurrency) => {
    if (!__DEV__) throw new Error('Development only')
    const entropy = crypto.getRandomValues(new Uint8Array(32))
    await SecureStore.setItemAsync(DEV_PRF, base64urlnopad.encode(entropy))
    // A stand-in for the passkey's second secret, so private notes work on a simulator too.
    await keepVaultSecret(crypto.getRandomValues(new Uint8Array(32)))
    const account = await begin(entropy, undefined, false)
    const next: Profile = {
      name: name.trim(),
      address: account.address,
      currency,
      protected: false,
      createdAt: Date.now(),
    }
    await save(PROFILE, next)
    setProfile(next)
    setBalance(0n)
    setStatus('ready')
  }, [])

  const signInDemo = useCallback(async (username: string, password: string) => {
    const account = await demoSignIn(username, password)
    const entropy = hexToBytes(account.secret)
    await SecureStore.setItemAsync(DEMO_PRF, base64urlnopad.encode(entropy), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    })
    // The vault and note keys come from the secret too, so every phone signed in sees the same ones.
    await keepVaultSecret(hkdf(sha256, entropy, undefined, 'kova.demo.vault.v1', 32))
    const opened = await begin(entropy, undefined, false)
    const contacts = account.contacts.filter((c) => isAddress(c.address)) as Contact[]
    setSavedContacts(contacts)
    await save(CONTACTS, contacts)
    await remove(ACTIVITY, CURSOR, BALANCE)
    await resetScan()
    setActivity([])
    const next: Profile = {
      name: account.name,
      address: opened.address,
      currency: (account.currency as DisplayCurrency) || 'USD',
      protected: false,
      demo: true,
      createdAt: Date.now(),
    }
    await save(PROFILE, next)
    setProfile(next)
    setBalance(null)
    setStatus('ready')
  }, [])

  const value: Wallet = {
    status,
    profile,
    balance,
    monBalance: monHeld && monHeld.address === profile?.address ? monHeld.value : null,
    activity: shownActivity,
    contacts,
    arrival,
    clearArrival: () => setArrival(null),
    refresh,
    create,
    ...(__DEV__ ? { createForDev } : {}),
    signInDemo,
    restore,
    signInGoogle,
    googleEnabled: googleEnabled,
    googleBusy: googleBusy || googleAdopting,
    setName,
    setCurrency,
    addMoney,
    payCheckout,
    cashOutNaira,
    send,
    makeLink,
    signOffline,
    recordOffline: record,
    claimFromLink,
    takeBack,
    receivedPrivately,
    noteReaches: async (address: Address) => (await theirNoteKey(address)) !== null,
    rememberContact,
    renameContact,
    signMessage,
    signTypedData,
    approve: unlock,
    signOut,
  }
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}
