import { describeOffer, type OfferView } from './duffel.js'
import { askJev } from './jev.js'

/**
 * "Match offers to the ask": from what the traveller typed ("non-stop, arrive before 6pm",
 * "breakfast, near the beach"), Jev picks the flight or hotel that fits best. Each option is
 * described in words first, with times and prices already ranked, since Jev can't compare
 * numbers itself. A weak pick is dropped rather than shown.
 */

const MIN_CONFIDENCE = 0.35

export async function bestOffer(
  wish: string,
  offers: OfferView[],
): Promise<{ id: string; confidence: number } | null> {
  if (!wish.trim() || offers.length < 2) return null
  const candidates = offers.slice(0, 60)
  const byPrice = [...candidates]
    .sort((a, b) => Number(a.price.usd) - Number(b.price.usd))
    .map((o) => o.id)
  const bySpeed = [...candidates].sort((a, b) => total(a) - total(b)).map((o) => o.id)
  const answers = await askJev(
    { traveller_asked_for: wish },
    {
      best: {
        type: 'choice',
        instructions:
          'Which flight best fits what the traveller asked for in `traveller_asked_for`?',
        criteria: Object.fromEntries(
          candidates.map((o) => [
            o.id,
            describeOffer(o, { cheapest: byPrice.indexOf(o.id), fastest: bySpeed.indexOf(o.id) }),
          ]),
        ),
      },
    },
  )
  const answer = answers?.best
  if (!answer?.choice || (answer.confidence ?? 0) < MIN_CONFIDENCE) return null
  return { id: answer.choice, confidence: answer.confidence ?? 0 }
}

function total(o: OfferView) {
  return o.slices.reduce((sum, s) => sum + (s.minutes ?? 9999), 0)
}

export interface StayForMatching {
  id: string
  name: string
  stars: number | null
  review_score: number | null
  amenities: string[]
  usd: number | null
}

export async function bestStay(
  wish: string,
  stays: StayForMatching[],
): Promise<{ id: string; confidence: number } | null> {
  if (!wish.trim() || stays.length < 2) return null
  const candidates = stays.slice(0, 60)
  const byPrice = [...candidates]
    .sort((a, b) => (a.usd ?? Infinity) - (b.usd ?? Infinity))
    .map((s) => s.id)
  const describe = (s: StayForMatching) => {
    const rank = byPrice.indexOf(s.id)
    const price =
      rank === 0 ? 'the cheapest' : rank < 3 ? 'one of the cheapest' : 'not among the cheapest'
    const reviews =
      s.review_score === null
        ? 'no reviews yet'
        : s.review_score >= 8.5
          ? 'excellent reviews'
          : s.review_score >= 7
            ? 'good reviews'
            : 'mixed reviews'
    return `${s.name}. ${s.stars ? `${s.stars}-star` : 'Unrated'}, ${reviews}, ${price}. Has: ${s.amenities.join(', ') || 'no amenities listed'}.`
  }
  const answers = await askJev(
    { traveller_asked_for: wish },
    {
      best: {
        type: 'choice',
        instructions:
          'Which place to stay best fits what the traveller asked for in `traveller_asked_for`?',
        criteria: Object.fromEntries(candidates.map((s) => [s.id, describe(s)])),
      },
    },
  )
  const answer = answers?.best
  if (!answer?.choice || (answer.confidence ?? 0) < MIN_CONFIDENCE) return null
  return { id: answer.choice, confidence: answer.confidence ?? 0 }
}
