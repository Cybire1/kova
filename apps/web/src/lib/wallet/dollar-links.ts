import {
  getToken,
  type NetworkId,
  networkByChainId,
  randomNonce,
  type TransferAuthorization,
  tokenByAddress,
  toSignedAuthorization,
  transferAuthorizationTypedData,
} from '@kova/monad'
import { type Address, getAddress, type Hex, isAddressEqual } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { balanceOf } from './chain'
import { formatUsd } from './money'

/**
 * Links with dollars in them, as the app makes them (apps/mobile src/lib/paylinks.ts). The sender's
 * wallet sends the dollars to a fresh one-time address and the link carries that address's key,
 * after the #, which a browser never sends to any server: `https://mykova.app/c/<id>#<key>`.
 * Whoever opens it signs, with that key, one transfer of everything at the address to their own
 * wallet, and Kova submits it and pays the gas. The sender keeps the key too, in this browser, so an
 * unclaimed link can be taken back the same way.
 */

export type LinkStatus = 'open' | 'claimed' | 'returned'

/** GET /v1/public/links/:id. */
export interface DollarLink {
  id: string
  status: LinkStatus
  /** Dollars, e.g. "20.00". */
  amount: string
  currency: string
  token: string
  chain_id: number
  link_address: string
  sender_address: string
  sender_name: string | null
  note: string | null
  display_currency: string | null
  claimed_by: string | null
  claim_tx: string | null
  claim_explorer_url: string | null
  claimed_at: string | null
  created_at: string
}

/** A claim Kova just submitted: the link as it is now, and how long Monad took. */
export interface Claimed extends DollarLink {
  ms: number
}

/** The key from a link's #, with or without 0x, or null if it isn't one. */
export function linkKeyFrom(fragment: string | null | undefined): Hex | null {
  const raw = (fragment ?? '').trim().replace(/^#/, '')
  const hex = raw.startsWith('0x') || raw.startsWith('0X') ? raw.slice(2) : raw
  return /^[0-9a-fA-F]{64}$/.test(hex) ? (`0x${hex.toLowerCase()}` as Hex) : null
}

/** Whether `key` is the key of the link at `address`: a link with a wrong or cut-off key can't be claimed. */
export function keyOpens(key: Hex, address: string): boolean {
  try {
    return isAddressEqual(privateKeyToAccount(key).address, getAddress(address))
  } catch {
    return false
  }
}

/** The link to share. The key goes after the #, so it never reaches a server, Kova's included. */
export const linkUrl = (origin: string, id: string, key: Hex) => `${origin}/c/${id}#${key}`

/** "$20" for whole dollars, "$20.50" otherwise: how people say it in a message. */
export function plainUsd(base: bigint) {
  const text = formatUsd(base)
  return text.endsWith('.00') ? text.slice(0, -3) : text
}

/** The words that go with a shared link, the same as the app's. */
export function shareMessage(sender: string, amount: bigint, url: string, note?: string | null) {
  const first = sender.trim().split(' ')[0] || 'Someone'
  const why = note?.trim() ? ` (${note.trim()})` : ''
  return `${first} sent you ${plainUsd(amount)} on Kova${why}. Tap to claim it: ${url}`
}

/** "20.00" → base units. */
export const linkBase = (link: Pick<DollarLink, 'amount'>) =>
  BigInt(Math.round(Number(link.amount) * 1e6))

export const linkNetwork = (link: Pick<DollarLink, 'chain_id'>): NetworkId =>
  networkByChainId(link.chain_id).id

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
    cache: 'no-store',
  })
  const json = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new Error(json.error ?? `Kova didn’t answer (${response.status}).`)
  return json as T
}

export const fetchLink = (id: string) => call<DollarLink>(`/api/links/${encodeURIComponent(id)}`)

/** A sender's links, newest first, wherever they made them: here or in the app. */
export const linksFrom = (sender: string) =>
  call<{ data: DollarLink[] }>(`/api/links?sender=${encodeURIComponent(sender)}`).then(
    (r) => r.data,
  )

/**
 * Records a link once its dollars are at its address: Kova reads the amount from Monad. Monad has
 * the dollars the moment the send settles, but the API's node can be a block behind, so a link
 * that looks empty is asked about again for a few seconds before giving up.
 */
export async function recordLink(body: {
  link_address: string
  sender_address: string
  sender_name?: string
  note?: string
  display_currency?: string
}): Promise<DollarLink> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call<DollarLink>('/api/links', { method: 'POST', body: JSON.stringify(body) })
    } catch (error) {
      if (attempt >= 6 || !/no dollars yet/i.test(String((error as Error).message))) throw error
      await new Promise((resolve) => setTimeout(resolve, 700))
    }
  }
}

/**
 * Claims a link to `to`: the link's key signs a transfer of everything its address holds, and Kova
 * submits it and pays the gas. Taking a link back is the same claim, to the sender's own wallet.
 */
export async function claimLink(link: DollarLink, key: Hex, to: Address): Promise<Claimed> {
  const network = linkNetwork(link)
  const token = tokenByAddress(network, link.token as Address) ?? getToken(network, 'AUSD')
  const account = privateKeyToAccount(key)
  if (!isAddressEqual(account.address, getAddress(link.link_address)))
    throw new Error('This link is incomplete. Ask for it again.')
  // Everything at the address: Kova only takes a claim for all of it.
  const held = await balanceOf(network, account.address).catch(() => linkBase(link))
  if (held === 0n) throw new Error('This link is empty now. Someone claimed it a moment ago.')
  const authorization: TransferAuthorization = {
    from: account.address,
    to: getAddress(to),
    value: held,
    validAfter: 0n,
    validBefore: BigInt(Math.floor(Date.now() / 1000) + 600),
    nonce: randomNonce(),
  }
  const signature = await account.signTypedData(
    transferAuthorizationTypedData(token, link.chain_id, authorization),
  )
  return call<Claimed>(`/api/links/${encodeURIComponent(link.id)}/claim`, {
    method: 'POST',
    body: JSON.stringify(toSignedAuthorization(token.address, authorization, signature)),
  })
}

// --- The links this browser made ------------------------------------------------------------

/**
 * Links made here, keyed by Kova's link id, with their keys, so they can be shared again or taken
 * back. A key is saved before any money moves, under `pending:<address>` until Kova has recorded the
 * link: if anything fails after the dollars leave, they are never stranded.
 */
export interface KeptLink {
  key: Hex
  address: Address
  /** Base units. */
  amount: string
  note: string | null
  at: number
  id?: string
}

const STORE = 'kova.web.links.v1'

export function keptLinks(): Record<string, KeptLink> {
  try {
    const raw = localStorage.getItem(STORE)
    const parsed = raw ? (JSON.parse(raw) as Record<string, KeptLink>) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function keep(next: Record<string, KeptLink>) {
  try {
    localStorage.setItem(STORE, JSON.stringify(next))
  } catch {
    // Private mode or full storage: the link still works; it just can't be taken back from here.
  }
  window.dispatchEvent(new Event('kova-links'))
}

/** A fresh one-time key, kept before any dollars are sent to its address. */
export function newLinkKey(amount: bigint, note: string | null): KeptLink {
  const key = generatePrivateKey()
  const kept: KeptLink = {
    key,
    address: privateKeyToAccount(key).address,
    amount: amount.toString(),
    note,
    at: Date.now(),
  }
  keep({ ...keptLinks(), [`pending:${kept.address.toLowerCase()}`]: kept })
  return kept
}

/** Kova recorded the link: keep its key under the link's id from now on. */
export function settleLinkKey(kept: KeptLink, id: string) {
  const all = keptLinks()
  delete all[`pending:${kept.address.toLowerCase()}`]
  keep({ ...all, [id]: { ...kept, id } })
}

/** Forgets a key whose dollars never left (the send failed): nothing waits at its address. */
export function dropLinkKey(kept: KeptLink) {
  const all = keptLinks()
  delete all[`pending:${kept.address.toLowerCase()}`]
  keep(all)
}

/** The key this browser kept for a link, if it made it. */
export function keptKey(id: string): Hex | null {
  return keptLinks()[id]?.key ?? null
}
