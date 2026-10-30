import {
  encodeAbiParameters,
  encodePacked,
  getAddress,
  hashTypedData,
  keccak256,
  toHex,
} from 'viem'
import { describe, expect, it } from 'vitest'
import {
  repeatPlanTypedData,
  splitAmount,
  splitProblem,
  splitRulesTypedData,
} from '../src/programs.js'

const contract = getAddress('0x00000000000000000000000000000000000c0de1')
const owner = getAddress('0x5409000000000000000000000000000000005409')
const savings = getAddress('0x0000000000000000000000000000000000005a4e')
const partner = getAddress('0x0000000000000000000000000000000000009a47')

/** The digest the way KovaSplits computes it in Solidity. */
function contractRulesDigest(to: `0x${string}`[], bps: number[], nonce: bigint, deadline: bigint) {
  const domainSeparator = keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'address' },
      ],
      [
        keccak256(
          toHex(
            'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)',
          ),
        ),
        keccak256(toHex('Kova Splits')),
        keccak256(toHex('1')),
        143n,
        contract,
      ],
    ),
  )
  const structHash = keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'uint256' },
      ],
      [
        keccak256(
          toHex('Rules(address owner,address[] to,uint16[] bps,uint256 nonce,uint256 deadline)'),
        ),
        owner,
        keccak256(encodePacked(['address[]'], [to])),
        keccak256(encodePacked(['uint16[]'], [bps])),
        nonce,
        deadline,
      ],
    ),
  )
  return keccak256(
    encodePacked(['bytes2', 'bytes32', 'bytes32'], ['0x1901', domainSeparator, structHash]),
  )
}

describe('splits', () => {
  it('signs exactly what KovaSplits checks', () => {
    const to = [savings, partner]
    const bps = [1000, 500]
    const typed = splitRulesTypedData(143, contract, {
      owner,
      to,
      bps,
      nonce: 3n,
      deadline: 1_800_000_000n,
    })
    expect(hashTypedData(typed)).toBe(contractRulesDigest(to, bps, 3n, 1_800_000_000n))
  })

  it('splits $6.50 into 10% and 5%, the rest to the shop', () => {
    const { parts, kept } = splitAmount(6_500_000n, [{ bps: 1000 }, { bps: 500 }])
    expect(parts).toEqual([650_000n, 325_000n])
    expect(kept).toBe(5_525_000n)
  })

  it('says plainly what is wrong with a set of shares', () => {
    expect(
      splitProblem(
        [
          { to: savings, bps: 6000 },
          { to: partner, bps: 5000 },
        ],
        owner,
      ),
    ).toMatch(/more than everything/)
    expect(splitProblem([{ to: owner, bps: 1000 }], owner)).toMatch(/already goes to you/)
    expect(
      splitProblem(
        [
          { to: savings, bps: 1000 },
          { to: savings, bps: 500 },
        ],
        owner,
      ),
    ).toMatch(/one share/)
    expect(splitProblem([{ to: savings, bps: 1000 }], owner)).toBeNull()
  })
})

describe('repeat payments', () => {
  it('names the Plan fields the way KovaRepeat hashes them', () => {
    const typed = repeatPlanTypedData(143, contract, {
      payer: owner,
      payee: partner,
      amount: 50_000_000n,
      every: 604_800,
      start: 1_800_000_000,
      times: 10,
      nonce: 0n,
      deadline: 1_800_000_600n,
    })
    const typehash = keccak256(
      toHex(
        'Plan(address payer,address payee,uint96 amount,uint32 every,uint40 start,uint32 times,uint256 nonce,uint256 deadline)',
      ),
    )
    const fields = typed.types.Plan.map((f) => `${f.type} ${f.name}`).join(',')
    expect(keccak256(toHex(`Plan(${fields})`))).toBe(typehash)
  })
})
