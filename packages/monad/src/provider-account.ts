import {
  type Address,
  createWalletClient,
  custom,
  getAddress,
  type Hash,
  hexToBytes,
  isAddressEqual,
  keccak256,
  type LocalAccount,
  recoverMessageAddress,
  recoverTypedDataAddress,
} from 'viem'
import { toAccount } from 'viem/accounts'
import { getNetwork, type NetworkId } from './networks.js'

type NativeTransfer = { to: Address; value: bigint; gas: bigint; gasPrice: bigint }
const nativeSenders = new WeakMap<object, (transaction: NativeTransfer) => Promise<Hash>>()

/** Explicit MON conversions use a native transfer; ordinary payments keep their gasless path. */
export function providerNativeTransfer(
  account: LocalAccount,
  transaction: NativeTransfer,
): Promise<Hash> | null {
  return nativeSenders.get(account)?.(transaction) ?? null
}

/** A user-owned embedded wallet. Kova never receives its private key. */
export interface WalletProviderRpc {
  request(args: { method: string; params?: unknown }): Promise<unknown>
}

/** Gives the existing payment code a signing account, with an explicit session lifetime. */
export function providerSigningSession(
  address: Address,
  provider: WalletProviderRpc,
  network: NetworkId,
): { session: { end(): void }; account: LocalAccount } {
  let active = true
  const expected = getAddress(address)
  const chain = getNetwork(network)
  const client = createWalletClient({
    account: expected,
    chain: chain.chain,
    transport: custom(provider, { retryCount: 0 }),
  })
  const check = () => {
    if (!active) throw new Error('Your wallet is locked. Open it again to approve this action.')
  }
  const account = toAccount({
    address: expected,
    async signMessage(parameters) {
      check()
      const signature = await client.signMessage(parameters)
      check()
      if (!isAddressEqual(await recoverMessageAddress({ ...parameters, signature }), expected))
        throw new Error(
          'Google opened a different wallet. Sign in with the original Google account.',
        )
      return signature
    },
    async signTypedData(parameters) {
      check()
      const domain = parameters.domain as { chainId?: number | bigint } | undefined
      if (domain?.chainId !== undefined && BigInt(domain.chainId) !== BigInt(chain.chainId))
        throw new Error('This payment belongs to a different network.')
      const signature = await client.signTypedData(parameters as never)
      check()
      const signer = await recoverTypedDataAddress({ ...parameters, signature } as never)
      if (!isAddressEqual(signer, expected))
        throw new Error(
          'Google opened a different wallet. Sign in with the original Google account.',
        )
      return signature
    },
    async signTransaction() {
      throw new Error('Kova submits your signed payments and pays the gas.')
    },
  })
  nativeSenders.set(account, async (transaction) => {
    check()
    if (chain.chainId !== 143) throw new Error('MON conversion requires Monad mainnet.')
    const accounts = await client.getAddresses()
    if (!accounts.some((address) => isAddressEqual(address, expected)))
      throw new Error('Google opened a different wallet. Sign in with the original Google account.')
    if ((await client.getChainId()) !== 143) await client.switchChain({ id: 143 })
    check()
    // The returned hash is kept even if the session ends while broadcasting: the transfer may
    // already be on-chain and must remain trackable rather than looking safe to retry.
    return client.sendTransaction(transaction)
  })
  return {
    session: {
      end: () => {
        active = false
      },
    },
    account,
  }
}

/**
 * Separate from payment and stealth signatures. Like Kova's existing private-receiving keys,
 * this requires deterministic ECDSA signatures. The signature stays on the device and is never
 * sent to Kova. The second evaluation refuses a signer that cannot reproduce the secret.
 */
export async function providerVaultSecret(account: LocalAccount): Promise<Uint8Array> {
  const message = `Kova encrypted wallet details v1\nWallet ${account.address.toLowerCase()}\n\nThis signature unlocks your encrypted details. Keep it private.`
  const first = await account.signMessage({ message })
  const second = await account.signMessage({ message })
  if (first !== second)
    throw new Error('This wallet cannot restore encrypted details consistently.')
  return hexToBytes(keccak256(first))
}
