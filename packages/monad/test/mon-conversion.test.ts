import {
  type Address,
  parseEther,
  parseTransaction,
  recoverTransactionAddress,
  zeroAddress,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChainDepositActivity, ChainDepositQuote } from '../src/chain-deposits.js'
import {
  conversionActivity,
  conversionWasNotSent,
  formatMon,
  maxMonConversion,
  monClient,
  prepareMonConversion,
  sendMonConversion,
} from '../src/mon-conversion.js'
import { providerSigningSession } from '../src/provider-account.js'

const account = privateKeyToAccount(generatePrivateKey())
const destination = '0x2222222222222222222222222222222222222222'
const hash = `0x${'ab'.repeat(32)}` as const
function quote(): ChainDepositQuote {
  return {
    provider: 'relay',
    request_id: `0x${'12'.repeat(32)}`,
    address: destination,
    chain: { id: 143, name: 'Monad', vm: 'evm', tokens: [] },
    token: { address: zeroAddress, symbol: 'MON', decimals: 18 },
    amount: '100',
    expected_ausd: '2',
    minimum_ausd: '1.99',
    route_fee_usd: '0.01',
    time_estimate_seconds: 5,
    refund_to: account.address,
    quoted_at: new Date().toISOString(),
    pricing: 'estimate',
  }
}
beforeEach(() => {
  vi.spyOn(monClient, 'getBalance').mockResolvedValue(parseEther('1000'))
  vi.spyOn(monClient, 'getGasPrice').mockResolvedValue(100_000_000_000n)
  vi.spyOn(monClient, 'estimateGas').mockResolvedValue(21_000n)
  vi.spyOn(monClient, 'getChainId').mockResolvedValue(143)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('MON held in the Kova wallet', () => {
  it('formats whole amounts and tiny positive holdings without showing a false zero', () => {
    expect(formatMon(parseEther('1000'))).toBe('1000')
    expect(formatMon(parseEther('12.3400001'))).toBe('12.34')
    expect(formatMon(1n)).toBe('<0.000001')
    expect(formatMon(0n)).toBe('0')
  })
  it('keeps gas out of Max and refuses amounts that cannot cover fees', async () => {
    expect(await maxMonConversion(account.address)).toBe('999.98')
    await expect(
      prepareMonConversion(account.address, '1000', { ...quote(), amount: '1000' }),
    ).rejects.toThrow('network fee')
    vi.mocked(monClient.getBalance).mockResolvedValue(1n)
    await expect(maxMonConversion(account.address)).rejects.toThrow('network fee')
  })
  it('previews the exact deposit transfer and shows its maximum gas cost without signing', async () => {
    const plan = await prepareMonConversion(account.address, '100', quote())
    expect(plan.value).toBe(parseEther('100'))
    expect(plan.gas).toBe(25_200n)
    expect(plan.networkFee).toBe(5_040_000_000_000_000n)
    expect(monClient.estimateGas).toHaveBeenCalledWith({
      account: account.address,
      to: destination,
      value: parseEther('100'),
    })
  })
  it.each([
    [
      'wrong network',
      (q: ChainDepositQuote) => {
        q.chain.id = 1
      },
    ],
    [
      'wrong input token',
      (q: ChainDepositQuote) => {
        q.token.address = destination
      },
    ],
    [
      'wrong decimals',
      (q: ChainDepositQuote) => {
        q.token.decimals = 6
      },
    ],
    [
      'wrong amount',
      (q: ChainDepositQuote) => {
        q.amount = '101'
      },
    ],
    [
      'wrong refund recipient',
      (q: ChainDepositQuote) => {
        q.refund_to = destination
      },
    ],
    [
      'invalid deposit address',
      (q: ChainDepositQuote) => {
        q.address = zeroAddress
      },
    ],
    [
      'expired quote',
      (q: ChainDepositQuote) => {
        q.quoted_at = new Date(Date.now() - 121_000).toISOString()
      },
    ],
  ])('refuses a %s before estimating or signing', async (_reason, mutate) => {
    const q = quote()
    mutate(q)
    await expect(prepareMonConversion(account.address, '100', q)).rejects.toThrow('quote')
    expect(monClient.estimateGas).not.toHaveBeenCalled()
  })
  it('refuses a changed balance, chain or fee before broadcasting and identifies it as safe to retry', async () => {
    const plan = await prepareMonConversion(account.address, '100', quote())
    vi.mocked(monClient.getChainId).mockResolvedValue(1)
    const error = await sendMonConversion(plan, account).catch((e) => e)
    expect(error.message).toContain('Monad mainnet')
    expect(conversionWasNotSent(error)).toBe(true)
    vi.mocked(monClient.getChainId).mockResolvedValue(143)
    vi.mocked(monClient.getBalance).mockResolvedValue(0n)
    await expect(sendMonConversion(plan, account)).rejects.toThrow('balance changed')
    vi.mocked(monClient.getBalance).mockResolvedValue(parseEther('1000'))
    vi.mocked(monClient.getGasPrice).mockResolvedValue(plan.gasPrice + 1n)
    await expect(sendMonConversion(plan, account)).rejects.toThrow('fee changed')
  })
  it('sends the exact approved MON transfer through the Google wallet, without contract calldata', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_accounts') return [account.address]
      if (method === 'eth_chainId') return '0x8f'
      if (method === 'eth_sendTransaction') return hash
      throw new Error(`Unexpected RPC ${method}`)
    })
    const google = providerSigningSession(account.address, { request }, 'mainnet')
    const plan = await prepareMonConversion(account.address, '100', quote())
    expect(await sendMonConversion(plan, google.account)).toBe(hash)
    const sent = request.mock.calls.find(
      ([args]) => args.method === 'eth_sendTransaction',
    )?.[0] as unknown as {
      params: [
        { from: Address; to: Address; value: string; data?: string; gas: string; gasPrice: string },
      ]
    }
    expect(sent.params[0].from.toLowerCase()).toBe(account.address.toLowerCase())
    expect(sent.params[0].to.toLowerCase()).toBe(destination)
    expect(BigInt(sent.params[0].value)).toBe(plan.value)
    expect(BigInt(sent.params[0].gas) * BigInt(sent.params[0].gasPrice)).toBe(plan.networkFee)
    expect(sent.params[0].data).toBeUndefined()
    google.session.end()
    await expect(sendMonConversion(plan, google.account)).rejects.toThrow('locked')
  })
  it('preserves uncertain broadcasts and only treats explicit cancellation as safe to retry', () => {
    expect(conversionWasNotSent(new Error('Network timeout after broadcast'))).toBe(false)
    expect(conversionWasNotSent({ cause: { cause: { code: 4001 } } })).toBe(true)
  })
  it('signs a real native transaction for a local passkey-style account and broadcasts only the approved value', async () => {
    const plan = await prepareMonConversion(account.address, '100', quote())
    let raw: `0x${string}` | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string)
        let result: unknown
        if (body.method === 'eth_chainId') result = '0x8f'
        else if (body.method === 'eth_getTransactionCount') result = '0x0'
        else if (body.method === 'eth_sendRawTransaction') {
          raw = body.params[0]
          result = hash
        } else throw new Error(`Unexpected transaction RPC ${body.method}`)
        return Response.json({ jsonrpc: '2.0', id: body.id, result })
      }),
    )
    expect(await sendMonConversion(plan, account)).toBe(hash)
    const transaction = parseTransaction(raw!)
    expect(transaction.chainId).toBe(143)
    expect(transaction.to?.toLowerCase()).toBe(destination)
    expect(transaction.value).toBe(parseEther('100'))
    expect(transaction.gas).toBe(plan.gas)
    expect(transaction.gasPrice).toBe(plan.gasPrice)
    expect(await recoverTransactionAddress({ serializedTransaction: raw as Parameters<typeof recoverTransactionAddress>[0]['serializedTransaction'] })).toBe(account.address)
  })
  it('never mistakes a previous successful transfer at a reused address for this conversion', () => {
    const pending = {
      wallet: account.address,
      requestId: quote().request_id,
      depositAddress: destination,
      amount: '100',
      startedAt: Date.now(),
      hash,
    }
    const old = {
      id: 'old',
      status: 'success',
      deposit_address: destination,
      deposit_tx: `0x${'cc'.repeat(32)}`,
      created_at: new Date(Date.now() - 3600000).toISOString(),
    } as ChainDepositActivity
    const fresh = { ...old, id: 'new', status: 'pending', deposit_tx: hash } as ChainDepositActivity
    expect(conversionActivity(pending, [old])).toBeNull()
    expect(conversionActivity(pending, [old, fresh])).toBe(fresh)
  })
})
