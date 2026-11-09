import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { ApiError } from './api'
import { apiUrl } from './network'

/**
 * Kova's own dashboard (/admin) is for Kova's team: the wallets in KOVA_ADMIN_WALLETS (comma
 * separated), each signing once to open it for 12 hours. The pages are drawn on this server, which
 * alone holds KOVA_ADMIN_SECRET for the API's admin routes, so nothing about people ever goes to a
 * browser that hasn't signed in. A wallet taken off the list is out on its next page.
 */

const COOKIE = 'kova_admin'
const HOURS = 12
const production = process.env.NODE_ENV === 'production'

export function teamWallets(): string[] {
  return (process.env.KOVA_ADMIN_WALLETS ?? '')
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter((a) => /^0x[0-9a-f]{40}$/.test(a))
}

export const isTeam = (address: string) => teamWallets().includes(address.toLowerCase())

/** Both halves are set on this server: the team list, and the secret for the API. */
export const dashboardReady = () => teamWallets().length > 0 && !!process.env.KOVA_ADMIN_SECRET

function secret() {
  const value = process.env.SESSION_SECRET
  if (!value && production) throw new Error('SESSION_SECRET is not set')
  return value ?? 'kova-dev-session-secret'
}

const mac = (body: string) =>
  createHmac('sha256', secret()).update(`kova-admin:${body}`).digest('base64url')

/** The signed-in team wallet, or null. */
export async function adminWallet(): Promise<string | null> {
  const raw = (await cookies()).get(COOKIE)?.value
  const [address, expires, given] = raw?.split('.') ?? []
  if (!address || !expires || !given) return null
  const want = mac(`${address}.${expires}`)
  if (want.length !== given.length || !timingSafeEqual(Buffer.from(want), Buffer.from(given)))
    return null
  if (Number(expires) < Date.now() / 1000) return null
  return dashboardReady() && isTeam(address) ? address : null
}

export async function startAdmin(address: string) {
  const expires = Math.floor(Date.now() / 1000) + HOURS * 3600
  const body = `${address.toLowerCase()}.${expires}`
  ;(await cookies()).set(COOKIE, `${body}.${mac(body)}`, {
    httpOnly: true,
    secure: production,
    sameSite: 'strict',
    path: '/',
    maxAge: HOURS * 3600,
  })
}

export async function endAdmin() {
  ;(await cookies()).delete(COOKIE)
}

/** The API's admin routes, as Kova's team. */
export async function admin<T>(path: string): Promise<T> {
  const key = process.env.KOVA_ADMIN_SECRET
  if (!key) throw new ApiError('The dashboard isn’t set up on this server.', 503)
  const response = await fetch(`${apiUrl}/v1/admin${path}`, {
    headers: { 'x-kova-admin': key },
    cache: 'no-store',
  })
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string; code?: string }
  }
  if (!response.ok)
    throw new ApiError(
      body.error?.message ?? `Kova answered ${response.status}`,
      response.status,
      body.error?.code,
    )
  return body as T
}

// --- What the API's admin routes answer (apps/api/src/routes/admin.ts) ---------------------------

export interface Attention {
  kind: 'card' | 'check' | 'payout' | 'naira'
  wallet: string
  title: string
  detail: string | null
  since: string | null
}

export interface Overview {
  network: string
  generated_at: string
  people: {
    total: number
    today: number
    week: number
    month: number
    active_week: number
    daily: { day: string; n: number }[]
  }
  held: { total: string; wallets: number } | null
  money: {
    payments_30d: { count: number; amount: string }
    naira: { count: number; amount: string; kobo: string }
    abroad: { count: number; amount: string }
    card_topups: { count: number; amount: string }
    shops: number
    keys: number
  }
  card: { not_sent: number; reviewing: number; approved: number; failed: number; cards: number }
  attention: Attention[]
}

export interface PersonRow {
  address: string
  first_seen: string | null
  last_seen: string | null
  name: string | null
  email: string | null
  shop: string | null
  balance: string | null
  check: string | null
  card: boolean
  shops: number
  cash_outs: number
  demo: boolean
}

export interface People {
  data: PersonRow[]
  total: number
  page: number
  pages: number
}

export interface Person {
  address: string
  first_seen: string | null
  last_seen: string | null
  balance: string | null
  demo: boolean
  check: {
    status: string
    reason: string | null
    card_problem: string | null
    name: string | null
    email: string | null
    phone: string | null
    account: boolean
    started: string | null
    updated: string | null
  } | null
  cards: { last_four: string; brand: string | null; state: string; created_at: string | null }[]
  card_topups: { count: number; amount: string }
  payouts: {
    id: string
    amount: string
    currency: string
    amount_to: string | null
    status: string
    failure: string | null
    created_at: string | null
    paid_at: string | null
  }[]
  naira: {
    id: string
    amount: string
    naira: string | null
    bank: string | null
    account_last4: string | null
    status: string
    failure: string | null
    created_at: string | null
    paid_at: string | null
  }[]
  shops: { id: string; name: string; slug: string; status: string; created_at: string | null }[]
  keys: {
    kind: string
    label: string | null
    holder: string | null
    status: string
    spend_limit: string | null
    created_at: string | null
    last_used_at: string | null
  }[]
  owner_name: string | null
  phone: { phone: string; verified_at: string | null } | null
  activity: {
    direction: 'in' | 'out'
    other: string
    amount: string
    tx_hash: string
    at: string | null
  }[]
}
