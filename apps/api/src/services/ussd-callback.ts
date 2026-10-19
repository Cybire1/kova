import { createHash, timingSafeEqual } from 'node:crypto'
import { normalizePhone } from '@kova/monad'
import { z } from 'zod'

/** Hash both sides to a fixed size before comparison; never log the callback secret. */
export function callbackSecretMatches(given: string, expected: string | undefined): boolean {
  if (!expected) return false
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(given), digest(expected))
}

export const callbackForm = z.object({
  sessionId: z.string().min(1).max(160),
  serviceCode: z.string().min(1).max(40),
  phoneNumber: z
    .string()
    .max(32)
    .transform((value) => normalizePhone(value))
    .pipe(z.string()),
  text: z
    .string()
    .max(256)
    .regex(/^[0-9*+.]*$/),
})

export function redactCallbackLog(message: string): string {
  return message.replace(/(\/v1\/ussd\/)[^?\s\u001b]+/g, '$1[redacted]')
}
