/**
 * Public object ids: a type prefix plus Crockford base32 of the UUID's 16 bytes, e.g.
 * `pi_01k5xz3h8m7q4rb9t2v6wd0nfc`. Prefixes make ids self-describing in logs and support,
 * and the underlying UUID is what the on-chain memo carries.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export const prefixes = {
  merchant: 'mer',
  user: 'usr',
  terminal: 'trm',
  credential: 'crd',
  paymentIntent: 'pi',
  payment: 'pay',
  refund: 're',
  apiKey: 'key',
  webhookEndpoint: 'whe',
  event: 'evt',
  catalogItem: 'itm',
  stall: 'stl',
  order: 'ord',
  image: 'img',
  trip: 'trp',
  cardTap: 'tap',
  paymentLink: 'lnk',
  stealthPayment: 'spa',
  stealthAnnouncement: 'san',
  payrollPerson: 'emp',
  payrollRun: 'run',
  payrollPayment: 'wage',
  supplier: 'sup',
  supplierPayment: 'spay',
} as const

export type ObjectKind = keyof typeof prefixes

export function encodeId(kind: ObjectKind, uuid: string): string {
  const bytes = Buffer.from(uuid.replaceAll('-', ''), 'hex')
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return `${prefixes[kind]}_${out.toLowerCase()}`
}

export function decodeId(kind: ObjectKind, id: string): string | null {
  const prefix = `${prefixes[kind]}_`
  if (!id.startsWith(prefix)) return null
  const body = id.slice(prefix.length).toUpperCase()
  if (body.length !== 26) return null
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of body) {
    const index = ALPHABET.indexOf(char)
    if (index === -1) return null
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  if (bytes.length !== 16) return null
  const hex = Buffer.from(bytes).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
