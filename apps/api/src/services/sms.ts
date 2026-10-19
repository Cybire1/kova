import { normalizePhone } from '@kova/monad'
import { z } from 'zod'
import { config } from '../config.js'
import { KovaError } from '../errors.js'

/**
 * Text messages through Africa's Talking: USSD receipts and phone codes. With the username
 * "sandbox" they arrive in Africa's Talking's simulator. Missing credentials fail closed;
 * verification codes and phone numbers must never be written to application logs.
 */

export const smsReady = () =>
  Boolean(
    config.AT_USERNAME &&
      config.AT_API_KEY &&
      (config.KOVA_NETWORK === 'testnet' || config.AT_USERNAME !== 'sandbox'),
  )

const smsResponse = z.object({
  SMSMessageData: z.object({
    Recipients: z
      .array(
        z.object({
          number: z.string(),
          statusCode: z.coerce.number().int(),
          messageId: z.string().min(1),
        }),
      )
      .length(1),
  }),
})

const notAccepted = () =>
  new KovaError(
    'internal',
    'The message provider hasn’t accepted the message. Please try again shortly.',
  )

export async function sendSms(to: string, message: string): Promise<void> {
  if (!smsReady()) throw new KovaError('conflict', 'Phone verification isn’t available right now.')
  const recipient = normalizePhone(to)
  if (!recipient)
    throw new KovaError('invalid_request', 'Enter a phone number with its country code.')
  const host =
    config.AT_USERNAME === 'sandbox' ? 'api.sandbox.africastalking.com' : 'api.africastalking.com'
  const body = new URLSearchParams({ username: config.AT_USERNAME!, to: recipient, message })
  if (config.AT_SENDER_ID) body.set('from', config.AT_SENDER_ID)
  const response = await fetch(`https://${host}/version1/messaging`, {
    method: 'POST',
    headers: {
      apiKey: config.AT_API_KEY!,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {
    throw notAccepted()
  })
  if (!response.ok) throw notAccepted()
  const parsed = smsResponse.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw notAccepted()
  const result = parsed.data.SMSMessageData.Recipients[0]!
  // HTTP success alone can contain a rejected SMS. These are provider acceptance codes,
  // not a delivery guarantee: 100 processing, 101 sent, 102 queued.
  if (normalizePhone(result.number) !== recipient || ![100, 101, 102].includes(result.statusCode))
    throw notAccepted()
}

/** Sends without waiting or failing: a receipt that doesn't arrive must never undo a payment. */
export function sendSmsLater(to: string, message: string): void {
  sendSms(to, message).catch((error) =>
    console.error('[sms] not sent', error instanceof Error ? error.message : error),
  )
}
