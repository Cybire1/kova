import { getAddress } from 'viem'

/** Dollars from AUSD base units (6 decimals): "1250000" → "$1.25". Never through a float. */
export function usd(units: string | null | undefined, cents = true): string {
  if (units === null || units === undefined) return '—'
  const value = BigInt(units)
  const negative = value < 0n
  const abs = negative ? -value : value
  const whole = abs / 1_000_000n
  const fraction = (abs % 1_000_000n) / 10_000n
  const text = `$${whole.toLocaleString('en-US')}${cents ? `.${fraction.toString().padStart(2, '0')}` : ''}`
  return negative ? `−${text}` : text
}

/** Naira from kobo: "1250000" → "₦12,500". */
export function naira(kobo: string | null | undefined): string {
  if (!kobo) return '—'
  return `₦${(BigInt(kobo) / 100n).toLocaleString('en-US')}`
}

/** "0x1A2b…9F0e", as the explorer writes it. */
export function short(address: string): string {
  const a = getAddress(address)
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

/** "9 Nov, 16:40" in the viewer's time zone (or Lagos). */
export function when(iso: string | null | undefined, tz?: string): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz ?? 'Africa/Lagos',
  }).format(new Date(iso))
}

/** "just now", "12m ago", "3h ago", "5d ago". */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—'
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86_400 * 60) return `${Math.floor(s / 86_400)}d ago`
  return `${Math.floor(s / (86_400 * 30))}mo ago`
}

/** The ID check's status in words, and its tone on the page. */
export function checkState(status: string | null | undefined): {
  label: string
  tone: 'quiet' | 'wait' | 'good' | 'bad'
} {
  switch (status) {
    case 'approved':
      return { label: 'Approved', tone: 'good' }
    case 'pending':
      return { label: 'Reviewing', tone: 'wait' }
    case 'incomplete':
      return { label: 'Not sent', tone: 'quiet' }
    case 'failed':
      return { label: 'Failed', tone: 'bad' }
    case 'blocked':
      return { label: 'Blocked', tone: 'bad' }
    case null:
    case undefined:
      return { label: 'None', tone: 'quiet' }
    default:
      return { label: status, tone: 'quiet' }
  }
}

/** A cash-out's or payout's status in words, and its tone. */
export function moneyState(status: string): {
  label: string
  tone: 'quiet' | 'wait' | 'good' | 'bad'
} {
  if (status === 'paid') return { label: 'Paid', tone: 'good' }
  if (status === 'failed') return { label: 'Failed', tone: 'bad' }
  if (status === 'held' || status === 'refunding') return { label: status, tone: 'bad' }
  if (status === 'refunded') return { label: 'Sent back', tone: 'quiet' }
  if (status === 'expired') return { label: 'Expired', tone: 'quiet' }
  return { label: status, tone: 'wait' }
}
