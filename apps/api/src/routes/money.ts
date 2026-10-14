import { MONEY_FEATURES, type MoneyFeature } from '@kova/monad'
import { Hono } from 'hono'
import { type Address, getAddress, type Hex, isAddress } from 'viem'
import { z } from 'zod'
import { KovaError } from '../errors.js'
import { clientIp, limit } from '../limits.js'
import {
  type CardAuthorizationEvent,
  decideCardAuthorization,
  dollarCardFor,
  issueDollarCard,
  openUsAccount,
  requestAccess,
  requireWalletSignature,
  revealDollarCard,
  saveIn,
  saveOut,
  savingsFor,
  setDollarCard,
  usAccountFor,
  verifyLithicSignature,
} from '../services/money.js'

/**
 * Money in, the dollar card and savings.
 *
 *   POST /wallets/:address/access-requests        ask for a feature that waits on a partner (signed)
 *   GET  /wallets/:address/us-account             the US account's status
 *   POST /wallets/:address/us-account             start it: Bridge's KYC (signed; name and email)
 *   POST /wallets/:address/us-account/view        its account and routing number (signed)
 *   GET  /wallets/:address/dollar-card            the card, frozen or not, its limit and payments
 *   POST /wallets/:address/dollar-card            issue it (signed)
 *   POST /wallets/:address/dollar-card/settings   freeze, unfreeze or change the daily limit (signed)
 *   POST /wallets/:address/dollar-card/reveal     a short-lived link to the issuer's own frame with the number (signed)
 *   POST /dollar-card/authorizations              the issuer asks whether a payment may go through
 *   GET  /wallets/:address/savings                balance, put in, earned, moves
 *   POST /wallets/:address/savings/in             a signed receiveWithAuthorization into savings
 *   POST /wallets/:address/savings/out            a signed permit on the vault's shares, back to the wallet
 */

function walletAddress(c: { req: { param: (name: string) => string } }): Address {
  const address = c.req.param('address')
  if (!isAddress(address)) throw new KovaError('invalid_request', 'Not a Monad address.')
  return getAddress(address)
}

const signed = { signed_at: z.number().int(), signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }
const accessBody = z.object({ feature: z.enum(MONEY_FEATURES as [MoneyFeature, ...MoneyFeature[]]), ...signed })
const openBody = z.object({ full_name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(200), ...signed })
const plainSigned = z.object(signed)
const issueBody = z.object({ daily_limit: z.string().regex(/^\d{1,13}$/).optional(), ...signed })
const settingsBody = z.object({ frozen: z.boolean().optional(), daily_limit: z.string().regex(/^\d{1,13}$/).optional(), ...signed })
const revealBody = z.object({ origin: z.string().url().max(200), ...signed })
const saveInBody = z.object({
  value: z.string().regex(/^\d{1,30}$/),
  valid_after: z.string().regex(/^\d{1,20}$/),
  valid_before: z.string().regex(/^\d{1,20}$/),
  nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
})
const saveOutBody = z.object({
  shares: z.string().regex(/^\d{1,40}$/),
  deadline: z.string().regex(/^\d{1,20}$/),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
})

async function body<T>(c: { req: { json: () => Promise<unknown> } }, schema: z.ZodType<T>, expected: string): Promise<T> {
  const parsed = schema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) throw new KovaError('invalid_request', `Expected ${expected}.`)
  return parsed.data
}

export const moneyRoutes = new Hono()
  .post('/wallets/:address/access-requests', async (c) => {
    const wallet = walletAddress(c)
    const b = await body(c, accessBody, '{ feature, signed_at, signature }')
    await requireWalletSignature(wallet, 'request-access', b.signed_at, b.signature, b.feature)
    limit(`money-access-ip:${clientIp(c)}`, 60, 3_600_000, 'That’s a lot from here. Try again later.')
    await requestAccess(wallet, b.feature)
    return c.json({ object: 'access_request', feature: b.feature, requested: true })
  })
  .get('/wallets/:address/us-account', async (c) => c.json(await usAccountFor(walletAddress(c), false)))
  .post('/wallets/:address/us-account', async (c) => {
    const wallet = walletAddress(c)
    const b = await body(c, openBody, '{ full_name, email, signed_at, signature }')
    await requireWalletSignature(wallet, 'open-us-account', b.signed_at, b.signature, b.email.toLowerCase())
    limit(`us-account-ip:${clientIp(c)}`, 10, 3_600_000, 'That’s a lot of accounts from here. Try again later.')
    return c.json(await openUsAccount(wallet, { full_name: b.full_name, email: b.email }))
  })
  .post('/wallets/:address/us-account/view', async (c) => {
    const wallet = walletAddress(c)
    const b = await body(c, plainSigned, '{ signed_at, signature }')
    await requireWalletSignature(wallet, 'view-us-account', b.signed_at, b.signature)
    return c.json(await usAccountFor(wallet, true))
  })
  .get('/wallets/:address/dollar-card', async (c) => c.json(await dollarCardFor(walletAddress(c))))
  .post('/wallets/:address/dollar-card', async (c) => {
    const wallet = walletAddress(c)
    const b = await body(c, issueBody, '{ daily_limit?, signed_at, signature }')
    await requireWalletSignature(wallet, 'issue-dollar-card', b.signed_at, b.signature, b.daily_limit ?? '')
    limit(`dollar-card-ip:${clientIp(c)}`, 10, 3_600_000, 'That’s a lot of cards from here. Try again later.')
    return c.json(await issueDollarCard(wallet, b.daily_limit ? BigInt(b.daily_limit) : undefined))
  })
  .post('/wallets/:address/dollar-card/settings', async (c) => {
    const wallet = walletAddress(c)
    const b = await body(c, settingsBody, '{ frozen?, daily_limit?, signed_at, signature }')
    const detail = `${b.frozen === undefined ? '' : b.frozen ? 'freeze' : 'unfreeze'}${b.daily_limit ? ` limit ${b.daily_limit}` : ''}`.trim()
    await requireWalletSignature(wallet, 'dollar-card-settings', b.signed_at, b.signature, detail)
    return c.json(await setDollarCard(wallet, { frozen: b.frozen, dailyLimit: b.daily_limit ? BigInt(b.daily_limit) : undefined }))
  })
  .post('/wallets/:address/dollar-card/reveal', async (c) => {
    const wallet = walletAddress(c)
    const b = await body(c, revealBody, '{ origin, signed_at, signature }')
    await requireWalletSignature(wallet, 'reveal-dollar-card', b.signed_at, b.signature, new URL(b.origin).origin)
    limit(`dollar-card-reveal:${wallet.toLowerCase()}`, 20, 3_600_000, 'That’s a lot of looks at the card. Try again later.')
    return c.json(await revealDollarCard(wallet, new URL(b.origin).origin))
  })
  .post('/dollar-card/authorizations', async (c) => {
    const raw = await c.req.text()
    const signed = verifyLithicSignature(raw, {
      id: c.req.header('webhook-id'),
      timestamp: c.req.header('webhook-timestamp'),
      signature: c.req.header('webhook-signature'),
    })
    if (!signed) throw new KovaError('unauthorized', 'Not signed by the card issuer.')
    const event = (() => {
      try {
        return JSON.parse(raw) as CardAuthorizationEvent
      } catch {
        throw new KovaError('invalid_request', 'Expected a card authorization.')
      }
    })()
    return c.json(await decideCardAuthorization(event))
  })
  .get('/wallets/:address/savings', async (c) => c.json(await savingsFor(walletAddress(c))))
  .post('/wallets/:address/savings/in', async (c) => {
    const wallet = walletAddress(c)
    const b = await body(c, saveInBody, '{ value, valid_after, valid_before, nonce, signature }')
    limit(`savings:${wallet.toLowerCase()}`, 30, 3_600_000, 'That’s a lot of moves in an hour. Try again later.')
    return c.json(
      await saveIn(wallet, {
        value: BigInt(b.value),
        validAfter: BigInt(b.valid_after),
        validBefore: BigInt(b.valid_before),
        nonce: b.nonce as Hex,
        signature: b.signature as Hex,
      }),
    )
  })
  .post('/wallets/:address/savings/out', async (c) => {
    const wallet = walletAddress(c)
    const b = await body(c, saveOutBody, '{ shares, deadline, signature }')
    limit(`savings:${wallet.toLowerCase()}`, 30, 3_600_000, 'That’s a lot of moves in an hour. Try again later.')
    return c.json(await saveOut(wallet, { shares: BigInt(b.shares), deadline: BigInt(b.deadline), signature: b.signature as Hex }))
  })
