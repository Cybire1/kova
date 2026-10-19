import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { runMigrations, schema } from '@kova/db'
import {
  createPhoneClient,
  getNetwork,
  getToken,
  phoneMessage,
  phonePaymentNonce,
  type PhoneApproval,
  type PhonePayment,
} from '@kova/monad'
import {
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  getAddress,
  type Address,
  type Hex,
  type TransactionReceipt,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  balances: new Map<string, bigint>(),
  receipts: new Map<string, TransactionReceipt>(),
  used: new Set<string>(),
  sms: vi.fn(),
  relay: vi.fn(),
  mode: 'paid',
  last: null as any,
}))
vi.mock('../src/chain.js', async () => {
  const { getNetwork, getToken } = await import('@kova/monad')
  return {
    network: getNetwork('testnet'),
    settlementToken: getToken('testnet', 'AUSD'),
    publicClient: {
      readContract: async ({ functionName, args }: any) =>
        functionName === 'authorizationState'
          ? state.used.has(args[1])
          : (state.balances.get(args[0].toLowerCase()) ?? 0n),
      getTransactionReceipt: async ({ hash }: any) => {
        const r = state.receipts.get(hash)
        if (!r) throw Error('not found')
        return r
      },
    },
  }
})
vi.mock('../src/services/sms.js', () => ({
  smsReady: () => true,
  sendSms: state.sms,
  sendSmsLater: vi.fn(),
}))
vi.mock('../src/relay.js', () => ({ relayReady: () => true, relayAuthorization: state.relay }))
const { config } = await import('../src/config.js')
const { db } = await import('../src/db.js')
const { phoneRoutes } = await import('../src/routes/phone.js')
const { linkRoutes } = await import('../src/routes/links.js')
const { errorHandler } = await import('../src/errors.js')
const { phonePayment, recoverPhonePayments, verifiedWalletForPhone } = await import(
  '../src/services/phone-payments.js'
)
const app = new Hono().onError(errorHandler).route('/v1', phoneRoutes).route('/v1', linkRoutes)
let phoneN = 2348050000000
let testIp = 0
const makePhone = () => `+${phoneN++}`
const wallet = () => privateKeyToAccount(generatePrivateKey())
const sign = (w: ReturnType<typeof wallet>) => (message: string) => w.signMessage({ message })
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `phone-test-${testIp}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const result = (await response.json()) as any
  if (!response.ok) throw Error(result.error?.message ?? 'request failed')
  return result as T
}
const client = createPhoneClient(10143, request)
function receipt(auth: any, hash: Hex): TransactionReceipt {
  return {
    status: 'success',
    transactionHash: hash,
    logs: [
      {
        address: getToken('testnet', 'AUSD').address,
        topics: encodeEventTopics({
          abi: erc20Abi,
          eventName: 'Transfer',
          args: { from: auth.from, to: auth.to },
        }),
        data: encodeAbiParameters([{ type: 'uint256' }], [auth.value]),
      },
    ],
  } as unknown as TransactionReceipt
}
async function reserve(amount = '1.00', phone = makePhone()) {
  const sender = wallet(),
    key = generatePrivateKey(),
    address = privateKeyToAccount(key).address
  const input = { phone, address, amount, name: 'Demo sender', note: 'Lunch' }
  const payment = await client.reserve(sign(sender), sender.address, input, key)
  return { sender, key, input, payment, phone }
}
async function pocketFor(owner: ReturnType<typeof wallet>, phone = makePhone(), status = 'active') {
  const address = wallet().address.toLowerCase()
  await db.insert(schema.ussdPockets).values({
    id: crypto.randomUUID(),
    ownerAddress: owner.address.toLowerCase(),
    phone,
    pocketAddress: address,
    sealedKey: 'test fixture only',
    pinHash: 'test fixture only',
    cap: 10_000_000n,
    status,
  })
  return { phone, address }
}
async function funded() {
  const test = await reserve()
  state.balances.set(test.payment.address.toLowerCase(), 1_000_000n)
  test.payment = await client.confirm(sign(test.sender), test.sender.address, test.payment.id)
  return test
}
async function verified(test: Awaited<ReturnType<typeof funded>>, recipient = wallet()) {
  await client.requestCode(sign(recipient), recipient.address, test.payment.id, test.phone)
  const code = state.sms.mock.calls.at(-1)![1].match(/\b(\d{6})\b/)![1]
  await client.verify(sign(recipient), recipient.address, test.payment.id, test.phone, code)
  return recipient
}
beforeAll(async () => {
  if (!config.DATABASE_URL.endsWith('/kova_ussd_test_20261019'))
    throw Error('Use the isolated USSD test database.')
  await runMigrations(config.DATABASE_URL)
})
beforeEach(async () => {
  testIp++
  await db.delete(schema.ussdSpends)
  await db.delete(schema.ussdPockets)
  await db.delete(schema.paymentLinks)
  await db.delete(schema.phoneAccounts)
  state.balances.clear()
  state.receipts.clear()
  state.used.clear()
  state.sms.mockReset()
  state.relay.mockReset()
  state.mode = 'paid'
  config.KOVA_NETWORK = 'testnet'
  config.KOVA_PHONE_WEB_URL = undefined
  config.AT_USERNAME = 'sandbox'
  config.KOVA_PHONE_SEND_ENABLED = '1'
  config.KOVA_USSD_ENABLED = '1'
  config.KOVA_POCKET_MASTER_KEY = 'ab'.repeat(32)
  state.sms.mockResolvedValue(undefined)
  state.relay.mockImplementation(
    async (_token: unknown, auth: any, _signature: unknown, options: any) => {
      if (state.used.has(auth.nonce)) throw Error('nonce used')
      const hash =
        `0x${'ab'.repeat(31)}${String(state.relay.mock.calls.length).padStart(2, '0')}` as Hex
      state.last = { auth, hash }
      await options.beforeBroadcast(hash)
      if (state.mode === 'unknown') throw Error('broadcast timed out')
      const r = receipt(auth, hash)
      state.receipts.set(hash, r)
      state.used.add(auth.nonce)
      state.balances.set(auth.from.toLowerCase(), 0n)
      return { receipt: r, ms: 10 }
    },
  )
})
describe('phone payments', () => {
  it('uses the configured demo website for phone invitations', async () => {
    config.KOVA_PHONE_WEB_URL = 'https://mykova.app/'
    const t = await reserve()
    expect(t.payment.url).toBe(`https://mykova.app/wallet/phone/${t.payment.id}`)
  })

  it('reserves the pending account before any money moves, with no secrets in public data', async () => {
    const t = await reserve()
    expect(t.payment.status).toBe('funding')
    const raw = JSON.stringify(await client.get(t.payment.id))
    expect(raw).not.toContain(t.phone)
    expect(raw).not.toContain(t.key)
    expect(raw).not.toContain('phone_key')
    expect(await client.resolve(sign(t.sender), t.sender.address, t.phone)).toEqual({
      address: null,
      destination: null,
    })
    expect(state.sms).not.toHaveBeenCalled()
    expect(state.relay).not.toHaveBeenCalled()
  })
  it('is idempotent for the same recovery address and refuses changing its recipient', async () => {
    const t = await reserve()
    expect((await client.reserve(sign(t.sender), t.sender.address, t.input, t.key)).id).toBe(
      t.payment.id,
    )
    await expect(
      client.reserve(sign(t.sender), t.sender.address, { ...t.input, phone: makePhone() }, t.key),
    ).rejects.toThrow('already in use')
  })
  it('does not expose an SMS invitation until the funding arrives', async () => {
    const t = await reserve()
    expect((await client.confirm(sign(t.sender), t.sender.address, t.payment.id)).status).toBe(
      'funding',
    )
    expect(state.sms).not.toHaveBeenCalled()
    state.balances.set(t.payment.address.toLowerCase(), 1_000_000n)
    const p = await client.confirm(sign(t.sender), t.sender.address, t.payment.id)
    expect(p.status).toBe('open')
    expect(p.sms_sent).toBe(true)
    expect(state.sms.mock.calls[0]![1]).not.toContain(t.key)
  })
  it('preserves a funded payment and recovery when SMS is rejected', async () => {
    state.sms.mockRejectedValue(Error('provider rejected'))
    const t = await funded()
    expect(t.payment.status).toBe('open')
    expect(t.payment.sms_sent).toBe(false)
    const p = await client.takeBack(sign(t.sender), t.sender.address, t.payment.id)
    expect(p.status).toBe('returned')
  })
  it('requires phone verification; another wallet cannot claim or cancel', async () => {
    const t = await funded(),
      stranger = wallet()
    await expect(client.claim(sign(stranger), stranger.address, t.payment.id)).rejects.toThrow(
      'Verify',
    )
    await expect(client.takeBack(sign(stranger), stranger.address, t.payment.id)).rejects.toThrow(
      'Only the sender',
    )
    await expect(
      client.requestCode(sign(stranger), stranger.address, t.payment.id, makePhone()),
    ).rejects.toThrow('Check the phone')
    expect(state.relay).not.toHaveBeenCalled()
  })
  it('commits all five failed OTP attempts and binds the code to the requesting wallet', async () => {
    const t = await funded(),
      recipient = wallet(),
      stranger = wallet()
    await client.requestCode(sign(recipient), recipient.address, t.payment.id, t.phone)
    const code = state.sms.mock.calls.at(-1)![1].match(/\b(\d{6})\b/)![1]
    await expect(
      client.verify(sign(stranger), stranger.address, t.payment.id, t.phone, code),
    ).rejects.toThrow('expired or is locked')
    const bad = code === '000000' ? '111111' : '000000'
    for (let i = 0; i < 5; i++)
      await expect(
        client.verify(sign(recipient), recipient.address, t.payment.id, t.phone, bad),
      ).rejects.toThrow('isn’t right')
    expect((await phonePayment(t.payment.id)).phoneCodeTries).toBe(5)
    await expect(
      client.verify(sign(recipient), recipient.address, t.payment.id, t.phone, code),
    ).rejects.toThrow('expired or is locked')
    await expect(
      client.requestCode(sign(recipient), recipient.address, t.payment.id, t.phone),
    ).rejects.toThrow('already requested')
  })
  it('activates the verified account and settles once to its Kova wallet', async () => {
    const t = await funded(),
      recipient = await verified(t)
    expect((await client.resolve(sign(t.sender), t.sender.address, t.phone)).address).toBe(
      recipient.address,
    )
    const p = await client.claim(sign(recipient), recipient.address, t.payment.id)
    expect(p.status).toBe('claimed')
    expect(state.last.auth.to).toBe(recipient.address)
    expect(state.last.auth.nonce).toBe(phonePaymentNonce(10143, t.payment.id))
    expect((await client.claim(sign(recipient), recipient.address, t.payment.id)).status).toBe(
      'claimed',
    )
    expect(state.relay).toHaveBeenCalledTimes(1)
  })
  it('blocks the ordinary bearer-link claim endpoint for a phone payment', async () => {
    const t = await funded()
    const r = await app.request(`/v1/public/links/${t.payment.id}/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(r.status).toBe(409)
    expect(state.relay).not.toHaveBeenCalled()
  })
  it('allows signed sender recovery even when new phone sends are paused', async () => {
    const t = await funded()
    config.KOVA_PHONE_SEND_ENABLED = '0'
    await expect(client.resolve(sign(t.sender), t.sender.address, t.phone)).rejects.toThrow(
      'isn’t available',
    )
    expect((await client.takeBack(sign(t.sender), t.sender.address, t.payment.id)).status).toBe(
      'returned',
    )
  })
  it('persists unknown broadcasts and recovers the exact receipt without redirecting money', async () => {
    const t = await funded(),
      recipient = await verified(t)
    state.mode = 'unknown'
    const p = await client.claim(sign(recipient), recipient.address, t.payment.id)
    expect(p.status).toBe('claiming')
    expect(p.tx_hash).toBeTruthy()
    await expect(client.takeBack(sign(t.sender), t.sender.address, t.payment.id)).rejects.toThrow(
      'already being',
    )
    state.receipts.set(state.last.hash, receipt(state.last.auth, state.last.hash))
    await recoverPhonePayments()
    expect((await client.get(t.payment.id)).status).toBe('claimed')
    expect(state.relay).toHaveBeenCalledTimes(1)
  })
  it('releases a claim that was never mined once its authorization expires, and pays it once', async () => {
    const t = await funded(),
      recipient = await verified(t)
    state.mode = 'unknown'
    const stuck = await client.claim(sign(recipient), recipient.address, t.payment.id)
    expect(stuck.status).toBe('claiming')
    // Still inside its 5-minute window: nothing is released.
    await recoverPhonePayments()
    expect((await client.get(t.payment.id)).status).toBe('claiming')
    expect(state.relay).toHaveBeenCalledTimes(1)
    // The window passes and the token never saw the authorization: a fresh claim goes out.
    const row = await phonePayment(t.payment.id)
    await db
      .update(schema.paymentLinks)
      .set({ phoneOperationAt: row.phoneOperationAt! - 400 })
      .where(eq(schema.paymentLinks.id, row.id))
    state.mode = 'paid'
    await recoverPhonePayments()
    const done = await client.get(t.payment.id)
    expect(done.status).toBe('claimed')
    expect(state.relay).toHaveBeenCalledTimes(2)
    expect(state.last.auth.to).toBe(recipient.address)
  })
  it('keeps waiting when the expired authorization was used (its receipt is still coming)', async () => {
    const t = await funded(),
      recipient = await verified(t)
    state.mode = 'unknown'
    await client.claim(sign(recipient), recipient.address, t.payment.id)
    const row = await phonePayment(t.payment.id)
    await db
      .update(schema.paymentLinks)
      .set({ phoneOperationAt: row.phoneOperationAt! - 400 })
      .where(eq(schema.paymentLinks.id, row.id))
    state.used.add(state.last.auth.nonce)
    await recoverPhonePayments()
    expect((await phonePayment(t.payment.id)).claimTx).toBe(row.claimTx)
    expect(state.relay).toHaveBeenCalledTimes(1)
  })
  it('a code requested by another wallet does not lock the recipient out', async () => {
    const t = await funded(),
      stranger = wallet()
    await client.requestCode(sign(stranger), stranger.address, t.payment.id, t.phone)
    const recipient = await verified(t)
    expect((await client.claim(sign(recipient), recipient.address, t.payment.id)).status).toBe(
      'claimed',
    )
  })
  it('after claiming one payment, the same number can verify its next payment right away', async () => {
    const first = await funded(),
      recipient = await verified(first)
    await client.claim(sign(recipient), recipient.address, first.payment.id)
    const second = await reserve('1.00', first.phone)
    state.balances.set(second.payment.address.toLowerCase(), 1_000_000n)
    second.payment = await client.confirm(
      sign(second.sender),
      second.sender.address,
      second.payment.id,
    )
    await verified(second, recipient)
    expect((await client.claim(sign(recipient), recipient.address, second.payment.id)).status).toBe(
      'claimed',
    )
  })
  it('accepts a sender name exactly as signed, and stores it trimmed', async () => {
    const sender = wallet(),
      key = generatePrivateKey(),
      phone = makePhone()
    const input = {
      phone,
      address: privateKeyToAccount(key).address,
      amount: '1.00',
      name: 'Ada  ',
      note: 'x',
    }
    const p = await client.reserve(sign(sender), sender.address, input, key)
    expect(p.sender_name).toBe('Ada')
  })
  it('resolves an active USSD number to its pocket while preserving its owner identity', async () => {
    const sender = wallet(),
      owner = wallet()
    const p = await pocketFor(owner)
    expect(await client.resolve(sign(sender), sender.address, p.phone)).toEqual({
      address: getAddress(p.address),
      destination: 'ussd-pocket',
    })
    expect(await verifiedWalletForPhone(p.phone)).toBe(owner.address)
    expect(state.relay).not.toHaveBeenCalled()
  })
  it('uses the main wallet when USSD is paused, and never routes to a pending or closed pocket', async () => {
    const sender = wallet(),
      owner = wallet()
    const p = await pocketFor(owner)
    config.KOVA_USSD_ENABLED = '0'
    expect(await client.resolve(sign(sender), sender.address, p.phone)).toEqual({
      address: owner.address,
      destination: 'wallet',
    })
    config.KOVA_USSD_ENABLED = '1'
    for (const status of ['pending', 'closed']) {
      const inactive = await pocketFor(wallet(), makePhone(), status)
      expect(await client.resolve(sign(sender), sender.address, inactive.phone)).toEqual({
        address: null,
        destination: null,
      })
    }
  })
  it('refuses conflicting wallet identities instead of routing to either wallet or pocket', async () => {
    const sender = wallet(),
      owner = wallet(),
      other = wallet()
    const p = await pocketFor(owner)
    await db
      .insert(schema.phoneAccounts)
      .values({
        id: crypto.randomUUID(),
        network: 'testnet',
        phone: p.phone,
        wallet: other.address.toLowerCase(),
        verifiedAt: new Date(),
      })
    expect(await client.resolve(sign(sender), sender.address, p.phone)).toEqual({
      address: null,
      destination: null,
    })
  })
  it('keeps phone ownership tied to the verified wallet after claiming', async () => {
    const t = await funded(),
      recipient = await verified(t)
    const record = await db.query.phoneAccounts.findFirst()
    expect(record?.wallet).toBe(recipient.address.toLowerCase())
    const stranger = wallet()
    await expect(
      client.requestCode(sign(stranger), stranger.address, t.payment.id, t.phone),
    ).rejects.toThrow('another wallet')
  })
  it('rejects network-swapped and tampered wallet approvals', async () => {
    const sender = wallet(),
      p: PhoneApproval = {
        action: 'resolve',
        wallet: sender.address,
        chainId: 143,
        signedAt: Math.floor(Date.now() / 1000),
        phone: makePhone(),
      }
    const signature = await sender.signMessage({ message: phoneMessage(p) })
    await expect(request('POST', '/v1/phone/resolve', { ...p, signature })).rejects.toThrow(
      'another network',
    )
    await expect(
      request('POST', '/v1/phone/resolve', { ...p, chainId: 10143, signature }),
    ).rejects.toThrow('Approve')
  })
  it('serializes recipient claim against sender cancellation', async () => {
    const t = await funded(),
      recipient = await verified(t)
    const results = await Promise.allSettled([
      client.claim(sign(recipient), recipient.address, t.payment.id),
      client.takeBack(sign(t.sender), t.sender.address, t.payment.id),
    ])
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true)
    expect(state.relay).toHaveBeenCalledTimes(1)
    expect(['claimed', 'returned']).toContain((await client.get(t.payment.id)).status)
  })
  it('recovers funding and sends the invitation after the sender closes the page', async () => {
    const t = await reserve()
    state.balances.set(t.payment.address.toLowerCase(), 1_000_000n)
    await recoverPhonePayments()
    expect((await client.get(t.payment.id)).status).toBe('open')
    expect(state.sms).toHaveBeenCalledTimes(1)
    await recoverPhonePayments()
    expect(state.sms).toHaveBeenCalledTimes(1)
  })
})
