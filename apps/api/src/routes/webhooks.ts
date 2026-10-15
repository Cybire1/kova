import { randomBytes } from 'node:crypto'
import { schema, uuidv7 } from '@kova/db'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireApiKey, requireMerchantKey } from '../auth.js'
import { isProduction } from '../config.js'
import { db } from '../db.js'
import { KovaError, notFound } from '../errors.js'
import { decodeId, encodeId } from '../ids.js'

/** Everything a shop can subscribe to. `*` means all of them. */
export const EVENT_TYPES = [
  'payment_intent.paid',
  'payment_intent.held',
  'payment_intent.failed',
  'test.ping',
] as const

type Endpoint = typeof schema.webhookEndpoints.$inferSelect

function serializeEndpoint(e: Endpoint) {
  return {
    object: 'webhook_endpoint',
    id: encodeId('webhookEndpoint', e.id),
    url: e.url,
    events: e.events,
    status: e.status,
    created_at: e.createdAt.toISOString(),
  }
}

const endpointBody = z.object({
  url: z
    .string()
    .trim()
    .url()
    .refine((u) => {
      const url = new URL(u)
      if (url.protocol === 'https:') return true
      // Plain http only for local development servers.
      return (
        !isProduction &&
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(url.hostname)
      )
    }, 'Use an https:// URL'),
  events: z
    .array(z.enum([...EVENT_TYPES, '*']))
    .min(1)
    .default(['*']),
})

export const webhookRoutes = new Hono()
  .get('/webhook_endpoints', requireApiKey, requireMerchantKey, async (c) => {
    const rows = await db.query.webhookEndpoints.findMany({
      where: and(
        eq(schema.webhookEndpoints.merchantId, c.get('merchant').id),
        eq(schema.webhookEndpoints.status, 'active'),
      ),
      orderBy: desc(schema.webhookEndpoints.createdAt),
    })
    return c.json({ object: 'list', data: rows.map(serializeEndpoint) })
  })

  /** Returns the signing secret once. Kova signs every delivery with it. */
  .post('/webhook_endpoints', requireApiKey, requireMerchantKey, async (c) => {
    const parsed = endpointBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success)
      throw new KovaError('invalid_request', parsed.error.issues[0]?.message ?? 'Invalid request')
    const secret = `whsec_${randomBytes(24).toString('base64url')}`
    const [row] = await db
      .insert(schema.webhookEndpoints)
      .values({
        id: uuidv7(),
        merchantId: c.get('merchant').id,
        url: parsed.data.url,
        secret,
        events: parsed.data.events,
      })
      .returning()
    if (!row) throw new KovaError('internal', 'Could not create the endpoint')
    return c.json({ ...serializeEndpoint(row), secret }, 201)
  })

  .delete('/webhook_endpoints/:id', requireApiKey, requireMerchantKey, async (c) => {
    const id = c.req.param('id')
    const uuid = decodeId('webhookEndpoint', id)
    const [row] = uuid
      ? await db
          .update(schema.webhookEndpoints)
          .set({ status: 'disabled' })
          .where(
            and(
              eq(schema.webhookEndpoints.id, uuid),
              eq(schema.webhookEndpoints.merchantId, c.get('merchant').id),
            ),
          )
          .returning()
      : []
    if (!row) throw notFound('webhook endpoint', id)
    return c.json({ ...serializeEndpoint(row), deleted: true })
  })

  /** Sends a test.ping to one endpoint, through the same queue as real events. */
  .post('/webhook_endpoints/:id/test', requireApiKey, requireMerchantKey, async (c) => {
    const id = c.req.param('id')
    const uuid = decodeId('webhookEndpoint', id)
    const endpoint = uuid
      ? await db.query.webhookEndpoints.findFirst({
          where: and(
            eq(schema.webhookEndpoints.id, uuid),
            eq(schema.webhookEndpoints.merchantId, c.get('merchant').id),
          ),
        })
      : undefined
    if (!endpoint) throw notFound('webhook endpoint', id)
    const eventId = uuidv7()
    await db.transaction(async (tx) => {
      await tx.insert(schema.events).values({
        id: eventId,
        merchantId: endpoint.merchantId,
        type: 'test.ping',
        data: { message: 'Hello from Kova. Your endpoint is set up.' },
      })
      // Queued directly for this endpoint only, not fanned out to the others.
      await tx
        .insert(schema.webhookDeliveries)
        .values({ id: uuidv7(), endpointId: endpoint.id, eventId })
    })
    return c.json({ object: 'event', id: encodeId('event', eventId), type: 'test.ping' }, 202)
  })

  /** The shop's recent events, with how each delivery went. */
  .get('/events', requireApiKey, requireMerchantKey, async (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? 20) || 20, 100)
    const rows = await db.query.events.findMany({
      where: eq(schema.events.merchantId, c.get('merchant').id),
      orderBy: desc(schema.events.createdAt),
      limit,
    })
    const deliveries = rows.length
      ? await db.query.webhookDeliveries.findMany({
          where: inArray(
            schema.webhookDeliveries.eventId,
            rows.map((r) => r.id),
          ),
        })
      : []
    return c.json({
      object: 'list',
      data: rows.map((e) => ({
        object: 'event',
        id: encodeId('event', e.id),
        type: e.type,
        data: e.data,
        created_at: e.createdAt.toISOString(),
        deliveries: deliveries
          .filter((d) => d.eventId === e.id)
          .map((d) => ({
            endpoint: encodeId('webhookEndpoint', d.endpointId),
            status: d.status,
            attempts: d.attempts,
            response_status: d.responseStatus,
            last_error: d.lastError,
            delivered_at: d.deliveredAt?.toISOString() ?? null,
          })),
      })),
    })
  })
