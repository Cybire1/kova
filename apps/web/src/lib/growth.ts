/**
 * Getting Kova to new people, and counting it: where visitors to /try came from, and the public
 * numbers /stats shows. Shared by the browser (the /try checklist) and the server (/stats), so
 * nothing here touches a key, a session or a server-only module.
 */

export type Network = 'testnet' | 'mainnet'

/** Each network's own API: its own database, so its own numbers. */
export const PUBLIC_API: Record<Network, string> = {
  testnet: 'https://api-monad.up.railway.app',
  mainnet: 'https://api-monad-mainnet.up.railway.app',
}

/** The free way in: the test network's site, with $5 of test dollars a day. */
export const TESTNET_SITE = 'https://web-monad.up.railway.app'

/** The shared demo shop the checklist sends people to, on the test network. */
export const TRY_STALL = 'adas-bakery-a2cf'

// --- Where people came from --------------------------------------------------------------

/** Where a visitor came from, as the link said (?ref=x): the first one this browser was given. */
export const REF_KEY = 'kova.web.ref.v1'
/** What /try has counted from this browser, and what it has seen done, per wallet. */
export const TRY_KEY = 'kova.web.try.v1'
/** The web wallet's "who you are" (components/wallet/provider.tsx): its address and name. */
export const PROFILE_KEY = 'kova.web.profile.v1'
/** Set by the wallet when it opens or signs in to a shop from this browser. */
export const shopKey = (address: string) => `kova.web.shop.v1.${address.toLowerCase()}`

/** What the API takes as a source: lowercase letters and digits, with - and _, up to 32. */
const REF = /^[a-z0-9][a-z0-9_-]{0,31}$/

/** "?ref=Monad Discord" → "monad-discord"; anything that can't be made one is null. */
export function cleanRef(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const ref = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+/, '')
    .slice(0, 32)
    .replace(/[-_]+$/, '')
  return REF.test(ref) ? ref : null
}

/** A source's name for people: the labels Kova's own links use, and anything else as given. */
const SOURCE_NAMES: Record<string, string> = {
  direct: 'Straight to the page',
  friend: 'A friend’s post',
  stats: 'Kova, live',
  mainnet: 'Kova on mainnet',
  x: 'X',
  twitter: 'X',
  tg: 'Telegram',
  telegram: 'Telegram',
  discord: 'Discord',
  github: 'GitHub',
  devpost: 'Devpost',
}

export const sourceName = (ref: string) => SOURCE_NAMES[ref] ?? ref

// --- The public numbers ------------------------------------------------------------------

/** GET /v1/public/stats on one network: totals only, never a person. */
export interface NetworkStats {
  network: Network
  people: number
  /** People first seen in the last seven days. */
  people_7d: number
  shops: number
  payments: number
  /** Dollars paid through Kova on this network, e.g. "832.35"; on testnet, test dollars. */
  volume: string
  links: number
  links_claimed: number
  /** The last 14 days, oldest first, by UTC date. */
  daily: { date: string; people: number; payments: number }[]
  sources: { ref: string; visits: number; wallets: number }[]
  updated_at: string
}

const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null

/** A reply from the API, checked field by field: an API mid-deploy can't break the page. */
export function readStats(body: unknown): NetworkStats | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (b.object !== 'stats' || (b.network !== 'testnet' && b.network !== 'mainnet')) return null
  const people = count(b.people)
  const people_7d = count(b.people_7d)
  const shops = count(b.shops)
  const payments = count(b.payments)
  const links = count(b.links)
  const links_claimed = count(b.links_claimed)
  if (
    people === null ||
    people_7d === null ||
    shops === null ||
    payments === null ||
    links === null ||
    links_claimed === null ||
    typeof b.volume !== 'string' ||
    !/^\d+(\.\d+)?$/.test(b.volume)
  )
    return null
  const daily = Array.isArray(b.daily)
    ? b.daily.flatMap((d) => {
        const day = d as Record<string, unknown>
        const p = count(day?.people)
        const n = count(day?.payments)
        return typeof day?.date === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(day.date) &&
          p !== null &&
          n !== null
          ? [{ date: day.date, people: p, payments: n }]
          : []
      })
    : []
  const sources = Array.isArray(b.sources)
    ? b.sources.flatMap((s) => {
        const row = s as Record<string, unknown>
        const ref = cleanRef(row?.ref)
        const visits = count(row?.visits)
        const wallets = count(row?.wallets)
        return ref && visits !== null && wallets !== null ? [{ ref, visits, wallets }] : []
      })
    : []
  const updated = typeof b.updated_at === 'string' && !Number.isNaN(Date.parse(b.updated_at))
  return {
    network: b.network,
    people,
    people_7d,
    shops,
    payments,
    volume: b.volume,
    links,
    links_claimed,
    daily,
    sources,
    updated_at: updated ? (b.updated_at as string) : new Date().toISOString(),
  }
}

/** Both networks' numbers as one: totals, the 14 days side by side, and the sources merged. */
export interface Together {
  people: number
  people_7d: number
  shops: number
  payments: number
  /** In dollars; testnet's are test dollars, so the page always says which is which. */
  volume: number
  links: number
  links_claimed: number
  daily: { date: string; people: number; payments: number }[]
  sources: { ref: string; visits: number; wallets: number }[]
  /** The older of the two, so "updated" never claims fresher numbers than it has. */
  updated_at: string | null
}

export function together(parts: NetworkStats[]): Together {
  const sum = (pick: (s: NetworkStats) => number) => parts.reduce((total, s) => total + pick(s), 0)
  const days = new Map<string, { people: number; payments: number }>()
  for (const s of parts)
    for (const d of s.daily) {
      const day = days.get(d.date) ?? { people: 0, payments: 0 }
      days.set(d.date, { people: day.people + d.people, payments: day.payments + d.payments })
    }
  const refs = new Map<string, { visits: number; wallets: number }>()
  for (const s of parts)
    for (const r of s.sources) {
      const row = refs.get(r.ref) ?? { visits: 0, wallets: 0 }
      refs.set(r.ref, { visits: row.visits + r.visits, wallets: row.wallets + r.wallets })
    }
  const times = parts.map((s) => s.updated_at).sort()
  return {
    people: sum((s) => s.people),
    people_7d: sum((s) => s.people_7d),
    shops: sum((s) => s.shops),
    payments: sum((s) => s.payments),
    volume: sum((s) => Number(s.volume)),
    links: sum((s) => s.links),
    links_claimed: sum((s) => s.links_claimed),
    daily: [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([date, d]) => ({ date, ...d })),
    sources: [...refs.entries()]
      .map(([ref, r]) => ({ ref, ...r }))
      .sort((a, b) => b.wallets - a.wallets || b.visits - a.visits || a.ref.localeCompare(b.ref)),
    updated_at: times[0] ?? null,
  }
}

/** 1234 → "1,234". */
export const whole = (n: number) => n.toLocaleString('en-US')

/** Dollars as people read them: cents while they matter, whole dollars past $10,000. */
export function dollars(n: number) {
  const big = n >= 10_000
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: big ? 0 : 2,
    maximumFractionDigits: big ? 0 : 2,
  })
}

/** "just now", "a minute ago", "5 minutes ago", "2 hours ago". */
export function agoText(iso: string, now: number) {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 2) return 'a minute ago'
  if (minutes < 60) return `${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  return hours < 2 ? 'an hour ago' : `${hours} hours ago`
}
