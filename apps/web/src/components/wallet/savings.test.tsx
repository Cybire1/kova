// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Savings } from '@/lib/wallet/partners'
import { SavingsScreen } from './money'

/** Savings in a partner's vault (setsAUSD), as the API describes it to a wallet. */
const state = vi.hoisted(() => ({ savings: null as unknown }))
vi.mock('@/lib/wallet/partners', () => ({
  getSavings: async () => state.savings,
  saveIn: vi.fn(),
  saveOut: vi.fn(),
}))
vi.mock('./provider', () => ({
  useWallet: () => ({
    profile: { address: '0x7171732ec724CF39b8e2ee08C762d04AFab36696' },
    network: 'mainnet',
    signingAccount: vi.fn(),
    refresh: vi.fn(),
    balance: 50_000_000n,
  }),
}))
vi.mock('./activity', () => ({ ScreenHead: () => null }))
vi.mock('./ui', () => ({ CopyButton: () => null }))
vi.mock('@/components/brand', () => ({ Icon: () => null, Art: () => null }))

const savings = (more: Partial<Savings> = {}): Savings => ({
  live: true,
  test: false,
  requested: false,
  vault: {
    address: '0x551903E3687820A733FBe406DD33Fee8D12bd2F3',
    name: 'Setsuna AUSD Savings',
    version: '1',
    chain_id: 143,
    shares: '10000000000000',
    nonce: '0',
  },
  saver: '0x00000000000000000000000000000000005A7E12',
  balance: '10021310',
  deposited: '10000000',
  earned: '21310',
  room: '1978855860',
  withdrawable: '10021310',
  rate: { yearly: 0.0331, days: 7 },
  can_save: true,
  beta: true,
  moves: [],
  ...more,
})

beforeEach(() => {
  state.savings = savings()
})
afterEach(cleanup)

describe('Savings in a partner’s vault', () => {
  it('says what it paid lately, that it changes, where it sits, and plainly that the vault is new and unaudited', async () => {
    render(<SavingsScreen />)
    expect(await screen.findByText(/About 3\.3% a year lately/)).toBeTruthy()
    expect(screen.getByText(/It changes, and isn’t a promise/)).toBeTruthy()
    expect(screen.getByText('Setsuna AUSD Savings')).toBeTruthy()
    const risk = screen.getByText(/not audited yet/)
    expect(risk.textContent).toContain('Only save what you could do without')
  })

  it('says how much more the vault takes, and stops at a full one', async () => {
    state.savings = savings({ room: '5000000' })
    render(<SavingsScreen />)
    expect(await screen.findByText('Savings can take $5.00 more right now.')).toBeTruthy()
    cleanup()
    state.savings = savings({ room: '0' })
    render(<SavingsScreen />)
    expect(await screen.findByText(/Savings is full right now/)).toBeTruthy()
    const input = screen.getByLabelText(/Save from your balance/) as HTMLInputElement
    expect(input.disabled).toBe(true)
  })

  it('offers only taking out to a wallet savings hasn’t opened to yet', async () => {
    state.savings = savings({ can_save: false, room: '0' })
    render(<SavingsScreen />)
    expect(await screen.findByLabelText(/Withdraw to your balance/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull()
    expect(screen.queryByText(/Savings is full/)).toBeNull()
  })

  it('says what can come out now when the vault holds some back', async () => {
    state.savings = savings({ can_save: false, withdrawable: '4008524' })
    render(<SavingsScreen />)
    expect(await screen.findByText('You can move $4.01 out right now.')).toBeTruthy()
  })
})
