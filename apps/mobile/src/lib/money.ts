import { formatAmount, parseAmount } from '@kova/monad'

/**
 * Money in the app is dollars on-chain (AUSD), shown in whatever currency a person thinks in.
 *
 * Kova never converts money (DECISIONS D-012). Local amounts are shown at a published
 * reference rate, always labelled as approximate, so a price in euros or naira becomes a
 * clear number of dollars to pay.
 */
export const displayCurrencies = ['USD', 'EUR', 'GBP', 'NGN', 'KES', 'MXN'] as const
export type DisplayCurrency = (typeof displayCurrencies)[number]

export const currencyInfo: Record<
  DisplayCurrency,
  { symbol: string; name: string; perUsd: number; decimals: number }
> = {
  USD: { symbol: '$', name: 'US dollars', perUsd: 1, decimals: 2 },
  EUR: { symbol: '€', name: 'Euros', perUsd: 0.92, decimals: 2 },
  GBP: { symbol: '£', name: 'British pounds', perUsd: 0.79, decimals: 2 },
  NGN: { symbol: '₦', name: 'Naira', perUsd: 1375, decimals: 0 },
  KES: { symbol: 'KSh', name: 'Kenyan shillings', perUsd: 129, decimals: 0 },
  MXN: { symbol: 'MX$', name: 'Mexican pesos', perUsd: 18.4, decimals: 2 },
}

const EURO_REGIONS = new Set([
  'AT',
  'BE',
  'CY',
  'DE',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PT',
  'SI',
  'SK',
])

/** A first guess at the currency someone thinks in, from their phone's region. They can change it. */
export function guessCurrency(): DisplayCurrency {
  try {
    const region = Intl.DateTimeFormat().resolvedOptions().locale.split(/[-_]/)[1]?.toUpperCase()
    if (region === 'NG') return 'NGN'
    if (region === 'KE') return 'KES'
    if (region === 'GB') return 'GBP'
    if (region === 'MX') return 'MXN'
    if (region && EURO_REGIONS.has(region)) return 'EUR'
  } catch {
    // No Intl region: dollars.
  }
  return 'USD'
}

function grouped(value: number, decimals: number) {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** Base units (6 decimals) → "$1,240.50". */
export function formatUsd(base: bigint, options: { sign?: boolean } = {}): string {
  const negative = base < 0n
  const abs = negative ? -base : base
  const text = `$${grouped(Number(formatAmount(abs)), 2)}`
  if (!options.sign) return negative ? `−${text}` : text
  return `${negative ? '−' : '+'}${text}`
}

/** Dollars → an amount in a display currency, e.g. 200 USD → "€184.00". */
export function formatLocal(usd: number, currency: DisplayCurrency): string {
  const info = currencyInfo[currency]
  return `${info.symbol}${grouped(usd * info.perUsd, info.decimals)}`
}

/** An amount typed in a display currency → dollars owed, rounded up so a merchant is never short. */
export function localToUsd(amount: number, currency: DisplayCurrency): string {
  const cents = Math.ceil((amount / currencyInfo[currency].perUsd) * 100 - 1e-9)
  return (cents / 100).toFixed(2)
}

export function toBase(dollars: string): bigint {
  return parseAmount(dollars)
}

export function baseToNumber(base: bigint): number {
  return Number(formatAmount(base))
}

export type Key = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'del'

/** Applies a keypad press to a typed amount, keeping it a valid number with `decimals` places. */
export function applyKey(value: string, key: Key, decimals = 2): string {
  if (key === 'del') return value.slice(0, -1)
  if (key === '.') {
    if (decimals === 0 || value.includes('.')) return value
    return value === '' ? '0.' : `${value}.`
  }
  const [whole = '', frac] = value.split('.')
  if (frac !== undefined && frac.length >= decimals) return value
  if (frac === undefined && whole.length >= 9) return value
  if (value === '0') return key
  return value + key
}

/** Typed digits → "1,240.5" with grouping, for display while typing. */
export function groupTyped(value: string): string {
  if (value === '') return '0'
  const [whole = '0', frac] = value.split('.')
  const w = Number(whole).toLocaleString('en-US')
  return frac === undefined ? w : `${w}.${frac}`
}
