import { runMigrations } from '@kova/db'
import { claimTypedData, keySelfFreezeMessage } from '@kova/monad'
import { type Address, getAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { beforeAll, describe, expect, it } from 'vitest'
import { config } from '../src/config.js'
import { app } from '../src/index.js'

/**
 * Websites' budgets (Kova for Chrome), without the chain's writes: the extension makes a key and
 * signs KovaCard's Claim for the wallet, Kova checks it and gives back what the owner signs to switch
 * it on; a key can freeze itself; and pay-per-use (x402) payments are refused before anything moves
 * when they're malformed, on another chain, in an unknown token, or when Kova's float can't pay.
 *
 * Requires a local Postgres (DATABASE_URL), KOVA_CARD_COSIGNER_KEY, a relayer key and Monad
 * testnet's RPC for reads, like spend-keys.test.ts. KOVA_X402_PAYER_KEY may be any key: the float
 * check reads its balance, and a fresh key holds nothing.
 */

type Body = Record<string, unknown> & { error?: { code: string; message: string } }

async function call(path: string, body?: unknown) {
  const response = await app.request(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, body: (await response.json()) as Body }
}

const ready = Boolean(
  config.KOVA_CARD_COSIGNER_KEY &&
    config.KOVA_FEE_PAYER_PRIVATE_KEY &&
    config.KOVA_X402_PAYER_KEY &&
    config.KOVA_NETWORK === 'testnet',
)

beforeAll(async () => {
  await runMigrations(config.DATABASE_URL)
})

describe.runIf(ready)('a website’s budget', () => {
  const owner = privateKeyToAccount(generatePrivateKey())
  const key = privateKeyToAccount(generatePrivateKey())
  let contract: Address
  let chainId: number
  let keyId = ''

  const claim = async (signer = key, deadline = Math.floor(Date.now() / 1000) + 3 * 86_400) => ({
    deadline,
    signature: await signer.signTypedData(
      claimTypedData(chainId, contract, {
        card: key.address,
        holder: owner.address,
        deadline: BigInt(deadline),
      }),
    ),
  })

  const site = (
    overrides: Record<string, unknown>,
    c: { deadline: number; signature: string },
  ) => ({
    site: 'https://orbit.trade/swap?x=1',
    limit: '20',
    period: 'day',
    ask_above: '0.50',
    days: 90,
    key: key.address,
    claim_signature: c.signature,
    claim_deadline: c.deadline,
    ...overrides,
  })

  beforeAll(async () => {
    const cfg = await call('/v1/keys/config')
    contract = getAddress(cfg.body.contract as Address)
    chainId = cfg.body.chain_id as number
    expect(cfg.body.x402_ready).toBe(true)
  })

  it('refuses a Claim the key didn’t sign, and a deadline too soon', async () => {
    const forged = await call(
      `/v1/wallets/${owner.address}/sites`,
      site({}, await claim(privateKeyToAccount(generatePrivateKey()))),
    )
    expect(forged.status).toBe(400)
    const soon = await call(
      `/v1/wallets/${owner.address}/sites`,
      site({}, await claim(key, Math.floor(Date.now() / 1000) + 60)),
    )
    expect(soon.status).toBe(400)
    const notSite = await call(
      `/v1/wallets/${owner.address}/sites`,
      site({ site: 'chrome://settings' }, await claim()),
    )
    expect(notSite.status).toBe(400)
    const askTooHigh = await call(
      `/v1/wallets/${owner.address}/sites`,
      site({ ask_above: '25' }, await claim()),
    )
    expect(askTooHigh.status).toBe(400)
  })

  it('makes the budget, named by the site, ready for the owner to switch on', async () => {
    const made = await call(`/v1/wallets/${owner.address}/sites`, site({}, await claim()))
    expect(made.status).toBe(201)
    keyId = made.body.id as string
    expect(made.body.kind).toBe('site')
    expect(made.body.name).toBe('orbit.trade')
    expect(made.body.status).toBe('accepted')
    expect(made.body.holder).toBe(owner.address)
    expect(made.body.key_address).toBe(key.address)
    expect(made.body.limit).toBe('20.00')
    expect((made.body.rules as { ask_above: string }).ask_above).toBe('0.50')
    const link = made.body.link as Record<string, unknown>
    expect(link.holder).toBe(owner.address)
    expect(link.card).toBe(key.address)
    expect(link.daily_limit).toBe('20000000')

    // The same key can't be given to a second site.
    const again = await call(
      `/v1/wallets/${owner.address}/sites`,
      site({ site: 'https://lumen.news' }, await claim()),
    )
    expect(again.status).toBe(409)

    // It's in the owner's list.
    const list = await call(`/v1/wallets/${owner.address}/keys?kind=site`)
    expect((list.body.data as { id: string }[]).map((k) => k.id)).toContain(keyId)
  })

  it('pays nothing before the owner switches it on', async () => {
    const prepared = await call(`/v1/keys/${keyId}/payments`, {
      holder: owner.address,
      to: privateKeyToAccount(generatePrivateKey()).address,
      amount: '1',
    })
    expect(prepared.status).toBe(422)
    expect(prepared.body.error?.message).toMatch(/isn’t switched on/)
  })

  it('refuses pay-per-use requests it can’t or shouldn’t pay, before anything moves', async () => {
    const payTo = privateKeyToAccount(generatePrivateKey()).address
    const usdc =
      chainId === 143
        ? '0x754704Bc059F8C67012fEd69BC8A327a5aafb603'
        : '0x534b2f3A21130d7a60830c2Df862319e593943A3'
    const requirement = {
      scheme: 'exact',
      network: `eip155:${chainId}`,
      amount: '100000',
      asset: usdc,
      payTo,
      maxTimeoutSeconds: 300,
      extra: { name: 'USDC', version: '2' },
    }
    const pay = (r: Record<string, unknown>, holder = owner.address) =>
      call(`/v1/keys/${keyId}/x402`, {
        holder,
        requirement: r,
        resource: { url: 'https://x.test' },
      })

    expect((await pay({ ...requirement, network: 'eip155:8453' })).status).toBe(400)
    expect((await pay({ ...requirement, asset: payTo })).status).toBe(400)
    expect((await pay({ ...requirement, amount: '26000000' })).status).toBe(400)
    expect((await pay({ ...requirement, payTo: owner.address })).status).toBe(400)
    expect((await pay(requirement, privateKeyToAccount(generatePrivateKey()).address)).status).toBe(
      403,
    )
    // A fresh float holds no USDC, so Kova says so instead of taking the owner's dollars.
    const empty = await pay(requirement)
    expect(empty.status).toBe(409)
    expect(empty.body.error?.message).toMatch(/can’t pay websites in USDC/)
  })

  it('freezes itself with its own signature, never with someone else’s or an old one', async () => {
    const at = Math.floor(Date.now() / 1000)
    const stranger = privateKeyToAccount(generatePrivateKey())
    const forged = await call(`/v1/keys/${keyId}/self-freeze`, {
      at,
      signature: await stranger.signMessage({ message: keySelfFreezeMessage({ keyId, at }) }),
    })
    expect(forged.status).toBe(400)
    const old = at - 3600
    const stale = await call(`/v1/keys/${keyId}/self-freeze`, {
      at: old,
      signature: await key.signMessage({ message: keySelfFreezeMessage({ keyId, at: old }) }),
    })
    expect(stale.status).toBe(400)
    const frozen = await call(`/v1/keys/${keyId}/self-freeze`, {
      at,
      signature: await key.signMessage({ message: keySelfFreezeMessage({ keyId, at }) }),
    })
    expect(frozen.status).toBe(200)
    expect(frozen.body.status).toBe('frozen')
    expect(frozen.body.frozen).toBe(true)
  })
})
