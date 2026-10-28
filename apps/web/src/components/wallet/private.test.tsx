// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrivateDollars } from './private'

/** The wallet as the Private dollars screen sees it: private dollars waiting, or none. */
const state = vi.hoisted(() => ({
  privateBalance: 4_970_000n,
  moveIn: vi.fn(),
}))
vi.mock('./provider', () => ({
  isUnnamed: () => false,
  short: (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`,
  useWallet: () => ({
    activity: [],
    privateBalance: state.privateBalance,
    privateOpen: true,
    privateUnchecked: false,
    moveIn: state.moveIn,
    movingIn: null,
    hideBalance: false,
  }),
}))
vi.mock('./activity', () => ({ ScreenHead: () => null }))
vi.mock('./ui', () => ({ EntryRow: () => null }))
vi.mock('@/components/brand', () => ({ Icon: () => null, Art: () => null }))

beforeEach(() => {
  state.privateBalance = 4_970_000n
  state.moveIn.mockReset()
  // As the wallet does: once moved, nothing is private any more.
  state.moveIn.mockImplementation(async () => {
    state.privateBalance = 0n
    return { count: 1, amount: 4_970_000n, ms: 1200, failed: 0 }
  })
})
afterEach(cleanup)

describe('Private dollars', () => {
  it('shows the way out of private under the amount, with its one catch said before anything moves', async () => {
    render(<PrivateDollars />)
    fireEvent.click(screen.getByRole('button', { name: /Move to main wallet/ }))
    // Nothing moves until it's confirmed, and the confirmation says what moving gives away.
    expect(state.moveIn).not.toHaveBeenCalled()
    const confirm = screen.getByRole('alertdialog', { name: 'Move to main wallet' })
    expect(confirm.textContent).toContain('Move $4.97 to your main wallet?')
    expect(confirm.textContent).toContain('anyone can see these dollars reached you')
    fireEvent.click(screen.getByRole('button', { name: /Move \$4\.97/ }))
    expect(state.moveIn).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/Moved to main wallet/)).toBeTruthy()
  })

  it('offers no move when nothing is private, and can keep them private', () => {
    state.privateBalance = 0n
    render(<PrivateDollars />)
    expect(screen.queryByRole('button', { name: /Move to main wallet/ })).toBeNull()
    cleanup()
    state.privateBalance = 4_970_000n
    render(<PrivateDollars />)
    fireEvent.click(screen.getByRole('button', { name: /Move to main wallet/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep them private' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(state.moveIn).not.toHaveBeenCalled()
  })
})
