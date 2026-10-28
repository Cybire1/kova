import {
  type Address,
  decodeFunctionData,
  erc20Abi,
  getAddress,
  type Hex,
  parseEther,
  parseTransaction,
  recoverTransactionAddress,
  recoverTypedDataAddress,
  zeroAddress,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type SignedAuthorization, transferAuthorizationTypedData } from '../src/authorization.js'
import type { ChainDepositQuote, ChainDepositSources } from '../src/chain-deposits.js'
import { conversionWasNotSent, monClient } from '../src/mon-conversion.js'
import { providerSigningSession } from '../src/provider-account.js'
import { getToken } from '../src/tokens.js'
import {
  convertibleTokens,
  formatTokenAmount,
  heldTokens,
  keptHoldings,
  prepareTokenConversion,
  readWalletTokens,
  sendTokenConversion,
  tokenArrivals,
  tokenInDollars,
  WALLET_TOKENS,
  type WalletToken,
} from '../src/wallet-tokens.js'

const account = privateKeyToAccount(generatePrivateKey())
const deposit = '0x2222222222222222222222222222222222222222'
const hash = `0x${'ab'.repeat(32)}` as const
const listed = (symbol: string) => WALLET_TOKENS.mainnet.find((t) => t.symbol === symbol)!
const [usdc, usdt0, wmon, weth, wbtc] = ['USDC', 'USDT0', 'WMON', 'WETH', 'WBTC'].map(listed) as [
  WalletToken,
  WalletToken,
  WalletToken,
  WalletToken,
  WalletToken,
]
const key = (token: WalletToken) => token.address.toLowerCase()

function quote(token = usdt0, amount = '5'): ChainDepositQuote {
  return {
    provider: 'relay',
    request_id: `0x${'12'.repeat(32)}`,
    address: deposit,
    chain: { id: 143, name: 'Monad', vm: 'evm', tokens: [] },
    token: { address: token.address.toLowerCase(), symbol: token.symbol, decimals: token.decimals },
    amount,
    expected_ausd: '4.99',
    minimum_ausd: '4.97',
    route_fee_usd: '0.01',
    time_estimate_seconds: 5,
    refund_to: account.address,
    quoted_at: new Date().toISOString(),
    pricing: 'estimate',
  }
}

/** What a token transfer's calldata says: where to and how much. */
const transferOf = (data: Hex | undefined) => {
  const call = decodeFunctionData({ abi: erc20Abi, data: data! })
  expect(call.functionName).toBe('transfer')
  return call.args as readonly [Address, bigint]
}

beforeEach(() => {
  vi.spyOn(monClient, 'readContract').mockResolvedValue(5_000_000n as never)
  vi.spyOn(monClient, 'getBalance').mockResolvedValue(parseEther('1'))
  vi.spyOn(monClient, 'getGasPrice').mockResolvedValue(100_000_000_000n)
  vi.spyOn(monClient, 'estimateGas').mockResolvedValue(50_000n)
  vi.spyOn(monClient, 'getChainId').mockResolvedValue(143)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Other tokens in a Kova wallet', () => {
  it('reads every listed token in one multicall, and leaves out what it could not read', async () => {
    const read = (result: bigint) => ({ status: 'success', result })
    const failed = { status: 'failure', error: new Error('reverted') }
    const multicall = vi
      .spyOn(monClient, 'multicall')
      .mockResolvedValue([
        read(0n),
        read(5_000_000n),
        failed,
        read(parseEther('2')),
        read(0n),
        read(1n),
        failed,
      ] as never)
    const holdings = await readWalletTokens(account.address, 'mainnet')
    expect(multicall).toHaveBeenCalledTimes(1)
    const { contracts } = multicall.mock.calls[0]![0] as unknown as {
      contracts: { address: Address; functionName: string; args: [Address] }[]
    }
    expect(contracts.map((c) => c.address)).toEqual(WALLET_TOKENS.mainnet.map((t) => t.address))
    expect(contracts.every((c) => c.functionName === 'balanceOf')).toBe(true)
    expect(contracts.every((c) => c.args[0] === account.address)).toBe(true)
    expect(holdings).toEqual({
      [key(usdc)]: '0',
      [key(usdt0)]: '5000000',
      [key(wmon)]: parseEther('2').toString(),
      [key(weth)]: '0',
      [key(wbtc)]: '1',
    })
    expect(heldTokens('mainnet', holdings).map((h) => h.token.symbol)).toEqual([
      'USDT0',
      'WMON',
      'WBTC',
    ])
  })

  it('announces what went up, once, and never on a first look or for a token it could not read', () => {
    const after = { [key(usdt0)]: '5000000', [key(wmon)]: '1', [key(weth)]: '9' }
    expect(tokenArrivals('mainnet', null, after)).toEqual([])
    const arrived = tokenArrivals('mainnet', { [key(usdt0)]: '0', [key(wmon)]: '1' }, after)
    expect(arrived).toEqual([{ id: `${key(usdt0)}:5000000`, token: usdt0, amount: 5_000_000n }])
    // Spent or converted: nothing to announce.
    expect(tokenArrivals('mainnet', after, { [key(usdt0)]: '2000000' })).toEqual([])
    // Dust, the way address-poisoning scams arrive: nothing either.
    expect(tokenArrivals('mainnet', after, { [key(usdt0)]: '5009999' })).toEqual([])
    expect(tokenArrivals('mainnet', after, { [key(usdt0)]: '5010000' })).toHaveLength(1)
    // A read that failed keeps the last known balance, so its return isn't an arrival.
    const kept = keptHoldings(after, { [key(wmon)]: '1' })
    expect(kept[key(usdt0)]).toBe('5000000')
    expect(tokenArrivals('mainnet', kept, { [key(usdt0)]: '5000000' })).toEqual([])
  })

  it('shows amounts plainly, never a false zero, and values only what Kova can price', () => {
    expect(formatTokenAmount(usdt0, 5_000_000n)).toBe('5.00')
    expect(formatTokenAmount(usdt0, 1_250_500_000n)).toBe('1,250.50')
    expect(formatTokenAmount(weth, parseEther('0.0042'))).toBe('0.0042')
    expect(formatTokenAmount(weth, 1n)).toBe('<0.000001')
    expect(formatTokenAmount(wbtc, 12_345_678n)).toBe('0.123456')
    expect(tokenInDollars(usdt0, 5_000_000n, null)).toBe(5_000_000n)
    expect(tokenInDollars(wmon, parseEther('2'), 0.03)).toBe(60_000n)
    expect(tokenInDollars(wmon, parseEther('2'), null)).toBeNull()
    expect(tokenInDollars(weth, parseEther('1'), 0.03)).toBeNull()
  })

  it('turns into dollars only the tokens the API lists for Monad, on the network it serves', () => {
    const sources: ChainDepositSources = {
      live: true,
      tracking: true,
      network: 'mainnet',
      reason: null,
      arrives_as: 'AUSD',
      chains: [
        {
          id: 143,
          name: 'Monad',
          vm: 'evm',
          tokens: [
            { address: zeroAddress, symbol: 'MON', decimals: 18 },
            { address: key(usdc), symbol: 'USDC', decimals: 6 },
            { address: key(usdt0), symbol: 'USDT0', decimals: 6 },
          ],
        },
        {
          id: 1,
          name: 'Ethereum',
          vm: 'evm',
          tokens: [{ address: key(weth), symbol: 'WETH', decimals: 18 }],
        },
      ],
    }
    expect(convertibleTokens('mainnet', sources).map((t) => t.symbol)).toEqual(['USDC', 'USDT0'])
    expect(convertibleTokens('mainnet', { ...sources, live: false })).toEqual([])
    expect(convertibleTokens('testnet', sources)).toEqual([])
    expect(convertibleTokens('mainnet', null)).toEqual([])
  })
})

describe('Turning a token into dollars', () => {
  it('pays the fee for USDC: one signed transfer to the deposit address, handed to Kova', async () => {
    const plan = await prepareTokenConversion(account.address, usdc, '5', quote(usdc))
    expect(plan).toMatchObject({ gasless: true, networkFee: 0n, amount: 5_000_000n })
    expect(monClient.estimateGas).not.toHaveBeenCalled()
    const relay = vi.fn(async (_signed: SignedAuthorization) => hash)
    expect(await sendTokenConversion(plan, account, relay)).toBe(hash)
    const signed = relay.mock.calls[0]![0]
    expect(signed).toMatchObject({
      token: usdc.address,
      from: account.address,
      to: getAddress(deposit),
      value: '5000000',
      validAfter: '0',
    })
    const signer = await recoverTypedDataAddress({
      ...transferAuthorizationTypedData(getToken('mainnet', 'USDC'), 143, {
        from: signed.from,
        to: signed.to,
        value: BigInt(signed.value),
        validAfter: BigInt(signed.validAfter),
        validBefore: BigInt(signed.validBefore),
        nonce: signed.nonce,
      }),
      signature: signed.signature,
    })
    expect(signer).toBe(account.address)
  })

  it('prices the MON fee for other tokens, and says plainly when there is no MON to pay it', async () => {
    const plan = await prepareTokenConversion(account.address, usdt0, '5', quote())
    expect(plan).toMatchObject({ gasless: false, gas: 60_000n, gasPrice: 200_000_000_000n })
    expect(plan.networkFee).toBe(60_000n * 200_000_000_000n)
    const estimated = vi.mocked(monClient.estimateGas).mock.calls[0]![0] as {
      to: Address
      data: Hex
    }
    expect(estimated.to).toBe(usdt0.address)
    expect(transferOf(estimated.data)).toEqual([getAddress(deposit), 5_000_000n])
    vi.mocked(monClient.getBalance).mockResolvedValue(0n)
    await expect(prepareTokenConversion(account.address, usdt0, '5', quote())).rejects.toThrow(
      'needs a little MON',
    )
    vi.mocked(monClient.estimateGas).mockRejectedValue(new Error('insufficient funds for gas'))
    await expect(prepareTokenConversion(account.address, usdt0, '5', quote())).rejects.toThrow(
      'needs a little MON',
    )
  })

  it.each<[string, (q: ChainDepositQuote) => void]>([
    [
      'wrong network',
      (q) => {
        q.chain.id = 1
      },
    ],
    [
      'different token',
      (q) => {
        q.token.address = key(usdc)
      },
    ],
    [
      'wrong decimals',
      (q) => {
        q.token.decimals = 18
      },
    ],
    [
      'different amount',
      (q) => {
        q.amount = '6'
      },
    ],
    [
      'refund to someone else',
      (q) => {
        q.refund_to = deposit
      },
    ],
    [
      'deposit to the wallet itself',
      (q) => {
        q.address = account.address
      },
    ],
    [
      'deposit to the token contract',
      (q) => {
        q.address = usdt0.address
      },
    ],
    [
      'expired quote',
      (q) => {
        q.quoted_at = new Date(Date.now() - 121_000).toISOString()
      },
    ],
  ])('refuses a %s before reading or estimating anything', async (_reason, change) => {
    const q = quote()
    change(q)
    await expect(prepareTokenConversion(account.address, usdt0, '5', q)).rejects.toThrow('quote')
    expect(monClient.readContract).not.toHaveBeenCalled()
    expect(monClient.estimateGas).not.toHaveBeenCalled()
  })

  it('refuses more than the wallet holds, and amounts the token cannot carry', async () => {
    vi.mocked(monClient.readContract).mockResolvedValue(1_000_000n as never)
    await expect(prepareTokenConversion(account.address, usdt0, '5', quote())).rejects.toThrow(
      'You have 1.00 USDT0',
    )
    await expect(
      prepareTokenConversion(account.address, usdt0, '5.0000001', quote(usdt0, '5.0000001')),
    ).rejects.toThrow('up to 6 decimal places')
    await expect(
      prepareTokenConversion(account.address, usdt0, '0', quote(usdt0, '0')),
    ).rejects.toThrow('positive')
  })

  it('sends the exact token transfer from a passkey wallet, paying the fee in MON', async () => {
    const plan = await prepareTokenConversion(account.address, usdt0, '5', quote())
    let raw: Hex | undefined
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
    const relay = vi.fn()
    expect(await sendTokenConversion(plan, account, relay)).toBe(hash)
    expect(relay).not.toHaveBeenCalled()
    const transaction = parseTransaction(raw!)
    expect(transaction.chainId).toBe(143)
    expect(transaction.to).toBe(usdt0.address.toLowerCase())
    expect(transaction.value ?? 0n).toBe(0n)
    expect(transaction.gas).toBe(plan.gas)
    expect(transaction.gasPrice).toBe(plan.gasPrice)
    expect(transferOf(transaction.data)).toEqual([getAddress(deposit), 5_000_000n])
    expect(
      await recoverTransactionAddress({
        serializedTransaction: raw as Parameters<
          typeof recoverTransactionAddress
        >[0]['serializedTransaction'],
      }),
    ).toBe(account.address)
  })

  it('sends it through the Google wallet as one token call, and refuses changes before anything is sent', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_accounts') return [account.address]
      if (method === 'eth_chainId') return '0x8f'
      if (method === 'eth_sendTransaction') return hash
      throw new Error(`Unexpected RPC ${method}`)
    })
    const google = providerSigningSession(account.address, { request }, 'mainnet')
    const plan = await prepareTokenConversion(account.address, usdt0, '5', quote())
    expect(await sendTokenConversion(plan, google.account, vi.fn())).toBe(hash)
    const sent = request.mock.calls.find(
      ([args]) => args.method === 'eth_sendTransaction',
    )?.[0] as unknown as {
      params: [
        { from: Address; to: Address; value?: string; data: Hex; gas: string; gasPrice: string },
      ]
    }
    expect(sent.params[0].to.toLowerCase()).toBe(usdt0.address.toLowerCase())
    expect(BigInt(sent.params[0].value ?? '0x0')).toBe(0n)
    expect(BigInt(sent.params[0].gas) * BigInt(sent.params[0].gasPrice)).toBe(plan.networkFee)
    expect(transferOf(sent.params[0].data)).toEqual([getAddress(deposit), 5_000_000n])

    vi.mocked(monClient.readContract).mockResolvedValue(0n as never)
    const error = await sendTokenConversion(plan, google.account, vi.fn()).catch((e) => e)
    expect(error.message).toContain('balance changed')
    expect(conversionWasNotSent(error)).toBe(true)
    vi.mocked(monClient.readContract).mockResolvedValue(5_000_000n as never)
    vi.mocked(monClient.getGasPrice).mockResolvedValue(plan.gasPrice + 1n)
    await expect(sendTokenConversion(plan, google.account, vi.fn())).rejects.toThrow('fee changed')
    vi.mocked(monClient.getGasPrice).mockResolvedValue(100_000_000_000n)
    google.session.end()
    await expect(sendTokenConversion(plan, google.account, vi.fn())).rejects.toThrow('locked')
  })
})
