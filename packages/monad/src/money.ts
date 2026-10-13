import type { Address, Hex } from 'viem'
import type { Token } from './tokens.js'

/**
 * Money in, the dollar card and savings: the three parts of Kova that run through partners (a
 * bank-account partner, a card issuer, a savings vault). What the wallet signs for each lives here,
 * so the app, the web and the API agree on it to the byte.
 */

export type MoneyFeature = 'us_account' | 'dollar_card' | 'savings'

export const MONEY_FEATURES: readonly MoneyFeature[] = ['us_account', 'dollar_card', 'savings']

/** How long a signed request to Kova stays good, in seconds. */
export const MONEY_SIGNATURE_MAX_AGE = 300

/**
 * The message a wallet signs to act on its own account at Kova (ask for access, open its US
 * account, issue or freeze its card, see its card number). `detail` pins the exact change, so a
 * signature for one action can't be replayed as another.
 */
export function moneyActionMessage(wallet: Address, action: string, signedAt: number, detail = ''): string {
  return `Kova account\nWallet ${wallet.toLowerCase()}\nAction ${action}${detail ? `\n${detail}` : ''}\nSigned ${signedAt}`
}

/** EIP-3009 receiveWithAuthorization: like a transfer, but only `to` itself can carry it out. */
export const receiveAuthorizationTypes = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const

export interface ReceiveAuthorization {
  from: Address
  to: Address
  value: bigint
  validAfter: bigint
  validBefore: bigint
  nonce: Hex
}

/**
 * Moving dollars into savings: the wallet lets Kova's saver contract (`to`) receive `value` and put
 * it in the vault in the wallet's own name. Nobody else can carry this out, and the vault shares
 * can only go to the wallet that signed.
 */
export function receiveAuthorizationTypedData(token: Token, chainId: number, message: ReceiveAuthorization) {
  return {
    domain: { name: token.domain.name, version: token.domain.version, chainId, verifyingContract: token.address },
    types: receiveAuthorizationTypes,
    primaryType: 'ReceiveWithAuthorization' as const,
    message,
  }
}

export const permitTypes = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const

export interface VaultDomain {
  name: string
  version: string
  verifyingContract: Address
}

/**
 * Moving dollars out of savings: an EIP-2612 permit on the vault's shares for Kova's saver, which
 * redeems them straight back to the same wallet.
 */
export function vaultPermitTypedData(
  vault: VaultDomain,
  chainId: number,
  message: { owner: Address; spender: Address; value: bigint; nonce: bigint; deadline: bigint },
) {
  return {
    domain: { name: vault.name, version: vault.version, chainId, verifyingContract: vault.verifyingContract },
    types: permitTypes,
    primaryType: 'Permit' as const,
    message,
  }
}

/** KovaSaver (apps/card/contracts/src/KovaSaver.sol). */
export const kovaSaverAbi = [
  {
    type: 'function',
    name: 'save',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'shares', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [{ name: 'assets', type: 'uint256' }],
  },
] as const

/** The parts of an ERC-4626 vault (with EIP-2612 permit on its shares) that savings reads. */
export const erc4626Abi = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'asset', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'convertToAssets', stateMutability: 'view', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'convertToShares', stateMutability: 'view', inputs: [{ name: 'assets', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'nonces', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalAssets', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const
