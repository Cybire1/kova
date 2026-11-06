import { ed25519 } from '@noble/curves/ed25519'
import { sha256 } from '@noble/hashes/sha2'
import {
  type Address,
  encodeAbiParameters,
  getAddress,
  type Hex,
  isAddress,
  isAddressEqual,
  keccak256,
  pad,
  toHex,
} from 'viem'
import { base58Decode, type Family } from './crosschain-core'

/**
 * Kova's own check of what Setsuna's SDK asks the wallet to sign, before Face ID. The SDK builds an
 * EIP-3009 `ReceiveWithAuthorization` for AUSD whose nonce commits to every detail of the bridge
 * (destination, recipient, fee ceiling, forwarding, swap minimum). Here each of those is rebuilt
 * from what the person chose, with Kova's own constants, and the nonce recomputed: if anything
 * differs (a changed recipient, a bigger fee, another spender), nothing is signed.
 */

/** SetsunaBridgeSponsor on Monad mainnet: the only contract the signature lets take the AUSD. */
export const SETSUNA_SPONSOR: Address = '0xeabF1Aa629a686C9E5862b316F954bF2C0b68DBe'
export const MONAD_CHAIN_ID = 143

const TYPEHASH = keccak256(
  toHex(
    'SetsunaBridge(address sponsor,uint256 chainId,address token,uint32 destinationDomain,bytes32 mintRecipient,uint256 maxFee,uint32 minFinalityThreshold,bool forward,uint256 minUsdcOut,bytes32 salt)',
  ),
)

const SOLANA_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const SPL_TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const ASSOCIATED_TOKEN = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'

const b58 = (text: string) => {
  const bytes = base58Decode(text)
  if (!bytes) throw new Error(`${text} isn’t base58`)
  return bytes
}

/**
 * A Solana wallet's USDC account: where Circle mints on Solana, not the wallet itself. It's the
 * program address derived from the wallet, the token program and USDC's mint, the first bump down
 * from 255 whose hash is off the ed25519 curve.
 */
export function solanaUsdcAccount(wallet: string): Hex {
  const owner = b58(wallet)
  if (owner.length !== 32) throw new Error('Not a Solana address')
  const seeds = [...owner, ...b58(SPL_TOKEN), ...b58(SOLANA_USDC)]
  const tail = [...b58(ASSOCIATED_TOKEN), ...new TextEncoder().encode('ProgramDerivedAddress')]
  for (let bump = 255; bump >= 0; bump--) {
    const hash = sha256(new Uint8Array([...seeds, bump, ...tail]))
    try {
      ed25519.ExtendedPoint.fromHex(hash)
    } catch {
      return toHex(hash)
    }
  }
  throw new Error('No USDC account for this Solana wallet')
}

/** The 32 bytes Circle mints to, for `recipient` on a network of `family`. */
export function expectedMintRecipient(family: Family, recipient: string): Hex {
  if (family === 'evm') {
    if (!isAddress(recipient)) throw new Error('Not an EVM address')
    return pad(getAddress(recipient).toLowerCase() as Hex)
  }
  if (family === 'solana') return solanaUsdcAccount(recipient)
  throw new Error('Kova doesn’t send to Sui or Aptos yet')
}

export type SponsoredTransfer = {
  owner: string
  value: string
  validAfter: string
  validBefore: string
  salt: string
  destinationDomain: number
  mintRecipient: string
  maxFee: string
  minFinalityThreshold: number
  forward: boolean
  minUsdcOut: string
}

export type SponsoredRequest = {
  token: string
  transfer: SponsoredTransfer
  typedData: {
    domain: {
      name?: string
      version?: string
      chainId?: number | bigint
      verifyingContract?: string
    }
    types: Record<string, readonly { name: string; type: string }[]>
    primaryType: string
    message: Record<string, unknown>
  }
}

export type Expected = {
  /** AUSD on Monad, from Kova's own token list. */
  ausd: Address
  owner: Address
  amount: bigint
  domain: number
  family: Family
  recipient: string
  /** The most the fee may be: what the person was shown. */
  maxFee: bigint
  /** Seconds since 1970, for the expiry check. */
  now: number
}

const RECEIVE_FIELDS = [
  ['from', 'address'],
  ['to', 'address'],
  ['value', 'uint256'],
  ['validAfter', 'uint256'],
  ['validBefore', 'uint256'],
  ['nonce', 'bytes32'],
]

/** The nonce SetsunaBridgeSponsor recomputes on Monad. */
export function bridgeNonce(ausd: Address, t: SponsoredTransfer): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'uint32' },
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'uint32' },
        { type: 'bool' },
        { type: 'uint256' },
        { type: 'bytes32' },
      ],
      [
        TYPEHASH,
        SETSUNA_SPONSOR,
        BigInt(MONAD_CHAIN_ID),
        ausd,
        t.destinationDomain,
        t.mintRecipient as Hex,
        BigInt(t.maxFee),
        t.minFinalityThreshold,
        t.forward,
        BigInt(t.minUsdcOut),
        t.salt as Hex,
      ],
    ),
  )
}

/**
 * Throws, naming what's wrong, unless the request is exactly the bridge the person approved. The
 * message never reaches the person as is: the sender turns any failure into one plain sentence.
 */
export function checkSponsored(request: SponsoredRequest, want: Expected): void {
  const fail = (what: string): never => {
    throw new Error(what)
  }
  const { typedData: td, transfer: t } = request
  const m = td.message

  if (request.token !== 'AUSD') fail('token')
  if (td.primaryType !== 'ReceiveWithAuthorization') fail('primaryType')
  const fields = td.types.ReceiveWithAuthorization ?? []
  if (
    fields.length !== RECEIVE_FIELDS.length ||
    fields.some((f, i) => f.name !== RECEIVE_FIELDS[i]?.[0] || f.type !== RECEIVE_FIELDS[i]?.[1])
  )
    fail('types')
  if (Object.keys(td.types).some((k) => k !== 'ReceiveWithAuthorization' && k !== 'EIP712Domain'))
    fail('extra types')
  const d = td.domain
  if (d.name !== 'Agora Dollar' || d.version !== '1') fail('domain name')
  if (Number(d.chainId) !== MONAD_CHAIN_ID) fail('domain chain')
  if (!d.verifyingContract || !isAddressEqual(d.verifyingContract as Address, want.ausd))
    fail('domain token')

  if (typeof m.from !== 'string' || !isAddressEqual(m.from as Address, want.owner)) fail('from')
  if (typeof m.to !== 'string' || !isAddressEqual(m.to as Address, SETSUNA_SPONSOR)) fail('to')
  if (BigInt(m.value as bigint) !== want.amount) fail('value')
  if (BigInt(m.validAfter as bigint) !== 0n) fail('validAfter')
  const before = BigInt(m.validBefore as bigint)
  if (before <= BigInt(want.now) || before > BigInt(want.now + 15 * 60)) fail('validBefore')

  if (!isAddressEqual(t.owner as Address, want.owner)) fail('transfer owner')
  if (BigInt(t.value) !== want.amount) fail('transfer value')
  if (BigInt(t.validBefore) !== before || BigInt(t.validAfter) !== 0n) fail('transfer window')
  if (t.destinationDomain !== want.domain) fail('destination')
  if (t.minFinalityThreshold !== 2000) fail('finality')
  if (t.forward !== true) fail('forward')
  if (BigInt(t.maxFee) > want.maxFee) fail('fee')
  if (BigInt(t.minUsdcOut) < (want.amount * 998n) / 1000n) fail('swap minimum')
  if (!/^0x[0-9a-fA-F]{64}$/.test(t.salt)) fail('salt')
  if (t.mintRecipient.toLowerCase() !== expectedMintRecipient(want.family, want.recipient))
    fail('recipient')

  if (String(m.nonce).toLowerCase() !== bridgeNonce(want.ausd, t)) fail('nonce')
}
