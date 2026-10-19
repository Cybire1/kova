import { runMigrations, schema } from '@kova/db'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  sms: vi.fn(),
  balances: new Map<string, bigint>(),
  rpcDown: false,
}))
vi.mock('../src/chain.js', () => ({
  publicClient: {
    readContract: async ({ args }: { args: string[] }) => {
      if (state.rpcDown) throw Error('rpc down')
      return state.balances.get(args[0]!.toLowerCase()) ?? 0n
    },
  },
}))
vi.mock('../src/services/sms.js', () => ({ smsReady: () => true, sendSmsLater: state.sms }))
const { config } = await import('../src/config.js')
const { db } = await import('../src/db.js')
const { notifyArrivals } = await import('../src/services/arrival-sms.js')

const TOKEN = '0x00000000000000000000000000000000000000a0'
const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}`
const arrival = (from: string, to: string, amount = 1_000_000n) => ({
  tokenAddress: TOKEN,
  fromAddress: from,
  toAddress: to,
  amount,
})
let phoneN = 2348070000000
const phone = () => `+${phoneN++}`
async function pocket(at: string, status = 'active') {
  const number = phone()
  await db.insert(schema.ussdPockets).values({
    id: crypto.randomUUID(),
    ownerAddress: addr(0xdead00 + phoneN), // one pocket per owner
    phone: number,
    pocketAddress: at,
    sealedKey: 'test fixture only',
    pinHash: 'test fixture only',
    cap: 10_000_000n,
    status,
  })
  return number
}
async function verified(wallet: string, when: Date | null = new Date()) {
  const number = phone()
  await db.insert(schema.phoneAccounts).values({
    id: crypto.randomUUID(),
    network: config.KOVA_NETWORK,
    phone: number,
    wallet,
    verifiedAt: when,
  })
  return number
}

beforeAll(async () => {
  // These tests delete every row they touch: only ever run them on a database named for tests.
  if (!/\/[^/?]*test[^/?]*(\?|$)/.test(config.DATABASE_URL))
    throw Error('Run these tests on a test database (its name must contain "test").')
  await runMigrations(config.DATABASE_URL)
})
beforeEach(async () => {
  await db.delete(schema.ussdSpends)
  await db.delete(schema.ussdPockets)
  await db.delete(schema.phoneAccounts)
  state.sms.mockReset()
  state.balances.clear()
  state.rpcDown = false
  config.KOVA_NETWORK = 'testnet'
  config.KOVA_PHONE_SEND_ENABLED = '1'
  config.KOVA_USSD_ENABLED = '1'
  config.KOVA_USSD_CODE = '*384*53916#'
})

describe('texts when dollars arrive', () => {
  it('tells a USSD pocket owner what arrived, the new balance and how to use it', async () => {
    const at = addr(1)
    const number = await pocket(at)
    state.balances.set(at, 6_000_000n)
    await notifyArrivals([arrival(addr(2), at)])
    expect(state.sms).toHaveBeenCalledTimes(1)
    expect(state.sms).toHaveBeenCalledWith(
      number,
      'Kova TEST: $1.00 arrived in your USSD pocket. Balance $6.00. Dial *384*53916# to use it.',
    )
  })

  it('tells a wallet with a verified number that money arrived', async () => {
    const wallet = addr(3)
    const number = await verified(wallet)
    await notifyArrivals([arrival(addr(4), wallet, 2_500_000n)])
    expect(state.sms).toHaveBeenCalledWith(
      number,
      'Kova TEST: you received $2.50 in your Kova wallet.',
    )
  })

  it('texts nobody Kova doesn’t know by a verified number or an active pocket', async () => {
    await verified(addr(5), null)
    await pocket(addr(6), 'pending')
    await pocket(addr(7), 'closed')
    await notifyArrivals([
      arrival(addr(9), addr(5)),
      arrival(addr(9), addr(6)),
      arrival(addr(9), addr(7)),
      arrival(addr(9), addr(8)),
    ])
    expect(state.sms).not.toHaveBeenCalled()
  })

  it('leaves pocket spends to their own receipt, and skips dust and self-transfers', async () => {
    const from = addr(10)
    await pocket(from)
    const wallet = addr(11)
    await verified(wallet)
    await notifyArrivals([
      arrival(from, wallet),
      arrival(addr(12), wallet, 9_999n),
      arrival(wallet, wallet),
    ])
    expect(state.sms).not.toHaveBeenCalled()
  })

  it('sends nothing while phone payments and USSD are both switched off', async () => {
    const wallet = addr(13)
    await verified(wallet)
    config.KOVA_PHONE_SEND_ENABLED = '0'
    config.KOVA_USSD_ENABLED = '0'
    await notifyArrivals([arrival(addr(14), wallet)])
    expect(state.sms).not.toHaveBeenCalled()
  })

  it('says Kova without TEST on mainnet, and still texts when the balance can’t be read', async () => {
    config.KOVA_NETWORK = 'mainnet'
    const at = addr(15)
    const number = await pocket(at)
    state.rpcDown = true
    await notifyArrivals([arrival(addr(16), at)])
    expect(state.sms).toHaveBeenCalledWith(
      number,
      'Kova: $1.00 arrived in your USSD pocket. Dial *384*53916# to use it.',
    )
  })
})
