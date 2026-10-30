import { apiUrl, passkeyDomain, webUrl } from './config'

/**
 * The Kova API, from both sides of a payment.
 *
 * The payer side (checkout, a stall's page) needs no key: holding a charge's id or a stall's
 * link is enough to see what to pay.
 *
 * The shop side uses one of two keys. Every terminal, this phone included, takes payments with
 * the device key it received when it was paired. Only a shop opened on this phone also keeps
 * its owner key here, in the Keychain, to edit what the shop sells. A phone paired to someone
 * else's shop never holds more than its device key.
 */

type Auth = 'device' | 'owner'

const keys: Record<Auth, string | null> = { device: null, owner: null }

/** The paired terminal's device key, set once pairing is loaded. */
export function setDeviceKey(key: string | null) {
  keys.device = key
}

/** The device key this phone takes payments with, if it is a till. */
export const currentDeviceKey = () => keys.device

/** The shop owner's key, set when this phone opened the shop. */
export function setOwnerKey(key: string | null) {
  keys.owner = key
}

/** Called when a key is refused from then on: the shop removed this terminal, or revoked the owner key. */
const revoked: Record<Auth, (() => void) | null> = { device: null, owner: null }
export function onDeviceKeyRevoked(handler: (() => void) | null) {
  revoked.device = handler
}
export function onOwnerKeyRevoked(handler: (() => void) | null) {
  revoked.owner = handler
}

/** Kova said no: its own words, and the HTTP status, for the few screens that read it. */
export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    // Keeps instanceof working where classes extending Error are transpiled.
    Object.setPrototypeOf(this, ApiError.prototype)
  }
}

/** The HTTP status Kova answered with, or null when it wasn't Kova that failed (no connection). */
export const statusOf = (error: unknown): number | null => {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : null
}

async function request<T>(path: string, init: RequestInit & { auth?: Auth } = {}): Promise<T> {
  const { auth, ...rest } = init
  const key = auth ? keys[auth] : null
  const response = await fetch(`${apiUrl}${path}`, {
    ...rest,
    headers: {
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...rest.headers,
    },
  })
  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } }
  if (auth && key && response.status === 401) revoked[auth]?.()
  if (!response.ok)
    throw new ApiError(
      body.error?.message ?? `Kova is unreachable (${response.status})`,
      response.status,
    )
  return body as T
}

// --- App Review demo account ---------------------------------------------------------------

export interface DemoAccount {
  secret: `0x${string}`
  name: string
  currency: string
  contacts: { address: string; name: string }[]
}

/** Testnet only: the demo account's username and password, for its wallet's secret. */
export const demoSignIn = (username: string, password: string) =>
  request<DemoAccount>('/v1/demo/sign_in', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })

// --- payer ---------------------------------------------------------------------------------

export interface OrderLine {
  item_id: string
  name: string
  unit_price: string
  quantity: number
}

export interface Checkout {
  id: string
  merchant_name: string
  amount: string
  amount_base: string
  currency: string
  status: 'requires_payment' | 'processing' | 'paid' | 'held' | 'failed' | 'canceled' | 'expired'
  token: `0x${string}`
  pay_to: `0x${string}`
  memo: `0x${string}`
  reference: string | null
  expires_at: string
  /** What was ordered, when this charge came from a stall or a till sale. */
  order?: {
    id?: string
    lines: OrderLine[]
    customer_name: string | null
    note: string | null
    pay_for_me: boolean
    stall: { id: string; name: string; slug: string } | null
    /** Where it is at the counter, so the buyer's phone can say when it's ready. */
    status?: OrderStatus
    /** The table it's brought to. Null: collected at the counter. */
    table?: string | null
    /** A full stamp card spent on this order. */
    reward?: StampReward | null
  } | null
  /** The flight or hotel, when this charge is a share of a Kova Travel trip. */
  trip?: {
    kind: 'flight' | 'stay'
    title: string
    subtitle: string
    provider: { name: string; image: string | null }
    booked_by: string
    share: string
    shares: number
    pay_by: string
  } | null
}

export const getCheckout = (id: string) => request<Checkout>(`/v1/checkout/${id}`)

export const confirmCheckout = (id: string, txHash: string) =>
  request<Checkout>(`/v1/checkout/${id}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ tx_hash: txHash }),
  })

// --- stalls, as a buyer sees them ----------------------------------------------------------

export interface CatalogItem {
  id: string
  name: string
  description: string | null
  price: string
  image_url: string | null
  image_id: string | null
  barcode: string | null
  sold_out: boolean
  /** How many are left, or null when the shop doesn't count. */
  stock: number | null
  category: string | null
  created_at: string
}

export interface Stall {
  id: string
  slug: string
  name: string
  tagline: string | null
  open: boolean
  cover_url: string | null
  cover_image_id: string | null
  item_ids?: string[]
  /** Tables with their own QR code (the stall link with ?table=N). Null: counter only. */
  table_count?: number | null
  /** Paid orders that fill the stamp card; the next order's cheapest item is free. Null: no card. */
  loyalty_every?: number | null
  created_at: string
}

export interface StallDetail extends Stall {
  items: CatalogItem[]
}

export interface PublicStall extends Stall {
  shop_name: string
  livemode: boolean
  items: Omit<CatalogItem, 'barcode' | 'image_id'>[]
}

/** The item a full stamp card made free. */
export interface StampReward {
  item_id: string
  name: string
  amount: string
  stamps: number
}

export interface StampCard {
  object: 'stamp_card'
  /** Paid orders that fill the card. Null: this stall has no card. */
  every: number | null
  stamps: number
  /** Full: the next order's cheapest item is free. */
  ready: boolean
}

export interface PlacedOrder {
  id: string
  checkout: {
    id: string
    amount: string
    status: Checkout['status']
    expires_at: string
    link: string
  }
  /** Set when the payer's stamp card was full: this item is free, and the charge is lower (it can be $0). */
  reward?: StampReward | null
}

export const getPublicStall = (slug: string) =>
  request<PublicStall>(`/v1/public/stalls/${encodeURIComponent(slug)}`)

/** Order from a stall. The server prices every line; the result is a charge to pay, or to send on. */
export const orderFromStall = (
  slug: string,
  order: {
    items: { id: string; quantity: number }[]
    customer_name?: string
    note?: string
    pay_for_me?: boolean
    /** The table it's ordered from, from the table's QR code. */
    table?: string
    /** The wallet that will pay: it earns the stamp, and spends a full card. */
    payer?: string
  },
) =>
  request<PlacedOrder>(`/v1/public/stalls/${encodeURIComponent(slug)}/orders`, {
    method: 'POST',
    body: JSON.stringify(order),
  })

/** A wallet's stamp card at a stall. The wallet that pays is the card: there's nothing to sign up for. */
export const getStampCard = (slug: string, payer: string) =>
  request<StampCard>(
    `/v1/public/stalls/${encodeURIComponent(slug)}/stamps?payer=${encodeURIComponent(payer)}`,
  )

// --- shop: taking payments (device key) ----------------------------------------------------

export interface PaymentIntent {
  id: string
  amount: string
  currency: string
  status: Checkout['status']
  pay_to: string
  memo: string
  reference: string | null
  metadata?: Record<string, unknown> | null
  created_at: string
  expires_at?: string
  paid_at: string | null
  payer?: string | null
  terminal?: { id: string; name: string } | null
  order?: Order | null
}

export interface Summary {
  merchant: { id: string; name: string; livemode: boolean }
  today?: { total: string; count: number }
  [key: string]: unknown
}

export const createCharge = (
  amount: string,
  options: { reference?: string; metadata?: Record<string, unknown> } = {},
) =>
  request<PaymentIntent>('/v1/payment_intents', {
    method: 'POST',
    auth: 'device',
    body: JSON.stringify({ amount, ...options }),
  })

export const getCharge = (id: string) =>
  request<PaymentIntent>(`/v1/payment_intents/${id}`, { auth: 'device' })

export const cancelCharge = (id: string) =>
  request<PaymentIntent>(`/v1/payment_intents/${id}/cancel`, { method: 'POST', auth: 'device' })

export const getSummary = () => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  return request<Summary>(`/v1/summary${tz ? `?tz=${encodeURIComponent(tz)}` : ''}`, {
    auth: 'device',
  })
}

export const listCharges = (limit = 25) =>
  request<{ data: PaymentIntent[] }>(`/v1/payment_intents?limit=${limit}`, { auth: 'device' }).then(
    (r) => r.data,
  )

export type OrderStatus = 'new' | 'preparing' | 'ready' | 'collected' | 'cancelled'

export interface Order {
  id: string
  source: 'stall' | 'till'
  payment_intent: string
  stall: { id: string; name: string; slug: string } | null
  lines: OrderLine[]
  customer_name: string | null
  note: string | null
  pay_for_me: boolean
  /** The table to bring it to. Null: collected at the counter. */
  table?: string | null
  /** A full stamp card spent on this order: the item that was free. */
  reward?: StampReward | null
  /** What the counter must notice in the note, like "allergy" (read by Jev). */
  flags?: string[]
  /** Where it is at the counter. */
  status: OrderStatus
  collected_at: string | null
  created_at: string
  amount?: string
  payment_status?: Checkout['status']
  paid_at?: string | null
}

/** Stall orders, newest first. open: paid and not handed over yet; unpaid: still waiting for payment. */
export const listOrders = (status: 'all' | 'open' | 'collected' | 'unpaid' = 'all', limit = 50) =>
  request<{ data: Order[] }>(`/v1/orders?status=${status}&source=stall&limit=${limit}`, {
    auth: 'device',
  }).then((r) => r.data)

/** Moves an order along the counter: new, preparing, ready, collected or cancelled. */
export const setOrderStatus = (id: string, status: OrderStatus) =>
  request<Order>(`/v1/orders/${id}/status`, {
    method: 'POST',
    auth: 'device',
    body: JSON.stringify({ status }),
  })

/** Handed over, or back to waiting to undo a mistap. */
export const collectOrder = (id: string, collected = true) =>
  request<Order>(`/v1/orders/${id}/collect`, {
    method: 'POST',
    auth: 'device',
    body: JSON.stringify({ collected }),
  })

/** A till sale: what was scanned or picked at the counter, priced by Kova from the catalogue. */
export const ringUp = (items: { id: string; quantity: number }[], note?: string) =>
  request<Order & { payment_intent: PaymentIntent }>('/v1/orders', {
    method: 'POST',
    auth: 'device',
    body: JSON.stringify({ items, note }),
  })

export const getCatalog = () =>
  request<{ data: CatalogItem[] }>('/v1/catalog/items', { auth: 'device' }).then((r) => r.data)

export interface BarcodeLookup {
  code: string
  /** This shop's item with that barcode. */
  item: CatalogItem | null
  /** Otherwise, what open product databases know about it. */
  suggestion: {
    name: string
    brand: string | null
    image_url: string | null
    source: string
  } | null
}

export const lookupBarcode = (code: string, auth: Auth = 'device') =>
  request<BarcodeLookup>(`/v1/catalog/barcodes/${encodeURIComponent(code)}`, { auth })

export interface PairedTerminal {
  id: string
  name: string
  merchant: { id: string; name: string }
  key: string
}

/** Redeems a pairing code from the dashboard for this phone's own terminal key. */
export const pairTerminal = (code: string, name: string, device: Record<string, unknown>) =>
  request<PairedTerminal>('/v1/terminals/pair', {
    method: 'POST',
    body: JSON.stringify({ code, name, device }),
  })

/** Tells Kova this phone is no longer a terminal, so its key stops working everywhere. */
export const unpairTerminal = () =>
  request<{ status: string }>('/v1/terminals/self/unpair', { method: 'POST', auth: 'device' })

// --- shop: running it (owner key) ----------------------------------------------------------

export interface OpenedShop {
  id: string
  name: string
  livemode: boolean
  /** The owner key. Shown once; it goes straight into the Keychain. */
  key: string
}

/**
 * The message a wallet signs to prove it owns a shop (EIP-4361), for Kova's own site: the same
 * proof the web asks for, so the web signs this wallet in to the same shop.
 */
export const shopChallenge = (address: string, purpose: 'sign_in' | 'open_shop' | 'own_shop') =>
  request<{ message: string }>('/v1/sign_in/challenge', {
    method: 'POST',
    body: JSON.stringify({ address, purpose, domain: passkeyDomain, uri: webUrl }),
  })

/**
 * Opens a shop whose payments settle in `settlementAddress`: this phone's own wallet. With the
 * wallet's signed "open a shop" message, the wallet owns it: its passkey signs in to it on the web.
 */
export const openShop = (
  name: string,
  settlementAddress: string,
  owner?: { message: string; signature: string },
) =>
  request<OpenedShop>('/v1/merchants', {
    method: 'POST',
    body: JSON.stringify({
      name,
      settlement_address: settlementAddress,
      ...(owner ? { owner } : {}),
    }),
  })

/** Signs a wallet in to the shop it owns (its newest, if several): a session key for this phone. */
export const signInToShop = (message: string, signature: string) =>
  request<{ key: string; merchant: { id: string; name: string } }>('/v1/sign_in', {
    method: 'POST',
    body: JSON.stringify({ message, signature, newest: true }),
  })

/** Who signs in to the shop this phone owns (its owner's wallet, or nobody's yet), and where its payments settle. */
export const getOwnedShop = () =>
  request<{
    id: string
    name: string
    owner_address: string | null
    settlement_address: `0x${string}`
  }>('/v1/account', { auth: 'owner' })

/** Makes a wallet the shop's owner with its signed message, so its passkey signs in on the web. */
export const linkShopOwner = (message: string, signature: string) =>
  request<{ owner_address: string | null }>('/v1/account/owner', {
    method: 'POST',
    body: JSON.stringify({ message, signature }),
    auth: 'owner',
  })

/** A lasting owner key for this phone: a shop opened with a wallet signs in with a key that lapses. */
export const createOwnerKey = (name: string) =>
  request<{ secret: string }>('/v1/api_keys', {
    method: 'POST',
    body: JSON.stringify({ name }),
    auth: 'owner',
  })

/** A one-time code to pair a terminal; the phone that opened the shop pairs itself with one. */
export const createPairing = () =>
  request<{ code: string; link: string }>('/v1/terminals/pairings', {
    method: 'POST',
    auth: 'owner',
  })

export const listStalls = () =>
  request<{ data: Stall[] }>('/v1/stalls', { auth: 'owner' }).then((r) => r.data)

export const getStall = (id: string) => request<StallDetail>(`/v1/stalls/${id}`, { auth: 'owner' })

export const createStall = (stall: { name: string; tagline?: string | null }) =>
  request<Stall>('/v1/stalls', { method: 'POST', auth: 'owner', body: JSON.stringify(stall) })

export const updateStall = (
  id: string,
  patch: Partial<{
    name: string
    tagline: string | null
    open: boolean
    item_ids: string[]
    table_count: number | null
    loyalty_every: number | null
  }>,
) =>
  request<Stall>(`/v1/stalls/${id}`, {
    method: 'PATCH',
    auth: 'owner',
    body: JSON.stringify(patch),
  })

export interface ItemInput {
  name: string
  price: string
  description?: string | null
  barcode?: string | null
  image_id?: string | null
  sold_out?: boolean
  /** How many are left; null stops counting. */
  stock?: number | null
  category?: string | null
}

export const createItem = (item: ItemInput & { stall_ids?: string[] }) =>
  request<CatalogItem>('/v1/catalog/items', {
    method: 'POST',
    auth: 'owner',
    body: JSON.stringify(item),
  })

export const updateItem = (id: string, patch: Partial<ItemInput>) =>
  request<CatalogItem>(`/v1/catalog/items/${id}`, {
    method: 'PATCH',
    auth: 'owner',
    body: JSON.stringify(patch),
  })

/** Before adding a product: does the shop already sell it under another name? (Jev) */
export const findSimilarItem = (name: string) =>
  request<{ item: CatalogItem | null; confidence: number | null }>('/v1/catalog/similar', {
    method: 'POST',
    auth: 'owner',
    body: JSON.stringify({ name }),
  })

export const removeItem = (id: string) =>
  request<{ deleted: boolean }>(`/v1/catalog/items/${id}`, { method: 'DELETE', auth: 'owner' })

/** Uploads a photo already on the phone (a file URI). Returns its id for an item. */
export async function uploadImage(uri: string, contentType = 'image/jpeg') {
  const bytes = await (await fetch(uri)).blob()
  const response = await fetch(`${apiUrl}/v1/images`, {
    method: 'POST',
    headers: {
      'content-type': contentType,
      ...(keys.owner ? { authorization: `Bearer ${keys.owner}` } : {}),
    },
    body: bytes,
  })
  const body = (await response.json().catch(() => ({}))) as {
    id?: string
    url?: string
    error?: { message?: string }
  }
  if (!response.ok || !body.id)
    throw new Error(body.error?.message ?? `The photo didn’t upload (${response.status})`)
  return { id: body.id, url: body.url ?? null }
}

export interface MenuImport {
  currency: string
  items: {
    name: string
    description: string | null
    price: string
    original: { amount: number; currency: string }
  }[]
}

/** Snap your menu: a photo of a menu board or price list in, suggested items out. Nothing is saved. */
export const readMenuPhoto = (
  base64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg',
) =>
  request<MenuImport>('/v1/catalog/import', {
    method: 'POST',
    auth: 'owner',
    body: JSON.stringify({ image: base64, media_type: mediaType }),
  })

// --- shop: private takings (owner key) -----------------------------------------------------

/**
 * A sale paid to one of the shop's one-time addresses (ERC-5564), with what the shop's viewing
 * key needs to find it and its spending key to open it. Kova lists them; the phone checks each.
 */
export interface StealthReceipt {
  scheme_id: number
  stealth_address: `0x${string}`
  /** Compressed, 33 bytes. */
  ephemeral_public_key: `0x${string}`
  view_tag: `0x${string}`
  /** Dollars, e.g. "8.00". */
  amount: string
  currency: string
  token: `0x${string}`
  tx_hash: `0x${string}`
  explorer_url: string
  paid_at: string | null
  payment_intent: string
  /** The move into the shop's wallet, once it's happened. */
  swept_tx: `0x${string}` | null
  swept_at: string | null
}

export interface PrivateTakings {
  enabled: boolean
  /** `st:eth:0x…`, the two public keys new charges are paid through. Null when off. */
  meta_address: string | null
  /** Paid sales at one-time addresses, newest first, including ones made while it was on before. */
  receipts: StealthReceipt[]
}

/** One move from a one-time address into the shop's wallet: done, or why not. */
export type TakingsMove =
  | {
      from: `0x${string}`
      to: `0x${string}`
      amount: string
      tx_hash: `0x${string}`
      explorer_url: string
      ms: number
    }
  | { from: `0x${string}`; error: string }

export const getPrivateTakings = () =>
  request<PrivateTakings>('/v1/private_takings', { auth: 'owner' })

/** From now on every charge pays a fresh one-time address made from this meta-address. */
export const turnOnPrivateTakings = (metaAddress: string) =>
  request<{ enabled: true; meta_address: string }>('/v1/private_takings', {
    method: 'PUT',
    auth: 'owner',
    body: JSON.stringify({ meta_address: metaAddress }),
  })

/** New charges pay the shop's wallet again. Sales already at one-time addresses stay the shop's to move. */
export const turnOffPrivateTakings = () =>
  request<{ enabled: false }>('/v1/private_takings', { method: 'DELETE', auth: 'owner' })

/** Moves sales into the shop's wallet: transfer authorizations signed with each address's own key, 50 at most. Kova pays the gas. */
export const moveTakings = (authorizations: unknown[]) =>
  request<{ data: TakingsMove[] }>('/v1/private_takings/sweep', {
    method: 'POST',
    auth: 'owner',
    body: JSON.stringify({ authorizations }),
  }).then((r) => r.data)

// --- travel --------------------------------------------------------------------------------

export interface Money {
  /** What Kova Travel charges, in dollars. */
  usd: string
  /** As the airline or hotel priced it. */
  amount: string
  currency: string
}

export interface Place {
  type: 'airport' | 'city'
  iata: string
  name: string
  city: string
  country: string
  latitude: number | null
  longitude: number | null
}

export interface Segment {
  id: string
  from: { iata: string; city: string }
  to: { iata: string; city: string }
  departs: string
  arrives: string
  minutes: number | null
  carrier: { name: string; iata: string; logo: string | null }
  operated_by: string | null
  flight: string
  aircraft: string | null
}

export interface Slice {
  id: string
  from: { iata: string; city: string; name: string }
  to: { iata: string; city: string; name: string }
  departs: string | null
  arrives: string | null
  minutes: number | null
  stops: number
  segments: Segment[]
}

export interface FlightOffer {
  id: string
  price: Money
  expires_at: string
  holdable: boolean
  hold_until: string | null
  owner: { name: string; iata: string; logo: string | null }
  cabin: string | null
  bags: { checked: number; carry_on: number }
  refundable: boolean
  changeable: boolean
  passengers: { id: string; type: string; age: number | null }[]
  slices: Slice[]
}

export interface ExtraBag {
  id: string
  kind: 'checked' | 'carry_on'
  weight_kg: number | null
  max: number
  passenger_ids: string[]
  segment_ids: string[]
  price: Money
}

export type SeatCell =
  | {
      kind: 'seat'
      designator: string
      name: string | null
      available: boolean
      services: { id: string; passenger_id: string; price: Money }[]
    }
  | { kind: 'exit' | 'space' }

export interface SeatMap {
  id: string
  segment_id: string
  aisles: number
  wings: { first_row_index: number; last_row_index: number } | null
  rows: SeatCell[][][]
}

export interface StayResult {
  id: string
  check_in: string
  check_out: string
  rooms: number
  guests: number
  from_price: Money | null
  accommodation: {
    id: string
    name: string
    stars: number | null
    review_score: number | null
    review_count: number | null
    photos: string[]
    address: string
    city: string
    amenities: string[]
    check_in_after: string | null
    check_out_before: string | null
    description: string | null
  }
}

export interface StayRate {
  id: string
  price: Money
  board: string
  cancellation: string
  pay_at_hotel: string | null
  expires_at: string
  payable: boolean
}

export interface StayDetail extends StayResult {
  rooms_available: { name: string; photos: string[]; beds: string; rates: StayRate[] }[]
}

export interface TripShare {
  label: string
  amount: string
  status: Checkout['status']
  checkout: string | null
}

export interface Trip {
  id: string
  kind: 'flight' | 'stay'
  status: 'awaiting_payment' | 'booking' | 'booked' | 'failed' | 'expired' | 'canceled'
  test_mode: boolean
  summary: {
    title: string
    subtitle: string
    provider: { name: string; image: string | null }
    legs: {
      from: string
      to: string
      departs: string
      arrives: string
      carrier: string | null
      flight: string | null
      stops: number
      duration: string | null
    }[]
    room?: { name: string; board: string; cancellation: string }
    extras: string[]
    bookedBy: string
  }
  amount: string
  fare: { amount: string; currency: string }
  pay_by: string
  held: boolean
  booking_reference: string | null
  travellers: string[]
  failure: string | null
  shares: TripShare[]
  created_at: string
}

export interface UnderstoodTrip {
  kind: 'flight' | 'stay'
  from: string | null
  to: string | null
  depart: string | null
  return: string | null
  adults: number
  children: number
  infants: number
  cabin: 'economy' | 'premium_economy' | 'business' | 'first'
  city: string | null
  check_in: string | null
  check_out: string | null
  rooms: number
  wishes: string | null
  from_place: Place | null
  to_place: Place | null
  city_place: Place | null
}

export interface FlightSearch {
  from: string
  to: string
  depart: string
  return?: string | null
  adults: number
  children: number
  infants: number
  cabin: UnderstoodTrip['cabin']
  wishes?: string | null
}

export interface StaySearch {
  latitude?: number | null
  longitude?: number | null
  check_in: string
  check_out: string
  adults: number
  children: number
  rooms: number
  wishes?: string | null
}

export interface TravellerInput {
  given_name: string
  family_name: string
  born_on?: string
  gender?: 'm' | 'f'
  title?: 'mr' | 'ms' | 'mrs' | 'miss' | 'dr'
  email?: string
  phone_number?: string
  passenger_id?: string
}

export const travelStatus = () =>
  request<{ ready: boolean; test_mode: boolean; understands: boolean }>('/v1/travel')

export const searchPlaces = (q: string) =>
  request<{ data: Place[] }>(`/v1/travel/places?q=${encodeURIComponent(q)}`).then((r) => r.data)

export const understandTrip = (text: string) =>
  request<UnderstoodTrip>('/v1/travel/understand', {
    method: 'POST',
    body: JSON.stringify({ text, today: new Date().toISOString().slice(0, 10) }),
  })

export const searchFlights = (search: FlightSearch) =>
  request<{ data: FlightOffer[]; best: string | null; test_mode: boolean }>(
    '/v1/travel/flights/search',
    { method: 'POST', body: JSON.stringify(search) },
  )

export const getFlightOffer = (id: string) =>
  request<FlightOffer & { extra_bags: ExtraBag[] }>(`/v1/travel/flights/offers/${id}`)

export const getSeatMaps = (offerId: string) =>
  request<{ data: SeatMap[] }>(`/v1/travel/flights/offers/${offerId}/seats`).then((r) => r.data)

export const searchStays = (search: StaySearch) =>
  request<{ data: StayResult[]; best: string | null; test_mode: boolean }>(
    '/v1/travel/stays/search',
    { method: 'POST', body: JSON.stringify(search) },
  )

export const getStay = (resultId: string) =>
  request<StayDetail>(`/v1/travel/stays/results/${resultId}`)

export type CreatedTrip = Omit<Trip, 'shares'> & {
  token: string
  shares: (TripShare & { link: string })[]
}

export const createFlightTrip = (body: {
  offer_id: string
  travellers: TravellerInput[]
  services: { id: string; quantity: number }[]
  extras: string[]
  payers: string[]
  booked_by: string
}) =>
  request<CreatedTrip>('/v1/travel/trips', {
    method: 'POST',
    body: JSON.stringify({ kind: 'flight', ...body }),
  })

export const createStayTrip = (body: {
  rate_id: string
  guests: { given_name: string; family_name: string }[]
  email: string
  phone_number: string
  payers: string[]
  booked_by: string
}) =>
  request<CreatedTrip>('/v1/travel/trips', {
    method: 'POST',
    body: JSON.stringify({ kind: 'stay', ...body }),
  })

export const getTrip = (id: string, token: string) =>
  request<Trip>(`/v1/travel/trips/${id}`, { headers: { 'x-trip-token': token } })

// --- insights ------------------------------------------------------------------------------

export type SpendingCategory =
  | 'food'
  | 'groceries'
  | 'travel'
  | 'transport'
  | 'shopping'
  | 'bills'
  | 'health'
  | 'people'
  | 'other'

/** Sorts payments into spending categories (Jev). Nothing is stored on Kova's side. */
export const categorize = (payments: { id: string; text: string }[]) =>
  request<{ ready: boolean; data: Record<string, SpendingCategory> }>('/v1/insights/categories', {
    method: 'POST',
    body: JSON.stringify({ payments }),
  })

// --- links ---------------------------------------------------------------------------------

/** What the terminal's QR encodes: the public pay page, which Kova Pay also opens directly. */
export const payLinkFor = (id: string) => `${webUrl}/pay/${id}`

/** A stall's own page. Its QR on a table or a poster opens the stall in Kova Pay or any browser. */
export const stallLinkFor = (slug: string) => `${webUrl}/s/${slug}`

/** One table's own code: the stall link that remembers the table, so the order is brought to it. */
export const tableLinkFor = (slug: string, table: string) =>
  `${stallLinkFor(slug)}?table=${encodeURIComponent(table)}`

/** The printable table poster, on the web. */
export const posterLinkFor = (slug: string) => `${webUrl}/s/${slug}/poster`

// --- naira (the API's routes/naira.ts) -----------------------------------------------------

export interface NairaInfo {
  enabled: boolean
  /** Who moves the naira: PAJ on Monad mainnet, or Paystack. */
  partner?: 'paj' | 'paystack' | null
  test_mode?: boolean
  rate_source?: 'chainlink' | 'table' | 'paj'
  market_rate?: string
  cash_out_rate?: string
  top_up_rate?: string
}

export interface NairaBank {
  name: string
  code: string
  /** The bank's round logo (PAJ's list has one per bank). */
  logo?: string | null
}

export interface NairaQuote {
  /** The dollars: what was asked, or for a quote by naira, what it takes. */
  amount?: string
  naira: string
  rate: string
  fee: string
  rate_source: 'chainlink' | 'table' | 'paj'
}

export interface NairaTopUp {
  reference: string
  partner?: 'paj' | 'paystack'
  amount: string
  naira: string
  status: 'initialized' | 'paid' | 'settled' | 'failed'
  /** PAJ: the bank account opened for this one payment, and exactly what to send it. */
  bank_transfer?: {
    bank_name: string | null
    account_number: string
    account_name: string | null
    naira: string
    naira_kobo: string
  } | null
  tx_url: string | null
  failure: string | null
  test_mode: boolean
}

export const naira = {
  info: () => request<NairaInfo>('/v1/naira').catch((): NairaInfo => ({ enabled: false })),
  banks: () => request<{ data: NairaBank[] }>('/v1/naira/banks').then((r) => r.data),
  accountName: (accountNumber: string, bankCode: string) =>
    request<{ account_name: string }>('/v1/naira/account', {
      method: 'POST',
      body: JSON.stringify({ account_number: accountNumber, bank_code: bankCode }),
    }).then((r) => r.account_name),
  quote: (dollars: string, direction: 'in' | 'out') =>
    request<NairaQuote>(`/v1/naira/quote?amount=${dollars}&direction=${direction}`),
  /** A cash-out by what the bank account should get: the dollars it takes, and the naira exactly. */
  quoteByNaira: (amount: string) =>
    request<NairaQuote>(`/v1/naira/quote?naira=${amount}&direction=out`),
  cashOut: (wallet: string, input: { amount: string; bankCode: string; accountNumber: string }) =>
    request<import('./chain').CashOutToPay>(`/v1/wallets/${wallet}/cash-outs`, {
      method: 'POST',
      body: JSON.stringify({
        amount: input.amount,
        bank_code: input.bankCode,
        account_number: input.accountNumber,
      }),
    }),
  cashOutStatus: (id: string) => request<import('./chain').CashOutToPay>(`/v1/cash-outs/${id}`),
  /** Paystack sends a receipt to the email; PAJ needs none. */
  topUp: (wallet: string, input: { amount: string; email?: string; returnUrl: string }) =>
    request<NairaTopUp & { url: string; fee: string }>(`/v1/wallets/${wallet}/naira-top-ups`, {
      method: 'POST',
      body: JSON.stringify({
        amount: input.amount,
        ...(input.email ? { email: input.email } : {}),
        return_url: input.returnUrl,
      }),
    }),
  verifyTopUp: (reference: string) =>
    request<NairaTopUp>(`/v1/naira-top-ups/${reference}/verify`, { method: 'POST' }),
}

// --- Kova for Business ---------------------------------------------------------------------------

export interface Business {
  name: string
  owner_address: string | null
  settlement_address: string
  month_starts: string
  payroll: {
    paid_this_month: string
    payments_this_month: number
    runs_this_month: number
    people: number
  }
  suppliers: {
    paid_this_month: string
    paid_today: string
    payments_this_month: number
    count: number
  }
}

export interface PayrollPerson {
  id: string
  name: string
  wallet_address: string
  amount: string | null
}

export interface PayrollPayment {
  id: string
  person: string | null
  name: string
  amount: string
  status: 'pending' | 'paid' | 'failed'
  stealth_address: string | null
  tx_hash: string | null
  explorer_url: string | null
  failure: string | null
  paid_at: string | null
}

export interface PayrollRun {
  id: string
  label: string
  total: string
  paid_total: string
  people: number
  paid: number
  failed: number
  status: 'paying' | 'paid' | 'partial'
  created_at: string
  payments: PayrollPayment[]
}

export interface Supplier {
  id: string
  name: string
  wallet_address: string
  country: string | null
  currency: string
  paid_total: string
  payments: number
  last_paid_at: string | null
}

export interface SupplierPayment {
  id: string
  supplier: string
  supplier_name?: string
  amount: string
  note: string | null
  tx_hash: string
  explorer_url: string
  paid_at: string
}

export interface TeamKey {
  id: string
  kind: string
  name: string
  daily_limit: string | null
  spent_today: string | null
  frozen: boolean
  ends_at: string | null
  created_at: string
}

export const getBusiness = () => request<Business>('/v1/business', { auth: 'owner' })
export const listPayrollPeople = () =>
  request<{ data: PayrollPerson[] }>('/v1/business/people', { auth: 'owner' }).then((r) => r.data)
export const addPayrollPerson = (person: {
  name: string
  wallet_address: string
  amount?: string | null
}) =>
  request<PayrollPerson>('/v1/business/people', {
    method: 'POST',
    auth: 'owner',
    body: JSON.stringify(person),
  })
export const removePayrollPerson = (id: string) =>
  request<{ deleted: true }>(`/v1/business/people/${id}`, { method: 'DELETE', auth: 'owner' })
export const listPayrollRuns = () =>
  request<{ data: PayrollRun[] }>('/v1/business/payroll', { auth: 'owner' }).then((r) => r.data)
export const getPayrollRun = (id: string) =>
  request<PayrollRun>(`/v1/business/payroll/${id}`, { auth: 'owner' })
export const startPayrollRun = (
  label: string,
  payments: { person: string | null; name: string; amount: string }[],
) =>
  request<PayrollRun>('/v1/business/payroll', {
    method: 'POST',
    auth: 'owner',
    body: JSON.stringify({ label, payments }),
  })
export const reportPayrollPayment = (
  run: string,
  payment: string,
  result: { stealth_address: string; tx_hash: string } | { failure: string },
) =>
  request<PayrollPayment>(`/v1/business/payroll/${run}/payments/${payment}`, {
    method: 'POST',
    auth: 'owner',
    body: JSON.stringify(result),
  })
export const listSuppliers = () =>
  request<{ data: Supplier[] }>('/v1/business/suppliers', { auth: 'owner' }).then((r) => r.data)
export const addSupplier = (supplier: {
  name: string
  wallet_address: string
  country?: string | null
  currency: string
}) =>
  request<Supplier>('/v1/business/suppliers', {
    method: 'POST',
    auth: 'owner',
    body: JSON.stringify(supplier),
  })
export const listSupplierPayments = () =>
  request<{ data: SupplierPayment[] }>('/v1/business/supplier_payments', { auth: 'owner' }).then(
    (r) => r.data,
  )
export const recordSupplierPayment = (
  supplier: string,
  payment: { amount: string; tx_hash: string; note?: string | null },
) =>
  request<SupplierPayment>(`/v1/business/suppliers/${supplier}/payments`, {
    method: 'POST',
    auth: 'owner',
    body: JSON.stringify(payment),
  })

/**
 * The team keys that can spend the business's dollars, from Keys. Asked with the owner's key but
 * outside `request`: a server without keys answering 401 or 404 must not sign the shop out here.
 */
export async function getTeamKeys(
  wallet: string,
): Promise<{ available: boolean; data: TeamKey[] }> {
  const key = keys.owner
  const response = await fetch(`${apiUrl}/v1/wallets/${wallet}/keys?kind=team`, {
    headers: {
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
  }).catch(() => null)
  if (!response?.ok) return { available: false, data: [] }
  const body = (await response.json().catch(() => ({}))) as { data?: TeamKey[] }
  return { available: true, data: body.data ?? [] }
}

// --- programmable payments (the API's routes/programs.ts) ----------------------------------------

/** A payment that repeats, from either side: the wallet pays it, or it pays the wallet. */
export interface RepeatPayment {
  object: 'repeat_payment'
  id: string
  plan_id: string
  role: 'paying' | 'getting'
  payer: `0x${string}`
  payee: `0x${string}`
  label: string | null
  /** Dollars each time, e.g. "50.00". */
  amount: string
  /** Seconds between payments. */
  every: number
  times: number
  left: number
  paid: number
  /** When the next one is collected. Null once it's stopped or finished. */
  next_at: string | null
  status: 'active' | 'stopped' | 'finished'
  /** Why the last one didn't go, in plain words, e.g. the wallet was short. */
  problem: string | null
  last_paid_at: string | null
  created_at: string
  tx_hash?: string
}

export interface RepeatPlanInput {
  payee: `0x${string}`
  /** Dollars each time, e.g. "50.00". */
  amount: string
  every: number
  /** Unix seconds of the first payment. */
  start: number
  times: number
  label?: string
}

/** What the payer signs to start a plan: the plan, and a permit for the most it can ever take. */
export interface RepeatToSign {
  contract: `0x${string}`
  chain_id: number
  token: `0x${string}`
  nonce: string
  permit_nonce: string
  /** Base units: the amount times the most payments. */
  permit_value: string
  deadline: string
}

export interface RepeatStopToSign {
  contract: `0x${string}`
  chain_id: number
  plan_id: string
  nonce: string
  deadline: string
}

/** Kova hasn't switched this on yet on this network: a 404 that says so. */
export const notSwitchedOn = (error: unknown) =>
  statusOf(error) === 404 && error instanceof Error && /switched on/i.test(error.message)

export const listRepeats = (wallet: string) =>
  request<{ data: RepeatPayment[] }>(`/v1/wallets/${wallet}/repeats`).then((r) => r.data)

/** The same list, and whether new plans can start (off until Kova switches repeat payments on). */
export const repeatsOf = (wallet: string) =>
  request<{ live?: boolean; data: RepeatPayment[] }>(`/v1/wallets/${wallet}/repeats`)

export const prepareRepeat = (wallet: string, plan: RepeatPlanInput) =>
  request<RepeatToSign>(`/v1/wallets/${wallet}/repeats/prepare`, {
    method: 'POST',
    body: JSON.stringify(plan),
  })

export const startRepeat = (
  wallet: string,
  plan: RepeatPlanInput & {
    deadline: string
    signature: `0x${string}`
    permit: { value: string; deadline: string; signature: `0x${string}` }
  },
) =>
  request<RepeatPayment>(`/v1/wallets/${wallet}/repeats`, {
    method: 'POST',
    body: JSON.stringify(plan),
  })

export const prepareStopRepeat = (wallet: string, id: string) =>
  request<RepeatStopToSign>(`/v1/wallets/${wallet}/repeats/${id}/stop/prepare`, {
    method: 'POST',
  })

export const stopRepeat = (
  wallet: string,
  id: string,
  stop: { deadline: string; signature: `0x${string}` },
) =>
  request<RepeatPayment>(`/v1/wallets/${wallet}/repeats/${id}/stop`, {
    method: 'POST',
    body: JSON.stringify(stop),
  })

export interface SplitShareOut {
  to: `0x${string}`
  /** Basis points: 1000 is 10%. */
  bps: number
  name?: string
}

/** A shop's splits: off on this network, or its shares as Monad has them. */
export type ShopSplits =
  | { object: 'splits'; live: false }
  | {
      object: 'splits'
      live: true
      contract: `0x${string}`
      chain_id: number
      /** The wallet the shop is paid into: the only one that can sign its shares. */
      owner: `0x${string}`
      splitter: `0x${string}`
      on: boolean
      shares: SplitShareOut[]
      private_takings: boolean
      tx_hash?: string
    }

export interface SplitsToSign {
  contract: `0x${string}`
  chain_id: number
  owner: `0x${string}`
  to: `0x${string}`[]
  bps: number[]
  nonce: string
  deadline: string
}

export const getSplits = () => request<ShopSplits>('/v1/splits', { auth: 'owner' })

export const prepareSplits = (shares: SplitShareOut[]) =>
  request<SplitsToSign>('/v1/splits/prepare', {
    method: 'POST',
    auth: 'owner',
    body: JSON.stringify({ shares }),
  })

export const saveSplits = (shares: SplitShareOut[], deadline: string, signature: `0x${string}`) =>
  request<ShopSplits>('/v1/splits', {
    method: 'POST',
    auth: 'owner',
    body: JSON.stringify({ shares, deadline, signature }),
  })
