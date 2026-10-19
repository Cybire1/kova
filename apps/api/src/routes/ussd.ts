import { normalizePhone, parseAmount, pinProblem, pocketPinCommitment } from '@kova/monad'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { type Address, getAddress, type Hex, isAddress } from 'viem'
import { z } from 'zod'
import { network } from '../chain.js'
import { config } from '../config.js'
import { KovaError } from '../errors.js'
import { clientIp, limit } from '../limits.js'
import {
  checkOwner,
  closePocket,
  confirmPhone,
  pocketBalance,
  pocketOf,
  pocketsReady,
  reconcilePocket,
  requirePocketSetup,
  requirePockets,
  serializePocket,
  setUpPocket,
  spend,
  updatePocket,
} from '../services/pockets.js'
import { ussdReply } from '../services/ussd.js'
import { callbackForm, callbackSecretMatches } from '../services/ussd-callback.js'

/**
 * Paying by USSD.
 *
 * - POST /ussd/:secret is Africa's Talking's callback: one call per step of a USSD session.
 * - GET /wallets/:address/ussd-pocket shows a wallet's pocket.
 * - PUT sets it up (phone, PIN, cap) and texts a code to the phone; POST …/verify takes the code.
 * - PATCH changes the cap or the PIN; POST …/withdraw takes money back to the wallet; DELETE
 *   empties the pocket into the wallet and turns USSD off.
 *
 * Every change is signed by the wallet with its passkey (see pocketMessage in @kova/monad).
 */

const signature = z.string().regex(/^0x[0-9a-fA-F]{130}$/)
const dollars = z.string().regex(/^\d{1,6}(\.\d{1,6})?$/)

const setupBody = z.object({
  phone: z.string(),
  pin: z.string(),
  pin_nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  cap: dollars,
  signed_at: z.number().int(),
  signature,
})
const updateBody = z.object({
  cap: dollars.optional(),
  pin: z.string().optional(),
  pin_nonce: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
  signed_at: z.number().int(),
  signature,
})
const withdrawBody = z.object({ amount: dollars, signed_at: z.number().int(), signature })
const closeBody = z.object({ signed_at: z.number().int(), signature })

function wallet(c: { req: { param: (name: string) => string } }): Address {
  const address = c.req.param('address')
  if (!isAddress(address)) throw new KovaError('invalid_request', 'Not a Monad address.')
  return getAddress(address)
}

async function body<T>(
  c: { req: { json: () => Promise<unknown> } },
  shape: z.ZodType<T>,
  expected: string,
): Promise<T> {
  const parsed = shape.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) throw new KovaError('invalid_request', `Expected ${expected}.`)
  return parsed.data
}

export const ussdRoutes = new Hono()
  .get('/ussd/info', (c) =>
    c.json({
      object: 'ussd_info',
      enabled: pocketsReady(),
      network: config.KOVA_NETWORK,
      mode: config.AT_USERNAME === 'sandbox' ? 'sandbox' : 'live',
      recovery: Boolean(config.KOVA_POCKET_MASTER_KEY),
      dial: pocketsReady() ? config.KOVA_USSD_CODE : null,
    }),
  )
  .post(
    '/ussd/:secret',
    bodyLimit({
      maxSize: 2048,
      onError: (c) => c.text('END Request too large.', 413),
    }),
    async (c) => {
      if (!callbackSecretMatches(c.req.param('secret'), config.KOVA_USSD_CALLBACK_SECRET))
        return c.text('END Not found.', 404)
      try {
        const input = callbackForm.safeParse(await c.req.parseBody())
        if (!input.success) return c.text('END Invalid request. Dial again.', 400)
        if (input.data.serviceCode !== config.KOVA_USSD_CODE) return c.text('END Not found.', 404)
        limit(
          `ussd-phone:${input.data.phoneNumber}`,
          40,
          60_000,
          'Too many requests. Wait a minute before dialling again.',
        )
        return c.text(await ussdReply(input.data))
      } catch (error) {
        console.error('[ussd]', error instanceof Error ? error.message : error)
        if (error instanceof KovaError && error.code === 'rate_limited')
          return c.text(`END ${error.message}`)
        // A timeout can happen after broadcast. Never tell someone it is safe to pay again.
        return c.text(
          'END We couldn’t confirm the request. Check your Kova payments before trying again.',
        )
      }
    },
  )
  .get('/wallets/:address/ussd-pocket', async (c) => {
    requirePockets()
    const pocket = await pocketOf(wallet(c))
    if (!pocket || pocket.status === 'closed')
      return c.json({ object: 'ussd_pocket', status: 'none', dial: config.KOVA_USSD_CODE })
    return c.json(await serializePocket(pocket))
  })
  .put('/wallets/:address/ussd-pocket', async (c) => {
    requirePocketSetup()
    const owner = wallet(c)
    const input = await body(c, setupBody, '{ phone, pin, cap, signed_at, signature }')
    const phone = normalizePhone(input.phone)
    if (!phone)
      throw new KovaError(
        'invalid_request',
        'Enter the number with its country code, like +234 801 234 5678.',
      )
    const problem = pinProblem(input.pin)
    if (problem) throw new KovaError('invalid_request', problem)
    const cap = parseAmount(input.cap)
    limit(
      `pocket-ip:${clientIp(c)}`,
      30,
      3_600_000,
      'That’s a lot of changes from here. Try again later.',
    )
    await checkOwner(
      await pocketOf(owner),
      {
        action: 'setup',
        wallet: owner,
        chainId: network.chainId,
        phone,
        cap,
        signedAt: input.signed_at,
        pinCommitment: pocketPinCommitment(
          owner,
          network.chainId,
          input.pin,
          input.pin_nonce as Hex,
        ),
      },
      input.signature as Hex,
    )
    // Counted only once the owner's signature checks out, so nobody else can use up these limits.
    limit(
      `pocket-phone:${phone}`,
      3,
      600_000,
      'Wait a few minutes before requesting another code for this number.',
    )
    limit(
      `pocket:${owner.toLowerCase()}`,
      10,
      3_600_000,
      'That’s a lot of changes in an hour. Try again later.',
    )
    const pocket = await setUpPocket({
      owner,
      phone,
      pin: input.pin,
      cap,
      signedAt: input.signed_at,
    })
    return c.json(await serializePocket(pocket))
  })
  .post('/wallets/:address/ussd-pocket/verify', async (c) => {
    requirePocketSetup()
    const owner = wallet(c)
    const { code } = await body(
      c,
      z.object({ code: z.string().regex(/^\d{6}$/) }),
      '{ code } (6 digits)',
    )
    limit(`pocket-code:${owner.toLowerCase()}`, 10, 600_000, 'Too many tries. Wait a few minutes.')
    return c.json(await serializePocket(await confirmPhone(owner, code)))
  })
  .patch('/wallets/:address/ussd-pocket', async (c) => {
    requirePockets()
    const owner = wallet(c)
    const input = await body(c, updateBody, '{ cap?, pin?, signed_at, signature }')
    const pocket = await pocketOf(owner)
    if (!pocket || pocket.status === 'closed')
      throw new KovaError('not_found', 'This wallet has no USSD pocket.')
    if (input.pin !== undefined) {
      const problem = pinProblem(input.pin)
      if (problem) throw new KovaError('invalid_request', problem)
      if (!input.pin_nonce)
        throw new KovaError('invalid_request', 'Approve this PIN change again in Kova.')
    }
    const cap = input.cap === undefined ? undefined : parseAmount(input.cap)
    await checkOwner(
      pocket,
      {
        action: 'update',
        wallet: owner,
        chainId: network.chainId,
        cap,
        signedAt: input.signed_at,
        ...(input.pin !== undefined
          ? {
              pinCommitment: pocketPinCommitment(
                owner,
                network.chainId,
                input.pin,
                input.pin_nonce as Hex,
              ),
            }
          : {}),
      },
      input.signature as Hex,
    )
    return c.json(
      await serializePocket(
        await updatePocket(pocket, { cap, pin: input.pin, signedAt: input.signed_at }),
      ),
    )
  })
  .post('/wallets/:address/ussd-pocket/withdraw', async (c) => {
    requirePockets()
    const owner = wallet(c)
    const input = await body(c, withdrawBody, '{ amount, signed_at, signature }')
    const pocket = await pocketOf(owner)
    if (!pocket || pocket.status === 'closed')
      throw new KovaError('not_found', 'This wallet has no USSD pocket.')
    const amount = parseAmount(input.amount)
    await checkOwner(
      pocket,
      {
        action: 'withdraw',
        wallet: owner,
        chainId: network.chainId,
        amount,
        signedAt: input.signed_at,
      },
      input.signature as Hex,
    )
    await updatePocket(pocket, { signedAt: input.signed_at })
    await spend(pocket, {
      sessionId: `app:${owner.toLowerCase()}:${input.signed_at}`,
      kind: 'withdraw',
      to: owner,
      toLabel: 'your wallet',
      amount,
    })
    return c.json(await serializePocket(pocket))
  })
  .delete('/wallets/:address/ussd-pocket', async (c) => {
    requirePockets()
    const owner = wallet(c)
    const input = await body(c, closeBody, '{ signed_at, signature }')
    const pocket = await pocketOf(owner)
    if (!pocket || pocket.status === 'closed')
      throw new KovaError('not_found', 'This wallet has no USSD pocket.')
    await checkOwner(
      pocket,
      { action: 'close', wallet: owner, chainId: network.chainId, signedAt: input.signed_at },
      input.signature as Hex,
    )
    await reconcilePocket(pocket)
    const left = await pocketBalance(pocket)
    if (left > 0n)
      await spend(pocket, {
        sessionId: `app:${owner.toLowerCase()}:${input.signed_at}`,
        kind: 'withdraw',
        to: owner,
        toLabel: 'your wallet',
        amount: left,
      })
    await closePocket(pocket, input.signed_at)
    return c.json({ object: 'ussd_pocket', status: 'none', dial: config.KOVA_USSD_CODE })
  })
