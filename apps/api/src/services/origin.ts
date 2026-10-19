import type { Context } from 'hono'

/** This API's public origin as the caller reached it, for links it hands out (image urls). */
export function publicOrigin(c: Context) {
  const url = new URL(c.req.url)
  const proto =
    c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() ?? url.protocol.replace(':', '')
  const host = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? url.host
  return `${proto}://${host}`
}
