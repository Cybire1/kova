import { MONEY_FEATURES, type MoneyFeature } from '@kova/monad'
import { Hono } from 'hono'
import { type Address, getAddress, type Hex, isAddress } from 'viem'
import { z } from 'zod'
import { KovaError } from '../errors.js'
import { clientIp, limit } from '../limits.js'
import {
  dollarCardFor,
  idNumberFor,
  revealDollarCard,
  setDollarCard,
  startCheck,
  topUp,
} from '../services/dollar-card.js'
import {
  openUsAccount,
  requestAccess,
  requireWalletSignature,
  saveIn,
  saveOut,
  savingsFor,
  usAccountFor,
} from '../services/money.js'

/**
 * Money in, the dollar card and savings.
 *
 *   POST /wallets/:address/access-requests        ask for a feature that waits on a partner (signed)
 *   GET  /wallets/:address/us-account             the US account's status
 *   POST /wallets/:address/us-account             start it: Bridge's KYC (signed; name and email)
 *   POST /wallets/:address/us-account/view        its account and routing number (signed)
 *   GET  /wallets/:address/dollar-card            where the card is: intro, checking, fix or the card itself
 *   POST /wallets/:address/dollar-card/check      the holder's details and ID photo, to the issuer's check (signed)
 *   POST /wallets/:address/dollar-card/top-up     a signed AUSD transfer to Kova (amount + 0.5%), the amount moved onto the card
 *   POST /wallets/:address/dollar-card/settings   freeze or unfreeze (signed)
 *   POST /wallets/:address/dollar-card/reveal     the card's number, expiry and CVV (signed)
 *   GET  /wallets/:address/savings                balance, put in, earned, moves
 *   POST /wallets/:address/savings/in             a signed receiveWithAuthorization into savings
 *   POST /wallets/:address/savings/out            a signed permit on the vault's shares, back to the wallet
 */

function walletAddress(c: { req: { param: (name: string) => string } }): Address {
  const address = c.req.param('address')
  if (!isAddress(address)) throw new KovaError('invalid_request', 'That isn’t a wallet address.')
  return getAddress(address)
}

const signed = { signed_at: z.number().int(), signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }
const accessBody = z.object({
  feature: z.enum(MONEY_FEATURES as [MoneyFeature, ...MoneyFeature[]]),
  ...signed,
})
const openBody = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  ...signed,
})
const plainSigned = z.object(signed)
const checkBody = z.object({
  first_name: z.string().trim().min(1).max(60),
  last_name: z.string().trim().min(1).max(60),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  email: z.string().trim().email().max(200),
  phone: z.string().regex(/^\+\d{8,15}$/),
  nationality: z.string().regex(/^[A-Z]{2}$/),
  gender: z.enum(['m', 'f']),
  address: z.object({
    line1: z.string().trim().min(3).max(120),
    city: z.string().trim().min(2).max(60),
    state: z.string().trim().min(2).max(60),
    postal_code: z.string().trim().min(2).max(20),
    country: z.string().regex(/^[A-Z]{2}$/),
  }),
  document: z.object({
    type: z.enum(['international_passport', 'national_id', 'drivers_license']),
    number: z.string().trim().min(4).max(40),
    /** The photo, base64 (no data: prefix), at most about 6 MB. */
    file: z.string().min(100).max(8_000_000),
    mime: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
    file_back: z.string().min(100).max(8_000_000).optional(),
  }),
  /** NIN or BVN for Nigerians, SSN for Americans (see idNumberFor). */
  id_number: z
    .object({ type: z.enum(['nin', 'bvn', 'ssn']), value: z.string().trim().max(20) })
    .optional(),
  /** A bill or bank statement showing the home address. Optional only so older apps get a clear answer. */
  address_proof: z
    .object({
      type: z.enum(['utility_bill', 'bank_statement']),
      file: z.string().min(100).max(8_000_000),
      mime: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
    })
    .optional(),
  ...signed,
})
const topUpBody = z.object({
  /** What lands on the card; `value` is that plus Kova's fee. */
  amount: z.string().regex(/^\d{1,20}$/),
  to: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  value: z.string().regex(/^\d{1,20}$/),
  valid_after: z.string().regex(/^\d{1,20}$/),
  valid_before: z.string().regex(/^\d{1,20}$/),
  nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
})
const settingsBody = z.object({ frozen: z.boolean(), ...signed })
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

async function body<T>(
  c: { req: { json: () => Promise<unknown> } },
  schema: z.ZodType<T>,
  expected: string,
): Promise<T> {
  const parsed = schema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) throw new KovaError('invalid_request', `Expected ${expected}.`)
  return parsed.data
}

export const moneyRoutes = new Hono()
  .post('/wallets/:address/access-requests', async (c) => {
    const wallet = walletAddress(c)
    const b = await body(c, accessBody, '{ feature, signed_at, signature }')
    await requireWalletSignature(wallet, 'request-access', b.signed_at, b.signature, b.feature)
    limit(
      `money-access-ip:${clientIp(c)}`,
      60,
      3_600_000,
      'That’s a lot from here. Try again later.',
    )
    await requestAccess(wallet, b.feature)
    return c.json({ object: 'access_request', feature: b.feature, requested: true })
  })
  .get('/wallets/:address/us-account', async (c) =>
    c.json(await usAccountFor(walletAddress(c), false)),
  )
  .post('/wallets/:address/us-account', async (c) => {
    const wallet = walletAddress(c)
    const b = await body(c, openBody, '{ full_name, email, signed_at, signature }')
    await requireWalletSignature(
      wallet,
      'open-us-account',
      b.signed_at,
      b.signature,
      b.email.toLowerCase(),
    )
    limit(
      `us-account-ip:${clientIp(c)}`,
      10,
      3_600_000,
      'That’s a lot of accounts from here. Try again later.',
    )
    return c.json(await openUsAccount(wallet, { full_name: b.full_name, email: b.email }))
  })
  .post('/wallets/:address/us-account/view', async (c) => {
    const wallet = walletAddress(c)
    const b = await body(c, plainSigned, '{ signed_at, signature }')
    await requireWalletSignature(wallet, 'view-us-account', b.signed_at, b.signature)
    return c.json(await usAccountFor(wallet, true))
  })
  .get('/wallets/:address/dollar-card', async (c) => c.json(await dollarCardFor(walletAddress(c))))
  .post('/wallets/:address/dollar-card/check', async (c) => {
    const wallet = walletAddress(c)
    const b = await body(c, checkBody, '{ your details, document, signed_at, signature }')
    await requireWalletSignature(wallet, 'dollar-card-check', b.signed_at, b.signature)
    limit(
      `dollar-card-check:${clientIp(c)}`,
      6,
      3_600_000,
      'That’s a lot of ID checks from here. Try again later.',
    )
    if (!b.address_proof)
      throw new KovaError(
        'invalid_request',
        'Nuvion also needs a proof of address now: a bill or bank statement. Update Kova to add it.',
      )
    return c.json(
      await startCheck(
        wallet,
        {
          firstName: b.first_name,
          lastName: b.last_name,
          dateOfBirth: b.date_of_birth,
          email: b.email,
          phone: b.phone,
          nationality: b.nationality,
          gender: b.gender,
          address: {
            line1: b.address.line1,
            city: b.address.city,
            state: b.address.state,
            postalCode: b.address.postal_code,
            country: b.address.country,
          },
          document: { type: b.document.type, number: b.document.number },
          idNumber: idNumberFor(b.nationality, b.address.country, b.id_number),
          addressProof: b.address_proof.type,
        },
        {
          identity: {
            base64: b.document.file,
            mime: b.document.mime,
            backBase64: b.document.file_back,
          },
          address: { base64: b.address_proof.file, mime: b.address_proof.mime },
        },
      ),
    )
  })
  .post('/wallets/:address/dollar-card/top-up', async (c) => {
    const wallet = walletAddress(c)
    const b = await body(
      c,
      topUpBody,
      '{ amount, to, value, valid_after, valid_before, nonce, signature }',
    )
    limit(
      `dollar-card-top-up:${wallet.toLowerCase()}`,
      20,
      3_600_000,
      'That’s a lot of top-ups in an hour. Try again later.',
    )
    return c.json(
      await topUp(
        wallet,
        BigInt(b.amount),
        {
          from: wallet,
          to: getAddress(b.to),
          value: BigInt(b.value),
          validAfter: BigInt(b.valid_after),
          validBefore: BigInt(b.valid_before),
          nonce: b.nonce as Hex,
        },
        b.signature as Hex,
      ),
    )
  })
  .post('/wallets/:address/dollar-card/settings', async (c) => {
    const wallet = walletAddress(c)
    const b = await body(c, settingsBody, '{ frozen, signed_at, signature }')
    await requireWalletSignature(
      wallet,
      'dollar-card-settings',
      b.signed_at,
      b.signature,
      b.frozen ? 'freeze' : 'unfreeze',
    )
    return c.json(await setDollarCard(wallet, b.frozen))
  })
  .post('/wallets/:address/dollar-card/reveal', async (c) => {
    const wallet = walletAddress(c)
    const b = await body(c, plainSigned, '{ signed_at, signature }')
    await requireWalletSignature(wallet, 'reveal-dollar-card', b.signed_at, b.signature)
    limit(
      `dollar-card-reveal:${wallet.toLowerCase()}`,
      20,
      3_600_000,
      'That’s a lot of looks at the card. Try again later.',
    )
    return c.json(await revealDollarCard(wallet))
  })
  .get('/wallets/:address/savings', async (c) => c.json(await savingsFor(walletAddress(c))))
  .post('/wallets/:address/savings/in', async (c) => {
    const wallet = walletAddress(c)
    const b = await body(c, saveInBody, '{ value, valid_after, valid_before, nonce, signature }')
    limit(
      `savings:${wallet.toLowerCase()}`,
      30,
      3_600_000,
      'That’s a lot of moves in an hour. Try again later.',
    )
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
    limit(
      `savings:${wallet.toLowerCase()}`,
      30,
      3_600_000,
      'That’s a lot of moves in an hour. Try again later.',
    )
    return c.json(
      await saveOut(wallet, {
        shares: BigInt(b.shares),
        deadline: BigInt(b.deadline),
        signature: b.signature as Hex,
      }),
    )
  })
