import { Duffel } from '@duffel/api'
import type {
  Offer,
  OfferAvailableServiceBaggage,
  Places,
  SeatMap,
  StaysAccommodation,
  StaysRate,
  StaysSearchResult,
} from '@duffel/api/types'
import { config } from '../config.js'
import { toUsd } from './ai.js'

/**
 * Duffel: 300+ airlines and 2M+ hotels behind one API. Kova Travel searches and books through
 * it, and shapes what comes back into what the app shows. Duffel's raw payloads never leave the
 * API: the app gets plain, dollar-priced objects.
 */
export const duffel = config.DUFFEL_API_KEY ? new Duffel({ token: config.DUFFEL_API_KEY }) : null
export const travelReady = () => duffel !== null
/** Duffel test tokens start duffel_test_: sandbox airlines and hotels, nothing real is booked. */
export const travelTestMode = !config.DUFFEL_API_KEY?.startsWith('duffel_live_')

/** Duffel's test hotels all sit here; in test mode every hotel search looks here. */
export const TEST_HOTELS = { latitude: -24.38, longitude: -128.32, radius: 2 }

export interface Money {
  /** What Kova Travel charges, in dollars. */
  usd: string
  /** As the supplier priced it. */
  amount: string
  currency: string
}

export function money(amount: string, currency: string): Money | null {
  const usd = toUsd(Number(amount), currency)
  return usd ? { usd, amount, currency } : null
}

/** "PT7H30M" → minutes. */
export function minutes(duration: string | null | undefined): number | null {
  const m = duration ? /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(duration) : null
  if (!m) return null
  return Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
}

// --- places --------------------------------------------------------------------------------

export function serializePlace(p: Places) {
  return {
    type: p.type,
    iata: p.iata_code,
    name: p.name,
    city: p.type === 'airport' ? (p.city_name ?? p.city?.name ?? p.name) : p.name,
    country: p.iata_country_code,
    latitude: p.latitude ?? null,
    longitude: p.longitude ?? null,
    airports:
      p.type === 'city'
        ? (p.airports ?? []).map((a) => ({
            iata: a.iata_code,
            name: a.name,
            latitude: a.latitude,
            longitude: a.longitude,
          }))
        : [],
  }
}

// --- flights -------------------------------------------------------------------------------

/** A slice starts and ends at an airport or a whole city; either way, name the city. */
const cityOf = (place: { name: string; city_name?: string | null }) =>
  ('city_name' in place && place.city_name) || place.name

/** Checked and carry-on bags included in the fare, for the first passenger on the first segment. */
function bagsIncluded(offer: Pick<Offer, 'slices'>) {
  const bags = offer.slices[0]?.segments[0]?.passengers[0]?.baggages ?? []
  return {
    checked: bags.filter((b) => b.type === 'checked').reduce((n, b) => n + b.quantity, 0),
    carry_on: bags.filter((b) => b.type === 'carry_on').reduce((n, b) => n + b.quantity, 0),
  }
}

/** Offers from a search come without their services; a single offer comes with them. */
export function serializeOffer(offer: Omit<Offer, 'available_services'>) {
  const price = money(offer.total_amount, offer.total_currency)
  if (!price) return null
  const req = offer.payment_requirements
  return {
    id: offer.id,
    price,
    expires_at: offer.expires_at,
    /** The airline can hold this fare, so it can be paid later (by someone else, too). */
    holdable: !req.requires_instant_payment,
    hold_until: req.requires_instant_payment
      ? null
      : (req.price_guarantee_expires_at ?? req.payment_required_by),
    owner: {
      name: offer.owner.name,
      iata: offer.owner.iata_code,
      logo: offer.owner.logo_symbol_url ?? null,
    },
    cabin: offer.slices[0]?.segments[0]?.passengers[0]?.cabin_class_marketing_name ?? null,
    bags: bagsIncluded(offer),
    refundable: Boolean(offer.conditions.refund_before_departure?.allowed),
    changeable: Boolean(offer.conditions.change_before_departure?.allowed),
    passengers: offer.passengers.map((p) => ({
      id: p.id,
      type: p.type ?? 'adult',
      age: p.age ?? null,
    })),
    slices: offer.slices.map((s) => ({
      id: s.id,
      from: { iata: s.origin.iata_code, city: cityOf(s.origin), name: s.origin.name },
      to: { iata: s.destination.iata_code, city: cityOf(s.destination), name: s.destination.name },
      departs: s.segments[0]?.departing_at ?? null,
      arrives: s.segments.at(-1)?.arriving_at ?? null,
      minutes: minutes(s.duration),
      stops: Math.max(0, s.segments.length - 1),
      segments: s.segments.map((g) => ({
        id: g.id,
        from: { iata: g.origin.iata_code, city: g.origin.city_name ?? g.origin.name },
        to: { iata: g.destination.iata_code, city: g.destination.city_name ?? g.destination.name },
        departs: g.departing_at,
        arrives: g.arriving_at,
        minutes: minutes(g.duration),
        carrier: {
          name: g.marketing_carrier.name,
          iata: g.marketing_carrier.iata_code,
          logo: g.marketing_carrier.logo_symbol_url ?? null,
        },
        operated_by:
          g.operating_carrier.iata_code !== g.marketing_carrier.iata_code
            ? g.operating_carrier.name
            : null,
        flight: `${g.marketing_carrier.iata_code}${g.marketing_carrier_flight_number}`,
        aircraft: g.aircraft?.name ?? null,
      })),
    })),
  }
}

export type OfferView = NonNullable<ReturnType<typeof serializeOffer>>

/** Extra bags the airline sells for this offer, per passenger. */
export function serializeBags(offer: Offer) {
  return offer.available_services
    .filter((s): s is OfferAvailableServiceBaggage => s.type === 'baggage')
    .flatMap((s) => {
      const price = money(s.total_amount, s.total_currency)
      return price
        ? [
            {
              id: s.id,
              kind: s.metadata.type,
              weight_kg: s.metadata.maximum_weight_kg ?? null,
              max: s.maximum_quantity,
              passenger_ids: s.passenger_ids,
              segment_ids: s.segment_ids,
              price,
            },
          ]
        : []
    })
}

/** A seat map as rows of cells the app can draw directly. */
export function serializeSeatMap(map: SeatMap) {
  const cabin = map.cabins[0]
  return {
    id: map.id,
    segment_id: map.segment_id,
    aisles: cabin?.aisles ?? 1,
    wings: cabin?.wings ?? null,
    rows: (cabin?.rows ?? []).map((row) =>
      row.sections.map((section) =>
        section.elements.map((el) => {
          if (el.type !== 'seat') return { kind: el.type === 'exit_row' ? 'exit' : 'space' }
          const services = el.available_services.flatMap((s) => {
            const price = money(s.total_amount, s.total_currency)
            return price ? [{ id: s.id, passenger_id: s.passenger_id, price }] : []
          })
          return {
            kind: 'seat',
            designator: el.designator,
            name: el.name ?? null,
            available: services.length > 0,
            services,
          }
        }),
      ),
    ),
  }
}

/**
 * The flight described in plain words, for Jev to match against what the traveller asked for.
 * Jev is weak at comparing times and numbers, so they're turned into words here.
 */
export function describeOffer(o: OfferView, rank: { cheapest: number; fastest: number }) {
  const part = (iso: string | null) => {
    if (!iso) return 'unknown time'
    const h = Number(iso.slice(11, 13))
    return h < 6
      ? 'early morning'
      : h < 12
        ? 'morning'
        : h < 17
          ? 'afternoon'
          : h < 21
            ? 'evening'
            : 'late night'
  }
  const legs = o.slices.map(
    (s, i) =>
      `${i === 0 ? 'Outbound' : 'Return'}: ${s.stops === 0 ? 'non-stop' : `${s.stops} stop${s.stops > 1 ? 's' : ''}`}, leaves in the ${part(s.departs)}, arrives in the ${part(s.arrives)}`,
  )
  const price =
    rank.cheapest === 0
      ? 'the cheapest'
      : rank.cheapest < 3
        ? 'one of the cheapest'
        : 'not among the cheapest'
  const speed =
    rank.fastest === 0
      ? 'the fastest'
      : rank.fastest < 3
        ? 'one of the fastest'
        : 'slower than others'
  return `${o.owner.name}. ${legs.join('. ')}. It is ${price} and ${speed}. ${o.bags.checked ? 'Checked bag included' : 'No checked bag included'}. ${o.refundable ? 'Refundable' : 'Not refundable'}.`
}

// --- stays ---------------------------------------------------------------------------------

const boards: Record<StaysRate['board_type'], string> = {
  room_only: 'Room only',
  breakfast: 'Breakfast included',
  half_board: 'Breakfast and dinner',
  full_board: 'All meals',
  all_inclusive: 'All inclusive',
}

export function cancellationText(rate: Pick<StaysRate, 'cancellation_timeline'>) {
  const first = rate.cancellation_timeline[0]
  if (!first) return 'Non-refundable'
  const date = new Date(first.before).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  })
  return Number(first.refund_amount) > 0 ? `Free cancellation until ${date}` : 'Non-refundable'
}

export function serializeAccommodation(a: StaysAccommodation) {
  return {
    id: a.id,
    name: a.name,
    stars: a.rating,
    review_score: a.review_score,
    review_count: a.review_count,
    photos: (a.photos ?? []).map((p) => p.url).slice(0, 8),
    address: [a.location.address.line_one, a.location.address.city_name].filter(Boolean).join(', '),
    city: a.location.address.city_name,
    amenities: (a.amenities ?? []).map((m) => m.description || m.type).slice(0, 8),
    check_in_after: a.check_in_information?.check_in_after_time ?? null,
    check_out_before: a.check_in_information?.check_out_before_time ?? null,
    description: a.description ?? null,
  }
}

export function serializeRate(rate: StaysRate) {
  const price = money(rate.total_amount, rate.total_currency)
  if (!price) return null
  return {
    id: rate.id,
    price,
    board: boards[rate.board_type] ?? 'Room only',
    cancellation: cancellationText(rate),
    pay_at_hotel:
      rate.due_at_accommodation_amount && Number(rate.due_at_accommodation_amount) > 0
        ? `${rate.due_at_accommodation_amount} ${rate.due_at_accommodation_currency}`
        : null,
    expires_at: rate.expires_at,
    payable: rate.available_payment_methods.includes('balance') && rate.payment_type === 'pay_now',
  }
}

export function serializeSearchResult(r: StaysSearchResult) {
  const cheapest = r.cheapest_rate_total_amount
    ? money(r.cheapest_rate_total_amount, r.cheapest_rate_currency)
    : null
  return {
    id: r.id,
    check_in: r.check_in_date,
    check_out: r.check_out_date,
    rooms: r.rooms,
    guests: r.guests.length,
    from_price: cheapest,
    accommodation: serializeAccommodation(r.accommodation),
  }
}

export function serializeRooms(r: StaysSearchResult) {
  return r.accommodation.rooms.map((room) => ({
    name: room.name,
    photos: (room.photos ?? []).map((p) => p.url).slice(0, 4),
    beds: (room.beds ?? []).map((b) => `${b.count} ${b.type}`).join(', '),
    rates: room.rates.flatMap((rate) => {
      const view = serializeRate(rate)
      return view?.payable ? [view] : []
    }),
  }))
}
