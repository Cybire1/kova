import { createSecp256k1SigningSession, type Secp256k1SigningSession } from '@category-labs/mera'
import { toViemAccount } from '@category-labs/mera/viem'
import { HDKey } from '@scure/bip32'
import { entropyToMnemonic, mnemonicToSeed } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import type { LocalAccount } from 'viem'

/**
 * Mera's derivation, exactly as its docs give it, so the same passkey opens the same Monad account
 * in any Mera app: the 32-byte PRF output is BIP-39 entropy, and the wallet is the first Ethereum
 * account of that seed (m/44'/60'/0'/0/0). Nothing here is ever stored: the key lives in a
 * signing session, in memory, and is zeroed when the session ends.
 */
export async function openSigningSession(
  prfOutput: Uint8Array,
): Promise<{ session: Secp256k1SigningSession; account: LocalAccount }> {
  if (prfOutput.length !== 32) throw new Error('This passkey didn’t give Kova a key. Try again.')
  const seed = await mnemonicToSeed(entropyToMnemonic(prfOutput, wordlist))
  const node = HDKey.fromMasterSeed(seed).derive("m/44'/60'/0'/0/0")
  seed.fill(0)
  if (!node.privateKey) throw new Error('This passkey didn’t give Kova a key. Try again.')
  const session = createSecp256k1SigningSession({ privateKey: node.privateKey })
  node.wipePrivateData()
  return { session, account: toViemAccount(session) }
}
