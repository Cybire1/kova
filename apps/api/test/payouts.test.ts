import { runMigrations, schema } from '@kova/db'
import { eq } from 'drizzle-orm'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Cash-outs through Nuvion: a recipient checked and saved, a quote that locks the rate, the wallet's
 * dollars taken only when Kova's pot can pay, paid out once by reference, followed to paid, and sent
 * back to the wallet when Nuvion refuses or the bank fails it. Nuvion's documented replies are
 * played by a small fake; the relayer and Monad are stubbed; what Kova keeps is checked in a real
 * database (DATABASE_URL).
 */

const RELAYER = '0x000000000000000000000000000000000000fee1'
const hoisted = vi.hoisted(() => ({ hashes: 0, receipts: new Map<string, string>() }))
const hash = () =>
  `0x${crypto.randomUUID().replaceAll('-', '')}${(++hoisted.hashes).toString(16).padStart(32, '0')}`

vi.mock('../src/relay.js', () => ({
  relayReady: () => true,
  relayAuthorization: vi.fn(async () => ({
    receipt: { status: 'success', transactionHash: hash() },
    ms: 900,
  })),
  sendFromRelayer: vi.fn(
    async (
      _to: string,
      _data: string,
      options?: { beforeBroadcast?: (h: string) => Promise<void> },
    ) => {
      const h = hash()
      await options?.beforeBroadcast?.(h)
      hoisted.receipts.set(h, 'success')
      return { status: 'success', transactionHash: h }
    },
  ),
}))
vi.mock('../src/chain.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/chain.js')>()
  return {
    ...real,
    feePayerAddress: '0x000000000000000000000000000000000000fee1',
    publicClient: {
      ...real.publicClient,
      getTransactionReceipt: vi.fn(async ({ hash: h }: { hash: string }) =>
        hoisted.receipts.has(h) ? { status: hoisted.receipts.get(h) } : null,
      ),
    },
  }
})

const { config } = await import('../src/config.js')
const { db } = await import('../src/db.js')
const relay = await import('../src/relay.js')
const { settlementToken } = await import('../src/chain.js')
const { ibanValid, recipientFor, corridorById } = await import(
  '../src/services/payout-corridors.js'
)
const { addRecipient, quotePayout, payPayout, settlePayouts, payoutRow, payoutNonce } =
  await import('../src/services/payouts.js')

/** Nuvion as far as payouts use it: the pot, counterparties, payment details, quotes, transfers. */
function fakeNuvion() {
  const state = {
    pot: 50_000,
    rate: 1.370269,
    quoteValidFor: 120,
    counterparties: [] as Record<string, unknown>[],
    details: [] as Record<string, unknown>[],
    transfers: [] as Array<Record<string, unknown> & { id: string; status: string }>,
    refuseDetail: false,
    refuseTransfer: false,
    silentOnce: false,
    staleQuoteOnce: false,
    quotes: 0,
  }
  const ok = (data: unknown, status = 200) =>
    new Response(JSON.stringify({ status: 'success', data }), { status })
  const no = (status: number, message: string, type?: string) =>
    new Response(JSON.stringify({ status: 'error', message, type }), { status })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const path = url.pathname
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      if (method === 'GET' && path === '/accounts/acc_pot')
        return ok({ account: { id: 'acc_pot', balance: { available: state.pot } } })
      if (method === 'POST' && path === '/counterparties') {
        state.counterparties.push(body)
        return ok({ id: `cp_${state.counterparties.length}` }, 201)
      }
      if (method === 'POST' && path === '/payment-details') {
        if (state.refuseDetail)
          return no(422, 'Validation error: account_number is invalid', 'error_validation_error')
        state.details.push(body)
        return ok({ id: `pd_${state.details.length}` }, 201)
      }
      if (method === 'GET' && path.startsWith('/bank-codes/'))
        return ok([
          {
            bank_name: 'Royal Bank of Canada',
            bank_institution_number: '003',
            swift_bic: 'ROYCCAT2',
          },
        ])
      if (method === 'POST' && path === '/fx-quotes') {
        state.quotes++
        expect(body.account_id).toBe('acc_pot')
        return ok(
          {
            id: `fxq_${state.quotes}`,
            from: 'USD',
            to: body.to_currency,
            amount_from: body.amount_from,
            amount_to: Math.floor(body.amount_from * state.rate),
            rate: state.rate,
            quote: {
              status: 'active',
              expires_at: Date.now() + state.quoteValidFor * 1000,
              valid_for: state.quoteValidFor,
            },
          },
          201,
        )
      }
      if (method === 'POST' && path === '/transfers') {
        if (state.silentOnce) {
          // Nuvion took it, then the answer never arrived.
          state.silentOnce = false
          state.transfers.push({
            ...body,
            id: `tr_${state.transfers.length + 1}`,
            status: 'pending',
          })
          return no(503, 'Try later')
        }
        if (state.staleQuoteOnce) {
          state.staleQuoteOnce = false
          return no(422, 'The FX quote has expired', 'error_fx_quote_expired')
        }
        // Nuvion's documented 422: the message has no full stop, and each problem is keyed by its field.
        if (state.refuseTransfer)
          return new Response(
            JSON.stringify({
              status: 'error',
              message: 'Validation failed for one or more fields',
              type: 'error_validation_error',
              validations: [
                {
                  'bank_address.state': {
                    type: 'error_validation_required_field_missing',
                    message: 'bank_address.state is required.',
                  },
                },
              ],
            }),
            { status: 422 },
          )
        if (state.transfers.some((t) => t.unique_reference === body.unique_reference))
          return no(409, 'Duplicate', 'error_duplicate_resource')
        const t = { ...body, id: `tr_${state.transfers.length + 1}`, status: 'pending' }
        state.transfers.push(t)
        state.pot -= body.amount
        return ok({ ...t, applicable_fee: 50 }, 201)
      }
      if (method === 'GET' && path === '/transfers') {
        const ref = url.searchParams.get('unique_reference')
        return ok({ meta: {}, data: state.transfers.filter((t) => t.unique_reference === ref) })
      }
      if (method === 'GET' && path.startsWith('/transfers/')) {
        const t = state.transfers.find((x) => x.id === path.split('/')[2])
        return t ? ok(t) : no(404, 'Not found')
      }
      return no(404, `No ${method} ${path}`)
    }),
  )
  return state
}

const newWallet = () => privateKeyToAccount(generatePrivateKey()).address

const person = {
  holder_name: 'Ada Okafor',
  email: 'ada@example.com',
  address_line1: '11 Opebi Road',
  address_city: 'Ikeja',
  address_country: 'NG',
}

/** The transfer the wallet signs for a payout, as the app builds it. */
const signedFor = (row: { id: string; wallet: string; amount: bigint; expiresAt: Date }) => ({
  token: settlementToken.address,
  authorization: {
    from: row.wallet as `0x${string}`,
    to: RELAYER as `0x${string}`,
    value: row.amount,
    validAfter: 0n,
    validBefore: BigInt(Math.floor(row.expiresAt.getTime() / 1000)),
    nonce: payoutNonce(row),
  },
  signature: `0x${'11'.repeat(65)}` as `0x${string}`,
})

const saved = { ...config }
beforeAll(async () => {
  await runMigrations(config.DATABASE_URL)
})
beforeEach(async () => {
  // Each test's fake Nuvion numbers its transfers from 1: earlier payouts must not answer to them.
  await db.delete(schema.payouts)
  await db.delete(schema.payoutRecipients)
  Object.assign(config, {
    KOVA_NETWORK: 'testnet',
    NUVION_API_KEY: 'nv_test_kova',
    NUVION_API_URL: 'https://api.nuvion.dev',
    NUVION_POT_ACCOUNT: 'acc_pot',
    KOVA_PAYOUT_FEE_BPS: 0,
  })
  vi.mocked(relay.relayAuthorization).mockClear()
  vi.mocked(relay.sendFromRelayer).mockClear()
})
afterEach(() => {
  Object.assign(config, saved)
  vi.unstubAllGlobals()
})

describe('payout rails', () => {
  it('checks IBANs by their check digits', () => {
    expect(ibanValid('DE89 3704 0044 0532 0130 00')).toBe(true)
    expect(ibanValid('DE89 3704 0044 0532 0130 01')).toBe(false)
    expect(ibanValid('AE070331234567890123456')).toBe(true)
  })

  it('turns each rail’s fields into Nuvion’s payment detail, masked for Kova', () => {
    const interac = recipientFor(corridorById('ca_interac_email')!, person)
    expect(interac.detail).toMatchObject({
      payment_method: 'bank-transfer',
      currency: 'CAD',
      scheme: 'interac_email',
      email: 'ada@example.com',
      country: 'CA',
    })
    expect(interac.label).toBe('Interac a•••@example.com')
    expect(interac.person.address.country).toBe('NG')

    const mpesa = recipientFor(corridorById('ke_momo')!, {
      ...person,
      scheme: 'mpesa',
      phone_number: '+254 712 345 678',
    })
    expect(mpesa.detail).toMatchObject({
      payment_method: 'momo-transfer',
      currency: 'KES',
      scheme: 'mpesa',
      phone_number: '+254712345678',
      country: 'KE',
    })

    const sepa = recipientFor(corridorById('eu_sepa')!, {
      ...person,
      iban: 'DE89 3704 0044 0532 0130 00',
      swift_bic: 'cobadeffxxx',
      bank_name: 'Commerzbank',
    })
    expect(sepa.detail).toMatchObject({
      country: 'DE',
      iban: 'DE89370400440532013000',
      swift_bic: 'COBADEFFXXX',
    })
    expect(sepa.label).toBe('Commerzbank •••• 3000')

    const rtp = recipientFor(corridorById('us_rtp')!, {
      ...person,
      routing_number: '121000248',
      account_number: '112233445566',
      account_type: 'checking',
      bank_name: 'Wells Fargo Bank',
      bank_line1: '420 Montgomery Street',
      bank_city: 'San Francisco',
      bank_state: 'ca',
      bank_postal_code: '94104',
    })
    expect(rtp.detail).toMatchObject({
      scheme: 'rtp',
      routing_number: '121000248',
      bank_address: { state: 'CA', postal_code: '94104', country: 'US' },
    })

    const eft = recipientFor(
      corridorById('ca_eft')!,
      { ...person, transit_number: '00012', account_number: '1234567' },
      { bank_name: 'Royal Bank of Canada', code: '003' },
    )
    expect(eft.detail).toMatchObject({
      bank_institution_number: '003',
      bank_name: 'Royal Bank of Canada',
    })
  })

  it('refuses details that can’t be right, naming the field', () => {
    expect(() =>
      recipientFor(corridorById('us_ach')!, { ...person, routing_number: '1234' }),
    ).toThrow(/9 digits/)
    expect(() =>
      recipientFor(corridorById('eu_sepa')!, {
        ...person,
        iban: 'DE89 3704 0044 0532 0130 01',
        swift_bic: 'COBADEFF',
        bank_name: 'Commerzbank',
      }),
    ).toThrow(/IBAN isn’t valid/)
    expect(() =>
      recipientFor(corridorById('ke_momo')!, {
        ...person,
        scheme: 'mpesa',
        phone_number: '0712345678',
      }),
    ).toThrow(/country code/)
    expect(() =>
      recipientFor(corridorById('ca_eft')!, {
        ...person,
        transit_number: '00012',
        account_number: '1234567',
      }),
    ).toThrow(/Pick the bank/)
    expect(() =>
      recipientFor(corridorById('ca_interac_email')!, { ...person, email: 'nope' }),
    ).toThrow(/email/)
  })
})

describe('cash-outs through Nuvion', () => {
  async function interacPayout(state: ReturnType<typeof fakeNuvion>, dollars = 20) {
    const wallet = newWallet()
    const recipient = await addRecipient(wallet, 'ca_interac_email', person)
    const { row } = await quotePayout(wallet, recipient.id, BigInt(dollars) * 1_000_000n)
    return { wallet, recipient, row, state }
  }

  it('saves a recipient at Nuvion, locks a rate, takes the dollars, and pays out once', async () => {
    const nuvion = fakeNuvion()
    const { recipient, row } = await interacPayout(nuvion)
    expect(recipient).toMatchObject({ label: 'Interac a•••@example.com', counterpartyId: 'cp_1' })
    expect(nuvion.counterparties[0]).toMatchObject({
      type: 'individual',
      profile: { first_name: 'Ada', last_name: 'Okafor', address: { country: 'NG' } },
    })
    expect(row).toMatchObject({
      status: 'quoted',
      currency: 'CAD',
      amountTo: 2740n,
      fxQuoteId: 'fxq_1',
    })
    // Kova's quote ends before Nuvion's, so a signature never reaches a stale rate.
    expect(row.expiresAt.getTime()).toBeLessThan(Date.now() + 120_000)

    const paid = await payPayout(row, signedFor(row))
    expect(relay.relayAuthorization).toHaveBeenCalledTimes(1)
    expect(paid).toMatchObject({ status: 'sending', transferId: 'tr_1', providerFee: 50n })
    expect(nuvion.transfers[0]).toMatchObject({
      account_id: 'acc_pot',
      currency: 'USD',
      amount: 2000,
      fx_quote_id: 'fxq_1',
      payment_type: 'bank-transfer',
      unique_reference: `kova-out-${row.id.replace(/-/g, '')}`,
    })
    // The same signature again changes nothing.
    expect(await payPayout(paid, signedFor(row))).toMatchObject({ status: 'sending' })
    expect(nuvion.transfers).toHaveLength(1)

    ;(nuvion.transfers[0] as { status: string }).status = 'successful'
    await settlePayouts()
    expect(await payoutRow(row.id)).toMatchObject({ status: 'paid' })
  })

  it('takes nothing when Kova’s pot can’t pay it, or the rate ran out, or the signature isn’t this payout’s', async () => {
    const nuvion = fakeNuvion()
    const { row } = await interacPayout(nuvion)
    nuvion.pot = 1_000
    await expect(payPayout(row, signedFor(row))).rejects.toMatchObject({ code: 'conflict' })
    nuvion.pot = 50_000
    const wrong = signedFor(row)
    wrong.authorization.value = row.amount + 1n
    await expect(payPayout(row, wrong)).rejects.toMatchObject({ code: 'invalid_request' })
    await db
      .update(schema.payouts)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.payouts.id, row.id))
    const stale = (await payoutRow(row.id))!
    await expect(payPayout(stale, signedFor(stale))).rejects.toMatchObject({ code: 'conflict' })
    expect(relay.relayAuthorization).not.toHaveBeenCalled()
    expect(nuvion.transfers).toHaveLength(0)
  })

  it('sends the dollars back once when Nuvion refuses the payout', async () => {
    const nuvion = fakeNuvion()
    const { row } = await interacPayout(nuvion)
    nuvion.refuseTransfer = true
    const failed = await payPayout(row, signedFor(row))
    expect(failed.status).toBe('failed')
    expect(failed.refundTxHash).toMatch(/^0x/)
    expect(failed.failure).toBe(
      'The payout was refused: Validation failed for one or more fields: bank_address.state: bank_address.state is required. Your dollars went back to your wallet.',
    )
    await settlePayouts()
    expect(relay.sendFromRelayer).toHaveBeenCalledTimes(1)
  })

  it('asks again when Nuvion didn’t answer, and finds the payout it already made by reference', async () => {
    const nuvion = fakeNuvion()
    const { row } = await interacPayout(nuvion)
    nuvion.silentOnce = true
    const waiting = await payPayout(row, signedFor(row))
    expect(waiting.status).toBe('received')
    await settlePayouts()
    expect(nuvion.transfers).toHaveLength(1)
    expect(await payoutRow(row.id)).toMatchObject({ status: 'sending', transferId: 'tr_1' })
  })

  it('pays at a fresh rate when the locked one ran out between Monad and Nuvion', async () => {
    const nuvion = fakeNuvion()
    const { row } = await interacPayout(nuvion)
    nuvion.staleQuoteOnce = true
    nuvion.rate = 1.36
    const sent = await payPayout(row, signedFor(row))
    expect(sent).toMatchObject({ status: 'sending', fxQuoteId: 'fxq_2', amountTo: 2720n })
    expect(nuvion.transfers[0]).toMatchObject({ fx_quote_id: 'fxq_2' })
  })

  it('sends the dollars back once when the bank fails the payout later', async () => {
    const nuvion = fakeNuvion()
    const { row } = await interacPayout(nuvion)
    await payPayout(row, signedFor(row))
    Object.assign(nuvion.transfers[0] as object, {
      status: 'failed',
      status_reason: 'account_closed',
    })
    await settlePayouts()
    await settlePayouts()
    const done = (await payoutRow(row.id))!
    expect(done.status).toBe('failed')
    expect(done.failure).toMatch(/account closed/)
    expect(relay.sendFromRelayer).toHaveBeenCalledTimes(1)
  })

  it('keeps each rail within its own limits on what the account receives', async () => {
    const nuvion = fakeNuvion()
    nuvion.rate = 127.35
    const wallet = newWallet()
    const mpesa = await addRecipient(wallet, 'ke_momo', {
      ...person,
      scheme: 'mpesa',
      phone_number: '+254712345678',
    })
    // $1 is KSh127: fine. M-Pesa's floor is KSh20.
    expect((await quotePayout(wallet, mpesa.id, 1_000_000n)).row.amountTo).toBe(12735n)
    await expect(quotePayout(wallet, mpesa.id, 500_000n)).rejects.toMatchObject({
      code: 'invalid_request',
    })
    await expect(quotePayout(wallet, mpesa.id, 501_000_000n)).rejects.toMatchObject({
      code: 'invalid_request',
    })
    // A USD rail needs no quote at all.
    const rtp = await addRecipient(wallet, 'us_rtp', {
      ...person,
      routing_number: '121000248',
      account_number: '112233445566',
      account_type: 'checking',
      bank_name: 'Wells Fargo Bank',
      bank_line1: '420 Montgomery Street',
      bank_city: 'San Francisco',
      bank_state: 'CA',
      bank_postal_code: '94104',
    })
    const usd = await quotePayout(wallet, rtp.id, 25_000_000n)
    expect(usd.row).toMatchObject({ currency: 'USD', amountTo: 2500n, fxQuoteId: null })
  })

  it('refuses a recipient Nuvion won’t take, before any money could move', async () => {
    const nuvion = fakeNuvion()
    nuvion.refuseDetail = true
    await expect(addRecipient(newWallet(), 'ca_interac_email', person)).rejects.toMatchObject({
      code: 'invalid_request',
    })
  })

  it('fills the bank from Nuvion’s directory', async () => {
    const nuvion = fakeNuvion()
    const r = await addRecipient(newWallet(), 'ca_eft', {
      ...person,
      bank: '003',
      transit_number: '00012',
      account_number: '1234567',
    })
    expect(r.label).toBe('Royal Bank of Canada •••• 4567')
    expect(nuvion.details[0]).toMatchObject({ bank_institution_number: '003', scheme: 'eft' })
  })
})
