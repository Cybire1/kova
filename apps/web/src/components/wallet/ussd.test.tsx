// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { UssdScreen } from './ussd'

const state = vi.hoisted(() => ({
  address: '0x7171732ec724CF39b8e2ee08C762d04AFab36696',
  send: vi.fn(),
  sign: vi.fn(),
  refresh: vi.fn(),
}))
vi.mock('./provider', () => ({
  useWallet: () => ({
    profile: { address: state.address },
    network: 'testnet',
    signMessage: state.sign,
    send: state.send,
    balance: 5_000_000n,
    refresh: state.refresh,
  }),
}))
vi.mock('./activity', () => ({ ScreenHead: () => null }))
vi.mock('./ui', () => ({ CopyButton: () => null }))
const wallet = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const active = () => ({
  status: 'active',
  phone: '+234…678',
  address: '0x2222222222222222222222222222222222222222',
  cap: '10.00',
  balance: '0.00',
  spent_today: '0.00',
  left_today: '10.00',
  locked_until: null,
  dial: '*384*53916#',
  spends: [],
})
let status: any, pocket: any, bodies: any[], messages: string[]
beforeEach(() => {
  state.address = wallet.address
  state.send.mockReset().mockResolvedValue({ hash: '0x' + '1'.repeat(64) })
  state.refresh.mockReset().mockResolvedValue(undefined)
  messages = []
  bodies = []
  status = {
    enabled: true,
    recovery: true,
    network: 'testnet',
    mode: 'sandbox',
    dial: '*384*53916#',
  }
  pocket = { status: 'none', dial: '*384*53916#' }
  state.sign.mockReset().mockImplementation(async (message: string) => {
    messages.push(message)
    return wallet.signMessage({ message })
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/info')) return Response.json(status)
      if (!init || init.method === 'GET') return Response.json(pocket)
      const body = JSON.parse(String(init.body))
      bodies.push(body)
      if (init.method === 'PUT') pocket = { ...active(), status: 'pending' }
      if (url.endsWith('/verify')) pocket = active()
      if (url.endsWith('/withdraw')) pocket = { ...active(), balance: '0.00' }
      return Response.json(pocket)
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('USSD setup screen', () => {
  it('keeps the replacement setup form open when a background refresh still sees the old challenge',async()=>{
    pocket={...active(),status:'pending'}
    render(<UssdScreen />)
    await screen.findByLabelText('Verification code')
    fireEvent.click(screen.getByRole('button',{name:'Request a new code or change number'}))
    await screen.findByText('Link your number')
    const fetch=vi.mocked(globalThis.fetch),before=fetch.mock.calls.length
    fireEvent(document,new Event('visibilitychange'))
    await waitFor(()=>expect(fetch.mock.calls.length).toBeGreaterThan(before+1))
    expect(screen.getByLabelText('Choose a USSD PIN')).toBeTruthy()
    expect(screen.queryByLabelText('Verification code')).toBeNull()
  })
  it('links a phone, signs a PIN commitment and presents the simulator code entry', async () => {
    render(<UssdScreen />)
    await screen.findByText('Link your number')
    fireEvent.change(screen.getByLabelText('Phone number with country code'), {
      target: { value: '+2348012345678' },
    })
    fireEvent.change(screen.getByLabelText('Choose a USSD PIN'), { target: { value: '4821' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify my number' }))
    await screen.findByLabelText('Verification code')
    expect(messages[0]).toContain('Kova USSD pocket v2\nChain 10143')
    expect(messages[0]).toContain('PIN commitment 0x')
    expect(messages[0]).not.toContain('\nPIN 4821')
    expect(bodies[0].pin_nonce).toMatch(/^0x[\da-f]{64}$/)
    fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm number' }))
    await screen.findByText('Your USSD pocket')
    expect(screen.getByText('*384*53916#')).toBeTruthy()
  })

  it('requires funding review and submits only one confirmed transfer', async () => {
    pocket = active()
    render(<UssdScreen />)
    await screen.findByText('Your USSD pocket')
    fireEvent.click(screen.getByRole('button', { name: 'Review transfer' }))
    expect(state.send).not.toHaveBeenCalled()
    const confirm = screen.getByRole('button', { name: 'Confirm transfer' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    await waitFor(() => expect(state.send).toHaveBeenCalledOnce())
    expect(state.send).toHaveBeenCalledWith(
      expect.objectContaining({ address: active().address }),
      2_000_000n,
    )
  })

  it('keeps recovery accessible while payments are paused', async () => {
    status.enabled = false
    pocket = { ...active(), balance: '2.00' }
    render(<UssdScreen />)
    await screen.findByText('Your USSD pocket')
    expect(
      (screen.getByRole('button', { name: 'Review transfer' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Return all dollars to my wallet' }))
    await waitFor(() => expect(messages[0]).toContain('Action withdraw'))
  })

  it('does not offer setup when the provider is unavailable', async () => {
    status.enabled = false
    status.recovery = false
    render(<UssdScreen />)
    await screen.findByText('USSD payments are paused')
    expect(screen.queryByLabelText('Choose a USSD PIN')).toBeNull()
  })

  it('refuses a service that reports the wrong network', async () => {
    status.network = 'mainnet'
    render(<UssdScreen />)
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('different network')
    expect(screen.queryByLabelText('Choose a USSD PIN')).toBeNull()
  })
})
