import { KovaError } from '../errors.js'

/**
 * Every way Kova cashes out through Nuvion (docs.nuvion.co/guides/send-a-payout), as data: the
 * country, the rail, how fast it lands, and the fields the person fills in. The app and the web draw
 * their forms from this list, so a rail added here reaches both without a release.
 *
 * Money leaves Kova's USD pot. For any other currency Nuvion converts it at a quoted rate (its margin,
 * about 2%, is in the rate). A recipient's details go to Nuvion once and are kept there; Kova keeps
 * only a masked label.
 */

export type FieldKind =
  | 'text'
  | 'digits'
  | 'email'
  | 'phone'
  | 'iban'
  | 'bic'
  | 'country'
  | 'select'
  | 'bank'

export interface Field {
  key: string
  label: string
  kind: FieldKind
  placeholder?: string
  /** Lengths, for digits and text. */
  min?: number
  max?: number
  options?: { value: string; label: string }[]
  optional?: boolean
}

export type PaymentMethod =
  | 'bank-transfer'
  | 'momo-transfer'
  | 'stablecoin-transfer'
  | 'book-transfer'

export interface Corridor {
  id: string
  /** ISO country of the account; `EU` for SEPA (the IBAN says which), `WW` for anywhere. */
  country: string
  name: string
  flag: string
  /** What the account receives: ISO 4217, or `USC` for USDC. */
  currency: string
  method: PaymentMethod
  /** Nuvion's scheme, when the currency has more than one. */
  scheme?: string
  title: string
  speed: string
  /** The bank picker's directory, and the Nuvion field the chosen bank fills. */
  bankList?: { country: string; key: 'bank_code' | 'bank_institution_number' | 'swift_bic' }
  fields: Field[]
  /** Limits on what the account receives, in its smallest unit, where the rail has them. */
  minTo?: number
  maxTo?: number
}

const accountNumber = (min = 4, max = 20): Field => ({
  key: 'account_number',
  label: 'Account number',
  kind: 'digits',
  min,
  max,
})
const bank: Field = { key: 'bank', label: 'Bank', kind: 'bank' }
const bankName: Field = { key: 'bank_name', label: 'Bank name', kind: 'text', min: 2, max: 80 }
const bic: Field = {
  key: 'swift_bic',
  label: 'SWIFT / BIC',
  kind: 'bic',
  placeholder: 'e.g. DEUTDEFF',
}
const usBank: Field[] = [
  { key: 'routing_number', label: 'Routing number', kind: 'digits', min: 9, max: 9 },
  accountNumber(4, 17),
  {
    key: 'account_type',
    label: 'Account type',
    kind: 'select',
    options: [
      { value: 'checking', label: 'Checking' },
      { value: 'savings', label: 'Savings' },
    ],
  },
  bankName,
  { key: 'bank_line1', label: 'Bank’s street address', kind: 'text', min: 3, max: 120 },
  { key: 'bank_city', label: 'Bank’s city', kind: 'text', min: 2, max: 60 },
  { key: 'bank_state', label: 'Bank’s state', kind: 'text', min: 2, max: 2, placeholder: 'NY' },
  { key: 'bank_postal_code', label: 'Bank’s ZIP code', kind: 'digits', min: 5, max: 5 },
]
const canadaBank: Field[] = [
  bank,
  { key: 'transit_number', label: 'Transit number', kind: 'digits', min: 5, max: 5 },
  accountNumber(5, 12),
]
const phone = (example: string): Field => ({
  key: 'phone_number',
  label: 'Phone number',
  kind: 'phone',
  placeholder: example,
})
const providers = (list: [string, string][]): Field => ({
  key: 'scheme',
  label: 'Network',
  kind: 'select',
  options: list.map(([value, label]) => ({ value, label })),
})

export const CORRIDORS: Corridor[] = [
  // United States: no conversion, the cheapest way out.
  {
    id: 'us_rtp',
    country: 'US',
    name: 'United States',
    flag: '🇺🇸',
    currency: 'USD',
    method: 'bank-transfer',
    scheme: 'rtp',
    title: 'Bank account, instant',
    speed: 'Instant',
    fields: usBank,
  },
  {
    id: 'us_ach',
    country: 'US',
    name: 'United States',
    flag: '🇺🇸',
    currency: 'USD',
    method: 'bank-transfer',
    scheme: 'ach',
    title: 'Bank account',
    speed: 'Same or next day',
    fields: usBank,
  },
  {
    id: 'us_wire',
    country: 'US',
    name: 'United States',
    flag: '🇺🇸',
    currency: 'USD',
    method: 'bank-transfer',
    scheme: 'wire',
    title: 'Wire transfer',
    speed: 'Same day',
    fields: usBank,
  },
  // Canada
  {
    id: 'ca_interac_email',
    country: 'CA',
    name: 'Canada',
    flag: '🇨🇦',
    currency: 'CAD',
    method: 'bank-transfer',
    scheme: 'interac_email',
    title: 'Interac e-Transfer, by email',
    speed: 'Instant',
    fields: [],
  },
  {
    id: 'ca_interac_account',
    country: 'CA',
    name: 'Canada',
    flag: '🇨🇦',
    currency: 'CAD',
    method: 'bank-transfer',
    scheme: 'interac_account',
    title: 'Interac, to a bank account',
    speed: 'Instant',
    bankList: { country: 'CA', key: 'bank_institution_number' },
    fields: canadaBank,
  },
  {
    id: 'ca_eft',
    country: 'CA',
    name: 'Canada',
    flag: '🇨🇦',
    currency: 'CAD',
    method: 'bank-transfer',
    scheme: 'eft',
    title: 'Bank account',
    speed: 'Same or next day',
    bankList: { country: 'CA', key: 'bank_institution_number' },
    fields: canadaBank,
  },
  // Africa
  {
    id: 'ng_nip',
    country: 'NG',
    name: 'Nigeria',
    flag: '🇳🇬',
    currency: 'NGN',
    method: 'bank-transfer',
    scheme: 'nip',
    title: 'Bank account',
    speed: 'Instant',
    bankList: { country: 'NG', key: 'bank_code' },
    fields: [bank, accountNumber(10, 10)],
  },
  {
    id: 'gh_momo',
    country: 'GH',
    name: 'Ghana',
    flag: '🇬🇭',
    currency: 'GHS',
    method: 'momo-transfer',
    title: 'Mobile money',
    speed: 'Instant',
    fields: [
      providers([
        ['mtn', 'MTN'],
        ['vodafone', 'Telecel (Vodafone)'],
        ['airtel', 'AirtelTigo'],
      ]),
      phone('+233 24 123 4567'),
    ],
    minTo: 500,
    maxTo: 2_500_000,
  },
  {
    id: 'gh_eft',
    country: 'GH',
    name: 'Ghana',
    flag: '🇬🇭',
    currency: 'GHS',
    method: 'bank-transfer',
    scheme: 'gh_eft',
    title: 'Bank account',
    speed: 'Same day',
    bankList: { country: 'GH', key: 'bank_code' },
    fields: [bank, accountNumber(8, 20)],
  },
  {
    id: 'ke_momo',
    country: 'KE',
    name: 'Kenya',
    flag: '🇰🇪',
    currency: 'KES',
    method: 'momo-transfer',
    title: 'M-Pesa or mobile money',
    speed: 'Instant',
    fields: [
      providers([
        ['mpesa', 'M-Pesa'],
        ['airtel', 'Airtel Money'],
        ['telkom', 'T-Kash'],
      ]),
      phone('+254 712 345 678'),
    ],
    minTo: 2_000,
    maxTo: 25_000_000,
  },
  {
    id: 'ke_eft',
    country: 'KE',
    name: 'Kenya',
    flag: '🇰🇪',
    currency: 'KES',
    method: 'bank-transfer',
    scheme: 'ke_eft',
    title: 'Bank account',
    speed: 'Same day',
    bankList: { country: 'KE', key: 'bank_code' },
    fields: [bank, accountNumber(6, 20)],
  },
  {
    id: 'tz_momo',
    country: 'TZ',
    name: 'Tanzania',
    flag: '🇹🇿',
    currency: 'TZS',
    method: 'momo-transfer',
    title: 'Mobile money',
    speed: 'Instant',
    fields: [
      providers([
        ['vodacom', 'M-Pesa (Vodacom)'],
        ['airtel', 'Airtel Money'],
        ['tigo', 'Mixx by Yas (Tigo)'],
        ['halotel', 'HaloPesa'],
      ]),
      phone('+255 712 345 678'),
    ],
    minTo: 100_000,
    maxTo: 500_000_000,
  },
  {
    id: 'tz_eft',
    country: 'TZ',
    name: 'Tanzania',
    flag: '🇹🇿',
    currency: 'TZS',
    method: 'bank-transfer',
    scheme: 'tz_eft',
    title: 'Bank account',
    speed: 'Same day',
    bankList: { country: 'TZ', key: 'bank_code' },
    fields: [bank, accountNumber(6, 20)],
  },
  {
    id: 'ug_eft',
    country: 'UG',
    name: 'Uganda',
    flag: '🇺🇬',
    currency: 'UGX',
    method: 'bank-transfer',
    scheme: 'ug_eft',
    title: 'Bank account',
    speed: 'Same day',
    bankList: { country: 'UG', key: 'bank_code' },
    fields: [bank, accountNumber(6, 20)],
  },
  {
    id: 'za_rtc',
    country: 'ZA',
    name: 'South Africa',
    flag: '🇿🇦',
    currency: 'ZAR',
    method: 'bank-transfer',
    title: 'Bank account',
    speed: 'Same day',
    bankList: { country: 'ZA', key: 'bank_code' },
    fields: [bank, accountNumber(6, 16)],
  },
  // Europe
  {
    id: 'gb_fps',
    country: 'GB',
    name: 'United Kingdom',
    flag: '🇬🇧',
    currency: 'GBP',
    method: 'bank-transfer',
    scheme: 'fps',
    title: 'Bank account',
    speed: 'Same day',
    fields: [
      {
        key: 'sort_code',
        label: 'Sort code',
        kind: 'digits',
        min: 6,
        max: 6,
        placeholder: '040004',
      },
      accountNumber(8, 8),
      bankName,
    ],
  },
  {
    id: 'eu_sepa',
    country: 'EU',
    name: 'Europe',
    flag: '🇪🇺',
    currency: 'EUR',
    method: 'bank-transfer',
    scheme: 'sepa',
    title: 'Bank account',
    speed: 'Same day',
    fields: [{ key: 'iban', label: 'IBAN', kind: 'iban' }, bic, bankName],
  },
  // Asia, the Gulf, Oceania, the Americas
  {
    id: 'ae_local',
    country: 'AE',
    name: 'United Arab Emirates',
    flag: '🇦🇪',
    currency: 'AED',
    method: 'bank-transfer',
    scheme: 'uae_local',
    title: 'Bank account',
    speed: 'Same or next day',
    fields: [
      { key: 'iban', label: 'IBAN', kind: 'iban', placeholder: 'AE07 0331 2345 6789 0123 456' },
      bic,
      bankName,
    ],
  },
  {
    id: 'au_becs',
    country: 'AU',
    name: 'Australia',
    flag: '🇦🇺',
    currency: 'AUD',
    method: 'bank-transfer',
    scheme: 'becs',
    title: 'Bank account',
    speed: '1–2 business days',
    fields: [
      { key: 'branch_code', label: 'BSB', kind: 'digits', min: 6, max: 6, placeholder: '062000' },
      accountNumber(5, 10),
      bankName,
    ],
  },
  {
    id: 'sg_fast',
    country: 'SG',
    name: 'Singapore',
    flag: '🇸🇬',
    currency: 'SGD',
    method: 'bank-transfer',
    scheme: 'fast',
    title: 'Bank account',
    speed: 'Instant',
    fields: [bic, accountNumber(6, 17), bankName],
  },
  {
    id: 'ph_instapay',
    country: 'PH',
    name: 'Philippines',
    flag: '🇵🇭',
    currency: 'PHP',
    method: 'bank-transfer',
    scheme: 'insta_pay',
    title: 'Bank or e-wallet, instant',
    speed: 'Instant',
    bankList: { country: 'PH', key: 'bank_code' },
    fields: [bank, accountNumber(6, 20)],
    minTo: 6_000,
    maxTo: 5_000_000,
  },
  {
    id: 'ph_pesonet',
    country: 'PH',
    name: 'Philippines',
    flag: '🇵🇭',
    currency: 'PHP',
    method: 'bank-transfer',
    scheme: 'pesonet',
    title: 'Bank account',
    speed: 'Same day',
    bankList: { country: 'PH', key: 'bank_code' },
    fields: [bank, accountNumber(6, 20)],
    minTo: 6_000,
  },
  {
    id: 'hk_chats',
    country: 'HK',
    name: 'Hong Kong',
    flag: '🇭🇰',
    currency: 'HKD',
    method: 'bank-transfer',
    scheme: 'hk_chats',
    title: 'Bank account',
    speed: 'Instant',
    bankList: { country: 'HK', key: 'bank_code' },
    fields: [
      bank,
      { key: 'branch_code', label: 'Branch code', kind: 'digits', min: 3, max: 3 },
      accountNumber(6, 12),
    ],
  },
  {
    id: 'cn_wire',
    country: 'CN',
    name: 'China',
    flag: '🇨🇳',
    currency: 'CNY',
    method: 'bank-transfer',
    title: 'Bank account',
    speed: 'Same day',
    bankList: { country: 'CN', key: 'swift_bic' },
    fields: [bank, accountNumber(8, 30)],
    minTo: 21_300,
  },
  {
    id: 'mx_clabe',
    country: 'MX',
    name: 'Mexico',
    flag: '🇲🇽',
    currency: 'MXN',
    method: 'bank-transfer',
    scheme: 'clabe',
    title: 'Bank account',
    speed: 'Instant',
    fields: [{ key: 'account_number', label: 'CLABE', kind: 'digits', min: 18, max: 18 }],
  },
  // Anywhere else, in US dollars over SWIFT.
  {
    id: 'swift_iban',
    country: 'WW',
    name: 'Any other country',
    flag: '🌍',
    currency: 'USD',
    method: 'bank-transfer',
    scheme: 'swift',
    title: 'International transfer, to an IBAN',
    speed: '1–3 business days',
    fields: [
      { key: 'bank_country', label: 'Bank’s country', kind: 'country', placeholder: 'e.g. DE' },
      { key: 'iban', label: 'IBAN', kind: 'iban' },
      bic,
      bankName,
      { key: 'bank_line1', label: 'Bank’s street address', kind: 'text', min: 3, max: 120 },
      { key: 'bank_city', label: 'Bank’s city', kind: 'text', min: 2, max: 60 },
      { key: 'bank_state', label: 'Bank’s state or region', kind: 'text', min: 2, max: 60 },
      { key: 'bank_postal_code', label: 'Bank’s postal code', kind: 'text', min: 2, max: 12 },
    ],
  },
  {
    id: 'swift_account',
    country: 'WW',
    name: 'Any other country',
    flag: '🌍',
    currency: 'USD',
    method: 'bank-transfer',
    scheme: 'swift',
    title: 'International transfer, to an account number',
    speed: '1–3 business days',
    fields: [
      { key: 'bank_country', label: 'Bank’s country', kind: 'country', placeholder: 'e.g. JP' },
      { key: 'account_number', label: 'Account number', kind: 'text', min: 4, max: 34 },
      bic,
      bankName,
      { key: 'bank_line1', label: 'Bank’s street address', kind: 'text', min: 3, max: 120 },
      { key: 'bank_city', label: 'Bank’s city', kind: 'text', min: 2, max: 60 },
      { key: 'bank_state', label: 'Bank’s state or region', kind: 'text', min: 2, max: 60 },
      { key: 'bank_postal_code', label: 'Bank’s postal code', kind: 'text', min: 2, max: 12 },
    ],
  },
  // To a USDC wallet on another chain, or another Nuvion account.
  {
    id: 'usdc',
    country: 'WW',
    name: 'USDC wallet',
    flag: '🪙',
    currency: 'USC',
    method: 'stablecoin-transfer',
    scheme: 'stablecoin',
    title: 'USDC on Base, Ethereum, Polygon or Solana',
    speed: 'Under a minute',
    fields: [
      {
        key: 'blockchain_network',
        label: 'Network',
        kind: 'select',
        options: [
          { value: 'BASE_MAINNET', label: 'Base' },
          { value: 'ETH_MAINNET', label: 'Ethereum' },
          { value: 'MATIC_MAINNET', label: 'Polygon' },
          { value: 'SOLANA_MAINNET', label: 'Solana' },
        ],
      },
      { key: 'wallet_address', label: 'Wallet address', kind: 'text', min: 32, max: 64 },
    ],
  },
  {
    id: 'nuvion_direct',
    country: 'WW',
    name: 'Nuvion account',
    flag: '🏦',
    currency: 'USD',
    method: 'book-transfer',
    title: 'Another Nuvion account',
    speed: 'Instant',
    fields: [
      { key: 'account_number', label: 'Nuvion account number', kind: 'digits', min: 6, max: 20 },
    ],
  },
]

export const corridorById = (id: string) => CORRIDORS.find((c) => c.id === id)

/** Fields every recipient has: who they are, as Nuvion needs them for any payout. */
export const PERSON_FIELDS: Field[] = [
  { key: 'holder_name', label: 'Name on the account', kind: 'text', min: 3, max: 80 },
  { key: 'email', label: 'Email', kind: 'email' },
  { key: 'address_line1', label: 'Your street address', kind: 'text', min: 3, max: 120 },
  { key: 'address_city', label: 'City', kind: 'text', min: 2, max: 60 },
  // Nuvion won't pay out to a person whose address has no state (it says so only at payout).
  {
    key: 'address_state',
    label: 'State or region',
    kind: 'text',
    min: 2,
    max: 60,
    placeholder: 'e.g. Lagos',
  },
  // Nuvion fails a payout to an address with no postal code, a second after taking it.
  {
    key: 'address_postal_code',
    label: 'Postal code',
    kind: 'text',
    min: 2,
    max: 12,
    placeholder: 'e.g. 100001',
  },
  { key: 'address_country', label: 'Country you live in', kind: 'country', placeholder: 'e.g. NG' },
]

/** ISO 13616 check: the two check digits make the whole IBAN divisible by 97. */
export function ibanValid(raw: string): boolean {
  const iban = raw.replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  const moved = `${iban.slice(4)}${iban.slice(0, 4)}`
  let rest = 0
  for (const ch of moved) {
    const n = ch >= 'A' ? ch.charCodeAt(0) - 55 : Number(ch)
    rest = Number(`${rest}${n}`) % 97
  }
  return rest === 1
}

const SEPA = new Set(
  'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO CH MC SM VA AD GI'.split(
    ' ',
  ),
)

/** One field's value, cleaned, or a sentence the person can act on. */
function clean(field: Field, raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : ''
  const say = (msg: string) => new KovaError('invalid_request', msg, { field: field.key })
  if (!value) {
    if (field.optional) return ''
    throw say(`Enter the ${field.label.toLowerCase()}.`)
  }
  switch (field.kind) {
    case 'digits': {
      const digits = value.replace(/[\s-]/g, '')
      if (!/^\d+$/.test(digits)) throw say(`The ${field.label.toLowerCase()} is numbers only.`)
      if (field.min && field.max && field.min === field.max && digits.length !== field.min)
        throw say(`The ${field.label.toLowerCase()} is ${field.min} digits.`)
      if ((field.min && digits.length < field.min) || (field.max && digits.length > field.max))
        throw say(
          `That ${field.label.toLowerCase()} looks too ${digits.length < (field.min ?? 0) ? 'short' : 'long'}.`,
        )
      return digits
    }
    case 'email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) throw say('That email doesn’t look right.')
      return value.toLowerCase()
    case 'phone': {
      const digits = value.replace(/[\s()-]/g, '')
      if (!/^\+\d{9,15}$/.test(digits))
        throw say('Enter the phone number with its country code, like +254 712 345 678.')
      return digits
    }
    case 'iban': {
      const iban = value.replace(/\s/g, '').toUpperCase()
      if (!ibanValid(iban)) throw say('That IBAN isn’t valid. Check it against your bank’s app.')
      return iban
    }
    case 'bic': {
      const code = value.replace(/\s/g, '').toUpperCase()
      if (!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(code))
        throw say('A SWIFT / BIC code is 8 or 11 letters and numbers.')
      return code
    }
    case 'country': {
      const code = value.toUpperCase()
      if (!/^[A-Z]{2}$/.test(code)) throw say('Use the country’s two-letter code, like DE or JP.')
      return code
    }
    case 'select':
      if (!field.options?.some((o) => o.value === value))
        throw say(`Pick a ${field.label.toLowerCase()}.`)
      return value
    default:
      if ((field.min && value.length < field.min) || (field.max && value.length > field.max))
        throw say(`Check the ${field.label.toLowerCase()}.`)
      return value
  }
}

export interface RecipientInput {
  person: {
    firstName: string
    lastName: string
    holderName: string
    email: string
    address: { line1: string; city: string; state: string; postalCode: string; country: string }
  }
  /** The payment detail Nuvion keeps, without its counterparty. */
  detail: Record<string, unknown>
  /** What Kova shows for it: never the whole number. */
  label: string
  /** The account's country (the IBAN's, for SEPA and SWIFT). */
  country: string
}

const mask = (s: string) => `•••• ${s.slice(-4)}`
const maskEmail = (e: string) => {
  const [user = '', host = ''] = e.split('@')
  return `${user.slice(0, 1)}•••@${host}`
}

/**
 * Checks a recipient's fields for a corridor and turns them into Nuvion's payment detail. `bank` is
 * the bank picked from the directory, when the corridor has one.
 */
export function recipientFor(
  corridor: Corridor,
  values: Record<string, unknown>,
  bank?: { bank_name: string; code: string },
): RecipientInput {
  const v: Record<string, string> = {}
  for (const f of [...PERSON_FIELDS, ...corridor.fields])
    if (f.kind !== 'bank') v[f.key] = clean(f, values[f.key])
  if (corridor.fields.some((f) => f.kind === 'bank') && !bank)
    throw new KovaError('invalid_request', 'Pick the bank from the list.', { field: 'bank' })

  const holder = v.holder_name as string
  const parts = holder.split(/\s+/)
  const firstName = parts[0] as string
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : firstName

  let country = corridor.country
  if (corridor.id === 'eu_sepa') {
    country = (v.iban as string).slice(0, 2)
    if (!SEPA.has(country))
      throw new KovaError('invalid_request', 'That IBAN isn’t from a SEPA country.', {
        field: 'iban',
      })
  }
  if (corridor.id === 'ae_local' && !(v.iban as string).startsWith('AE'))
    throw new KovaError('invalid_request', 'A UAE IBAN starts with AE.', { field: 'iban' })
  if (corridor.id.startsWith('swift_')) country = v.bank_country as string
  // A wallet or a Nuvion account has no country of its own: the person's is the one that counts.
  if (corridor.country === 'WW' && !corridor.id.startsWith('swift_'))
    country = v.address_country as string

  const detail: Record<string, unknown> = {
    payment_method: corridor.method,
    currency: corridor.currency,
    account_holder_name: holder,
    ...(corridor.scheme ? { scheme: corridor.scheme } : {}),
  }
  if (corridor.method === 'bank-transfer' || corridor.method === 'momo-transfer')
    detail.country = country
  const take = (...keys: string[]) => {
    for (const k of keys) if (v[k]) detail[k] = v[k]
  }
  let label: string
  switch (corridor.id) {
    case 'us_rtp':
    case 'us_ach':
    case 'us_wire':
      take('routing_number', 'account_number', 'account_type', 'bank_name')
      detail.bank_address = {
        line1: v.bank_line1,
        city: v.bank_city,
        state: (v.bank_state as string).toUpperCase(),
        postal_code: v.bank_postal_code,
        country: 'US',
      }
      label = `${v.bank_name} ${mask(v.account_number as string)}`
      break
    case 'ca_interac_email':
      detail.email = v.email
      label = `Interac ${maskEmail(v.email as string)}`
      break
    case 'gh_momo':
    case 'ke_momo':
    case 'tz_momo': {
      take('scheme', 'phone_number')
      const network = corridor.fields[0]?.options?.find((o) => o.value === v.scheme)?.label
      label = `${network} ${mask(v.phone_number as string)}`
      break
    }
    case 'eu_sepa':
    case 'ae_local':
      take('iban', 'swift_bic', 'bank_name')
      label = `${v.bank_name} ${mask(v.iban as string)}`
      break
    case 'swift_iban':
    case 'swift_account': {
      take('iban', 'account_number', 'swift_bic', 'bank_name')
      // A USD payout needs the bank's whole address, state and postal code included.
      detail.bank_address = {
        line1: v.bank_line1,
        city: v.bank_city,
        state: v.bank_state,
        postal_code: v.bank_postal_code,
        country,
      }
      label = `${v.bank_name} ${mask((v.iban ?? v.account_number) as string)}`
      break
    }
    case 'au_becs':
      // Nuvion reads the BSB under all three names.
      take('account_number', 'bank_name')
      detail.bsb = v.branch_code
      detail.bank_code = v.branch_code
      detail.branch_code = v.branch_code
      label = `${v.bank_name} ${mask(v.account_number as string)}`
      break
    case 'usdc':
      take('blockchain_network', 'wallet_address')
      label = `USDC ${(v.wallet_address as string).slice(0, 6)}…${(v.wallet_address as string).slice(-4)}`
      break
    case 'mx_clabe':
      take('account_number')
      label = `CLABE ${mask(v.account_number as string)}`
      break
    case 'nuvion_direct':
      take('account_number')
      label = `Nuvion ${mask(v.account_number as string)}`
      break
    default:
      take('sort_code', 'transit_number', 'branch_code', 'account_number', 'swift_bic', 'bank_name')
      if (bank && corridor.bankList) {
        detail[corridor.bankList.key] = bank.code
        detail.bank_name = bank.bank_name
      }
      label = `${(detail.bank_name as string) ?? 'Bank'} ${mask((v.account_number as string) ?? '')}`
  }
  return {
    person: {
      firstName,
      lastName,
      holderName: holder,
      email: v.email as string,
      address: {
        line1: v.address_line1 as string,
        city: v.address_city as string,
        state: v.address_state as string,
        postalCode: v.address_postal_code as string,
        country: v.address_country as string,
      },
    },
    detail,
    label,
    country,
  }
}

/**
 * The list as the app and web draw it. Fields come in the order people think of them: whose account,
 * where the money goes, then who they are (Nuvion needs it for every payout).
 */
/** Ways Kova keeps working for accounts already saved, but no longer offers for new ones. */
const RETIRED = new Set(['nuvion_direct'])

export function publicCorridors() {
  return CORRIDORS.filter((c) => !RETIRED.has(c.id)).map((c) => {
    const interac = c.id === 'ca_interac_email'
    const person = (key: string) => PERSON_FIELDS.find((f) => f.key === key) as Field
    const about = PERSON_FIELDS.filter(
      (f) => f.key !== 'holder_name' && !(interac && f.key === 'email'),
    )
    return {
      id: c.id,
      country: c.country,
      name: c.name,
      flag: c.flag,
      currency: c.currency === 'USC' ? 'USDC' : c.currency,
      title: c.title,
      speed: c.speed,
      banks: c.bankList ? c.bankList.country : null,
      fields: [
        person('holder_name'),
        // Interac by email pays the person's own email: the one field does both jobs.
        ...(interac ? [{ ...person('email'), label: 'Interac email (the money goes here)' }] : []),
        ...c.fields,
        ...about.map((f, i) => (i === 0 ? { ...f, section: 'About you' } : f)),
      ],
      min_to: c.minTo ?? null,
      max_to: c.maxTo ?? null,
    }
  })
}
