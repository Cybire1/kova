import { runMigrations, schema, uuidv7 } from '@kova/db'
import { getAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { config } from '../src/config.js'
import { db } from '../src/db.js'
import { app } from '../src/index.js'

/**
 * Kova's own dashboard: only with the admin secret, and it shows each person where they stand,
 * with the stuck ones first. Balances come from a stand-in multicall here; the rest from a real
 * database. Requires a local Postgres (DATABASE_URL); migrations are applied here.
 */

vi.mock('../src/chain.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/chain.js')>()
  return {
    ...real,
    publicClient: {
      ...real.publicClient,
      multicall: vi.fn(async ({ contracts }: { contracts: unknown[] }) =>
        contracts.map(() => ({ status: 'success', result: 2_500_000n })),
      ),
    },
  }
})

const SECRET = 'kova-admin-secret-for-tests-0123456789'
const saved = config.KOVA_ADMIN_SECRET
const newWallet = () => privateKeyToAccount(generatePrivateKey()).address

async function call(path: string, secret?: string) {
  const response = await app.request(path, {
    headers: secret ? { 'x-kova-admin': secret } : {},
  })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

describe('Kova’s dashboard', () => {
  const plain = newWallet()
  const stuck = newWallet()
  const email = `ada.${Date.now()}@example.com`

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL)
    config.KOVA_ADMIN_SECRET = SECRET
    await db.insert(schema.noteKeys).values({
      address: plain.toLowerCase(),
      publicKey: '0x01',
      signature: '0x02',
    })
    // ID approved an hour ago, and still no card.
    await db.insert(schema.cardHolders).values({
      id: uuidv7(),
      wallet: stuck.toLowerCase(),
      network: config.KOVA_NETWORK,
      entityId: `ent_${Date.now()}`,
      status: 'approved',
      firstName: 'Ada',
      lastName: 'Okafor',
      email,
      phone: '+2348031234567',
      updatedAt: new Date(Date.now() - 3_600_000),
    })
  })
  afterAll(() => {
    config.KOVA_ADMIN_SECRET = saved
  })

  it('isn’t there without the secret, or with the wrong one', async () => {
    expect((await call('/v1/admin/overview')).status).toBe(404)
    expect((await call('/v1/admin/overview', 'x'.repeat(SECRET.length))).status).toBe(404)
    expect((await call('/v1/admin/people')).status).toBe(404)
  })

  it('counts people and puts an approved check with no card first in what needs a look', async () => {
    const { status, body } = await call('/v1/admin/overview', SECRET)
    expect(status).toBe(200)
    const people = body.people as { total: number; today: number; daily: { n: number }[] }
    expect(people.total).toBeGreaterThanOrEqual(2)
    expect(people.today).toBeGreaterThanOrEqual(1)
    expect(people.daily).toHaveLength(30)
    const attention = body.attention as Array<{ kind: string; wallet: string; title: string }>
    expect(attention).toContainEqual(
      expect.objectContaining({
        kind: 'card',
        wallet: stuck.toLowerCase(),
        title: 'ID approved, card not made',
      }),
    )
  })

  it('finds a person by the email they gave for the card, with a live balance', async () => {
    const { body } = await call(`/v1/admin/people?q=${encodeURIComponent(email)}`, SECRET)
    expect(body.total).toBe(1)
    expect((body.data as unknown[])[0]).toMatchObject({
      address: getAddress(stuck),
      name: 'Ada Okafor',
      email,
      check: 'approved',
      card: false,
      balance: '2500000',
    })
  })

  it('shows one person’s ID check, card and cash-outs, and refuses what isn’t an address', async () => {
    const { status, body } = await call(`/v1/admin/people/${stuck}`, SECRET)
    expect(status).toBe(200)
    expect(body).toMatchObject({
      address: getAddress(stuck),
      check: { status: 'approved', name: 'Ada Okafor', phone: '+2348031234567' },
      cards: [],
      payouts: [],
      naira: [],
    })
    expect((await call('/v1/admin/people/not-an-address', SECRET)).status).toBe(400)
    expect((await call(`/v1/admin/people/${newWallet()}`, SECRET)).status).toBe(404)
  })
})
