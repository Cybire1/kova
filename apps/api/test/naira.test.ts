import { runMigrations, schema } from '@kova/db'
import { decodeMemo } from '@kova/monad'
import { eq } from 'drizzle-orm'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Naira in and out (services/naira.ts), with Paystack and Monad stood in for: quotes from the rate
 * table, the cash-out's own nonce, a cash-out paid only by its own exact transfer, and a top-up's
 * dollars sent once however many times Paystack's word arrives.
 *
 * Requires a local Postgres (DATABASE_URL); migrations are applied here.
 */

const TREASURY = '0x000000000000000000000000000000000000c0de'
const sent: { to: string; data: string }[] = []

vi.mock('../src/services/paystack.js', () => ({
  paystackReady: () => true,
  paystackTestMode: () => true,
  accountName: vi.fn(async () => 'TEST ACCOUNT 0000000000'),
  bankNamed: vi.fn(async (code: string) => (code === '001' ? { name: 'Paystack Test Bank', code: '001' } : undefined)),
  checkout: vi.fn(async () => 'https://checkout.paystack.com/test'),
  payment: vi.fn(async () => ({ status: 'success', kobo: 10_000_000n, currency: 'NGN' })),
  transfer: vi.fn(async () => ({ code: 'TRF_test', status: 'success' })),
  transferRecipient: vi.fn(async () => 'RCP_test'),
  transferStatus: vi.fn(async () => 'success'),
}))

vi.mock('../src/relay.js', () => ({
  relayReady: () => true,
  relayAuthorization: vi.fn(async () => ({
    receipt: { transactionHash: `0x${[...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')}`, status: 'success' },
    ms: 1,
  })),
  sendFromRelayer: vi.fn(async (to: string, data: string) => {
    sent.push({ to, data })
    return { status: 'success', transactionHash: `0x${[...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')}` }
  }),
}))

vi.mock('../src/chain.js', async (original) => {
  const real = (await original()) as Record<string, unknown>
  return {
    ...real,
    feePayerAddress: TREASURY,
    publicClient: { readContract: vi.fn(async () => 1_000_000_000n) },
  }
})

const naira = await import('../src/services/naira.js')
const { config } = await import('../src/config.js')
const { db } = await import('../src/db.js')
const { settlementToken } = await import('../src/chain.js')

const wallet = () => privateKeyToAccount(generatePrivateKey()).address

beforeAll(async () => {
  await runMigrations(config.DATABASE_URL)
})

beforeEach(() => {
  sent.length = 0
})

describe('naira quotes', () => {
  it('cashes out at the market rate less the spread, less the bank fee', async () => {
    const quote = await naira.quoteCashOut(1_000_000n)
    expect(quote.rate).toBeCloseTo(quote.market * (1 - config.KOVA_NAIRA_SPREAD), 6)
    expect(quote.naira).toBe(quote.gross - quote.fee)
    expect(quote.fee).toBe(1_000n)
  })

  it('charges for a top-up so Paystack’s fee is covered and the wallet gets every dollar', async () => {
    const quote = await naira.quoteTopUp(10_000_000n)
    const paystackTakes = (quote.naira * 15n) / 1000n + 10_000n
    expect(quote.naira - (paystackTakes > 200_000n ? 200_000n : paystackTakes)).toBeGreaterThanOrEqual(quote.base - 1n)
  })
})

describe('cashing out', () => {
  it('carries its own Kova memo as the nonce', async () => {
    const row = await naira.createCashOut(wallet(), { amount: 2_000_000n, bankCode: '001', accountNumber: '0000000000' })
    expect(decodeMemo(naira.cashOutNonce(row))).toEqual({ kind: 'cashout', id: row.id })
    expect(naira.serializeCashOut(row).pay).toMatchObject({ to: expect.stringMatching(/^0x/i), value: '2000000' })
  })

  it('is paid only by its own exact transfer, once', async () => {
    const who = wallet()
    const row = await naira.createCashOut(who, { amount: 2_000_000n, bankCode: '001', accountNumber: '0000000000' })
    const right = {
      from: who,
      to: TREASURY as `0x${string}`,
      value: 2_000_000n,
      validAfter: 0n,
      validBefore: BigInt(Math.floor(row.expiresAt.getTime() / 1000)),
      nonce: naira.cashOutNonce(row),
    }
    const signed = (authorization: typeof right) => ({ token: settlementToken.address, authorization, signature: '0x' as const })
    await expect(naira.payCashOut(row, signed({ ...right, nonce: `0x${'11'.repeat(32)}` }))).rejects.toThrow(/isn’t for this cash-out/)
    await expect(naira.payCashOut(row, signed({ ...right, value: 1_000_000n }))).rejects.toThrow(/amount/)
    await expect(naira.payCashOut(row, signed({ ...right, to: wallet() }))).rejects.toThrow(/treasury/)
    await expect(naira.payCashOut(row, signed({ ...right, from: wallet() }))).rejects.toThrow(/another wallet/)
    const paid = await naira.payCashOut(row, signed(right))
    expect(paid.status).toBe('paid')
    const again = await naira.payCashOut(paid, signed(right))
    expect(again.status).toBe('paid')
  })
})

describe('adding money in naira', () => {
  it('sends the dollars once, however many times Paystack confirms it', async () => {
    const who = wallet()
    const { row } = await naira.startTopUp(who, { amount: 5_000_000n, email: 'ada@example.com', callbackUrl: 'http://localhost/x' })
    await db.update(schema.nairaTopUps).set({ naira: 10_000_000n }).where(eq(schema.nairaTopUps.id, row.id))
    const results = await Promise.all([naira.settleTopUp(row.reference), naira.settleTopUp(row.reference), naira.settleTopUp(row.reference)])
    const final = await naira.settleTopUp(row.reference)
    expect(final.status).toBe('settled')
    expect(sent).toHaveLength(1)
    expect(results.filter((r) => r.status === 'settled').length).toBeGreaterThanOrEqual(1)
  })
})
