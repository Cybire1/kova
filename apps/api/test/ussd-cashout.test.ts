import { runMigrations, schema, uuidv7 } from '@kova/db'
import { createPocketClient, encodeMemo, getToken } from '@kova/monad'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  type Hex,
  type TransactionReceipt,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Cashing out from a phone with no data: the owner saves one account in the app, the phone dials
 * "5 Cash out", and Paystack pays the naira once the pocket's dollars reach Kova's treasury. If the
 * bank can't take it, the dollars go back to the pocket. Monad, Paystack and SMS are stood in for.
 *
 * Requires a local Postgres whose name contains "test" (DATABASE_URL); migrations are applied here.
 */

const TREASURY = '0x000000000000000000000000000000000000c0de'
const state = vi.hoisted(() => ({
  balances: new Map<string, bigint>(),
  receipts: new Map<string, unknown>(),
  authorizations: [] as any[],
  refunds: [] as { to: string; amount: bigint }[],
  transfer: 'success' as string,
  notify: vi.fn(),
}))

vi.mock('../src/chain.js', async () => {
  const { getNetwork, getToken } = await import('@kova/monad')
  return {
    network: getNetwork('testnet'),
    settlementToken: getToken('testnet', 'AUSD'),
    feePayerAddress: '0x000000000000000000000000000000000000c0de',
    feePayerAccount: null,
    walletClient: null,
    tokenFor: (currency: string) => getToken('testnet', currency as 'AUSD'),
    publicClient: {
      readContract: async ({ functionName, args }: any) =>
        functionName === 'authorizationState'
          ? state.receipts.has(args[1])
          : (state.balances.get(args[0].toLowerCase()) ?? 0n),
      getTransactionReceipt: async ({ hash }: any) => {
        const receipt = state.receipts.get(hash)
        if (!receipt) throw Error('not found')
        return receipt
      },
    },
  }
})
vi.mock('../src/services/sms.js', () => ({
  smsReady: () => true,
  sendSms: vi.fn(async () => {}),
  sendSmsLater: state.notify,
}))
vi.mock('../src/services/settle.js', () => ({ settleFromReceipt: vi.fn(async () => {}) }))
vi.mock('../src/services/rates.js', () => ({
  rateBook: async () => ({ rates: { NGN: { perUsd: 1500 } }, source: 'table' }),
}))
vi.mock('../src/services/paystack.js', () => ({
  paystackReady: () => true,
  paystackTestMode: () => true,
  accountName: vi.fn(async () => 'ADA OBI'),
  bankNamed: vi.fn(async (code: string) =>
    code === '999992' ? { name: 'OPay Digital Services Limited (OPay)', code } : undefined,
  ),
  checkout: vi.fn(),
  payment: vi.fn(),
  transfer: vi.fn(async () => ({ code: 'TRF_test', status: state.transfer })),
  transferRecipient: vi.fn(async () => 'RCP_test'),
  transferStatus: vi.fn(async () => 'success'),
}))
vi.mock('../src/relay.js', () => ({
  relayReady: () => true,
  // The pocket's signed transfer: in these fakes the tx hash is its nonce.
  relayAuthorization: vi.fn(
    async (_token: unknown, authorization: any, _sig: unknown, options: any) => {
      const hash = authorization.nonce as Hex
      state.authorizations.push(authorization)
      await options?.beforeBroadcast?.(hash)
      const receipt = {
        transactionHash: hash,
        status: 'success',
        blockNumber: 1n,
        logs: [
          {
            address: getToken('testnet', 'AUSD').address,
            topics: encodeEventTopics({
              abi: erc20Abi,
              eventName: 'Transfer',
              args: { from: authorization.from, to: authorization.to },
            }),
            data: encodeAbiParameters([{ type: 'uint256' }], [authorization.value]),
          },
        ],
      } as unknown as TransactionReceipt
      state.receipts.set(hash, receipt)
      const from = authorization.from.toLowerCase()
      const to = authorization.to.toLowerCase()
      state.balances.set(from, (state.balances.get(from) ?? 0n) - authorization.value)
      state.balances.set(to, (state.balances.get(to) ?? 0n) + authorization.value)
      return { receipt, ms: 5 }
    },
  ),
  // The treasury's own sends: refunds back to the pocket.
  sendFromRelayer: vi.fn(async (_token: unknown, data: Hex) => {
    const { args } = decodeFunctionData({ abi: erc20Abi, data })
    state.refunds.push({ to: String(args[0]).toLowerCase(), amount: args[1] as bigint })
    return { status: 'success', transactionHash: `0x${'ab'.repeat(32)}` }
  }),
}))

const { config } = await import('../src/config.js')
const { db } = await import('../src/db.js')
const { errorHandler } = await import('../src/errors.js')
const { hashSecret, sealKey } = await import('../src/secrets.js')
const { ussdRoutes } = await import('../src/routes/ussd.js')
const app = new Hono().onError(errorHandler).route('/v1', ussdRoutes)

let nextPhone = 2348002000000
async function call(method: string, path: string, body?: unknown) {
  const response = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await response.json()) as any
  if (!response.ok) throw Object.assign(new Error(json.error?.message), { status: response.status })
  return json
}
const client = createPocketClient(10143, call)

async function seed(cap = 50_000_000n, balance = 20_000_000n) {
  const wallet = privateKeyToAccount(generatePrivateKey()),
    key = generatePrivateKey(),
    id = uuidv7(),
    phone = `+${nextPhone++}`
  const [pocket] = await db
    .insert(schema.ussdPockets)
    .values({
      id,
      ownerAddress: wallet.address.toLowerCase(),
      phone,
      pocketAddress: privateKeyToAccount(key).address.toLowerCase(),
      sealedKey: sealKey(key, id),
      pinHash: await hashSecret('4821'),
      cap,
      status: 'active',
    })
    .returning()
  state.balances.set(pocket!.pocketAddress, balance)
  const sign = (message: string) => wallet.signMessage({ message })
  return { wallet, pocket: pocket!, phone, sign }
}

let session = 0
async function dial(phone: string, text: string, sessionId = `cash-${++session}`) {
  const form = new URLSearchParams({
    sessionId,
    phoneNumber: phone,
    serviceCode: '*384*53916#',
    text,
  })
  const response = await app.request(`/v1/ussd/${config.KOVA_USSD_CALLBACK_SECRET}`, {
    method: 'POST',
    body: form,
  })
  return response.text()
}

const cashOutsOf = (pocketAddress: string) =>
  db.query.cashOuts.findMany({ where: eq(schema.cashOuts.walletAddress, pocketAddress) })

beforeAll(async () => {
  if (!/\/[^/?]*test[^/?]*(\?|$)/.test(config.DATABASE_URL))
    throw Error('Run these tests on a test database (its name must contain "test").')
  await runMigrations(config.DATABASE_URL)
})
beforeEach(async () => {
  await db.delete(schema.ussdSpends)
  await db.delete(schema.ussdPockets)
  await db.delete(schema.cashOuts)
  config.KOVA_POCKET_MASTER_KEY = 'ab'.repeat(32)
  config.KOVA_USSD_ENABLED = '1'
  config.KOVA_USSD_CALLBACK_SECRET = 'test-callback-secret-ussd-cashout'
  config.KOVA_USSD_CODE = '*384*53916#'
  config.KOVA_NETWORK = 'testnet'
  config.AT_USERNAME = 'sandbox'
  state.balances.clear()
  state.receipts.clear()
  state.authorizations.length = 0
  state.refunds.length = 0
  state.transfer = 'success'
  state.notify.mockReset()
})
afterAll(async () => {
  await db.$client.end()
})

describe('cashing out from a USSD pocket', () => {
  it('saves the one payout account only with the owner’s signature, and shows it masked', async () => {
    const { wallet, sign } = await seed()
    const stranger = privateKeyToAccount(generatePrivateKey())
    await expect(
      client.setPayout((m) => stranger.signMessage({ message: m }), wallet.address, {
        bankCode: '999992',
        accountNumber: '8012345678',
      }),
    ).rejects.toMatchObject({ status: 403 })
    const saved = (await client.setPayout(sign, wallet.address, {
      bankCode: '999992',
      accountNumber: '8012345678',
    })) as any
    expect(saved.payout).toEqual({
      label: 'OPay ••5678',
      bank_name: 'OPay Digital Services Limited (OPay)',
      account_name: 'ADA OBI',
      account_last4: '5678',
    })
    expect(saved.cash_out).toBe(true)
    expect(JSON.stringify(saved)).not.toContain('8012345678')
    const removed = (await client.setPayout(sign, wallet.address, null)) as any
    expect(removed.payout).toBeNull()
  })

  it('asks for an account first when none is saved', async () => {
    const { phone } = await seed()
    expect(await dial(phone, '')).toContain('5 Cash out')
    expect(await dial(phone, '5')).toMatch(/^END Add the account to cash out to/)
  })

  it('quotes the naira, pays the treasury from the pocket, and pays the account', async () => {
    const { wallet, pocket, phone, sign } = await seed()
    await client.setPayout(sign, wallet.address, {
      bankCode: '999992',
      accountNumber: '8012345678',
    })
    expect(await dial(phone, '5')).toBe('CON Cash out to OPay ••5678\nAmount in dollars:')
    // $10 at 1,500 less the 1% spread is ₦14,850, less Paystack's ₦25 transfer fee.
    expect(await dial(phone, '5*10')).toBe(
      'CON Cash out $10.00\nYou get ₦14,825.00\nto OPay ••5678\n\nEnter your PIN:',
    )
    const reply = await dial(phone, '5*10*4821')
    expect(reply).toMatch(/^END ₦14,825.00 is on its way to OPay ••5678\.\nRef K\w{5}\./)

    const [authorization] = state.authorizations
    expect(authorization.to.toLowerCase()).toBe(TREASURY)
    expect(authorization.value).toBe(10_000_000n)
    const [cashOut] = await cashOutsOf(pocket.pocketAddress)
    expect(authorization.nonce).toBe(encodeMemo({ kind: 'cashout', id: cashOut!.id }))
    await vi.waitFor(async () =>
      expect((await cashOutsOf(pocket.pocketAddress))[0]?.status).toBe('paid'),
    )
    await vi.waitFor(() =>
      expect(state.notify).toHaveBeenCalledWith(
        phone,
        expect.stringContaining('₦14,825.00 sent to OPay ••5678 for your $10.00'),
      ),
    )
    // The spend counts against the daily limit, like any other.
    const spend = await db.query.ussdSpends.findFirst({
      where: eq(schema.ussdSpends.pocketId, pocket.id),
    })
    expect(spend).toMatchObject({ kind: 'cashout', status: 'paid', cashOutId: cashOut!.id })
  })

  it('sends the dollars back to the pocket when the bank refuses', async () => {
    const { wallet, pocket, phone, sign } = await seed()
    await client.setPayout(sign, wallet.address, {
      bankCode: '999992',
      accountNumber: '8012345678',
    })
    state.transfer = 'failed'
    await dial(phone, '5*4*4821')
    await vi.waitFor(async () =>
      expect((await cashOutsOf(pocket.pocketAddress))[0]?.status).toBe('failed'),
    )
    expect(state.refunds).toEqual([{ to: pocket.pocketAddress, amount: 4_000_000n }])
    await vi.waitFor(() =>
      expect(state.notify).toHaveBeenCalledWith(
        phone,
        expect.stringContaining('didn’t reach OPay ••5678, so the dollars are back in your pocket'),
      ),
    )
  })

  it('keeps to the daily limit and the PIN', async () => {
    const { wallet, pocket, phone, sign } = await seed(5_000_000n)
    await client.setPayout(sign, wallet.address, {
      bankCode: '999992',
      accountNumber: '8012345678',
    })
    expect(await dial(phone, '5*6*4821')).toBe('END That’s over your $5.00 daily limit.')
    expect(state.authorizations).toHaveLength(0)
    expect(await dial(phone, '5*2*1111')).toBe('END Wrong PIN. 2 tries left.')
    // The refused cash-out ended unpaid; the wrong PIN never made one.
    const made = await cashOutsOf(pocket.pocketAddress)
    expect(made.map((c) => c.status)).toEqual(['failed'])
  })
})
