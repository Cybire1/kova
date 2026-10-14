import { runMigrations } from '@kova/db'
import {
  personalStealthKeysMessage,
  stealthKeysFromSignature,
  stealthMetaAddress,
  stealthRegistrationMessage,
} from '@kova/monad'
import { generatePrivateKey, type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import { beforeAll, describe, expect, it } from 'vitest'
import { config } from '../src/config.js'
import { app } from '../src/index.js'

/**
 * Kova for Business's book, through the real routes and a real database: the payroll's people, a
 * run and each person's outcome, suppliers, and the month at a glance. Paying needs Monad, so it
 * lives in scripts/business-check.ts; here a payment can only count as paid with a transaction
 * Monad has.
 *
 * Requires a local Postgres (DATABASE_URL); migrations are applied here.
 */

const site = { domain: 'localhost:3000', uri: 'http://localhost:3000' }

type Body = Record<string, unknown> & { error?: { code: string; message: string } }

async function call(path: string, init: { method?: string; body?: unknown; key?: string } = {}) {
  const response = await app.request(path, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(init.key ? { authorization: `Bearer ${init.key}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  return { status: response.status, body: (await response.json()) as Body }
}

async function openShop(wallet: PrivateKeyAccount, name: string) {
  const challenge = await call('/v1/sign_in/challenge', {
    method: 'POST',
    body: { address: wallet.address, purpose: 'open_shop', ...site },
  })
  const message = challenge.body.message as string
  const opened = await call('/v1/merchants', {
    method: 'POST',
    body: {
      name,
      settlement_address: wallet.address,
      owner: { message, signature: await wallet.signMessage({ message }) },
    },
  })
  expect(opened.status).toBe(201)
  return opened.body.key as string
}

/** A wallet that has published its own private-receiving key, as opening Kova does. */
async function receiver() {
  const wallet = privateKeyToAccount(generatePrivateKey())
  const meta = stealthMetaAddress(
    stealthKeysFromSignature(
      await wallet.signMessage({ message: personalStealthKeysMessage(wallet.address) }),
    ),
  )
  const published = await call(`/v1/wallets/${wallet.address}/stealth`, {
    method: 'PUT',
    body: {
      meta_address: meta,
      signature: await wallet.signMessage({
        message: stealthRegistrationMessage(wallet.address, meta),
      }),
    },
  })
  expect(published.status).toBeLessThan(300)
  return wallet
}

let owner: PrivateKeyAccount
let key: string

beforeAll(async () => {
  await runMigrations(config.DATABASE_URL)
  owner = privateKeyToAccount(generatePrivateKey())
  key = await openShop(owner, 'Mama Put Kitchen')
})

describe('the payroll book', () => {
  it('keeps the people a business pays, by their wallet, and updates them in place', async () => {
    const tunde = await receiver()
    const added = await call('/v1/business/people', {
      method: 'POST',
      key,
      body: { name: 'Tunde', wallet_address: tunde.address, amount: '250' },
    })
    expect(added.status).toBe(201)
    expect(added.body).toMatchObject({
      name: 'Tunde',
      amount: '250.00',
      wallet_address: tunde.address,
    })
    // The same wallet again is the same person, renamed.
    const again = await call('/v1/business/people', {
      method: 'POST',
      key,
      body: { name: 'Tunde Bakare', wallet_address: tunde.address, amount: '275.50' },
    })
    expect(again.body).toMatchObject({ id: added.body.id, name: 'Tunde Bakare', amount: '275.50' })
    const list = await call('/v1/business/people', { key })
    expect((list.body.data as unknown[]).length).toBe(1)
  })

  it('refuses the business’s own wallet, a bad address and a bad amount', async () => {
    expect(
      (
        await call('/v1/business/people', {
          method: 'POST',
          key,
          body: { name: 'Me', wallet_address: owner.address },
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await call('/v1/business/people', {
          method: 'POST',
          key,
          body: { name: 'X', wallet_address: '0x123' },
        })
      ).status,
    ).toBe(400)
    const someone = privateKeyToAccount(generatePrivateKey()).address
    expect(
      (
        await call('/v1/business/people', {
          method: 'POST',
          key,
          body: { name: 'X', wallet_address: someone, amount: '-4' },
        })
      ).status,
    ).toBe(400)
  })

  it('needs the shop’s own key', async () => {
    expect((await call('/v1/business/people')).status).toBe(401)
    expect((await call('/v1/business')).status).toBe(401)
  })
})

describe('a payroll run', () => {
  it('starts with everyone pending, records who couldn’t be paid, and only counts a payment Monad has', async () => {
    const run = await call('/v1/business/payroll', {
      method: 'POST',
      key,
      body: {
        label: 'October salary',
        payments: [
          { name: 'Tunde', amount: '0.05' },
          { name: 'Amaka', amount: '0.10' },
        ],
      },
    })
    expect(run.status).toBe(201)
    expect(run.body).toMatchObject({
      label: 'October salary',
      total: '0.15',
      status: 'paying',
      people: 2,
      paid: 0,
    })
    const [first, second] = run.body.payments as { id: string; status: string }[]
    expect(first?.status).toBe('pending')

    const failed = await call(`/v1/business/payroll/${run.body.id}/payments/${second?.id}`, {
      method: 'POST',
      key,
      body: { failure: 'Amaka can’t receive privately yet.' },
    })
    expect(failed.body).toMatchObject({
      status: 'failed',
      failure: 'Amaka can’t receive privately yet.',
    })

    // A transaction Monad has never seen can't make a payment paid.
    const made = await call(`/v1/business/payroll/${run.body.id}/payments/${first?.id}`, {
      method: 'POST',
      key,
      body: {
        stealth_address: privateKeyToAccount(generatePrivateKey()).address,
        tx_hash: `0x${'ab'.repeat(32)}`,
      },
    })
    expect(made.status).toBe(404)

    const runs = await call('/v1/business/payroll', { key })
    const listed = (runs.body.data as { id: string; status: string; failed: number }[]).find(
      (r) => r.id === run.body.id,
    )
    expect(listed).toMatchObject({ status: 'paying', failed: 1 })
  })

  it('belongs to its business alone', async () => {
    const other = await openShop(privateKeyToAccount(generatePrivateKey()), 'Another Shop')
    const run = await call('/v1/business/payroll', {
      method: 'POST',
      key,
      body: { label: 'Mine', payments: [{ name: 'A', amount: '1' }] },
    })
    expect((await call(`/v1/business/payroll/${run.body.id}`, { key: other })).status).toBe(404)
  })
})

describe('suppliers', () => {
  it('keeps who the business buys from, with their country and currency, and removes one never paid', async () => {
    const wallet = privateKeyToAccount(generatePrivateKey()).address
    const added = await call('/v1/business/suppliers', {
      method: 'POST',
      key,
      body: {
        name: 'Lisbon Coffee Roasters',
        wallet_address: wallet,
        country: 'Portugal',
        currency: 'EUR',
      },
    })
    expect(added.status).toBe(201)
    expect(added.body).toMatchObject({
      country: 'Portugal',
      currency: 'EUR',
      paid_total: '0.00',
      payments: 0,
    })
    expect(
      (
        await call('/v1/business/suppliers', {
          method: 'POST',
          key,
          body: { name: 'X', wallet_address: wallet, currency: 'JPY' },
        })
      ).status,
    ).toBe(400)
    const paidWithNothing = await call(`/v1/business/suppliers/${added.body.id}/payments`, {
      method: 'POST',
      key,
      body: { amount: '5', tx_hash: `0x${'cd'.repeat(32)}` },
    })
    expect(paidWithNothing.status).toBe(404)
    expect(
      (await call(`/v1/business/suppliers/${added.body.id}`, { method: 'DELETE', key })).body,
    ).toEqual({ deleted: true })
  })
})

describe('the business at a glance', () => {
  it('counts the month: nothing paid yet, the people and suppliers in the book', async () => {
    const summary = await call('/v1/business', { key })
    expect(summary.status).toBe(200)
    expect(summary.body).toMatchObject({
      name: 'Mama Put Kitchen',
      owner_address: owner.address,
      payroll: { paid_this_month: '0.00', people: 1 },
      suppliers: { paid_this_month: '0.00', count: 0 },
    })
  })
})
