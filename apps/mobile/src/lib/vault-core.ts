import { vaultMessage } from '@kova/monad'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { base64urlnopad } from '@scure/base'
import { bytesToHex, bytesToString, hexToBytes, stringToBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { apiUrl } from './config'

/**
 * The wallet vault's cryptography, with no React Native in it so it runs the same in Node.
 *
 * The vault secret comes from the wallet's passkey through its own PRF salt (passkey.ts). HKDF
 * turns it into an encryption key and a signing key; the signing key's address is the vault's id,
 * and only it can replace the backup. The sealed bytes are bound to that id.
 */
export interface VaultContents {
  v: 1
  name: string
  currency: string
  contacts: { address: string; name: string; currency?: string }[]
}

export function vaultKeys(secret: Uint8Array) {
  const encryptKey = hkdf(sha256, secret, undefined, stringToBytes('kova.vault.encrypt.v1'), 32)
  const signer = privateKeyToAccount(
    bytesToHex(hkdf(sha256, secret, undefined, stringToBytes('kova.vault.sign.v1'), 32)),
  )
  return { encryptKey, signer, id: signer.address }
}

const cipher = (keys: ReturnType<typeof vaultKeys>, nonce: Uint8Array) =>
  xchacha20poly1305(keys.encryptKey, nonce, hexToBytes(keys.id))

/** Seals `contents` with the vault key from `secret`, signs it, and hands it to Kova. */
export async function sealAndUpload(secret: Uint8Array, contents: VaultContents): Promise<void> {
  const keys = vaultKeys(secret)
  const nonce = crypto.getRandomValues(new Uint8Array(24))
  const ciphertext = base64urlnopad.encode(
    cipher(keys, nonce).encrypt(stringToBytes(JSON.stringify(contents))),
  )
  const nonceText = base64urlnopad.encode(nonce)
  const signedAt = Math.floor(Date.now() / 1000)
  const signature = await keys.signer.signMessage({
    message: vaultMessage(keys.id, ciphertext, nonceText, signedAt),
  })
  const response = await fetch(`${apiUrl}/v1/vaults/${keys.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ciphertext, nonce: nonceText, signed_at: signedAt, signature }),
  })
  // 409: a newer backup already landed, from this phone or another.
  if (!response.ok && response.status !== 409)
    throw new Error(`Backing up your contacts failed (${response.status}).`)
}

/** Opens the backup this passkey made, if it made one. */
export async function openVault(secret: Uint8Array): Promise<VaultContents | null> {
  const keys = vaultKeys(secret)
  const response = await fetch(`${apiUrl}/v1/vaults/${keys.id}`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Kova couldn’t fetch your backup (${response.status}).`)
  const sealed = (await response.json()) as { ciphertext: string; nonce: string }
  const plain = cipher(keys, base64urlnopad.decode(sealed.nonce)).decrypt(
    base64urlnopad.decode(sealed.ciphertext),
  )
  const contents = JSON.parse(bytesToString(plain)) as VaultContents
  return contents.v === 1 ? contents : null
}
