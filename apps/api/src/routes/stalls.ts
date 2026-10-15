import { randomBytes } from 'node:crypto'
import { schema, uuidv7 } from '@kova/db'
import { formatAmount } from '@kova/monad'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireApiKey, requireMerchantKey } from '../auth.js'
import { db } from '../db.js'
import { KovaError, notFound } from '../errors.js'
import { decodeId, encodeId } from '../ids.js'
import { clientIp } from '../limits.js'
import { serializeItem, serializeStall, slugify } from '../services/catalog.js'
import { encodeCheckoutLink } from '../services/links.js'
import { placeOrder, serializeOrder } from '../services/orders.js'
import { publicOrigin } from '../services/origin.js'
import { stampCard } from '../services/stamps.js'

/**
 * Stalls: a shop's pocket storefronts. The shop manages them with its key; anyone can open one
 * by its slug and order from it, with no account.
 */

const stallBody = z.object({
  name: z.string().trim().min(2).max(60),
  tagline: z.string().trim().max(120).nullish(),
  open: z.boolean().optional(),
  cover_image_id: z.string().nullish(),
  /** The items it shows, in order. Replaces the list. */
  item_ids: z.array(z.string()).max(200).optional(),
  /** Tables with their own QR code. Null: counter only. */
  table_count: z.number().int().min(1).max(200).nullish(),
  /** Paid orders that fill the stamp card. Null: no card. */
  loyalty_every: z.number().int().min(2).max(20).nullish(),
})

const payerAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Expected a wallet address')

const orderBody = z.object({
  items: z
    .array(z.object({ id: z.string(), quantity: z.number().int().min(1).max(99) }))
    .min(1)
    .max(50),
  customer_name: z.string().trim().max(60).optional(),
  note: z.string().trim().max(200).optional(),
  /** Send the payment link to someone else to pay (it stays payable for a day). */
  pay_for_me: z.boolean().optional(),
  /** The table it's ordered from, from the table's QR code. */
  table: z
    .string()
    .trim()
    .regex(/^[\w -]{1,12}$/, 'Invalid table')
    .optional(),
  /** The wallet that will pay: it earns a stamp, and spends a full card. */
  payer: payerAddress.optional(),
})

/** Public checkouts create charges: rate-limit them per address so nobody floods a shop. */
const checkouts = new Map<string, number[]>()
function allowCheckout(ip: string) {
  const now = Date.now()
  const recent = (checkouts.get(ip) ?? []).filter((t) => now - t < 600_000)
  if (recent.length >= 30) return false
  checkouts.set(ip, [...recent, now])
  return true
}

async function uniqueSlug(name: string) {
  const base = slugify(name)
  for (let attempt = 0; attempt < 6; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`
    const taken = await db.query.stalls.findFirst({
      columns: { id: true },
      where: eq(schema.stalls.slug, slug),
    })
    if (!taken) return slug
  }
  return `${base}-${randomBytes(4).toString('hex')}`
}

async function findStall(merchantId: string, id: string) {
  const uuid = decodeId('stall', id)
  const stall = uuid
    ? await db.query.stalls.findFirst({
        where: and(
          eq(schema.stalls.id, uuid),
          eq(schema.stalls.merchantId, merchantId),
          isNull(schema.stalls.archivedAt),
        ),
      })
    : undefined
  if (!stall) throw notFound('stall', id)
  return stall
}

/** A stall's items, in its order, not archived. */
async function stallCatalog(stallId: string) {
  const links = await db.query.stallItems.findMany({
    where: eq(schema.stallItems.stallId, stallId),
    orderBy: asc(schema.stallItems.position),
  })
  if (links.length === 0) return []
  const items = await db.query.catalogItems.findMany({
    where: and(
      inArray(
        schema.catalogItems.id,
        links.map((l) => l.itemId),
      ),
      isNull(schema.catalogItems.archivedAt),
    ),
  })
  const byId = new Map(items.map((i) => [i.id, i]))
  return links.flatMap((l) => {
    const item = byId.get(l.itemId)
    return item ? [item] : []
  })
}

/** Resolve item ids to this shop's own, live items. */
async function ownItems(merchantId: string, ids: string[]) {
  const uuids = ids.map((id) => {
    const uuid = decodeId('catalogItem', id)
    if (!uuid) throw notFound('item', id)
    return uuid
  })
  if (uuids.length === 0) return []
  const rows = await db.query.catalogItems.findMany({
    columns: { id: true },
    where: and(
      eq(schema.catalogItems.merchantId, merchantId),
      inArray(schema.catalogItems.id, uuids),
      isNull(schema.catalogItems.archivedAt),
    ),
  })
  if (rows.length !== new Set(uuids).size)
    throw new KovaError('invalid_request', 'Some items are not in your catalogue')
  return [...new Set(uuids)]
}

async function ownImage(merchantId: string, id: string | null | undefined) {
  if (id === null) return null
  if (id === undefined) return undefined
  const uuid = decodeId('image', id)
  const image = uuid
    ? await db.query.images.findFirst({
        columns: { id: true },
        where: and(eq(schema.images.id, uuid), eq(schema.images.merchantId, merchantId)),
      })
    : undefined
  if (!image) throw notFound('image', id)
  return image.id
}

export const stallRoutes = new Hono()
  .get('/stalls', requireApiKey, requireMerchantKey, async (c) => {
    const rows = await db.query.stalls.findMany({
      where: and(
        eq(schema.stalls.merchantId, c.get('merchant').id),
        isNull(schema.stalls.archivedAt),
      ),
      orderBy: asc(schema.stalls.createdAt),
    })
    const links = rows.length
      ? await db.query.stallItems.findMany({
          where: inArray(
            schema.stallItems.stallId,
            rows.map((r) => r.id),
          ),
          orderBy: asc(schema.stallItems.position),
        })
      : []
    const origin = publicOrigin(c)
    return c.json({
      object: 'list',
      data: rows.map((s) =>
        serializeStall(s, origin, {
          item_ids: links
            .filter((l) => l.stallId === s.id)
            .map((l) => encodeId('catalogItem', l.itemId)),
        }),
      ),
    })
  })

  .post('/stalls', requireApiKey, requireMerchantKey, async (c) => {
    const parsed = stallBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success)
      throw new KovaError('invalid_request', parsed.error.issues[0]?.message ?? 'Invalid stall')
    const merchant = c.get('merchant')
    const body = parsed.data
    const [items, coverImageId] = await Promise.all([
      ownItems(merchant.id, body.item_ids ?? []),
      ownImage(merchant.id, body.cover_image_id),
    ])
    const stall = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.stalls)
        .values({
          id: uuidv7(),
          merchantId: merchant.id,
          slug: await uniqueSlug(body.name),
          name: body.name,
          tagline: body.tagline ?? null,
          open: body.open ?? true,
          coverImageId: coverImageId ?? null,
          tableCount: body.table_count ?? null,
          loyaltyEvery: body.loyalty_every ?? null,
        })
        .returning()
      if (!row) throw new KovaError('internal', 'Could not open the stall')
      if (items.length)
        await tx
          .insert(schema.stallItems)
          .values(items.map((itemId, position) => ({ stallId: row.id, itemId, position })))
      return row
    })
    return c.json(
      serializeStall(stall, publicOrigin(c), {
        item_ids: items.map((i) => encodeId('catalogItem', i)),
      }),
      201,
    )
  })

  .get('/stalls/:id', requireApiKey, requireMerchantKey, async (c) => {
    const stall = await findStall(c.get('merchant').id, c.req.param('id'))
    const items = await stallCatalog(stall.id)
    const origin = publicOrigin(c)
    return c.json({
      ...serializeStall(stall, origin, {
        item_ids: items.map((i) => encodeId('catalogItem', i.id)),
      }),
      items: items.map((i) => serializeItem(i, origin)),
    })
  })

  .patch('/stalls/:id', requireApiKey, requireMerchantKey, async (c) => {
    const parsed = stallBody.partial().safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success)
      throw new KovaError('invalid_request', parsed.error.issues[0]?.message ?? 'Invalid stall')
    const merchant = c.get('merchant')
    const stall = await findStall(merchant.id, c.req.param('id'))
    const body = parsed.data
    const [items, coverImageId] = await Promise.all([
      body.item_ids ? ownItems(merchant.id, body.item_ids) : Promise.resolve(undefined),
      ownImage(merchant.id, body.cover_image_id),
    ])
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(schema.stalls)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.tagline !== undefined ? { tagline: body.tagline ?? null } : {}),
          ...(body.open !== undefined ? { open: body.open } : {}),
          ...(body.table_count !== undefined ? { tableCount: body.table_count ?? null } : {}),
          ...(body.loyalty_every !== undefined ? { loyaltyEvery: body.loyalty_every ?? null } : {}),
          ...(coverImageId !== undefined ? { coverImageId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.stalls.id, stall.id))
        .returning()
      if (items) {
        await tx.delete(schema.stallItems).where(eq(schema.stallItems.stallId, stall.id))
        if (items.length)
          await tx
            .insert(schema.stallItems)
            .values(items.map((itemId, position) => ({ stallId: stall.id, itemId, position })))
      }
      return updated
    })
    if (!row) throw notFound('stall', c.req.param('id'))
    const listed = await stallCatalog(row.id)
    return c.json(
      serializeStall(row, publicOrigin(c), {
        item_ids: listed.map((i) => encodeId('catalogItem', i.id)),
      }),
    )
  })

  .delete('/stalls/:id', requireApiKey, requireMerchantKey, async (c) => {
    const stall = await findStall(c.get('merchant').id, c.req.param('id'))
    await db
      .update(schema.stalls)
      .set({ archivedAt: new Date(), open: false })
      .where(eq(schema.stalls.id, stall.id))
    return c.json({ object: 'stall', id: encodeId('stall', stall.id), deleted: true })
  })

  /** Public: a stall and what it sells, for its page and for Kova Pay's stall screen. */
  .get('/public/stalls/:slug', async (c) => {
    const stall = await db.query.stalls.findFirst({
      where: and(eq(schema.stalls.slug, c.req.param('slug')), isNull(schema.stalls.archivedAt)),
    })
    if (!stall) throw notFound('stall', c.req.param('slug'))
    const [merchant, items] = await Promise.all([
      db.query.merchants.findFirst({ where: eq(schema.merchants.id, stall.merchantId) }),
      stallCatalog(stall.id),
    ])
    if (!merchant || merchant.status !== 'active') throw notFound('stall', c.req.param('slug'))
    const origin = publicOrigin(c)
    return c.json({
      ...serializeStall(stall, origin, { shop_name: merchant.name }),
      livemode: !merchant.isTest,
      items: items.map((i) => {
        const { barcode: _barcode, image_id: _image, ...item } = serializeItem(i, origin)
        return item
      }),
    })
  })

  /**
   * Public: order from a stall. The server prices every line from the catalogue and opens the
   * payment; the buyer pays it like any Kova charge, or sends the link to someone who will.
   */
  .post('/public/stalls/:slug/orders', async (c) => {
    const ip = clientIp(c)
    if (!allowCheckout(ip))
      throw new KovaError('rate_limited', 'Too many orders from here. Try again in a few minutes.')
    const parsed = orderBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success)
      throw new KovaError('invalid_request', parsed.error.issues[0]?.message ?? 'Invalid order')

    const stall = await db.query.stalls.findFirst({
      where: and(eq(schema.stalls.slug, c.req.param('slug')), isNull(schema.stalls.archivedAt)),
    })
    if (!stall) throw notFound('stall', c.req.param('slug'))
    if (!stall.open) throw new KovaError('conflict', `${stall.name} is closed right now`)
    const merchant = await db.query.merchants.findFirst({
      where: eq(schema.merchants.id, stall.merchantId),
    })
    if (!merchant || merchant.status !== 'active') throw notFound('stall', c.req.param('slug'))

    const { order, intent } = await placeOrder({
      merchant,
      source: 'stall',
      stall,
      items: parsed.data.items,
      customerName: parsed.data.customer_name,
      note: parsed.data.note,
      payForMe: parsed.data.pay_for_me,
      table: parsed.data.table,
      payer: parsed.data.payer,
    })
    return c.json(
      {
        ...serializeOrder(order, { stall }),
        checkout: {
          id: encodeId('paymentIntent', intent.id),
          amount: formatAmount(intent.amount),
          status: intent.status,
          expires_at: intent.expiresAt.toISOString(),
          link: encodeCheckoutLink(encodeId('paymentIntent', intent.id)),
        },
      },
      201,
    )
  })

  /** Public: a wallet's stamp card at a stall. The wallet that pays is the card: no sign-up. */
  .get('/public/stalls/:slug/stamps', async (c) => {
    const payer = payerAddress.safeParse(c.req.query('payer'))
    if (!payer.success) throw new KovaError('invalid_request', 'Expected ?payer=<wallet address>')
    const stall = await db.query.stalls.findFirst({
      where: and(eq(schema.stalls.slug, c.req.param('slug')), isNull(schema.stalls.archivedAt)),
    })
    if (!stall) throw notFound('stall', c.req.param('slug'))
    const card = await stampCard(stall, payer.data)
    return c.json({ object: 'stamp_card', ...(card ?? { every: null, stamps: 0, ready: false }) })
  })
