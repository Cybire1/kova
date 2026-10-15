import { runMigrations, schema } from '@kova/db'
import { eq } from 'drizzle-orm'
import type { Hex } from 'viem'
import { generatePrivateKey, type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import { beforeAll, describe, expect, it } from 'vitest'
import { config } from '../src/config.js'
import { db } from '../src/db.js'
import { decodeId } from '../src/ids.js'
import { app } from '../src/index.js'

/**
 * Opening a shop and signing in to it with a wallet (EIP-4361), through the real routes and a
 * real database. No chain: a signature is checked by recovering its signer.
 *
 * Requires a local Postgres (DATABASE_URL); migrations are applied here.
 */

const site = { domain: 'localhost:3000', uri: 'http://localhost:3000' }

type Body = Record<string, unknown> & {
  error?: { code: string; message: string; details?: Record<string, unknown> }
}

async function call(path: string, init: { method?: string; body?: unknown; key?: string } = {}) {
  const response = await app.request(path, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(init.key ? { authorization: `Bearer ${init.key}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  return { status: response.status, body: (await response.json()) as Body }
}

async function signed(
  wallet: PrivateKeyAccount,
  purpose: 'sign_in' | 'open_shop' | 'own_shop',
  domain = site,
) {
  const challenge = await call('/v1/sign_in/challenge', {
    method: 'POST',
    body: { address: wallet.address, purpose, ...domain },
  })
  expect(challenge.status).toBe(201)
  const message = challenge.body.message as string
  return { message, signature: await wallet.signMessage({ message }) }
}

async function openShop(wallet: PrivateKeyAccount, name: string) {
  const opened = await call('/v1/merchants', {
    method: 'POST',
    body: { name, settlement_address: wallet.address, owner: await signed(wallet, 'open_shop') },
  })
  expect(opened.status).toBe(201)
  return opened.body as {
    id: string
    key: string
    key_expires_at: string | null
    owner_address: string | null
  }
}

beforeAll(async () => {
  await runMigrations(config.DATABASE_URL)
})

describe('opening a shop with a wallet', () => {
  it('makes the signer the owner and signs them in, with no secret key to keep', async () => {
    const owner = privateKeyToAccount(generatePrivateKey())
    const shop = await openShop(owner, 'Ada’s Bakery')
    expect(shop.owner_address).toBe(owner.address)
    expect(shop.key_expires_at).not.toBeNull()

    const account = await call('/v1/account', { key: shop.key })
    expect(account.status).toBe(200)
    // The browser's session key is not one of the shop's secret keys.
    const keys = await call('/v1/api_keys', { key: shop.key })
    expect(keys.body.data).toEqual([])
  })

  it('refuses a signature from a wallet other than the one named', async () => {
    const owner = privateKeyToAccount(generatePrivateKey())
    const imposter = privateKeyToAccount(generatePrivateKey())
    const { message } = await signed(owner, 'open_shop')
    const opened = await call('/v1/merchants', {
      method: 'POST',
      body: {
        name: 'Not yours',
        settlement_address: owner.address,
        owner: { message, signature: await imposter.signMessage({ message }) },
      },
    })
    expect(opened.status).toBe(401)
  })

  it('still opens a shop without a wallet, with a secret key shown once', async () => {
    const opened = await call('/v1/merchants', {
      method: 'POST',
      body: {
        name: 'Key shop',
        settlement_address: privateKeyToAccount(generatePrivateKey()).address,
      },
    })
    expect(opened.status).toBe(201)
    expect(opened.body.owner_address).toBeNull()
    expect(opened.body.key_expires_at).toBeNull()
    const keys = await call('/v1/api_keys', { key: opened.body.key as string })
    expect((keys.body.data as unknown[]).length).toBe(1)
  })
})

describe('signing in with a wallet', () => {
  it('signs the owner in to their shop, once per signature', async () => {
    const owner = privateKeyToAccount(generatePrivateKey())
    const shop = await openShop(owner, 'Mama’s Kitchen')
    const proof = await signed(owner, 'sign_in')

    const session = await call('/v1/sign_in', { method: 'POST', body: proof })
    expect(session.status).toBe(201)
    expect((session.body.merchant as { id: string }).id).toBe(shop.id)
    expect((await call('/v1/account', { key: session.body.key as string })).status).toBe(200)

    const replay = await call('/v1/sign_in', { method: 'POST', body: proof })
    expect(replay.status).toBe(401)
  })

  it('says so when the wallet has no shop', async () => {
    const stranger = privateKeyToAccount(generatePrivateKey())
    const attempt = await call('/v1/sign_in', {
      method: 'POST',
      body: await signed(stranger, 'sign_in'),
    })
    expect(attempt.status).toBe(404)
    expect(attempt.body.error?.details?.reason).toBe('no_shop')
  })

  it('asks which shop when the wallet owns several, and the signature stays good for the answer', async () => {
    const owner = privateKeyToAccount(generatePrivateKey())
    await openShop(owner, 'First stall')
    const second = await openShop(owner, 'Second stall')
    const proof = await signed(owner, 'sign_in')

    const ask = await call('/v1/sign_in', { method: 'POST', body: proof })
    expect(ask.status).toBe(409)
    const shops = ask.body.error?.details?.shops as { id: string; name: string }[]
    expect(shops.map((s) => s.name)).toEqual(['Second stall', 'First stall'])

    const chosen = await call('/v1/sign_in', {
      method: 'POST',
      body: { ...proof, merchant: second.id },
    })
    expect(chosen.status).toBe(201)
    expect((chosen.body.merchant as { name: string }).name).toBe('Second stall')
  })

  it('never lets one purpose stand in for the other', async () => {
    const owner = privateKeyToAccount(generatePrivateKey())
    await openShop(owner, 'Purposeful')
    const openShopProof = await signed(owner, 'open_shop')
    expect((await call('/v1/sign_in', { method: 'POST', body: openShopProof })).status).toBe(400)
  })

  it('only signs in from Kova’s own sites', async () => {
    const owner = privateKeyToAccount(generatePrivateKey())
    const elsewhere = await call('/v1/sign_in/challenge', {
      method: 'POST',
      body: {
        address: owner.address,
        purpose: 'sign_in',
        domain: 'kova-login.example',
        uri: 'https://kova-login.example',
      },
    })
    expect(elsewhere.status).toBe(400)

    // A message edited to name another site no longer matches its signature or its challenge.
    const proof = await signed(owner, 'sign_in')
    const moved = proof.message.replace('localhost:3000 wants you', 'kova-login.example wants you')
    expect(
      (await call('/v1/sign_in', { method: 'POST', body: { ...proof, message: moved } })).status,
    ).toBe(400)
  })

  it('signs out: the session key stops working, and an expired one never works', async () => {
    const owner = privateKeyToAccount(generatePrivateKey())
    await openShop(owner, 'Short visit')
    const session = await call('/v1/sign_in', {
      method: 'POST',
      body: await signed(owner, 'sign_in'),
    })
    const key = session.body.key as string

    expect((await call('/v1/sign_out', { method: 'POST', key })).status).toBe(200)
    expect((await call('/v1/account', { key })).status).toBe(401)

    const again = await call('/v1/sign_in', {
      method: 'POST',
      body: await signed(owner, 'sign_in'),
    })
    const merchantId = decodeId('merchant', (again.body.merchant as { id: string }).id)
    if (!merchantId) throw new Error('bad merchant id')
    await db
      .update(schema.apiKeys)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.apiKeys.merchantId, merchantId))
    const late = await call('/v1/account', { key: again.body.key as string })
    expect(late.status).toBe(401)
    expect(late.body.error?.message).toMatch(/expired/)
  })

  it('refuses a signature that is not hex', async () => {
    const owner = privateKeyToAccount(generatePrivateKey())
    const { message } = await signed(owner, 'sign_in')
    const bad = await call('/v1/sign_in', {
      method: 'POST',
      body: { message, signature: 'nope' as Hex },
    })
    expect(bad.status).toBe(400)
  })
})

describe('linking a shop to a wallet', () => {
  async function keyShop() {
    const opened = await call('/v1/merchants', {
      method: 'POST',
      body: {
        name: 'Opened with a key',
        settlement_address: privateKeyToAccount(generatePrivateKey()).address,
      },
    })
    expect(opened.status).toBe(201)
    return opened.body as { id: string; key: string }
  }

  it('makes a wallet the owner of a shop opened another way, so it signs in with the wallet', async () => {
    const shop = await keyShop()
    const wallet = privateKeyToAccount(generatePrivateKey())
    const linked = await call('/v1/account/owner', {
      method: 'POST',
      key: shop.key,
      body: await signed(wallet, 'own_shop'),
    })
    expect(linked.status).toBe(200)
    expect(linked.body.owner_address).toBe(wallet.address)

    const session = await call('/v1/sign_in', {
      method: 'POST',
      body: await signed(wallet, 'sign_in'),
    })
    expect(session.status).toBe(201)
    expect((session.body.merchant as { id: string }).id).toBe(shop.id)
  })

  it('needs the wallet’s own signature for its own purpose', async () => {
    const shop = await keyShop()
    const wallet = privateKeyToAccount(generatePrivateKey())
    const other = privateKeyToAccount(generatePrivateKey())
    const { message } = await signed(wallet, 'own_shop')
    const forged = await call('/v1/account/owner', {
      method: 'POST',
      key: shop.key,
      body: { message, signature: await other.signMessage({ message }) },
    })
    expect(forged.status).toBe(401)
    const wrongPurpose = await call('/v1/account/owner', {
      method: 'POST',
      key: shop.key,
      body: await signed(wallet, 'sign_in'),
    })
    expect(wrongPurpose.status).toBe(400)
  })

  it('takes the shop’s own key, not a stranger’s', async () => {
    const wallet = privateKeyToAccount(generatePrivateKey())
    const anonymous = await call('/v1/account/owner', {
      method: 'POST',
      body: await signed(wallet, 'own_shop'),
    })
    expect(anonymous.status).toBe(401)
  })
})
