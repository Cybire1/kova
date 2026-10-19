import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function settings(values: Record<string, string | undefined> = {}) {
  for (const name of ['KOVA_NETWORK', 'KOVA_API_URL', 'KOVA_PUBLIC_API_URL']) {
    vi.stubEnv(name, values[name])
  }
  return import('./network')
}

describe('public network configuration', () => {
  it('uses mainnet and its matching API when no overrides are provided', async () => {
    const config = await settings()
    expect(config.network).toBe('mainnet')
    expect(config.apiUrl).toBe('https://api-monad-mainnet.up.railway.app')
    expect(config.publicApiUrl).toBe(config.apiUrl)
  })

  it('uses the matching API for an explicitly selected testnet', async () => {
    const config = await settings({ KOVA_NETWORK: 'testnet' })
    expect(config.network).toBe('testnet')
    expect(config.apiUrl).toBe('https://api-monad.up.railway.app')
  })

  it('preserves separate internal and public API addresses', async () => {
    const config = await settings({
      KOVA_NETWORK: 'mainnet',
      KOVA_API_URL: 'http://api.railway.internal:4000',
      KOVA_PUBLIC_API_URL: 'https://api-monad-mainnet.up.railway.app',
    })
    expect(config.apiUrl).toBe('http://api.railway.internal:4000')
    expect(config.publicApiUrl).toBe('https://api-monad-mainnet.up.railway.app')
  })

  it('rejects an invalid network instead of silently using another chain', async () => {
    await expect(settings({ KOVA_NETWORK: 'mainent' })).rejects.toThrow('KOVA_NETWORK')
  })

  it('falls back to the selected chain when Docker build arguments are empty', async () => {
    const config = await settings({
      KOVA_NETWORK: 'testnet',
      KOVA_API_URL: '',
      KOVA_PUBLIC_API_URL: '',
    })
    expect(config.apiUrl).toBe('https://api-monad.up.railway.app')
    expect(config.publicApiUrl).toBe(config.apiUrl)
  })
})
