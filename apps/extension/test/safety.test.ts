import { kovaCardAddress, paymentTypedData, tokens } from '@kova/monad'
import { encodeFunctionData, erc20Abi, type Hex, recoverTypedDataAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'
import { dollarTransfer } from '../src/background/provider.js'
import { checkedPayment, type Prepared } from '../src/shared/kova.js'

/**
 * The two checks that stand between a website and a site key's signature: a transaction is only
 * paid when it's a plain AUSD transfer, and a payment Kova prepares is only signed when it's exactly
 * what the person approved.
 */

const contract = kovaCardAddress('mainnet')
const ausd = tokens.mainnet.AUSD
if (!contract || !ausd) throw new Error('mainnet config missing')

const key = privateKeyToAccount(generatePrivateKey())
const to = privateKeyToAccount(generatePrivateKey()).address
const now = 1_800_000_000
const memo = `0x${'ab'.repeat(32)}` as Hex

const prepared = (
  over: Partial<Prepared['typed_data']['message']> = {},
  domain: Partial<Prepared['typed_data']['domain']> = {},
): Prepared => ({
  id: 'p1',
  key: 'k1',
  kind: 'pay',
  to,
  amount: '4.99',
  description: null,
  status: 'prepared',
  reason: null,
  tx_hash: null,
  created_at: new Date().toISOString(),
  typed_data: {
    domain: {
      name: 'Kova Card',
      version: '1',
      chainId: 143,
      verifyingContract: contract,
      ...domain,
    },
    message: {
      card: key.address,
      to,
      amount: '4990000',
      memo,
      deadline: String(now + 120),
      ...over,
    },
  },
})

const expected = { card: key.address, to, amount: 4_990_000n }

describe('checking what Kova asks the key to sign', () => {
  it('signs the payment rebuilt here, which matches Kova’s', async () => {
    const typed = checkedPayment(prepared(), expected, now)
    const signature = await key.signTypedData(typed)
    const signer = await recoverTypedDataAddress({
      ...paymentTypedData(143, contract, {
        card: key.address,
        to,
        amount: 4_990_000n,
        memo,
        deadline: BigInt(now + 120),
      }),
      signature,
    })
    expect(signer).toBe(key.address)
  })

  it('refuses any field that differs from what the person approved', () => {
    const other = privateKeyToAccount(generatePrivateKey()).address
    expect(() => checkedPayment(prepared({ to: other }), expected, now)).toThrow(/recipient/)
    expect(() => checkedPayment(prepared({ amount: '49900000' }), expected, now)).toThrow(/amount/)
    expect(() => checkedPayment(prepared({ card: other }), expected, now)).toThrow(/key/)
    expect(() => checkedPayment(prepared({ deadline: String(now + 3600) }), expected, now)).toThrow(
      /deadline/,
    )
    expect(() => checkedPayment(prepared({ deadline: String(now - 1) }), expected, now)).toThrow(
      /deadline/,
    )
    expect(() => checkedPayment(prepared({ memo: '0x1234' as Hex }), expected, now)).toThrow(/memo/)
    expect(() => checkedPayment(prepared({}, { chainId: 1 }), expected, now)).toThrow(/network/)
    expect(() => checkedPayment(prepared({}, { verifyingContract: other }), expected, now)).toThrow(
      /contract/,
    )
    expect(() => checkedPayment(prepared({}, { name: 'Evil' }), expected, now)).toThrow(/domain/)
  })
})

describe('what a website can ask Kova to pay', () => {
  const transfer = (recipient: `0x${string}`, amount: bigint) =>
    encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [recipient, amount] })

  it('pays a plain AUSD transfer', () => {
    expect(dollarTransfer({ to: ausd.address, data: transfer(to, 4_990_000n) })).toEqual({
      to,
      amount: 4_990_000n,
    })
    expect(
      dollarTransfer({ to: ausd.address.toLowerCase(), input: transfer(to, 1n), value: '0x0' }),
    ).toEqual({ to, amount: 1n })
  })

  it('refuses anything else: approvals, other tokens, MON, nothing at all', () => {
    const approve = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [to, 10n ** 30n],
    })
    expect(dollarTransfer({ to: ausd.address, data: approve })).toBeNull()
    expect(dollarTransfer({ to, data: transfer(to, 5n) })).toBeNull()
    expect(dollarTransfer({ to: ausd.address, data: transfer(to, 5n), value: '0x1' })).toBeNull()
    expect(dollarTransfer({ to: ausd.address, data: transfer(to, 0n) })).toBeNull()
    expect(dollarTransfer({ to: ausd.address, data: '0xdeadbeef' })).toBeNull()
    expect(dollarTransfer({ to: ausd.address })).toBeNull()
    expect(dollarTransfer(null)).toBeNull()
  })
})
