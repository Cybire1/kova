import { Hono } from 'hono'
import { z } from 'zod'
import { KovaError } from '../errors.js'
import { clientIp, limit } from '../limits.js'
import { checkDemoLogin, demoReady, demoSignIn } from '../services/demo.js'

/**
 * POST /demo/sign_in: the App Review demo account's username and password, for the wallet's
 * secret. Testnet only, and only where KOVA_DEMO_* are set; a wrong guess is slow to repeat.
 */
export const demoRoutes = new Hono().post('/demo/sign_in', async (c) => {
  if (!demoReady()) throw new KovaError('not_found', 'There’s no demo account on this server.')
  limit(
    `demo-ip:${clientIp(c)}`,
    20,
    3_600_000,
    'That’s a lot of tries. Wait a while and try again.',
  )
  const parsed = z
    .object({ username: z.string().max(100), password: z.string().max(200) })
    .safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) throw new KovaError('invalid_request', 'Enter the username and password.')
  if (!checkDemoLogin(parsed.data.username, parsed.data.password))
    throw new KovaError('unauthorized', 'That username and password don’t match.')
  return c.json(await demoSignIn())
})
