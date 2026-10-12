import { secp256k1 } from '@noble/curves/secp256k1'
import { type Address, bytesToHex, concat, type Hex, hexToBytes, keccak256, stringToBytes } from 'viem'
import { generatePrivateKey, publicKeyToAddress } from 'viem/accounts'

/**
 * Private takings: stealth addresses, ERC-5564 scheme 1 (secp256k1 with view tags), the standard
 * whose announcer and registry contracts are deployed on Monad mainnet.
 *
 * A shop publishes a stealth meta-address: two public keys, one for spending and one for viewing.
 * For every sale, Kova derives a fresh one-time address from it with a new ephemeral key and asks
 * the customer to pay there. On Monad nobody can tell which shop that address belongs to, or add a
 * shop's sales up. The shop finds its sales with its viewing key and moves them with keys derived
 * from its spending key; Kova never holds either private key, so it can point payments at a shop
 * but can never move them. A viewing key alone (an accountant's view) sees every sale and can move
 * none of it.
 *
 * Every party runs the same functions: the API derives addresses, the app and the web scan and
 * sweep, and the accountant's page only scans.
 */

export const STEALTH_SCHEME_ID = 1
const N = secp256k1.CURVE.n
const Point = secp256k1.ProjectivePoint
const META_PREFIX = 'st:eth:0x'
const VIEW_PREFIX = 'kova-view:0x'

/**
 * What a wallet signs to make its stealth keys. The signature is deterministic (RFC 6979), so the
 * same wallet always makes the same keys, on the phone and on the web, with nothing stored.
 */
export const STEALTH_KEYS_MESSAGE =
  'Kova private takings\n\nSign to open your shop’s private takings keys. This only reads keys; it moves no money.'

export interface StealthKeys {
  spendingPrivateKey: Hex
  viewingPrivateKey: Hex
}

export interface StealthAnnouncement {
  stealthAddress: Address
  /** The ephemeral public key, compressed (33 bytes). */
  ephemeralPublicKey: Hex
  /** The first byte of the hashed shared secret: lets a scanner skip 255 of 256 others cheaply. */
  viewTag: Hex
}

/** A scalar from 32 bytes of hash: reduced mod n, never zero. */
function scalar(bytes: Hex): bigint {
  const k = BigInt(keccak256(bytes)) % N
  if (k === 0n) throw new Error('degenerate key')
  return k
}

const toKey = (k: bigint): Hex => `0x${k.toString(16).padStart(64, '0')}`
const compressed = (privateKey: Hex): Hex => bytesToHex(secp256k1.getPublicKey(hexToBytes(privateKey), true))

/** The stealth keys behind a signature of STEALTH_KEYS_MESSAGE: spending from r, viewing from s. */
export function stealthKeysFromSignature(signature: Hex): StealthKeys {
  const sig = hexToBytes(signature)
  if (sig.length !== 65) throw new Error('Expected a 65-byte signature')
  const r = bytesToHex(sig.slice(0, 32))
  const s = bytesToHex(sig.slice(32, 64))
  return {
    spendingPrivateKey: toKey(scalar(concat([r, bytesToHex(stringToBytes('kova:stealth:spending'))]))),
    viewingPrivateKey: toKey(scalar(concat([s, bytesToHex(stringToBytes('kova:stealth:viewing'))]))),
  }
}

/** `st:eth:0x<spending public key><viewing public key>`, both compressed, as ERC-5564 writes it. */
export function stealthMetaAddress(keys: StealthKeys): string {
  return `${META_PREFIX}${compressed(keys.spendingPrivateKey).slice(2)}${compressed(keys.viewingPrivateKey).slice(2)}`
}

/** The two public keys in a meta-address, checked to be points on the curve. */
export function parseStealthMetaAddress(meta: string): { spendingPublicKey: Hex; viewingPublicKey: Hex } {
  if (!meta.startsWith(META_PREFIX) || meta.length !== META_PREFIX.length + 132)
    throw new Error('Not a stealth meta-address')
  const spendingPublicKey = `0x${meta.slice(META_PREFIX.length, META_PREFIX.length + 66)}` as Hex
  const viewingPublicKey = `0x${meta.slice(META_PREFIX.length + 66)}` as Hex
  Point.fromHex(spendingPublicKey.slice(2))
  Point.fromHex(viewingPublicKey.slice(2))
  return { spendingPublicKey, viewingPublicKey }
}

/** keccak256 of the compressed shared point, as ERC-5564 scheme 1 hashes it. */
function hashedSecret(privateKey: Hex, publicKey: Hex): Hex {
  return keccak256(bytesToHex(secp256k1.getSharedSecret(hexToBytes(privateKey), hexToBytes(publicKey), true)))
}

const addressOf = (point: InstanceType<typeof Point>): Address => publicKeyToAddress(bytesToHex(point.toRawBytes(false)))

/** A fresh one-time address for a meta-address, and what its owner needs to find it. */
export function generateStealthAddress(meta: string, ephemeralPrivateKey: Hex = generatePrivateKey()): StealthAnnouncement {
  const { spendingPublicKey, viewingPublicKey } = parseStealthMetaAddress(meta)
  const secret = hashedSecret(ephemeralPrivateKey, viewingPublicKey)
  const stealth = Point.fromHex(spendingPublicKey.slice(2)).add(Point.BASE.multiply(BigInt(secret) % N))
  return {
    stealthAddress: addressOf(stealth),
    ephemeralPublicKey: compressed(ephemeralPrivateKey),
    viewTag: `0x${secret.slice(2, 4)}`,
  }
}

/**
 * Whether an announcement is for the holder of this viewing key: the one-time address it would
 * open, or null. Needs only the viewing private key and the spending public key, so an
 * accountant's view can scan without being able to spend.
 */
export function checkStealthAddress(
  view: { viewingPrivateKey: Hex; spendingPublicKey: Hex },
  announcement: Pick<StealthAnnouncement, 'ephemeralPublicKey' | 'viewTag'> & { stealthAddress?: Address },
): Address | null {
  const secret = hashedSecret(view.viewingPrivateKey, announcement.ephemeralPublicKey)
  if (`0x${secret.slice(2, 4)}` !== announcement.viewTag.toLowerCase()) return null
  const address = addressOf(Point.fromHex(view.spendingPublicKey.slice(2)).add(Point.BASE.multiply(BigInt(secret) % N)))
  if (announcement.stealthAddress && address.toLowerCase() !== announcement.stealthAddress.toLowerCase()) return null
  return address
}

/** The private key of a one-time address: spending key plus the hashed shared secret, mod n. */
export function stealthPrivateKey(keys: StealthKeys, ephemeralPublicKey: Hex): Hex {
  const secret = hashedSecret(keys.viewingPrivateKey, ephemeralPublicKey)
  return toKey((BigInt(keys.spendingPrivateKey) + (BigInt(secret) % N)) % N)
}

/** A shareable view: the viewing private key and the spending public key, for an accountant. */
export function stealthViewKey(keys: StealthKeys): string {
  return `${VIEW_PREFIX}${keys.viewingPrivateKey.slice(2)}${compressed(keys.spendingPrivateKey).slice(2)}`
}

export function parseStealthViewKey(view: string): { viewingPrivateKey: Hex; spendingPublicKey: Hex } {
  if (!view.startsWith(VIEW_PREFIX) || view.length !== VIEW_PREFIX.length + 64 + 66) throw new Error('Not a Kova view key')
  const viewingPrivateKey = `0x${view.slice(VIEW_PREFIX.length, VIEW_PREFIX.length + 64)}` as Hex
  const spendingPublicKey = `0x${view.slice(VIEW_PREFIX.length + 64)}` as Hex
  Point.fromHex(spendingPublicKey.slice(2))
  return { viewingPrivateKey, spendingPublicKey }
}
