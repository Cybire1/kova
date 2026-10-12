import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'
import {
  checkStealthAddress,
  generateStealthAddress,
  parseStealthMetaAddress,
  parseStealthViewKey,
  stealthKeysMessage,
  stealthKeysFromSignature,
  stealthMetaAddress,
  stealthPrivateKey,
  stealthViewKey,
} from '../src/stealth.js'

const shop = privateKeyToAccount(generatePrivateKey())
const keys = stealthKeysFromSignature(await shop.signMessage({ message: stealthKeysMessage('mer_ada') }))
const meta = stealthMetaAddress(keys)

describe('private takings (ERC-5564 scheme 1)', () => {
  it('makes the same keys from the same wallet every time, with nothing stored', async () => {
    const again = stealthKeysFromSignature(await shop.signMessage({ message: stealthKeysMessage('mer_ada') }))
    expect(again).toEqual(keys)
    expect(meta).toMatch(/^st:eth:0x[0-9a-f]{132}$/)
    expect(parseStealthMetaAddress(meta).spendingPublicKey).toHaveLength(68)
  })

  it('gives every sale its own address, which only the shop can find and open', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 40; i++) {
      const sale = generateStealthAddress(meta)
      expect(seen.has(sale.stealthAddress)).toBe(false)
      seen.add(sale.stealthAddress)
      const view = { viewingPrivateKey: keys.viewingPrivateKey, spendingPublicKey: parseStealthMetaAddress(meta).spendingPublicKey }
      expect(checkStealthAddress(view, sale)).toBe(sale.stealthAddress)
      expect(privateKeyToAccount(stealthPrivateKey(keys, sale.ephemeralPublicKey)).address).toBe(sale.stealthAddress)
    }
  })

  it('stays invisible to anyone else’s keys', async () => {
    const other = stealthKeysFromSignature(await privateKeyToAccount(generatePrivateKey()).signMessage({ message: stealthKeysMessage('mer_ada') }))
    const otherView = { viewingPrivateKey: other.viewingPrivateKey, spendingPublicKey: parseStealthMetaAddress(stealthMetaAddress(other)).spendingPublicKey }
    for (let i = 0; i < 40; i++) expect(checkStealthAddress(otherView, generateStealthAddress(meta))).toBeNull()
  })

  it('lets an accountant’s view key find every sale without being able to spend', () => {
    const view = parseStealthViewKey(stealthViewKey(keys))
    expect(view.viewingPrivateKey).toBe(keys.viewingPrivateKey)
    const sale = generateStealthAddress(meta)
    expect(checkStealthAddress(view, sale)).toBe(sale.stealthAddress)
    // The view key holds no spending secret: only the spending public key.
    expect(stealthViewKey(keys)).not.toContain(keys.spendingPrivateKey.slice(2))
  })

  it('gives each of a wallet’s shops its own keys', async () => {
    const florist = stealthKeysFromSignature(await shop.signMessage({ message: stealthKeysMessage('mer_lucia') }))
    expect(stealthMetaAddress(florist)).not.toBe(meta)
    const floristView = { viewingPrivateKey: florist.viewingPrivateKey, spendingPublicKey: parseStealthMetaAddress(stealthMetaAddress(florist)).spendingPublicKey }
    for (let i = 0; i < 20; i++) expect(checkStealthAddress(floristView, generateStealthAddress(meta))).toBeNull()
  })

  it('refuses a malformed meta-address or view key', () => {
    expect(() => parseStealthMetaAddress('st:eth:0x1234')).toThrow()
    expect(() => parseStealthViewKey('kova-view:0xzz')).toThrow()
  })
})
