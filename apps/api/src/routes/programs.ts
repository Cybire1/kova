import { parseAmount } from '@kova/monad'
import { Hono } from 'hono'
import { type Address, getAddress, isAddress, isHex } from 'viem'
import { z } from 'zod'
import { requireApiKey, requireMerchantKey } from '../auth.js'
import { KovaError } from '../errors.js'
import {
  listRepeats,
  prepareRepeat,
  prepareSplits,
  prepareStopRepeat,
  type RepeatInput,
  saveSplits,
  shopSplits,
  startRepeat,
  stopRepeat,
} from '../services/programs.js'

/**
 * Programmable payments (services/programs.ts).
 *
 * A shop's splits, with its key (the wallet the shop is paid into signs them):
 *   GET  /splits                 the shares, its splitter, whether splits are on
 *   POST /splits/prepare         { shares } → what to sign
 *   POST /splits                 { shares, deadline, signature } → saved on Monad
 * A wallet's repeat payments (public, like keys: the signatures are the proof):
 *   GET  /wallets/:address/repeats                       paying and getting
 *   POST /wallets/:address/repeats/prepare               the plan → what to sign
 *   POST /wallets/:address/repeats                       the plan, its signature and permit → started
 *   POST /wallets/:address/repeats/:id/stop/prepare      → what to sign
 *   POST /wallets/:address/repeats/:id/stop              { deadline, signature } → stopped
 */

const hex = z.string().refine((v) => isHex(v), 'Expected hex')
const addr = z.string().refine((v) => isAddress(v), 'Expected an address')
const money = z.string().regex(/^\d{1,5}(\.\d{1,2})?$/, 'Expected dollars, like 50 or 12.50')

const bodyOf = async <T extends z.ZodTypeAny>(
  c: { req: { json: () => Promise<unknown> } },
  shape: T,
): Promise<z.infer<T>> => {
  const parsed = shape.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success)
    throw new KovaError(
      'invalid_request',
      parsed.error.issues[0]?.message ?? 'Invalid request body',
      {
        issues: parsed.error.issues,
      },
    )
  return parsed.data
}

function wallet(value: string): Address {
  if (!isAddress(value)) throw new KovaError('invalid_request', 'That isn’t a wallet address.')
  return getAddress(value)
}

const shares = z
  .array(
    z.object({
      to: addr,
      bps: z.number().int().min(1).max(10_000),
      name: z.string().max(40).optional(),
    }),
  )
  .max(5)

const toShares = (list: z.infer<typeof shares>) =>
  list.map((s) => ({ to: getAddress(s.to), bps: s.bps, name: s.name }))

const plan = z.object({
  payee: addr,
  amount: money,
  every: z.number().int(),
  start: z.number().int(),
  times: z.number().int(),
  label: z.string().max(40).optional(),
})

const toPlan = (p: z.infer<typeof plan>): RepeatInput => ({
  payee: getAddress(p.payee),
  amount: parseAmount(p.amount),
  every: p.every,
  start: p.start,
  times: p.times,
  label: p.label,
})

export const programRoutes = new Hono()
  .get('/splits', requireApiKey, requireMerchantKey, async (c) =>
    c.json(await shopSplits(c.get('merchant'))),
  )
  .post('/splits/prepare', requireApiKey, requireMerchantKey, async (c) => {
    const body = await bodyOf(c, z.object({ shares }))
    return c.json(await prepareSplits(c.get('merchant'), toShares(body.shares)))
  })
  .post('/splits', requireApiKey, requireMerchantKey, async (c) => {
    const body = await bodyOf(
      c,
      z.object({ shares, deadline: z.string().regex(/^\d+$/), signature: hex }),
    )
    return c.json(
      await saveSplits(
        c.get('merchant'),
        toShares(body.shares),
        body.deadline,
        body.signature as `0x${string}`,
      ),
    )
  })

  .get('/wallets/:address/repeats', async (c) =>
    c.json({ object: 'list', data: await listRepeats(wallet(c.req.param('address'))) }),
  )
  .post('/wallets/:address/repeats/prepare', async (c) => {
    const body = await bodyOf(c, plan)
    return c.json(await prepareRepeat(wallet(c.req.param('address')), toPlan(body)))
  })
  .post('/wallets/:address/repeats', async (c) => {
    const body = await bodyOf(
      c,
      plan.extend({
        deadline: z.string().regex(/^\d+$/),
        signature: hex,
        permit: z.object({ deadline: z.string().regex(/^\d+$/), signature: hex }),
      }),
    )
    return c.json(
      await startRepeat(
        wallet(c.req.param('address')),
        toPlan(body),
        body.deadline,
        body.signature as `0x${string}`,
        { deadline: body.permit.deadline, signature: body.permit.signature as `0x${string}` },
      ),
      201,
    )
  })
  .post('/wallets/:address/repeats/:id/stop/prepare', async (c) =>
    c.json(await prepareStopRepeat(wallet(c.req.param('address')), c.req.param('id'))),
  )
  .post('/wallets/:address/repeats/:id/stop', async (c) => {
    const body = await bodyOf(c, z.object({ deadline: z.string().regex(/^\d+$/), signature: hex }))
    return c.json(
      await stopRepeat(
        wallet(c.req.param('address')),
        c.req.param('id'),
        body.deadline,
        body.signature as `0x${string}`,
      ),
    )
  })
