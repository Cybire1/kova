// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StockAccess, TradeQuote } from '@/lib/wallet/stocks-trade'
import { TradeSheet } from './stock-trade'

const WALLET = '0x7171732ec724CF39b8e2ee08C762d04AFab36696'

const api = vi.hoisted(() => ({
  attestStocks: vi.fn(),
  quoteStock: vi.fn(),
  buyStock: vi.fn(),
  sellStock: vi.fn(),
}))
vi.mock('@/lib/wallet/stocks-trade', async (actual) => ({
  ...(await actual<typeof import('@/lib/wallet/stocks-trade')>()),
  ...api,
}))
vi.mock('./provider', () => ({
  useWallet: () => ({
    profile: { address: WALLET },
    balance: 120_500_000n,
    signMessage: vi.fn(async () => '0xsigned'),
    signingAccount: vi.fn(async () => ({ address: WALLET })),
    refresh: vi.fn(async () => {}),
  }),
}))
vi.mock('./send', () => ({
  Fit: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Fact: ({ label, value }: { label: string; value: string }) => (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  ),
}))
vi.mock('./ui', () => ({ Keypad: () => null }))
vi.mock('@/components/brand', () => ({ Icon: () => null, Art: () => null }))

const TSLA = {
  symbol: 'TSLAx',
  name: 'Tesla',
  ticker: 'TSLA',
  exchange: 'NASDAQ',
  logo: '',
  address: '0x8aD3c73F833d3F9A523aB01476625F269aEB7Cf0',
  price: 402.71,
  period: 'market',
  halted: false,
} as const

const ATTESTATION = `Kova stock tokens\nI confirm I am not a US citizen, US resident or US taxpayer, and I don't live in a country where xStocks are restricted.\nI understand xStocks are tokens issued by Backed, not shares, that their price can fall, and that Kova gives no advice.\nWallet: ${WALLET}\nDate: 2026-10-29`

const access = (more: Partial<StockAccess> = {}): StockAccess => ({
  object: 'stock_access',
  live: true,
  country: 'NG',
  allowed: true,
  reason: null,
  attested: true,
  attestation: ATTESTATION,
  ...more,
})

const quote = (): TradeQuote => ({
  object: 'stock_quote',
  id: 'sq_1',
  side: 'buy',
  symbol: 'TSLAx',
  stock: TSLA.address,
  amount_in: '50000000',
  amount_out: '124100000000000000',
  min_out: '122859000000000000',
  price: 402.71,
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  contract: '0x00000000000000000000000000000000000057c5',
  ref: `0x${'ab'.repeat(32)}`,
  buy: { nonce: `0x${'cd'.repeat(32)}`, valid_before: '1900000000' },
})

const open = (a: StockAccess, onAccess = vi.fn()) =>
  render(
    <TradeSheet
      stock={TSLA}
      side="buy"
      held={undefined}
      access={a}
      onAccess={onAccess}
      onClose={() => {}}
    />,
  )

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })

beforeEach(() => {
  api.attestStocks.mockResolvedValue({ attested: true })
  api.quoteStock.mockResolvedValue(quote())
})
afterEach(cleanup)

describe('Buying a stock', () => {
  it('in a blocked country says why, plainly, and offers no way to buy', () => {
    open(
      access({
        allowed: false,
        country: 'US',
        reason: 'Stock tokens aren’t available in the United States.',
      }),
    )
    expect(screen.getByText('Not available in your country')).toBeTruthy()
    expect(screen.getByText('Stock tokens aren’t available in the United States.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Buy/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /See the price/ })).toBeNull()
    expect(api.quoteStock).not.toHaveBeenCalled()
  })

  it('asks for the one-time confirmation, signed, before any price', async () => {
    const onAccess = vi.fn()
    open(access({ attested: false }), onAccess)
    expect(screen.getByText(/I confirm I am not a US citizen/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /See the price/ })).toBeNull()
    const sign = screen.getByRole('button', { name: /Sign with passkey/ }) as HTMLButtonElement
    expect(sign.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(sign.disabled).toBe(false)
    fireEvent.click(sign)
    await settle()
    expect(api.attestStocks).toHaveBeenCalledWith(WALLET, ATTESTATION, expect.any(Function))
    expect(onAccess).toHaveBeenCalledWith(expect.objectContaining({ attested: true }))
    expect(api.quoteStock).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /See the price/ })).toBeTruthy()
  })

  it('shows the live quote with the least it gets, the warnings and exactly what Kova is', async () => {
    open(access())
    fireEvent.click(screen.getByRole('button', { name: '$50' }))
    fireEvent.click(screen.getByRole('button', { name: /See the price/ }))
    await settle()
    expect(api.quoteStock).toHaveBeenCalledWith(WALLET, 'buy', 'TSLAx', 50_000_000n)
    expect(screen.getByText('You get about')).toBeTruthy()
    expect(screen.getByText('at least 0.1229 TSLAx')).toBeTruthy()
    expect(screen.getByText(/Price held for \d+ s/)).toBeTruthy()
    expect(screen.getByText('You can lose money.')).toBeTruthy()
    expect(screen.getByText('They aren’t for beginners.')).toBeTruthy()
    expect(
      screen.getByText(
        'Kova doesn’t issue, sell or recommend stocks. This swaps your dollars for a token on Monad, issued by Backed.',
      ),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Buy \$50\.00 of Tesla/ })).toBeTruthy()
  })
})
