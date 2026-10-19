import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../src/config.js'
import { callbackSecretMatches, redactCallbackLog } from '../src/services/ussd-callback.js'

const { reply } = vi.hoisted(() => ({ reply: vi.fn() }))
vi.mock('../src/services/ussd.js', () => ({ ussdReply: reply }))
vi.mock('../src/services/pockets.js', () =>
  Object.fromEntries(
    [
      'checkOwner',
      'closePocket',
      'confirmPhone',
      'pocketBalance',
      'pocketOf',
      'requirePockets',
      'requirePocketSetup',
      'pocketsReady',
      'reconcilePocket',
      'serializePocket',
      'setUpPocket',
      'spend',
      'updatePocket',
    ].map((name) => [name, vi.fn()]),
  ),
)
const { ussdRoutes } = await import('../src/routes/ussd.js')
const app = new Hono().route('/v1', ussdRoutes)
const saved = { secret: config.KOVA_USSD_CALLBACK_SECRET, code: config.KOVA_USSD_CODE }
const secret = 'test-callback-secret-for-this-suite'
const fields = () => ({
  sessionId: 'ATUid_test',
  phoneNumber: '+2348012345678',
  serviceCode: '*384*53916#',
  text: '',
})
const request = (body: Record<string, string> = fields(), token = secret) =>
  app.request(`/v1/ussd/${token}`, { method: 'POST', body: new URLSearchParams(body) })

beforeEach(() => {
  config.KOVA_USSD_CALLBACK_SECRET = secret
  config.KOVA_USSD_CODE = '*384*53916#'
  reply.mockReset().mockResolvedValue('CON Kova\n1 Balance')
})
afterEach(() => {
  config.KOVA_USSD_CALLBACK_SECRET = saved.secret
  config.KOVA_USSD_CODE = saved.code
  vi.restoreAllMocks()
})

describe('USSD provider callback', () => {
  it('accepts the assigned code and forwards the accumulated text', async () => {
    const response = await request({ ...fields(), text: '1*4821' })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('CON Kova\n1 Balance')
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumber: '+2348012345678', text: '1*4821' }),
    )
  })

  it.each(['wrong-secret', 'a'.repeat(64)])('rejects an invalid secret', async (given) => {
    expect((await request(fields(), given)).status).toBe(404)
    expect(reply).not.toHaveBeenCalled()
  })

  it('rejects a callback for a different service code', async () => {
    expect((await request({ ...fields(), serviceCode: '*384*25891#' })).status).toBe(404)
    expect(reply).not.toHaveBeenCalled()
  })

  it.each([
    { text: '1*<script>' },
    { text: '1'.repeat(257) },
    { sessionId: '' },
    { phoneNumber: 'invalid' },
    { serviceCode: '' },
  ])('rejects malformed callback fields', async (change) => {
    expect((await request({ ...fields(), ...change })).status).toBe(400)
    expect(reply).not.toHaveBeenCalled()
  })

  it('limits request size before processing any payment', async () => {
    expect((await request({ ...fields(), text: '1'.repeat(3000) })).status).toBe(413)
    expect(reply).not.toHaveBeenCalled()
  })

  it('does not claim no money moved after an unknown failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    reply.mockRejectedValue(new Error('confirmation timed out'))
    const text = await (await request()).text()
    expect(text).toContain('Check your Kova payments')
    expect(text).not.toContain('Nothing was paid')
  })

  it('compares secrets without accepting an unconfigured callback', () => {
    expect(callbackSecretMatches(secret, secret)).toBe(true)
    expect(callbackSecretMatches(secret, undefined)).toBe(false)
    expect(callbackSecretMatches('short', secret)).toBe(false)
  })

  it('redacts callback secrets from request logs', () => {
    const log = `--> POST /v1/ussd/${secret} 200 4ms`
    expect(redactCallbackLog(log)).toBe('--> POST /v1/ussd/[redacted] 200 4ms')
    expect(redactCallbackLog('--> GET /health 200')).toBe('--> GET /health 200')
  })
})
