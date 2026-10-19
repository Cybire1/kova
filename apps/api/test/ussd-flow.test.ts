import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { runMigrations, schema, uuidv7 } from '@kova/db'
import {
  createPocketClient,
  encodeMemo,
  getNetwork,
  getToken,
  pocketMessage,
  pocketPinCommitment,
} from '@kova/monad'
import {
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  type Hex,
  type TransactionReceipt,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  balances: new Map<string, bigint>(),
  receipts: new Map<string, unknown>(),
  authorizations: new Map<string, any>(),
  mode: 'paid',
  sms: vi.fn(),
  notify: vi.fn(),
  relay: vi.fn(),
}))
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
      // In these fakes the tx hash is the authorization's nonce, so a receipt means it was used.
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
  sendSms: state.sms,
  sendSmsLater: state.notify,
}))
vi.mock('../src/services/settle.js', () => ({ settleFromReceipt: vi.fn(async () => {}) }))
vi.mock('../src/relay.js', () => ({ relayReady: () => true, relayAuthorization: state.relay }))

const { config } = await import('../src/config.js')
const { db } = await import('../src/db.js')
const { errorHandler, KovaError } = await import('../src/errors.js')
const { hashSecret, sealKey } = await import('../src/secrets.js')
const { ussdRoutes } = await import('../src/routes/ussd.js')
const {
  checkPin,
  confirmPhone,
  pocketOf,
  reconcilePocket,
  reconcilePendingPockets,
  spend,
  spentToday,
  tillCodeFor,
} = await import('../src/services/pockets.js')
const app = new Hono().onError(errorHandler).route('/v1', ussdRoutes)
const { checkoutRoutes } = await import('../src/routes/checkout.js')
app.route('/v1/checkout', checkoutRoutes)
const chainId = 10143
let nextPhone = 2348001000000
const newPhone = () => `+${nextPhone++}`
const now = () => Math.floor(Date.now() / 1000)

async function call(method: string, path: string, body?: unknown) {
  const response = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await response.json()) as any
  if (!response.ok)
    throw Object.assign(new Error(json.error?.message), { status: response.status, body: json })
  return json
}
const client = () => createPocketClient(chainId, call)
const owner = () => privateKeyToAccount(generatePrivateKey())
const signer = (wallet: ReturnType<typeof owner>) => (message: string) =>
  wallet.signMessage({ message })
const otp = () => String(state.sms.mock.calls.at(-1)?.[1]).match(/\b\d{6}\b/)![0]
async function seed(options: { cap?: bigint; balance?: bigint; phone?: string } = {}) {
  const wallet = owner(),
    key = generatePrivateKey(),
    account = privateKeyToAccount(key),
    id = uuidv7(),
    phone = options.phone ?? newPhone()
  const [pocket] = await db
    .insert(schema.ussdPockets)
    .values({
      id,
      ownerAddress: wallet.address.toLowerCase(),
      phone,
      pocketAddress: account.address.toLowerCase(),
      sealedKey: sealKey(key, id),
      pinHash: await hashSecret('4821'),
      cap: options.cap ?? 10_000_000n,
      status: 'active',
    })
    .returning()
  state.balances.set(pocket!.pocketAddress, options.balance ?? 5_000_000n)
  return { wallet, pocket: pocket!, phone }
}
function receipt(
  hash: Hex,
  authorization: any,
  status: 'success' | 'reverted' = 'success',
): TransactionReceipt {
  return {
    transactionHash: hash,
    status,
    blockNumber: 1n,
    logs:
      status === 'reverted'
        ? []
        : [
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
}

beforeAll(async () => {
  if (!config.DATABASE_URL.endsWith('/kova_ussd_test_20261019'))
    throw Error('Use the dedicated isolated USSD test database.')
  await runMigrations(config.DATABASE_URL)
})
beforeEach(async () => {
  await db.delete(schema.ussdSpends)
  await db.delete(schema.ussdPockets)
  config.KOVA_POCKET_MASTER_KEY = 'ab'.repeat(32)
  config.KOVA_USSD_ENABLED = '1'
  config.KOVA_USSD_CALLBACK_SECRET = 'test-callback-secret-ussd-flow'
  config.KOVA_USSD_CODE = '*384*53916#'
  config.KOVA_NETWORK = 'testnet'
  config.AT_USERNAME = 'sandbox'
  state.balances.clear()
  state.receipts.clear()
  state.authorizations.clear()
  state.sms.mockReset().mockResolvedValue(undefined)
  state.notify.mockReset()
  state.mode = 'paid'
  state.relay.mockReset().mockImplementation(async (_token, authorization, _signature, options) => {
    if (state.mode === 'pre') throw new KovaError('policy_declined', 'Refused before broadcast.')
    const hash = authorization.nonce as Hex
    state.authorizations.set(hash, authorization)
    await options?.beforeBroadcast?.(hash)
    await new Promise((resolve) => setTimeout(resolve, 20))
    if (state.mode === 'unknown')
      throw new KovaError('chain_error', 'Not yet confirmed.', { tx_hash: hash })
    const result = receipt(hash, authorization, state.mode === 'reverted' ? 'reverted' : 'success')
    state.receipts.set(hash, result)
    if (result.status === 'success')
      state.balances.set(
        authorization.from.toLowerCase(),
        (state.balances.get(authorization.from.toLowerCase()) ?? 0n) - authorization.value,
      )
    return { receipt: result, ms: 20 }
  })
})
afterAll(async () => {
  await db.$client.end()
})

describe('USSD setup and payments with real database reservations', () => {
  it('shows an eligible till code on checkout and pays it through the USSD menu', async () => {
    const { pocket, phone } = await seed(),
      shopId = uuidv7(),
      intentId = uuidv7(),
      payTo = owner().address
    await db.insert(schema.merchants).values({
      id: shopId,
      name: 'USSD test shop',
      slug: `ussd-${shopId}`,
      settlementAddress: payTo,
      network: 'testnet',
      isTest: true,
    })
    const [intent] = await db
      .insert(schema.paymentIntents)
      .values({
        id: intentId,
        merchantId: shopId,
        network: 'testnet',
        currency: 'AUSD',
        tokenAddress: getToken('testnet', 'AUSD').address,
        payTo,
        amount: 500_000n,
        memo: encodeMemo({ kind: 'payment', id: intentId }),
        expiresAt: new Date(Date.now() + 600_000),
      })
      .returning()
    const { encodeId } = await import('../src/ids.js')
    const checkout = await call('GET', `/v1/checkout/${encodeId('paymentIntent', intentId)}`)
    expect(checkout.ussd).toMatchObject({
      code: expect.stringMatching(/^\d{6}$/),
      dial: '*384*53916#',
    })
    expect(await tillCodeFor({ ...intent!, tokenAddress: owner().address })).toBeNull()
    expect(await tillCodeFor({ ...intent!, amount: 0n })).toBeNull()
    expect(await tillCodeFor({ ...intent!, metadata: { payer: pocket.ownerAddress } })).toBeNull()
    const form = new URLSearchParams({
      sessionId: 'till-test',
      phoneNumber: phone,
      serviceCode: '*384*53916#',
      text: `2*${checkout.ussd.code}*4821`,
    })
    const reply = await (
      await app.request(`/v1/ussd/${config.KOVA_USSD_CALLBACK_SECRET}`, {
        method: 'POST',
        body: form,
      })
    ).text()
    expect(reply).toContain('Paid $0.50 to USSD test shop')
    expect(state.authorizations.values().next().value.nonce).toBe(intent!.memo)
  })
  it('links a phone only after its OTP and masks it in public pocket responses', async () => {
    const wallet = owner(),
      api = client(),
      phone = newPhone()
    const pending = await api.setUpPocket(signer(wallet), wallet.address, {
      phone,
      pin: '4821',
      cap: '10',
    })
    expect(pending.status).toBe('pending')
    const active = await api.confirmCode(wallet.address, otp())
    expect(active.status).toBe('active')
    expect((await api.getPocket(wallet.address)) as any).toMatchObject({
      phone: expect.stringContaining('…'),
      dial: '*384*53916#',
    })
    expect(JSON.stringify(await api.getPocket(wallet.address))).not.toContain(phone)
  })

  it('rejects a substituted PIN and a signature from a different chain', async () => {
    const wallet = owner(),
      phone = newPhone(),
      pin_nonce = `0x${'11'.repeat(32)}` as Hex,
      signed_at = now()
    const signed = {
      action: 'setup' as const,
      wallet: wallet.address,
      chainId,
      phone,
      cap: 10_000_000n,
      pinCommitment: pocketPinCommitment(wallet.address, chainId, '4821', pin_nonce),
      signedAt: signed_at,
    }
    const signature = await wallet.signMessage({ message: pocketMessage(signed) })
    await expect(
      call('PUT', `/v1/wallets/${wallet.address}/ussd-pocket`, {
        phone,
        pin: '7392',
        pin_nonce,
        cap: '10',
        signed_at,
        signature,
      }),
    ).rejects.toMatchObject({ status: 403 })
    const wrong = await wallet.signMessage({ message: pocketMessage({ ...signed, chainId: 143 }) })
    await expect(
      call('PUT', `/v1/wallets/${wallet.address}/ussd-pocket`, {
        phone,
        pin: '4821',
        pin_nonce,
        cap: '10',
        signed_at,
        signature: wrong,
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('commits simultaneous wrong-code attempts and locks the challenge', async () => {
    const wallet = owner(),
      api = client()
    await api.setUpPocket(signer(wallet), wallet.address, {
      phone: newPhone(),
      pin: '4821',
      cap: '10',
    })
    const correct = otp(),
      wrong = correct === '000000' ? '111111' : '000000'
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => confirmPhone(wallet.address, wrong)),
    )
    expect(results.every((result) => result.status === 'rejected')).toBe(true)
    const current = await pocketOf(wallet.address)
    expect(current!.failedPins).toBe(5)
    await expect(confirmPhone(wallet.address, correct)).rejects.toMatchObject({
      code: 'rate_limited',
    })
  })

  it('allows only one active pocket per verified phone', async () => {
    const a = owner(),
      b = owner(),
      phone = newPhone(),
      api = client()
    await api.setUpPocket(signer(a), a.address, { phone, pin: '4821', cap: '10' })
    const first = otp()
    await api.setUpPocket(signer(b), b.address, { phone, pin: '7392', cap: '10' })
    const second = otp()
    await api.confirmCode(a.address, first)
    await expect(api.confirmCode(b.address, second)).rejects.toMatchObject({ status: 409 })
  })

  it('counts simultaneous wrong PINs against one lockout counter', async () => {
    const { pocket } = await seed()
    const results = await Promise.all(Array.from({ length: 3 }, () => checkPin(pocket, '7392')))
    expect(results.filter((result) => !result.ok && result.locked)).toHaveLength(1)
    expect((await pocketOf(pocket.ownerAddress as Hex))!.failedPins).toBe(3)
    expect(await checkPin(pocket, '4821')).toMatchObject({ ok: false, locked: true })
  })

  it('reserves the daily limit across simultaneous sessions', async () => {
    const { pocket } = await seed({ cap: 3_000_000n })
    state.mode = 'unknown'
    const request = {
      kind: 'phone' as const,
      to: owner().address,
      toLabel: newPhone(),
      amount: 2_000_000n,
    }
    const result = await Promise.allSettled(
      ['a', 'b'].map((sessionId) => spend(pocket, { ...request, sessionId })),
    )
    expect(result.filter((value) => value.status === 'fulfilled')).toHaveLength(1)
    expect(result.filter((value) => value.status === 'rejected')).toHaveLength(1)
    expect(await spentToday(pocket)).toBe(2_000_000n)
    expect(state.relay).toHaveBeenCalledOnce()
  })

  it('returns the same receipt for a retry and rejects a changed payment in that session', async () => {
    const { pocket } = await seed(),
      request = {
        sessionId: 'retry',
        kind: 'phone' as const,
        to: owner().address,
        toLabel: newPhone(),
        amount: 1_000_000n,
      }
    const first = await spend(pocket, request),
      again = await spend(pocket, request)
    expect(again.txHash).toBe(first.txHash)
    expect(state.relay).toHaveBeenCalledOnce()
    expect(state.notify).toHaveBeenCalledTimes(2)
    await expect(spend(pocket, { ...request, amount: 2_000_000n })).rejects.toMatchObject({
      code: 'idempotency_conflict',
    })
  })

  it('keeps unknown broadcasts pending and sends receipts once after reconciliation', async () => {
    const { pocket } = await seed()
    state.mode = 'unknown'
    const pending = await spend(pocket, {
      sessionId: 'slow',
      kind: 'phone',
      to: owner().address,
      toLabel: newPhone(),
      amount: 2_000_000n,
    })
    expect(pending.status).toBe('pending')
    expect(pending.txHash).toBeTruthy()
    expect(state.notify).not.toHaveBeenCalled()
    expect(await spentToday(pocket)).toBe(2_000_000n)
    const authorization = state.authorizations.get(pending.txHash!)
    state.receipts.set(pending.txHash!, receipt(pending.txHash as Hex, authorization))
    state.balances.set(pocket.pocketAddress, 3_000_000n)
    await Promise.all([reconcilePendingPockets(), reconcilePendingPockets()])
    expect(state.notify).toHaveBeenCalledTimes(2)
    const rows = await db.select().from(schema.ussdSpends)
    expect(rows[0]!.status).toBe('paid')
  })

  it('releases a broadcast that was never mined once its authorization expires', async () => {
    const { pocket } = await seed()
    state.mode = 'unknown'
    const pending = await spend(pocket, {
      sessionId: 'dropped',
      kind: 'phone',
      to: owner().address,
      toLabel: newPhone(),
      amount: 2_000_000n,
    })
    expect(pending.status).toBe('pending')
    // Inside its 5-minute window the reservation holds.
    await reconcilePendingPockets()
    expect(await spentToday(pocket)).toBe(2_000_000n)
    await db
      .update(schema.ussdSpends)
      .set({ createdAt: new Date(Date.now() - 400_000) })
      .where(eq(schema.ussdSpends.id, pending.id))
    await reconcilePendingPockets()
    const [row] = await db.select().from(schema.ussdSpends)
    expect(row!.status).toBe('failed')
    expect(await spentToday(pocket)).toBe(0n)
    expect(state.notify).not.toHaveBeenCalled()
  })

  it('keeps an expired broadcast pending while the token shows it was used', async () => {
    const { pocket } = await seed()
    state.mode = 'unknown'
    const pending = await spend(pocket, {
      sessionId: 'lagging',
      kind: 'phone',
      to: owner().address,
      toLabel: newPhone(),
      amount: 1_000_000n,
    })
    await db
      .update(schema.ussdSpends)
      .set({ createdAt: new Date(Date.now() - 400_000) })
      .where(eq(schema.ussdSpends.id, pending.id))
    // Used on chain, but this RPC hasn't returned its receipt yet.
    state.receipts.set(pending.txHash!, 'used')
    const realGet = state.receipts.get.bind(state.receipts)
    state.receipts.get = (k: string) => (k === pending.txHash ? undefined : realGet(k))
    await reconcilePendingPockets()
    state.receipts.get = realGet
    const [row] = await db.select().from(schema.ussdSpends)
    expect(row!.status).toBe('pending')
  })

  it('does not let withdrawals spend dollars reserved by an unconfirmed payment', async () => {
    const { pocket } = await seed()
    state.mode = 'unknown'
    await spend(pocket, {
      sessionId: 'pending',
      kind: 'phone',
      to: owner().address,
      toLabel: newPhone(),
      amount: 4_000_000n,
    })
    await expect(
      spend(pocket, {
        sessionId: 'withdraw',
        kind: 'withdraw',
        to: pocket.ownerAddress as Hex,
        toLabel: 'your wallet',
        amount: 5_000_000n,
      }),
    ).rejects.toMatchObject({ code: 'policy_declined' })
  })

  it('releases a reverted payment reservation and never sends a success receipt', async () => {
    const { pocket } = await seed()
    state.mode = 'reverted'
    const result = await spend(pocket, {
      sessionId: 'revert',
      kind: 'phone',
      to: owner().address,
      toLabel: newPhone(),
      amount: 1_000_000n,
    })
    expect(result.status).toBe('failed')
    expect(await spentToday(pocket)).toBe(0n)
    expect(state.notify).not.toHaveBeenCalled()
  })

  it('allows owner recovery while USSD is paused and blocks new setup', async () => {
    const { wallet, pocket } = await seed()
    config.KOVA_USSD_ENABLED = '0'
    const api = client()
    expect((await api.info()).enabled).toBe(false)
    await expect(
      api.setUpPocket(signer(wallet), wallet.address, {
        phone: newPhone(),
        pin: '4821',
        cap: '10',
      }),
    ).rejects.toMatchObject({ status: 409 })
    const returned = await api.takeBack(signer(wallet), wallet.address, '5')
    expect(returned.status).toBe('active')
    expect((returned as any).balance).toBe('0.00')
    expect(state.authorizations.values().next().value.to.toLowerCase()).toBe(pocket.ownerAddress)
  })

  it('takes decimal phone payments through the actual callback menu', async () => {
    const sender = await seed(),
      recipient = await seed(),
      post = async (text: string) => {
        const form = new URLSearchParams({
          sessionId: 'menu-test',
          phoneNumber: sender.phone,
          serviceCode: '*384*53916#',
          text,
        })
        return (
          await app.request(`/v1/ussd/${config.KOVA_USSD_CALLBACK_SECRET}`, {
            method: 'POST',
            body: form,
          })
        ).text()
      }
    expect(await post('')).toContain('CON Kova')
    expect(await post('1*4821')).toContain('Pocket: $5.00')
    const final = await post(`3*${recipient.phone.slice(1)}*0.50*4821`)
    expect(final).toContain('Paid $0.50')
    expect(state.authorizations.values().next().value.to.toLowerCase()).toBe(
      recipient.wallet.address.toLowerCase(),
    )
    expect(await post(`3*${recipient.phone.slice(1)}*0.50*4821`)).toContain('Paid $0.50')
    expect(state.relay).toHaveBeenCalledOnce()
  })
})
