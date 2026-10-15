import { createHash, randomBytes } from 'node:crypto'
import { schema, uuidv7 } from '@kova/db'
import { formatAmount, parseAmount } from '@kova/monad'
import { and, eq, inArray, lt } from 'drizzle-orm'
import { getAddress, isAddress } from 'viem'
import { feePayerAddress, settlementCurrency } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { KovaError, notFound } from '../errors.js'
import { decodeId, encodeId } from '../ids.js'
import { duffel, money, serializeOffer, travelTestMode } from './duffel.js'
import { createIntent } from './intents.js'
import { refundTrip } from './refunds.js'

type Trip = typeof schema.trips.$inferSelect
type Merchant = typeof schema.merchants.$inferSelect

/**
 * Kova Travel's bookings. A trip is paid like anything else in Kova: one or more payment intents
 * (shares) to Kova Travel, which is itself a Kova shop. Once every share is paid, Kova books
 * with Duffel from its own balance, and the trip becomes a ticket or a hotel booking.
 *
 * Flights the airline will hold are held the moment the trip is created, so the fare is
 * guaranteed while a pay-for-me link or a split is out. Anything else must be paid before the
 * offer or the hotel's rate runs out; the trip's pay_by says when.
 */

const hashToken = (token: string) => createHash('sha256').update(`kova-trip:${token}`).digest('hex')

// --- Kova Travel, the shop -----------------------------------------------------------------

let travelShop: Merchant | null = null

/** Kova Travel's own merchant record, created the first time it's needed. */
export async function kovaTravel(): Promise<Merchant> {
  if (travelShop) return travelShop
  const existing = await db.query.merchants.findFirst({
    where: eq(schema.merchants.slug, 'kova-travel'),
  })
  if (existing) {
    travelShop = existing
    return travelShop
  }
  const address =
    config.KOVA_TRAVEL_SETTLEMENT_ADDRESS ??
    (config.KOVA_NETWORK === 'testnet' ? feePayerAddress : undefined)
  if (!address || !isAddress(address))
    throw new KovaError(
      'internal',
      'Kova Travel has no settlement address. Set KOVA_TRAVEL_SETTLEMENT_ADDRESS.',
    )
  const [created] = await db
    .insert(schema.merchants)
    .values({
      id: uuidv7(),
      name: 'Kova Travel',
      slug: 'kova-travel',
      settlementAddress: getAddress(address),
      network: config.KOVA_NETWORK,
      country: 'US',
      category: 'travel',
      isTest: config.KOVA_NETWORK !== 'mainnet',
    })
    .onConflictDoNothing()
    .returning()
  travelShop =
    created ??
    (await db.query.merchants.findFirst({ where: eq(schema.merchants.slug, 'kova-travel') }))!
  return travelShop
}

// --- creating a trip -----------------------------------------------------------------------

export interface Traveller {
  given_name: string
  family_name: string
  born_on?: string
  gender?: 'm' | 'f'
  title?: 'mr' | 'ms' | 'mrs' | 'miss' | 'dr'
  email?: string
  phone_number?: string
  /** Flights: the passenger id from the offer this traveller fills. */
  passenger_id?: string
}

export interface CreatedTrip {
  trip: Trip
  token: string
  shares: Awaited<ReturnType<typeof createShares>>
}

/** Splits a total into shares, the first taking the odd cents. */
function split(total: bigint, count: number): bigint[] {
  const each = total / BigInt(count)
  const shares = Array.from({ length: count }, () => each)
  shares[0] = (shares[0] ?? 0n) + (total - each * BigInt(count))
  return shares
}

async function createShares(trip: Trip, payers: string[], reference: string) {
  const shop = await kovaTravel()
  const amounts = split(trip.amount, payers.length)
  const seconds = Math.max(300, Math.floor((trip.payBy.getTime() - Date.now()) / 1000))
  const out = []
  for (const [i, label] of payers.entries()) {
    const intent = await createIntent({
      merchant: shop,
      amount: formatAmount(amounts[i] ?? 0n),
      currency: settlementCurrency,
      reference: payers.length > 1 ? `${reference} (${label}'s share)` : reference,
      metadata: { trip: encodeId('trip', trip.id), share: label },
      expiresInSeconds: seconds,
    })
    await db
      .insert(schema.tripShares)
      .values({ id: uuidv7(), tripId: trip.id, intentId: intent.id, label })
    out.push({ label, intent })
  }
  return out
}

function requireDuffel() {
  if (!duffel)
    throw new KovaError(
      'invalid_request',
      'Kova Travel is not set up on this server yet (it needs a Duffel key).',
    )
  return duffel
}

const nameOf = (t: Traveller) => `${t.given_name.trim()} ${t.family_name.trim()}`.trim()
const dayMonth = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })

export async function createFlightTrip(input: {
  offerId: string
  travellers: Traveller[]
  /** Seat and bag service ids, with quantities. */
  services: { id: string; quantity: number }[]
  /** Who pays: ['You'], ['Mum'], or several names for a split. */
  payers: string[]
  bookedBy: string
  /** Seats and bags in words, for the ticket ("Seat 14A", "1 checked bag"). */
  extras: string[]
}): Promise<CreatedTrip> {
  const client = requireDuffel()
  const { data: offer } = await client.offers.get(input.offerId, {
    return_available_services: true,
  })
  const view = serializeOffer(offer)
  if (!view)
    throw new KovaError('invalid_request', `Kova can't price fares in ${offer.total_currency} yet.`)
  if (new Date(offer.expires_at).getTime() < Date.now())
    throw new KovaError('conflict', 'This fare has expired. Search again for the latest price.')
  if (input.travellers.length !== offer.passengers.length)
    throw new KovaError(
      'invalid_request',
      `This fare is for ${offer.passengers.length} ${offer.passengers.length === 1 ? 'traveller' : 'travellers'}.`,
    )

  // The total the airline will charge: the fare plus every seat and bag chosen.
  const byId = new Map<string, { total_amount: string; total_currency: string }>()
  for (const s of offer.available_services) byId.set(s.id, s)
  if (input.services.some((s) => !byId.has(s.id))) {
    // Seats aren't in available_services; they come from the seat map. Price them from there.
    const { data: maps } = await client.seatMaps.get({ offer_id: offer.id })
    for (const map of maps)
      for (const cabin of map.cabins)
        for (const row of cabin.rows)
          for (const section of row.sections)
            for (const el of section.elements)
              if (el.type === 'seat') for (const s of el.available_services) byId.set(s.id, s)
  }
  let fare = Number(offer.total_amount)
  for (const s of input.services) {
    const service = byId.get(s.id)
    if (!service)
      throw new KovaError('invalid_request', 'One of the seats or bags is no longer available.')
    if (service.total_currency !== offer.total_currency)
      throw new KovaError('invalid_request', 'Mixed currencies on one fare are not supported.')
    fare += Number(service.total_amount) * s.quantity
  }
  const fareText = fare.toFixed(2)
  const price = money(fareText, offer.total_currency)
  if (!price)
    throw new KovaError('invalid_request', `Kova can't price fares in ${offer.total_currency} yet.`)

  const travellers = input.travellers.map((t, i) => ({
    ...t,
    supplier_id: t.passenger_id ?? offer.passengers[i]?.id,
  }))

  // Hold the fare now if the airline allows it (and nothing extra was added), so it can be paid later.
  let supplierOrderId: string | null = null
  let payBy = new Date(offer.expires_at)
  if (view.holdable && input.services.length === 0) {
    try {
      const { data: order } = await client.orders.create({
        type: 'pay_later',
        selected_offers: [offer.id],
        passengers: travellers.map(toDuffelPassenger),
        metadata: { kova: 'hold' },
      })
      supplierOrderId = order.id
      const until =
        order.payment_status.price_guarantee_expires_at ?? order.payment_status.payment_required_by
      if (until) payBy = new Date(until)
    } catch (error) {
      console.warn(
        '[travel] hold failed, the fare must be paid before it expires',
        error instanceof Error ? error.message : error,
      )
    }
  }

  const first = view.slices[0]
  const last = view.slices.at(-1)
  const title = first ? `${first.from.city} to ${first.to.city}` : 'Your flight'
  const dates =
    view.slices.length > 1 && first && last?.departs
      ? `${dayMonth(first.departs ?? '')}, back ${dayMonth(last.departs)}`
      : first?.departs
        ? dayMonth(first.departs)
        : ''
  const people = `${input.travellers.length} ${input.travellers.length === 1 ? 'traveller' : 'travellers'}`

  const token = randomBytes(24).toString('base64url')
  const [trip] = await db
    .insert(schema.trips)
    .values({
      id: uuidv7(),
      tokenHash: hashToken(token),
      kind: 'flight',
      merchantId: (await kovaTravel()).id,
      summary: {
        title,
        subtitle: [dates, people].filter(Boolean).join(', '),
        provider: { name: view.owner.name, image: view.owner.logo },
        legs: view.slices.map((s) => ({
          from: `${s.from.city} (${s.from.iata})`,
          to: `${s.to.city} (${s.to.iata})`,
          departs: s.departs ?? '',
          arrives: s.arrives ?? '',
          carrier: s.segments[0]?.carrier.name ?? null,
          flight: s.segments.map((g) => g.flight).join(', '),
          stops: s.stops,
          duration: s.minutes ? `${Math.floor(s.minutes / 60)}h ${s.minutes % 60}m` : null,
        })),
        extras: input.extras,
        bookedBy: input.bookedBy,
      },
      fareAmount: fareText,
      fareCurrency: offer.total_currency,
      amount: parseAmount(price.usd),
      offerId: offer.id,
      supplierOrderId,
      travellers,
      services: input.services,
      payBy,
    })
    .returning()
  if (!trip) throw new KovaError('internal', 'Could not save the trip')
  const shares = await createShares(trip, input.payers, `${title}, ${view.owner.name}`)
  return { trip, token, shares }
}

export async function createStayTrip(input: {
  rateId: string
  guests: { given_name: string; family_name: string }[]
  contact: { email: string; phone_number: string }
  payers: string[]
  bookedBy: string
}): Promise<CreatedTrip> {
  const client = requireDuffel()
  const { data: quote } = await client.stays.quotes.create(input.rateId)
  const price = money(quote.total_amount, quote.total_currency)
  if (!price)
    throw new KovaError('invalid_request', `Kova can't price rooms in ${quote.total_currency} yet.`)
  const room = quote.accommodation.rooms[0]
  const rate = room?.rates.find((r) => r.id === input.rateId) ?? room?.rates[0]
  // A quote holds the rate for a short while; half an hour at most, or the rate's own expiry.
  const payBy = new Date(
    Math.min(
      Date.now() + 30 * 60_000,
      rate?.expires_at ? new Date(rate.expires_at).getTime() : Infinity,
    ),
  )
  const nights = Math.round(
    (new Date(quote.check_out_date).getTime() - new Date(quote.check_in_date).getTime()) /
      86_400_000,
  )

  const token = randomBytes(24).toString('base64url')
  const [trip] = await db
    .insert(schema.trips)
    .values({
      id: uuidv7(),
      tokenHash: hashToken(token),
      kind: 'stay',
      merchantId: (await kovaTravel()).id,
      summary: {
        title: quote.accommodation.name,
        subtitle: `${dayMonth(quote.check_in_date)} to ${dayMonth(quote.check_out_date)}, ${nights} ${nights === 1 ? 'night' : 'nights'}, ${quote.guests.length} ${quote.guests.length === 1 ? 'guest' : 'guests'}`,
        provider: {
          name: quote.accommodation.name,
          image: quote.accommodation.photos?.[0]?.url ?? null,
        },
        legs: [
          {
            from: quote.accommodation.location.address.city_name,
            to: quote.accommodation.location.address.line_one,
            departs: quote.check_in_date,
            arrives: quote.check_out_date,
            carrier: null,
            flight: null,
            stops: 0,
            duration: `${nights} ${nights === 1 ? 'night' : 'nights'}`,
          },
        ],
        room: rate
          ? {
              name: room?.name ?? 'Room',
              board: rate.board_type.replace(/_/g, ' '),
              cancellation:
                rate.cancellation_timeline[0] &&
                Number(rate.cancellation_timeline[0].refund_amount) > 0
                  ? 'Free cancellation'
                  : 'Non-refundable',
            }
          : undefined,
        extras: [],
        bookedBy: input.bookedBy,
      },
      fareAmount: quote.total_amount,
      fareCurrency: quote.total_currency,
      amount: parseAmount(price.usd),
      offerId: input.rateId,
      quoteId: quote.id,
      travellers: input.guests,
      contact: input.contact,
      payBy,
    })
    .returning()
  if (!trip) throw new KovaError('internal', 'Could not save the trip')
  const shares = await createShares(trip, input.payers, quote.accommodation.name)
  return { trip, token, shares }
}

function toDuffelPassenger(t: Traveller & { supplier_id?: string }) {
  if (!t.born_on || !t.gender || !t.title || !t.email || !t.phone_number || !t.supplier_id)
    throw new KovaError(
      'invalid_request',
      `${nameOf(t)} needs a date of birth, gender, title, email and phone number to fly.`,
    )
  return {
    id: t.supplier_id,
    title: t.title,
    given_name: t.given_name.trim(),
    family_name: t.family_name.trim(),
    born_on: t.born_on,
    gender: t.gender,
    email: t.email,
    phone_number: t.phone_number,
  }
}

// --- paying and booking --------------------------------------------------------------------

/** The trip a payment belongs to, if it's a Kova Travel share. */
export async function tripForIntent(intentId: string) {
  const share = await db.query.tripShares.findFirst({
    where: eq(schema.tripShares.intentId, intentId),
  })
  if (!share) return null
  const trip = await db.query.trips.findFirst({ where: eq(schema.trips.id, share.tripId) })
  return trip ? { trip, share } : null
}

/**
 * Called when any payment settles. If it was the last unpaid share of a trip, book the trip.
 * Only one caller can move a trip from awaiting_payment to booking, so a booking is never
 * attempted twice.
 */
export async function onIntentPaid(intentId: string) {
  const found = await tripForIntent(intentId)
  if (!found) return
  const shares = await db.query.tripShares.findMany({
    where: eq(schema.tripShares.tripId, found.trip.id),
  })
  const intents = await db.query.paymentIntents.findMany({
    where: inArray(
      schema.paymentIntents.id,
      shares.map((s) => s.intentId),
    ),
  })
  if (intents.some((i) => i.status !== 'paid')) return

  const [claimed] = await db
    .update(schema.trips)
    .set({ status: 'booking', updatedAt: new Date() })
    .where(and(eq(schema.trips.id, found.trip.id), eq(schema.trips.status, 'awaiting_payment')))
    .returning()
  if (!claimed) return
  await book(claimed).catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[travel] booking failed', encodeId('trip', claimed.id), message)
    await db
      .update(schema.trips)
      .set({ status: 'failed', failure: bookingFailure(message), updatedAt: new Date() })
      .where(eq(schema.trips.id, claimed.id))
    // Nothing was booked: everyone who paid gets their money back.
    await refundTrip(claimed.id, 'booking_failed')
  })
}

function bookingFailure(message: string) {
  if (/price|changed/i.test(message))
    return 'The airline changed the price before Kova could book it.'
  if (/unavailable|sold|expired|no longer/i.test(message))
    return 'It sold out before Kova could book it.'
  return 'The booking didn’t go through.'
}

async function book(trip: Trip) {
  const client = requireDuffel()
  let supplierOrderId = trip.supplierOrderId
  let reference: string | null = null

  if (trip.kind === 'flight' && supplierOrderId) {
    // A held fare: pay the hold from Kova's Duffel balance.
    const { data: order } = await client.orders.get(supplierOrderId)
    await client.payments.create({
      order_id: order.id,
      payment: { type: 'balance', amount: order.total_amount, currency: order.total_currency },
    })
    reference = (await client.orders.get(order.id)).data.booking_reference
  } else if (trip.kind === 'flight') {
    const { data: order } = await client.orders.create({
      type: 'instant',
      selected_offers: [trip.offerId],
      passengers: trip.travellers.map(toDuffelPassenger),
      services: trip.services ?? [],
      payments: [{ type: 'balance', amount: trip.fareAmount, currency: trip.fareCurrency }],
      metadata: { kova_trip: encodeId('trip', trip.id) },
    })
    supplierOrderId = order.id
    reference = order.booking_reference
  } else {
    if (!trip.quoteId || !trip.contact) throw new Error('The stay has no quote to book')
    const { data: booking } = await client.stays.bookings.create({
      quote_id: trip.quoteId,
      guests: trip.travellers.map((g) => ({
        given_name: g.given_name,
        family_name: g.family_name,
      })),
      email: trip.contact.email,
      phone_number: trip.contact.phone_number,
      metadata: { kova_trip: encodeId('trip', trip.id) },
    })
    supplierOrderId = booking.id
    reference = booking.reference ?? booking.id
  }

  // Booked: keep only names. The airline and the hotel have everything else.
  await db
    .update(schema.trips)
    .set({
      status: 'booked',
      supplierOrderId,
      bookingReference: reference,
      travellers: trip.travellers.map((t) => ({
        given_name: t.given_name,
        family_name: t.family_name,
      })),
      contact: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.trips.id, trip.id))
}

/** Trips nobody finished paying for in time. Their unpaid shares stop being payable. */
export async function expireTrips(): Promise<number> {
  const stale = await db
    .update(schema.trips)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(and(eq(schema.trips.status, 'awaiting_payment'), lt(schema.trips.payBy, new Date())))
    .returning({ id: schema.trips.id })
  if (stale.length === 0) return 0
  const shares = await db.query.tripShares.findMany({
    where: inArray(
      schema.tripShares.tripId,
      stale.map((t) => t.id),
    ),
  })
  if (shares.length)
    await db
      .update(schema.paymentIntents)
      .set({ status: 'canceled', updatedAt: new Date() })
      .where(
        and(
          inArray(
            schema.paymentIntents.id,
            shares.map((s) => s.intentId),
          ),
          eq(schema.paymentIntents.status, 'requires_payment'),
        ),
      )
  // A split that only some friends paid: they get their shares back.
  for (const trip of stale)
    await refundTrip(trip.id, 'trip_expired').catch((error) =>
      console.error('[refund] trip', error),
    )
  return stale.length
}

// --- reading -------------------------------------------------------------------------------

/** A trip for the phone that booked it. Needs the trip's token. */
export async function loadTrip(id: string, token: string | undefined) {
  const uuid = decodeId('trip', id)
  const trip = uuid
    ? await db.query.trips.findFirst({ where: eq(schema.trips.id, uuid) })
    : undefined
  if (!trip || !token || hashToken(token) !== trip.tokenHash) throw notFound('trip', id)
  return trip
}

export async function serializeTrip(trip: Trip) {
  const shares = await db.query.tripShares.findMany({
    where: eq(schema.tripShares.tripId, trip.id),
  })
  const intents = shares.length
    ? await db.query.paymentIntents.findMany({
        where: inArray(
          schema.paymentIntents.id,
          shares.map((s) => s.intentId),
        ),
      })
    : []
  const byId = new Map(intents.map((i) => [i.id, i]))
  return {
    object: 'trip',
    id: encodeId('trip', trip.id),
    kind: trip.kind,
    status: trip.status,
    test_mode: travelTestMode,
    summary: trip.summary,
    amount: formatAmount(trip.amount),
    fare: { amount: trip.fareAmount, currency: trip.fareCurrency },
    pay_by: trip.payBy.toISOString(),
    held:
      trip.kind === 'flight' && Boolean(trip.supplierOrderId) && trip.status === 'awaiting_payment',
    booking_reference: trip.bookingReference,
    travellers: trip.travellers.map((t) => nameOf(t)),
    failure: trip.failure,
    shares: shares.map((s) => {
      const intent = byId.get(s.intentId)
      return {
        label: s.label,
        amount: intent ? formatAmount(intent.amount) : '0.00',
        status: intent?.status ?? 'requires_payment',
        checkout: intent ? encodeId('paymentIntent', intent.id) : null,
      }
    }),
    created_at: trip.createdAt.toISOString(),
  }
}

/** What someone paying a share sees on the pay screen: the trip, not the traveller's details. */
export async function tripForCheckout(intentId: string) {
  const found = await tripForIntent(intentId)
  if (!found) return null
  const { trip, share } = found
  const shares = await db.query.tripShares.findMany({
    where: eq(schema.tripShares.tripId, trip.id),
  })
  return {
    kind: trip.kind,
    title: trip.summary.title,
    subtitle: trip.summary.subtitle,
    provider: trip.summary.provider,
    booked_by: trip.summary.bookedBy,
    share: share.label,
    shares: shares.length,
    pay_by: trip.payBy.toISOString(),
  }
}
