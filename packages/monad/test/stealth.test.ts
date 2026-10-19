import type { Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'
import {
  checkStealthAddress,
  generateStealthAddress,
  generateStealthPayment,
  openStealthMemo,
  parseStealthMetaAddress,
  parseStealthMetadata,
  parseStealthViewKey,
  stealthKeysFromSignature,
  stealthKeysMessage,
  stealthMemoMessage,
  stealthMetaAddress,
  stealthMetadata,
  stealthPrivateKey,
  stealthSender,
  stealthViewKey,
} from '../src/stealth.js'

const shop = privateKeyToAccount(generatePrivateKey())
const keys = stealthKeysFromSignature(
  await shop.signMessage({ message: stealthKeysMessage('mer_ada') }),
)
const meta = stealthMetaAddress(keys)

describe('private takings (ERC-5564 scheme 1)', () => {
  it('makes the same keys from the same wallet every time, with nothing stored', async () => {
    const again = stealthKeysFromSignature(
      await shop.signMessage({ message: stealthKeysMessage('mer_ada') }),
    )
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
      const view = {
        viewingPrivateKey: keys.viewingPrivateKey,
        spendingPublicKey: parseStealthMetaAddress(meta).spendingPublicKey,
      }
      expect(checkStealthAddress(view, sale)).toBe(sale.stealthAddress)
      expect(privateKeyToAccount(stealthPrivateKey(keys, sale.ephemeralPublicKey)).address).toBe(
        sale.stealthAddress,
      )
    }
  })

  it('stays invisible to anyone else’s keys', async () => {
    const other = stealthKeysFromSignature(
      await privateKeyToAccount(generatePrivateKey()).signMessage({
        message: stealthKeysMessage('mer_ada'),
      }),
    )
    const otherView = {
      viewingPrivateKey: other.viewingPrivateKey,
      spendingPublicKey: parseStealthMetaAddress(stealthMetaAddress(other)).spendingPublicKey,
    }
    for (let i = 0; i < 40; i++)
      expect(checkStealthAddress(otherView, generateStealthAddress(meta))).toBeNull()
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
    const florist = stealthKeysFromSignature(
      await shop.signMessage({ message: stealthKeysMessage('mer_lucia') }),
    )
    expect(stealthMetaAddress(florist)).not.toBe(meta)
    const floristView = {
      viewingPrivateKey: florist.viewingPrivateKey,
      spendingPublicKey: parseStealthMetaAddress(stealthMetaAddress(florist)).spendingPublicKey,
    }
    for (let i = 0; i < 20; i++)
      expect(checkStealthAddress(floristView, generateStealthAddress(meta))).toBeNull()
  })

  it('refuses a malformed meta-address or view key', () => {
    expect(() => parseStealthMetaAddress('st:eth:0x1234')).toThrow()
    expect(() => parseStealthViewKey('kova-view:0xzz')).toThrow()
  })
})

describe('sealed memos and on-chain announcements', () => {
  const keysFor = (n: number) =>
    stealthKeysFromSignature(`0x${n.toString(16).padStart(2, '0').repeat(64)}1b` as Hex)

  it('seals a memo only the recipient’s viewing key opens, bound to its one-time address', async () => {
    const keys = keysFor(7)
    const meta = stealthMetaAddress(keys)
    const ada = privateKeyToAccount(generatePrivateKey())
    const pay = generateStealthPayment(meta, {
      from: ada.address,
      name: 'Ada',
      note: 'Train tickets',
      kind: 'send',
    })
    expect(pay.sealed).toMatch(/^0x01/)
    const memo = openStealthMemo(keys.viewingPrivateKey, { ...pay, sealed: pay.sealed })
    expect(memo).toEqual({ from: ada.address, name: 'Ada', note: 'Train tickets', kind: 'send' })
    // Another wallet's viewing key, or the memo moved to another address, opens nothing.
    expect(openStealthMemo(keysFor(8).viewingPrivateKey, pay)).toBeNull()
    const other = generateStealthPayment(meta, null)
    expect(openStealthMemo(keys.viewingPrivateKey, { ...other, sealed: pay.sealed })).toBeNull()
    expect(other.sealed).toBeNull()
  })

  it('says who a payment is from, and how sure that is', async () => {
    const keys = keysFor(9)
    const ada = privateKeyToAccount(generatePrivateKey())
    const pay = generateStealthPayment(stealthMetaAddress(keys), null)
    const proof = await ada.signMessage({ message: stealthMemoMessage(pay.stealthAddress) })
    // Sent from Ada's own wallet: Monad shows it.
    expect(
      (
        await stealthSender(
          { from: ada.address, name: 'Ada' },
          { stealthAddress: pay.stealthAddress, from: ada.address },
        )
      )?.proven,
    ).toBe('chain')
    // Sent from her private dollars, with her wallet's signature.
    const elsewhere = privateKeyToAccount(generatePrivateKey()).address
    expect(
      (
        await stealthSender(
          { from: ada.address, proof },
          { stealthAddress: pay.stealthAddress, from: elsewhere },
        )
      )?.proven,
    ).toBe('signed')
    // Someone claiming to be Ada, without her signature.
    const forged = await privateKeyToAccount(generatePrivateKey()).signMessage({
      message: stealthMemoMessage(pay.stealthAddress),
    })
    expect(
      (
        await stealthSender(
          { from: ada.address, proof: forged },
          { stealthAddress: pay.stealthAddress, from: elsewhere },
        )
      )?.proven,
    ).toBe('claimed')
  })

  it('lays metadata out as ERC-5564 does for a token, then the sealed memo', () => {
    const keys = keysFor(11)
    const pay = generateStealthPayment(stealthMetaAddress(keys), { note: 'hi' })
    const token = '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC'
    const metadata = stealthMetadata({
      viewTag: pay.viewTag,
      token,
      amount: 4_500_000n,
      sealed: pay.sealed,
    })
    const parsed = parseStealthMetadata(metadata)
    expect(parsed?.viewTag).toBe(pay.viewTag)
    expect(parsed?.selector).toBe('0xe3ee160e')
    expect(parsed?.token).toBe(token)
    expect(parsed?.amount).toBe(4_500_000n)
    expect(parsed?.sealed).toBe(pay.sealed)
    expect(
      parseStealthMetadata(stealthMetadata({ viewTag: pay.viewTag, token, amount: 1n }))?.sealed,
    ).toBeNull()
  })
})
