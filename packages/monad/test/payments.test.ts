import {
  type Address,
  encodeAbiParameters,
  encodeEventTopics,
  type Hex,
  pad,
  type TransactionReceipt,
  verifyTypedData,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'
import {
  decodeAuthorizedTransfers,
  decodeMemo,
  decodeTokenTransfers,
  eip3009Abi,
  encodeMemo,
  formatAmount,
  getToken,
  parseAmount,
  parseSignedAuthorization,
  randomNonce,
  toSignedAuthorization,
  transferAuthorizationTypedData,
  transferWithAuthorizationArgs,
  verifyPayment,
} from '../src/index.js'

const ausd = getToken('testnet', 'AUSD')
const payer = privateKeyToAccount(generatePrivateKey())
const merchant = privateKeyToAccount(generatePrivateKey()).address
const memo = pad('0x4b4f5641010100000000000000000000' as Hex, { dir: 'right', size: 32 })

type ReceiptLog = TransactionReceipt['logs'][number]

function log(address: Address, topics: Hex[], data: Hex, logIndex: number): ReceiptLog {
  return {
    address,
    topics: topics as ReceiptLog['topics'],
    data,
    logIndex,
    blockHash: pad('0xb1', { size: 32 }),
    blockNumber: 1n,
    transactionHash: pad('0x7e', { size: 32 }),
    transactionIndex: 0,
    removed: false,
  }
}

const usedLog = (
  authorizer: Address,
  nonce: Hex,
  logIndex: number,
  token: Address = ausd.address,
) =>
  log(
    token,
    encodeEventTopics({
      abi: eip3009Abi,
      eventName: 'AuthorizationUsed',
      args: { authorizer, nonce },
    }) as Hex[],
    '0x',
    logIndex,
  )

const transferLog = (
  from: Address,
  to: Address,
  value: bigint,
  logIndex: number,
  token: Address = ausd.address,
) =>
  log(
    token,
    encodeEventTopics({ abi: eip3009Abi, eventName: 'Transfer', args: { from, to } }) as Hex[],
    encodeAbiParameters([{ type: 'uint256' }], [value]),
    logIndex,
  )

describe('transfer authorizations', () => {
  it('are signed against the token’s own EIP-712 domain and recover to the payer', async () => {
    const typed = transferAuthorizationTypedData(ausd, 10143, {
      from: payer.address,
      to: merchant,
      value: 12_500_000n,
      validAfter: 0n,
      validBefore: 1_900_000_000n,
      nonce: memo,
    })
    expect(typed.domain).toMatchObject({
      name: 'Agora Dollar',
      version: '1',
      chainId: 10143,
      verifyingContract: ausd.address,
    })
    const signature = await payer.signTypedData(typed)
    expect(await verifyTypedData({ ...typed, address: payer.address, signature })).toBe(true)
  })
})

describe('verifyPayment', () => {
  const expected = { token: ausd.address, payTo: merchant, amount: 12_500_000n, memo }

  it('pays a charge when the authorization carries its memo and moves the exact amount to the merchant', () => {
    const verdict = verifyPayment(
      {
        status: 'success',
        logs: [
          usedLog(payer.address, memo, 0),
          transferLog(payer.address, merchant, 12_500_000n, 1),
        ],
      },
      expected,
    )
    expect(verdict).toEqual({ status: 'paid', payer: payer.address })
  })

  it('never counts a lookalike transfer without the memo', () => {
    const other = pad('0x01', { size: 32 })
    const verdict = verifyPayment(
      {
        status: 'success',
        logs: [
          usedLog(payer.address, other, 0),
          transferLog(payer.address, merchant, 12_500_000n, 1),
        ],
      },
      expected,
    )
    expect(verdict.status).toBe('memo_mismatch')
  })

  it('refuses the right memo with the wrong amount or recipient', () => {
    expect(
      verifyPayment(
        {
          status: 'success',
          logs: [usedLog(payer.address, memo, 0), transferLog(payer.address, merchant, 1n, 1)],
        },
        expected,
      ).status,
    ).toBe('unmatched')
    expect(
      verifyPayment(
        {
          status: 'success',
          logs: [
            usedLog(payer.address, memo, 0),
            transferLog(payer.address, payer.address, 12_500_000n, 1),
          ],
        },
        expected,
      ).status,
    ).toBe('unmatched')
  })

  it('ignores the same events from another token', () => {
    const fake = '0x000000000000000000000000000000000000dEaD'
    const logs = [
      usedLog(payer.address, memo, 0, fake),
      transferLog(payer.address, merchant, 12_500_000n, 1, fake),
    ]
    expect(verifyPayment({ status: 'success', logs }, expected).status).toBe('unmatched')
  })

  it('reports a reverted transaction as failed', () => {
    expect(verifyPayment({ status: 'reverted', logs: [] }, expected).status).toBe('failed')
  })
})

describe('a batch from one payer', () => {
  it('pairs each authorization with its own transfer', () => {
    const second = encodeMemo({ kind: 'payment', id: '0192f3a4-0000-7000-8000-000000000002' })
    const logs = [
      usedLog(payer.address, second, 0),
      transferLog(payer.address, payer.address, 1n, 1),
      usedLog(payer.address, memo, 2),
      transferLog(payer.address, merchant, 12_500_000n, 3),
    ]
    const moves = decodeAuthorizedTransfers(logs, ausd.address)
    expect(moves.map((m) => [m.nonce, m.value, m.transferLogIndex])).toEqual([
      [second, 1n, 1],
      [memo, 12_500_000n, 3],
    ])
    expect(
      verifyPayment(
        { status: 'success', logs },
        { token: ausd.address, payTo: merchant, amount: 12_500_000n, memo },
      ).status,
    ).toBe('paid')
  })
})

describe('signatures on the wire', () => {
  it('round-trip through JSON and split into v, r, s for the contract', async () => {
    const authorization = {
      from: payer.address,
      to: merchant,
      value: 5_000_000n,
      validAfter: 0n,
      validBefore: 1_900_000_000n,
      nonce: randomNonce(),
    }
    const signature = await payer.signTypedData(
      transferAuthorizationTypedData(ausd, 10143, authorization),
    )
    const wire = JSON.parse(
      JSON.stringify(toSignedAuthorization(ausd.address, authorization, signature)),
    )
    const parsed = parseSignedAuthorization(wire)
    expect(parsed?.authorization).toEqual({
      ...authorization,
      nonce: authorization.nonce.toLowerCase(),
    })
    const args = transferWithAuthorizationArgs(parsed!.authorization, parsed!.signature)
    expect([27, 28]).toContain(args[6])
    expect(args[7]).toBe(signature.slice(0, 66))
  })

  it('refuses malformed input', () => {
    expect(parseSignedAuthorization({})).toBeNull()
    expect(parseSignedAuthorization({ token: ausd.address, from: 'nope' })).toBeNull()
  })

  it('never makes a random nonce that reads as a Kova memo', () => {
    for (let i = 0; i < 200; i++) expect(decodeMemo(randomNonce())).toBeNull()
  })
})

describe('memos and amounts', () => {
  it('encode and decode a charge id', () => {
    const id = '0192f3a4-5b6c-7d8e-9f00-112233445566'
    expect(decodeMemo(encodeMemo({ kind: 'refund', id }))).toEqual({ kind: 'refund', id })
  })

  it('parse strictly and format with cents', () => {
    expect(parseAmount('12.5')).toBe(12_500_000n)
    expect(formatAmount(12_500_000n)).toBe('12.50')
    expect(() => parseAmount('1e3')).toThrow()
    expect(() => parseAmount('01.00')).toThrow()
  })
})

describe('tokens', () => {
  it('lists AUSD first and Circle USDC beside it, each with its own signing domain', () => {
    expect(getToken('testnet').currency).toBe('AUSD')
    expect(getToken('testnet', 'USDC').domain).toEqual({ name: 'USDC', version: '2' })
    expect(getToken('mainnet', 'AUSD').domain).toEqual({ name: 'Agora Dollar', version: '1' })
  })
})

describe('reading transfers out of real receipts', () => {
  it('never mistakes an AuthorizationUsed log for a Transfer', () => {
    // The shape that stopped the watcher: an authorization, then the transfer it moved.
    const logs = [
      usedLog(payer.address, memo, 7),
      transferLog(payer.address, merchant, 12_500_000n, 8),
    ]
    const transfers = decodeTokenTransfers(logs, ausd.address)
    expect(transfers).toEqual([
      { from: payer.address, to: merchant, value: 12_500_000n, logIndex: 8, nonce: memo },
    ])
  })

  it('reads a plain transfer with no authorization', () => {
    const transfers = decodeTokenTransfers(
      [transferLog(merchant, payer.address, 1n, 0)],
      ausd.address,
    )
    expect(transfers).toEqual([
      { from: merchant, to: payer.address, value: 1n, logIndex: 0, nonce: null },
    ])
  })

  it('reads nothing from an authorization alone', () => {
    expect(decodeTokenTransfers([usedLog(payer.address, memo, 0)], ausd.address)).toEqual([])
  })
})
