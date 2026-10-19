// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PhonePaymentScreen, PhoneSend } from './phone'

const state = vi.hoisted(() => ({
  sign: vi.fn(),
  send: vi.fn(),
  fund: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  client: {
    info: vi.fn(),
    get: vi.fn(),
    resolve: vi.fn(),
    reserve: vi.fn(),
    confirm: vi.fn(),
    resend: vi.fn(),
    requestCode: vi.fn(),
    verify: vi.fn(),
    claim: vi.fn(),
    takeBack: vi.fn(),
  },
}))
const sender = '0x1111111111111111111111111111111111111111',
  recipient = '0x2222222222222222222222222222222222222222'
let address = sender
const payment = () => ({
  id: 'lnk_01234567890123456789012345',
  status: 'open',
  network: 'testnet',
  amount: '1.00',
  phone: '+234…678',
  address: '0x3333333333333333333333333333333333333333',
  sender,
  sender_name: 'Sam',
  note: null,
  url: 'https://example.test/wallet/phone/lnk_01234567890123456789012345',
  sms_sent: false,
  tx_hash: null,
})
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: state.replace }),
}))
vi.mock('@/lib/wallet/phone', () => ({ phoneClient: () => state.client }))
vi.mock('./provider', () => ({
  useWallet: () => ({
    profile: { address, name: 'Sam', auth: 'google' },
    network: 'testnet',
    balance: 5_000_000n,
    signMessage: state.sign,
    send: state.send,
    fundLink: state.fund,
    refresh: state.refresh,
  }),
}))
vi.mock('./send', () => ({
  SlideToSend: (p: any) => (
    <button type="button" disabled={p.disabled || p.busy} onClick={p.onSend}>
      {p.label}
    </button>
  ),
}))
vi.mock('./activity', () => ({ ScreenHead: () => null }))
vi.mock('./ui', () => ({ CopyButton: () => null }))
beforeEach(() => {
  address = sender
  localStorage.clear()
  for (const fn of Object.values(state.client)) fn.mockReset()
  state.client.info.mockResolvedValue({ enabled: true, network: 'testnet', mode: 'sandbox' })
  state.client.get.mockResolvedValue(payment())
  state.client.resolve.mockResolvedValue({ address: null })
  state.client.reserve.mockResolvedValue(payment())
  state.client.confirm.mockResolvedValue(payment())
  state.sign.mockReset().mockResolvedValue('0xsignature')
  state.send.mockReset().mockResolvedValue({ hash: '0x123' })
  state.fund.mockReset().mockResolvedValue({ hash: '0x123' })
  state.refresh.mockReset().mockResolvedValue(undefined)
  state.replace.mockReset()
})
afterEach(cleanup)
async function review() {
  await screen.findByLabelText('Phone number with country code')
  fireEvent.change(screen.getByLabelText('Phone number with country code'), {
    target: { value: '+2348012345678' },
  })
  fireEvent.change(screen.getByLabelText('Amount in dollars'), { target: { value: '1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Review transfer' }))
  await screen.findByRole('button', { name: 'Slide to send' })
}
describe('phone Send', () => {
  it('reserves before funding and never sends twice on double activation', async () => {
    render(<PhoneSend />)
    await review()
    const button = screen.getByRole('button', { name: 'Slide to send' })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(state.replace).toHaveBeenCalledWith(`/wallet/phone/${payment().id}`))
    expect(state.client.reserve).toHaveBeenCalledTimes(1)
    expect(state.fund).toHaveBeenCalledTimes(1)
    expect(state.client.reserve.mock.invocationCallOrder[0]).toBeLessThan(
      state.fund.mock.invocationCallOrder[0]!,
    )
    expect(state.send).not.toHaveBeenCalled()
  })
  it('sends verified recipients directly without making a waiting account', async () => {
    state.client.resolve.mockResolvedValue({ address: recipient })
    render(<PhoneSend />)
    await review()
    fireEvent.click(screen.getByRole('button', { name: 'Slide to send' }))
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1))
    expect(state.send).toHaveBeenCalledWith(
      { address: recipient, name: '+2348012345678' },
      1_000_000n,
      '',
      { privately: false },
    )
    expect(state.client.reserve).not.toHaveBeenCalled()
  })
  it('preserves the waiting payment on uncertain funding and does not fund it again', async () => {
    state.fund.mockRejectedValue(Error('timeout'))
    render(<PhoneSend />)
    await review()
    fireEvent.click(screen.getByRole('button', { name: 'Slide to send' }))
    await waitFor(() => expect(state.replace).toHaveBeenCalledWith(`/wallet/phone/${payment().id}`))
    expect(state.fund).toHaveBeenCalledTimes(1)
  })
  it('shows the USSD destination and sends straight to the active pocket', async () => {
    const pocket = '0x3333333333333333333333333333333333333333'
    state.client.resolve.mockResolvedValue({ address: pocket, destination: 'ussd-pocket' })
    render(<PhoneSend />)
    await review()
    expect(screen.getByText(/Goes directly to their USSD balance/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Slide to send' }))
    await waitFor(() =>
      expect(state.send).toHaveBeenCalledWith(
        { address: pocket, name: '+2348012345678' },
        1_000_000n,
        '',
        { privately: false },
      ),
    )
    expect(state.client.reserve).not.toHaveBeenCalled()
  })
  it('requires another review if the USSD pocket closes before sending', async () => {
    state.client.resolve
      .mockResolvedValueOnce({
        address: '0x3333333333333333333333333333333333333333',
        destination: 'ussd-pocket',
      })
      .mockResolvedValueOnce({ address: recipient, destination: 'wallet' })
    render(<PhoneSend />)
    await review()
    fireEvent.click(screen.getByRole('button', { name: 'Slide to send' }))
    await screen.findByRole('alert')
    expect(state.send).not.toHaveBeenCalled()
    expect(state.fund).not.toHaveBeenCalled()
  })
  it('stops before moving funds if the verified recipient mapping changes', async () => {
    state.client.resolve
      .mockResolvedValueOnce({ address: recipient })
      .mockResolvedValueOnce({ address: null })
    render(<PhoneSend />)
    await review()
    fireEvent.click(screen.getByRole('button', { name: 'Slide to send' }))
    await screen.findByRole('alert')
    expect(state.send).not.toHaveBeenCalled()
  })
  it('keeps sender recovery available when the invitation was rejected', async () => {
    render(<PhonePaymentScreen id={payment().id} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Return dollars to my wallet' }))
    await waitFor(() =>
      expect(state.client.takeBack).toHaveBeenCalledWith(state.sign, sender, payment().id),
    )
  })
  it('requests verification for a new recipient and claims only after the code succeeds', async () => {
    address = recipient
    state.client.requestCode.mockResolvedValue({ sent: true })
    state.client.verify.mockResolvedValue({ verified: true })
    state.client.claim
      .mockRejectedValueOnce(new Error('Verify the recipient phone number with this wallet first.'))
      .mockResolvedValue(payment())
    render(<PhonePaymentScreen id={payment().id} />)
    fireEvent.change(await screen.findByLabelText('Your full phone number'), {
      target: { value: '+2348012345678' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue to claim' }))
    await screen.findByLabelText('Verification code')
    expect(state.client.claim).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and claim' }))
    await waitFor(() => expect(state.client.claim).toHaveBeenCalledTimes(2))
    expect(state.client.verify.mock.invocationCallOrder[0]).toBeLessThan(
      state.client.claim.mock.invocationCallOrder[1]!,
    )
  })
  it('resumes a verified recipient claim after a reload without requesting another OTP', async () => {
    address = recipient
    state.client.claim.mockResolvedValue(payment())
    render(<PhonePaymentScreen id={payment().id} />)
    fireEvent.change(await screen.findByLabelText('Your full phone number'), {
      target: { value: '+2348012345678' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue to claim' }))
    await waitFor(() => expect(state.client.claim).toHaveBeenCalledTimes(1))
    expect(state.client.requestCode).not.toHaveBeenCalled()
  })
})
