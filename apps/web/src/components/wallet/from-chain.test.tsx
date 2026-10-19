// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FromChain } from './from-chain'

const state = vi.hoisted(() => ({
  address: '0x7171732ec724CF39b8e2ee08C762d04AFab36696',
  refresh: vi.fn(),
}))
vi.mock('./provider', () => ({
  useWallet: () => ({ profile: { address: state.address }, refresh: state.refresh }),
}))
vi.mock('@/components/brand', () => ({ Art: () => null, Icon: () => null }))
vi.mock('./activity', () => ({ ScreenHead: () => null }))
vi.mock('./ui', () => ({
  QR: ({ value }: { value: string }) => <div data-testid="qr">{value}</div>,
}))
const mon = '0x0000000000000000000000000000000000000000'
const usdc = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const sources = {
  live: true,
  network: 'mainnet',
  arrives_as: 'AUSD',
  chains: [
    { id: 143, name: 'Monad', vm: 'evm', tokens: [{ address: mon, symbol: 'MON', decimals: 18 }] },
    { id: 8453, name: 'Base', vm: 'evm', tokens: [{ address: usdc, symbol: 'USDC', decimals: 6 }] },
    {
      id: 792703809,
      name: 'Solana',
      vm: 'svm',
      tokens: [{ address: 'sol', symbol: 'SOL', decimals: 9 }],
    },
  ],
}
const quote = {
  provider: 'relay',
  address: '0xd018209a01970c400a3ef32340a0617285c5ed00',
  expected_ausd: '20.621657',
  minimum_ausd: '20.518548',
  amount: '1000',
  token: sources.chains[0]?.tokens[0],
  chain: sources.chains[0],
  refund_to: state.address,
  route_fee_usd: '0.03',
  pricing: 'estimate',
}
function setup(quoteResult: () => Promise<Response> = async () => Response.json(quote)) {
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith('chain-deposit-sources')) return Response.json(sources)
    if (url.endsWith('chain-deposit-quote')) return quoteResult()
    return Response.json({ data: [] })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}
async function enter() {
  await screen.findByRole('combobox', { name: 'From network' })
  fireEvent.change(screen.getByLabelText('Amount to send'), { target: { value: '1000' } })
  fireEvent.click(screen.getByRole('button', { name: 'Preview deposit' }))
}
beforeEach(() => {
  state.address = '0x7171732ec724CF39b8e2ee08C762d04AFab36696'
  state.refresh.mockClear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('crypto deposit flow', () => {
  it('defaults to MON, uses the Kova refund wallet without an extra input, and shows exact route instructions', async () => {
    const fetch = setup()
    render(<FromChain />)
    await enter()
    await screen.findByRole('region', { name: 'Deposit instructions' })
    expect(screen.getByTestId('qr').textContent).toBe(quote.address)
    expect(screen.getByText('Send only MON on Monad')).toBeTruthy()
    expect(screen.getByText('$20.62')).toBeTruthy()
    const call = fetch.mock.calls.find(([url]) => url.endsWith('chain-deposit-quote'))
    expect(JSON.parse(call?.[1]?.body as string)).toEqual({
      chain_id: 143,
      token: mon,
      amount: '1000',
      refund_to: state.address,
    })
  })
  it('clears QR instructions immediately when token network or amount changes', async () => {
    setup()
    render(<FromChain />)
    await enter()
    await screen.findByTestId('qr')
    fireEvent.change(screen.getByLabelText('Amount to send'), { target: { value: '2000' } })
    expect(screen.queryByTestId('qr')).toBeNull()
  })
  it('discards a delayed quote after the network changes', async () => {
    let complete!: (response: Response) => void
    setup(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    render(<FromChain />)
    await enter()
    fireEvent.change(screen.getByRole('combobox', { name: 'From network' }), {
      target: { value: '8453' },
    })
    complete(Response.json(quote))
    await waitFor(() => expect(screen.getByRole('button', { name: 'USDC' })).toBeTruthy())
    expect(screen.queryByTestId('qr')).toBeNull()
  })
  it('clears deposit state on wallet changes, including requests still in flight', async () => {
    let complete!: (response: Response) => void
    setup(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    const rendered = render(<FromChain />)
    await enter()
    state.address = '0x1111111111111111111111111111111111111111'
    rendered.rerender(<FromChain />)
    complete(Response.json(quote))
    await screen.findByRole('combobox', { name: 'From network' })
    expect(screen.queryByTestId('qr')).toBeNull()
    expect((screen.getByLabelText('Amount to send') as HTMLInputElement).value).toBe('')
  })
  it('requires a source-chain refund wallet for non-EVM deposits', async () => {
    setup()
    render(<FromChain />)
    await screen.findByRole('combobox', { name: 'From network' })
    fireEvent.change(screen.getByRole('combobox', { name: 'From network' }), {
      target: { value: '792703809' },
    })
    fireEvent.change(screen.getByLabelText('Amount to send'), { target: { value: '1' } })
    expect(
      (screen.getByRole('button', { name: 'Preview deposit' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    fireEvent.change(screen.getByLabelText('Refund address'), {
      target: { value: 'my-solana-wallet' },
    })
    expect(
      (screen.getByRole('button', { name: 'Preview deposit' }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })
  it('shows provider errors without presenting a deposit address', async () => {
    setup(async () => Response.json({ error: 'That deposit is too small.' }, { status: 400 }))
    render(<FromChain />)
    await enter()
    expect((await screen.findByRole('alert')).textContent).toContain('too small')
    expect(screen.queryByTestId('qr')).toBeNull()
  })
  it('fails closed when deposits are paused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ live: false, chains: [], reason: 'Deposits are temporarily paused.' }),
      ),
    )
    render(<FromChain />)
    await screen.findByText('Deposits are temporarily paused.')
    expect(screen.queryByRole('button', { name: 'Preview deposit' })).toBeNull()
    expect(screen.queryByTestId('qr')).toBeNull()
  })
})
