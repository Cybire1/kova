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
  feePayerAddress: '0x000000000000000000000000000000000000dEaD',
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
  return (await response.json()) as {
    people: number
    payments: number
    shops: number
    cash_outs: number
    cash_out_volume: string
    cash_out_naira: string
    moved: number
    moved_volume: string
    daily: { date: string; cash_outs: number; moved: number }[]
  }
}

/** A cash-out to naira in `status`, as the API records it (paid once the bank is paid). */
async function cashOut(status: string, dollars: string, kobo: bigint) {
  await db.insert(schema.cashOuts).values({
    id: uuidv7(),
    network: 'testnet',
    walletAddress: privateKeyToAccount(generatePrivateKey()).address,
    amount: parseAmount(dollars),
    naira: kobo,
    rate: '1376.47',
    fee: 0n,
    bankCode: '100004',
    bankName: 'Opay',
    accountNumber: '8031234567',
    accountName: 'ADA OBI',
    status,
    partner: 'paj',
    expiresAt: new Date(Date.now() + 900_000),
    paidAt: status === 'paid' ? new Date() : null,
  })
}

/** A dollar transfer, as the chain watcher indexes every one. */
async function transfer(from: Address, to: Address, dollars: string) {
  const id = uuidv7()
  await db.insert(schema.transfers).values({
    id,
    network: 'testnet',
    tokenAddress: token.address.toLowerCase(),
    fromAddress: from.toLowerCase(),
    toAddress: to.toLowerCase(),
    amount: parseAmount(dollars),
    txHash: `0x${id.replaceAll('-', '').padEnd(64, '0')}`,
    logIndex: 0,
    blockNumber: 1n,
  })
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

  it('counts money moved in and out of people’s wallets, but not the treasury’s or the demo’s', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 61_000)
    const before = await stats()

    const person = privateKeyToAccount(generatePrivateKey()).address
    await paid(person, '1.00')
    const stranger = () => privateKeyToAccount(generatePrivateKey()).address
    await transfer(person, stranger(), '4.00') // a send
    await transfer(stranger(), person, '2.50') // a deposit arriving
    await transfer('0x000000000000000000000000000000000000dEaD', person, '5.00') // free test dollars
    await transfer((await demoWallet()).address, person, '3.00') // the demo account
    await transfer(stranger(), stranger(), '9.00') // nobody's at Kova

    vi.setSystemTime(Date.now() + 61_000)
    const after = await stats()
    expect(after.moved - before.moved).toBe(2)
    expect(Number(after.moved_volume) - Number(before.moved_volume)).toBeCloseTo(6.5, 6)
    const today = (s: typeof after) => s.daily.at(-1)?.moved ?? 0
    expect(today(after) - today(before)).toBe(2)
  })

  it('counts cash-outs that reached the bank: how many, their dollars and their naira', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 61_000)
    const before = await stats()

    await cashOut('paid', '2.00', 275_294n)
    await cashOut('quoted', '5.00', 688_235n)
    await cashOut('failed', '3.00', 412_941n)

    vi.setSystemTime(Date.now() + 61_000)
    const after = await stats()
    expect(after.cash_outs - before.cash_outs).toBe(1)
    expect(Number(after.cash_out_volume) - Number(before.cash_out_volume)).toBeCloseTo(2, 6)
    expect(Number(after.cash_out_naira) - Number(before.cash_out_naira)).toBeCloseTo(2752.94, 2)
    const today = (s: typeof after) => s.daily.at(-1)?.cash_outs ?? 0
    expect(today(after) - today(before)).toBe(1)
  })
})
