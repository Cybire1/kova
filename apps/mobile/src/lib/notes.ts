import type { SealedNote } from '@kova/monad'
import type { Address, Hex, LocalAccount } from 'viem'
import { apiUrl } from './config'
import { fetchNoteKey, noteKeys, openNote, publishNoteKey } from './notes-core'
import { load, save } from './storage'
import { readVaultSecret } from './vault'

/**
 * Private notes on this phone: the note key comes from the vault secret (kept in the Keychain
 * without a biometric lock, since it can't move money), so notes open without Face ID.
 */
const PUBLISHED = 'kova.monad.notekey.published.v1'

/** This wallet's note key pair, or null before the passkey has handed over a vault secret. */
export async function myNoteKeys() {
  const secret = await readVaultSecret()
  return secret ? noteKeys(secret) : null
}

/** Makes sure Kova has this wallet's note key, so people can send it private notes. Once per key. */
export async function ensureNoteKey(account: LocalAccount): Promise<void> {
  const secret = await readVaultSecret()
  if (!secret) return
  // Per API too: a wallet pointed at another Kova (a new database, a local one) publishes there as well.
  const mark = `${apiUrl}|${account.address}:${noteKeys(secret).publicKey}`
  if ((await load<string | null>(PUBLISHED, null)) === mark) return
  await publishNoteKey(apiUrl, account, secret)
  await save(PUBLISHED, mark)
}

/** Their note key, checked against their signature; null if they can't read private notes yet. */
export const theirNoteKey = (address: Address) => fetchNoteKey(apiUrl, address).catch(() => null)

/** Opens a note that came with a transfer to (or from) this wallet. */
export async function readNote(
  note: { sealed: SealedNote; auth_nonce: Hex },
  transfer: { from: Address; to: Address; value: bigint },
): Promise<string | null> {
  const keys = await myNoteKeys()
  if (!keys) return null
  try {
    return openNote(note.sealed, { ...transfer, nonce: note.auth_nonce }, keys.secretKey)
  } catch {
    return null
  }
}
