import { runMigrations } from '@kova/db'
import { kovaSaverAbi } from '@kova/monad'
import {
  type Address,
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  type Hex,
  toHex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Savings with a partner's vault (setsAUSD): who can put money in while it's tried out, the
 * vault's cap and what can come out right now said before the relayer spends anything, the rate
 * read off the vault's share price, and what actually came back. Monad and the relayer are stubbed;
 * the moves are kept in a real database. Requires a local Postgres (DATABASE_URL).
 */

const VAULT = '0x551903E3687820A733FBe406DD33Fee8D12bd2F3' as Address
const SAVER = '0x00000000000000000000000000000000005a7e12' as Address

const chain = vi.hoisted(() => ({
  shares: 0n,
  /** Dollars (6 decimals) per 10^12 shares, now and a week ago. */
  price: 1_002_131n,
  priceWeekAgo: 1_001_500n,
  room: 1_978_855_860n as bigint | null,
  redeemable: null as bigint | null,
  /** What the vault's swap leaves when shares come out, in millionths. */
  outCut: 999_900n,
  sent: [] as { to: string; maxGas?: bigint }[],
}))

vi.mock('../src/chain.js', async (original) => {
  const real = (await original()) as Record<string, unknown>
  const worth = (shares: bigint, blockNumber?: bigint) =>
    (shares * (blockNumber === 1_000n ? chain.priceWeekAgo : chain.price)) / 10n ** 12n
  return {
    ...real,
    publicClient: {
      getBlock: async ({ blockNumber }: { blockNumber?: bigint } = {}) =>
        blockNumber === undefined
          ? { number: 1_513_000n, timestamp: 1_800_604_800n }
          : { number: 1_000n, timestamp: 1_800_000_000n },
      readContract: async ({
        functionName,
        args,
        blockNumber,
      }: {
        functionName: string
        args?: readonly unknown[]
        blockNumber?: bigint
      }) => {
        if (functionName === 'name') return 'Setsuna AUSD Savings'
        if (functionName === 'balanceOf') return chain.shares
        if (functionName === 'nonces') return 0n
        if (functionName === 'convertToAssets') return worth(args?.[0] as bigint, blockNumber)
        if (functionName === 'maxDeposit') {
          if (chain.room === null) throw new Error('no maxDeposit')
          return chain.room
        }
        if (functionName === 'maxRedeem') return chain.redeemable ?? chain.shares
        throw new Error(`unexpected read ${functionName}`)
      },
    },
  }
})

vi.mock('../src/relay.js', () => ({
  sendFromRelayer: vi.fn(async (to: string, data: Hex, options: { maxGas?: bigint } = {}) => {
    chain.sent.push({ to, maxGas: options.maxGas })
    const withdrawing = data.startsWith('0x') && chain.shares > 0n
    // KovaSaver logs what the vault actually paid out.
    const paid = (((chain.shares * chain.price) / 10n ** 12n) * chain.outCut) / 1_000_000n
    return {
      status: 'success',
      transactionHash: toHex(crypto.getRandomValues(new Uint8Array(32))),
      logs: withdrawing
        ? [
            {
              address: SAVER,
              topics: encodeEventTopics({
                abi: kovaSaverAbi,
                eventName: 'Withdrawn',
                args: { owner: getAddress(`0x${'1'.repeat(40)}`) },
              }),
              data: encodeAbiParameters(
                [{ type: 'uint256' }, { type: 'uint256' }],
                [chain.shares, paid],
              ),
            },
          ]
        : [],
    }
  }),
}))

const { config } = await import('../src/config.js')
const money = await import('../src/services/money.js')

const saved = {
  vault: config.KOVA_SAVINGS_VAULT,
  saver: config.KOVA_SAVER,
  wallets: config.KOVA_SAVINGS_WALLETS,
}
const wallet = () => privateKeyToAccount(generatePrivateKey()).address
const signedIn = (value: bigint) => ({
  value,
  validAfter: 0n,
  validBefore: 1_900_000_000n,
  nonce: toHex(crypto.getRandomValues(new Uint8Array(32))),
  signature: `0x${'11'.repeat(32)}${'22'.repeat(32)}1b` as Hex,
})
const signedOut = (shares: bigint) => ({
  shares,
  deadline: 1_900_000_000n,
  signature: `0x${'11'.repeat(32)}${'22'.repeat(32)}1b` as Hex,
})

beforeAll(async () => {
  await runMigrations(config.DATABASE_URL)
})

beforeEach(() => {
  config.KOVA_SAVINGS_VAULT = VAULT
  config.KOVA_SAVER = SAVER
  chain.shares = 0n
  chain.room = 1_978_855_860n
  chain.redeemable = null
  chain.sent.length = 0
})

afterEach(() => {
  config.KOVA_SAVINGS_VAULT = saved.vault
  config.KOVA_SAVER = saved.saver
  config.KOVA_SAVINGS_WALLETS = saved.wallets
})

describe('who can put money into savings', () => {
  it('is nobody on mainnet until wallets are listed, so a vault alone never opens it to all', () => {
    const ada = wallet()
    config.KOVA_SAVINGS_WALLETS = undefined
    expect(money.savingsOpenTo(ada, 'mainnet')).toBe(false)
    expect(money.savingsOpenTo(ada, 'testnet')).toBe(true)
    config.KOVA_SAVINGS_WALLETS = `0x${'9'.repeat(40)}, ${ada.toLowerCase()}`
    expect(money.savingsOpenTo(ada, 'mainnet')).toBe(true)
    expect(money.savingsOpenTo(wallet(), 'mainnet')).toBe(false)
    config.KOVA_SAVINGS_WALLETS = 'everyone'
    expect(money.savingsOpenTo(wallet(), 'mainnet')).toBe(true)
  })

  it('shows savings closed to an unlisted wallet, but open for taking out to one already saving', async () => {
    config.KOVA_SAVINGS_WALLETS = `0x${'9'.repeat(40)}`
    const bo = wallet()
    expect((await money.savingsFor(bo)).live).toBe(false)
    chain.shares = 5_000_000_000_000n
    const holding = await money.savingsFor(bo)
    expect(holding.live).toBe(true)
    expect(holding.can_save).toBe(false)
    expect(holding.room).toBe('0')
    expect(holding.withdrawable).toBe(holding.balance)
    await expect(money.saveIn(bo, signedIn(1_000_000n))).rejects.toThrow(
      /isn’t open to this wallet/,
    )
    expect(chain.sent).toHaveLength(0)
  })
})

describe('a listed wallet saving', () => {
  it('sees the room left under the cap, what can come out, and the rate from the share price', async () => {
    const ada = wallet()
    config.KOVA_SAVINGS_WALLETS = ada
    chain.shares = 10_000_000_000_000n
    const savings = await money.savingsFor(ada)
    expect(savings.live).toBe(true)
    expect(savings.can_save).toBe(true)
    expect(savings.balance).toBe('10021310')
    expect(savings.room).toBe('1978855860')
    expect(savings.withdrawable).toBe('10021310')
    // A week from 1.0015 to 1.002131, a year's worth: about 3.3%.
    expect(savings.rate?.days).toBe(7)
    expect(savings.rate?.yearly).toBeGreaterThan(0.032)
    expect(savings.rate?.yearly).toBeLessThan(0.034)
  })

  it('is told the room before the relayer spends anything, and saves inside it', async () => {
    const ada = wallet()
    config.KOVA_SAVINGS_WALLETS = ada
    chain.room = 5_000_000n
    await expect(money.saveIn(ada, signedIn(20_000_000n))).rejects.toThrow(
      'Savings can take $5.00 more right now.',
    )
    chain.room = 0n
    await expect(money.saveIn(ada, signedIn(1_000_000n))).rejects.toThrow(/Savings is full/)
    expect(chain.sent).toHaveLength(0)
    chain.room = 5_000_000n
    await money.saveIn(ada, signedIn(5_000_000n))
    expect(chain.sent).toEqual([{ to: getAddress(SAVER), maxGas: 3_000_000n }])
  })

  it('says what can come out now when the vault holds some back, and keeps what actually came back', async () => {
    const ada = wallet()
    config.KOVA_SAVINGS_WALLETS = ada
    chain.shares = 10_000_000_000_000n
    chain.redeemable = 4_000_000_000_000n
    await expect(money.saveOut(ada, signedOut(chain.shares))).rejects.toThrow(
      'You can move $4.01 out right now.',
    )
    chain.redeemable = 0n
    await expect(money.saveOut(ada, signedOut(chain.shares))).rejects.toThrow(
      /can’t pay out right now/,
    )
    expect(chain.sent).toHaveLength(0)

    chain.redeemable = null
    const out = await money.saveOut(ada, signedOut(chain.shares))
    // $10.02131 of shares, less the vault's 0.01% swap on the way out.
    expect(out.amount).toBe('10020307')
    const after = await money.savingsFor(ada)
    expect(after.moves[0]).toMatchObject({ kind: 'out', amount: '10020307' })
  })
})
