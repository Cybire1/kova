import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'
import { randomNonce, transferAuthorizationTypedData } from '../src/authorization.js'
import { networkByChainId } from '../src/networks.js'
import {
  decodeOfflinePayment,
  encodeOfflinePayment,
  OFFLINE_MAX,
  OFFLINE_VALIDITY,
  offlineCodeFrom,
  offlinePaymentLink,
  type OfflinePayment,
  verifyOfflinePayment,
} from '../src/offline.js'
import { tokenByAddress } from '../src/tokens.js'

const network = networkByChainId(10143)
const AUSD = '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC'
const token = tokenByAddress(network.id, AUSD)!
const ada = privateKeyToAccount(generatePrivateKey())
const sam = privateKeyToAccount(generatePrivateKey()).address
const now = BigInt(Math.floor(Date.now() / 1000))

async function pay(value: bigint, name: string | null = 'Ada'): Promise<OfflinePayment> {
  const authorization = { from: ada.address, to: sam, value, validAfter: 0n, validBefore: now + OFFLINE_VALIDITY, nonce: randomNonce() }
  const signature = await ada.signTypedData(transferAuthorizationTypedData(token, network.chainId, authorization))
  return { chainId: network.chainId, token: token.address, authorization, signature, name }
}

describe('offline payments', () => {
  it('travels as a short code and comes back exactly, name and all', async () => {
    const p = await pay(20_000_000n, 'Ada Okafor 🎈')
    const code = encodeOfflinePayment(p)
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(code.length).toBeLessThan(300)
    expect(decodeOfflinePayment(code)).toEqual(p)
    expect(offlineCodeFrom(offlinePaymentLink(code))).toBe(code)
    expect(offlineCodeFrom(code)).toBe(code)
  })

  it('is checked with no network: the signature, the cap and the time', async () => {
    const p = await pay(20_000_000n)
    expect(await verifyOfflinePayment(p)).toEqual({ ok: true })
    // Anyone changing the amount or the recipient breaks the signature.
    expect(await verifyOfflinePayment({ ...p, authorization: { ...p.authorization, value: 2_000_000_000n } })).toEqual({ ok: false, reason: 'too-large' })
    expect(await verifyOfflinePayment({ ...p, authorization: { ...p.authorization, value: 30_000_000n } })).toEqual({ ok: false, reason: 'bad-signature' })
    expect(await verifyOfflinePayment({ ...p, authorization: { ...p.authorization, to: ada.address } })).toEqual({ ok: false, reason: 'bad-signature' })
    expect(await verifyOfflinePayment(p, now + OFFLINE_VALIDITY + 1n)).toEqual({ ok: false, reason: 'expired' })
    expect(await verifyOfflinePayment(await pay(OFFLINE_MAX + 1n))).toEqual({ ok: false, reason: 'too-large' })
  })

  it('refuses what isn’t a payment code', () => {
    expect(decodeOfflinePayment('hello')).toBeNull()
    expect(offlineCodeFrom('https://mykova.app/c/lnk_123#abc')).toBeNull()
  })
})
