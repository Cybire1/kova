import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'

/**
 * The model Kova asks to read things: menu photos, and trips typed as a sentence.
 *
 * Claude, or DeepSeek through its Anthropic-compatible endpoint. Both take the same request
 * (images, a forced tool call, the same reply shape), so callers don't care which it is.
 */
const provider =
  config.KOVA_MENU_PROVIDER ??
  (config.ANTHROPIC_API_KEY ? 'anthropic' : config.DEEPSEEK_API_KEY ? 'deepseek' : null)

export const ai =
  provider === 'anthropic' && config.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })
    : provider === 'deepseek' && config.DEEPSEEK_API_KEY
      ? new Anthropic({
          apiKey: config.DEEPSEEK_API_KEY,
          baseURL: 'https://api.deepseek.com/anthropic',
        })
      : null

export const aiModel =
  config.KOVA_MENU_MODEL ?? (provider === 'deepseek' ? 'deepseek-flash' : 'claude-sonnet-5')

/** DeepSeek thinks by default, and thinking can't be combined with a forced tool call. */
export const aiRequestOptions =
  provider === 'deepseek' ? { thinking: { type: 'disabled' as const } } : {}

/** Local currency per US dollar: Kova's published reference rates (DECISIONS D-012). */
export const PER_USD: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  NGN: 1375,
  KES: 129,
  MXN: 18.4,
}

/** An amount in a listed currency, in dollars, rounded up to the cent so Kova is never short. */
export function toUsd(amount: number, currency: string): string | null {
  const rate = PER_USD[currency]
  if (!rate) return null
  return (Math.ceil((amount / rate) * 100 - 1e-9) / 100).toFixed(2)
}
