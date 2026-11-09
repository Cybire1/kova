import { timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'
import { KovaError } from '../errors.js'

/**
 * Kova's team only: the x-kova-admin header must carry KOVA_ADMIN_SECRET. Without the secret set,
 * or with the wrong one, these routes answer as if they weren't there (404).
 */
export function requireAdmin(c: { req: { header: (name: string) => string | undefined } }) {
  const secret = config.KOVA_ADMIN_SECRET
  const given = c.req.header('x-kova-admin')
  if (!secret || !given) throw new KovaError('not_found', 'No such endpoint')
  const a = Buffer.from(given)
  const b = Buffer.from(secret)
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new KovaError('not_found', 'No such endpoint')
}
