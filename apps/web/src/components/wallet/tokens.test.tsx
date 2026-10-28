// @vitest-environment jsdom

import {
  type ChainDepositQuote,
  type ChainDepositSources,
  prepareTokenConversion,
  readWalletTokens,
  sendTokenConversion,
  type TokenHoldings,
  tokenConversionKey,
  WALLET_TOKENS,
  type WalletToken,
  walletTokensKey,
} from '@kova/monad'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshTokens, relayTransfer } from '@/lib/wallet/tokens'
import { OtherTokens, OtherTokensCard, TokenWatch } from './tokens'

const state = vi.hoisted(() => ({
  address: '0x7171732ec724CF39b8e2ee08C762d04AFab36696' as const,
  /** What each look at Monad finds, in turn; the last one repeats. */
  reads: [] as Record<string, string>[],
  search: '',
  signer: vi.fn(),
  refresh: vi.fn(),
}))
vi.mock('./provider', () => ({
  useWallet: () => ({
    profile: { address: state.address },
    network: 'mainnet',
    monUsd: 0.03,
    hideBalance: false,
    signingAccount: state.signer,
    refresh: state.refresh,
  }),
}))
vi.mock('./activity', () => ({ ScreenHead: ({ title }: { title: string }) => <h1>{title}</h1> }))
vi.mock('@/components/brand', () => ({ Icon: () => null, Art: () => null }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(state.search),
}))
vi.mock('@kova/monad', async (original) => ({
  ...(await original<typeof import('@kova/monad')>()),
  readWalletTokens: vi.fn(),
  prepareTokenConversion: vi.fn(),
  sendTokenConversion: vi.fn(),
}))

const listed = (symbol: string) =>
  WALLET_TOKENS.mainnet.find((t) => t.symbol === symbol) as WalletToken
const usdc = listed('USDC')
const usdt0 = listed('USDT0')
const weth = listed('WETH')
const key = (token: WalletToken) => token.address.toLowerCase()
const hash = `0x${'ab'.repeat(32)}` as const

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
        { address: key(usdc), symbol: 'USDC', decimals: 6 },
        { address: key(usdt0), symbol: 'USDT0', decimals: 6 },
      ],
    },
  ],
}
const quote: ChainDepositQuote = {
  provider: 'relay',
  request_id: `0x${'12'.repeat(32)}`,
  address: '0x2222222222222222222222222222222222222222',
  chain: { id: 143, name: 'Monad', vm: 'evm', tokens: [] },
  token: { address: key(usdt0), symbol: 'USDT0', decimals: 6 },
  amount: '5',
  expected_ausd: '4.99',
  minimum_ausd: '4.97',
  route_fee_usd: '0.01',
  time_estimate_seconds: 5,
  refund_to: state.address,
  quoted_at: new Date().toISOString(),
  pricing: 'estimate',
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  state.reads = [{}]
  state.search = ''
  state.signer.mockResolvedValue({ address: state.address })
  vi.mocked(readWalletTokens).mockImplementation(
    async () => (state.reads.length > 1 ? state.reads.shift() : state.reads[0]) as TokenHoldings,
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(
        url.endsWith('chain-deposit-sources')
          ? sources
          : url.endsWith('chain-deposit-quote')
            ? quote
            : { data: [] },
      ),
    ),
  )
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('A token arriving', () => {
  it('is announced once, with a way to turn it into dollars or keep it', async () => {
    state.reads = [
      { [key(usdt0)]: '0', [key(usdc)]: '0' },
      { [key(usdt0)]: '5000000', [key(usdc)]: '7000000' },
    ]
    render(<TokenWatch />)
    await waitFor(() => expect(readWalletTokens).toHaveBeenCalledTimes(1))
    // The first look only learns what's there.
    expect(screen.queryByRole('dialog')).toBeNull()
    await act(() => refreshTokens())
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('5.00 USDT0 arrived')
    expect(dialog.textContent).toContain('≈ $5.00')
    const convert = await screen.findByRole('link', { name: /Turn into dollars/ })
    expect(convert.getAttribute('href')).toBe('/wallet/tokens?convert=USDT0')
    fireEvent.click(screen.getByRole('button', { name: 'Keep USDT0' }))
    // USDC had the dollar arrival already, so it gets no second one.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(
      JSON.parse(localStorage.getItem(walletTokensKey(state.address, 'mainnet')) ?? '{}'),
    ).toEqual({ [key(usdt0)]: '5000000', [key(usdc)]: '7000000' })

    // Opened again later, the same balance is nothing new.
    cleanup()
    render(<TokenWatch />)
    await waitFor(() => expect(readWalletTokens).toHaveBeenCalledTimes(3))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('just says it arrived when Kova can’t turn it into dollars', async () => {
    state.reads = [{ [key(weth)]: '0' }, { [key(weth)]: (10n ** 16n).toString() }]
    render(<TokenWatch />)
    await waitFor(() => expect(readWalletTokens).toHaveBeenCalledTimes(1))
    await act(() => refreshTokens())
    expect((await screen.findByRole('dialog')).textContent).toContain('0.01 WETH arrived')
    expect(screen.queryByRole('link', { name: /Turn into dollars/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'See other tokens' }).getAttribute('href')).toBe(
      '/wallet/tokens',
    )
  })
})

describe('Other tokens on Home', () => {
  it('lists what the wallet holds, and offers dollars only for what Kova converts', async () => {
    state.reads = [{ [key(usdt0)]: '5000000', [key(weth)]: '4200000000000000', [key(usdc)]: '0' }]
    render(
      <>
        <TokenWatch />
        <OtherTokensCard />
      </>,
    )
    const usdtRow = await screen.findByRole('link', { name: /5\.00 USDT0/ })
    await waitFor(() => expect(usdtRow.getAttribute('href')).toBe('/wallet/tokens?convert=USDT0'))
    expect(usdtRow.textContent).toContain('≈ $5.00')
    expect(usdtRow.textContent).toContain('Turn into dollars')
    const wethRow = screen.getByRole('link', { name: /0\.0042 WETH/ })
    expect(wethRow.getAttribute('href')).toBe('/wallet/tokens')
    expect(wethRow.textContent).not.toContain('Turn into dollars')
    expect(screen.queryByText(/USDC/)).toBeNull()
  })

  it('keeps dust off Home, and lists it on the Other tokens screen as too little to convert', async () => {
    state.reads = [{ [key(usdc)]: '944' }]
    render(
      <>
        <TokenWatch />
        <OtherTokensCard />
        <OtherTokens />
      </>,
    )
    const row = await screen.findByText('0.000944 USDC')
    expect(screen.queryByRole('region', { name: 'Other tokens' })).toBeNull()
    expect(row.closest('li')?.textContent).toContain('under $0.01')
    await waitFor(() => expect(screen.getByText('Too little to convert')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Turn into dollars' })).toBeNull()
  })

  it('shows nothing when there is nothing else', async () => {
    state.reads = [{ [key(usdt0)]: '0' }]
    render(
      <>
        <TokenWatch />
        <OtherTokensCard />
      </>,
    )
    await waitFor(() => expect(readWalletTokens).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Other tokens')).toBeNull()
  })
})

describe('Turning a token into dollars', () => {
  it('goes straight to the token from an arrival, prices it, and follows it once sent', async () => {
    state.search = 'convert=USDT0'
    state.reads = [{ [key(usdt0)]: '5000000' }]
    vi.mocked(prepareTokenConversion).mockResolvedValue({
      wallet: state.address,
      token: usdt0,
      quote,
      amount: 5_000_000n,
      gasless: false,
      gas: 60_000n,
      gasPrice: 200_000_000_000n,
      networkFee: 12_000_000_000_000_000n,
      preparedAt: Date.now(),
    })
    vi.mocked(sendTokenConversion).mockResolvedValue(hash)
    render(
      <>
        <TokenWatch />
        <OtherTokens />
      </>,
    )
    await screen.findByRole('heading', { name: 'Turn into dollars' })
    const amount = screen.getByLabelText('USDT0 to turn into dollars') as HTMLInputElement
    expect(amount.value).toBe('5')
    fireEvent.click(screen.getByRole('button', { name: 'See what you get' }))
    const preview = await screen.findByRole('region', { name: 'Conversion preview' })
    expect(preview.textContent).toContain('$4.99')
    expect(preview.textContent).toContain('Up to 0.012 MON')
    const asked = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith('quote'))
    expect(JSON.parse(String(asked?.[1]?.body))).toEqual({
      chain_id: 143,
      token: usdt0.address,
      amount: '5',
      refund_to: state.address,
    })
    expect(sendTokenConversion).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Turn USDT0 into dollars' }))
    expect(await screen.findByText('Turning USDT0 into dollars')).toBeTruthy()
    // Approved like a payment of what it becomes; Kova's relayer is handed only what's signed.
    expect(state.signer).toHaveBeenCalledWith(4_990_000n)
    expect(vi.mocked(sendTokenConversion).mock.calls[0]?.[2]).toBe(relayTransfer)
    expect(
      JSON.parse(localStorage.getItem(tokenConversionKey(state.address)) ?? '{}'),
    ).toMatchObject({ hash, symbol: 'USDT0', requestId: quote.request_id })
  })

  it('says why when there’s no MON for the fee, and sends nothing', async () => {
    state.search = 'convert=USDT0'
    state.reads = [{ [key(usdt0)]: '5000000' }]
    vi.mocked(prepareTokenConversion).mockRejectedValue(
      new Error(
        'Kova can’t pay the network fee for USDT0, so turning it into dollars needs a little MON in this wallet.',
      ),
    )
    render(
      <>
        <TokenWatch />
        <OtherTokens />
      </>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'See what you get' }))
    expect((await screen.findByRole('alert')).textContent).toContain('needs a little MON')
    expect(state.signer).not.toHaveBeenCalled()
    expect(sendTokenConversion).not.toHaveBeenCalled()
  })
})
