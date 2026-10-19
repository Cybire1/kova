import {
  getNetwork,
  getToken,
  type NetworkId,
  randomNonce,
  type SignedAuthorization,
  type StealthKeys,
  stealthKeysFromSignature,
  stealthKeysMessage,
  stealthPrivateKey,
  toSignedAuthorization,
  transferAuthorizationTypedData,
} from '@kova/monad'
import { getAddress, type Hex, isAddressEqual } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { PrivateSale } from '@/lib/api'
import { openWalletSigner, type WalletIdentity } from './signer'
import { balanceOf } from './chain'
import { sessionAccount } from './session'

/**
 * A shop's private takings keys, and moving its sales home, in the owner's browser.
 *
 * The owner's Kova wallet signs stealthKeysMessage(shop) and the signature becomes that shop's two keys.
 * Signatures are deterministic, so the same wallet makes the same keys here and in the app, with
 * nothing stored: the keys live in this page's memory and nowhere else. Kova only ever sees the
 * public meta-address and the transfers the keys sign.
 */

/** The wallet this browser remembers: who it is and which passkey opens it. Nothing secret. */
export type WebWallet = WalletIdentity

export function rememberedWallet(): WebWallet | null {
  try {
    const raw = localStorage.getItem('kova.web.profile.v1')
    return raw ? (JSON.parse(raw) as WebWallet) : null
  } catch {
    return null
  }
}

/**
 * The shop's keys, from the owner's passkey. A wallet session opened a moment ago signs without
 * asking again, as it does for any message; otherwise Face ID opens the wallet for this one signature.
 */
export async function takingsKeys(owner: WebWallet, shop: string): Promise<StealthKeys> {
  const message = stealthKeysMessage(shop)
  const open = sessionAccount(0n)
  if (open && isAddressEqual(open.address, getAddress(owner.address)))
    return stealthKeysFromSignature(await open.signMessage({ message }))
  const { session, account } = await openWalletSigner(owner)
  try {
    if (!isAddressEqual(account.address, getAddress(owner.address)))
      throw new Error(
        'That passkey opens a different Kova wallet. Choose the one this shop belongs to.',
      )
    return stealthKeysFromSignature(await account.signMessage({ message }))
  } finally {
    session.end()
  }
}

/** What a move needs from a private payment: the one-time address, and the key that opens it. */
type Openable = Pick<PrivateSale, 'stealth_address' | 'ephemeral_public_key'>

/** A move ready for Kova to submit: everything one sale's address holds, signed by that address. */
export interface SignedMove<T extends Openable = PrivateSale> {
  sale: T
  amount: bigint
  authorization: SignedAuthorization
}

/** Runs `task` over `items`, a few at a time, so a long list doesn't flood Monad's public RPC. */
export async function inTurns<T, R>(
  items: T[],
  task: (item: T) => Promise<R>,
  width = 6,
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await task(items[i] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker))
  return out
}

/**
 * Signs, for each sale, a transfer of everything its one-time address holds to `to`, with that
 * address's own key: the spending key plus the sale's shared secret. Kova only takes a move of all
 * of it, and the approval lasts ten minutes. Addresses Monad says are empty already are left out.
 * A person's private payments (lib/wallet/private.ts) move into their wallet the same way.
 */
export async function signMoves<T extends Openable>(
  keys: StealthKeys,
  sales: T[],
  to: string,
  network: NetworkId,
): Promise<{ moves: SignedMove<T>[]; empty: T[] }> {
  const token = getToken(network, 'AUSD')
  const { chainId } = getNetwork(network)
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 600)
  const held = await inTurns(sales, (sale) => balanceOf(network, getAddress(sale.stealth_address)))
  const moves: SignedMove<T>[] = []
  const empty: T[] = []
  for (const [i, sale] of sales.entries()) {
    const account = privateKeyToAccount(stealthPrivateKey(keys, sale.ephemeral_public_key as Hex))
    if (!isAddressEqual(account.address, getAddress(sale.stealth_address)))
      throw new Error('Your keys don’t open one of these sales. Nothing moved.')
    const value = held[i] ?? 0n
    if (value === 0n) {
      empty.push(sale)
      continue
    }
    const authorization = {
      from: account.address,
      to: getAddress(to),
      value,
      validAfter: 0n,
      validBefore,
      nonce: randomNonce(),
    }
    const signature = await account.signTypedData(
      transferAuthorizationTypedData(token, chainId, authorization),
    )
    moves.push({
      sale,
      amount: value,
      authorization: toSignedAuthorization(token.address, authorization, signature),
    })
  }
  return { moves, empty }
}
