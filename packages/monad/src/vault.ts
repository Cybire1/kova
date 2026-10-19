import { type Address, sha256, stringToBytes } from 'viem'

/**
 * What a wallet vault's own signing key signs to replace its backup. Binding the vault id, the
 * exact sealed bytes and the time means a signature can't be moved to another vault, reused for
 * other contents, or replayed over a newer backup.
 */
export function vaultMessage(
  id: Address,
  ciphertext: string,
  nonce: string,
  signedAt: number,
): string {
  return `Kova vault ${id.toLowerCase()}\n${sha256(stringToBytes(`${ciphertext}.${nonce}`))}\n${signedAt}`
}
