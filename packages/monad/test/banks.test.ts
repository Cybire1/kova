import { describe, expect, it } from 'vitest'
import {
  bankDisplayName,
  looksLikePhoneNumber,
  NUBAN_BANKS,
  nubanCheckDigit,
  nubanFits,
  suggestBanks,
} from '../src/banks.js'

const banks = [
  { name: 'OPay', code: '100004' },
  { name: 'PalmPay', code: '100033' },
  { name: 'Moniepoint', code: '090405' },
  { name: 'Kuda', code: '090267' },
  { name: 'Guaranty Trust Bank', code: '000013' },
  { name: 'Access Bank', code: '000014' },
  { name: 'Zenith Bank', code: '000015' },
  { name: 'First Bank', code: '000016' },
  { name: 'United Bank for Africa', code: '000004' },
  { name: 'Wema Bank', code: '000017' },
]

/** A valid NUBAN at a bank: nine digits and the check digit for its CBN code. */
const nuban = (serial: string, cbn: string) => serial + nubanCheckDigit(cbn, serial)

describe('NUBAN check digit', () => {
  it('matches the CBN’s worked example: First Bank 011, serial 000001457, check digit 9', () => {
    expect(nubanCheckDigit('011', '000001457')).toBe(9)
    expect(nubanFits('0000014579', '011')).toBe(true)
    expect(nubanFits('0000014578', '011')).toBe(false)
  })

  it('gives the same digit whether the bank code is three digits or padded to six', () => {
    expect(nubanCheckDigit('058', '012345678')).toBe(nubanCheckDigit('000058', '012345678'))
  })

  it('only fits ten digits', () => {
    expect(nubanFits('000001457', '011')).toBe(false)
    expect(nubanFits('00000145790', '011')).toBe(false)
  })
})

describe('suggesting banks from an account number', () => {
  it('puts the phone-number banks first for a number that looks like a phone number', () => {
    expect(looksLikePhoneNumber('8031234567')).toBe(true)
    const names = suggestBanks('8031234567', banks).map((s) => s.bank.name)
    expect(names.slice(0, 4)).toEqual(['OPay', 'PalmPay', 'Moniepoint', 'Kuda'])
    expect(suggestBanks('8031234567', banks)[0]?.reason).toBe('phone')
  })

  it('offers the bank whose check digit an account number fits', () => {
    const gtb = nuban('012345678', NUBAN_BANKS['000013'] as string)
    expect(looksLikePhoneNumber(gtb)).toBe(false)
    const found = suggestBanks(gtb, banks).find((s) => s.bank.code === '000013')
    expect(found?.reason).toBe('fits')
  })

  it('never offers a commercial bank the number doesn’t fit, as a fit', () => {
    const gtb = nuban('012345678', '058')
    for (const s of suggestBanks(gtb, banks))
      if (s.reason === 'fits') expect(nubanFits(gtb, NUBAN_BANKS[s.bank.code] as string)).toBe(true)
  })

  it('fills up with popular banks, skips banks it doesn’t know, and stops at the limit', () => {
    const list = suggestBanks('0123456789', banks.slice(0, 3), 5)
    expect(list.map((s) => s.bank.code)).toEqual(['100004', '090405', '100033'])
    expect(suggestBanks('0123456789', banks, 3)).toHaveLength(3)
  })

  it('suggests nothing until the number is complete', () => {
    expect(suggestBanks('803123456', banks)).toEqual([])
  })
})

describe('bank names', () => {
  it('uses the names people say, and tidies the rest', () => {
    expect(bankDisplayName({ code: '100004', name: 'Opay' })).toBe('OPay')
    expect(bankDisplayName({ code: '000015', name: 'Zenith bank PLC' })).toBe('Zenith Bank')
    expect(bankDisplayName({ code: '999999', name: 'FIRST CITY MONUMENT BANK PLC' })).toBe(
      'First City Monument Bank',
    )
    expect(bankDisplayName({ code: '999998', name: 'ACCION MFB' })).toBe('Accion MFB')
  })
})
