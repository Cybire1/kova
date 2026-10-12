import { type StealthKeys, stealthMetaAddress, stealthRegistrationMessage, stealthViewKey } from '@kova/monad'
import * as SecureStore from 'expo-secure-store'
import type { Address, Hex, LocalAccount } from 'viem'
import { apiUrl } from './config'
import { fetchReceivingKey, type PrivateReceipt, publishReceivingKey, receivingKeys, UntrustedKey } from './private-core'
import { load, remove, save } from './storage'

/**
 * Where the phone keeps this wallet's private-receiving keys, the way it keeps a shop's takings keys.
 *
 * The view half (the viewing key and the spending public key) finds private payments and can't move
 * them, so it waits in the Keychain without a biometric lock, and the phone looks for new ones
 * without asking for Face ID. The spending key can move them: it sits behind Face ID like the
 * wallet's own secret, and is read only to move private dollars in. Both come back from the wallet
 * with one signature, so losing them loses nothing.
 */
const viewName = (owner: string) => `kova.monad.private.view.v1.${owner.toLowerCase()}`
const spendName = (owner: string) => `kova.monad.private.spend.v1.${owner.toLowerCase()}`
/** The wallets whose keys this phone holds, so signing out forgets every one. */
const OWNERS = 'kova.monad.private.owners.v1'
/** Which key Kova has for this wallet, on which API, so it's only published once. */
const PUBLISHED = 'kova.monad.private.published.v1'
/** When this phone first gave Kova the key: nothing paid before then can be for this wallet. */
const FRESH = 'kova.monad.private.fresh.v1'
/** What the phone has read of Kova's feed, and the private payments it found there. */
const SCAN = 'kova.monad.private.scan.v1'

export interface SavedReceiving {
  /** The wallet the keys come from, lowercase. */
  owner: string
  /** `st:eth:0x…`, what Kova and every sender are given. */
  meta: string
  /** `kova-view:0x…`, what finds this wallet's payments. */
  view: string
  /** The wallet's signature over stealthRegistrationMessage(owner, meta), so it can be published again without unlocking. */
  signature: Hex
}

const listeners = new Set<() => void>()
const changed = () => listeners.forEach((listener) => listener())

/** Hears when this phone makes the keys or Kova takes them. */
export function onReceivingChange(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

async function keepReceivingKeys(owner: Address, keys: StealthKeys, signature: Hex, locked: boolean): Promise<SavedReceiving> {
  const owners = await load<string[]>(OWNERS, [])
  if (!owners.includes(owner.toLowerCase())) await save(OWNERS, [...owners, owner.toLowerCase()])
  // The spending key first: a phone with the view but not the key would show money it can't move.
  // Replacing a Face ID item asks for Face ID again, so the old copy goes first (deleting doesn't ask).
  await SecureStore.deleteItemAsync(spendName(owner)).catch(() => {})
  await SecureStore.setItemAsync(
    spendName(owner),
    keys.spendingPrivateKey,
    locked
      ? { requireAuthentication: true, keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY }
      : { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
  )
  const saved: SavedReceiving = { owner: owner.toLowerCase(), meta: stealthMetaAddress(keys), view: stealthViewKey(keys), signature }
  await SecureStore.setItemAsync(viewName(owner), JSON.stringify(saved), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY })
  return saved
}

/** The view half, if this wallet has made its keys on this phone. No Face ID: it can't move money. */
export async function readReceivingView(owner: Address): Promise<SavedReceiving | null> {
  const raw = await SecureStore.getItemAsync(viewName(owner)).catch(() => null)
  if (!raw) return null
  try {
    const saved = JSON.parse(raw) as SavedReceiving
    return saved.owner === owner.toLowerCase() && saved.meta && saved.view && saved.signature ? saved : null
  } catch {
    return null
  }
}

/**
 * The spending key, after Face ID. Null when the Keychain no longer has it (a new Face ID, a
 * restored phone), so the wallet can make it again. Throws when the owner cancels.
 */
export async function readReceivingSpendKey(owner: Address, prompt: string): Promise<Hex | null> {
  try {
    const key = await SecureStore.getItemAsync(spendName(owner), { authenticationPrompt: prompt })
    return key && /^0x[0-9a-fA-F]{64}$/.test(key) ? (key as Hex) : null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/cancel/i.test(message)) throw new Error('Face ID was cancelled. Nothing moved.')
    if (/authentication failed/i.test(message)) throw new Error('Face ID didn’t work. Nothing moved.')
    return null
  }
}

let making: Promise<SavedReceiving> | null = null

/**
 * This wallet's keys on this phone, made with two signatures by the wallet if they aren't here yet:
 * one that makes the keys, one over their public half for Kova to publish. One at a time, so
 * opening the wallet and setting up at once make them once.
 */
export function makeReceiving(owner: Address, sign: (message: string) => Promise<Hex>, locked: boolean): Promise<SavedReceiving> {
  making ??= (async () => {
    const existing = await readReceivingView(owner)
    if (existing) return existing
    const keys = await receivingKeys(owner, sign)
    const meta = stealthMetaAddress(keys)
    const signature = await sign(stealthRegistrationMessage(owner, meta))
    const saved = await keepReceivingKeys(owner, keys, signature, locked)
    changed()
    return saved
  })().finally(() => {
    making = null
  })
  return making
}

/**
 * Makes sure anyone can send this wallet dollars privately: its keys on this phone (signed by the
 * account that's open anyway, so no extra Face ID), and their public half with Kova. Runs quietly
 * each time the wallet opens; after the first time it only reads the Keychain.
 */
export async function ensureReceiving(account: LocalAccount, locked: boolean): Promise<void> {
  const saved = await makeReceiving(account.address, (message) => account.signMessage({ message }), locked)
  await publishReceiving(saved)
}

const publishedMark = (saved: SavedReceiving) => `${apiUrl}|${saved.owner}|${saved.meta}`

/** Whether Kova has this wallet's key, as far as this phone knows. */
export async function isPublished(saved: SavedReceiving): Promise<boolean> {
  return (await load<string | null>(PUBLISHED, null)) === publishedMark(saved)
}

let publishing: Promise<boolean> | null = null

/**
 * Gives Kova the key, unless it has it already. Quiet: false when Kova can't be reached, to be
 * tried again later. No signature is needed: the wallet signed the key when it made it.
 */
export function publishReceiving(saved: SavedReceiving): Promise<boolean> {
  publishing ??= (async () => {
    if (await isPublished(saved)) return true
    const owner = saved.owner as Address
    let current: string | null
    try {
      current = await fetchReceivingKey(owner)
    } catch (error) {
      // Kova unreachable: another time. A key that isn't ours is replaced with ours.
      if (!(error instanceof UntrustedKey)) return false
      current = 'untrusted'
    }
    if (current !== saved.meta) {
      await publishReceivingKey(owner, saved.meta, saved.signature)
      // Never published anywhere before: nothing paid before now can be for this wallet.
      if (current === null) await save(FRESH, { api: apiUrl, owner: saved.owner, meta: saved.meta, at: Date.now() })
    }
    await save(PUBLISHED, publishedMark(saved))
    changed()
    return true
  })()
    .catch((error) => {
      if (__DEV__) console.log('[private] key not published', error instanceof Error ? error.message : error)
      return false
    })
    .finally(() => {
      publishing = null
    })
  return publishing
}

/** When this phone first published the key, less a margin for the phone's clock: where the first look at the feed starts. */
export async function freshSince(owner: string, meta: string): Promise<number | null> {
  const fresh = await load<{ api: string; owner: string; meta: string; at: number } | null>(FRESH, null)
  return fresh && fresh.api === apiUrl && fresh.owner === owner.toLowerCase() && fresh.meta === meta ? fresh.at - 10 * 60_000 : null
}

export interface ScanState {
  api: string
  owner: string
  meta: string
  /** The feed's id this phone has read up to, kept a minute behind the newest. */
  cursor: string | null
  /** Ids after the cursor already checked. */
  checked: string[]
  /** Entries paid before this (ms) can't be this wallet's. Null: check everything. */
  since: number | null
  /** The first look through the feed has finished, so whatever turns up now is news. */
  caughtUp: boolean
  /** Found, newest first. */
  receipts: PrivateReceipt[]
}

/** One-time addresses this phone found to be this wallet's, so a move in from one isn't a stranger paying. */
let found = new Set<string>()
const loaded = load<ScanState | null>(SCAN, null).then((saved) => {
  if (saved) for (const r of saved.receipts) found.add(r.stealthAddress.toLowerCase())
})

export async function loadScan(owner: string, meta: string): Promise<ScanState> {
  const saved = await load<ScanState | null>(SCAN, null)
  if (saved && saved.api === apiUrl && saved.owner === owner.toLowerCase() && saved.meta === meta) return saved
  return { api: apiUrl, owner: owner.toLowerCase(), meta, cursor: null, checked: [], since: null, caughtUp: false, receipts: [] }
}

export async function saveScan(state: ScanState) {
  await loaded
  for (const r of state.receipts) found.add(r.stealthAddress.toLowerCase())
  await save(SCAN, state)
}

/** Whether money from `from` is this wallet's own, moved in from one of its one-time addresses. */
export async function isPrivateAddress(from: Address): Promise<boolean> {
  await loaded
  return found.has(from.toLowerCase())
}

/** A fresh history (a restored wallet): the feed is read again from the start, without a celebration. */
export async function resetScan() {
  await remove(SCAN)
  found = new Set()
}

/** Every wallet's keys on this phone, for signing out: the wallet makes them again when it's back. */
export async function forgetReceiving() {
  for (const owner of await load<string[]>(OWNERS, [])) {
    await SecureStore.deleteItemAsync(spendName(owner)).catch(() => {})
    await SecureStore.deleteItemAsync(viewName(owner)).catch(() => {})
  }
  await remove(OWNERS, PUBLISHED, FRESH, SCAN)
  found = new Set()
  changed()
}
