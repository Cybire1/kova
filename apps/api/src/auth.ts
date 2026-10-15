import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { schema } from '@kova/db'
import { eq } from 'drizzle-orm'
import { createMiddleware } from 'hono/factory'
import { db } from './db.js'
import { KovaError } from './errors.js'

type Merchant = typeof schema.merchants.$inferSelect
type ApiKey = typeof schema.apiKeys.$inferSelect

declare module 'hono' {
  interface ContextVariableMap {
    merchant: Merchant
    apiKey: ApiKey
  }
}

const PREFIX_LENGTH = 20 // "kova_test_sk_" + 7 random chars

export interface GeneratedKey {
  /** Shown once, at creation. Kova stores only the hash. */
  secret: string
  prefix: string
  secretHash: string
}

export function generateApiKey(isTest: boolean): GeneratedKey {
  const body = randomBytes(24).toString('base64url')
  const secret = `kova_${isTest ? 'test' : 'live'}_sk_${body}`
  return { secret, prefix: secret.slice(0, PREFIX_LENGTH), secretHash: hashSecret(secret) }
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * Authenticates a merchant API key.
 *
 * Keys are looked up by their non-secret prefix and verified by hash comparison, so the
 * database never holds anything that can be replayed if it leaks.
 */
export const requireApiKey = createMiddleware(async (c, next) => {
  const header = c.req.header('authorization')
  const secret = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined
  if (!secret)
    throw new KovaError('unauthorized', 'Missing API key. Use: Authorization: Bearer <key>')

  const key = await db.query.apiKeys.findFirst({
    where: eq(schema.apiKeys.prefix, secret.slice(0, PREFIX_LENGTH)),
  })
  if (!key || !constantTimeEqual(key.secretHash, hashSecret(secret)))
    throw new KovaError('unauthorized', 'Invalid API key')
  if (key.revokedAt) throw new KovaError('unauthorized', 'This API key was revoked')
  if (key.expiresAt && key.expiresAt.getTime() <= Date.now())
    throw new KovaError('unauthorized', 'This sign-in has expired')

  const merchant = await db.query.merchants.findFirst({
    where: eq(schema.merchants.id, key.merchantId),
  })
  if (!merchant) throw new KovaError('unauthorized', 'API key has no merchant')
  if (merchant.status !== 'active') throw new KovaError('forbidden', 'Merchant is not active')

  c.set('apiKey', key)
  c.set('merchant', merchant)

  // Fire-and-forget: last-used is for support, and must never slow down a payment.
  const now = new Date()
  void db
    .update(schema.apiKeys)
    .set({ lastUsedAt: now })
    .where(eq(schema.apiKeys.id, key.id))
    .catch(() => {})
  if (key.terminalId)
    void db
      .update(schema.terminals)
      .set({ lastSeenAt: now })
      .where(eq(schema.terminals.id, key.terminalId))
      .catch(() => {})

  await next()
})

/**
 * Only the shop's own key, never a paired phone's device key. A stolen terminal can take
 * payments into the shop's account, but cannot pair more phones or remove the real ones.
 */
export const requireMerchantKey = createMiddleware(async (c, next) => {
  if (c.get('apiKey').terminalId)
    throw new KovaError('forbidden', 'A terminal key cannot manage terminals')
  await next()
})
