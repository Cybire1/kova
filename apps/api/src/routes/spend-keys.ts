import { parseAmount } from '@kova/monad'
import { Hono } from 'hono'
import { type Address, getAddress, type Hex, isAddress, isHex } from 'viem'
import { z } from 'zod'
import { network, settlementToken } from '../chain.js'
import { KovaError } from '../errors.js'
import { clientIp, limit } from '../limits.js'
import { cardContract } from '../services/cards.js'
import {
  acceptInvite,
  activateKey,
  agentForToken,
  agentPay,
  agentPayCharge,
  agentsReady,
  answerApproval,
  approvalMessageFor,
  approvalsFor,
  chargeIdFrom,
  completePayment,
  createAgent,
  createInvite,
  describeAgent,
  inviteFor,
  keyRow,
  keysOf,
  keysReady,
  linkPlan,
  ownedKey,
  paymentRow,
  paymentsOf,
  preparePayment,
  removeKey,
  removePlan,
  serializeKey,
  serializePayment,
  setFrozen,
  updatePlan,
} from '../services/spend-keys.js'

/**
 * Spending keys: allowances, team budgets and AI agents (services/spend-keys.ts).
 *
 * The owner's side is public, like every wallet route: nothing moves without a signature from the
 * owner's wallet, and the KovaCard contract checks it again.
 *   GET  /keys/config
 *   GET  /wallets/:address/keys?kind=      keys the wallet gave (data), and was given (received)
 *   POST /wallets/:address/key-invites     an allowance or team budget: returns the invite link
 *   POST /wallets/:address/agents          an AI agent's key (switched on with /activate)
 *   GET  /wallets/:address/keys/:id/link   what the owner signs to switch a key on
 *   POST /wallets/:address/keys/:id/activate
 *   GET  /wallets/:address/keys/:id/freeze?frozen=true   what to sign
 *   POST /wallets/:address/keys/:id/freeze
 *   GET  /wallets/:address/keys/:id/remove what to sign
 *   POST /wallets/:address/keys/:id/remove
 *   GET  /wallets/:address/key-payments    every payment the wallet's keys made or were refused
 *   GET  /wallets/:address/approvals       agents' payments waiting for a yes
 *   POST /wallets/:address/approvals/:id   yes or no, signed
 * The recipient's side:
 *   GET  /key-invites/:code
 *   POST /key-invites/:code/accept         the key made on their device, and its Claim signature
 *   POST /keys/:id/payments                prepare a payment from an allowance or budget
 *   POST /key-payments/:id/complete        the key's signature: Kova cosigns and pays
 * An agent's side takes its Bearer token (and /mcp does the same over MCP):
 *   GET  /agent/status   POST /agent/pay   POST /agent/pay_charge   GET /agent/payments/:id   GET /agent/history
 */

const hex = z.string().refine((v) => isHex(v), 'Expected hex')
const addr = z.string().refine((v) => isAddress(v), 'Expected an address')
const money = z.string().regex(/^\d{1,7}(\.\d{1,6})?$/, 'Expected dollars, like 30 or 12.50')

const bodyOf = async <T extends z.ZodTypeAny>(
  c: { req: { json: () => Promise<unknown> } },
  shape: T,
): Promise<z.infer<T>> => {
  const parsed = shape.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success)
    throw new KovaError('invalid_request', 'Invalid request body', { issues: parsed.error.issues })
  return parsed.data
}

function wallet(value: string): Address {
  if (!isAddress(value)) throw new KovaError('invalid_request', 'That isn’t a wallet address.')
  return getAddress(value)
}

const inviteBody = z.object({
  kind: z.enum(['allowance', 'team']),
  name: z.string().min(1).max(40),
  limit: money,
  period: z.enum(['day', 'week']),
  days: z.coerce.number().int().min(1).max(366),
  owner_name: z.string().max(40).optional(),
})

const agentBody = z.object({
  name: z.string().min(1).max(40),
  limit: money,
  period: z.enum(['day', 'week']),
  per_payment: money,
  ask_above: money,
  payees: z.union([z.literal('anyone'), z.array(addr).min(1).max(20)]),
  days: z.coerce.number().int().min(1).max(366),
  owner_name: z.string().max(40).optional(),
})

const permitBody = z
  .object({
    value: z.string().regex(/^\d+$/),
    deadline: z.coerce.number().int().positive(),
    signature: hex,
  })
  .nullable()

const agentFrom = (c: { req: { header: (name: string) => string | undefined } }) => {
  const header = c.req.header('authorization') ?? ''
  return agentForToken(header.startsWith('Bearer ') ? header.slice(7).trim() : undefined)
}

export const spendKeyRoutes = new Hono()
  .get('/keys/config', (c) =>
    c.json({
      object: 'keys_config',
      ready: keysReady(),
      agents_ready: agentsReady(),
      contract: cardContract,
      chain_id: network.chainId,
      token: {
        address: settlementToken.address,
        symbol: settlementToken.symbol,
        domain: settlementToken.domain,
      },
    }),
  )
  .get('/wallets/:address/keys', async (c) => {
    const address = wallet(c.req.param('address'))
    const kind = c.req.query('kind')
    const { given, received } = await keysOf(address)
    const mine = kind ? given.filter((k) => k.kind === kind) : given
    const [data, theirs, approvals] = await Promise.all([
      Promise.all(mine.map((k) => serializeKey(k))),
      Promise.all(received.map((k) => serializeKey(k, { chain: true }))),
      approvalsFor(address),
    ])
    return c.json({
      object: 'list',
      data,
      received: theirs,
      approvals: approvals.map(({ payment, key }) => ({
        ...serializePayment(payment, key),
        approve_message: approvalMessageFor(address, payment, 'approve'),
        decline_message: approvalMessageFor(address, payment, 'decline'),
      })),
    })
  })
  .post('/wallets/:address/key-invites', async (c) => {
    const owner = wallet(c.req.param('address'))
    const body = await bodyOf(c, inviteBody)
    limit(
      `key-invite:${owner.toLowerCase()}`,
      20,
      3_600_000,
      'That’s a lot of invites in an hour. Try again later.',
    )
    limit(
      `key-invite-ip:${clientIp(c)}`,
      60,
      3_600_000,
      'That’s a lot of invites from here. Try again later.',
    )
    const { row, code } = await createInvite(owner, {
      kind: body.kind,
      label: body.name,
      limit: parseAmount(body.limit),
      period: body.period,
      days: body.days,
      ownerName: body.owner_name,
    })
    return c.json({ ...(await serializeKey(row)), code, path: `/a/${code}` }, 201)
  })
  .post('/wallets/:address/agents', async (c) => {
    const owner = wallet(c.req.param('address'))
    const body = await bodyOf(c, agentBody)
    limit(
      `key-agent:${owner.toLowerCase()}`,
      20,
      3_600_000,
      'That’s a lot of agent keys in an hour. Try again later.',
    )
    const row = await createAgent(owner, {
      label: body.name,
      limit: parseAmount(body.limit),
      period: body.period,
      perPayment: parseAmount(body.per_payment),
      approveAbove: parseAmount(body.ask_above),
      payees: body.payees === 'anyone' ? 'anyone' : body.payees.map((p) => getAddress(p)),
      days: body.days,
      ownerName: body.owner_name,
    })
    return c.json({ ...(await serializeKey(row)), link: await linkPlan(row) }, 201)
  })
  .get('/wallets/:address/keys/:id/link', async (c) => {
    const row = await ownedKey(wallet(c.req.param('address')), c.req.param('id'))
    return c.json(await linkPlan(row))
  })
  .post('/wallets/:address/keys/:id/activate', async (c) => {
    const row = await ownedKey(wallet(c.req.param('address')), c.req.param('id'))
    const body = await bodyOf(c, z.object({ holder_signature: hex, permit: permitBody }))
    const { row: updated, token } = await activateKey(row, {
      holderSignature: body.holder_signature as Hex,
      permit: body.permit
        ? {
            value: BigInt(body.permit.value),
            deadline: BigInt(body.permit.deadline),
            signature: body.permit.signature as Hex,
          }
        : null,
    })
    return c.json({ ...(await serializeKey(updated, { chain: true })), token })
  })
  .get('/wallets/:address/keys/:id/freeze', async (c) => {
    const row = await ownedKey(wallet(c.req.param('address')), c.req.param('id'))
    return c.json(await updatePlan(row, c.req.query('frozen') !== 'false'))
  })
  .post('/wallets/:address/keys/:id/freeze', async (c) => {
    const row = await ownedKey(wallet(c.req.param('address')), c.req.param('id'))
    const body = await bodyOf(
      c,
      z.object({
        frozen: z.boolean(),
        deadline: z.coerce.number().int().positive(),
        holder_signature: hex,
      }),
    )
    const updated = await setFrozen(row, {
      frozen: body.frozen,
      deadline: BigInt(body.deadline),
      holderSignature: body.holder_signature as Hex,
    })
    return c.json(await serializeKey(updated, { chain: true }))
  })
  .get('/wallets/:address/keys/:id/remove', async (c) => {
    const row = await ownedKey(wallet(c.req.param('address')), c.req.param('id'))
    return c.json(await removePlan(row))
  })
  .post('/wallets/:address/keys/:id/remove', async (c) => {
    const row = await ownedKey(wallet(c.req.param('address')), c.req.param('id'))
    const body = await bodyOf(
      c,
      z.object({ deadline: z.coerce.number().int().positive().optional(), signature: hex }),
    )
    const updated = await removeKey(row, {
      deadline: body.deadline ? BigInt(body.deadline) : undefined,
      signature: body.signature as Hex,
    })
    return c.json(await serializeKey(updated))
  })
  .get('/wallets/:address/key-payments', async (c) => {
    const address = wallet(c.req.param('address'))
    const { given, received } = await keysOf(address)
    const keys = [...given, ...received]
    const rows = await paymentsOf(
      keys.map((k) => k.id),
      50,
    )
    return c.json({
      object: 'list',
      data: rows.map((p) =>
        serializePayment(
          p,
          keys.find((k) => k.id === p.walletKeyId),
        ),
      ),
    })
  })
  .get('/wallets/:address/approvals', async (c) => {
    const address = wallet(c.req.param('address'))
    const waiting = await approvalsFor(address)
    return c.json({
      object: 'list',
      data: waiting.map(({ payment, key }) => ({
        ...serializePayment(payment, key),
        approve_message: approvalMessageFor(address, payment, 'approve'),
        decline_message: approvalMessageFor(address, payment, 'decline'),
      })),
    })
  })
  .post('/wallets/:address/approvals/:id', async (c) => {
    const owner = wallet(c.req.param('address'))
    const body = await bodyOf(
      c,
      z.object({ decision: z.enum(['approve', 'decline']), signature: hex }),
    )
    const payment = await answerApproval({
      owner,
      paymentId: c.req.param('id'),
      decision: body.decision,
      signature: body.signature as Hex,
    })
    return c.json(serializePayment(payment))
  })
  .get('/key-invites/:code', async (c) => c.json(await inviteFor(c.req.param('code'))))
  .post('/key-invites/:code/accept', async (c) => {
    const body = await bodyOf(
      c,
      z.object({
        holder: addr,
        holder_name: z.string().max(40).optional(),
        key: addr,
        claim_signature: hex,
        claim_deadline: z.coerce.number().int().positive(),
      }),
    )
    limit(
      `key-accept-ip:${clientIp(c)}`,
      30,
      3_600_000,
      'Too many tries from here. Try again later.',
    )
    const row = await acceptInvite(c.req.param('code'), {
      holder: getAddress(body.holder),
      holderName: body.holder_name,
      key: getAddress(body.key),
      claimSignature: body.claim_signature as Hex,
      claimDeadline: BigInt(body.claim_deadline),
    })
    return c.json(await serializeKey(row))
  })
  .post('/keys/:id/payments', async (c) => {
    const row = await keyRow(c.req.param('id'))
    if (!row) throw new KovaError('not_found', 'No such key.')
    const body = await bodyOf(
      c,
      z.object({
        holder: addr,
        to: addr.optional(),
        amount: money.optional(),
        charge: z.string().max(400).optional(),
        note: z.string().max(200).optional(),
      }),
    )
    limit(`key-pay:${row.id}`, 30, 60_000, 'Too many payments this minute.')
    const charge = body.charge ? chargeIdFrom(body.charge) : null
    if (body.charge && !charge)
      throw new KovaError('invalid_request', 'That isn’t a Kova charge or pay link.')
    const { payment, typedData } = await preparePayment(row, {
      holder: getAddress(body.holder),
      to: body.to ? getAddress(body.to) : undefined,
      amount: body.amount ? parseAmount(body.amount) : undefined,
      charge: charge ?? undefined,
      note: body.note,
    })
    return c.json(
      {
        ...serializePayment(payment, row),
        // What the key signs: KovaCard's Payment, bigints as strings.
        typed_data: JSON.parse(
          JSON.stringify(typedData, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
        ),
      },
      201,
    )
  })
  .post('/key-payments/:id/complete', async (c) => {
    const payment = await paymentRow(c.req.param('id'))
    if (!payment) throw new KovaError('not_found', 'No such payment.')
    const body = await bodyOf(c, z.object({ signature: hex }))
    const done = await completePayment(payment, body.signature as Hex)
    if (done.status !== 'paid')
      throw new KovaError('policy_declined', done.reason ?? 'It didn’t go through. No money moved.')
    return c.json(serializePayment(done))
  })
  // ── An agent's own endpoints ─────────────────────────────────────────────────────────────
  .get('/agent/status', async (c) => c.json(await describeAgent(await agentFrom(c))))
  .post('/agent/pay', async (c) => {
    const key = await agentFrom(c)
    const body = await bodyOf(
      c,
      z.object({ to: addr, amount: money, note: z.string().max(200).optional() }),
    )
    limit(`agent-pay:${key.id}`, 60, 60_000, 'Too many payments this minute.')
    return c.json(
      serializePayment(
        await agentPay(key, {
          to: getAddress(body.to),
          amount: parseAmount(body.amount),
          note: body.note,
        }),
        key,
      ),
    )
  })
  .post('/agent/pay_charge', async (c) => {
    const key = await agentFrom(c)
    const body = await bodyOf(c, z.object({ charge: z.string().max(400) }))
    const id = chargeIdFrom(body.charge)
    if (!id) throw new KovaError('invalid_request', 'That isn’t a Kova charge or pay link.')
    limit(`agent-pay:${key.id}`, 60, 60_000, 'Too many payments this minute.')
    return c.json(serializePayment(await agentPayCharge(key, id), key))
  })
  .get('/agent/payments/:id', async (c) => {
    const key = await agentFrom(c)
    const payment = await paymentRow(c.req.param('id'))
    if (!payment || payment.walletKeyId !== key.id)
      throw new KovaError('not_found', 'No such payment for this key.')
    return c.json(serializePayment(payment, key))
  })
  .get('/agent/history', async (c) => {
    const key = await agentFrom(c)
    const rows = await paymentsOf([key.id], 20)
    return c.json({ object: 'list', data: rows.map((p) => serializePayment(p, key)) })
  })
