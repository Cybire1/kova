import { runMigrations, schema, uuidv7 } from '@kova/db'
import {
  kovaRepeatAbi,
  repeatPlanTypedData,
  repeatStopTypedData,
  splitRulesTypedData,
} from '@kova/monad'
import { eq } from 'drizzle-orm'
import {
  type Address,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  type Hex,
  toHex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Programmable payments: a shop's splits are set only by the wallet it's paid into, and new
 * charges are then paid to its splitter; repeat payments start from the payer's signed plan, are
 * collected only when the contract says they're due, and stop only by the payer. Monad and the
 * relayer are stubbed; everything Kova keeps is in a real database (DATABASE_URL).
 */

const SPLITS = getAddress('0x00000000000000000000000000000000005b1175')
const REPEAT = getAddress('0x000000000000000000000000000000000e9ea700')
const SPLITTER = getAddress('0x0000000000000000000000000000000000c1a0e5')

const chain = vi.hoisted(() => ({
  splitterDeployed: false,
  rules: { to: [] as string[], bps: [] as number[] },
  plan: null as null | {
    payer: string
    payee: string
    amount: bigint
    every: number
    next: bigint
    left: number
    stopped: boolean
  },
  due: false,
  nextId: BigInt(Date.now()),
  sent: [] as { to: string; data: Hex }[],
}))

vi.mock('../src/chain.js', async (original) => {
  const real = (await original()) as Record<string, unknown>
  return {
    ...real,
    publicClient: {
      getCode: async ({ address }: { address: string }) =>
        address.toLowerCase() === SPLITTER.toLowerCase() && chain.splitterDeployed
          ? '0x6080'
          : '0x',
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === 'splitterOf') return SPLITTER
        if (functionName === 'nonces') return 0n
        if (functionName === 'rules') return ['0x', chain.rules.to, chain.rules.bps]
        if (functionName === 'planOf') return chain.plan
        if (functionName === 'due') return chain.due
        if (functionName === 'balanceOf') return 0n
        throw new Error(`unexpected read ${functionName}`)
      },
    },
  }
})

vi.mock('../src/relay.js', () => ({
  RefusedEstimate: class RefusedEstimate extends Error {},
  sendFromRelayer: vi.fn(async (to: string, data: Hex) => {
    chain.sent.push({ to, data })
    const logs: { address: string; topics: Hex[]; data: Hex }[] = []
    if (to.toLowerCase() === REPEAT.toLowerCase()) {
      const call = decodeFunctionData({ abi: kovaRepeatAbi, data })
      if (call.functionName === 'start') {
        const [payer, payee, amount, every, startAt, times] = call.args
        const now = BigInt(Math.floor(Date.now() / 1000))
        const paidNow = BigInt(startAt) <= now
        chain.plan = {
          payer,
          payee,
          amount,
          every,
          next: paidNow ? BigInt(startAt) + BigInt(every) : BigInt(startAt),
          left: paidNow ? times - 1 : times,
          stopped: false,
        }
        logs.push({
          address: REPEAT,
          topics: encodeEventTopics({
            abi: kovaRepeatAbi,
            eventName: 'PlanStarted',
            args: { id: chain.nextId++, payer, payee },
          }) as Hex[],
          data: encodeAbiParameters(
            [{ type: 'uint96' }, { type: 'uint32' }, { type: 'uint40' }, { type: 'uint32' }],
            [amount, every, startAt, times],
          ),
        })
        // The contract pays a plan that's due now in the same transaction, and says so.
        if (paidNow)
          logs.push({
            address: REPEAT,
            topics: encodeEventTopics({
              abi: kovaRepeatAbi,
              eventName: 'PlanPaid',
              args: { id: chain.nextId - 1n, payer, payee },
            }) as Hex[],
            data: encodeAbiParameters(
              [{ type: 'uint96' }, { type: 'uint32' }],
              [amount, times - 1],
            ),
          })
      }
      if (call.functionName === 'collect' && chain.plan) {
        chain.plan.left -= 1
        chain.plan.next += BigInt(chain.plan.every)
      }
      if (call.functionName === 'stop' && chain.plan) chain.plan.stopped = true
    }
    return {
      status: 'success',
      transactionHash: toHex(crypto.getRandomValues(new Uint8Array(32))),
      logs,
    }
  }),
}))

const { config } = await import('../src/config.js')
const { db } = await import('../src/db.js')
const { network } = await import('../src/chain.js')
const programs = await import('../src/services/programs.js')
const { createIntent } = await import('../src/services/intents.js')

const saved = { splits: config.KOVA_SPLITS, repeat: config.KOVA_REPEAT }

beforeAll(async () => {
  await runMigrations(config.DATABASE_URL)
})

beforeEach(() => {
  config.KOVA_SPLITS = SPLITS
  config.KOVA_REPEAT = REPEAT
  chain.splitterDeployed = false
  chain.rules = { to: [], bps: [] }
  chain.plan = null
  chain.due = false
  chain.sent.length = 0
})

afterEach(() => {
  config.KOVA_SPLITS = saved.splits
  config.KOVA_REPEAT = saved.repeat
})

async function shopFor(settlement: Address) {
  const [merchant] = await db
    .insert(schema.merchants)
    .values({
      id: uuidv7(),
      name: 'Oyin Kitchen',
      slug: `oyin-${uuidv7()}`,
      settlementAddress: settlement.toLowerCase(),
      network: network.id,
      isTest: true,
    })
    .returning()
  if (!merchant) throw new Error('no merchant')
  return merchant
}

describe('splits', () => {
  const savings = getAddress(`0x${'5a4e'.repeat(10)}`)
  const partner = getAddress(`0x${'9a47'.repeat(10)}`)
  const shares = [
    { to: savings, bps: 1000, name: 'Savings' },
    { to: partner, bps: 500, name: 'Ada' },
  ]

  it('are set by the wallet the shop is paid into, and then its charges are paid to its splitter', async () => {
    const owner = privateKeyToAccount(generatePrivateKey())
    const shop = await shopFor(owner.address)
    const prepared = await programs.prepareSplits(shop, shares)
    const signature = await owner.signTypedData(
      splitRulesTypedData(network.chainId, SPLITS, {
        owner: owner.address,
        to: prepared.to,
        bps: prepared.bps,
        nonce: BigInt(prepared.nonce),
        deadline: BigInt(prepared.deadline),
      }),
    )
    chain.splitterDeployed = true
    chain.rules = { to: [savings, partner], bps: [1000, 500] }
    const saved = await programs.saveSplits(shop, shares, prepared.deadline, signature)
    expect(saved.live && saved.on).toBe(true)
    expect(saved.live && saved.shares.map((s) => s.name)).toEqual(['Savings', 'Ada'])
    expect(chain.sent[0]?.to).toBe(SPLITS)

    const updated = await db.query.merchants.findFirst({ where: eq(schema.merchants.id, shop.id) })
    if (!updated) throw new Error('gone')
    expect(updated.splitterAddress).toBe(SPLITTER.toLowerCase())
    const charge = await createIntent({ merchant: updated, amount: '6.50', currency: 'AUSD' })
    expect(charge.payTo.toLowerCase()).toBe(SPLITTER.toLowerCase())
  })

  it('refuse a signature from any other wallet, and spend nothing', async () => {
    const owner = privateKeyToAccount(generatePrivateKey())
    const stranger = privateKeyToAccount(generatePrivateKey())
    const shop = await shopFor(owner.address)
    const prepared = await programs.prepareSplits(shop, shares)
    const signature = await stranger.signTypedData(
      splitRulesTypedData(network.chainId, SPLITS, {
        owner: owner.address,
        to: prepared.to,
        bps: prepared.bps,
        nonce: BigInt(prepared.nonce),
        deadline: BigInt(prepared.deadline),
      }),
    )
    await expect(programs.saveSplits(shop, shares, prepared.deadline, signature)).rejects.toThrow(
      /wallet the shop is paid into/,
    )
    expect(chain.sent).toHaveLength(0)
  })

  it('say plainly when the shares add up to more than everything', async () => {
    const shop = await shopFor(privateKeyToAccount(generatePrivateKey()).address)
    await expect(
      programs.prepareSplits(shop, [
        { to: savings, bps: 6000 },
        { to: partner, bps: 5000 },
      ]),
    ).rejects.toThrow(/more than everything/)
  })

  it('are off when the contract isn’t configured, and charges go to the wallet as before', async () => {
    config.KOVA_SPLITS = undefined
    const shop = await shopFor(privateKeyToAccount(generatePrivateKey()).address)
    expect((await programs.shopSplits(shop)).live).toBe(false)
    const charge = await createIntent({ merchant: shop, amount: '1.00', currency: 'AUSD' })
    expect(charge.payTo).toBe(shop.settlementAddress)
  })
})

describe('repeat payments', () => {
  const landlord = getAddress(`0x${'1a4d'.repeat(10)}`)

  async function start(payer: ReturnType<typeof privateKeyToAccount>, startAt: number) {
    const input = {
      payee: landlord,
      amount: 50_000_000n,
      every: 7 * 86_400,
      start: startAt,
      times: 4,
      label: 'Rent',
    }
    const prepared = await programs.prepareRepeat(payer.address, input)
    const signature = await payer.signTypedData(
      repeatPlanTypedData(network.chainId, REPEAT, {
        payer: payer.address,
        payee: input.payee,
        amount: input.amount,
        every: input.every,
        start: input.start,
        times: input.times,
        nonce: BigInt(prepared.nonce),
        deadline: BigInt(prepared.deadline),
      }),
    )
    expect(prepared.permit_value).toBe('200000000')
    return programs.startRepeat(payer.address, input, prepared.deadline, signature, {
      deadline: prepared.deadline,
      signature: `0x${'11'.repeat(32)}${'22'.repeat(32)}1b`,
    })
  }

  it('start from the payer’s signed plan, the first payment paid when it’s due now', async () => {
    const payer = privateKeyToAccount(generatePrivateKey())
    const plan = await start(payer, Math.floor(Date.now() / 1000))
    expect(plan.label).toBe('Rent')
    expect(plan.amount).toBe('50.00')
    expect(plan.paid).toBe(1)
    expect(plan.left).toBe(3)
    expect(plan.role).toBe('paying')
    const theirs = await programs.listRepeats(landlord)
    expect(theirs.some((p) => p.id === plan.id && p.role === 'getting')).toBe(true)
  })

  it('refuse a plan signed by anyone but the payer', async () => {
    const payer = privateKeyToAccount(generatePrivateKey())
    const input = {
      payee: landlord,
      amount: 50_000_000n,
      every: 7 * 86_400,
      start: Math.floor(Date.now() / 1000),
      times: 4,
    }
    const prepared = await programs.prepareRepeat(payer.address, input)
    const forged = await privateKeyToAccount(generatePrivateKey()).signTypedData(
      repeatPlanTypedData(network.chainId, REPEAT, {
        payer: payer.address,
        ...input,
        nonce: 0n,
        deadline: BigInt(prepared.deadline),
      }),
    )
    await expect(
      programs.startRepeat(payer.address, input, prepared.deadline, forged, {
        deadline: prepared.deadline,
        signature: forged,
      }),
    ).rejects.toThrow(/not signed by the wallet paying/)
    expect(chain.sent).toHaveLength(0)
  })

  it('are collected only when the contract says they’re due', async () => {
    const payer = privateKeyToAccount(generatePrivateKey())
    const plan = await start(payer, Math.floor(Date.now() / 1000))
    // Make it due in Kova's mirror, but the contract says not yet: nothing is sent.
    await db
      .update(schema.repeatPlans)
      .set({ nextAt: new Date(Date.now() - 1000) })
      .where(eq(schema.repeatPlans.id, plan.id))
    chain.sent.length = 0
    chain.due = false
    await programs.collectDueRepeats()
    expect(chain.sent).toHaveLength(0)
    // Now it's due on Monad too.
    await db
      .update(schema.repeatPlans)
      .set({ nextAt: new Date(Date.now() - 1000) })
      .where(eq(schema.repeatPlans.id, plan.id))
    chain.due = true
    await programs.collectDueRepeats()
    expect(chain.sent.filter((s) => s.to === REPEAT)).toHaveLength(1)
    const after = (await programs.listRepeats(payer.address)).find((p) => p.id === plan.id)
    expect(after?.paid).toBe(2)
  })

  it('stop only by the payer’s signature', async () => {
    const payer = privateKeyToAccount(generatePrivateKey())
    const plan = await start(payer, Math.floor(Date.now() / 1000) + 86_400)
    const prepared = await programs.prepareStopRepeat(payer.address, plan.id)
    const typed = repeatStopTypedData(network.chainId, REPEAT, {
      payer: payer.address,
      id: BigInt(prepared.plan_id),
      nonce: BigInt(prepared.nonce),
      deadline: BigInt(prepared.deadline),
    })
    const forged = await privateKeyToAccount(generatePrivateKey()).signTypedData(typed)
    await expect(
      programs.stopRepeat(payer.address, plan.id, prepared.deadline, forged),
    ).rejects.toThrow(/Only the wallet paying/)
    const stopped = await programs.stopRepeat(
      payer.address,
      plan.id,
      prepared.deadline,
      await payer.signTypedData(typed),
    )
    expect(stopped.status).toBe('stopped')
    expect(stopped.next_at).toBeNull()
  })

  it('turn down plans that make no sense, before anything is signed', async () => {
    const payer = privateKeyToAccount(generatePrivateKey())
    const base = {
      payee: landlord,
      amount: 1_000_000n,
      every: 7 * 86_400,
      start: Math.floor(Date.now() / 1000),
      times: 3,
    }
    await expect(
      programs.prepareRepeat(payer.address, { ...base, payee: payer.address }),
    ).rejects.toThrow(/someone else/)
    await expect(programs.prepareRepeat(payer.address, { ...base, every: 60 })).rejects.toThrow(
      /hourly/,
    )
    await expect(programs.prepareRepeat(payer.address, { ...base, times: 0 })).rejects.toThrow(
      /From 1/,
    )
  })
})
