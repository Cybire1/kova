import { runMigrations } from '@kova/db'
import {
  claimTypedData,
  keyRemoveMessage,
  spendKeyFromSignature,
  spendKeyMessage,
} from '@kova/monad'
import { type Address, getAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { beforeAll, describe, expect, it } from 'vitest'
import { config } from '../src/config.js'
import { app } from '../src/index.js'

/**
 * Spending keys, without the chain's writes: invites, accepting on another wallet (the key made from
 * that wallet's signature), what the owner signs to switch a key on, and what Kova refuses before
 * anything is sent. Switching on, paying, freezing and removing are on Monad: check:keys covers them.
 *
 * Requires a local Postgres (DATABASE_URL), KOVA_CARD_COSIGNER_KEY, a relayer key, and Monad testnet's
 * RPC for reads (the KovaCard nonce and the permit state).
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
    config.KOVA_NETWORK === 'testnet',
)

beforeAll(async () => {
  await runMigrations(config.DATABASE_URL)
})

describe('the key an allowance spends with', () => {
  it('is the same every time the same wallet signs, and different for another key or wallet', async () => {
    const holder = privateKeyToAccount(generatePrivateKey())
    const owner = privateKeyToAccount(generatePrivateKey()).address
    const message = spendKeyMessage({ keyId: 'k1', owner, holder: holder.address })
    const a = spendKeyFromSignature(await holder.signMessage({ message }))
    const b = spendKeyFromSignature(await holder.signMessage({ message }))
    const other = spendKeyFromSignature(
      await holder.signMessage({
        message: spendKeyMessage({ keyId: 'k2', owner, holder: holder.address }),
      }),
    )
    expect(a).toBe(b)
    expect(a).not.toBe(other)
    expect(privateKeyToAccount(a).address).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })
})

describe.runIf(ready)('allowances and agents', () => {
  const owner = privateKeyToAccount(generatePrivateKey())
  const mum = privateKeyToAccount(generatePrivateKey())

  it('makes an invite, which Mum accepts with a key her own wallet makes', async () => {
    const made = await call(`/v1/wallets/${owner.address}/key-invites`, {
      kind: 'allowance',
      name: 'Mum',
      limit: '30',
      period: 'week',
      days: 30,
      owner_name: 'Ada',
    })
    expect(made.status).toBe(201)
    const code = made.body.code as string
    const invite = await call(`/v1/key-invites/${code}`)
    expect(invite.body.status).toBe('invited')
    expect(invite.body.limit).toBe('30.00')

    const key = privateKeyToAccount(
      spendKeyFromSignature(
        await mum.signMessage({
          message: spendKeyMessage({
            keyId: invite.body.id as string,
            owner: owner.address,
            holder: mum.address,
          }),
        }),
      ),
    )
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 6 * 86_400)
    const claim = (signer: typeof key) =>
      signer.signTypedData(
        claimTypedData(
          invite.body.chain_id as number,
          getAddress(invite.body.contract as Address),
          {
            card: key.address,
            holder: owner.address,
            deadline,
          },
        ),
      )

    // A Claim signed by anyone but the key itself is refused.
    const forged = await call(`/v1/key-invites/${code}/accept`, {
      holder: mum.address,
      key: key.address,
      claim_signature: await claim(privateKeyToAccount(generatePrivateKey())),
      claim_deadline: Number(deadline),
    })
    expect(forged.status).toBe(400)

    // The owner can't accept their own invite.
    const own = await call(`/v1/key-invites/${code}/accept`, {
      holder: owner.address,
      key: key.address,
      claim_signature: await claim(key),
      claim_deadline: Number(deadline),
    })
    expect(own.status).toBe(400)

    const accepted = await call(`/v1/key-invites/${code}/accept`, {
      holder: mum.address,
      holder_name: 'Mum',
      key: key.address,
      claim_signature: await claim(key),
      claim_deadline: Number(deadline),
    })
    expect(accepted.body.status).toBe('accepted')
    expect(accepted.body.key_address).toBe(key.address)

    // Only once.
    const again = await call(`/v1/key-invites/${code}/accept`, {
      holder: mum.address,
      key: key.address,
      claim_signature: await claim(key),
      claim_deadline: Number(deadline),
    })
    expect(again.status).toBe(409)

    // The owner's plan to switch it on names the key, its cap and the Claim's deadline.
    const plan = await call(`/v1/wallets/${owner.address}/keys/${invite.body.id}/link`)
    expect(plan.body.card).toBe(key.address)
    expect(plan.body.daily_limit).toBe('30000000')
    expect(plan.body.deadline).toBe(Number(deadline))

    // A switch-on signed by anyone but the owner is refused before Kova sends anything.
    const stranger = await call(`/v1/wallets/${owner.address}/keys/${invite.body.id}/activate`, {
      holder_signature: await mum.signMessage({ message: 'not a link' }),
      permit: null,
    })
    expect(stranger.status).toBe(400)

    // It isn't on yet, so Mum can't spend it.
    const spend = await call(`/v1/keys/${invite.body.id}/payments`, {
      holder: mum.address,
      to: privateKeyToAccount(generatePrivateKey()).address,
      amount: '1',
    })
    expect(spend.status).toBe(422)
    expect(spend.body.error?.message).toMatch(/switched on/)

    const list = await call(`/v1/wallets/${owner.address}/keys?kind=allowance`)
    expect((list.body.data as { id: string }[]).map((k) => k.id)).toContain(invite.body.id)
  }, 30_000)

  it('makes an agent key with rules, and a key nobody linked can be removed with a signed message', async () => {
    const made = await call(`/v1/wallets/${owner.address}/agents`, {
      name: 'Claude',
      limit: '20',
      period: 'day',
      per_payment: '5',
      ask_above: '1',
      payees: 'anyone',
      days: 30,
    })
    expect(made.status).toBe(201)
    expect((made.body.rules as { ask_above: string }).ask_above).toBe('1.00')
    const id = made.body.id as string
    const plan = await call(`/v1/wallets/${owner.address}/keys/${id}/remove`)
    expect(plan.body.on_chain).toBe(false)
    const removed = await call(`/v1/wallets/${owner.address}/keys/${id}/remove`, {
      signature: await owner.signMessage({
        message: keyRemoveMessage({ owner: owner.address, keyId: id }),
      }),
    })
    expect(removed.body.status).toBe('removed')

    // An ask-first line above the most a payment can be makes no sense.
    const bad = await call(`/v1/wallets/${owner.address}/agents`, {
      name: 'Claude',
      limit: '20',
      period: 'day',
      per_payment: '5',
      ask_above: '6',
      payees: 'anyone',
      days: 30,
    })
    expect(bad.status).toBe(400)

    // MCP without a token is turned away.
    const response = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(response.status).toBe(401)
  }, 30_000)
})
