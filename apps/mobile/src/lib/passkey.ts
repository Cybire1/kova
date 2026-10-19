import type { WebAuthnClient } from '@category-labs/mera'
import { sha256 } from '@noble/hashes/sha2.js'
import { base64urlnopad } from '@scure/base'
import * as Passkeys from 'react-native-passkeys'
import { stringToBytes } from 'viem'

/**
 * Mera's WebAuthn client for Kova Pay, on the platform passkey API (iCloud Keychain on iOS 18,
 * Google Password Manager on Android).
 *
 * One passkey, two keys, one Face ID: every ceremony evaluates two PRF salts. Mera asks for the
 * first (its fixed wallet salt), which becomes the Monad account. The second is Kova's own salt,
 * a separate key for the things only you should read (your contacts, the names you give people),
 * so they can be backed up encrypted and come back with the wallet on a new phone.
 */

/** Kova's second salt. A different salt gives an unrelated key, so this never reveals the wallet. */
export const VAULT_SALT = sha256(stringToBytes('kova.vault.prf.v1'))

let vaultOutput: Uint8Array | null = null

/** The vault key from the last ceremony, handed over once and forgotten. */
export function takeVaultOutput(): Uint8Array | null {
  const out = vaultOutput
  vaultOutput = null
  return out
}

const encode = (bytes: Uint8Array) => base64urlnopad.encode(bytes)
const decode = (text: string) =>
  base64urlnopad.decode(text.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''))

function keepVault(second: string | undefined) {
  vaultOutput = second ? decode(second) : null
}

export const passkeysSupported = () => {
  try {
    return Passkeys.isSupported()
  } catch {
    return false
  }
}

export const kovaWebAuthnClient: WebAuthnClient = {
  async createCredential(request) {
    const created = await Passkeys.create({
      rp: { id: request.rp.id, name: request.rp.name },
      user: {
        id: encode(request.user.id),
        name: request.user.name,
        displayName: request.user.displayName,
      },
      challenge: encode(request.challenge),
      pubKeyCredParams: request.algorithms.map((alg) => ({ type: 'public-key' as const, alg })),
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: request.residentKey,
        requireResidentKey: true,
        userVerification: request.userVerification,
      },
      attestation: request.attestation,
      extensions: { prf: { eval: { first: encode(request.prfSalt), second: encode(VAULT_SALT) } } },
      ...(request.timeout !== undefined ? { timeout: request.timeout } : {}),
    })
    if (!created) throw new Error('Creating the passkey was cancelled.')
    const prf = created.clientExtensionResults?.prf
    keepVault(prf?.results?.second)
    const transports = created.response.transports
    return {
      credentialId: decode(created.rawId),
      ...(transports ? { transports } : {}),
      prfEnabled: prf?.enabled === true || Boolean(prf?.results?.first),
      ...(prf?.results?.first ? { prfOutput: decode(prf.results.first) } : {}),
    }
  },

  async getCredential(request) {
    const asserted = await Passkeys.get({
      rpId: request.rpId,
      challenge: encode(request.challenge),
      userVerification: request.userVerification,
      ...(request.allowCredential
        ? {
            allowCredentials: [
              {
                type: 'public-key' as const,
                id: encode(request.allowCredential.credentialId),
                ...(request.allowCredential.transports
                  ? {
                      transports: [
                        ...request.allowCredential.transports,
                      ] as AuthenticatorTransport[],
                    }
                  : {}),
              },
            ],
          }
        : {}),
      extensions: { prf: { eval: { first: encode(request.prfSalt), second: encode(VAULT_SALT) } } },
      ...(request.timeout !== undefined ? { timeout: request.timeout } : {}),
    })
    if (!asserted) throw new Error('Using the passkey was cancelled.')
    const results = asserted.clientExtensionResults?.prf?.results
    keepVault(results?.second)
    return {
      credentialId: decode(asserted.rawId ?? asserted.id),
      ...(results?.first ? { prfOutput: decode(results.first) } : {}),
    }
  },
}
