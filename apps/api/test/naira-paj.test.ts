import { runMigrations } from '@kova/db'
import { transferAuthorizationTypedData } from '@kova/monad'
import {
  decodeFunctionData,
  encodeAbiParameters,
  getAddress,
  type Hex,
  keccak256,
  pad,
  parseAbi,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Naira through PAJ (services/naira.ts, services/paj.ts), with PAJ, KyberSwap and Monad stood in
 * for: a cash-out quoted 0.1% under a live swap, signed as one transfer whose nonce names PAJ's
 * address and the USDC, carried out by KovaCashOut with just enough of the dollars swapped, and
 * followed until PAJ pays the bank; a top-up paid into a bank account PAJ opens for it.
 *
 * Requires a local Postgres (DATABASE_URL); migrations are applied here.
 */

const CASH_OUT = '0x00000000000000000000000000000000000ca5e0'
const PAJ_ADDRESS = '0x000000000000000000000000000000000000fa11'
process.env.KOVA_CASH_OUT = CASH_OUT

const orders = new Map<string, { status: string; signature?: string }>()
const hex = (bytes: number) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
const newOrderId = () => hex(12)

vi.mock('../src/services/paystack.js', () => ({
  paystackReady: () => false,
  paystackTestMode: () => false,
  accountName: vi.fn(),
  bankNamed: vi.fn(),
  nigerianBanks: vi.fn(),
  checkout: vi.fn(),
  payment: vi.fn(),
  transfer: vi.fn(),
  transferRecipient: vi.fn(),
  transferStatus: vi.fn(),
}))

vi.mock('../src/services/paj.js', () => {
  class PajError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message)
    }
  }
  return {
    PajError,
    pajReady: () => true,
    pajBanks: vi.fn(async () => [{ name: 'Opay', code: '100004' }]),
    pajRates: vi.fn(async () => ({ onRamp: 1397.72, offRamp: 1378.07 })),
    pajAccountName: vi.fn(async () => 'ADA OBI'),
    openOfframp: vi.fn(async (input: { usdc: bigint }) => {
      const id = newOrderId()
      orders.set(id, { status: 'INIT' })
      return {
        id,
        address: PAJ_ADDRESS,
        accountName: 'ADA OBI',
        fiatAmount: Math.floor((Number(input.usdc) / 1e6) * 1378.07 * 100) / 100,
        rate: 1378.07,
        status: 'INIT',
      }
    }),
    openOnramp: vi.fn(async (input: { amount: bigint }) => {
      const id = newOrderId()
      orders.set(id, { status: 'INIT' })
      return {
        id,
        accountNumber: '9012345678',
        bank: 'Nombank MFB',
        accountName: 'JIT/Paj Inc.',
        fiatAmount: Math.ceil((Number(input.amount) / 1e6) * 1397.72 * 100) / 100,
        rate: 1397.72,
        status: 'INIT',
      }
    }),
    pajOrder: vi.fn(async (id: string) => {
      const order = orders.get(id)
      if (!order) throw new PajError(404, 'Not found')
      return { id, ...order }
    }),
    webhookIsPaj: () => null,
  }
})

/** KyberSwap: AUSD buys USDC at 0.9998, whatever the size. */
const routes: bigint[] = []
vi.mock('../src/services/swap.js', () => ({
  swapRoute: vi.fn(async (_in: string, _out: string, amountIn: bigint) => {
    routes.push(amountIn)
    return { amountIn, amountOut: (amountIn * 9998n) / 10_000n, summary: { amountIn } }
  }),
  swapPrice: vi.fn(async () => 0.9998),
  buildSwap: vi.fn(async (route: { amountIn: bigint; amountOut: bigint }) => ({
    data: `0x5a7e${route.amountIn.toString(16).padStart(64, '0')}`,
    amountOut: route.amountOut,
  })),
}))

const sent: { to: string; data: Hex }[] = []
vi.mock('../src/relay.js', () => ({
  RefusedEstimate: class RefusedEstimate extends Error {},
  relayReady: () => true,
  relayAuthorization: vi.fn(),
  sendFromRelayer: vi.fn(async (to: string, data: Hex) => {
    sent.push({ to, data })
    return { status: 'success', transactionHash: `0x${hex(32)}` }
  }),
}))

vi.mock('../src/chain.js', async (original) => {
  const real = (await original()) as Record<string, unknown>
  return { ...real, feePayerAddress: '0x000000000000000000000000000000000000c0de' }
})

const naira = await import('../src/services/naira.js')
const { config } = await import('../src/config.js')
const { network, settlementToken } = await import('../src/chain.js')

const cashOutAbi = parseAbi([
  'function cashOut((address owner, uint256 value, uint256 validAfter, uint256 validBefore, uint8 v, bytes32 r, bytes32 s) auth, (address payTo, uint256 pay, bytes32 ref) payout, bytes swap)',
])

beforeAll(async () => {
  await runMigrations(config.DATABASE_URL)
})

beforeEach(() => {
  sent.length = 0
  routes.length = 0
})

async function quoted(owner = privateKeyToAccount(generatePrivateKey())) {
  const row = await naira.createCashOut(owner.address, {
    amount: 10_000_000n,
    bankCode: '100004',
    accountNumber: '0123456789',
  })
  return { owner, row, cashOut: naira.serializeCashOut(row) }
}

async function signed(
  owner: ReturnType<typeof privateKeyToAccount>,
  pay: ReturnType<typeof naira.serializeCashOut>['pay'],
) {
  const authorization = {
    from: owner.address,
    to: getAddress(pay.to as string),
    value: BigInt(pay.value),
    validAfter: 0n,
    validBefore: BigInt(pay.valid_before),
    nonce: pay.nonce,
  }
  const signature = await owner.signTypedData(
    transferAuthorizationTypedData(settlementToken, network.chainId, authorization),
  )
  return { token: settlementToken.address, authorization, signature }
}

describe('cashing out through PAJ', () => {
  it('quotes PAJ’s rate, less 0.1% for the swap, with no fee of Kova’s', async () => {
    const quote = await naira.quoteCashOut(10_000_000n)
    expect(quote.source).toBe('paj')
    expect(quote.rate).toBeCloseTo(1378.07 * 0.9989, 6)
    expect(quote.fee).toBe(0n)
    expect(quote.naira).toBe(BigInt(Math.floor(10 * 1378.07 * 0.9989 * 100)))
  })

  it('asks PAJ for 0.1% under the live swap, and the wallet signs a nonce naming PAJ and that USDC', async () => {
    const { row, cashOut } = await quoted()
    expect(row.partner).toBe('paj')
    expect(row.payUnits).toBe((9_998_000n * 9_990n) / 10_000n)
    expect(row.accountName).toBe('ADA OBI')
    expect(cashOut.pay.to).toBe(getAddress(CASH_OUT))
    expect(cashOut.pay.value).toBe('10000000')
    // KovaCashOut.nonceFor(payTo, pay, ref): keccak256(abi.encode(payTo, pay, ref)).
    const ref = pad(`0x${row.id.replace(/-/g, '')}`, { size: 32 })
    expect(cashOut.pay.nonce).toBe(
      keccak256(
        encodeAbiParameters(
          [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }],
          [getAddress(PAJ_ADDRESS), row.payUnits as bigint, ref],
        ),
      ),
    )
    expect(cashOut.test_mode).toBe(false)
  })

  it('is carried out by KovaCashOut, swapping just enough for PAJ’s USDC', async () => {
    const { owner, row, cashOut } = await quoted()
    routes.length = 0
    const paid = await naira.payCashOut(row, await signed(owner, cashOut.pay))
    expect(paid.status).toBe('paying')
    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toBe(getAddress(CASH_OUT))

    const call = decodeFunctionData({ abi: cashOutAbi, data: sent[0]?.data as Hex })
    const [auth, payout] = call.args
    expect(auth.owner).toBe(owner.address)
    expect(auth.value).toBe(10_000_000n)
    expect(payout.payTo).toBe(getAddress(PAJ_ADDRESS))
    expect(payout.pay).toBe(row.payUnits)
    // One route, for only what PAJ's USDC needs (plus 3 bps) at the kept price.
    expect(routes).toHaveLength(1)
    const enough = routes[0] as bigint
    expect(enough).toBeLessThan(10_000_000n)
    expect((enough * 9998n) / 10_000n).toBeGreaterThanOrEqual(row.payUnits as bigint)

    // Asking again does nothing more.
    await naira.payCashOut(paid, await signed(owner, cashOut.pay))
    expect(sent).toHaveLength(1)
  })

  it('takes no signature but the one for this cash-out', async () => {
    const first = await quoted()
    const second = await quoted(first.owner)
    await expect(
      naira.payCashOut(first.row, await signed(first.owner, second.cashOut.pay)),
    ).rejects.toThrow()
    expect(sent).toHaveLength(0)
  })

  it('follows PAJ until the bank is paid', async () => {
    const { owner, row, cashOut } = await quoted()
    const paying = await naira.payCashOut(row, await signed(owner, cashOut.pay))
    const order = row.partnerOrderId as string

    orders.set(order, { status: 'PROCESSING' })
    expect((await naira.refreshPajCashOut(paying)).status).toBe('paying')

    orders.set(order, { status: 'COMPLETED' })
    await naira.pajOrderEvent(order)
    expect((await naira.cashOutRow(row.id))?.status).toBe('paid')
  })
})

describe('adding money in naira through PAJ', () => {
  it('sends the payer to Kova’s page for a bank account PAJ opened, and settles when PAJ delivers', async () => {
    const wallet = privateKeyToAccount(generatePrivateKey()).address
    const started = await naira.startTopUp(wallet, {
      amount: 10_000_000n,
      email: 'ada@example.com',
      callbackUrl: 'https://mykova.app/wallet/add/naira',
    })
    expect(started.url).toBe(`https://mykova.app/naira/pay/${started.row.reference}`)
    const shown = naira.serializeTopUp(started.row)
    expect(shown.bank_transfer).toEqual({
      bank_name: 'Nombank MFB',
      account_number: '9012345678',
      account_name: 'JIT/Paj Inc.',
      naira: '₦13,977.20',
      naira_kobo: '1397720',
    })

    expect((await naira.settleTopUp(started.row.reference)).status).toBe('initialized')
    const order = started.row.partnerOrderId as string
    const delivered = `0x${hex(32)}`
    orders.set(order, { status: 'COMPLETED', signature: delivered })
    const settled = await naira.settleTopUp(started.row.reference)
    expect(settled.status).toBe('settled')
    expect(settled.txHash).toBe(delivered)
    // Kova's treasury sent nothing: PAJ delivered the dollars itself.
    expect(sent).toHaveLength(0)
  })
})
