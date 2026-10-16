import { runMigrations } from '@kova/db'
import { AUSD_TESTNET_FAUCET, eip3009Abi, faucetAbi, TEST_DOLLARS_A_DAY } from '@kova/monad'
import { type Address, decodeFunctionData, type Hex, isAddressEqual } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../src/config.js'
import { claimTestDollars, giveTestDollars } from '../src/services/faucet.js'

/**
 * When the treasury can't cover a day's test dollars, it asks Agora's testnet faucet for itself
 * (10,000 test AUSD) through the relayer's one send path, once however many wallets are waiting.
 * The chain is replaced by a ledger here; the claims run against a real database.
 *
 * Requires a local Postgres (DATABASE_URL); migrations are applied here.
 */

const chain = vi.hoisted(() => ({
  treasury: '0x000000000000000000000000000000000000dEaD' as Address,
  stock: 0n,
  dry: false,
  sends: [] as { to: Address; data: Hex }[],
}))

vi.mock('../src/chain.js', () => ({
  feePayerAccount: { address: chain.treasury },
  walletClient: {},
  settlementToken: { address: '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC' },
  publicClient: { readContract: async () => chain.stock },
}))

vi.mock('../src/relay.js', () => ({
  sendFromRelayer: async (to: Address, data: Hex) => {
    chain.sends.push({ to, data })
    await new Promise((resolve) => setTimeout(resolve, 20))
    if (to.toLowerCase() === '0xd236c18d274e54faccc3dd9dda4b27965a73ee6c') {
      if (chain.dry) throw new Error('execution reverted: InsufficientFunds()')
      chain.stock += 10_000_000_000n
    } else {
      chain.stock -= TEST_DOLLARS_A_DAY
    }
    return { status: 'success', transactionHash: `0x${'ab'.repeat(32)}` }
  },
}))

const wallet = () => privateKeyToAccount(generatePrivateKey()).address
const faucetCalls = () => chain.sends.filter((s) => isAddressEqual(s.to, AUSD_TESTNET_FAUCET))
const transfers = () => chain.sends.filter((s) => !isAddressEqual(s.to, AUSD_TESTNET_FAUCET))

beforeAll(async () => {
  await runMigrations(config.DATABASE_URL)
})

beforeEach(() => {
  chain.stock = 0n
  chain.dry = false
  chain.sends = []
})

describe('test dollars restock from Agora’s faucet', () => {
  it('asks the faucet for the treasury when it is short, then pays', async () => {
    chain.stock = 1_000_000n
    const who = wallet()
    const drip = await giveTestDollars(who)

    expect(faucetCalls()).toHaveLength(1)
    const ask = decodeFunctionData({ abi: faucetAbi, data: faucetCalls()[0]!.data })
    expect(ask.functionName).toBe('requestFunds')
    expect(isAddressEqual(ask.args[0], chain.treasury)).toBe(true)

    const [pay] = transfers()
    const sent = decodeFunctionData({ abi: eip3009Abi, data: pay!.data })
    expect(sent.functionName).toBe('transfer')
    expect(isAddressEqual(sent.args[0] as Address, who)).toBe(true)
    expect(sent.args[1]).toBe(TEST_DOLLARS_A_DAY)
    expect(drip.txHash).toMatch(/^0x/)
  })

  it('asks once, however many wallets are waiting', async () => {
    await Promise.all([
      giveTestDollars(wallet()),
      giveTestDollars(wallet()),
      giveTestDollars(wallet()),
    ])
    expect(faucetCalls()).toHaveLength(1)
    expect(transfers()).toHaveLength(3)
  })

  it('leaves the faucet alone while the treasury has stock', async () => {
    chain.stock = 50_000_000n
    await giveTestDollars(wallet())
    expect(faucetCalls()).toHaveLength(0)
  })

  it('says test dollars have run out when the faucet is dry, and gives the day back', async () => {
    chain.dry = true
    const who = wallet()
    await expect(giveTestDollars(who)).rejects.toThrow(/run out/)
    expect(transfers()).toHaveLength(0)
    expect(await claimTestDollars(who)).toEqual({ ok: true })
  })
})
