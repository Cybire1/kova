import { NOTE_MAX, noteContext, noteKeyMessage, type SealedNote } from '@kova/monad'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { x25519 } from '@noble/curves/ed25519'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { base64urlnopad } from '@scure/base'
import {
  type Address,
  bytesToString,
  type Hex,
  isAddressEqual,
  recoverMessageAddress,
  stringToBytes,
} from 'viem'
import type { LocalAccount } from 'viem/accounts'

/**
 * Private payment notes, with no React Native in it so it runs the same in Node (and matches the
 * web's lib/notes.ts byte for byte; scripts/notes-check.ts in the web app proves it).
 *
 * The note key comes from the passkey's vault secret, so the same passkey opens the same notes in
 * the app and on the web, and it needs no Face ID to read (it can't move money). A note is sealed
 * under a fresh X25519 key, once for the receiver and once for the sender, with the transfer as
 * associated data: Kova stores it and can read none of it.
 */
export type Transfer = Parameters<typeof noteContext>[0]

const b64 = base64urlnopad

export function noteKeys(vaultSecret: Uint8Array) {
  const secretKey = hkdf(sha256, vaultSecret, undefined, stringToBytes('kova.note.x25519.v1'), 32)
  return { secretKey, publicKey: b64.encode(x25519.getPublicKey(secretKey)) }
}

function box(shared: Uint8Array, ephemeral: Uint8Array, nonce: Uint8Array, context: string) {
  const key = hkdf(sha256, shared, ephemeral, stringToBytes('kova.note.v1'), 32)
  return xchacha20poly1305(key, nonce, stringToBytes(context))
}

/** Seals `text` for the receiver (when they have a note key) and for the sender. */
export function sealNote(
  text: string,
  transfer: Transfer,
  keys: { theirs: string | null; mine: string },
): SealedNote {
  const note = text.trim().slice(0, NOTE_MAX)
  const context = noteContext(transfer)
  const ephemeralSecret = crypto.getRandomValues(new Uint8Array(32))
  const ephemeral = x25519.getPublicKey(ephemeralSecret)
  const nonce = crypto.getRandomValues(new Uint8Array(24))
  const seal = (publicKey: string) =>
    b64.encode(
      box(
        x25519.getSharedSecret(ephemeralSecret, b64.decode(publicKey)),
        ephemeral,
        nonce,
        context,
      ).encrypt(stringToBytes(note)),
    )
  const sealed: SealedNote = {
    v: 1,
    e: b64.encode(ephemeral),
    n: b64.encode(nonce),
    to: keys.theirs ? seal(keys.theirs) : '',
    from: seal(keys.mine),
  }
  ephemeralSecret.fill(0)
  return sealed
}

/** Opens a note with this wallet's note key, as its receiver or its sender. Null if it can't. */
export function openNote(
  sealed: SealedNote,
  transfer: Transfer,
  secretKey: Uint8Array,
): string | null {
  const ephemeral = b64.decode(sealed.e)
  const nonce = b64.decode(sealed.n)
  const shared = x25519.getSharedSecret(secretKey, ephemeral)
  for (const side of [sealed.to, sealed.from]) {
    if (!side) continue
    try {
      return bytesToString(
        box(shared, ephemeral, nonce, noteContext(transfer)).decrypt(b64.decode(side)),
      )
    } catch {
      // Not this side's box.
    }
  }
  return null
}

/** Publishes this wallet's note key, signed by the wallet, unless Kova already has it. */
export async function publishNoteKey(
  apiUrl: string,
  account: LocalAccount,
  vaultSecret: Uint8Array,
): Promise<string> {
  const { publicKey } = noteKeys(vaultSecret)
  const current = await fetchNoteKey(apiUrl, account.address)
  if (current === publicKey) return publicKey
  const signature = await account.signMessage({
    message: noteKeyMessage(account.address, publicKey),
  })
  const response = await fetch(`${apiUrl}/v1/wallets/${account.address}/note-key`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ public_key: publicKey, signature }),
  })
  if (!response.ok) throw new Error(`Publishing the note key failed (${response.status}).`)
  return publicKey
}

/**
 * Someone's note key, checked against their own signature, so Kova can't swap in a key of its
 * own. Null when they haven't published one (or what Kova returned isn't theirs).
 */
export async function fetchNoteKey(apiUrl: string, address: Address): Promise<string | null> {
  const response = await fetch(`${apiUrl}/v1/wallets/${address}/note-key`)
  if (!response.ok) return null
  const key = (await response.json()) as { public_key?: string; signature?: Hex }
  if (!key.public_key || !key.signature) return null
  const signer = await recoverMessageAddress({
    message: noteKeyMessage(address, key.public_key),
    signature: key.signature,
  }).catch(() => null)
  return signer && isAddressEqual(signer, address) ? key.public_key : null
}
