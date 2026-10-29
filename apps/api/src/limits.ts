import { timingSafeEqual } from 'node:crypto'
import { config } from './config.js'
import { KovaError } from './errors.js'

/**
 * Per-process speed bumps for public routes: a few hundred requests a minute from one place is a
 * script, not a person. Counts live in memory, so a restart forgets them; that is fine for a
 * bump, and nothing that protects money depends on it.
 */
const hits = new Map<string, number[]>()

export function limit(key: string, max: number, windowMs: number, message: string) {
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
  if (recent.length >= max) throw new KovaError('rate_limited', message)
  hits.set(key, [...recent, now])
}

const proxySecret = config.KOVA_PROXY_SECRET ? Buffer.from(config.KOVA_PROXY_SECRET) : null

/**
 * Who is asking. Kova's own website calls on its visitors' behalf from one address, so it passes
 * each visitor's on, with a secret only it and the API share. Without that secret, the claim is
 * ignored and the caller is whoever connected.
 */
export function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  const vouched = c.req.header('x-kova-client-ip')
  const secret = c.req.header('x-kova-proxy-secret')
  if (vouched && secret && proxySecret) {
    const given = Buffer.from(secret)
    if (given.length === proxySecret.length && timingSafeEqual(given, proxySecret)) return vouched
  }
  // Railway's edge sets X-Real-IP to the connecting address and overwrites any copy a caller sends;
  // the first X-Forwarded-For entry is only a fallback (off Railway, in development).
  return (
    c.req.header('x-real-ip')?.trim() ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    'local'
  )
}
