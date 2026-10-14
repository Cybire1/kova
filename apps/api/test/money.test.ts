import { runMigrations } from '@kova/db'
import { moneyActionMessage } from '@kova/monad'
import { createHmac } from 'node:crypto'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { config } from '../src/config.js'
import {
  dollarCardFor,
  issueDollarCard,
  openUsAccount,
  requireWalletSignature,
  revealDollarCard,
  setDollarCard,
  usAccountFor,
  verifyLithicSignature,
} from '../src/services/money.js'

/**
 * Money in (Bridge), the dollar card (Lithic) and the signed requests in front of them. The
 * partners' documented responses are stubbed; what Kova asks them for, and what it keeps, is
 * checked against a real database. Requires a local Postgres (DATABASE_URL).
 */

const saved = { bridge: config.BRIDGE_API_KEY, lithic: config.LITHIC_API_KEY, asa: config.LITHIC_ASA_SECRET }

beforeAll(async () => {
  await runMigrations(config.DATABASE_URL)
})

afterEach(() => {
  config.BRIDGE_API_KEY = saved.bridge
  config.LITHIC_API_KEY = saved.lithic
  config.LITHIC_ASA_SECRET = saved.asa
  vi.unstubAllGlobals()
})

const newWallet = () => privateKeyToAccount(generatePrivateKey())

describe('signed requests', () => {
  it('accepts the wallet’s own fresh signature for exactly this action', async () => {
    const wallet = newWallet()
    const at = Math.floor(Date.now() / 1000)
    const signature = await wallet.signMessage({ message: moneyActionMessage(wallet.address, 'issue-dollar-card', at) })
    await expect(requireWalletSignature(wallet.address, 'issue-dollar-card', at, signature)).resolves.toBeUndefined()
    await expect(requireWalletSignature(wallet.address, 'reveal-dollar-card', at, signature)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(requireWalletSignature(newWallet().address, 'issue-dollar-card', at, signature)).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('refuses a signature older than five minutes', async () => {
    const wallet = newWallet()
    const at = Math.floor(Date.now() / 1000) - 600
    const signature = await wallet.signMessage({ message: moneyActionMessage(wallet.address, 'issue-dollar-card', at) })
    await expect(requireWalletSignature(wallet.address, 'issue-dollar-card', at, signature)).rejects.toMatchObject({ code: 'invalid_request' })
  })
})

describe('US account (Bridge)', () => {
  it('is honest without a key: no account, nothing asked of Bridge', async () => {
    config.BRIDGE_API_KEY = undefined
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const wallet = newWallet().address
    expect(await usAccountFor(wallet, false)).toMatchObject({ live: false, status: 'none', details: null })
    await expect(openUsAccount(wallet, { full_name: 'Ada Obi', email: 'ada@example.com' })).rejects.toMatchObject({ code: 'conflict' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('starts with Bridge’s KYC, then opens a virtual account that lands in the wallet', async () => {
    config.BRIDGE_API_KEY = 'sk-test-bridge'
    const wallet = newWallet().address
    const calls: Array<{ url: string; method: string; body: unknown; headers: Record<string, string> }> = []
    let approved = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body as string) : null, headers: init.headers as Record<string, string> })
        if (url.endsWith('/v0/kyc_links') && init.method === 'POST')
          return Response.json({ id: 'kyc_1', kyc_link: 'https://bridge.test/kyc', tos_link: 'https://bridge.test/tos', kyc_status: 'not_started', customer_id: null })
        if (url.endsWith('/v0/kyc_links/kyc_1'))
          return Response.json(
            approved
              ? { id: 'kyc_1', kyc_link: 'x', tos_link: 'y', kyc_status: 'approved', customer_id: 'cus_1' }
              : { id: 'kyc_1', kyc_link: 'x', tos_link: 'y', kyc_status: 'under_review', customer_id: null },
          )
        if (url.endsWith('/v0/customers/cus_1/virtual_accounts'))
          return Response.json({
            id: 'va_1',
            status: 'activated',
            source_deposit_instructions: {
              bank_name: 'Lead Bank',
              bank_routing_number: '101019644',
              bank_account_number: '900123456789',
              bank_beneficiary_name: 'Ada Obi',
              bank_beneficiary_address: '1801 Main St, Kansas City, MO',
              payment_rails: ['ach_push', 'wire'],
            },
          })
        return new Response('{}', { status: 404 })
      }),
    )

    const started = await openUsAccount(wallet, { full_name: 'Ada Obi', email: 'ada@example.com' })
    expect(started).toMatchObject({ live: true, status: 'kyc', kyc_link: 'https://bridge.test/kyc' })
    expect(calls[0]).toMatchObject({ method: 'POST', body: { full_name: 'Ada Obi', email: 'ada@example.com', type: 'individual' } })
    expect(calls[0]?.headers['Api-Key']).toBe('sk-test-bridge')

    expect(await usAccountFor(wallet, false)).toMatchObject({ status: 'kyc', kyc_status: 'under_review' })

    approved = true
    const open = await usAccountFor(wallet, true)
    expect(open).toMatchObject({
      status: 'active',
      last_four: '6789',
      details: { bank_name: 'Lead Bank', routing_number: '101019644', account_number: '900123456789' },
    })
    const made = calls.find((c) => c.url.endsWith('/virtual_accounts'))
    // On testnet Bridge's sandbox never touches a chain, so the wallet itself is the destination.
    expect(made?.body).toMatchObject({ source: { currency: 'usd' }, destination: { currency: 'usdc', payment_rail: 'base', address: wallet } })
    // Without a signature the details stay hidden.
    expect((await usAccountFor(wallet, false)).details).toBeNull()
  })
})

describe('dollar card (Lithic)', () => {
  it('is honest without a key', async () => {
    config.LITHIC_API_KEY = undefined
    const wallet = newWallet().address
    expect(await dollarCardFor(wallet)).toMatchObject({ live: false, card: null })
    await expect(issueDollarCard(wallet)).rejects.toMatchObject({ code: 'conflict' })
  })

  it('issues a virtual card with a daily limit, freezes it, and shows its number only in Lithic’s frame', async () => {
    config.LITHIC_API_KEY = 'lithic-test-key'
    const wallet = newWallet().address
    // Lithic's tokens are unique; a fresh one per run keeps reruns against the same database apart.
    const token = `card_${crypto.randomUUID()}`
    const calls: Array<{ url: string; method: string; body: unknown }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body as string) : null })
        if (url.endsWith('/v1/cards') && init.method === 'POST')
          return Response.json({ token, last_four: '4242', exp_month: '10', exp_year: '2029', state: 'OPEN', spend_limit: 20000 })
        if (url.endsWith(`/v1/cards/${token}`) && init.method === 'PATCH')
          return Response.json({ token, last_four: '4242', state: (JSON.parse(init.body as string) as { state?: string }).state ?? 'OPEN', spend_limit: 20000 })
        if (url.includes('/v1/transactions'))
          return Response.json({ data: [{ token: 't1', amount: 1299, status: 'SETTLED', created: '2026-10-14T00:00:00Z', merchant: { descriptor: 'NETFLIX.COM' } }] })
        return new Response('{}', { status: 404 })
      }),
    )
    const issued = await issueDollarCard(wallet)
    expect(calls[0]).toMatchObject({ method: 'POST', body: { type: 'VIRTUAL', spend_limit: 20000, spend_limit_duration: 'DAILY', state: 'OPEN' } })
    expect(issued).toMatchObject({ live: true, card: { last_four: '4242', frozen: false, daily_limit: '200000000' } })
    expect(issued.transactions[0]).toMatchObject({ amount: '12990000', merchant: 'NETFLIX.COM', status: 'settled' })

    const frozen = await setDollarCard(wallet, { frozen: true })
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ state: 'PAUSED' })
    expect(frozen.card?.frozen).toBe(true)

    const reveal = await revealDollarCard(wallet, 'https://mykova.app')
    const url = new URL(reveal.url)
    const request = url.searchParams.get('embed_request') as string
    expect(JSON.parse(Buffer.from(request, 'base64').toString())).toMatchObject({ token, target_origin: 'https://mykova.app' })
    expect(url.searchParams.get('hmac')).toBe(createHmac('sha256', 'lithic-test-key').update(request).digest('base64'))
  })
})

describe('card authorizations (Lithic ASA)', () => {
  it('trusts only Lithic’s webhook signature, fresh, over this exact body', () => {
    const key = Buffer.from('kova-test-asa-secret-32-bytes!!!')
    config.LITHIC_ASA_SECRET = `whsec_${key.toString('base64')}`
    const body = JSON.stringify({ card_token: 'card_1', amounts: { cardholder: { amount: 1299 } } })
    const now = 1_800_000_000
    const sign = (id: string, ts: number, raw: string) =>
      `v1,${createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest('base64')}`
    const headers = { id: 'msg_1', timestamp: String(now), signature: sign('msg_1', now, body) }
    expect(verifyLithicSignature(body, headers, now)).toBe(true)
    expect(verifyLithicSignature(body.replace('1299', '9999'), headers, now)).toBe(false)
    expect(verifyLithicSignature(body, headers, now + 600)).toBe(false)
    expect(verifyLithicSignature(body, { ...headers, signature: 'v1,bm9wZQ==' }, now)).toBe(false)
    config.LITHIC_ASA_SECRET = undefined
    expect(verifyLithicSignature(body, headers, now)).toBe(false)
  })
})
