import { createHmac } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { schema } from '@kova/db'
import { and, eq, inArray, lte, sql } from 'drizzle-orm'
import { isProduction } from '../config.js'
import { db } from '../db.js'
import { encodeId } from '../ids.js'

/**
 * Delivers events to shops' webhook endpoints (outbox pattern).
 *
 * Settlement writes an event in the same transaction as the payment, so an event exists if and
 * only if the payment does. This worker fans each event out to the endpoints subscribed to it
 * (idempotent: one delivery per endpoint and event), then posts due deliveries, signed, and
 * retries failures with backoff. A slow or broken endpoint never touches the payment path.
 */

const TICK_MS = 2_000
const BATCH = 20
const TIMEOUT_MS = 8_000
const MAX_ATTEMPTS = 8
/** Only fan out recent events, so the query stays cheap however long Kova runs. */
const FANOUT_WINDOW = "interval '3 days'"

/** 10s, 20s, 40s ... capped at an hour. */
const backoff = (attempts: number) => Math.min(10_000 * 2 ** (attempts - 1), 3_600_000)

/** `Kova-Signature: t=<unix>,v1=<hex hmac-sha256 of "t.body">`, the same scheme as Stripe's. */
export function sign(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  return `t=${timestamp},v1=${v1}`
}

function isPrivate(ip: string) {
  if (ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80'))
    return true
  const [a, b] = ip.split('.').map(Number)
  if (a === undefined || b === undefined) return false
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  )
}

/** In production, never let a webhook URL reach Kova's own network. */
async function safeTarget(url: string) {
  if (!isProduction) return true
  const host = new URL(url).hostname
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address)
  return addresses.length > 0 && !addresses.some(isPrivate)
}

async function fanOut() {
  await db.execute(sql`
    insert into webhook_deliveries (id, endpoint_id, event_id)
    select gen_random_uuid(), e.id, ev.id
    from events ev
    join webhook_endpoints e on e.merchant_id = ev.merchant_id and e.status = 'active'
    where ev.created_at > now() - ${sql.raw(FANOUT_WINDOW)}
      and ev.type <> 'test.ping'
      and ev.created_at >= e.created_at
      and (e.events ? '*' or e.events ? ev.type)
    on conflict (endpoint_id, event_id) do nothing
  `)
}

async function deliverDue() {
  // Claim a batch by pushing its next attempt out, so an overlapping tick cannot send twice.
  const claimed = await db
    .update(schema.webhookDeliveries)
    .set({ nextAttemptAt: new Date(Date.now() + 60_000) })
    .where(
      inArray(
        schema.webhookDeliveries.id,
        db
          .select({ id: schema.webhookDeliveries.id })
          .from(schema.webhookDeliveries)
          .where(
            and(
              eq(schema.webhookDeliveries.status, 'pending'),
              lte(schema.webhookDeliveries.nextAttemptAt, new Date()),
            ),
          )
          .limit(BATCH),
      ),
    )
    .returning()

  await Promise.all(claimed.map(deliver))
}

async function deliver(delivery: typeof schema.webhookDeliveries.$inferSelect) {
  const [endpoint, event] = await Promise.all([
    db.query.webhookEndpoints.findFirst({
      where: eq(schema.webhookEndpoints.id, delivery.endpointId),
    }),
    db.query.events.findFirst({ where: eq(schema.events.id, delivery.eventId) }),
  ])
  if (!endpoint || !event || endpoint.status !== 'active') {
    await db
      .update(schema.webhookDeliveries)
      .set({ status: 'failed', lastError: 'Endpoint removed' })
      .where(eq(schema.webhookDeliveries.id, delivery.id))
    return
  }

  const body = JSON.stringify({
    id: encodeId('event', event.id),
    object: 'event',
    type: event.type,
    created_at: event.createdAt.toISOString(),
    data: event.data,
  })
  const attempts = delivery.attempts + 1
  let responseStatus: number | null = null
  let error: string | null = null
  try {
    if (!(await safeTarget(endpoint.url))) throw new Error('URL points at a private network')
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Kova-Webhooks/1',
        'kova-signature': sign(endpoint.secret, body),
        'kova-event-id': encodeId('event', event.id),
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    responseStatus = response.status
    if (!response.ok) error = `HTTP ${response.status}`
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
  }

  const delivered = error === null
  await db
    .update(schema.webhookDeliveries)
    .set({
      attempts,
      responseStatus,
      lastError: error,
      status: delivered ? 'delivered' : attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
      deliveredAt: delivered ? new Date() : null,
      nextAttemptAt: new Date(Date.now() + backoff(attempts)),
    })
    .where(eq(schema.webhookDeliveries.id, delivery.id))
}

export function startWebhookWorker() {
  let running = false
  const timer = setInterval(async () => {
    if (running) return
    running = true
    try {
      await fanOut()
      await deliverDue()
    } catch (error) {
      console.error('[webhooks]', error instanceof Error ? error.message : error)
    } finally {
      running = false
    }
  }, TICK_MS)
  return { stop: () => clearInterval(timer) }
}
