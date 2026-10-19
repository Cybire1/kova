import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../src/config.js'
import { sendSms, smsReady } from '../src/services/sms.js'

const saved = {
  username: config.AT_USERNAME,
  key: config.AT_API_KEY,
  network: config.KOVA_NETWORK,
  sender: config.AT_SENDER_ID,
}
const phone = '+2348012345678'
const accepted = (statusCode = 101, number = phone) => ({
  SMSMessageData: { Recipients: [{ number, statusCode, messageId: 'test-message-id' }] },
})

beforeEach(() => {
  config.AT_USERNAME = 'sandbox'
  config.AT_API_KEY = 'test-key'
  config.KOVA_NETWORK = 'testnet'
  config.AT_SENDER_ID = undefined
})
afterEach(() => {
  config.AT_USERNAME = saved.username
  config.AT_API_KEY = saved.key
  config.KOVA_NETWORK = saved.network
  config.AT_SENDER_ID = saved.sender
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('USSD verification SMS', () => {
  it.each([100, 101, 102])('accepts provider status %i for the intended phone', async (status) => {
    const fetch = vi.fn().mockResolvedValue(Response.json(accepted(status), { status: 201 }))
    vi.stubGlobal('fetch', fetch)
    await sendSms('+234 801 234 5678', 'A verification message')
    expect(fetch).toHaveBeenCalledOnce()
    const [url, request] = fetch.mock.calls[0]!
    expect(url).toBe('https://api.sandbox.africastalking.com/version1/messaging')
    expect(request.body.get('to')).toBe(phone)
    expect(request.body.get('username')).toBe('sandbox')
  })

  it('fails without credentials and never logs the verification code', async () => {
    config.AT_API_KEY = undefined
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(sendSms(phone, 'Secret OTP 654321')).rejects.toThrow('isn’t available')
    expect(log).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('prevents sandbox credentials from enabling mainnet verification', async () => {
    config.KOVA_NETWORK = 'mainnet'
    expect(smsReady()).toBe(false)
    await expect(sendSms(phone, 'test')).rejects.toThrow('isn’t available')
  })

  it('rejects an HTTP success containing an individual SMS rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(accepted(405))))
    await expect(sendSms(phone, 'test')).rejects.toThrow('hasn’t accepted')
  })

  it('rejects an acceptance for a different recipient', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json(accepted(101, '+2348099999999'))),
    )
    await expect(sendSms(phone, 'test')).rejects.toThrow('hasn’t accepted')
  })

  it.each([{}, { SMSMessageData: { Recipients: [] } }])(
    'rejects malformed or empty responses',
    async (response) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(response)))
      await expect(sendSms(phone, 'test')).rejects.toThrow('hasn’t accepted')
    },
  )

  it('keeps provider response text out of errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Sensitive provider response', { status: 401 })),
    )
    const error = await sendSms(phone, 'test').catch((error) => error)
    expect(error.message).toContain('hasn’t accepted')
    expect(error.message).not.toContain('Sensitive')
  })

  it('keeps network error details out of errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Sensitive request metadata')))
    await expect(sendSms(phone, 'test')).rejects.toThrow('hasn’t accepted')
  })
})
