import { normalizePhone, pinProblem, pocketMessage } from '@kova/monad'
import { describe, expect, it, vi } from 'vitest'

vi.stubEnv('KOVA_POCKET_MASTER_KEY', 'ab'.repeat(32))
const { hashSecret, openKey, sealKey, secretMatches } = await import('../src/secrets.js')

describe('USSD pocket secrets', () => {
  const key = `0x${'11'.repeat(32)}` as const

  it('seals a pocket key and opens it again, only for the same pocket', () => {
    const sealed = sealKey(key, 'pocket-a')
    expect(sealed).not.toContain('1111')
    expect(openKey(sealed, 'pocket-a')).toBe(key)
    expect(() => openKey(sealed, 'pocket-b')).toThrow()
  })

  it('hashes PINs so only the right one matches', async () => {
    const stored = await hashSecret('4821')
    expect(await secretMatches('4821', stored)).toBe(true)
    expect(await secretMatches('4822', stored)).toBe(false)
  })
})

describe('pocket messages and inputs', () => {
  it('signs exactly what changes, and nothing else', () => {
    const wallet = '0x00000000000000000000000000000000000000AA'
    expect(
      pocketMessage({
        action: 'setup',
        wallet,
        phone: '+254711000111',
        cap: 50_000_000n,
        signedAt: 1,
      }),
    ).toBe(
      'Kova USSD pocket\nAction setup\nWallet 0x00000000000000000000000000000000000000aa\nPhone +254711000111\nCap 50000000\nSigned at 1',
    )
    expect(pocketMessage({ action: 'close', wallet, signedAt: 2 })).toBe(
      'Kova USSD pocket\nAction close\nWallet 0x00000000000000000000000000000000000000aa\nSigned at 2',
    )
  })

  it('reads phone numbers with their country code', () => {
    expect(normalizePhone('+254 711 000-111')).toBe('+254711000111')
    expect(normalizePhone('00447700900123')).toBe('+447700900123')
    expect(normalizePhone('0711000111')).toBeNull()
  })

  it('turns away PINs a stranger would guess first', () => {
    expect(pinProblem('4821')).toBeNull()
    expect(pinProblem('1111')).not.toBeNull()
    expect(pinProblem('1234')).not.toBeNull()
    expect(pinProblem('98765')).not.toBeNull()
    expect(pinProblem('12a4')).not.toBeNull()
  })
})
