import { runMigrations } from '@kova/db'
import { generatePrivateKey, type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import { beforeAll, describe, expect, it } from 'vitest'
import { config } from '../src/config.js'
import { app } from '../src/index.js'
import { roleMay } from '../src/services/business-roles.js'

/**
 * Kova for Business's structure: branches, a team whose members sign in with their own wallets and
 * can do only what their role allows, and an audit trail of who did what. Requires a local Postgres
 * (DATABASE_URL).
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

/** A team member signing in with their own wallet, as the dashboard does. */
async function signIn(wallet: PrivateKeyAccount, merchant?: string) {
  const challenge = await call('/v1/sign_in/challenge', {
    method: 'POST',
    body: { address: wallet.address, purpose: 'sign_in', ...site },
  })
  const message = challenge.body.message as string
  return call('/v1/sign_in', {
    method: 'POST',
    body: { message, signature: await wallet.signMessage({ message }), ...(merchant ? { merchant } : {}) },
  })
}

describe('what each role may do', () => {
  it('lets a cashier take payments and nothing else', () => {
    expect(roleMay('cashier', 'POST', '/v1/payment_intents')).toBe(true)
    expect(roleMay('cashier', 'GET', '/v1/catalog/items')).toBe(true)
    expect(roleMay('cashier', 'GET', '/v1/business/payroll')).toBe(false)
    expect(roleMay('cashier', 'POST', '/v1/catalog/items')).toBe(false)
    expect(roleMay('cashier', 'POST', '/v1/terminals/pairings')).toBe(false)
  })
  it('lets an accountant keep the books and read the trail, never change settings or the team', () => {
    expect(roleMay('accountant', 'POST', '/v1/business/payroll')).toBe(true)
    expect(roleMay('accountant', 'GET', '/v1/business/audit')).toBe(true)
    expect(roleMay('accountant', 'PATCH', '/v1/account')).toBe(false)
    expect(roleMay('accountant', 'POST', '/v1/business/members')).toBe(false)
  })
  it('lets a manager run tills and the menu, not the books or the trail', () => {
    expect(roleMay('manager', 'POST', '/v1/terminals/pairings')).toBe(true)
    expect(roleMay('manager', 'PATCH', '/v1/catalog/items/abc')).toBe(true)
    expect(roleMay('manager', 'POST', '/v1/business/payroll')).toBe(false)
    expect(roleMay('manager', 'GET', '/v1/business/audit')).toBe(false)
  })
  it('lets a viewer read, and refuses anything not on the list for everyone', () => {
    expect(roleMay('viewer', 'GET', '/v1/business/payroll')).toBe(true)
    expect(roleMay('viewer', 'POST', '/v1/payment_intents')).toBe(false)
    expect(roleMay('admin', 'POST', '/v1/account/owner')).toBe(false)
    expect(roleMay('admin', 'GET', '/v1/something/new')).toBe(false)
  })
})

describe('a business with branches and a team', () => {
  const owner = privateKeyToAccount(generatePrivateKey())
  const cashier = privateKeyToAccount(generatePrivateKey())
  const accountant = privateKeyToAccount(generatePrivateKey())
  const admin = privateKeyToAccount(generatePrivateKey())
  let key = ''

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL)
    key = await openShop(owner, 'Mama Put')
  })

  it('opens branches, adds people with roles, and signs each in as themselves', async () => {
    const lekki = await call('/v1/business/branches', {
      method: 'POST',
      key,
      body: { name: 'Lekki', address: '12 Admiralty Way' },
    })
    expect(lekki.status).toBe(201)
    const added = await call('/v1/business/members', {
      method: 'POST',
      key,
      body: { wallet: cashier.address, name: 'Tunde', role: 'cashier', branch_ids: [lekki.body.id] },
    })
    expect(added.status).toBe(201)
    expect(added.body).toMatchObject({ role: 'cashier', branches: [{ name: 'Lekki' }] })
    await call('/v1/business/members', {
      method: 'POST',
      key,
      body: { wallet: accountant.address, name: 'Ada', role: 'accountant' },
    })
    await call('/v1/business/members', {
      method: 'POST',
      key,
      body: { wallet: admin.address, name: 'Bola', role: 'admin' },
    })

    const session = await signIn(cashier)
    expect(session.status).toBe(201)
    expect(session.body.role).toBe('cashier')
    const me = await call('/v1/business/me', { key: session.body.key as string })
    expect(me.body).toMatchObject({ role: 'cashier', can: { take_payments: true, books: false } })
  })

  it('refuses what a role can’t do, and lets each do its own job', async () => {
    const asCashier = (await signIn(cashier)).body.key as string
    expect((await call('/v1/business/payroll', { key: asCashier })).status).toBe(403)
    expect((await call('/v1/business/audit', { key: asCashier })).status).toBe(403)
    expect((await call('/v1/catalog/items', { key: asCashier })).status).toBe(200)

    const asAccountant = (await signIn(accountant)).body.key as string
    expect((await call('/v1/business/audit', { key: asAccountant })).status).toBe(200)
    const settings = await call('/v1/account', { method: 'PATCH', key: asAccountant, body: { name: 'x' } })
    expect(settings.status).toBe(403)
    expect(settings.body.error?.message).toMatch(/As accountant/)
  })

  it('lets an admin manage the team, but only the owner makes or changes admins', async () => {
    const asAdmin = (await signIn(admin)).body.key as string
    const someone = privateKeyToAccount(generatePrivateKey())
    const viewer = await call('/v1/business/members', {
      method: 'POST',
      key: asAdmin,
      body: { wallet: someone.address, name: 'Chidi', role: 'viewer' },
    })
    expect(viewer.status).toBe(201)
    const another = privateKeyToAccount(generatePrivateKey())
    const tooFar = await call('/v1/business/members', {
      method: 'POST',
      key: asAdmin,
      body: { wallet: another.address, name: 'Femi', role: 'admin' },
    })
    expect(tooFar.status).toBe(403)
  })

  it('signs a removed member out at once', async () => {
    const asCashier = (await signIn(cashier)).body.key as string
    const list = await call('/v1/business/members', { key })
    const tunde = (list.body.data as { id: string; name: string }[]).find((m) => m.name === 'Tunde')
    expect(tunde).toBeDefined()
    const removed = await call(`/v1/business/members/${tunde?.id}`, { method: 'DELETE', key })
    expect(removed.status).toBe(200)
    expect((await call('/v1/catalog/items', { key: asCashier })).status).toBe(401)
    expect((await signIn(cashier)).status).toBe(404)
  })

  it('keeps an audit trail of who did what, by name', async () => {
    const trail = await call('/v1/business/audit', { key })
    const events = trail.body.data as { action: string; subject: string | null; actor: { name: string } }[]
    const actions = events.map((e) => e.action)
    expect(actions).toEqual(
      expect.arrayContaining(['branch.added', 'member.added', 'member.removed', 'session.opened']),
    )
    expect(events.find((e) => e.action === 'member.added' && e.subject === 'Chidi')?.actor.name).toBe(
      'Bola (admin)',
    )
  })
})
