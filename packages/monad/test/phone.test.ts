import { describe, expect, it } from 'vitest'
import { phoneInput, phoneMessage, phonePaymentNonce } from '../src/phone.js'

describe('phone payments', () => {
  it('requires explicit country codes and ignores wallet addresses and local numbers', () => {
    expect(phoneInput('+234 (801) 234-5678')).toBe('+2348012345678')
    expect(phoneInput('2348012345678')).toBe('+2348012345678')
    expect(phoneInput('002348012345678')).toBe('+2348012345678')
    expect(phoneInput('08012345678')).toBeNull()
    expect(phoneInput('0x1234567890123456789012345678901234567890')).toBeNull()
    expect(phoneInput('Sam')).toBeNull()
  })
  it('binds approvals and settlement nonces to their network and recipient', () => {
    const p = {
      action: 'resolve' as const,
      wallet: '0x1111111111111111111111111111111111111111' as const,
      chainId: 143,
      signedAt: 10,
      phone: '+2348012345678',
    }
    expect(phoneMessage(p)).not.toBe(phoneMessage({ ...p, chainId: 10143 }))
    expect(phoneMessage(p)).not.toBe(phoneMessage({ ...p, phone: '+2348012345679' }))
    expect(phonePaymentNonce(143, 'one')).not.toBe(phonePaymentNonce(10143, 'one'))
    expect(phonePaymentNonce(143, 'one')).toBe(phonePaymentNonce(143, 'one'))
  })
})
