import { formatAmount } from '@kova/monad'
import { Hono } from 'hono'
import { z } from 'zod'
import { KovaError } from '../errors.js'
import { clientIp } from '../limits.js'
import { encodeId } from '../ids.js'
import { encodeCheckoutLink } from '../services/links.js'
import {
  duffel,
  serializeBags,
  serializeOffer,
  serializePlace,
  serializeRooms,
  serializeSearchResult,
  serializeSeatMap,
  TEST_HOTELS,
  travelReady,
  travelTestMode,
} from '../services/duffel.js'
import { bestOffer, bestStay } from '../services/matching.js'
import { createFlightTrip, createStayTrip, loadTrip, serializeTrip } from '../services/travel.js'
import { understandReady, understandTrip } from '../services/trip-parse.js'

/**
 * Kova Travel, for Kova Pay: search flights and hotels, see one, book it. No account and no
 * key: a trip is opened with a token only the booking phone keeps, and paid like any Kova
 * charge. Searches cost Kova a supplier call each, so every route is rate-limited per address.
 */

const hits = new Map<string, number[]>()
function limit(key: string, max: number, windowMs: number) {
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
  if (recent.length >= max) throw new KovaError('rate_limited', 'Lots of searches from here. Try again in a few minutes.')
  hits.set(key, [...recent, now])
}
const ip = clientIp

function client() {
  if (!duffel) throw new KovaError('invalid_request', 'Kova Travel is not set up on this server yet (it needs a Duffel key).')
  return duffel
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-03')
const iata = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, 'Use a 3-letter airport or city code')
  .transform((v) => v.toUpperCase())

const flightSearch = z.object({
  from: iata,
  to: iata,
  depart: date,
  return: date.nullish(),
  adults: z.number().int().min(1).max(9).default(1),
  children: z.number().int().min(0).max(8).default(0),
  infants: z.number().int().min(0).max(4).default(0),
  cabin: z.enum(['economy', 'premium_economy', 'business', 'first']).default('economy'),
  /** What the traveller asked for, in their words, for Jev to match. */
  wishes: z.string().trim().max(200).nullish(),
})

const staySearch = z.object({
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  check_in: date,
  check_out: date,
  adults: z.number().int().min(1).max(9).default(1),
  children: z.number().int().min(0).max(8).default(0),
  rooms: z.number().int().min(1).max(8).default(1),
  wishes: z.string().trim().max(200).nullish(),
})

const traveller = z.object({
  given_name: z.string().trim().min(1).max(60),
  family_name: z.string().trim().min(1).max(60),
  born_on: date.optional(),
  gender: z.enum(['m', 'f']).optional(),
  title: z.enum(['mr', 'ms', 'mrs', 'miss', 'dr']).optional(),
  email: z.string().trim().email().max(120).optional(),
  phone_number: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/, 'Use an international number like +2348030000000')
    .optional(),
  passenger_id: z.string().optional(),
})

const payers = z.array(z.string().trim().min(1).max(40)).min(1).max(8).default(['You'])

const tripBody = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('flight'),
    offer_id: z.string().min(4),
    travellers: z.array(traveller).min(1).max(9),
    services: z.array(z.object({ id: z.string().min(4), quantity: z.number().int().min(1).max(9) })).max(40).default([]),
    extras: z.array(z.string().max(60)).max(40).default([]),
    payers,
    booked_by: z.string().trim().min(1).max(60),
  }),
  z.object({
    kind: z.literal('stay'),
    rate_id: z.string().min(4),
    guests: z.array(traveller.pick({ given_name: true, family_name: true })).min(1).max(9),
    email: z.string().trim().email().max(120),
    phone_number: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{6,14}$/, 'Use an international number like +2348030000000'),
    payers,
    booked_by: z.string().trim().min(1).max(60),
  }),
])

async function placesFor(query: string) {
  const { data } = await client().suggestions.list({ query })
  return data.map(serializePlace)
}

export const travelRoutes = new Hono()
  /** What the app can offer here: booking at all, typing a trip, and whether it's test mode. */
  .get('/travel', (c) => c.json({ object: 'travel', ready: travelReady(), test_mode: travelTestMode, understands: understandReady() }))

  /** Airports and cities as someone types. */
  .get('/travel/places', async (c) => {
    limit(`places:${ip(c)}`, 120, 60_000)
    const query = (c.req.query('q') ?? '').trim()
    if (query.length < 2) return c.json({ object: 'list', data: [] })
    return c.json({ object: 'list', data: (await placesFor(query)).slice(0, 8) })
  })

  /** "Trip in a sentence": what the traveller typed, as a search they can check before it runs. */
  .post('/travel/understand', async (c) => {
    limit(`understand:${ip(c)}`, 30, 600_000)
    const body = z.object({ text: z.string().trim().min(3).max(500), today: date.optional() }).safeParse(await c.req.json().catch(() => ({})))
    if (!body.success) throw new KovaError('invalid_request', 'Say where and when, like "Lisbon to London next Friday"')
    const trip = await understandTrip(body.data.text, body.data.today ?? new Date().toISOString().slice(0, 10))
    // Pin each place to a real airport or city.
    const [from, to, city] = await Promise.all([
      trip.from && duffel ? placesFor(trip.from).then((p) => p[0] ?? null) : null,
      trip.to && duffel ? placesFor(trip.to).then((p) => p[0] ?? null) : null,
      trip.city && duffel ? placesFor(trip.city).then((p) => p[0] ?? null) : null,
    ])
    return c.json({ object: 'understood_trip', ...trip, from_place: from, to_place: to, city_place: city })
  })

  .post('/travel/flights/search', async (c) => {
    limit(`flights:${ip(c)}`, 40, 600_000)
    const parsed = flightSearch.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) throw new KovaError('invalid_request', parsed.error.issues[0]?.message ?? 'Invalid search')
    const s = parsed.data
    if (s.infants > s.adults) throw new KovaError('invalid_request', 'Each baby needs an adult with them.')
    const passengers = [
      ...Array.from({ length: s.adults }, () => ({ type: 'adult' as const })),
      ...Array.from({ length: s.children }, () => ({ age: 8 })),
      // Children and babies go by age; under 2 travels on a lap.
      ...Array.from({ length: s.infants }, () => ({ age: 1 })),
    ]
    const slices = [
      { origin: s.from, destination: s.to, departure_date: s.depart, departure_time: null, arrival_time: null },
      ...(s.return ? [{ origin: s.to, destination: s.from, departure_date: s.return, departure_time: null, arrival_time: null }] : []),
    ]
    const { data } = await client().offerRequests.create({ slices, passengers, cabin_class: s.cabin, return_offers: true, supplier_timeout: 15_000 })
    const offers = (data.offers ?? [])
      .flatMap((o) => {
        const view = serializeOffer(o)
        return view ? [view] : []
      })
      .sort((a, b) => Number(a.price.usd) - Number(b.price.usd))
      .slice(0, 50)
    const best = s.wishes ? await bestOffer(s.wishes, offers) : null
    return c.json({ object: 'list', data: offers, best: best?.id ?? null, test_mode: travelTestMode })
  })

  /** One fare, with the bags the airline sells for it. */
  .get('/travel/flights/offers/:id', async (c) => {
    limit(`offer:${ip(c)}`, 120, 600_000)
    const { data } = await client().offers.get(c.req.param('id'), { return_available_services: true })
    const offer = serializeOffer(data)
    if (!offer) throw new KovaError('invalid_request', `Kova can't price fares in ${data.total_currency} yet.`)
    return c.json({ object: 'offer', ...offer, extra_bags: serializeBags(data) })
  })

  .get('/travel/flights/offers/:id/seats', async (c) => {
    limit(`seats:${ip(c)}`, 60, 600_000)
    const { data } = await client()
      .seatMaps.get({ offer_id: c.req.param('id') })
      .catch(() => ({ data: [] }))
    return c.json({ object: 'list', data: data.map(serializeSeatMap) })
  })

  .post('/travel/stays/search', async (c) => {
    limit(`stays:${ip(c)}`, 40, 600_000)
    const parsed = staySearch.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) throw new KovaError('invalid_request', parsed.error.issues[0]?.message ?? 'Invalid search')
    const s = parsed.data
    if (s.check_out <= s.check_in) throw new KovaError('invalid_request', 'Check out after you check in.')
    // Duffel's test hotels live at one test location; in test mode every search looks there.
    const at =
      travelTestMode || s.latitude == null || s.longitude == null
        ? TEST_HOTELS
        : { latitude: s.latitude, longitude: s.longitude, radius: 10 }
    const guests = [...Array.from({ length: s.adults }, () => ({ type: 'adult' as const })), ...Array.from({ length: s.children }, () => ({ type: 'child' as const, age: 8 }))]
    const { data } = await client().stays.search({
      check_in_date: s.check_in,
      check_out_date: s.check_out,
      rooms: s.rooms,
      guests,
      location: { radius: at.radius, geographic_coordinates: { latitude: at.latitude, longitude: at.longitude } },
    })
    const results = data.results.map(serializeSearchResult).slice(0, 40)
    const best = s.wishes
      ? await bestStay(
          s.wishes,
          results.map((r) => ({
            id: r.id,
            name: r.accommodation.name,
            stars: r.accommodation.stars,
            review_score: r.accommodation.review_score,
            amenities: r.accommodation.amenities,
            usd: r.from_price ? Number(r.from_price.usd) : null,
          })),
        )
      : null
    return c.json({ object: 'list', data: results, best: best?.id ?? null, test_mode: travelTestMode })
  })

  /** One hotel from a search, with every room and rate Kova can book. */
  .get('/travel/stays/results/:id', async (c) => {
    limit(`rates:${ip(c)}`, 60, 600_000)
    const { data } = await client().stays.searchResults.fetchAllRates(c.req.param('id'))
    return c.json({ object: 'stay', ...serializeSearchResult(data), rooms_available: serializeRooms(data) })
  })

  /**
   * Book: opens the trip and its payment (or one share per payer). The token in the answer is
   * the only way to see the trip again; the app keeps it.
   */
  .post('/travel/trips', async (c) => {
    limit(`trips:${ip(c)}`, 20, 600_000)
    const parsed = tripBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) throw new KovaError('invalid_request', parsed.error.issues[0]?.message ?? 'Invalid trip')
    const b = parsed.data
    const created =
      b.kind === 'flight'
        ? await createFlightTrip({ offerId: b.offer_id, travellers: b.travellers, services: b.services, payers: b.payers, bookedBy: b.booked_by, extras: b.extras })
        : await createStayTrip({ rateId: b.rate_id, guests: b.guests, contact: { email: b.email, phone_number: b.phone_number }, payers: b.payers, bookedBy: b.booked_by })
    return c.json(
      {
        ...(await serializeTrip(created.trip)),
        token: created.token,
        shares: created.shares.map((s) => {
          const id = encodeId('paymentIntent', s.intent.id)
          return { label: s.label, amount: formatAmount(s.intent.amount), status: s.intent.status, checkout: id, link: encodeCheckoutLink(id) }
        }),
      },
      201,
    )
  })

  .get('/travel/trips/:id', async (c) => {
    const trip = await loadTrip(c.req.param('id'), c.req.header('x-trip-token'))
    return c.json(await serializeTrip(trip))
  })
