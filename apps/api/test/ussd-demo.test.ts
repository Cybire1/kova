import { runMigrations, schema, uuidv7 } from '@kova/db'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * "Try Kova on a basic phone": the page gets a demo number (+999, never a real phone) with a test
 * pocket, the real USSD menu answers its key presses, the PIN gates it, the till's code reaches the
 * shop, and its texts stay on the page. Off unless it's testnet with KOVA_USSD_DEMO=1. Monad and
 * the faucet are stubbed; pockets and charges are kept in a real database (DATABASE_URL).
 */

const state = vi.hoisted(() => ({ balances: new Map<string, bigint>(), drips: [] as string[] }))

vi.mock('../src/chain.js', async () => {
  const { getNetwork, getToken } = await import('@kova/monad')
  return {
    network: getNetwork('testnet'),
    settlementToken: getToken('testnet', 'AUSD'),
    feePayerAddress: null,
    feePayerAccount: null,
    walletClient: null,
    tokenFor: (currency: string) => getToken('testnet', currency as 'AUSD'),
    publicClient: {
      readContract: async ({ functionName, args }: { functionName: string; args: string[] }) =>
        functionName === 'authorizationState'
          ? false
          : (state.balances.get(String(args[0]).toLowerCase()) ?? 0n),
      getTransactionReceipt: async () => {
        throw Error('not found')
      },
    },
  }
})
vi.mock('../src/services/faucet.js', () => ({
  giveTestDollars: vi.fn(async (to: string) => {
    state.drips.push(to)
    state.balances.set(to.toLowerCase(), 5_000_000n)
    return { amount: '5.00', txHash: `0x${'ab'.repeat(32)}`, nextAt: new Date() }
  }),
}))
vi.mock('../src/relay.js', () => ({ relayReady: () => true, relayAuthorization: vi.fn() }))

const { config } = await import('../src/config.js')
const { db } = await import('../src/db.js')
const { errorHandler } = await import('../src/errors.js')
const { ussdRoutes } = await import('../src/routes/ussd.js')
const app = new Hono().onError(errorHandler).route('/v1', ussdRoutes)

const saved = { ...config }
const SHOP = `demo-bakery-${uuidv7().slice(-6)}`

async function call(method: string, path: string, body?: unknown) {
  const response = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.7' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, json: (await response.json()) as Record<string, any> }
}

beforeAll(async () => {
  if (!/\/[^/?]*test[^/?]*(\?|$)/.test(config.DATABASE_URL))
    throw Error('Run these tests on a test database (its name must contain "test").')
  await runMigrations(config.DATABASE_URL)
  const merchantId = uuidv7()
  await db.insert(schema.merchants).values({
    id: merchantId,
    name: 'Ada’s Bakery',
    slug: SHOP,
    settlementAddress: `0x${'ba'.repeat(20)}`,
    network: 'testnet',
    isTest: true,
  })
  await db
    .insert(schema.stalls)
    .values({ id: uuidv7(), merchantId, slug: SHOP, name: 'Ada’s Bakery' })
})

beforeEach(() => {
  Object.assign(config, {
    KOVA_NETWORK: 'testnet',
    KOVA_POCKET_MASTER_KEY: 'ab'.repeat(32),
    KOVA_USSD_ENABLED: '1',
    KOVA_USSD_CALLBACK_SECRET: 'test-callback-secret-ussd-demo',
    KOVA_USSD_CODE: '*384*53916#',
    AT_USERNAME: 'sandbox',
    AT_API_KEY: 'test',
    KOVA_USSD_DEMO: '1',
    KOVA_USSD_DEMO_SHOP: SHOP,
  })
})

afterAll(() => {
  Object.assign(config, saved)
})

describe('the basic-phone demo', () => {
  it('gives a demo number a funded pocket, a PIN and a till, and reads its balance and the till', async () => {
    const { status, json: demo } = await call('POST', '/v1/ussd/demo')
    expect(status).toBe(201)
    expect(demo.phone).toMatch(/^\+999\d{9}$/)
    expect(demo.pin).toBe('1357')
    expect(demo.till.code).toMatch(/^\d{6}$/)
    expect(demo.till.amount).toBe('3.25')
    expect(state.drips).toContain(demo.pocket)
    const { json: s } = await call(
      'GET',
      `/v1/ussd/demo/state?phone=${encodeURIComponent(demo.phone)}&till=${demo.till.id}`,
    )
    expect(s.balance).toBe('5.00')
    expect(s.till.status).toBe('requires_payment')
  })

  it('drives the real menu: the PIN gates the balance, and the till’s code finds the shop', async () => {
    const { json: demo } = await call('POST', '/v1/ussd/demo')
    const press = (text: string) =>
      call('POST', '/v1/ussd/demo/press', {
        session: 'session-0001',
        phone: demo.phone,
        text,
      }).then((r) => r.json.reply as string)
    expect(await press('')).toMatch(/^CON Kova\n1 Balance\n2 Pay a till/)
    expect(await press('1')).toBe('CON Enter your Kova PIN:')
    expect(await press('1*1357')).toMatch(/^END Pocket: \$5\.00/)
    expect(await press('2')).toBe('CON Enter the 6-digit code on the till:')
    expect(await press(`2*${demo.till.code}`)).toMatch(/Pay Ada’s Bakery\n\$3\.25/)
  })

  it('answers only demo numbers, and only when it’s switched on', async () => {
    const real = await call('POST', '/v1/ussd/demo/press', {
      session: 'session-0002',
      phone: '+2348012345678',
      text: '',
    })
    expect(real.status).toBe(400)
    config.KOVA_USSD_DEMO = '0'
    expect((await call('POST', '/v1/ussd/demo')).status).toBe(404)
  })

  it('closes demo pockets after an hour', async () => {
    const { json: demo } = await call('POST', '/v1/ussd/demo')
    await db
      .update(schema.ussdPockets)
      .set({ createdAt: new Date(Date.now() - 2 * 3_600_000) })
      .where(eq(schema.ussdPockets.phone, demo.phone))
    const { closeOldDemos } = await import('../src/services/ussd-demo.js')
    await closeOldDemos()
    const row = await db.query.ussdPockets.findFirst({
      where: eq(schema.ussdPockets.phone, demo.phone),
    })
    expect(row?.status).toBe('closed')
  })
})
