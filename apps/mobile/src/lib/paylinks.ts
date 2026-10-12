import * as SecureStore from 'expo-secure-store'
import { type Address, type Hex, isAddressEqual } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { shareWebUrl } from './config'
import { formatUsd } from './money'
import { load, save } from './storage'

/**
 * Links you sent, on this phone. Each link is a fresh one-time key: its address holds the dollars,
 * and the key goes into the link itself (after the #, which browsers never send to a server). Kova
 * never sees it. This phone keeps a copy in the Keychain, so an unclaimed link can be taken back.
 *
 * The key is saved before any money moves, under the link's address: if anything fails after the
 * dollars leave (no signal when Kova records the link, say), they are never stranded.
 */

const INDEX = 'kova.monad.links.v1'
/** Links claimed (or taken back) on this phone, by address: kept, so a relaunch still names the money. */
const CLAIMED = 'kova.monad.linkclaims.v1'
const keyName = (address: Address) => `kova.linkkey.${address.toLowerCase()}`

export interface SavedLink {
  address: Address
  /** Kova's id for it, once recorded. Null while the dollars are on their way to it. */
  id: string | null
  /** Base units. */
  amount: string
  note: string | null
  at: number
}

/** This wallet's link addresses, so money coming back from one is named for what it is. */
const own = new Set<string>()
/** Links claimed on this phone, and whose they were: their arrival already had its own celebration. */
const claiming = new Map<string, string>()
void load<Record<string, string>>(CLAIMED, {}).then((saved) => {
  for (const [address, name] of Object.entries(saved)) if (!claiming.has(address)) claiming.set(address, name)
})

export async function savedLinks(): Promise<SavedLink[]> {
  const list = await load<SavedLink[]>(INDEX, [])
  for (const l of list) own.add(l.address.toLowerCase())
  return list
}
void savedLinks()

async function update(change: (list: SavedLink[]) => SavedLink[]) {
  const next = change(await savedLinks())
  await save(INDEX, next)
  for (const l of next) own.add(l.address.toLowerCase())
}

/** A new one-time key for a link, kept in the Keychain before any money is sent to it. */
export async function newLinkKey(amount: bigint, note: string | null): Promise<{ key: Hex; address: Address }> {
  const key = generatePrivateKey()
  const address = privateKeyToAccount(key).address
  await SecureStore.setItemAsync(keyName(address), key, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY })
  await update((list) => [{ address, id: null, amount: amount.toString(), note, at: Date.now() }, ...list].slice(0, 200))
  return { key, address }
}

export async function linkKey(address: Address): Promise<Hex | null> {
  const key = await SecureStore.getItemAsync(keyName(address)).catch(() => null)
  return key && /^0x[0-9a-fA-F]{64}$/.test(key) ? (key as Hex) : null
}

export async function setLinkId(address: Address, id: string) {
  await update((list) => list.map((l) => (isAddressEqual(l.address, address) ? { ...l, id } : l)))
}

/** Forgets a link whose dollars never left (the send failed): nothing waits at its address. */
export async function forgetLink(address: Address) {
  await SecureStore.deleteItemAsync(keyName(address)).catch(() => {})
  await update((list) => list.filter((l) => !isAddressEqual(l.address, address)))
}

/** The link to share: Kova's web page for this network, which opens in Kova when it's installed. */
export const linkUrl = (id: string, key: Hex) => `${shareWebUrl}/c/${id}#${key}`

/** "$20" for whole dollars, "$20.50" otherwise: how people say it in a message. */
export function plainUsd(base: bigint) {
  const text = formatUsd(base)
  return text.endsWith('.00') ? text.slice(0, -3) : text
}

export function shareMessage(sender: string, amount: bigint, url: string, note?: string | null) {
  const first = sender.trim().split(' ')[0] || 'Someone'
  const why = note?.trim() ? ` (${note.trim()})` : ''
  return `${first} sent you ${plainUsd(amount)} on Kova${why}. Tap to claim it: ${url}`
}

export async function markClaiming(address: Address, name: string) {
  claiming.set(address.toLowerCase(), name)
  await save(CLAIMED, Object.fromEntries([...claiming.entries()].slice(-200)))
}

/**
 * What the arrival watcher should call money from `from`, if it came out of a link: the sender's
 * own link coming back, or one just claimed on this phone (which has its own celebration already).
 */
export function linkArrival(from: Address): { name: string; detail: string; quiet: boolean } | null {
  const key = from.toLowerCase()
  const claimed = claiming.get(key)
  if (own.has(key)) return { name: 'Your link', detail: 'Taken back', quiet: claimed !== undefined }
  if (claimed !== undefined) return { name: claimed, detail: 'Claimed from a link', quiet: true }
  return null
}
