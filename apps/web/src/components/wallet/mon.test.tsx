// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type ChainDepositQuote,
  monCardDismissalKey,
  monConversionKey,
  prepareMonConversion,
  sendMonConversion,
} from '@kova/monad'
import { ConvertMon, MonConversionEntry, MonWalletCard } from './mon'

const state = vi.hoisted(() => ({
  address: '0x7171732ec724CF39b8e2ee08C762d04AFab36696' as const,
  monBalance: 1000n * 10n ** 18n,
  hidden: false,
  signer: vi.fn(),
  refresh: vi.fn(),
  notSent: false,
}))
vi.mock('./provider', () => ({
  useWallet: () => ({
    profile: { address: state.address },
    monBalance: state.monBalance,
    hideBalance: state.hidden,
    network: 'mainnet',
    signingAccount: state.signer,
    refresh: state.refresh,
  }),
}))
vi.mock('./activity', () => ({ ScreenHead: () => null }))
vi.mock('@/components/brand', () => ({ Icon: () => null }))
vi.mock('@kova/monad', async (original) => ({
  ...(await original<typeof import('@kova/monad')>()),
  prepareMonConversion: vi.fn(),
  sendMonConversion: vi.fn(),
  conversionWasNotSent: () => state.notSent,
  monClient: {
    getTransactionReceipt: vi.fn(async () => null),
    getBalance: vi.fn(async () => state.monBalance),
  },
}))

const quote: ChainDepositQuote = {
  provider: 'relay',
  request_id: `0x${'12'.repeat(32)}`,
  address: '0x2222222222222222222222222222222222222222',
  amount: '100',
  expected_ausd: '2.01',
  minimum_ausd: '2',
  route_fee_usd: '0.01',
  quoted_at: new Date().toISOString(),
  chain: { id: 143, name: 'Monad', vm: 'evm', tokens: [] },
  token: { address: '0x0000000000000000000000000000000000000000', symbol: 'MON', decimals: 18 },
  refund_to: state.address,
  pricing: 'estimate',
  time_estimate_seconds: 5,
}
const hash = `0x${'ab'.repeat(32)}`

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  state.monBalance = 1000n * 10n ** 18n
  state.hidden = false
  state.notSent = false
  state.signer.mockResolvedValue({ address: state.address })
  vi.mocked(prepareMonConversion).mockResolvedValue({
    wallet: state.address,
    quote,
    value: 100n * 10n ** 18n,
    networkFee: 10n ** 15n,
    gas: 21000n,
    gasPrice: 100000000000n,
    preparedAt: Date.now(),
  })
  vi.mocked(sendMonConversion).mockResolvedValue(hash as `0x${string}`)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(url.endsWith('chain-deposit-quote') ? quote : { data: [] }),
    ),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function preview() {
  await screen.findByLabelText('MON to convert')
  fireEvent.change(screen.getByLabelText('MON to convert'), { target: { value: '100' } })
  fireEvent.click(screen.getByRole('button', { name: 'Preview conversion' }))
  await screen.findByRole('region', { name: 'Conversion preview' })
}

describe('direct MON deposits in Kova', () => {
  it('hides gas dust and anything below 1 MON, including a saved conversion, but shows exactly 1 MON', async () => {
    state.monBalance = 15_259_000_000_000_000n
    localStorage.setItem(
      monConversionKey(state.address),
      JSON.stringify({
        wallet: state.address,
        requestId: quote.request_id,
        depositAddress: quote.address,
        amount: '100',
        startedAt: Date.now(),
        hash,
      }),
    )
    const view = render(<MonWalletCard />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.queryByRole('link')).toBeNull()
    state.monBalance = 10n ** 18n - 1n
    view.rerender(<MonWalletCard />)
    expect(screen.queryByRole('link')).toBeNull()
    localStorage.removeItem(monConversionKey(state.address))
    view.unmount()
    state.monBalance = 10n ** 18n
    render(<MonWalletCard />)
    expect(await screen.findByText('1 MON in your wallet')).toBeTruthy()
  })
  it('remembers a dismissal after remounting and lets new deposits bring the card back', async () => {
    const view = render(<MonWalletCard />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss MON balance' }))
    expect(screen.queryByText('1000 MON in your wallet')).toBeNull()
    expect(localStorage.getItem(monCardDismissalKey(state.address))).toBe(
      state.monBalance.toString(),
    )
    view.unmount()
    const next = render(
      <>
        <MonWalletCard />
        <MonConversionEntry />
      </>,
    )
    expect(screen.queryByRole('button', { name: 'Dismiss MON balance' })).toBeNull()
    expect(screen.getByRole('link', { name: /Convert MON in your wallet/ })).toBeTruthy()
    state.monBalance += 10n ** 18n
    next.rerender(
      <>
        <MonWalletCard />
        <MonConversionEntry />
      </>,
    )
    expect(await screen.findByText('1001 MON in your wallet')).toBeTruthy()
  })
  it('automatically removes the card and clears its saved pending state after confirmed settlement', async () => {
    localStorage.setItem(
      monConversionKey(state.address),
      JSON.stringify({
        wallet: state.address,
        requestId: quote.request_id,
        depositAddress: quote.address,
        amount: '100',
        startedAt: Date.now(),
        hash,
      }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: [{ id: 'settled', status: 'success', deposit_tx: hash, received_ausd: '2.01' }],
        }),
      ),
    )
    render(<MonWalletCard />)
    await waitFor(() => expect(localStorage.getItem(monConversionKey(state.address))).toBeNull())
    expect(localStorage.getItem(monCardDismissalKey(state.address))).toBe(
      state.monBalance.toString(),
    )
    expect(screen.queryByRole('link')).toBeNull()
    expect(sendMonConversion).not.toHaveBeenCalled()
  })
  it('shows received MON prominently and respects the existing hide-balance setting', () => {
    const view = render(<MonWalletCard />)
    expect(screen.getByText('1000 MON in your wallet')).toBeTruthy()
    state.hidden = true
    view.rerender(<MonWalletCard />)
    expect(screen.queryByText('1000 MON in your wallet')).toBeNull()
    expect(screen.getByText('•••• MON in your wallet')).toBeTruthy()
  })
  it('shows amounts and fees in a preview without unlocking or moving money', async () => {
    render(<ConvertMon />)
    await preview()
    expect(screen.getByText('$2.01')).toBeTruthy()
    expect(screen.getByText('Network fee, up to')).toBeTruthy()
    expect(state.signer).not.toHaveBeenCalled()
    expect(sendMonConversion).not.toHaveBeenCalled()
    expect(localStorage.getItem(monConversionKey(state.address))).toBeNull()
  })
  it('requires explicit confirmation, prevents duplicate clicks and saves the transaction for recovery', async () => {
    render(<ConvertMon />)
    await preview()
    const confirm = screen.getByRole('button', { name: 'Confirm conversion' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    await screen.findByText('Converting MON to dollars')
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(monConversionKey(state.address))!).hash).toBe(hash),
    )
    expect(sendMonConversion).toHaveBeenCalledTimes(1)
    expect(state.signer).toHaveBeenCalledWith(2_010_000n)
    expect(screen.queryByRole('button', { name: 'Confirm conversion' })).toBeNull()
  })
  it('keeps conversion progress visible after a reload even when the MON has left', async () => {
    state.monBalance = 0n
    localStorage.setItem(
      monConversionKey(state.address),
      JSON.stringify({
        wallet: state.address,
        requestId: quote.request_id,
        depositAddress: quote.address,
        amount: '100',
        startedAt: Date.now(),
        hash,
      }),
    )
    render(<ConvertMon />)
    await screen.findByText('Converting MON to dollars')
    expect(screen.getByRole('link', { name: 'View MON transfer' }).getAttribute('href')).toContain(
      hash,
    )
    expect(screen.queryByLabelText('MON to convert')).toBeNull()
  })
  it('preserves an uncertain broadcast instead of offering another send', async () => {
    vi.mocked(sendMonConversion).mockRejectedValue(new Error('Connection interrupted'))
    render(<ConvertMon />)
    await preview()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm conversion' }))
    await screen.findByText('Connection interrupted')
    expect(localStorage.getItem(monConversionKey(state.address))).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Confirm conversion' })).toBeNull()
  })
  it('lets users preview again after a definite pre-broadcast failure', async () => {
    state.notSent = true
    vi.mocked(sendMonConversion).mockRejectedValue(
      new Error('The network fee changed. Preview the conversion again.'),
    )
    render(<ConvertMon />)
    await preview()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm conversion' }))
    await screen.findByText('The network fee changed. Preview the conversion again.')
    expect(localStorage.getItem(monConversionKey(state.address))).toBeNull()
    expect(screen.getByRole('button', { name: 'Preview conversion' })).toBeTruthy()
  })
})
