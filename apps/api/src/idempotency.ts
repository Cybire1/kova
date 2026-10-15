import { createHash } from 'node:crypto'
import { schema, uuidv7 } from '@kova/db'
import { and, eq } from 'drizzle-orm'
import { createMiddleware } from 'hono/factory'
import { db } from './db.js'
import { KovaError } from './errors.js'

/**
 * `Idempotency-Key` for POSTs that create things, so a retried request (a dropped connection,
 * a double tap) can never make a second charge.
 *
 * The first request with a key claims it and runs; its response is stored. A retry with the
 * same key and body gets that stored response back. The same key with a different body, or
 * while the first request is still running, is refused. Keys are scoped to the API key.
 */
export const idempotent = createMiddleware(async (c, next) => {
  const key = c.req.header('idempotency-key')?.trim()
  if (!key) return next()
  if (key.length > 255)
    throw new KovaError('invalid_request', 'Idempotency-Key is at most 255 characters')

  const apiKeyId = c.get('apiKey').id
  const body = await c.req.raw.clone().text()
  const requestHash = createHash('sha256')
    .update(`${c.req.method} ${c.req.path}\n${body}`)
    .digest('hex')

  const [claimed] = await db
    .insert(schema.idempotencyKeys)
    .values({ id: uuidv7(), apiKeyId, key, requestHash })
    .onConflictDoNothing()
    .returning()

  if (!claimed) {
    const existing = await db.query.idempotencyKeys.findFirst({
      where: and(
        eq(schema.idempotencyKeys.apiKeyId, apiKeyId),
        eq(schema.idempotencyKeys.key, key),
      ),
    })
    if (!existing || existing.requestHash !== requestHash)
      throw new KovaError(
        'idempotency_conflict',
        'This Idempotency-Key was already used with a different request',
      )
    if (existing.statusCode === null || !existing.response)
      throw new KovaError(
        'idempotency_conflict',
        'A request with this Idempotency-Key is still in progress',
      )
    c.header('idempotent-replayed', 'true')
    return c.json(existing.response, existing.statusCode as 200)
  }

  try {
    await next()
  } catch (error) {
    // A failed request frees its key, so the client can retry it for real.
    await db.delete(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.id, claimed.id))
    throw error
  }

  if (c.res.status >= 500) {
    await db.delete(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.id, claimed.id))
    return
  }
  const response = (await c.res
    .clone()
    .json()
    .catch(() => null)) as Record<string, unknown> | null
  await db
    .update(schema.idempotencyKeys)
    .set({ statusCode: c.res.status, response })
    .where(eq(schema.idempotencyKeys.id, claimed.id))
})
