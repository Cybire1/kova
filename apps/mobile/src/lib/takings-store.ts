import { type StealthKeys, stealthMetaAddress, stealthViewKey } from '@kova/monad'
import * as SecureStore from 'expo-secure-store'
import type { Address, Hex } from 'viem'
import { load, save } from './storage'

/**
 * Where the phone keeps a shop's private takings keys, the way the wallet keeps its own. Every shop
 * has its own keys (its owner's wallet signs a message naming the shop), so they're kept by shop.
 *
 * The view half (the viewing key, and the spending public key) finds the shop's sales. It can't move
 * money, so it waits in the Keychain without a biometric lock, like the vault key, and the Today
 * screen can count the takings without asking for Face ID. The spending key can move them: it sits
 * behind Face ID, like the wallet's own secret, and is only read to move takings home. Either can
 * be made again from the wallet with one signature, so losing them loses nothing.
 */
const keyName = (kind: 'view' | 'spend', shop: string) => `kova.monad.takings.${kind}.v2.${shop.replace(/[^\w.-]/g, '')}`
/** The shops whose keys this phone holds, so signing out forgets every one. */
const SHOPS = 'kova.monad.takings.shops.v1'
/** One-time addresses this phone has found to be the shop's: checked once, named in the wallet. */
const FOUND = 'kova.monad.takings.found.v1'

export interface SavedView {
  /** The wallet the keys come from, lowercase. */
  owner: string
  /** `st:eth:0x…`, what Kova was given. */
  meta: string
  /** `kova-view:0x…`, the accountant's view. */
  view: string
}

export async function keepTakingsKeys(owner: Address, shop: string, keys: StealthKeys, locked: boolean): Promise<SavedView> {
  const shops = await load<string[]>(SHOPS, [])
  if (!shops.includes(shop)) await save(SHOPS, [...shops, shop])
  // The spending key first: a phone that has the view but not the key would show money it can't move.
  // Replacing a Face ID item would ask for Face ID again, so the old copy goes first (deleting doesn't ask).
  await SecureStore.deleteItemAsync(keyName('spend', shop)).catch(() => {})
  await SecureStore.setItemAsync(
    keyName('spend', shop),
    keys.spendingPrivateKey,
    locked
      ? { requireAuthentication: true, keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY }
      : { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
  )
  const saved: SavedView = { owner: owner.toLowerCase(), meta: stealthMetaAddress(keys), view: stealthViewKey(keys) }
  await SecureStore.setItemAsync(keyName('view', shop), JSON.stringify(saved), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY })
  return saved
}

/** The shop's view half, if this wallet has made its keys on this phone. No Face ID: it can't move money. */
export async function readTakingsView(owner: Address, shop: string): Promise<SavedView | null> {
  const raw = await SecureStore.getItemAsync(keyName('view', shop)).catch(() => null)
  if (!raw) return null
  try {
    const saved = JSON.parse(raw) as SavedView
    return saved.owner === owner.toLowerCase() && saved.meta && saved.view ? saved : null
  } catch {
    return null
  }
}

/**
 * The spending key, after Face ID. Null when the Keychain no longer has it (a new Face ID, a
 * restored phone), so the wallet can make it again. Throws when the owner cancels.
 */
export async function readSpendingKey(shop: string, prompt: string): Promise<Hex | null> {
  try {
    const key = await SecureStore.getItemAsync(keyName('spend', shop), { authenticationPrompt: prompt })
    return key && /^0x[0-9a-fA-F]{64}$/.test(key) ? (key as Hex) : null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/cancel/i.test(message)) throw new Error('Face ID was cancelled. Nothing moved.')
    if (/authentication failed/i.test(message)) throw new Error('Face ID didn’t work. Nothing moved.')
    // Gone from the Keychain: the wallet can make it again.
    return null
  }
}

/** Every shop's keys on this phone, for signing out: the wallet makes them again when it's back. */
export async function forgetTakingsKeys() {
  for (const shop of await load<string[]>(SHOPS, [])) {
    await SecureStore.deleteItemAsync(keyName('spend', shop)).catch(() => {})
    await SecureStore.deleteItemAsync(keyName('view', shop)).catch(() => {})
  }
  await save(SHOPS, [])
  found = { meta: '', addresses: new Set() }
  await save(FOUND, null)
}

let found: { meta: string; addresses: Set<string> } = { meta: '', addresses: new Set() }
const loaded = load<{ meta: string; addresses: string[] } | null>(FOUND, null).then((saved) => {
  if (saved) found = { meta: saved.meta, addresses: new Set([...saved.addresses, ...found.addresses]) }
})

/** The addresses already found for these keys, so they aren't checked again. */
export async function foundFor(meta: string): Promise<ReadonlySet<string>> {
  await loaded
  return found.meta === meta ? found.addresses : new Set()
}

export async function rememberFound(meta: string, addresses: string[]) {
  await loaded
  if (found.meta !== meta) found = { meta, addresses: new Set() }
  for (const address of addresses) found.addresses.add(address.toLowerCase())
  await save(FOUND, { meta, addresses: [...found.addresses].slice(-2000) })
}

/** Whether money from `from` is the shop's own takings coming home from one of its sale addresses. */
export async function isTakingsAddress(from: Address): Promise<boolean> {
  await loaded
  return found.addresses.has(from.toLowerCase())
}

/** At once, for screens: whether a charge's pay-to address is one of the shop's private sales. */
export const isFoundAddress = (address: string) => found.addresses.has(address.toLowerCase())
