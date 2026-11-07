import { recoverTypedDataAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'
import { randomNonce, transferAuthorizationTypedData } from '../src/authorization.js'
import { keySelfFreezeMessage, siteName } from '../src/spend-keys.js'
import { tokens } from '../src/tokens.js'
import {
  type PaymentRequired,
  parsePaymentRequired,
  payableRequirement,
  paymentSignatureHeader,
  readPaymentSignature,
} from '../src/x402.js'

const usdc = tokens.mainnet.USDC
const ausd = tokens.mainnet.AUSD
if (!usdc || !ausd) throw new Error('tokens missing')

const payTo = privateKeyToAccount(generatePrivateKey()).address

const required = (accepts: Record<string, unknown>[]) =>
  btoa(
    JSON.stringify({
      x402Version: 2,
      resource: { url: 'https://lumen.news/quiet-money', description: 'One article' },
      accepts,
    }),
  )

const usdcOption = {
  scheme: 'exact',
  network: 'eip155:143',
  amount: '100000',
  asset: usdc.address,
  payTo,
  maxTimeoutSeconds: 300,
  extra: { name: 'USDC', version: '2' },
}

describe('reading what a site asks for', () => {
  it('reads a PAYMENT-REQUIRED header and keeps the site’s own fields', () => {
    const parsed = parsePaymentRequired(required([usdcOption]))
    expect(parsed?.x402Version).toBe(2)
    expect(parsed?.accepts).toHaveLength(1)
    expect(parsed?.accepts[0]?.amount).toBe('100000')
    expect(parsed?.accepts[0]?.extra).toEqual({ name: 'USDC', version: '2' })
    expect(parsed?.resource?.url).toBe('https://lumen.news/quiet-money')
  })

  it('also reads a JSON body, and the older maxAmountRequired', () => {
    const body = JSON.stringify({
      x402Version: 1,
      accepts: [{ ...usdcOption, amount: undefined, maxAmountRequired: '5000' }],
    })
    expect(parsePaymentRequired(body)?.accepts[0]?.amount).toBe('5000')
  })

  it('drops anything malformed instead of guessing', () => {
    expect(parsePaymentRequired('not base64 at all %%%')).toBeNull()
    const parsed = parsePaymentRequired(
      required([
        { ...usdcOption, scheme: 'upto' },
        { ...usdcOption, amount: '-1' },
        { ...usdcOption, payTo: 'nobody' },
        { ...usdcOption, network: 'solana:mainnet' },
      ]),
    )
    expect(parsed?.accepts).toHaveLength(0)
  })
})

describe('choosing how Kova pays', () => {
  it('prefers AUSD, which needs no swap, over USDC', () => {
    const parsed = parsePaymentRequired(
      required([usdcOption, { ...usdcOption, asset: ausd.address, extra: undefined }]),
    ) as PaymentRequired
    const pick = payableRequirement(parsed, 'mainnet')
    expect(pick?.token.currency).toBe('AUSD')
    expect(pick?.amount).toBe(100000n)
  })

  it('pays USDC when that’s all the site takes', () => {
    const pick = payableRequirement(
      parsePaymentRequired(required([usdcOption])) as PaymentRequired,
      'mainnet',
    )
    expect(pick?.token.currency).toBe('USDC')
  })

  it('pays nothing on another chain or in an unknown token', () => {
    const parsed = parsePaymentRequired(
      required([
        { ...usdcOption, network: 'eip155:8453' },
        { ...usdcOption, asset: payTo },
      ]),
    ) as PaymentRequired
    expect(payableRequirement(parsed, 'mainnet')).toBeNull()
    expect(
      payableRequirement(
        parsePaymentRequired(required([usdcOption])) as PaymentRequired,
        'testnet',
      ),
    ).toBeNull()
  })
})

describe('the PAYMENT-SIGNATURE header', () => {
  it('carries a signature the site can check, and echoes what it accepted', async () => {
    const payer = privateKeyToAccount(generatePrivateKey())
    const pick = payableRequirement(
      parsePaymentRequired(required([usdcOption])) as PaymentRequired,
      'mainnet',
    )
    if (!pick) throw new Error('no pick')
    const authorization = {
      from: payer.address,
      to: pick.requirement.payTo,
      value: pick.amount,
      validAfter: 0n,
      validBefore: BigInt(Math.floor(Date.now() / 1000) + 300),
      nonce: randomNonce(),
    }
    const signature = await payer.signTypedData(
      transferAuthorizationTypedData(pick.token, 143, authorization),
    )
    const header = paymentSignatureHeader({
      requirement: pick.requirement,
      authorization,
      signature,
    })
    const read = readPaymentSignature(header)
    expect(read?.accepted).toEqual(pick.requirement)
    expect(read?.authorization).toEqual(authorization)
    const signer = await recoverTypedDataAddress({
      ...transferAuthorizationTypedData(usdc, 143, read?.authorization ?? authorization),
      signature: read?.signature ?? '0x',
    })
    expect(signer).toBe(payer.address)
  })
})

describe('naming and freezing a site’s key', () => {
  it('names a site by its host', () => {
    expect(siteName('https://Lumen.News/economics?x=1')).toBe('lumen.news')
    expect(siteName('http://localhost:3014/x')).toBe('localhost:3014')
    expect(siteName('chrome://settings')).toBeNull()
    expect(siteName('not a url')).toBeNull()
  })

  it('freezes with a message that says which key and when', () => {
    expect(keySelfFreezeMessage({ keyId: 'k1', at: 1700000000 })).toBe(
      'Kova: freeze this key\nKey: k1\nAt: 1700000000',
    )
  })
})
