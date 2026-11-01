import { runMigrations } from '@kova/db'
import { moneyActionMessage } from '@kova/monad'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { config } from '../src/config.js'
import { openUsAccount, requireWalletSignature, usAccountFor } from '../src/services/money.js'

/**
 * Money in (Bridge) and the signed requests in front of it (the dollar card: dollar-card.test.ts). The
 * partners' documented responses are stubbed; what Kova asks them for, and what it keeps, is
 * checked against a real database. Requires a local Postgres (DATABASE_URL).
 */

const saved = { bridge: config.BRIDGE_API_KEY }

beforeAll(async () => {
  await runMigrations(config.DATABASE_URL)
})

afterEach(() => {
  config.BRIDGE_API_KEY = saved.bridge
  vi.unstubAllGlobals()
})

const newWallet = () => privateKeyToAccount(generatePrivateKey())

describe('signed requests', () => {
  it('accepts the wallet’s own fresh signature for exactly this action', async () => {
    const wallet = newWallet()
    const at = Math.floor(Date.now() / 1000)
    const signature = await wallet.signMessage({
      message: moneyActionMessage(wallet.address, 'issue-dollar-card', at),
    })
    await expect(
      requireWalletSignature(wallet.address, 'issue-dollar-card', at, signature),
    ).resolves.toBeUndefined()
    await expect(
      requireWalletSignature(wallet.address, 'reveal-dollar-card', at, signature),
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      requireWalletSignature(newWallet().address, 'issue-dollar-card', at, signature),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('refuses a signature older than five minutes', async () => {
    const wallet = newWallet()
    const at = Math.floor(Date.now() / 1000) - 600
    const signature = await wallet.signMessage({
      message: moneyActionMessage(wallet.address, 'issue-dollar-card', at),
    })
    await expect(
      requireWalletSignature(wallet.address, 'issue-dollar-card', at, signature),
    ).rejects.toMatchObject({ code: 'invalid_request' })
  })
})

describe('US account (Bridge)', () => {
  it('is honest without a key: no account, nothing asked of Bridge', async () => {
    config.BRIDGE_API_KEY = undefined
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const wallet = newWallet().address
    expect(await usAccountFor(wallet, false)).toMatchObject({
      live: false,
      status: 'none',
      details: null,
    })
    await expect(
      openUsAccount(wallet, { full_name: 'Ada Obi', email: 'ada@example.com' }),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('starts with Bridge’s KYC, then opens a virtual account that lands in the wallet', async () => {
    config.BRIDGE_API_KEY = 'sk-test-bridge'
    const wallet = newWallet().address
    const calls: Array<{
      url: string
      method: string
      body: unknown
      headers: Record<string, string>
    }> = []
    let approved = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({
          url,
          method: init.method ?? 'GET',
          body: init.body ? JSON.parse(init.body as string) : null,
          headers: init.headers as Record<string, string>,
        })
        if (url.endsWith('/v0/kyc_links') && init.method === 'POST')
          return Response.json({
            id: 'kyc_1',
            kyc_link: 'https://bridge.test/kyc',
            tos_link: 'https://bridge.test/tos',
            kyc_status: 'not_started',
            customer_id: null,
          })
        if (url.endsWith('/v0/kyc_links/kyc_1'))
          return Response.json(
            approved
              ? {
                  id: 'kyc_1',
                  kyc_link: 'x',
                  tos_link: 'y',
                  kyc_status: 'approved',
                  customer_id: 'cus_1',
                }
              : {
                  id: 'kyc_1',
                  kyc_link: 'x',
                  tos_link: 'y',
                  kyc_status: 'under_review',
                  customer_id: null,
                },
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
    expect(started).toMatchObject({
      live: true,
      status: 'kyc',
      kyc_link: 'https://bridge.test/kyc',
    })
    expect(calls[0]).toMatchObject({
      method: 'POST',
      body: { full_name: 'Ada Obi', email: 'ada@example.com', type: 'individual' },
    })
    expect(calls[0]?.headers['Api-Key']).toBe('sk-test-bridge')

    expect(await usAccountFor(wallet, false)).toMatchObject({
      status: 'kyc',
      kyc_status: 'under_review',
    })

    approved = true
    const open = await usAccountFor(wallet, true)
    expect(open).toMatchObject({
      status: 'active',
      last_four: '6789',
      details: {
        bank_name: 'Lead Bank',
        routing_number: '101019644',
        account_number: '900123456789',
      },
    })
    const made = calls.find((c) => c.url.endsWith('/virtual_accounts'))
    // On testnet Bridge's sandbox never touches a chain, so the wallet itself is the destination.
    expect(made?.body).toMatchObject({
      source: { currency: 'usd' },
      destination: { currency: 'usdc', payment_rail: 'base', address: wallet },
    })
    // Without a signature the details stay hidden.
    expect((await usAccountFor(wallet, false)).details).toBeNull()
  })
})
