import type { Payout, Recipient } from './payouts'

/**
 * Development only: cashing out with three saved accounts and payouts that land, so the screens
 * can be tried (and filmed) on a simulator without moving money. The countries, their ways out and
 * the exchange rates are the live ones, read from Kova's mainnet API; the accounts, quotes and
 * payouts are made up here. The dev link turns it on with `cashout=demo`; release builds never do.
 */

/** Where the live list of countries and rates comes from, whatever network the app is on. */
export const DEMO_API = 'https://api-monad-mainnet.up.railway.app'

/** The pretend wallet's dollars, in base units: $144.02. */
export const DEMO_BALANCE = 144_020_000n

let on = false
/** `cashout=demo-check`: a wallet that hasn't done the ID check yet, to see Cash out ask for it. */
let check = false
let saved: Recipient[] = []
const payouts = new Map<string, { payout: Payout; at: number }>()

export const demoCashOutOn = () => __DEV__ && on
export const demoNeedsCheck = () => __DEV__ && on && check

export function startDemoCashOut(options: { check?: boolean } = {}) {
  on = true
  check = !!options.check
  saved = [
    recipient(
      'us_ach',
      'US',
      'USD',
      'United States',
      'Bank account',
      'Same or next day',
      'Lead Bank •••• 5521',
    ),
    recipient(
      'ke_momo',
      'KE',
      'KES',
      'Kenya',
      'M-Pesa or mobile money',
      'Instant',
      'M-Pesa •••• 4410',
    ),
    recipient(
      'gb_fps',
      'GB',
      'GBP',
      'United Kingdom',
      'Bank account',
      'Same day',
      'Monzo •••• 1182',
    ),
  ]
  payouts.clear()
}

function recipient(
  corridor: string,
  country: string,
  currency: string,
  name: string,
  title: string,
  speed: string,
  label: string,
): Recipient {
  return {
    id: `demo-${corridor}-${Math.random().toString(36).slice(2, 8)}`,
    corridor,
    country,
    currency,
    name,
    flag: '',
    title,
    speed,
    holder_name: 'Ada Okafor',
    label,
  }
}

/** Before the ID check, only accounts in the person's own name would count: none yet. */
export const demoRecipients = () => (check ? [] : saved)

export function demoAddRecipient(
  corridor: {
    id: string
    country: string
    currency: string
    name: string
    title: string
    speed: string
    fields: { key: string; options?: { value: string; label: string }[] }[]
  },
  fields: Record<string, string>,
): Recipient {
  // The account's own number: an account, IBAN or phone; an email only for Interac.
  const own = ['account_number', 'iban', 'phone_number', 'email']
    .map((k) => fields[k]?.replace(/\s/g, ''))
    .find(Boolean)
  const network = corridor.fields
    .find((f) => f.key === 'scheme')
    ?.options?.find((o) => o.value === fields.scheme)?.label
  const name = fields.bank_name || network || corridor.title
  const r = recipient(
    corridor.id,
    corridor.country,
    corridor.currency,
    corridor.name,
    corridor.title,
    corridor.speed,
    `${name} •••• ${(own ?? '0000').slice(-4)}`,
  )
  r.holder_name = fields.holder_name || 'Ada Okafor'
  saved = [r, ...saved.filter((s) => s.label !== r.label)]
  return r
}

/** A quote at the live rate, with Kova's fee, held for two minutes. */
export async function demoQuote(recipientId: string, dollars: string): Promise<Payout> {
  const r = saved.find((s) => s.id === recipientId)
  if (!r) throw new Error('Pick where to cash out to.')
  const info = (await fetch(`${DEMO_API}/v1/payouts`).then((x) => x.json())) as { fee_bps: number }
  const amount = Number(dollars)
  const fee = Math.ceil((amount * info.fee_bps) / 10_000 / 0.01) * 0.01
  const rate =
    r.currency === 'USD'
      ? 1
      : ((await fetch(`${DEMO_API}/v1/payouts/rates/${r.currency === 'USDC' ? 'USC' : r.currency}`)
          .then((x) => x.json())
          .then((x: { per_dollar: number }) => x.per_dollar)) ?? 1)
  return {
    id: `demo-payout-${Date.now()}`,
    amount: amount.toFixed(2),
    fee: fee.toFixed(2),
    currency: r.currency,
    amount_to: ((amount - fee) * rate).toFixed(2),
    rate: rate.toString(),
    recipient: r,
    status: 'quoted',
    pay: {
      token: '0x',
      to: null,
      value: '0',
      nonce: '0x',
      valid_before: 0,
    } as unknown as Payout['pay'],
    tx_hash: null,
    refund_tx_hash: null,
    failure: null,
    expires_at: new Date(Date.now() + 120_000).toISOString(),
    created_at: new Date().toISOString(),
  }
}

/** Sends a quoted demo payout: on its way at once, in the account a few seconds later. */
export function demoSend(quote: Payout): Payout {
  // Sent "at 09:41", the time the simulator's status bar is pinned to for recordings.
  const at = new Date()
  at.setHours(9, 41, 0, 0)
  const payout: Payout = { ...quote, status: 'sending', created_at: at.toISOString() }
  payouts.set(payout.id, { payout, at: Date.now() })
  return payout
}

export function demoPayout(id: string): Payout {
  const p = payouts.get(id)
  if (!p) throw new Error('Not found')
  return Date.now() - p.at > 7_000 ? { ...p.payout, status: 'paid' } : p.payout
}
