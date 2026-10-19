// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entry } from './provider'
import { ArrivalNotice } from './arrival'

const state = vi.hoisted(() => ({
  wallet: '0x1111111111111111111111111111111111111111',
  activity: [] as Entry[],
  publicReady: false,
  privateReady: false,
  hidden: false,
}))
vi.mock('./provider', () => ({
  useWallet: () => ({
    profile: { address: state.wallet },
    activity: state.activity,
    activityReady: state.publicReady,
    privateScanReady: state.privateReady,
    hideBalance: state.hidden,
  }),
}))
vi.mock('@/components/brand', () => ({ Icon: () => null, Art: () => null }))
const incoming = (id: string, extra: Partial<Entry> = {}): Entry => ({
  id,
  kind: 'received',
  amount: '2500000',
  name: 'Ada',
  detail: 'Arrived',
  txHash: `0x${id}`,
  at: Date.now(),
  ...extra,
})

beforeEach(() => {
  state.wallet = '0x1111111111111111111111111111111111111111'
  state.activity = []
  state.publicReady = false
  state.privateReady = false
  state.hidden = false
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
})
afterEach(cleanup)

describe('web payment arrival', () => {
  it('skips initial history, opens automatically for new money and never replays it on balance refresh', () => {
    const view = render(<ArrivalNotice />)
    state.publicReady = true
    state.activity = [incoming('old')]
    view.rerender(<ArrivalNotice />)
    expect(screen.queryByRole('dialog')).toBeNull()
    state.activity = [incoming('new'), ...state.activity]
    view.rerender(<ArrivalNotice />)
    expect(screen.getByRole('dialog').textContent).toContain('Ada paid you')
    expect(screen.getByText('+$2.50')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    state.activity = [...state.activity]
    view.rerender(<ArrivalNotice />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('baselines private history separately, then announces new private funds without moving them into the main balance', () => {
    state.publicReady = true
    const view = render(<ArrivalNotice />)
    state.privateReady = true
    state.activity = [incoming('old-private', { oneTime: '0x123', waiting: true })]
    view.rerender(<ArrivalNotice />)
    expect(screen.queryByRole('dialog')).toBeNull()
    state.activity = [
      incoming('fresh-private', { oneTime: '0x456', waiting: true, unconfirmed: true }),
      ...state.activity,
    ]
    view.rerender(<ArrivalNotice />)
    expect(screen.getByRole('dialog').textContent).toContain('Ada paid you privately')
    expect(screen.getByText(/Sender unconfirmed/)).toBeTruthy()
    expect(screen.getByText(/stay separate from your main balance/)).toBeTruthy()
  })
  it('ignores sends, own link returns, self-transfers and already-spent private funds', () => {
    state.publicReady = true
    state.privateReady = true
    const view = render(<ArrivalNotice />)
    state.activity = [
      incoming('sent', { kind: 'sent' }),
      incoming('link', { link: true }),
      incoming('self', { address: state.wallet }),
      incoming('spent', { oneTime: '0x123', waiting: false }),
    ]
    view.rerender(<ArrivalNotice />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('queues concurrent arrivals, supports closing and hides amounts when the wallet balance is hidden', () => {
    state.publicReady = true
    state.hidden = true
    const view = render(<ArrivalNotice />)
    state.activity = [incoming('second', { name: 'Sam', at: 2 }), incoming('first', { at: 1 })]
    view.rerender(<ArrivalNotice />)
    expect(screen.getByText('Ada paid you')).toBeTruthy()
    expect(screen.queryByText('+$2.50')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close payment received' }))
    expect(screen.getByText('Sam paid you')).toBeTruthy()
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('never shows a previous wallet’s queued arrival after switching accounts', () => {
    state.publicReady = true
    const view = render(<ArrivalNotice />)
    state.activity = [incoming('new')]
    view.rerender(<ArrivalNotice />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    state.wallet = '0x2222222222222222222222222222222222222222'
    view.rerender(<ArrivalNotice />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
