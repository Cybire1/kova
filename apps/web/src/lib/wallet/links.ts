import { type Hex, isAddress } from 'viem'
import { linkKeyFrom } from './dollar-links'
import { type DisplayCurrency, isDisplayCurrency } from './money'

/**
 * What a Kova code or link means, read the way the app reads it (apps/mobile src/lib/links.ts):
 * a charge to pay, a stall, a phone pairing, or a person. A person's link is now an https link
 * too (mykova.app/to/…), so it opens anywhere: in the app when it's installed, on the web when
 * it isn't. The app's kova:// links still read the same. A link with dollars in it
 * (mykova.app/c/<id>#<key>) is claimed on its own page; the key after the # is what claims it.
 */
export type Scanned =
  | { kind: 'charge'; id: string }
  | { kind: 'stall'; slug: string }
  | { kind: 'pair'; code: string }
  | { kind: 'claim'; id: string; key: Hex | null }
  | {
      kind: 'person'
      address: string
      name?: string
      currency?: DisplayCurrency
      amount?: string
      note?: string
    }

export function parseScanned(raw: string): Scanned | null {
  const value = raw.trim()
  const pairing = /^kova:\/\/pair\/([0-9A-Za-z-]{4,12})$/.exec(value)
  if (pairing?.[1]) return { kind: 'pair', code: pairing[1] }
  const claim =
    /^(?:https?:\/\/[^/]+|kova:\/)\/c\/(lnk_[0-9a-z]{26})\/?(?:\?[^#]*)?(?:#(.*))?$/i.exec(value)
  if (claim?.[1]) return { kind: 'claim', id: claim[1].toLowerCase(), key: linkKeyFrom(claim[2]) }
  const charge =
    /\/pay\/([A-Za-z0-9_]+)/.exec(value) ?? /^kova:\/\/pay\/([A-Za-z0-9_]+)/.exec(value)
  if (charge?.[1]) return { kind: 'charge', id: charge[1] }
  const stall = /^(?:https?:\/\/[^/]+|kova:\/)\/s\/([a-z0-9-]{1,64})\/?(?:[?#].*)?$/.exec(value)
  if (stall?.[1]) return { kind: 'stall', slug: stall[1] }

  if (isAddress(value)) return { kind: 'person', address: value }

  // The app's kova://to/… and the web's https://…/to/… say the same thing.
  const person = /^(?:kova:\/\/|https?:\/\/[^/]+\/)to\/(0x[0-9a-fA-F]{40})(?:\?(.*))?$/.exec(value)
  if (person?.[1] && isAddress(person[1])) {
    const params = new URLSearchParams(person[2] ?? '')
    const cur = params.get('cur')
    const amount = params.get('amount')
    return {
      kind: 'person',
      address: person[1],
      ...(params.get('name') ? { name: params.get('name') as string } : {}),
      ...(isDisplayCurrency(cur) ? { currency: cur } : {}),
      ...(amount && /^\d+(\.\d{1,2})?$/.test(amount) ? { amount } : {}),
      ...(params.get('note') ? { note: params.get('note') as string } : {}),
    }
  }
  return null
}

/** A link anyone can pay you with: on the web, or in the Kova app when it's installed. */
export function personLink(
  origin: string,
  person: {
    address: string
    name?: string
    currency?: DisplayCurrency
    amount?: string
    note?: string
  },
): string {
  const params = new URLSearchParams()
  if (person.name) params.set('name', person.name)
  if (person.currency && person.currency !== 'USD') params.set('cur', person.currency)
  if (person.amount) params.set('amount', person.amount)
  if (person.note) params.set('note', person.note)
  const query = params.toString()
  return `${origin}/to/${person.address}${query ? `?${query}` : ''}`
}
