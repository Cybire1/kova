import type { LocalSite, Owner } from '../shared/types.js'

/**
 * What Kova for Chrome keeps in this browser (chrome.storage.local, only this extension can read
 * it): the connected wallet's address, the sites that may see it, and each budget's key. A site key can spend at most its
 * budget, which Monad enforces, so it's kept the way a session token would be; the wallet's own key
 * is never here, it stays behind the passkey on mykova.app.
 */
interface Stored {
  owner: Owner | null
  sites: Record<string, LocalSite>
  /** Sites that may see the address (eth_accounts), and when they were allowed. */
  connected: Record<string, number>
}

const KEY = 'kova'

export async function load(): Promise<Stored> {
  const got = (await chrome.storage.local.get(KEY))[KEY] as Partial<Stored> | undefined
  const sites = got?.sites ?? {}
  // Before budgets waited for a payment, every site with one was connected.
  const connected =
    got?.connected ?? Object.fromEntries(Object.values(sites).map((s) => [s.origin, s.createdAt]))
  return { owner: got?.owner ?? null, sites, connected }
}

async function save(next: Stored) {
  await chrome.storage.local.set({ [KEY]: next })
}

export async function setOwner(owner: Owner | null) {
  const stored = await load()
  // A different wallet: the old one's site keys can't spend for this one.
  const changed = !owner || stored.owner?.address.toLowerCase() !== owner.address.toLowerCase()
  await save({
    owner,
    sites: changed ? {} : stored.sites,
    connected: changed ? {} : stored.connected,
  })
}

export async function siteFor(origin: string): Promise<LocalSite | null> {
  return (await load()).sites[origin] ?? null
}

export async function putSite(site: LocalSite) {
  const stored = await load()
  stored.sites[site.origin] = site
  await save(stored)
}

export async function dropSite(origin: string) {
  const stored = await load()
  delete stored.sites[origin]
  await save(stored)
}

export async function isConnected(origin: string): Promise<boolean> {
  return origin in (await load()).connected
}

export async function markConnected(origin: string) {
  const stored = await load()
  if (origin in stored.connected) return
  stored.connected[origin] = Date.now()
  await save(stored)
}

/** The site stops seeing the address. A budget it has stays until it's removed. */
export async function forgetConnected(origin: string) {
  const stored = await load()
  delete stored.connected[origin]
  await save(stored)
}
