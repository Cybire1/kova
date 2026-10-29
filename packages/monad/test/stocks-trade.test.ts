import { encodeAbiParameters, keccak256 } from 'viem'
import { describe, expect, it } from 'vitest'
import { buyNonce, stockAttestation, stockCountryBlock, stockMinOut } from '../src/stocks-trade.js'

const wallet = '0x7171732ec724cf39b8e2ee08c762d04afab36696'
const stock = '0x00000000000000000000000000000000000075a1'
const ref = `0x${'ab'.repeat(32)}` as const

describe('stock trades', () => {
  it('signs the exact statement, the address checksummed', () => {
    expect(stockAttestation(wallet, '2026-10-29')).toBe(
      [
        'Kova stock tokens',
        "I confirm I am not a US citizen, US resident or US taxpayer, and I don't live in a country where xStocks are restricted.",
        'I understand xStocks are tokens issued by Backed, not shares, that their price can fall, and that Kova gives no advice.',
        'Wallet: 0x7171732ec724CF39b8e2ee08C762d04AFab36696',
        'Date: 2026-10-29',
      ].join('\n'),
    )
  })

  it('makes the buy nonce as KovaStocks does: keccak256(abi.encode(stock, minOut, ref))', () => {
    expect(buyNonce(stock, 99n, ref)).toBe(
      keccak256(
        encodeAbiParameters(
          [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }],
          [stock, 99n, ref],
        ),
      ),
    )
  })

  it('blocks the US, its territories, the UK, the EEA and sanctioned countries, and any it can’t tell', () => {
    for (const code of ['US', 'PR', 'GB', 'CA', 'AU', 'DE', 'NO', 'CH', 'RU', 'KP'])
      expect(stockCountryBlock(code)).toMatch(/^Stock tokens aren’t available in /)
    expect(stockCountryBlock('US')).toBe('Stock tokens aren’t available in the United States.')
    expect(stockCountryBlock(null)).toMatch(/can’t tell/)
    expect(stockCountryBlock('NG')).toBeNull()
    expect(stockCountryBlock('ke')).toBeNull()
  })

  it('takes at most 1% below the quote', () => {
    expect(stockMinOut(1_000_000n)).toBe(990_000n)
  })
})
