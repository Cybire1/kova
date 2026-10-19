// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { dropLinkKey, keptLinks, newLinkKey, settleLinkKey } from './dollar-links'
import { readLedger, writeLedger } from './private'
import { networkStorageKey } from './storage'

afterEach(() => localStorage.clear())

describe('switching the website network', () => {
  it('preserves the original mainnet storage and the original Railway testnet storage', () => {
    expect(networkStorageKey('receipts', 'mainnet', 'mykova.app')).toBe('receipts')
    expect(networkStorageKey('receipts', 'testnet', 'mykova.app')).toBe('receipts.testnet')
    expect(networkStorageKey('receipts', 'testnet', 'web-monad.up.railway.app')).toBe('receipts')
    expect(networkStorageKey('receipts', 'mainnet', 'web-monad.up.railway.app')).toBe(
      'receipts.mainnet',
    )
  })

  it('does not reuse a mainnet private-feed cursor or receipts on testnet', () => {
    const wallet = '0x1111111111111111111111111111111111111111'
    const ledger = { cursor: '123', found: [], sentTo: ['mainnet payment'], announced: {} }
    writeLedger(wallet, ledger, 'mainnet')
    expect(readLedger(wallet, 'testnet').cursor).toBeNull()
    writeLedger(wallet, { ...ledger, cursor: '456', sentTo: [] }, 'testnet')
    expect(readLedger(wallet, 'mainnet')).toEqual(ledger)
    expect(readLedger(wallet, 'testnet').cursor).toBe('456')
  })

  it('keeps mainnet recovery keys when testnet links are created, settled or removed', () => {
    const mainnet = newLinkKey(1_000_000n, 'Real dollars', 'mainnet')
    const testnet = newLinkKey(2_000_000n, 'Test dollars', 'testnet')
    expect(Object.values(keptLinks('testnet'))).toEqual([testnet])
    settleLinkKey(testnet, 'test-link', 'testnet')
    const another = newLinkKey(100_000n, null, 'testnet')
    dropLinkKey(another, 'testnet')
    expect(Object.values(keptLinks('mainnet'))).toEqual([mainnet])
    expect(keptLinks('testnet')['test-link']?.key).toBe(testnet.key)
  })
})
