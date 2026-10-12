import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getPasskeyPrfOutput,
  isMeraError,
  type PasskeyCredentialMetadata,
  type Secp256k1SigningSession,
  type WebAuthnClient,
} from '@category-labs/mera'
import { toViemAccount } from '@category-labs/mera/viem'
import { sha256 } from '@noble/hashes/sha2.js'
import { HDKey } from '@scure/bip32'
import { entropyToMnemonic, mnemonicToSeed } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { type LocalAccount, stringToBytes } from 'viem'

/**
 * Your Kova account on the web: the same passkey, and so the same wallet, as the Kova app.
 *
 * The app makes its passkey for mykova.app, and a passkey belongs to its domain, not to a device:
 * iCloud Keychain carries it to Safari and Chrome on your Mac, and "use a phone" reaches it from
 * anywhere else. Every ceremony evaluates the same two PRF salts as the app (apps/mobile
 * src/lib/passkey.ts): Mera's wallet salt, which becomes the Monad account through Mera's documented
 * derivation (keys.ts), and Kova's vault salt, which opens the encrypted backup of your name,
 * currency and people. Same passkey, same outputs, same account, on every screen it's used from.
 */

/** Where Kova's passkeys live. It must match the app's, or the web would make a second account. */
export const passkeyDomain = process.env.NEXT_PUBLIC_KOVA_PASSKEY_DOMAIN || 'mykova.app'

/** Kova's second salt (the app's VAULT_SALT). A different salt gives an unrelated key. */
export const VAULT_SALT = sha256(stringToBytes('kova.vault.prf.v1'))

/** A passkey works only on its own domain: mykova.app, not a preview or localhost address. */
export function passkeyHome(): boolean {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname
  return host === passkeyDomain || host.endsWith(`.${passkeyDomain}`)
}

/** What a passkey ceremony gives Kova: the wallet's entropy, and the vault's, from one Face ID. */
export interface PasskeyOutput {
  prfOutput: Uint8Array
  vaultSecret: Uint8Array | null
  credential: PasskeyCredentialMetadata
}

let vaultOutput: Uint8Array | null = null

const bytes = (value: unknown): Uint8Array | null =>
  value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : ArrayBuffer.isView(value)
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : null

type PrfResults = { enabled?: boolean; results?: { first?: BufferSource; second?: BufferSource } }

/** Mera's browser client, plus Kova's second salt in the same ceremony. */
const kovaBrowserClient: WebAuthnClient = {
  async createCredential(request) {
    const credential = (await navigator.credentials.create({
      publicKey: {
        rp: request.rp,
        user: request.user,
        challenge: request.challenge,
        pubKeyCredParams: request.algorithms.map((alg) => ({ type: 'public-key', alg })),
        ...(request.timeout !== undefined ? { timeout: request.timeout } : {}),
        attestation: request.attestation,
        authenticatorSelection: {
          residentKey: request.residentKey,
          requireResidentKey: true,
          userVerification: request.userVerification,
        },
        extensions: {
          prf: { eval: { first: request.prfSalt, second: VAULT_SALT } },
        } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null
    if (!credential) throw new Error('Making the passkey was cancelled.')
    const prf = (credential.getClientExtensionResults() as { prf?: PrfResults }).prf
    vaultOutput = bytes(prf?.results?.second)
    const response = credential.response as AuthenticatorAttestationResponse
    const transports =
      typeof response.getTransports === 'function' ? response.getTransports() : undefined
    const first = bytes(prf?.results?.first)
    return {
      credentialId: new Uint8Array(credential.rawId),
      ...(transports ? { transports } : {}),
      prfEnabled: prf?.enabled === true || Boolean(first),
      ...(first ? { prfOutput: first } : {}),
    }
  },

  async getCredential(request) {
    const allow = request.allowCredential
    const credential = (await navigator.credentials.get({
      publicKey: {
        rpId: request.rpId,
        challenge: request.challenge,
        ...(request.timeout !== undefined ? { timeout: request.timeout } : {}),
        userVerification: request.userVerification,
        extensions: {
          prf: { eval: { first: request.prfSalt, second: VAULT_SALT } },
        } as AuthenticationExtensionsClientInputs,
        ...(allow
          ? {
              allowCredentials: [
                {
                  id: allow.credentialId,
                  type: 'public-key',
                  ...(allow.transports
                    ? { transports: allow.transports as AuthenticatorTransport[] }
                    : {}),
                },
              ],
            }
          : {}),
      },
    })) as PublicKeyCredential | null
    if (!credential) throw new Error('Using the passkey was cancelled.')
    const results = (credential.getClientExtensionResults() as { prf?: PrfResults }).prf?.results
    vaultOutput = bytes(results?.second)
    const first = bytes(results?.first)
    return {
      credentialId: new Uint8Array(credential.rawId),
      ...(first ? { prfOutput: first } : {}),
    }
  },
}

function takeVault() {
  const out = vaultOutput
  vaultOutput = null
  return out
}

/** Words for what went wrong with a passkey, as the app says them. */
export function passkeyProblem(error: unknown): string {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'AbortError')
    return 'The passkey was cancelled. Nothing changed.'
  if (name === 'SecurityError') return `Passkeys for Kova only work on ${passkeyDomain}.`
  if (isMeraError(error) && error.code === 'PRF_UNAVAILABLE')
    return 'This browser can’t open a Kova wallet with a passkey. Try Safari or Chrome on a Mac or iPhone, or use your phone.'
  return error instanceof Error && error.message
    ? error.message
    : 'The passkey didn’t work. Try again.'
}

/** A new passkey and a new wallet, as "Create my wallet" does in the app. */
export async function createKovaPasskey(name: string): Promise<PasskeyOutput> {
  const created = await createPasskeyWithPrfOutput({
    rp: { id: passkeyDomain, name: 'Kova' },
    user: { name, displayName: name },
    webAuthnClient: kovaBrowserClient,
  })
  return {
    prfOutput: created.prfOutput,
    vaultSecret: takeVault(),
    credential: {
      credentialId: created.credentialId,
      ...(created.transports ? { transports: created.transports } : {}),
    },
  }
}

/** Opens the wallet an existing passkey holds, from this device, the Kova app's iCloud Keychain, or a phone. */
export async function openKovaPasskey(
  credential?: PasskeyCredentialMetadata,
): Promise<PasskeyOutput> {
  const asserted = await getPasskeyPrfOutput({
    rpId: passkeyDomain,
    ...(credential ? { credential } : {}),
    webAuthnClient: kovaBrowserClient,
  })
  return {
    prfOutput: asserted.prfOutput,
    vaultSecret: takeVault(),
    credential:
      credential?.credentialId === asserted.credentialId
        ? credential
        : { credentialId: asserted.credentialId },
  }
}

/**
 * Mera's derivation, exactly as the app does it (apps/mobile src/lib/keys.ts): the 32-byte PRF
 * output is BIP-39 entropy, and the wallet is the first Ethereum account of that seed
 * (m/44'/60'/0'/0/0). The key lives only in a signing session, in memory, zeroed when it ends.
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
