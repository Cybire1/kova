// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BalanceCard } from './ui'

const state = vi.hoisted(() => ({
  balance: 5_000_000n,
  profile: { currency: 'USD' },
  rates: {},
  hideBalance: false,
  setHideBalance: vi.fn(),
  privateBalance: 0n,
  privateUnchecked: true,
}))
vi.mock('./provider', () => ({ useWallet: () => state }))
vi.mock('@/components/brand', () => ({ Icon: () => null, Art: () => null }))

beforeEach(() => {
  state.privateBalance = 0n
  state.hideBalance = false
  state.privateUnchecked = true
})
afterEach(cleanup)

describe('wallet balance privacy', () => {
  it('does not suggest private money exists when this browser cannot scan it', () => {
    render(<BalanceCard />)
    expect(screen.queryByText(/unlock private dollars/i)).toBeNull()
    expect(screen.queryByRole('note')).toBeNull()
    expect(screen.getByRole('region', { name: 'Available $5.00' })).toBeTruthy()
  })

  it('shows the private balance only after money has actually been found for the wallet', () => {
    state.privateBalance = 2_500_000n
    render(<BalanceCard />)
    expect(screen.getByRole('note').textContent).toContain('+$2.50 private')
  })

  it('keeps the private amount hidden when the user hides their balance', () => {
    state.privateBalance = 2_500_000n
    state.hideBalance = true
    render(<BalanceCard />)
    expect(screen.getByRole('note').textContent).toContain('+•••• private')
    expect(screen.queryByText(/2\.50/)).toBeNull()
  })
})
