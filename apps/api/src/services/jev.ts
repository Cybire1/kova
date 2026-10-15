import { config } from '../config.js'

/**
 * Jev, TypeSafe's System One model: text in, a typed decision out (yes/no, one of a set of
 * options, or a score), in about a tenth of a second. Kova asks it where a quick judgment helps
 * and a wrong one costs little. Without a key, or if it is slow, callers carry on without it.
 *
 * It can't do arithmetic, count, or compare dates and times, so callers describe those in
 * words first ("arrives in the evening", "non-stop") rather than asking Jev to work them out.
 */
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone'

/** A question about the state, keyed by an id of your choosing in the request. */
export type JevQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }

export interface JevAnswer {
  /** noul: the probability of yes. */
  probability?: number
  /** choice: the option picked, how sure, and the full distribution. */
  choice?: string
  confidence?: number
  distribution?: Record<string, number>
}

export const jevReady = () => Boolean(config.TYPESAFE_API_KEY)

/**
 * Asks every question about the same state at once. Questions are answered independently, so
 * one answer never colours another. Null when Jev isn't set up or doesn't answer in time.
 */
export async function askJev(
  state: unknown,
  questions: Record<string, JevQuestion>,
  timeoutMs = 4000,
): Promise<Record<string, JevAnswer> | null> {
  if (!config.TYPESAFE_API_KEY || Object.keys(questions).length === 0) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.TYPESAFE_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: config.JEV_MODEL ?? 'jev-latest', state, questions }),
      signal: controller.signal,
    })
    const body = (await response.json().catch(() => null)) as {
      answers?: Record<string, RawAnswer>
    } | null
    if (!response.ok || !body?.answers) {
      console.warn('[jev] refused', response.status, JSON.stringify(body)?.slice(0, 300))
      return null
    }
    const out: Record<string, JevAnswer> = {}
    for (const [id, a] of Object.entries(body.answers))
      out[id] =
        a.type === 'noul'
          ? { probability: a.noul }
          : { choice: a.choice, confidence: a.confidence, distribution: a.probabilities }
    return out
  } catch (error) {
    console.warn('[jev] unavailable', error instanceof Error ? error.message : error)
    return null
  } finally {
    clearTimeout(timer)
  }
}

type RawAnswer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }
