import { runMigrations, schema } from '@kova/db'
import { eq } from 'drizzle-orm'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The dollar card on Nuvion: the ID check, the card issued once the holder passes, top-ups that
 * reach the card exactly once and never past $50 a day, freezing, and the number read without being
 * kept. Nuvion's documented replies are played by a small fake; the relayer is stubbed; what Kova
 * keeps is checked in a real database (DATABASE_URL).
 */

const relay = vi.hoisted(() => ({ hashes: 0 }))
vi.mock('../src/relay.js', () => ({
  relayReady: () => true,
  sendFromRelayer: vi.fn(),
  relayAuthorization: vi.fn(async () => ({
    receipt: {
      status: 'success',
      transactionHash: `0x${crypto.randomUUID().replaceAll('-', '')}${(++relay.hashes).toString(16).padStart(32, '0')}`,
    },
    ms: 900,
  })),
}))

const { config } = await import('../src/config.js')
const { db } = await import('../src/db.js')
const {
  creditTopups,
  dollarCardFor,
  revealDollarCard,
  setDollarCard,
  startCheck,
  topUp,
  topUpFee,
} = await import('../src/services/dollar-card.js')

const TREASURY = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf'

/** Nuvion as far as Kova uses it: entities, accounts, payees, transfers and one card per account. */
function fakeNuvion() {
  const card = `card_${Math.random().toString(36).slice(2, 10)}`
  const state = {
    card,
    status: 'pending',
    transfers: [] as Array<{ amount: number; reference: string }>,
    balance: 0,
    frozen: false,
    failNextTransfer: false,
    calls: [] as string[],
  }
  const ok = (data: unknown, status = 200) =>
    new Response(JSON.stringify({ status: 'success', data }), { status })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const path = url.pathname
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      state.calls.push(`${method} ${path}`)
      if (method === 'GET' && path === '/entities')
        return ok({ data: [{ id: 'ent_1', is_root: true, status: 'approved' }] })
      if (method === 'POST' && path === '/individual-entities')
        return ok({ entity: { id: 'ent_1', status: 'incomplete' }, person: { id: 'per_1' } }, 201)
      if (method === 'PATCH' && path === '/individual-entities/ent_1') return ok({})
      if (method === 'POST' && (path === '/documents' || path === '/onboarding-submissions'))
        return ok({})
      if (method === 'GET' && path === '/entities/ent_1')
        return ok({
          entity: { id: 'ent_1', status: state.status },
          business: { email: 'hello@kova.test', phonenumber: '+2348000000000' },
          address: { line_1: '1 Kova Way', city: 'Lagos', state: 'Lagos', country_code: 'NG' },
        })
      if (method === 'POST' && path === '/accounts')
        return ok({ account: { id: 'acc_1', nuvion_ban: '0010346002' } }, 201)
      if (method === 'GET' && path === '/accounts/acc_1')
        return ok({ account: { id: 'acc_1', balance: { available: state.balance } } })
      if (method === 'GET' && path === '/counterparties') return ok({ data: [] })
      if (method === 'POST' && path === '/counterparties') return ok({ id: 'cp_1' }, 201)
      if (method === 'POST' && path === '/payment-details') return ok({ id: 'pd_1' }, 201)
      if (method === 'GET' && path === '/card-creation-fee/acc_1') return ok({ fee: 50 })
      if (method === 'POST' && path === '/transfers') {
        if (state.failNextTransfer) {
          state.failNextTransfer = false
          return new Response(JSON.stringify({ status: 'error', message: 'Try later' }), {
            status: 503,
          })
        }
        if (state.transfers.some((t) => t.reference === body.unique_reference))
          return new Response(JSON.stringify({ status: 'error', message: 'Duplicate' }), {
            status: 409,
          })
        state.transfers.push({ amount: body.amount, reference: body.unique_reference })
        state.balance += body.amount
        return ok({ id: `tr_${state.transfers.length}` }, 201)
      }
      if (method === 'POST' && path === '/virtual-cards') {
        state.balance -= 50
        return ok({ id: card, status: 'active' }, 201)
      }
      if (method === 'GET' && path === `/card-details/${card}`)
        return ok({
          id: card,
          status: state.frozen ? 'blocked' : 'active',
          number: '5412751234124821',
          cvv: '381',
          expiration_month: '09',
          expiration_year: '29',
          first_name: 'Ada',
          last_name: 'Okafor',
        })
      if (method === 'PATCH' && path.startsWith(`/card-details/${card}/`)) {
        state.frozen = path.endsWith('/freeze')
        return ok({})
      }
      if (method === 'GET' && path === `/card-transactions/${card}`)
        return ok({
          payments: [
            {
              _id: 'pay_1',
              amount: 1099,
              status: 'successful',
              type: 'outflow',
              narration: 'Payment to Spotify for 10.99 USD',
              created: Date.now(),
            },
          ],
        })
      return new Response(JSON.stringify({ status: 'error', message: `No ${method} ${path}` }), {
        status: 404,
      })
    }),
  )
  return state
}

const person = {
  firstName: 'Ada',
  lastName: 'Okafor',
  dateOfBirth: '1996-03-14',
  email: 'ada@example.com',
  phone: '+2348012345678',
  nationality: 'NG',
  gender: 'f' as const,
  address: {
    line1: '11 Opebi Road',
    city: 'Ikeja',
    state: 'Lagos',
    postalCode: '101241',
    country: 'NG',
  },
  document: { type: 'international_passport' as const, number: 'A01234567' },
}
const photo = { base64: 'a'.repeat(200), mime: 'image/jpeg' }

const saved = { ...config }
beforeAll(async () => {
  await runMigrations(config.DATABASE_URL)
})
beforeEach(() => {
  Object.assign(config, {
    KOVA_NETWORK: 'testnet',
    NUVION_API_KEY: 'nv_test_kova',
    NUVION_API_URL: 'https://api.nuvion.dev',
    NUVION_POT_ACCOUNT: 'acc_pot',
    KOVA_CARD_TREASURY: TREASURY,
    KOVA_CARD_DAILY_TOPUP: '50000000',
  })
})
afterEach(() => {
  Object.assign(config, saved)
  vi.unstubAllGlobals()
})

const newWallet = () => privateKeyToAccount(generatePrivateKey()).address
const authorization = (wallet: `0x${string}`, value: bigint, to = TREASURY) => ({
  from: wallet,
  to: to as `0x${string}`,
  value,
  validAfter: 0n,
  validBefore: BigInt(Math.floor(Date.now() / 1000) + 600),
  nonce: `0x${'11'.repeat(32)}` as `0x${string}`,
})
const SIG = `0x${'22'.repeat(65)}` as `0x${string}`

async function cardHolder() {
  const nuvion = fakeNuvion()
  const wallet = newWallet()
  await startCheck(wallet, person, photo)
  nuvion.status = 'approved'
  await dollarCardFor(wallet)
  return { nuvion, wallet }
}

describe('dollar card (Nuvion)', () => {
  it('is honest without a key: asks for access, never calls Nuvion', async () => {
    config.NUVION_API_KEY = undefined
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(await dollarCardFor(newWallet())).toMatchObject({ live: false, stage: 'intro' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sends the ID check, waits while Nuvion reviews, then issues the card with Kova paying the fee', async () => {
    const nuvion = fakeNuvion()
    const wallet = newWallet()
    expect(await dollarCardFor(wallet)).toMatchObject({ stage: 'intro' })
    expect(await startCheck(wallet, person, photo)).toMatchObject({ stage: 'checking' })
    expect(nuvion.calls).toEqual([
      'POST /individual-entities',
      'POST /documents',
      'POST /onboarding-submissions',
      'POST /counterparties',
      'GET /entities/ent_1',
    ])
    await expect(startCheck(wallet, person, photo)).rejects.toMatchObject({ code: 'conflict' })

    nuvion.status = 'approved'
    const ready = await dollarCardFor(wallet)
    expect(ready).toMatchObject({
      stage: 'card',
      card: {
        last_four: '4821',
        brand: 'mastercard',
        exp_month: '09',
        exp_year: '29',
        frozen: false,
      },
      topups: { today: '0', left: '50000000' },
    })
    expect(nuvion.transfers).toEqual([
      { amount: 50, reference: expect.stringMatching(/^kova-card-fee-/) },
    ])
    // Kova keeps the last four and expiry, never the number or CVV.
    const [card] = await db
      .select()
      .from(schema.dollarCards)
      .where(eq(schema.dollarCards.wallet, wallet.toLowerCase()))
    const kept = JSON.stringify(card, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
    expect(kept).not.toContain('5412751234124821')
    expect(kept).not.toContain('381')
  })

  it('gives an owner a card under Kova’s own business, with no ID check', async () => {
    const nuvion = fakeNuvion()
    const owner = newWallet()
    config.KOVA_CARD_OWNER_WALLETS = `0x${'12'.repeat(20)}, ${owner}`
    config.KOVA_CARD_OWNER_NAME = 'Afeez Shaibu'
    expect(await dollarCardFor(owner)).toMatchObject({
      stage: 'card',
      card: { last_four: '4821', name: 'Afeez Shaibu' },
    })
    expect(nuvion.calls).not.toContain('POST /individual-entities')
    // Anyone else still goes through the check.
    expect(await dollarCardFor(newWallet())).toMatchObject({ stage: 'intro' })
  })

  it('shows a refused check with Nuvion’s reason, and lets the holder send it again', async () => {
    const nuvion = fakeNuvion()
    const wallet = newWallet()
    await startCheck(wallet, person, photo)
    nuvion.status = 'rejected'
    expect(await dollarCardFor(wallet)).toMatchObject({ stage: 'fix' })
    nuvion.status = 'pending'
    expect(await startCheck(wallet, person, photo)).toMatchObject({ stage: 'checking' })
  })

  it('tops up: pays Kova on Monad, then moves the same cents onto the card, once', async () => {
    const { nuvion, wallet } = await cardHolder()
    const done = await topUp(
      wallet,
      20_000_000n,
      authorization(wallet, 20_000_000n + topUpFee(20_000_000n)),
      SIG,
    )
    expect(done.card).toMatchObject({
      card: { balance: '20000000' },
      topups: { today: '20000000', left: '30000000' },
    })
    expect(nuvion.transfers.at(-1)).toEqual({
      amount: 2000,
      reference: expect.stringMatching(/^kova-topup-/),
    })
    expect(('activity' in done.card ? done.card.activity : []).map((a) => a.kind)).toEqual(
      expect.arrayContaining(['topup', 'spend']),
    )
  })

  it('charges 0.5% on top, rounded up to the cent, and refuses a top-up signed without it', async () => {
    expect(topUpFee(20_000_000n)).toBe(100_000n) // $20.00 → $0.10
    expect(topUpFee(1_000_000n)).toBe(10_000n) // $1.00 → $0.005, rounded up to $0.01
    expect(topUpFee(50_000_000n)).toBe(250_000n) // $50.00 → $0.25
    const { nuvion, wallet } = await cardHolder()
    await expect(
      topUp(wallet, 20_000_000n, authorization(wallet, 20_000_000n), SIG),
    ).rejects.toMatchObject({
      code: 'invalid_request',
      message: 'A $20.00 top-up is $20.10 with Kova’s fee. Approve that amount.',
    })
    await topUp(wallet, 20_000_000n, authorization(wallet, 20_100_000n), SIG)
    // The card gets $20.00; Kova keeps the $0.10.
    expect(nuvion.transfers.at(-1)?.amount).toBe(2000)
    const [row] = await db
      .select()
      .from(schema.cardTopups)
      .where(eq(schema.cardTopups.wallet, wallet.toLowerCase()))
    expect(row).toMatchObject({ amount: 20_000_000n, fee: 100_000n })
  })

  it('never lets a wallet put more than $50 on its card in a day', async () => {
    const { wallet } = await cardHolder()
    await topUp(
      wallet,
      40_000_000n,
      authorization(wallet, 40_000_000n + topUpFee(40_000_000n)),
      SIG,
    )
    await expect(
      topUp(wallet, 20_000_000n, authorization(wallet, 20_000_000n + topUpFee(20_000_000n)), SIG),
    ).rejects.toMatchObject({
      code: 'policy_declined',
      message: 'You can top up $10.00 more today.',
    })
    await topUp(
      wallet,
      10_000_000n,
      authorization(wallet, 10_000_000n + topUpFee(10_000_000n)),
      SIG,
    )
    await expect(
      topUp(wallet, 10_000n, authorization(wallet, 10_000n + topUpFee(10_000n)), SIG),
    ).rejects.toMatchObject({
      code: 'policy_declined',
    })
  })

  it('refuses a top-up sent anywhere but Kova’s treasury, or in fractions of a cent', async () => {
    const { wallet } = await cardHolder()
    await expect(
      topUp(
        wallet,
        5_000_000n,
        authorization(wallet, 5_000_000n + topUpFee(5_000_000n), `0x${'ab'.repeat(20)}`),
        SIG,
      ),
    ).rejects.toMatchObject({ code: 'invalid_request' })
    await expect(
      topUp(wallet, 5_000_001n, authorization(wallet, 5_000_001n + topUpFee(5_000_001n)), SIG),
    ).rejects.toMatchObject({
      code: 'invalid_request',
    })
  })

  it('keeps trying a top-up Nuvion couldn’t take yet, and never credits it twice', async () => {
    const { nuvion, wallet } = await cardHolder()
    nuvion.failNextTransfer = true
    const done = await topUp(
      wallet,
      15_000_000n,
      authorization(wallet, 15_000_000n + topUpFee(15_000_000n)),
      SIG,
    )
    expect(done.card).toMatchObject({ card: { balance: '0' } })
    await creditTopups()
    await creditTopups()
    const credited = nuvion.transfers.filter((t) => t.reference.startsWith('kova-topup-'))
    expect(credited).toHaveLength(1)
    expect(credited[0]?.amount).toBe(1500)
    expect(await dollarCardFor(wallet)).toMatchObject({ card: { balance: '15000000' } })
  })

  it('freezes and unfreezes at Nuvion, and reads the number without keeping it', async () => {
    const { nuvion, wallet } = await cardHolder()
    expect(await setDollarCard(wallet, true)).toMatchObject({ card: { frozen: true } })
    expect(nuvion.frozen).toBe(true)
    expect(await setDollarCard(wallet, false)).toMatchObject({ card: { frozen: false } })
    expect(await revealDollarCard(wallet)).toMatchObject({
      number: '5412751234124821',
      cvv: '381',
      exp_month: '09',
      exp_year: '29',
      name: 'Ada Okafor',
    })
  })
})
