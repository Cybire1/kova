import { schema, uuidv7 } from '@kova/db'
import { parseAmount } from '@kova/monad'
import { and, asc, eq, inArray, isNull, max } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireApiKey, requireMerchantKey } from '../auth.js'
import { db } from '../db.js'
import { KovaError, notFound } from '../errors.js'
import { decodeId, encodeId } from '../ids.js'
import { isBarcode, lookupBarcode } from '../services/barcodes.js'
import { serializeItem } from '../services/catalog.js'
import { imageUrl, MAX_IMAGE_BYTES, sniffImage } from '../services/images.js'
import { askJev } from '../services/jev.js'
import { menuImportReady, readMenu } from '../services/menu-import.js'
import { publicOrigin } from '../services/origin.js'

/**
 * A shop's catalogue: one list of what it sells, used by its stalls, its till and barcode
 * scanning. Only the shop's own key edits it; a paired phone can read it, scan barcodes and sell.
 */

const price = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, 'Use a price like 4.50')
  .refine((v) => {
    // Zod runs this even when the format check above failed, so it must not throw.
    try {
      const base = parseAmount(v)
      return base > 0n && base <= parseAmount('10000')
    } catch {
      return false
    }
  }, 'Prices run from $0.01 to $10,000')

const barcode = z
  .string()
  .trim()
  .refine((v) => isBarcode(v), 'A barcode is 8 to 14 digits')

const itemBody = z.object({
  name: z.string().trim().min(1).max(80),
  price,
  description: z.string().trim().max(200).nullish(),
  barcode: barcode.nullish(),
  image_id: z.string().nullish(),
  sold_out: z.boolean().optional(),
  /** How many are left; null stops counting. */
  stock: z.number().int().min(0).max(1_000_000).nullish(),
  category: z.string().trim().max(40).nullish(),
  /** Also put it on these stalls. */
  stall_ids: z.array(z.string()).max(20).optional(),
})

const importBody = z.object({
  image: z.string().min(100).max(8_000_000),
  media_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
})

/** Menu reads cost money: a few dozen an hour per shop is plenty for real use. */
const reads = new Map<string, number[]>()
function allowRead(merchantId: string) {
  const now = Date.now()
  const recent = (reads.get(merchantId) ?? []).filter((t) => now - t < 3_600_000)
  if (recent.length >= 30) return false
  reads.set(merchantId, [...recent, now])
  return true
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

async function findItem(merchantId: string, id: string) {
  const uuid = decodeId('catalogItem', id)
  const item = uuid
    ? await db.query.catalogItems.findFirst({
        where: and(
          eq(schema.catalogItems.id, uuid),
          eq(schema.catalogItems.merchantId, merchantId),
          isNull(schema.catalogItems.archivedAt),
        ),
      })
    : undefined
  if (!item) throw notFound('item', id)
  return item
}

/** Postgres unique violation on the barcode index, said plainly. */
function barcodeTaken(error: unknown): never {
  // Drizzle wraps the driver's error; the Postgres code is on it or on its cause.
  const e = error as { code?: string; cause?: { code?: string } }
  if (e?.code === '23505' || e?.cause?.code === '23505')
    throw new KovaError('conflict', 'That barcode is already on another item in your catalogue')
  throw error
}

export const catalogRoutes = new Hono()
  .get('/catalog/items', requireApiKey, async (c) => {
    const rows = await db.query.catalogItems.findMany({
      where: and(
        eq(schema.catalogItems.merchantId, c.get('merchant').id),
        isNull(schema.catalogItems.archivedAt),
      ),
      orderBy: [asc(schema.catalogItems.position), asc(schema.catalogItems.createdAt)],
    })
    const origin = publicOrigin(c)
    return c.json({ object: 'list', data: rows.map((r) => serializeItem(r, origin)) })
  })

  .post('/catalog/items', requireApiKey, requireMerchantKey, async (c) => {
    const parsed = itemBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success)
      throw new KovaError('invalid_request', parsed.error.issues[0]?.message ?? 'Invalid item')
    const merchant = c.get('merchant')
    const body = parsed.data
    const imageId = await ownImage(merchant.id, body.image_id)

    const stallIds = (body.stall_ids ?? []).map((id) => {
      const uuid = decodeId('stall', id)
      if (!uuid) throw notFound('stall', id)
      return uuid
    })
    if (stallIds.length) {
      const owned = await db.query.stalls.findMany({
        columns: { id: true },
        where: and(eq(schema.stalls.merchantId, merchant.id), inArray(schema.stalls.id, stallIds)),
      })
      if (owned.length !== new Set(stallIds).size)
        throw new KovaError('invalid_request', 'Unknown stall')
    }

    const item = await db
      .transaction(async (tx) => {
        const [last] = await tx
          .select({ position: max(schema.catalogItems.position) })
          .from(schema.catalogItems)
          .where(eq(schema.catalogItems.merchantId, merchant.id))
        const [row] = await tx
          .insert(schema.catalogItems)
          .values({
            id: uuidv7(),
            merchantId: merchant.id,
            name: body.name,
            description: body.description ?? null,
            price: parseAmount(body.price),
            imageId: imageId ?? null,
            barcode: body.barcode ?? null,
            soldOut: body.stock === 0 ? true : (body.sold_out ?? false),
            stock: body.stock ?? null,
            category: body.category || null,
            position: (last?.position ?? 0) + 1,
          })
          .returning()
        if (!row) throw new KovaError('internal', 'Could not save the item')
        for (const stallId of new Set(stallIds)) {
          const [end] = await tx
            .select({ position: max(schema.stallItems.position) })
            .from(schema.stallItems)
            .where(eq(schema.stallItems.stallId, stallId))
          await tx
            .insert(schema.stallItems)
            .values({ stallId, itemId: row.id, position: (end?.position ?? 0) + 1 })
        }
        return row
      })
      .catch(barcodeTaken)
    return c.json(serializeItem(item, publicOrigin(c)), 201)
  })

  .patch('/catalog/items/:id', requireApiKey, requireMerchantKey, async (c) => {
    const parsed = itemBody
      .omit({ stall_ids: true })
      .partial()
      .safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success)
      throw new KovaError('invalid_request', parsed.error.issues[0]?.message ?? 'Invalid item')
    const merchant = c.get('merchant')
    const item = await findItem(merchant.id, c.req.param('id'))
    const body = parsed.data
    const imageId = await ownImage(merchant.id, body.image_id)
    const [row] = await db
      .update(schema.catalogItems)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.price !== undefined ? { price: parseAmount(body.price) } : {}),
        ...(body.description !== undefined ? { description: body.description ?? null } : {}),
        ...(body.barcode !== undefined ? { barcode: body.barcode ?? null } : {}),
        ...(imageId !== undefined ? { imageId } : {}),
        ...(body.sold_out !== undefined ? { soldOut: body.sold_out } : {}),
        ...(body.category !== undefined ? { category: body.category || null } : {}),
        // Counting stock decides sold out: none left is sold out, a restock is back on sale.
        ...(body.stock !== undefined
          ? {
              stock: body.stock ?? null,
              ...(body.stock === null ? {} : { soldOut: body.stock === 0 }),
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.catalogItems.id, item.id))
      .returning()
      .catch(barcodeTaken)
    if (!row) throw notFound('item', c.req.param('id'))
    return c.json(serializeItem(row, publicOrigin(c)))
  })

  .delete('/catalog/items/:id', requireApiKey, requireMerchantKey, async (c) => {
    const item = await findItem(c.get('merchant').id, c.req.param('id'))
    await db.transaction(async (tx) => {
      await tx
        .update(schema.catalogItems)
        .set({ archivedAt: new Date() })
        .where(eq(schema.catalogItems.id, item.id))
      await tx.delete(schema.stallItems).where(eq(schema.stallItems.itemId, item.id))
    })
    return c.json({ object: 'catalog_item', id: encodeId('catalogItem', item.id), deleted: true })
  })

  /** A scanned barcode: this shop's item if it has one, else what open product databases know. */
  .get('/catalog/barcodes/:code', requireApiKey, async (c) => {
    const code = c.req.param('code').trim()
    if (!isBarcode(code)) throw new KovaError('invalid_request', 'A barcode is 8 to 14 digits')
    const item = await db.query.catalogItems.findFirst({
      where: and(
        eq(schema.catalogItems.merchantId, c.get('merchant').id),
        eq(schema.catalogItems.barcode, code),
        isNull(schema.catalogItems.archivedAt),
      ),
    })
    return c.json({
      object: 'barcode',
      code,
      item: item ? serializeItem(item, publicOrigin(c)) : null,
      suggestion: item ? null : await lookupBarcode(code),
    })
  })

  /**
   * "Spot duplicate items": before a new product goes in, ask Jev whether the shop already sells
   * it under another name ("Coca-Cola Original 330ml" and "Coke 33cl"). Candidates are narrowed
   * by shared words first, so Jev only compares likely ones.
   */
  .post('/catalog/similar', requireApiKey, async (c) => {
    const parsed = z
      .object({ name: z.string().trim().min(1).max(120) })
      .safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) throw new KovaError('invalid_request', 'Expected { name }')
    const words = (text: string) =>
      new Set(
        text
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length > 1),
      )
    const wanted = words(parsed.data.name)
    const rows = await db.query.catalogItems.findMany({
      where: and(
        eq(schema.catalogItems.merchantId, c.get('merchant').id),
        isNull(schema.catalogItems.archivedAt),
      ),
    })
    const candidates = rows
      .map((r) => ({ r, shared: [...words(r.name)].filter((w) => wanted.has(w)).length }))
      .filter((x) => x.shared > 0)
      .sort((a, b) => b.shared - a.shared)
      .slice(0, 40)
      .map((x) => x.r)
    if (candidates.length === 0) return c.json({ object: 'similar', item: null })
    const answers = await askJev(
      { new_product: parsed.data.name },
      {
        same: {
          type: 'choice',
          instructions:
            'Is `new_product` the same product (same brand, kind and size) as one of these the shop already sells? If it is a different product, choose none.',
          criteria: {
            none: 'None of these: it is a different product',
            ...Object.fromEntries(candidates.map((r) => [encodeId('catalogItem', r.id), r.name])),
          },
        },
      },
    )
    const choice = answers?.same?.choice
    const match =
      choice && choice !== 'none' && (answers?.same?.confidence ?? 0) >= 0.6
        ? candidates.find((r) => encodeId('catalogItem', r.id) === choice)
        : undefined
    return c.json({
      object: 'similar',
      item: match ? serializeItem(match, publicOrigin(c)) : null,
      confidence: answers?.same?.confidence ?? null,
    })
  })

  /** Upload a photo (raw JPEG, PNG or WebP bytes). Returns its id for an item or a stall cover. */
  .post('/images', requireApiKey, requireMerchantKey, async (c) => {
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    if (bytes.length === 0)
      throw new KovaError('invalid_request', 'Send the image bytes as the request body')
    if (bytes.length > MAX_IMAGE_BYTES)
      throw new KovaError('invalid_request', 'Images up to 1.5 MB. Resize it first.')
    const contentType = sniffImage(bytes)
    if (!contentType) throw new KovaError('invalid_request', 'Send a JPEG, PNG or WebP image')
    const id = uuidv7()
    await db.insert(schema.images).values({
      id,
      merchantId: c.get('merchant').id,
      contentType,
      bytes: Buffer.from(bytes),
      size: bytes.length,
    })
    return c.json(
      {
        object: 'image',
        id: encodeId('image', id),
        url: imageUrl(publicOrigin(c), id),
        size: bytes.length,
      },
      201,
    )
  })

  /** Snap your menu: a photo in, suggested items out. Nothing is saved until the seller confirms. */
  .post('/catalog/import', requireApiKey, requireMerchantKey, async (c) => {
    if (!menuImportReady())
      throw new KovaError('invalid_request', 'Menu import is not set up on this server yet.')
    const parsed = importBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success)
      throw new KovaError('invalid_request', 'Expected { image: base64, media_type }')
    if (!allowRead(c.get('merchant').id))
      throw new KovaError('rate_limited', 'That’s a lot of menus for one hour. Try again later.')
    const result = await readMenu({ data: parsed.data.image, mediaType: parsed.data.media_type })
    return c.json({ object: 'menu', ...result })
  })

  /** Public: an uploaded photo. Ids never change their bytes, so browsers keep them for a year. */
  .get('/public/images/:id', async (c) => {
    const uuid = decodeId('image', c.req.param('id'))
    const image = uuid
      ? await db.query.images.findFirst({ where: eq(schema.images.id, uuid) })
      : undefined
    if (!image) throw notFound('image', c.req.param('id'))
    return new Response(new Uint8Array(image.bytes), {
      headers: {
        'content-type': image.contentType,
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      },
    })
  })
