import type { LocalSite, Owner } from '../shared/types.js'

/**
 * What Kova for Chrome keeps in this browser (chrome.storage.local, only this extension can read
 * it): the connected wallet's address, and each website's key. A site key can spend at most its
 * budget, which Monad enforces, so it's kept the way a session token would be; the wallet's own key
 * is never here, it stays behind the passkey on mykova.app.
 */
interface Stored {
  owner: Owner | null
  sites: Record<string, LocalSite>
}

const KEY = 'kova'

export async function load(): Promise<Stored> {
  const got = (await chrome.storage.local.get(KEY))[KEY] as Partial<Stored> | undefined
  return { owner: got?.owner ?? null, sites: got?.sites ?? {} }
}

async function save(next: Stored) {
  await chrome.storage.local.set({ [KEY]: next })
}

export async function setOwner(owner: Owner | null) {
  const stored = await load()
  // A different wallet: the old one's site keys can't spend for this one.
  const changed = !owner || stored.owner?.address.toLowerCase() !== owner.address.toLowerCase()
  await save({ owner, sites: changed ? {} : stored.sites })
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
