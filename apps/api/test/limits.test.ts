import { describe, expect, it, vi } from 'vitest'

/** Who is asking, when Kova's website asks on a visitor's behalf. */

const request = (headers: Record<string, string>) => ({
  req: { header: (name: string) => headers[name] },
})
const secret = 'a-long-shared-secret-for-the-web-and-the-api-0123456789'

async function clientIpWith(configured?: string) {
  vi.resetModules()
  if (configured) process.env.KOVA_PROXY_SECRET = configured
  else delete process.env.KOVA_PROXY_SECRET
  return (await import('../src/limits.js')).clientIp
}

describe('clientIp', () => {
  it('takes the visitor the website vouches for, with the shared secret', async () => {
    const clientIp = await clientIpWith(secret)
    expect(
      clientIp(
        request({
          'x-kova-client-ip': '203.0.113.7',
          'x-kova-proxy-secret': secret,
          'x-forwarded-for': '10.0.0.1',
        }),
      ),
    ).toBe('203.0.113.7')
  })

  it('ignores the claim with the wrong secret, or none', async () => {
    const clientIp = await clientIpWith(secret)
    expect(
      clientIp(
        request({
          'x-kova-client-ip': '203.0.113.7',
          'x-kova-proxy-secret': 'guess',
          'x-forwarded-for': '10.0.0.1',
        }),
      ),
    ).toBe('10.0.0.1')
    expect(
      clientIp(request({ 'x-kova-client-ip': '203.0.113.7', 'x-forwarded-for': '10.0.0.1' })),
    ).toBe('10.0.0.1')
  })

  it('ignores it when this server shares no secret', async () => {
    const clientIp = await clientIpWith()
    expect(
      clientIp(
        request({
          'x-kova-client-ip': '203.0.113.7',
          'x-kova-proxy-secret': secret,
          'x-forwarded-for': '10.0.0.1',
        }),
      ),
    ).toBe('10.0.0.1')
  })
})
