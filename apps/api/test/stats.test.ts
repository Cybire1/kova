import { runMigrations, schema, uuidv7 } from '@kova/db'
import { encodeMemo, getToken, parseAmount } from '@kova/monad'
import { type Address, getAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { config } from '../src/config.js'
import { db } from '../src/db.js'
import { app } from '../src/index.js'
import { demoAddresses, demoWallet } from '../src/services/demo.js'

/**
 * The public numbers are other people's: Kova's own demo account (the one App Review signs into)
 * buys and sells to stay lived-in, and none of that counts. A relayer stands in for the chain here;
 * the numbers come from a real database.
 *
 * Requires a local Postgres (DATABASE_URL); migrations are applied here.
 */

vi.mock('../src/chain.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/chain.js')>()),
  feePayerAccount: { address: '0x000000000000000000000000000000000000dEaD' },
}))

const saved = {
  user: config.KOVA_DEMO_USERNAME,
  password: config.KOVA_DEMO_PASSWORD,
  secret: config.KOVA_DEMO_SECRET,
}
const token = getToken('testnet', 'AUSD')

async function stats() {
  const response = await app.request('/v1/public/stats')
  expect(response.status).toBe(200)
  return (await response.json()) as { people: number; payments: number; shops: number }
}

/** A paid charge at a fresh shop, as the chain watcher would record it. */
async function paid(payer: Address, amount: string) {
  const merchantId = uuidv7()
  const intentId = uuidv7()
  const shop = privateKeyToAccount(generatePrivateKey()).address
  await db.insert(schema.merchants).values({
    id: merchantId,
    name: 'Stats Shop',
    slug: `stats-${merchantId}`,
    settlementAddress: shop,
    network: 'testnet',
    isTest: true,
  })
  await db.insert(schema.paymentIntents).values({
    id: intentId,
    merchantId,
    amount: parseAmount(amount),
    currency: 'AUSD',
    tokenAddress: token.address,
    network: 'testnet',
    payTo: shop,
    memo: encodeMemo({ kind: 'payment', id: intentId }),
    status: 'paid',
    expiresAt: new Date(Date.now() + 900_000),
  })
  await db.insert(schema.payments).values({
    id: uuidv7(),
    intentId,
    txHash: `0x${intentId.replaceAll('-', '').padEnd(64, '0')}`,
    // As the chain writes it: mixed case.
    payerAddress: getAddress(payer),
    amount: parseAmount(amount),
    tokenAddress: token.address,
    status: 'paid',
    confirmedAt: new Date(),
  })
}

beforeAll(async () => {
  await runMigrations(config.DATABASE_URL)
  config.KOVA_DEMO_USERNAME = 'review@example.com'
  config.KOVA_DEMO_PASSWORD = 'not-a-real-password'
  config.KOVA_DEMO_SECRET = `0x${'11'.repeat(32)}`
})

afterAll(() => {
  config.KOVA_DEMO_USERNAME = saved.user
  config.KOVA_DEMO_PASSWORD = saved.password
  config.KOVA_DEMO_SECRET = saved.secret
  vi.useRealTimers()
})

describe('public numbers', () => {
  it('knows every address the demo account acts as, in lowercase', async () => {
    const own = await demoAddresses()
    const sam = (await demoWallet()).address
    expect(own).toContain(sam.toLowerCase())
    expect(own.every((a) => a === a.toLowerCase())).toBe(true)
    expect(new Set(own).size).toBe(own.length)
  })

  it('counts other people’s payments, not the demo account’s', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const before = await stats()

    const sam = (await demoWallet()).address
    await paid(sam, '3.20')
    await paid(privateKeyToAccount(generatePrivateKey()).address, '6.50')

    // The numbers are cached for a minute.
    vi.setSystemTime(Date.now() + 61_000)
    const after = await stats()
    expect(after.payments - before.payments).toBe(1)
    expect(after.people - before.people).toBe(1)
  })
})
