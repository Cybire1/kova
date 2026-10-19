import { createHash, randomInt } from 'node:crypto'
import { schema, uuidv7 } from '@kova/db'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { generateApiKey, requireApiKey, requireMerchantKey } from '../auth.js'
import { db } from '../db.js'
import { KovaError, notFound } from '../errors.js'
import { decodeId, encodeId } from '../ids.js'

/**
 * Pairing a phone as a merchant's terminal.
 *
 * The merchant creates a short code in the dashboard (merchant key). The phone redeems it
 * once and receives its own device key, scoped to taking payments, so a merchant's master
 * key never lives on a device and a lost terminal can be revoked on its own.
 */

/** No 0/O, 1/I/L: a code people read off a screen and type on a phone. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const CODE_LENGTH = 6
const TTL_MS = 10 * 60 * 1000

const normalize = (code: string) => code.toUpperCase().replace(/[^0-9A-Z]/g, '')
const hash = (code: string) =>
  createHash('sha256')
    .update(`kova-pair:${normalize(code)}`)
    .digest('hex')

function newCode() {
  return Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
}

/** Retire a terminal: it disappears from the shop, and its device key stops working at once. */
async function retire(merchantId: string, terminalId: string) {
  return db.transaction(async (tx) => {
    const [terminal] = await tx
      .update(schema.terminals)
      .set({ status: 'disabled' })
      .where(and(eq(schema.terminals.id, terminalId), eq(schema.terminals.merchantId, merchantId)))
      .returning()
    if (!terminal) return null
    await tx
      .update(schema.apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.apiKeys.terminalId, terminalId), isNull(schema.apiKeys.revokedAt)))
    return terminal
  })
}

const pairBody = z.object({
  code: z.string().min(4).max(20),
  name: z.string().trim().min(1).max(60).default('Terminal'),
  device: z.record(z.string(), z.unknown()).optional(),
})

export const terminalRoutes = new Hono()
  /** Merchant: create a pairing code, valid for ten minutes and a single use. */
  .post('/pairings', requireApiKey, requireMerchantKey, async (c) => {
    const merchant = c.get('merchant')
    const code = newCode()
    const expiresAt = new Date(Date.now() + TTL_MS)
    await db
      .insert(schema.terminalPairings)
      .values({ id: uuidv7(), merchantId: merchant.id, codeHash: hash(code), expiresAt })
    return c.json(
      {
        object: 'terminal_pairing',
        code: `${code.slice(0, 3)}-${code.slice(3)}`,
        link: `kova://pair/${code}`,
        merchant_name: merchant.name,
        expires_at: expiresAt.toISOString(),
      },
      201,
    )
  })
  /** Merchant: the terminals paired to this shop. */
  .get('/', requireApiKey, requireMerchantKey, async (c) => {
    const rows = await db.query.terminals.findMany({
      where: and(
        eq(schema.terminals.merchantId, c.get('merchant').id),
        eq(schema.terminals.status, 'active'),
      ),
      orderBy: (t, { asc }) => [asc(t.createdAt)],
    })
    return c.json({
      object: 'list',
      data: rows.map((t) => ({
        id: encodeId('terminal', t.id),
        name: t.name,
        status: t.status,
        last_seen_at: t.lastSeenAt?.toISOString() ?? null,
        created_at: t.createdAt.toISOString(),
      })),
    })
  })
  /** Phone: unpair itself. Its own key is revoked, so a forgotten phone holds nothing useful. */
  .post('/self/unpair', requireApiKey, async (c) => {
    const terminalId = c.get('apiKey').terminalId
    if (!terminalId) throw new KovaError('invalid_request', 'This is not a terminal key')
    await retire(c.get('merchant').id, terminalId)
    return c.json({ object: 'terminal', id: encodeId('terminal', terminalId), status: 'disabled' })
  })
  /** Merchant: remove a terminal, e.g. a lost phone. */
  .delete('/:id', requireApiKey, requireMerchantKey, async (c) => {
    const id = c.req.param('id')
    const uuid = decodeId('terminal', id)
    const terminal = uuid ? await retire(c.get('merchant').id, uuid) : null
    if (!terminal) throw notFound('terminal', id)
    return c.json({ object: 'terminal', id, status: 'disabled' })
  })
  /** Phone: redeem a code for this device's own key. No key needed: the code is the proof. */
  .post('/pair', async (c) => {
    const parsed = pairBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) throw new KovaError('invalid_request', 'Expected { code, name }')
    const { code, name, device } = parsed.data

    const result = await db.transaction(async (tx) => {
      // Claim the code atomically, so two phones racing for one code cannot both pair.
      const [pairing] = await tx
        .update(schema.terminalPairings)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(schema.terminalPairings.codeHash, hash(code)),
            isNull(schema.terminalPairings.usedAt),
            gt(schema.terminalPairings.expiresAt, new Date()),
          ),
        )
        .returning()
      if (!pairing) return null

      const merchant = await tx.query.merchants.findFirst({
        where: eq(schema.merchants.id, pairing.merchantId),
      })
      if (!merchant || merchant.status !== 'active') return null

      const terminalId = uuidv7()
      await tx.insert(schema.terminals).values({
        id: terminalId,
        merchantId: merchant.id,
        name,
        device: device ?? null,
        lastSeenAt: new Date(),
      })
      await tx
        .update(schema.terminalPairings)
        .set({ terminalId })
        .where(eq(schema.terminalPairings.id, pairing.id))

      const key = generateApiKey(merchant.isTest)
      await tx.insert(schema.apiKeys).values({
        id: uuidv7(),
        merchantId: merchant.id,
        name: `terminal: ${name}`,
        prefix: key.prefix,
        secretHash: key.secretHash,
        scopes: ['payments:read', 'payments:write'],
        terminalId,
        isTest: merchant.isTest,
      })
      return { merchant, terminalId, secret: key.secret }
    })

    if (!result)
      throw new KovaError(
        'not_found',
        'That code has expired or was already used. Ask for a new one.',
      )
    return c.json(
      {
        object: 'terminal',
        id: encodeId('terminal', result.terminalId),
        name,
        merchant: { id: encodeId('merchant', result.merchant.id), name: result.merchant.name },
        /** Shown once. The phone keeps it in its secure storage. */
        key: result.secret,
      },
      201,
    )
  })
