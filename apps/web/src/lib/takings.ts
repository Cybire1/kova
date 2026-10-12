import {
  checkStealthAddress,
  explorerAddressUrl,
  getNetwork,
  type NetworkId,
  parseStealthViewKey,
  type StealthKeys,
  stealthViewKey,
} from '@kova/monad'
import { getAddress, type Hex } from 'viem'
import type { Announcement } from '@/lib/api'
import { toBase } from './wallet/money'

/**
 * Private takings, read in the browser (packages/monad/src/stealth.ts does the cryptography).
 *
 * Every sale of a shop with private takings on is paid to a fresh one-time address, and Kova
 * announces each sale to everyone with no shop named. A shop's viewing key picks its own out of
 * everyone's. An accountant's link carries that viewing key and the public half of the spending
 * key after the #, which a browser never sends to any server, Kova's included: it sees every sale
 * and can move none of them.
 */

/** What finds a shop's sales: the viewing key and the spending public key. It can't move money. */
export type ViewKey = ReturnType<typeof parseStealthViewKey>

export const viewOf = (keys: StealthKeys): ViewKey => parseStealthViewKey(stealthViewKey(keys))

/** The accountant's link: the view key, then the shop's name, after the #. */
export const viewLink = (origin: string, keys: StealthKeys, shop: string) =>
  `${origin}/books#${stealthViewKey(keys)}&name=${encodeURIComponent(shop)}`

/** The view key and the shop's name from a link's #, or null when the key is missing or cut short. */
export function readViewLink(fragment: string): { view: ViewKey; name: string | null } | null {
  const [key = '', ...rest] = fragment.replace(/^#/, '').split('&')
  try {
    const view = parseStealthViewKey(decodeURIComponent(key).trim())
    const name = new URLSearchParams(rest.join('&')).get('name')?.trim().slice(0, 80)
    return { view, name: name || null }
  } catch {
    return null
  }
}

type Findable = Pick<Announcement, 'stealth_address' | 'ephemeral_public_key' | 'view_tag'>

/** Whether a sale is this view's: the address its key would open is the address that was paid. */
export function opens(view: ViewKey, sale: Findable): boolean {
  try {
    return (
      checkStealthAddress(view, {
        ephemeralPublicKey: sale.ephemeral_public_key as Hex,
        viewTag: sale.view_tag as Hex,
        stealthAddress: getAddress(sale.stealth_address),
      }) !== null
    )
  } catch {
    return false
  }
}

/**
 * Looks through `list` for this view's sales, a few milliseconds at a time so the page keeps
 * moving: each check is an elliptic-curve multiplication, about a millisecond. Returns null if
 * `stopped` says the page moved on.
 */
export async function scan<T extends Findable>(
  view: ViewKey,
  list: T[],
  onProgress: (checked: number, mine: T[]) => void,
  stopped: () => boolean,
): Promise<T[] | null> {
  const mine: T[] = []
  let checked = 0
  let told = 0
  while (checked < list.length) {
    const until = performance.now() + 14
    while (checked < list.length && performance.now() < until) {
      const sale = list[checked] as T
      if (opens(view, sale)) mine.push(sale)
      checked++
    }
    // Tell the page a few times a second, not every slice: each telling redraws it.
    if (performance.now() - told > 90 || checked === list.length) {
      told = performance.now()
      onProgress(checked, [...mine])
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (stopped()) return null
  }
  return mine
}

/** Dollars in base units, exactly: "4.50" → 4500000n. */
export function baseOf(amount: string): bigint {
  try {
    return toBase(amount)
  } catch {
    return 0n
  }
}

export const totalOf = (sales: { amount: string }[]) =>
  sales.reduce((sum, sale) => sum + baseOf(sale.amount), 0n)

/** "0x067D…20a2": the one-time address as the explorer writes it, shortened. */
export function shortAddress(address: string) {
  const checksummed = getAddress(address)
  return `${checksummed.slice(0, 6)}…${checksummed.slice(-4)}`
}

export const addressUrl = (network: NetworkId, address: string) =>
  explorerAddressUrl(getNetwork(network), getAddress(address))

const paidAt = (sale: { paid_at: string | null }) => (sale.paid_at ? Date.parse(sale.paid_at) : 0)

/** Newest first. */
export const byNewest = <T extends { paid_at: string | null }>(a: T, b: T) => paidAt(b) - paidAt(a)

const pad = (n: number) => String(n).padStart(2, '0')
const cell = (value: string) =>
  /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value

/** The sales as a spreadsheet for whoever keeps the books: one row a sale, oldest first. */
export function takingsCsv(sales: Announcement[]): string {
  const rows = [
    [
      'Date',
      'Time',
      'Amount',
      'Currency',
      'Paid to (its own address)',
      'Transaction',
      'Link',
      'Paid at (UTC)',
    ],
  ]
  for (const sale of [...sales].sort(byNewest).reverse()) {
    const at = sale.paid_at ? new Date(sale.paid_at) : null
    rows.push([
      at ? `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` : '',
      at ? `${pad(at.getHours())}:${pad(at.getMinutes())}` : '',
      sale.amount,
      sale.currency,
      getAddress(sale.stealth_address),
      sale.tx_hash,
      sale.explorer_url,
      sale.paid_at ?? '',
    ])
  }
  return `${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`
}

/** Saves `text` as a file, straight from the page: nothing goes to a server. */
export function saveFile(name: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** "ada-s-bakery" from "Ada’s Bakery", for a file name. */
export const fileSlug = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[^\w\s-]+/g, '-')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-|-$/g, '') || 'shop'
