import { type Hex, hashTypedData, recoverTypedDataAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'
import { paymentTypedData } from '../src/card.js'
import { HaloError, readCard, signWithCard, softCard, type Transceive } from '../src/halo.js'

const key = generatePrivateKey()
const account = privateKeyToAccount(key)
const contract = '0x8430a32F08b6E4771eaa432729107492266A203d'

describe('HaLo driver', () => {
  it('reads the card’s address from slot 1', async () => {
    expect(await readCard(softCard(key))).toBe(account.address)
  })

  it('signs a Kova Card payment that recovers to the card, with low s, whatever the chip returned', async () => {
    const typedData = paymentTypedData(10143, contract, {
      card: account.address,
      to: '0x000000000000000000000000000000000000dEaD',
      amount: 2_400_000n,
      memo: `0x4b4f5641${'00'.repeat(28)}` as Hex,
      deadline: 1_900_000_000n,
    })
    for (let i = 0; i < 8; i++) {
      const { card, signature } = await signWithCard(softCard(key), hashTypedData(typedData))
      expect(card).toBe(account.address)
      expect(await recoverTypedDataAddress({ ...typedData, signature })).toBe(account.address)
      const s = BigInt(`0x${signature.slice(66, 130)}`)
      expect(s <= 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n).toBe(true)
    }
  })

  it('says plainly when the thing tapped isn’t a Kova Card', async () => {
    const notACard: Transceive = async () => [0x6a, 0x82]
    await expect(readCard(notACard)).rejects.toThrow(HaloError)
    await expect(readCard(notACard)).rejects.toThrow(/isn’t a Kova Card/)
  })

  it('turns a chip error into words', async () => {
    const card = softCard(key)
    const noSlot: Transceive = async (apdu) =>
      apdu[0] === 0xb0 ? [0xe1, 0x02, 0x90, 0x00] : card(apdu)
    await expect(signWithCard(noSlot, `0x${'11'.repeat(32)}`)).rejects.toThrow(
      /no key in that slot/,
    )
  })
})
