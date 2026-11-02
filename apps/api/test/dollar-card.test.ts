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

const chain = vi.hoisted(() => ({ relayerDollars: 100_000_000n }))
vi.mock('../src/chain.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/chain.js')>()
  return {
    ...real,
    feePayerAddress: '0x000000000000000000000000000000000000fee1',
    publicClient: {
      ...real.publicClient,
      readContract: vi.fn(async () => chain.relayerDollars),
      getTransactionReceipt: vi.fn(async () => null),
    },
  }
})

const { config } = await import('../src/config.js')
const { sendFromRelayer } = await import('../src/relay.js')
const { db } = await import('../src/db.js')
const {
  creditTopups,
  dollarCardFor,
  idNumberFor,
  revealDollarCard,
  setDollarCard,
  settleWithdrawals,
  startCheck,
  topUp,
  topUpFee,
  withdraw,
} = await import('../src/services/dollar-card.js')

const TREASURY = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf'

/** Nuvion as far as Kova uses it: entities, accounts, payees, transfers and one card per account. */
function fakeNuvion() {
  const card = `card_${Math.random().toString(36).slice(2, 10)}`
  const state = {
    card,
    status: 'incomplete',
    /** The next submission is refused for a missing proof of address, as Nuvion's 422 says it. */
    refuseSubmission: false,
    refusePayee: false,
    individual: null as null | { person: Record<string, unknown>; identification: unknown },
    documents: [] as string[],
    transfers: [] as Array<{ amount: number; reference: string }>,
    /** Moves off the card, from its own account back to Kova's pot. */
    returns: [] as Array<{ amount: number; reference: string; to: string }>,
    /** Kova as the holder's own counterparty, and its book-transfer detail. */
    kovaPayees: [] as Array<Record<string, unknown>>,
    kovaDetails: [] as Array<Record<string, unknown>>,
    balance: 0,
    frozen: false,
    failNextTransfer: false,
    failNextCardDetails: false,
    cardsIssued: 0,
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
      // Child resources must be requested on behalf of their entity, even with a parent key.
      if (
        (method === 'GET' &&
          (path === '/accounts/acc_1' ||
            path === '/cards' ||
            path.startsWith('/card-details/') ||
            path.startsWith('/card-transactions/') ||
            path.startsWith('/card-creation-fee/')) &&
          url.searchParams.get('entity_id') !== 'ent_1') ||
        (method === 'PATCH' && path.startsWith('/card-details/') && body.entity_id !== 'ent_1')
      )
        return new Response(JSON.stringify({ status: 'error', message: 'Wrong entity' }), {
          status: 404,
        })
      if (method === 'GET' && path === '/entities')
        return ok({ data: [{ id: 'ent_1', is_root: true, status: 'approved' }] })
      if (method === 'POST' && path === '/individual-entities') {
        state.individual = body
        return ok({ entity: { id: 'ent_1', status: 'incomplete' }, person: { id: 'per_1' } }, 201)
      }
      if (method === 'PATCH' && path === '/individual-entities/ent_1') return ok({})
      if (method === 'POST' && path === '/documents') {
        state.documents.push(body.key)
        return ok({})
      }
      if (method === 'POST' && path === '/onboarding-submissions') {
        if (state.refuseSubmission) {
          state.refuseSubmission = false
          return new Response(
            JSON.stringify({
              status: 'error',
              message: 'Validation error',
              type: 'error_validation_error',
              validations: [
                { message: 'proof_of_address is required', type: 'error_kyc_documents_incomplete' },
              ],
            }),
            { status: 422 },
          )
        }
        state.status = 'pending'
        return ok({})
      }
      if (method === 'GET' && path === '/entities/ent_1')
        return ok({
          entity: { id: 'ent_1', status: state.status },
          business: { email: 'hello@kova.test', phonenumber: '+2348000000000' },
          person: { email: 'ada@example.com' },
          address: { line_1: '1 Kova Way', city: 'Lagos', state: 'Lagos', country_code: 'NG' },
        })
      if (method === 'POST' && path === '/accounts')
        return ok({ account: { id: 'acc_1', nuvion_ban: '0010346002' } }, 201)
      if (method === 'GET' && path === '/accounts/acc_1')
        return ok({ account: { id: 'acc_1', balance: { available: state.balance } } })
      if (method === 'GET' && path === '/accounts/acc_pot')
        return ok({ account: { id: 'acc_pot', nuvion_ban: '0099990001' } })
      if (method === 'GET' && path === '/counterparties') return ok({ data: [] })
      if (method === 'POST' && path === '/counterparties' && body.entity_id) {
        state.kovaPayees.push(body)
        return ok({ counterparty: { id: 'cp_back' } }, 201)
      }
      if (method === 'POST' && path === '/payment-details' && body.entity_id) {
        state.kovaDetails.push(body)
        return ok({ payment_detail: { id: 'pd_back' } }, 201)
      }
      if (method === 'POST' && path === '/counterparties') {
        if (state.refusePayee) {
          state.refusePayee = false
          return new Response(JSON.stringify({ status: 'error', message: 'Try later' }), {
            status: 503,
          })
        }
        return ok({ id: 'cp_1' }, 201)
      }
      if (method === 'POST' && path === '/payment-details') return ok({ id: 'pd_1' }, 201)
      if (method === 'GET' && path === '/card-creation-fee/acc_1') return ok({ fee: 50 })
      if (method === 'GET' && path === '/cards') {
        expect(url.searchParams.get('account_id')).toBe('acc_1')
        return ok({
          cards: state.cardsIssued ? [{ id: card, type: 'virtual', status: 'active' }] : [],
        })
      }
      if (method === 'POST' && path === '/transfers') {
        if (state.failNextTransfer) {
          state.failNextTransfer = false
          return new Response(JSON.stringify({ status: 'error', message: 'Try later' }), {
            status: 503,
          })
        }
        if (
          [...state.transfers, ...state.returns].some((t) => t.reference === body.unique_reference)
        )
          return new Response(JSON.stringify({ status: 'error', message: 'Duplicate' }), {
            status: 409,
          })
        // From the card's own account: on the holder's behalf, back to Kova's pot.
        if (body.account_id === 'acc_1') {
          if (body.entity_id !== 'ent_1')
            return new Response(JSON.stringify({ status: 'error', message: 'Wrong entity' }), {
              status: 404,
            })
          if (body.amount > state.balance)
            return new Response(
              JSON.stringify({ status: 'error', message: 'Insufficient balance' }),
              { status: 422 },
            )
          state.returns.push({
            amount: body.amount,
            reference: body.unique_reference,
            to: `${body.counterparty_id}/${body.payment_detail_id}`,
          })
          state.balance -= body.amount
          return ok({ id: `tr_back_${state.returns.length}` }, 201)
        }
        state.transfers.push({ amount: body.amount, reference: body.unique_reference })
        state.balance += body.amount
        return ok({ id: `tr_${state.transfers.length}` }, 201)
      }
      if (method === 'POST' && path === '/virtual-cards') {
        state.cardsIssued++
        state.balance -= 50
        return ok({ id: card, status: 'active' }, 201)
      }
      if (method === 'GET' && path === `/card-details/${card}`) {
        if (state.failNextCardDetails) {
          state.failNextCardDetails = false
          return new Response(JSON.stringify({ status: 'error', message: 'Try later' }), {
            status: 503,
          })
        }
        return ok({
          id: card,
          status: state.frozen ? 'blocked' : 'active',
          number: '5412751234124821',
          cvv: '381',
          expiration_month: '09',
          expiration_year: '29',
          first_name: 'Ada',
          last_name: 'Okafor',
          billing: {
            address_line_1: '350 Fifth Avenue',
            address_line_2: '',
            city: 'New York',
            state: 'NY',
            postal_code: '10001',
          },
        })
      }
      if (method === 'PATCH' && path.startsWith(`/card-details/${card}/`)) {
        state.frozen = path.endsWith('/freeze')
        return ok({})
      }
      if (method === 'GET' && path === `/card-transactions/${card}`)
        return ok({
          payments: [
            {
              _id: 'pay_check',
              amount: 100,
              status: 'successful',
              type: 'outflow',
              status_reason: 'Reversible test payment approved and processed',
              narration: 'Reversible test payment to GOOGLE *TEMPORARY HOLD for 1 USD',
              created: Date.now() - 60_000,
            },
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
  idNumber: { type: 'nin' as const, value: '12345678901' },
  addressProof: 'utility_bill' as const,
}
const files = {
  identity: { base64: 'a'.repeat(200), mime: 'image/jpeg' },
  address: { base64: 'b'.repeat(200), mime: 'application/pdf' },
}

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
  await startCheck(wallet, person, files)
  nuvion.status = 'approved'
  await dollarCardFor(wallet)
  return { nuvion, wallet }
}

describe('dollar card (Nuvion)', () => {
  it('recovers a card already issued before its details could be saved, without issuing again', async () => {
    const nuvion = fakeNuvion()
    const wallet = newWallet()
    await startCheck(wallet, person, files)
    nuvion.status = 'approved'
    nuvion.failNextCardDetails = true
    expect(await dollarCardFor(wallet)).toMatchObject({ stage: 'checking', approved: true })
    expect(nuvion.cardsIssued).toBe(1)
    expect(await dollarCardFor(wallet)).toMatchObject({ stage: 'card' })
    expect(nuvion.cardsIssued).toBe(1)
    expect(nuvion.transfers.filter((t) => t.reference.startsWith('kova-card-fee-'))).toHaveLength(1)
  })

  it('shares one issuance when two status requests arrive after approval', async () => {
    const nuvion = fakeNuvion()
    const wallet = newWallet()
    await startCheck(wallet, person, files)
    nuvion.status = 'approved'
    const results = await Promise.all([dollarCardFor(wallet), dollarCardFor(wallet)])
    expect(results.every((result) => result.stage === 'card')).toBe(true)
    expect(nuvion.calls.filter((call) => call === 'POST /accounts')).toHaveLength(1)
    expect(nuvion.cardsIssued).toBe(1)
  })

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
    expect(await startCheck(wallet, person, files)).toMatchObject({ stage: 'checking' })
    expect(nuvion.calls).toEqual([
      'POST /individual-entities',
      'POST /documents',
      'POST /documents',
      'POST /onboarding-submissions',
      'POST /counterparties',
      'GET /entities/ent_1',
    ])
    // Both documents Nuvion needs, the NIN and the kind of proof of address went with it.
    expect(nuvion.documents).toEqual(['identity', 'proof_of_address'])
    expect(nuvion.individual).toMatchObject({
      person: { nin: '12345678901' },
      identification: { proof_of_address: { type: 'utility_bill' } },
    })
    // Sent again while Nuvion reviews it: nothing is sent twice, it just says where it is.
    expect(await startCheck(wallet, person, files)).toMatchObject({ stage: 'checking' })
    expect(nuvion.calls.filter((c) => c === 'POST /onboarding-submissions')).toHaveLength(1)

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
    await startCheck(wallet, person, files)
    nuvion.status = 'rejected'
    expect(await dollarCardFor(wallet)).toMatchObject({ stage: 'fix' })
    nuvion.status = 'pending'
    expect(await startCheck(wallet, person, files)).toMatchObject({ stage: 'checking' })
  })

  it('names what Nuvion is missing when it refuses a check, and lets it be sent again', async () => {
    const nuvion = fakeNuvion()
    nuvion.refuseSubmission = true
    const wallet = newWallet()
    await expect(startCheck(wallet, person, files)).rejects.toMatchObject({
      code: 'invalid_request',
      message: expect.stringContaining('proof_of_address is required'),
    })
    // Never reviewed: the card screen asks to finish it and says why, rather than "checking".
    expect(await dollarCardFor(wallet)).toMatchObject({
      stage: 'fix',
      unfinished: true,
      reason: expect.stringContaining('proof_of_address is required'),
    })
    nuvion.calls.length = 0
    expect(await startCheck(wallet, person, files)).toMatchObject({
      stage: 'checking',
      unfinished: false,
      reason: null,
    })
    expect(nuvion.calls).toEqual([
      'GET /entities/ent_1',
      'PATCH /individual-entities/ent_1',
      'POST /documents',
      'POST /documents',
      'POST /onboarding-submissions',
      'POST /counterparties',
      'GET /entities/ent_1',
    ])
  })

  it('makes a missing payee when the card is issued, if the check reached Nuvion without one', async () => {
    const nuvion = fakeNuvion()
    nuvion.refusePayee = true
    const wallet = newWallet()
    await expect(startCheck(wallet, person, files)).rejects.toMatchObject({
      code: 'invalid_request',
    })
    // Nuvion has the check, so it's being reviewed, whatever stopped after it.
    expect(await dollarCardFor(wallet)).toMatchObject({ stage: 'checking', reason: null })
    nuvion.status = 'approved'
    expect(await dollarCardFor(wallet)).toMatchObject({ stage: 'card' })
    expect(nuvion.calls.filter((c) => c === 'POST /counterparties')).toHaveLength(2)
  })

  it('asks Nigerians for a NIN or BVN and Americans for an SSN, and nobody else', () => {
    expect(idNumberFor('NG', 'NG', { type: 'bvn', value: '123 4567 8901' })).toEqual({
      type: 'bvn',
      value: '12345678901',
    })
    expect(() => idNumberFor('NG', 'NG', undefined)).toThrow(/NIN or BVN/)
    // Living in Nigeria counts too, and an SSN won't do there.
    expect(() => idNumberFor('GH', 'NG', { type: 'ssn', value: '123456789' })).toThrow(/NIN/)
    expect(() => idNumberFor('NG', 'NG', { type: 'nin', value: '1234' })).toThrow(/11 digits/)
    expect(idNumberFor('US', 'GB', { type: 'ssn', value: '123-45-6789' })).toEqual({
      type: 'ssn',
      value: '123456789',
    })
    expect(() => idNumberFor('GB', 'US', undefined)).toThrow(/Social Security/)
    expect(idNumberFor('GB', 'GB', { type: 'nin', value: '1' })).toBeUndefined()
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
    const activity = 'activity' in done.card ? done.card.activity : []
    expect(activity.map((a) => a.kind)).toEqual(expect.arrayContaining(['topup', 'spend', 'check']))
    // A shop's $1 card check is shown as a check, never as money spent.
    expect(activity.find((a) => a.kind === 'check')?.title).toBe('GOOGLE *TEMPORARY HOLD')
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
      billing_address: {
        line1: '350 Fifth Avenue',
        line2: '',
        city: 'New York',
        state: 'NY',
        postal_code: '10001',
        country: 'US',
      },
    })
  })
  describe('moving money off the card', () => {
    /** The relayer's sends: each one's hash is kept before it "leaves", like the real one. */
    const sends: Array<{ to: string; data: string }> = []
    beforeEach(() => {
      sends.length = 0
      chain.relayerDollars = 100_000_000n
      vi.mocked(sendFromRelayer).mockReset()
      vi.mocked(sendFromRelayer).mockImplementation(async (to, data, options) => {
        const hash = `0x${crypto.randomUUID().replaceAll('-', '')}${'0'.repeat(32)}` as const
        await options?.beforeBroadcast?.(hash)
        sends.push({ to, data })
        return { status: 'success', transactionHash: hash } as never
      })
    })

    it('moves money off the card to the wallet, free, through Kova’s own payee on the holder', async () => {
      const { nuvion, wallet } = await cardHolder()
      nuvion.balance = 2000
      const done = await withdraw(wallet, 5_000_000n)
      expect(done.tx_hash).toMatch(/^0x/)
      expect(nuvion.returns).toEqual([
        { amount: 500, reference: expect.stringMatching(/^kova-back-/), to: 'cp_back/pd_back' },
      ])
      expect(nuvion.balance).toBe(1500)
      // Kova as the holder's counterparty, with a detail naming Kova's pot.
      expect(nuvion.kovaPayees[0]).toMatchObject({ type: 'business', entity_id: 'ent_1' })
      expect(nuvion.kovaDetails[0]).toMatchObject({
        entity_id: 'ent_1',
        payment_method: 'book-transfer',
        account_number: '0099990001',
      })
      // The same dollars, free, from the relayer to the wallet.
      expect(sends).toHaveLength(1)
      expect(sends[0]?.data.toLowerCase()).toContain(wallet.slice(2).toLowerCase())
      expect(sends[0]?.data).toContain((5_000_000).toString(16).padStart(64, '0'))
      expect(done.card).toMatchObject({
        card: { balance: '15000000' },
        activity: expect.arrayContaining([
          expect.objectContaining({ kind: 'withdraw', amount: '-5000000', status: 'successful' }),
        ]),
      })
      // The way back is made once.
      await withdraw(wallet, 1_000_000n)
      expect(nuvion.kovaPayees).toHaveLength(1)
      expect(nuvion.returns).toHaveLength(2)
    })

    it('refuses more than the card has, less than $1, or when the relayer can’t pay, moving nothing', async () => {
      const { nuvion, wallet } = await cardHolder()
      nuvion.balance = 300
      await expect(withdraw(wallet, 5_000_000n)).rejects.toMatchObject({ code: 'policy_declined' })
      await expect(withdraw(wallet, 500_000n)).rejects.toMatchObject({ code: 'invalid_request' })
      await expect(withdraw(wallet, 1_000_001n)).rejects.toMatchObject({ code: 'invalid_request' })
      chain.relayerDollars = 1_000_000n
      await expect(withdraw(wallet, 2_000_000n)).rejects.toMatchObject({ code: 'conflict' })
      expect(nuvion.returns).toHaveLength(0)
      expect(nuvion.balance).toBe(300)
      expect(sends).toHaveLength(0)
    })

    it('finishes a move that stopped part way, never pulling or paying it twice', async () => {
      const { nuvion, wallet } = await cardHolder()
      nuvion.balance = 2000
      // Nuvion doesn't answer: nothing is paid yet, and the move waits with its reference.
      nuvion.failNextTransfer = true
      const first = await withdraw(wallet, 3_000_000n)
      expect(first.tx_hash).toBeNull()
      expect(sends).toHaveLength(0)
      // Then the relayer fails once.
      vi.mocked(sendFromRelayer).mockRejectedValueOnce(new Error('rpc down'))
      await settleWithdrawals()
      expect(nuvion.returns).toHaveLength(1)
      expect(sends).toHaveLength(0)
      await settleWithdrawals()
      await settleWithdrawals()
      expect(nuvion.returns).toHaveLength(1)
      expect(sends).toHaveLength(1)
      const [row] = await db
        .select()
        .from(schema.cardWithdrawals)
        .where(eq(schema.cardWithdrawals.wallet, wallet.toLowerCase()))
      expect(row).toMatchObject({ status: 'paid', amount: 3_000_000n })
      expect(nuvion.balance).toBe(1700)
    })
  })
})
