import { randomBytes } from 'node:crypto'
import { schema, uuidv7 } from '@kova/db'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { getAddress, type Hex, isAddress } from 'viem'
import { z } from 'zod'
import { generateApiKey, requireApiKey, requireMerchantKey } from '../auth.js'
import { network } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { KovaError, notFound } from '../errors.js'
import { decodeId, encodeId } from '../ids.js'
import { clientIp, limit } from '../limits.js'
import {
  createChallenge,
  openSession,
  spendChallenge,
  verifyChallenge,
} from '../services/sign-in.js'

/**
 * A shop's own account: opening it, signing in to it, its settings, and the keys that act for it.
 *
 * Kova never holds a shop's money. Opening a shop records where payments settle (the shop's own
 * Monad address, e.g. its Kova Pay wallet) and, when the opener signs with a wallet, that wallet
 * as the one its owner signs in with. A shop opened without one signs in with its secret key.
 */

type Merchant = typeof schema.merchants.$inferSelect

export function serializeMerchant(m: Merchant) {
  return {
    object: 'merchant',
    id: encodeId('merchant', m.id),
    name: m.name,
    settlement_address: m.settlementAddress,
    /** The wallet the owner signs in with, or null for a shop that signs in with its secret key. */
    owner_address: m.ownerAddress ? getAddress(m.ownerAddress) : null,
    network: m.network,
    country: m.country,
    livemode: !m.isTest,
    /** Private takings: each sale is paid to its own one-time address (routes/takings.ts). */
    private_takings: Boolean(m.stealthMetaAddress),
    explorer_url: network.explorerUrl,
    created_at: m.createdAt.toISOString(),
  }
}

function serializeKey(k: typeof schema.apiKeys.$inferSelect, current?: string) {
  return {
    object: 'api_key',
    id: encodeId('apiKey', k.id),
    name: k.name,
    /** The non-secret start of the key, enough to recognise it. */
    prefix: k.prefix,
    last_used_at: k.lastUsedAt?.toISOString() ?? null,
    created_at: k.createdAt.toISOString(),
    /** True for the key making this request. */
    current: k.id === current,
  }
}

const address = z
  .string()
  .trim()
  .refine((v) => isAddress(v), 'That isn’t a wallet address')
  .transform((v) => getAddress(v))

const signedMessage = z.object({
  message: z.string().min(1).max(2_000),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130,}$/, 'Expected a signature'),
})

const signupBody = z.object({
  name: z.string().trim().min(2).max(60),
  settlement_address: address,
  country: z.string().trim().length(2).toUpperCase().optional(),
  /** A signed "open a shop" challenge: that wallet becomes the one the owner signs in with. */
  owner: signedMessage.optional(),
})

const challengeBody = z.object({
  address,
  /** The site asking, as the wallet will see it: a host, with a port if it has one. */
  domain: z.string().trim().min(1).max(253),
  uri: z.string().url(),
  purpose: z.enum(['sign_in', 'open_shop', 'own_shop']).default('sign_in'),
})

const signInBody = signedMessage.extend({
  /** Which shop, when the wallet signs in to more than one. */
  merchant: z.string().optional(),
  /** Or the one it opened last: the app, bringing a wallet's shop back on a new phone. */
  newest: z.boolean().optional(),
})

const updateBody = z
  .object({ name: z.string().trim().min(2).max(60), settlement_address: address })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')

const keyBody = z.object({ name: z.string().trim().min(1).max(40).default('Secret key') })

const slugify = (name: string) =>
  `${
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32) || 'shop'
  }-${randomBytes(3).toString('hex')}`

async function audit(
  merchantId: string,
  keyId: string,
  action: string,
  metadata?: Record<string, unknown>,
) {
  await db
    .insert(schema.auditLogs)
    .values({
      id: uuidv7(),
      actorType: 'api_key',
      actorId: keyId,
      action,
      targetType: 'merchant',
      targetId: merchantId,
      metadata: metadata ?? null,
    })
    .catch(() => {})
}

export const accountRoutes = new Hono()
  /** Public: open a shop. Returns its first secret key, shown once. */
  .post('/merchants', async (c) => {
    // A speed bump for scripts, invisible to people. Everyone who opens a shop on the website
    // arrives from the web server's one address, so this has room for all of them; a wallet
    // opening shop after shop meets the tighter limit below.
    limit(
      `signup-ip:${clientIp(c)}`,
      60,
      3_600_000,
      'Too many new shops from here. Try again in an hour.',
    )
    const parsed = signupBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success)
      throw new KovaError('invalid_request', parsed.error.issues[0]?.message ?? 'Invalid request', {
        issues: parsed.error.issues,
      })

    const owner = parsed.data.owner
      ? await verifyChallenge({
          ...parsed.data.owner,
          signature: parsed.data.owner.signature as Hex,
          purpose: 'open_shop',
        })
      : undefined
    if (owner) {
      limit(
        `signup-owner:${owner.address}`,
        5,
        3_600_000,
        'That wallet has opened a few shops already. Try again in an hour.',
      )
      await spendChallenge(owner.nonce)
    }

    const isTest = config.KOVA_NETWORK !== 'mainnet'
    const key = generateApiKey(isTest)
    const merchant = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(schema.merchants)
        .values({
          id: uuidv7(),
          name: parsed.data.name,
          slug: slugify(parsed.data.name),
          settlementAddress: parsed.data.settlement_address,
          ownerAddress: owner?.address.toLowerCase() ?? null,
          network: config.KOVA_NETWORK,
          country: parsed.data.country ?? 'US',
          isTest,
        })
        .returning()
      if (!created) throw new KovaError('internal', 'Could not create the shop')
      // An owner who signed is signed in, and signs in again with the same wallet: no secret key
      // to keep. Their systems get one from Developers when they want it.
      if (owner) return created
      await tx.insert(schema.apiKeys).values({
        id: uuidv7(),
        merchantId: created.id,
        name: 'Dashboard',
        prefix: key.prefix,
        secretHash: key.secretHash,
        scopes: ['payments:read', 'payments:write', 'account:admin'],
        isTest,
      })
      return created
    })
    if (owner) {
      const session = await openSession(merchant)
      return c.json(
        {
          ...serializeMerchant(merchant),
          key: session.secret,
          key_expires_at: session.expiresAt.toISOString(),
        },
        201,
      )
    }
    return c.json({ ...serializeMerchant(merchant), key: key.secret, key_expires_at: null }, 201)
  })

  /** Public: the message a wallet signs to sign in to its shop, or to open one. Good once, for ten minutes. */
  .post('/sign_in/challenge', async (c) => {
    const parsed = challengeBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success)
      throw new KovaError('invalid_request', parsed.error.issues[0]?.message ?? 'Invalid request')
    limit(
      `challenge:${parsed.data.address.toLowerCase()}`,
      20,
      600_000,
      'That’s a lot of sign-ins for one wallet. Try again in a few minutes.',
    )
    limit(
      `challenge-ip:${clientIp(c)}`,
      300,
      600_000,
      'That’s a lot of sign-ins from here. Try again in a few minutes.',
    )
    const challenge = await createChallenge(parsed.data)
    return c.json(
      {
        object: 'sign_in_challenge',
        message: challenge.message,
        expires_at: challenge.expiresAt.toISOString(),
      },
      201,
    )
  })

  /**
   * Public: sign in with a signed challenge. Returns a key for this browser's session. A wallet
   * with no shop gets not_found; one with several, and no `merchant` chosen, gets them to choose
   * from, and its signature stays good for the choice.
   */
  .post('/sign_in', async (c) => {
    const parsed = signInBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success)
      throw new KovaError('invalid_request', parsed.error.issues[0]?.message ?? 'Invalid request')
    limit(
      `sign-in-ip:${clientIp(c)}`,
      300,
      600_000,
      'That’s a lot of sign-ins from here. Try again in a few minutes.',
    )
    const { address: owner, nonce } = await verifyChallenge({
      ...parsed.data,
      signature: parsed.data.signature as Hex,
      purpose: 'sign_in',
    })

    const shops = await db.query.merchants.findMany({
      where: and(
        eq(schema.merchants.ownerAddress, owner.toLowerCase()),
        eq(schema.merchants.status, 'active'),
      ),
      orderBy: desc(schema.merchants.createdAt),
    })
    if (shops.length === 0)
      throw new KovaError('not_found', 'No shop signs in with this wallet yet.', {
        reason: 'no_shop',
      })
    const chosen = parsed.data.merchant ? decodeId('merchant', parsed.data.merchant) : null
    const shop = chosen
      ? shops.find((s) => s.id === chosen)
      : shops.length === 1 || parsed.data.newest
        ? shops[0]
        : undefined
    if (!shop) {
      if (chosen) throw notFound('shop', parsed.data.merchant ?? '')
      throw new KovaError('conflict', 'This wallet signs in to more than one shop. Choose one.', {
        reason: 'choose_shop',
        shops: shops.map((s) => ({
          id: encodeId('merchant', s.id),
          name: s.name,
          created_at: s.createdAt.toISOString(),
        })),
      })
    }

    await spendChallenge(nonce)
    const session = await openSession(shop)
    await audit(shop.id, session.id, 'session.opened', { wallet: owner })
    return c.json(
      {
        object: 'session',
        key: session.secret,
        expires_at: session.expiresAt.toISOString(),
        merchant: serializeMerchant(shop),
      },
      201,
    )
  })

  /** Signs this browser out: its session key stops working. A shop's secret keys are left alone. */
  .post('/sign_out', requireApiKey, async (c) => {
    const key = c.get('apiKey')
    if (key.expiresAt)
      await db
        .update(schema.apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(schema.apiKeys.id, key.id), isNull(schema.apiKeys.revokedAt)))
    return c.json({ object: 'session', signed_out: true })
  })

  .get('/account', requireApiKey, requireMerchantKey, (c) =>
    c.json(serializeMerchant(c.get('merchant'))),
  )

  /**
   * Makes a wallet this shop's owner, so its passkey signs in to the shop from now on, on the web
   * and in the app: for a shop opened with a key, with email, or on a phone before shops had
   * owners. The shop's own key asks, and the wallet proves itself by signing.
   */
  .post('/account/owner', requireApiKey, requireMerchantKey, async (c) => {
    const parsed = signedMessage.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) throw new KovaError('invalid_request', 'Expected { message, signature }.')
    const { address: owner, nonce } = await verifyChallenge({
      ...parsed.data,
      signature: parsed.data.signature as Hex,
      purpose: 'own_shop',
    })
    await spendChallenge(nonce)
    const before = c.get('merchant')
    const [merchant] = await db
      .update(schema.merchants)
      .set({ ownerAddress: owner.toLowerCase(), updatedAt: new Date() })
      .where(eq(schema.merchants.id, before.id))
      .returning()
    if (!merchant) throw notFound('merchant', encodeId('merchant', before.id))
    // Who can sign in to a shop is as sensitive as where its money goes: keep a record.
    await audit(before.id, c.get('apiKey').id, 'merchant.owner.updated', {
      from: before.ownerAddress,
      to: owner,
    })
    return c.json(serializeMerchant(merchant))
  })

  .patch('/account', requireApiKey, requireMerchantKey, async (c) => {
    const parsed = updateBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success)
      throw new KovaError('invalid_request', parsed.error.issues[0]?.message ?? 'Invalid request')
    const before = c.get('merchant')
    const [merchant] = await db
      .update(schema.merchants)
      .set({
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        ...(parsed.data.settlement_address
          ? { settlementAddress: parsed.data.settlement_address }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.merchants.id, before.id))
      .returning()
    if (!merchant) throw notFound('merchant', encodeId('merchant', before.id))
    if (
      parsed.data.settlement_address &&
      parsed.data.settlement_address !== before.settlementAddress
    )
      // Where money goes is the most sensitive setting a shop has: keep a record of every change.
      await audit(before.id, c.get('apiKey').id, 'merchant.settlement_address.updated', {
        from: before.settlementAddress,
        to: parsed.data.settlement_address,
      })
    return c.json(serializeMerchant(merchant))
  })

  .get('/api_keys', requireApiKey, requireMerchantKey, async (c) => {
    const rows = await db.query.apiKeys.findMany({
      // Paired phones and signed-in browsers have keys too, but they aren't the shop's secret keys.
      where: and(
        eq(schema.apiKeys.merchantId, c.get('merchant').id),
        isNull(schema.apiKeys.terminalId),
        isNull(schema.apiKeys.expiresAt),
        isNull(schema.apiKeys.revokedAt),
      ),
      orderBy: desc(schema.apiKeys.createdAt),
    })
    return c.json({ object: 'list', data: rows.map((k) => serializeKey(k, c.get('apiKey').id)) })
  })

  .post('/api_keys', requireApiKey, requireMerchantKey, async (c) => {
    const parsed = keyBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) throw new KovaError('invalid_request', 'Expected { name }')
    const merchant = c.get('merchant')
    const key = generateApiKey(merchant.isTest)
    const [row] = await db
      .insert(schema.apiKeys)
      .values({
        id: uuidv7(),
        merchantId: merchant.id,
        name: parsed.data.name,
        prefix: key.prefix,
        secretHash: key.secretHash,
        scopes: ['payments:read', 'payments:write', 'account:admin'],
        isTest: merchant.isTest,
      })
      .returning()
    if (!row) throw new KovaError('internal', 'Could not create the key')
    await audit(merchant.id, c.get('apiKey').id, 'api_key.created', {
      key: encodeId('apiKey', row.id),
    })
    return c.json({ ...serializeKey(row), secret: key.secret }, 201)
  })

  .delete('/api_keys/:id', requireApiKey, requireMerchantKey, async (c) => {
    const id = c.req.param('id')
    const uuid = decodeId('apiKey', id)
    // Revoking the key you are signed in with would lock you out mid-click.
    if (uuid === c.get('apiKey').id)
      throw new KovaError(
        'conflict',
        'You are signed in with this key. Sign in with another key to revoke it.',
      )
    const [row] = uuid
      ? await db
          .update(schema.apiKeys)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(schema.apiKeys.id, uuid),
              eq(schema.apiKeys.merchantId, c.get('merchant').id),
              isNull(schema.apiKeys.terminalId),
              isNull(schema.apiKeys.revokedAt),
            ),
          )
          .returning()
      : []
    if (!row) throw notFound('api key', id)
    await audit(c.get('merchant').id, c.get('apiKey').id, 'api_key.revoked', { key: id })
    return c.json({ object: 'api_key', id, revoked: true })
  })
