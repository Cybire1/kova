import { timingSafeEqual } from 'node:crypto'
import { schema, uuidv7 } from '@kova/db'
import { asc, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { config } from '../config.js'
import { db } from '../db.js'
import { KovaError } from '../errors.js'
import { clientIp, limit } from '../limits.js'

/**
 * Kova for iPhone, while it's in TestFlight: people ask for the beta with their email, and Kova's
 * team adds them as testers. Kova keeps the email (and a name and country when given) only to send
 * that invite.
 *
 *   POST /public/ios-beta      ask for the beta: { email, name?, country?, source? }
 *   GET  /ios-beta.csv         everyone who asked, oldest first (x-kova-admin)
 *   POST /ios-beta/invited     marks emails as invited: { emails } (x-kova-admin)
 */

export const IOS_BETA_SOURCES = ['iphone-page', 'home', 'try', 'wallet'] as const

const email = z.string().trim().toLowerCase().email().max(200)
const joinBody = z.object({
  email,
  name: z.string().trim().max(80).optional(),
  country: z.string().trim().max(56).optional(),
  source: z.enum(IOS_BETA_SOURCES).optional(),
})
const invitedBody = z.object({ emails: z.array(email).min(1).max(1000) })

async function body<T>(
  c: { req: { json: () => Promise<unknown> } },
  shape: z.ZodType<T>,
  message: string,
): Promise<T> {
  const parsed = shape.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) throw new KovaError('invalid_request', message)
  return parsed.data
}

/** Kova's team only. Without KOVA_ADMIN_SECRET, or with the wrong one, these routes aren't there. */
function admin(c: { req: { header: (name: string) => string | undefined } }) {
  const secret = config.KOVA_ADMIN_SECRET
  const given = c.req.header('x-kova-admin')
  if (!secret || !given) throw new KovaError('not_found', 'No such endpoint')
  const a = Buffer.from(given)
  const b = Buffer.from(secret)
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new KovaError('not_found', 'No such endpoint')
}

const csvCell = (value: string | null) => {
  const text = value ?? ''
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export const iosBetaRoutes = new Hono()
  .post('/public/ios-beta', async (c) => {
    const input = await body(c, joinBody, 'Enter an email address, like you@example.com.')
    limit(
      `ios-beta-ip:${clientIp(c)}`,
      10,
      3_600_000,
      'That’s a lot of sign-ups from here. Try again in a while.',
    )
    const name = input.name || null
    const country = input.country || null
    const existing = await db.query.iosBetaRequests.findFirst({
      where: eq(schema.iosBetaRequests.email, input.email),
    })
    if (existing) {
      // A second sign-up fills in what the first left out, and changes nothing else.
      if ((name && !existing.name) || (country && !existing.country))
        await db
          .update(schema.iosBetaRequests)
          .set({ name: existing.name ?? name, country: existing.country ?? country })
          .where(eq(schema.iosBetaRequests.id, existing.id))
      return c.json({
        object: 'ios_beta_request',
        status: 'already',
        invited: existing.invitedAt !== null,
      })
    }
    const inserted = await db
      .insert(schema.iosBetaRequests)
      .values({
        id: uuidv7(),
        email: input.email,
        name,
        country,
        source: input.source ?? 'iphone-page',
      })
      .onConflictDoNothing()
      .returning({ id: schema.iosBetaRequests.id })
    return c.json({
      object: 'ios_beta_request',
      status: inserted.length ? 'joined' : 'already',
      invited: false,
    })
  })
  .get('/ios-beta.csv', async (c) => {
    admin(c)
    const rows = await db.query.iosBetaRequests.findMany({
      orderBy: asc(schema.iosBetaRequests.createdAt),
    })
    const lines = [
      'email,name,country,source,created_at,invited_at',
      ...rows.map((r) =>
        [
          r.email,
          r.name,
          r.country,
          r.source,
          r.createdAt.toISOString(),
          r.invitedAt?.toISOString() ?? null,
        ]
          .map(csvCell)
          .join(','),
      ),
    ]
    return c.body(`${lines.join('\n')}\n`, 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="kova-ios-beta.csv"',
      'cache-control': 'no-store',
    })
  })
  .post('/ios-beta/invited', async (c) => {
    admin(c)
    const input = await body(c, invitedBody, 'Expected { emails: [...] }.')
    const marked = await db
      .update(schema.iosBetaRequests)
      .set({ invitedAt: new Date() })
      .where(inArray(schema.iosBetaRequests.email, input.emails))
      .returning({ email: schema.iosBetaRequests.email })
    return c.json({ object: 'ios_beta_invited', marked: marked.length })
  })
