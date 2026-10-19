import { type Address, type Hex, recoverMessageAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it, vi } from 'vitest'
import { transferAuthorizationTypedData } from '../src/authorization.js'
import {
  providerSigningSession,
  providerVaultSecret,
  type WalletProviderRpc,
} from '../src/provider-account.js'
import { getToken } from '../src/tokens.js'

const alice = privateKeyToAccount(generatePrivateKey())
const bob = privateKeyToAccount(generatePrivateKey())
const typedData = {
  domain: { name: 'Kova', version: '1', chainId: 143 },
  types: {
    Payment: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
  },
  primaryType: 'Payment',
  message: { to: bob.address, value: 1_000_000n },
} as const

function provider(signer = alice, before?: () => Promise<void>): WalletProviderRpc {
  return {
    async request({ method, params }) {
      await before?.()
      const values = params as unknown[]
      if (method === 'personal_sign')
        return signer.signMessage({ message: { raw: values[0] as Hex } })
      if (method === 'eth_signTypedData_v4')
        return signer.signTypedData(JSON.parse(values[1] as string))
      throw new Error(`Unexpected RPC: ${method}`)
    },
  }
}

describe('Google wallet signing account', () => {
  it('produces verifiable wallet signatures without exporting a private key', async () => {
    const { account } = providerSigningSession(alice.address, provider(), 'mainnet')
    const signature = await account.signMessage({ message: 'Sign in to Kova' })
    expect(await recoverMessageAddress({ message: 'Sign in to Kova', signature })).toBe(
      alice.address,
    )
    expect(await account.signTypedData(typedData)).toBe(await alice.signTypedData(typedData))
  })

  it('rejects a provider that signs with another Google wallet', async () => {
    const { account } = providerSigningSession(alice.address, provider(bob), 'mainnet')
    await expect(account.signMessage({ message: 'Kova' })).rejects.toThrow('different wallet')
    await expect(account.signTypedData(typedData)).rejects.toThrow('different wallet')
  })

  it('signs Kova’s actual mainnet AUSD payment authorization', async () => {
    const { account } = providerSigningSession(alice.address, provider(), 'mainnet')
    const authorization = transferAuthorizationTypedData(getToken('mainnet', 'AUSD'), 143, {
      from: alice.address,
      to: bob.address,
      value: 5_000_000n,
      validAfter: 0n,
      validBefore: 2_000_000_000n,
      nonce: `0x${'12'.repeat(32)}`,
    })
    expect(await account.signTypedData(authorization)).toBe(
      await alice.signTypedData(authorization),
    )
  })

  it('does not automatically retry a failed or cancelled signing request', async () => {
    const request = vi.fn().mockRejectedValue(new Error('User cancelled signing'))
    const { account } = providerSigningSession(alice.address, { request }, 'mainnet')
    await expect(account.signMessage({ message: 'Kova' })).rejects.toThrow('cancelled')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('refuses authorizations for a different network', async () => {
    const { account } = providerSigningSession(alice.address, provider(), 'testnet')
    await expect(account.signTypedData(typedData)).rejects.toThrow('different network')
  })

  it('locks both message and payment signing when the session ends', async () => {
    const { account, session } = providerSigningSession(alice.address, provider(), 'mainnet')
    session.end()
    await expect(account.signMessage({ message: 'Kova' })).rejects.toThrow('locked')
    await expect(account.signTypedData(typedData)).rejects.toThrow('locked')
  })

  it('discards a signature that finishes after the wallet was locked', async () => {
    let resume!: () => void
    const waiting = new Promise<void>((resolve) => {
      resume = resolve
    })
    const { account, session } = providerSigningSession(
      alice.address,
      provider(alice, () => waiting),
      'mainnet',
    )
    const signature = account.signMessage({ message: 'Kova' })
    session.end()
    resume()
    await expect(signature).rejects.toThrow('locked')
  })

  it('restores the same encrypted vault on another device using the same wallet', async () => {
    const first = providerSigningSession(alice.address, provider(), 'mainnet')
    const nextDevice = providerSigningSession(alice.address, provider(), 'mainnet')
    const other = providerSigningSession(bob.address, provider(bob), 'mainnet')
    const secret = await providerVaultSecret(first.account)
    expect(secret).toHaveLength(32)
    expect(await providerVaultSecret(nextDevice.account)).toEqual(secret)
    expect(await providerVaultSecret(other.account)).not.toEqual(secret)
  })

  it('does not let the provider broadcast transactions outside Kova’s relayer', async () => {
    const { account } = providerSigningSession(alice.address, provider(), 'mainnet')
    await expect(
      account.signTransaction({ to: bob.address as Address, value: 0n, chainId: 143 }),
    ).rejects.toThrow('pays the gas')
  })
})
