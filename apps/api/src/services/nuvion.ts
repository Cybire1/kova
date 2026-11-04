import { config } from '../config.js'
import { KovaError } from '../errors.js'

/**
 * Nuvion (docs.nuvion.co), the dollar card's issuer: the few calls Kova makes, typed as far as
 * Kova reads them. Amounts are in cents, Nuvion's smallest unit for USD. Every reply is
 * `{ status, message?, data }`; a refusal carries the reason in `message`.
 *
 * Each card holder is a child entity of Kova's own (the key's entity): they pass Nuvion's ID check,
 * then hold a USD account the card spends from. Kova's pot (NUVION_POT_ACCOUNT) pays that account
 * by book transfer, so each holder is also a counterparty of Kova's with a book-transfer detail.
 */

export const nuvionSandbox = () => config.NUVION_API_URL.includes('nuvion.dev')

export class NuvionRefused extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message)
  }
}

async function nuvion<T>(
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  if (!config.NUVION_API_KEY)
    throw new KovaError('conflict', 'The dollar card isn’t switched on for this server yet.')
  const response = await fetch(`${config.NUVION_API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${config.NUVION_API_KEY}`,
      'content-type': 'application/json',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
  }).catch(() => null)
  if (!response)
    throw new KovaError('chain_error', 'The card issuer didn’t answer. Try again in a moment.')
  const body = (await response.json().catch(() => null)) as {
    status?: string
    message?: string
    code?: string
    type?: string
    validations?: Problem[]
    error?: { code?: string; message?: string; validations?: Problem[] }
    data?: T
  } | null
  if (!response.ok || !body || body.status === 'error') {
    const said = body?.error?.message ?? body?.message ?? `Nuvion answered ${response.status}.`
    // A 422 lists each missing or wrong field: name them, so the holder knows what to fix.
    const problems = (body?.validations ?? body?.error?.validations ?? []).flatMap(problemsOf)
    if (problems.length || response.status >= 500)
      console.error(
        '[nuvion]',
        init.method ?? 'GET',
        path.split('?')[0],
        response.status,
        said,
        problems,
      )
    throw new NuvionRefused(
      response.status,
      body?.error?.code ?? body?.code ?? body?.type,
      problems.length ? `${said.replace(/\.$/, '')}: ${problems.join('; ')}.` : said,
    )
  }
  return body.data as T
}

type Problem =
  | string
  | { field?: string; path?: string; message?: string; type?: string }
  | Record<string, { message?: string; type?: string } | string>

/**
 * One entry of a 422's `validations`. Nuvion keys each entry by the field it is about
 * (`{ "bank_address.state": { "type": "…", "message": "…" } }`); older answers gave
 * `{ field, message }` or a plain string. Each comes out as "field: why".
 */
function problemsOf(p: Problem): string[] {
  if (typeof p === 'string') return [p]
  if (!p || typeof p !== 'object') return []
  const flat = p as { field?: unknown; path?: unknown; message?: unknown; type?: unknown }
  if (typeof flat.message === 'string' || typeof flat.field === 'string') {
    const field = (flat.field ?? flat.path) as string | undefined
    const why = (flat.message ?? flat.type) as string | undefined
    return [field && why ? `${field}: ${why}` : ((why ?? field) as string)]
  }
  return Object.entries(p).map(([field, v]) => {
    const why = typeof v === 'string' ? v : (v?.message ?? v?.type)
    return why ? `${field}: ${why.replace(/\.$/, '')}` : field
  })
}

// --- The ID check -------------------------------------------------------------------------------

export interface Person {
  firstName: string
  lastName: string
  /** YYYY-MM-DD. */
  dateOfBirth: string
  email: string
  phone: string
  /** ISO 3166-1 alpha-2. */
  nationality: string
  gender: 'm' | 'f'
  address: { line1: string; city: string; state: string; postalCode: string; country: string }
  document: { type: 'international_passport' | 'national_id' | 'drivers_license'; number: string }
  /** The national number Nuvion needs from some countries: NIN or BVN in Nigeria, SSN in the US. */
  idNumber?: { type: 'nin' | 'bvn' | 'ssn'; value: string }
  /** What the proof of address is: Nuvion needs one before it will review anyone. */
  addressProof: 'utility_bill' | 'bank_statement'
}

function individual(person: Person) {
  return {
    name: `${person.firstName} ${person.lastName}`,
    person: {
      first_name: person.firstName,
      last_name: person.lastName,
      date_of_birth: person.dateOfBirth,
      email: person.email,
      nationality: person.nationality,
      gender: person.gender,
      phonenumber: person.phone,
      ...(person.idNumber ? { [person.idNumber.type]: person.idNumber.value } : {}),
    },
    address: {
      line_1: person.address.line1,
      city: person.address.city,
      state: person.address.state,
      postal_code: person.address.postalCode,
      country_code: person.address.country,
    },
    identification: {
      document: {
        type: person.document.type,
        number: person.document.number,
        issuing_country: person.nationality,
      },
      proof_of_address: { type: person.addressProof },
    },
    meta: { customer_types: 'individual', funding_source: 'savings' },
  }
}

interface EntityReply {
  entity: { id: string; status: string; person_id?: string }
  person?: { id: string }
  rejection_reasons?: string[]
}

export async function createIndividual(person: Person) {
  const data = await nuvion<EntityReply>('/individual-entities', {
    method: 'POST',
    body: individual(person),
  })
  return { entityId: data.entity.id, personId: data.person?.id ?? data.entity.person_id ?? null }
}

/** For a holder sending their details again after a check that didn't pass. */
export async function updateIndividual(entityId: string, person: Person) {
  await nuvion(`/individual-entities/${encodeURIComponent(entityId)}`, {
    method: 'PATCH',
    body: individual(person),
  })
}

/** One of the two documents Nuvion needs before review: the ID, then the proof of address. */
export async function uploadDocument(
  entityId: string,
  personId: string | null,
  key: 'identity' | 'proof_of_address',
  file: { base64: string; mime: string; backBase64?: string },
) {
  await nuvion('/documents', {
    method: 'POST',
    timeoutMs: 60_000,
    body: {
      entity_id: entityId,
      key,
      description: key === 'identity' ? 'Identity document' : 'Proof of address',
      file: file.base64,
      ...(file.backBase64 ? { file_back: file.backBase64 } : {}),
      meta: { file_type: file.mime },
      ...(personId ? { link_to_identity: { person_id: personId } } : {}),
    },
  })
}

export async function submitForReview(entityId: string) {
  await nuvion('/onboarding-submissions', { method: 'POST', body: { entity_id: entityId } })
}

/** Kova's own entity at Nuvion (the key's root business), which owner cards are issued under. */
export async function rootEntity(): Promise<string> {
  const page = await nuvion<{ data: Array<{ id: string; is_root?: boolean }> }>(
    '/entities?limit=50',
  )
  const root = page.data.find((e) => e.is_root)
  if (!root)
    throw new NuvionRefused(404, undefined, 'Kova’s own entity isn’t on this Nuvion account.')
  return root.id
}

/** The email and address Kova's own business is registered with, for an owner's payee. */
export async function businessContact(entityId: string) {
  const d = await nuvion<{
    business?: { email?: string; phonenumber?: string; legal_name?: string; name?: string }
    address?: {
      line_1?: string
      city?: string
      state?: string
      postal_code?: string
      country_code?: string
    }
  }>(`/entities/${encodeURIComponent(entityId)}`)
  const a = d.address ?? {}
  if (!d.business?.email || !a.line_1 || !a.city || !a.country_code)
    throw new NuvionRefused(422, undefined, 'Kova’s business has no email or address on Nuvion.')
  return {
    name: d.business.legal_name ?? d.business.name ?? 'Kova',
    email: d.business.email,
    phone: d.business.phonenumber ?? null,
    address: {
      line1: a.line_1,
      city: a.city,
      state: a.state,
      postalCode: a.postal_code,
      country: a.country_code,
    },
  }
}

/** The email and address a holder gave at their check, as Nuvion keeps them (Kova doesn't). */
export async function personContact(entityId: string) {
  const d = await nuvion<{
    person?: { email?: string }
    address?: {
      line_1?: string
      city?: string
      state?: string
      postal_code?: string
      country_code?: string
    }
  }>(`/entities/${encodeURIComponent(entityId)}`)
  const a = d.address ?? {}
  if (!d.person?.email || !a.line_1 || !a.city || !a.country_code)
    throw new NuvionRefused(422, undefined, 'Nuvion has no email or address for this holder.')
  return {
    email: d.person.email,
    address: {
      line1: a.line_1,
      city: a.city,
      state: a.state,
      postalCode: a.postal_code,
      country: a.country_code,
    },
  }
}

export async function entityStatus(entityId: string) {
  const data = await nuvion<EntityReply>(`/entities/${encodeURIComponent(entityId)}`)
  return {
    status: data.entity.status,
    reason: data.rejection_reasons?.length ? data.rejection_reasons.join(' ') : null,
  }
}

// --- Accounts and moving money --------------------------------------------------------------------

interface AccountReply {
  account: {
    id: string
    nuvion_ban?: string
    balance?: { available?: number; current?: number }
  }
}

export async function openUsdAccount(entityId: string) {
  const data = await nuvion<AccountReply>('/accounts', {
    method: 'POST',
    body: { entity_id: entityId, type: 'checking', currency: 'USD', display_name: 'Kova card' },
  })
  return { accountId: data.account.id, accountNumber: data.account.nuvion_ban ?? null }
}

/** What the account can spend now, in cents. */
export async function accountBalance(accountId: string, entityId: string): Promise<number> {
  const data = await nuvion<AccountReply>(
    `/accounts/${encodeURIComponent(accountId)}?entity_id=${encodeURIComponent(entityId)}`,
  )
  return data.account.balance?.available ?? 0
}

export interface PayeeAddress {
  line1: string
  city: string
  state?: string
  postalCode?: string
  country: string
}

/**
 * Kova's way to pay a holder's account from its pot, step one: the holder as Kova's counterparty.
 * Nuvion needs their email and address, so it's made during the ID check while those are in hand;
 * Kova keeps only the counterparty's id.
 */
export async function createPayee(person: {
  firstName: string
  lastName: string
  email: string
  address: PayeeAddress
}) {
  const party = await nuvion<{ id?: string; counterparty?: { id: string } }>('/counterparties', {
    method: 'POST',
    body: {
      type: 'individual',
      profile: {
        first_name: person.firstName,
        last_name: person.lastName,
        relationship: 'customer',
        email: person.email,
        address: {
          line1: person.address.line1,
          city: person.address.city,
          ...(person.address.state ? { state_or_province: person.address.state } : {}),
          ...(person.address.postalCode ? { postal_code: person.address.postalCode } : {}),
          country: person.address.country,
        },
      },
    },
  })
  const id = party.counterparty?.id ?? party.id
  if (!id) throw new NuvionRefused(500, undefined, 'No counterparty id came back.')
  return id
}

/**
 * A book-transfer detail Kova already has for this account number, with its counterparty, so a
 * retry (or an owner's second try) reuses it instead of making a duplicate Nuvion would refuse.
 */
export async function findBookDetail(accountNumber: string) {
  const page = await nuvion<{ data?: Array<{ id: string; status?: string }> }>(
    '/counterparties?limit=100',
  )
  for (const party of page.data ?? []) {
    if (party.status && party.status !== 'active') continue
    const details = await nuvion<
      Array<{ id: string; payment_method?: string; account_number?: string }> | { data?: unknown }
    >(`/counterparties/${encodeURIComponent(party.id)}/payment-details`).catch(() => [])
    const list = Array.isArray(details) ? details : ((details.data as typeof details) ?? [])
    const match = (
      list as Array<{ id: string; payment_method?: string; account_number?: string }>
    ).find((d) => d.payment_method === 'book-transfer' && d.account_number === accountNumber)
    if (match) return { counterpartyId: party.id, paymentDetailId: match.id }
  }
  return null
}

/**
 * Step two, once their card's account exists: a book-transfer detail naming its number. With
 * `entityId`, the detail belongs to that holder's own counterparty (the way back to Kova's pot).
 */
export async function addBookDetail(
  counterpartyId: string,
  name: string,
  accountNumber: string,
  entityId?: string,
) {
  const detail = await nuvion<{ id?: string; payment_detail?: { id: string } }>(
    '/payment-details',
    {
      method: 'POST',
      body: {
        counterparty_id: counterpartyId,
        payment_method: 'book-transfer',
        currency: 'USD',
        account_holder_name: name,
        account_number: accountNumber,
        ...(entityId ? { entity_id: entityId } : {}),
      },
    },
  )
  const id = detail.payment_detail?.id ?? detail.id
  if (!id) throw new NuvionRefused(500, undefined, 'No payment detail id came back.')
  return id
}

/**
 * Moves `cents` from Kova's pot to a holder's account. `reference` is unique per transfer: Nuvion
 * refuses a second transfer with it (409), which is what makes a retry safe.
 */
export async function bookTransfer(
  to: { counterpartyId: string; paymentDetailId: string },
  cents: number,
  reference: string,
  narration: string,
) {
  if (!config.NUVION_POT_ACCOUNT)
    throw new KovaError('conflict', 'The dollar card isn’t switched on for this server yet.')
  const data = await nuvion<{ id?: string; _id?: string; transfer?: { id: string } }>(
    '/transfers',
    {
      method: 'POST',
      body: {
        account_id: config.NUVION_POT_ACCOUNT,
        counterparty_id: to.counterpartyId,
        payment_detail_id: to.paymentDetailId,
        currency: 'USD',
        amount: cents,
        payment_type: 'book-transfer',
        narration,
        unique_reference: reference,
      },
    },
  )
  return data.transfer?.id ?? data.id ?? data._id ?? null
}

/** Kova's pot's own account number, for a holder's way to pay it back. Read once. */
let potNumber: string | null = null
export async function potAccountNumber(): Promise<string> {
  if (potNumber) return potNumber
  if (!config.NUVION_POT_ACCOUNT)
    throw new KovaError('conflict', 'The dollar card isn’t switched on for this server yet.')
  const data = await nuvion<AccountReply>(
    `/accounts/${encodeURIComponent(config.NUVION_POT_ACCOUNT)}`,
  )
  if (!data.account.nuvion_ban)
    throw new NuvionRefused(404, undefined, 'Kova’s pot has no account number at Nuvion.')
  potNumber = data.account.nuvion_ban
  return potNumber
}

/**
 * Kova's business as a counterparty of the holder's own entity, so the holder's card account can
 * pay Kova's pot back by book transfer (money moved off the card). Returns its id.
 */
export async function createKovaPayee(
  entityId: string,
  kova: { name: string; email: string; address: PayeeAddress },
) {
  const party = await nuvion<{ id?: string; counterparty?: { id: string } }>('/counterparties', {
    method: 'POST',
    body: {
      type: 'business',
      entity_id: entityId,
      profile: {
        legal_name: kova.name,
        relationship: 'vendor',
        email: kova.email,
        registered_address: {
          line1: kova.address.line1,
          city: kova.address.city,
          ...(kova.address.state ? { state_or_province: kova.address.state } : {}),
          ...(kova.address.postalCode ? { postal_code: kova.address.postalCode } : {}),
          country: kova.address.country,
        },
      },
    },
  })
  const id = party.counterparty?.id ?? party.id
  if (!id) throw new NuvionRefused(500, undefined, 'No counterparty id came back.')
  return id
}

/**
 * Moves `cents` from a holder's card account back to Kova's pot, through the holder's own
 * counterparty for Kova. `reference` is unique per move: a retry with it is refused (409), so
 * nothing leaves the card twice.
 */
export async function bookTransferToPot(
  from: { accountId: string; entityId: string },
  to: { counterpartyId: string; paymentDetailId: string },
  cents: number,
  reference: string,
  narration: string,
) {
  const data = await nuvion<{ id?: string; _id?: string; transfer?: { id: string } }>(
    '/transfers',
    {
      method: 'POST',
      body: {
        account_id: from.accountId,
        entity_id: from.entityId,
        counterparty_id: to.counterpartyId,
        payment_detail_id: to.paymentDetailId,
        currency: 'USD',
        amount: cents,
        payment_type: 'book-transfer',
        narration,
        unique_reference: reference,
      },
    },
  )
  return data.transfer?.id ?? data.id ?? data._id ?? null
}

// --- Cards ----------------------------------------------------------------------------------------

export async function cardFee(accountId: string, entityId: string): Promise<number> {
  const data = await nuvion<{ fee?: number }>(
    `/card-creation-fee/${encodeURIComponent(accountId)}?currency=USD&entity_id=${encodeURIComponent(entityId)}`,
  )
  return data.fee ?? 0
}

export async function issueVirtualCard(
  entityId: string,
  accountId: string,
  holder: { firstName: string; lastName: string; email: string; phone: string },
) {
  const data = await nuvion<{ id: string; status: string }>('/virtual-cards', {
    method: 'POST',
    body: {
      entity_id: entityId,
      account_id: accountId,
      card_name: 'Kova',
      currency: 'USD',
      cardholder: {
        first_name: holder.firstName,
        last_name: holder.lastName,
        email: holder.email,
        phone_number: holder.phone,
      },
    },
  })
  return data.id
}

/** Recover a card issued before Kova could save it, scoped to this holder's own account. */
export async function findVirtualCard(entityId: string, accountId: string): Promise<string | null> {
  const data = await nuvion<{
    cards: Array<{ id: string; type: string; status: string }>
  }>(
    `/cards?entity_id=${encodeURIComponent(entityId)}&account_id=${encodeURIComponent(accountId)}&limit=100`,
  )
  return (
    data.cards.find(
      (card) => card.type === 'virtual' && (card.status === 'active' || card.status === 'blocked'),
    )?.id ?? null
  )
}

export interface CardSecrets {
  number: string
  cvv: string
  expMonth: string
  expYear: string
  name: string
  status: string
  /** The card's billing address, as Nuvion issued it: what a checkout asks for with the number. */
  billing: CardBilling | null
}

export interface CardBilling {
  line1: string
  line2: string
  city: string
  state: string
  postalCode: string
  country: string
}

/** The card's number and CVV. Sensitive: pass it straight to the holder, never keep it. */
export async function cardSecrets(cardId: string, entityId: string): Promise<CardSecrets> {
  const d = await nuvion<{
    number: string
    cvv: string
    expiration_month: string
    expiration_year: string
    first_name?: string
    last_name?: string
    status: string
    billing?: {
      address_line_1?: string
      address_line_2?: string
      city?: string
      state?: string
      postal_code?: string
      country?: string
      country_code?: string
    }
  }>(`/card-details/${encodeURIComponent(cardId)}?entity_id=${encodeURIComponent(entityId)}`)
  return {
    number: d.number,
    cvv: d.cvv,
    expMonth: d.expiration_month,
    expYear: d.expiration_year,
    name: [d.first_name, d.last_name].filter(Boolean).join(' '),
    status: d.status,
    billing: d.billing?.address_line_1
      ? {
          line1: d.billing.address_line_1,
          line2: d.billing.address_line_2 ?? '',
          city: d.billing.city ?? '',
          state: d.billing.state ?? '',
          postalCode: d.billing.postal_code ?? '',
          // Nuvion's cards are US cards; its example leaves the country out.
          country: d.billing.country_code ?? d.billing.country ?? 'US',
        }
      : null,
  }
}

export async function setCardFrozen(cardId: string, frozen: boolean, entityId: string) {
  await nuvion(`/card-details/${encodeURIComponent(cardId)}/${frozen ? 'freeze' : 'unfreeze'}`, {
    method: 'PATCH',
    body: { entity_id: entityId },
  })
}

export interface CardPayment {
  id: string
  /** Cents; a spend is negative. */
  cents: number
  status: string
  merchant: string
  at: Date
  /** A shop's card check (Nuvion's "reversible test payment"): held for a moment, never charged. */
  check: boolean
}

export async function cardPayments(cardId: string, entityId: string): Promise<CardPayment[]> {
  const data = await nuvion<{
    payments?: Array<{
      _id: string
      amount: number
      status: string
      type?: string
      payment_type?: string
      narration?: string
      status_reason?: string
      recipient?: { name?: string }
      created: number
    }>
  }>(
    `/card-transactions/${encodeURIComponent(cardId)}?limit=20&entity_id=${encodeURIComponent(entityId)}`,
  )
  return (data.payments ?? []).map((p) => {
    const incoming = p.type === 'inflow'
    const named = p.narration?.match(/(?:Payment to|to)\s+(.+?)\s+for\s+[\d.]+/i)?.[1]
    return {
      id: p._id,
      cents: incoming ? p.amount : -p.amount,
      status: p.status,
      merchant: incoming
        ? 'Refund'
        : named?.trim() || p.recipient?.name?.trim() || p.narration?.trim() || 'Card payment',
      at: new Date(p.created),
      check: /reversible test payment/i.test(`${p.status_reason ?? ''} ${p.narration ?? ''}`),
    }
  })
}

// --- Payouts: cash-outs to banks, mobile money and wallets worldwide ------------------------------

/** One bank in a country's directory, as Nuvion lists it. */
export interface NuvionBank {
  bank_name: string
  bank_code?: string
  swift_bic?: string
  bank_institution_number?: string
}

/** A country's bank directory (empty where Nuvion has none and the bank is typed instead). */
export async function bankCodes(country: string): Promise<NuvionBank[]> {
  const data = await nuvion<NuvionBank[]>(`/bank-codes/${encodeURIComponent(country)}`)
  return Array.isArray(data) ? data : []
}

export interface FxQuote {
  id: string
  rate: number
  /** Smallest unit of the destination currency. */
  amountTo: number
  expiresAt: Date
}

/** A rate locked for a few minutes, from Kova's pot (its own margin applies) into `to`. */
export async function fxQuote(to: string, cents: number): Promise<FxQuote> {
  if (!config.NUVION_POT_ACCOUNT)
    throw new KovaError('conflict', 'Cashing out isn’t switched on for this server yet.')
  const data = await nuvion<{
    id: string
    rate: number
    amount_to: number
    quote?: { expires_at?: number; valid_for?: number }
  }>('/fx-quotes', {
    method: 'POST',
    body: {
      from_currency: 'USD',
      to_currency: to,
      amount_from: cents,
      account_id: config.NUVION_POT_ACCOUNT,
    },
  })
  const expires =
    data.quote?.expires_at ?? Date.now() + Math.max(30, data.quote?.valid_for ?? 120) * 1000
  return { id: data.id, rate: data.rate, amountTo: data.amount_to, expiresAt: new Date(expires) }
}

/** What's in Kova's pot to pay out now, in cents. */
export async function potCents(): Promise<number> {
  if (!config.NUVION_POT_ACCOUNT)
    throw new KovaError('conflict', 'Cashing out isn’t switched on for this server yet.')
  const data = await nuvion<AccountReply>(
    `/accounts/${encodeURIComponent(config.NUVION_POT_ACCOUNT)}`,
  )
  return data.account.balance?.available ?? 0
}

/**
 * Someone Kova pays out to: a counterparty of Kova's own entity, with their name, email and address
 * (Nuvion needs all three), then the one payment detail that says where the money goes.
 */
export async function createRecipient(
  person: { firstName: string; lastName: string; email: string; address: PayeeAddress },
  detail: Record<string, unknown>,
): Promise<{ counterpartyId: string; paymentDetailId: string }> {
  const party = await nuvion<{ id?: string; counterparty?: { id: string } }>('/counterparties', {
    method: 'POST',
    body: {
      type: 'individual',
      profile: {
        first_name: person.firstName,
        last_name: person.lastName,
        relationship: 'customer',
        email: person.email,
        address: {
          line1: person.address.line1,
          city: person.address.city,
          ...(person.address.state ? { state_or_province: person.address.state } : {}),
          ...(person.address.postalCode ? { postal_code: person.address.postalCode } : {}),
          country: person.address.country,
        },
      },
    },
  })
  const counterpartyId = party.counterparty?.id ?? party.id
  if (!counterpartyId) throw new NuvionRefused(500, undefined, 'No counterparty id came back.')
  const made = await nuvion<{ id?: string; payment_detail?: { id: string } }>('/payment-details', {
    method: 'POST',
    body: { ...detail, counterparty_id: counterpartyId },
  })
  const paymentDetailId = made.payment_detail?.id ?? made.id
  if (!paymentDetailId) throw new NuvionRefused(500, undefined, 'No payment detail id came back.')
  return { counterpartyId, paymentDetailId }
}

export interface NuvionTransfer {
  id: string
  status: string
  statusReason: string | null
  /** Nuvion's fee on the transfer, in the source currency's smallest unit, when it says. */
  fee: number | null
}

type TransferReply = {
  id?: string
  _id?: string
  status?: string
  status_reason?: string
  applicable_fee?: number
  transfer?: { id: string; status?: string; status_reason?: string; applicable_fee?: number }
}

const transferOf = (d: TransferReply): NuvionTransfer => {
  const t = d.transfer ?? d
  return {
    id: (t.id ?? d._id) as string,
    status: t.status ?? 'pending',
    statusReason: t.status_reason ?? null,
    fee: typeof t.applicable_fee === 'number' ? t.applicable_fee : null,
  }
}

/**
 * Pays `cents` out of Kova's pot to a recipient, converted at `fxQuoteId` when it isn't USD.
 * `reference` is unique per payout: a second try with it is refused (409), never paid twice.
 */
export async function sendPayout(input: {
  counterpartyId: string
  paymentDetailId: string
  paymentType: string
  cents: number
  reference: string
  fxQuoteId?: string | null
}): Promise<NuvionTransfer> {
  if (!config.NUVION_POT_ACCOUNT)
    throw new KovaError('conflict', 'Cashing out isn’t switched on for this server yet.')
  const data = await nuvion<TransferReply>('/transfers', {
    method: 'POST',
    body: {
      account_id: config.NUVION_POT_ACCOUNT,
      counterparty_id: input.counterpartyId,
      payment_detail_id: input.paymentDetailId,
      payment_type: input.paymentType,
      currency: 'USD',
      amount: input.cents,
      narration: 'Kova cash out',
      unique_reference: input.reference,
      ...(input.fxQuoteId ? { fx_quote_id: input.fxQuoteId } : {}),
    },
  })
  return transferOf(data)
}

export async function payoutTransfer(id: string): Promise<NuvionTransfer> {
  return transferOf(await nuvion<TransferReply>(`/transfers/${encodeURIComponent(id)}`))
}

/** The transfer made with `reference`, for a retry Nuvion refused as a duplicate (it says no more). */
export async function payoutByReference(reference: string): Promise<NuvionTransfer | null> {
  const page = await nuvion<{ data?: TransferReply[] } | TransferReply[]>(
    `/transfers?unique_reference=${encodeURIComponent(reference)}&type=outflow&limit=5`,
  )
  const list = Array.isArray(page) ? page : (page.data ?? [])
  return list[0] ? transferOf(list[0]) : null
}
