import { KovaError } from '../errors.js'
import { ai, aiModel, aiRequestOptions } from './ai.js'

/**
 * "Trip in a sentence": "Lagos to London next Friday, back Sunday, 2 of us" becomes a search.
 * The model only fills in the form; Kova then checks every place against Duffel and the app
 * shows what it understood before anything is searched.
 */
export interface UnderstoodTrip {
  kind: 'flight' | 'stay'
  /** Places as the traveller said them; the route resolves them to airports and cities. */
  from: string | null
  to: string | null
  depart: string | null
  return: string | null
  adults: number
  children: number
  infants: number
  cabin: 'economy' | 'premium_economy' | 'business' | 'first'
  /** Stays */
  city: string | null
  check_in: string | null
  check_out: string | null
  rooms: number
  /** Anything else they care about, kept in their words ("non-stop", "near the beach"). */
  wishes: string | null
}

export const understandReady = () => ai !== null

const weekday = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })

export async function understandTrip(text: string, today: string): Promise<UnderstoodTrip> {
  if (!ai) throw new KovaError('invalid_request', 'Typing a trip is not set up on this server yet.')
  const response = await ai.messages.create({
    model: aiModel,
    max_tokens: 800,
    ...aiRequestOptions,
    tools: [
      {
        name: 'record_trip',
        description: 'Record the trip the traveller described.',
        input_schema: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: ['flight', 'stay'],
              description: 'flight for flying somewhere; stay for a hotel or somewhere to sleep.',
            },
            from: {
              type: 'string',
              description:
                'Flights: where they fly from, a city or airport as written (e.g. "Lagos"). Empty if not said.',
            },
            to: { type: 'string', description: 'Flights: where they fly to. Empty if not said.' },
            depart: {
              type: 'string',
              description: 'Flights: departure date as YYYY-MM-DD. Empty if not said.',
            },
            return: {
              type: 'string',
              description: 'Flights: return date as YYYY-MM-DD for a return trip, else empty.',
            },
            adults: {
              type: 'integer',
              description: 'Adults travelling or staying, 1 if not said.',
            },
            children: { type: 'integer', description: 'Children aged 2 to 11, 0 if not said.' },
            infants: { type: 'integer', description: 'Babies under 2, 0 if not said.' },
            cabin: {
              type: 'string',
              enum: ['economy', 'premium_economy', 'business', 'first'],
              description: 'economy unless they ask otherwise.',
            },
            city: {
              type: 'string',
              description: 'Stays: the city or area to stay in. Empty if not said.',
            },
            check_in: { type: 'string', description: 'Stays: YYYY-MM-DD. Empty if not said.' },
            check_out: { type: 'string', description: 'Stays: YYYY-MM-DD. Empty if not said.' },
            rooms: { type: 'integer', description: 'Stays: rooms, 1 if not said.' },
            wishes: {
              type: 'string',
              description:
                'Any other preference in their own words (non-stop, arrive before 6pm, breakfast, near the beach). Empty if none.',
            },
          },
          required: ['kind'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'record_trip' },
    messages: [
      {
        role: 'user',
        content: `Today is ${weekday(today)} ${today}. Work out relative dates ("this Friday", "next Friday", "for 3 nights") from today: "this Friday" or plain "Friday" is the coming one, and "next Friday" is the Friday of next week. The traveller wrote:\n\n${text.slice(0, 500)}`,
      },
    ],
  })
  const call = response.content.find((block) => block.type === 'tool_use')
  if (!call || call.type !== 'tool_use')
    throw new KovaError('invalid_request', 'Couldn’t read that trip. Try saying where and when.')
  const t = call.input as Partial<Record<keyof UnderstoodTrip, unknown>>
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null)
  const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
  const count = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v)
      ? Math.max(min, Math.min(max, Math.round(v)))
      : fallback
  return {
    kind: t.kind === 'stay' ? 'stay' : 'flight',
    from: str(t.from),
    to: str(t.to),
    depart: date(t.depart),
    return: date(t.return),
    adults: count(t.adults, 1, 9, 1),
    children: count(t.children, 0, 8, 0),
    infants: count(t.infants, 0, 4, 0),
    cabin:
      t.cabin === 'premium_economy' || t.cabin === 'business' || t.cabin === 'first'
        ? t.cabin
        : 'economy',
    city: str(t.city),
    check_in: date(t.check_in),
    check_out: date(t.check_out),
    rooms: count(t.rooms, 1, 8, 1),
    wishes: str(t.wishes),
  }
}
