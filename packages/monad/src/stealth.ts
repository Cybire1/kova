import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { secp256k1 } from '@noble/curves/secp256k1'
import {
  type Address,
  bytesToHex,
  bytesToString,
  concat,
  getAddress,
  type Hex,
  hexToBytes,
  isAddress,
  isAddressEqual,
  keccak256,
  recoverMessageAddress,
  size,
  slice,
  stringToBytes,
  toHex,
} from 'viem'
import { generatePrivateKey, publicKeyToAddress } from 'viem/accounts'
import { NOTE_MAX } from './notes.js'

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
 *
 * A payment can carry a sealed memo (who sent it, their name, a note), encrypted with a key from
 * the same shared secret as its address, so only the recipient's viewing key opens it and nobody
 * has to ask Kova who paid. Each announcement is also posted to ERC-5564's announcer contract on
 * Monad, so any wallet can find its payments on chain, without Kova.
 */

export const STEALTH_SCHEME_ID = 1
const N = secp256k1.CURVE.n
const Point = secp256k1.ProjectivePoint
const META_PREFIX = 'st:eth:0x'
const VIEW_PREFIX = 'kova-view:0x'

/**
 * What a shop's owner signs to make that shop's stealth keys. The shop is in the message, so one
 * wallet that owns two shops gets two separate sets of keys (and two separate accountant views).
 * The signature is deterministic (RFC 6979): the same wallet and shop always make the same keys,
 * on the phone and on the web, with nothing stored.
 */
export function stealthKeysMessage(shop: string): string {
  return `Kova private takings\nShop ${shop}\n\nSign to open this shop’s private takings keys. This only reads keys; it moves no money.`
}

/**
 * What a person's wallet signs to make its own private-receiving keys: anyone can send it dollars
 * privately, to a fresh address only it can open. Deterministic like the shop's, and separate from
 * any shop the wallet owns.
 */
export function personalStealthKeysMessage(wallet: string): string {
  return `Kova private receiving\nWallet ${wallet.toLowerCase()}\n\nSign to open your private receiving keys. This only reads keys; it moves no money.`
}

/** What a wallet signs to publish its meta-address, so a sender can check Kova never swapped it. */
export function stealthRegistrationMessage(wallet: string, meta: string): string {
  return `Kova private receiving\nWallet ${wallet.toLowerCase()}\nKey ${meta}`
}

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
const compressed = (privateKey: Hex): Hex =>
  bytesToHex(secp256k1.getPublicKey(hexToBytes(privateKey), true))

/** The stealth keys behind a signature of stealthKeysMessage(shop): spending from r, viewing from s. */
export function stealthKeysFromSignature(signature: Hex): StealthKeys {
  const sig = hexToBytes(signature)
  if (sig.length !== 65) throw new Error('Expected a 65-byte signature')
  const r = bytesToHex(sig.slice(0, 32))
  const s = bytesToHex(sig.slice(32, 64))
  return {
    spendingPrivateKey: toKey(
      scalar(concat([r, bytesToHex(stringToBytes('kova:stealth:spending'))])),
    ),
    viewingPrivateKey: toKey(
      scalar(concat([s, bytesToHex(stringToBytes('kova:stealth:viewing'))])),
    ),
  }
}

/** `st:eth:0x<spending public key><viewing public key>`, both compressed, as ERC-5564 writes it. */
export function stealthMetaAddress(keys: StealthKeys): string {
  return `${META_PREFIX}${compressed(keys.spendingPrivateKey).slice(2)}${compressed(keys.viewingPrivateKey).slice(2)}`
}

/** The two public keys in a meta-address, checked to be points on the curve. */
export function parseStealthMetaAddress(meta: string): {
  spendingPublicKey: Hex
  viewingPublicKey: Hex
} {
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
  return keccak256(
    bytesToHex(secp256k1.getSharedSecret(hexToBytes(privateKey), hexToBytes(publicKey), true)),
  )
}

const addressOf = (point: InstanceType<typeof Point>): Address =>
  publicKeyToAddress(bytesToHex(point.toRawBytes(false)))

/** A fresh one-time address for a meta-address, and what its owner needs to find it. */
export function generateStealthAddress(
  meta: string,
  ephemeralPrivateKey: Hex = generatePrivateKey(),
): StealthAnnouncement {
  const { spendingPublicKey, viewingPublicKey } = parseStealthMetaAddress(meta)
  const secret = hashedSecret(ephemeralPrivateKey, viewingPublicKey)
  const stealth = Point.fromHex(spendingPublicKey.slice(2)).add(
    Point.BASE.multiply(BigInt(secret) % N),
  )
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
  announcement: Pick<StealthAnnouncement, 'ephemeralPublicKey' | 'viewTag'> & {
    stealthAddress?: Address
  },
): Address | null {
  const secret = hashedSecret(view.viewingPrivateKey, announcement.ephemeralPublicKey)
  if (`0x${secret.slice(2, 4)}` !== announcement.viewTag.toLowerCase()) return null
  const address = addressOf(
    Point.fromHex(view.spendingPublicKey.slice(2)).add(Point.BASE.multiply(BigInt(secret) % N)),
  )
  if (
    announcement.stealthAddress &&
    address.toLowerCase() !== announcement.stealthAddress.toLowerCase()
  )
    return null
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

export function parseStealthViewKey(view: string): {
  viewingPrivateKey: Hex
  spendingPublicKey: Hex
} {
  if (!view.startsWith(VIEW_PREFIX) || view.length !== VIEW_PREFIX.length + 64 + 66)
    throw new Error('Not a Kova view key')
  const viewingPrivateKey = `0x${view.slice(VIEW_PREFIX.length, VIEW_PREFIX.length + 64)}` as Hex
  const spendingPublicKey = `0x${view.slice(VIEW_PREFIX.length + 64)}` as Hex
  Point.fromHex(spendingPublicKey.slice(2))
  return { viewingPrivateKey, spendingPublicKey }
}

// --- On chain: ERC-5564's announcer --------------------------------------------------------------

/**
 * ERC-5564's announcer, at the same address on every chain: deployed on Monad mainnet, and by Kova
 * on Monad testnet with the same deterministic deployment. Its Announcement events are the public
 * record of private payments; this is what any wallet scans, Kova or not.
 */
export const ERC5564_ANNOUNCER: Address = '0x55649E01B5Df198D18D95b5cc5051630cfD45564'

export const erc5564AnnouncerAbi = [
  {
    type: 'function',
    name: 'announce',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'schemeId', type: 'uint256' },
      { name: 'stealthAddress', type: 'address' },
      { name: 'ephemeralPubKey', type: 'bytes' },
      { name: 'metadata', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'Announcement',
    inputs: [
      { name: 'schemeId', type: 'uint256', indexed: true },
      { name: 'stealthAddress', type: 'address', indexed: true },
      { name: 'caller', type: 'address', indexed: true },
      { name: 'ephemeralPubKey', type: 'bytes', indexed: false },
      { name: 'metadata', type: 'bytes', indexed: false },
    ],
  },
] as const

/** transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32): what moves Kova's dollars. */
const TRANSFER_SELECTOR: Hex = '0xe3ee160e'

/**
 * An announcement's metadata, as ERC-5564 lays it out for a token: the view tag, the function that
 * moved the funds, the token and the amount; then, when there is one, the sealed memo.
 */
export function stealthMetadata(input: {
  viewTag: Hex
  token: Address
  amount: bigint
  sealed?: Hex | null
}): Hex {
  return concat([
    input.viewTag,
    TRANSFER_SELECTOR,
    input.token,
    toHex(input.amount, { size: 32 }),
    ...(input.sealed ? [input.sealed] : []),
  ])
}

export function parseStealthMetadata(
  metadata: Hex,
): { viewTag: Hex; selector: Hex; token: Address; amount: bigint; sealed: Hex | null } | null {
  if (size(metadata) < 57) return null
  return {
    viewTag: slice(metadata, 0, 1),
    selector: slice(metadata, 1, 5),
    token: getAddress(slice(metadata, 5, 25)),
    amount: BigInt(slice(metadata, 25, 57)),
    sealed: size(metadata) > 57 ? slice(metadata, 57) : null,
  }
}

// --- Sealed memos: who sent it, and their note, for the recipient's eyes only --------------------

/** Longest name a memo carries, in characters. */
export const MEMO_NAME_MAX = 40
/** Largest sealed memo, in bytes: the version, the nonce, up to 400 bytes of memo and the tag. */
export const SEALED_MEMO_MAX = 1 + 24 + 400 + 16
const MEMO_VERSION = 1
const MEMO_LABEL = bytesToHex(stringToBytes('kova:stealth:memo:v1'))

/**
 * What a private payment tells its recipient, sealed so only their viewing key opens it.
 * `from` is the sender's own wallet. When the dollars left that wallet, Monad shows it too; when they
 * came from the sender's private dollars, `proof` is that wallet's signature of
 * stealthMemoMessage(the one-time address), so nobody can claim to be someone else.
 */
export interface StealthMemo {
  from?: Address
  /** What the sender calls themselves. */
  name?: string
  note?: string
  /** 'change': the sender's own private dollars, gathered into one new address of theirs. */
  kind?: 'send' | 'change'
  proof?: Hex
}

/** What a sender's wallet signs to vouch, inside a memo, that a payment from private dollars is theirs. */
export function stealthMemoMessage(stealthAddress: Address): string {
  return `Kova private send\nTo ${stealthAddress.toLowerCase()}`
}

const chars = (text: string, max: number) => [...text.trim()].slice(0, max).join('')

function cleanMemo(raw: unknown): StealthMemo {
  const m = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const memo: StealthMemo = {}
  if (typeof m.from === 'string' && isAddress(m.from)) memo.from = getAddress(m.from)
  if (typeof m.name === 'string' && m.name.trim()) memo.name = chars(m.name, MEMO_NAME_MAX)
  if (typeof m.note === 'string' && m.note.trim()) memo.note = chars(m.note, NOTE_MAX)
  if (m.kind === 'send' || m.kind === 'change') memo.kind = m.kind
  if (typeof m.proof === 'string' && /^0x[0-9a-fA-F]{130}$/.test(m.proof))
    memo.proof = m.proof as Hex
  return memo
}

const memoKey = (shared: Uint8Array) =>
  hexToBytes(keccak256(concat([bytesToHex(shared), MEMO_LABEL])))

/** Sealed to the shared secret, bound to the one-time address (as associated data). */
function sealMemo(shared: Uint8Array, stealthAddress: Address, memo: StealthMemo): Hex {
  const body = stringToBytes(JSON.stringify(cleanMemo(memo)))
  if (body.length > SEALED_MEMO_MAX - 41) throw new Error('That memo is too long to seal.')
  const nonce = hexToBytes(generatePrivateKey()).slice(0, 24)
  const box = xchacha20poly1305(memoKey(shared), nonce, hexToBytes(stealthAddress)).encrypt(body)
  return bytesToHex(new Uint8Array([MEMO_VERSION, ...nonce, ...box]))
}

export interface StealthPayment extends StealthAnnouncement {
  /** The sealed memo, or null when the payment carries none. */
  sealed: Hex | null
}

/** A fresh one-time address for a meta-address, as generateStealthAddress, with the memo sealed for its owner. */
export function generateStealthPayment(
  meta: string,
  memo?: StealthMemo | null,
  ephemeralPrivateKey: Hex = generatePrivateKey(),
): StealthPayment {
  const { viewingPublicKey } = parseStealthMetaAddress(meta)
  const announcement = generateStealthAddress(meta, ephemeralPrivateKey)
  if (!memo) return { ...announcement, sealed: null }
  const shared = secp256k1.getSharedSecret(
    hexToBytes(ephemeralPrivateKey),
    hexToBytes(viewingPublicKey),
    true,
  )
  return { ...announcement, sealed: sealMemo(shared, announcement.stealthAddress, memo) }
}

/** Opens a payment's memo with the viewing key; null when there is none, or it isn't for this key. */
export function openStealthMemo(
  viewingPrivateKey: Hex,
  payment: { ephemeralPublicKey: Hex; stealthAddress: Address; sealed: Hex | null | undefined },
): StealthMemo | null {
  if (!payment.sealed) return null
  try {
    const bytes = hexToBytes(payment.sealed)
    if (bytes[0] !== MEMO_VERSION || bytes.length < 41 || bytes.length > SEALED_MEMO_MAX)
      return null
    const shared = secp256k1.getSharedSecret(
      hexToBytes(viewingPrivateKey),
      hexToBytes(payment.ephemeralPublicKey),
      true,
    )
    const body = xchacha20poly1305(
      memoKey(shared),
      bytes.slice(1, 25),
      hexToBytes(payment.stealthAddress),
    ).decrypt(bytes.slice(25))
    return cleanMemo(JSON.parse(bytesToString(body)))
  } catch {
    return null
  }
}

/**
 * Who a private payment is from, and whether that's proven: 'chain' when Monad shows it left their
 * wallet, 'signed' when their wallet signed for it, 'claimed' when only the memo says so (show it as
 * unconfirmed), and null when there's no telling.
 */
export async function stealthSender(
  memo: StealthMemo | null,
  payment: { stealthAddress: Address; from?: Address | null },
): Promise<{
  address: Address
  name: string | null
  proven: 'chain' | 'signed' | 'claimed'
} | null> {
  const name = memo?.name ?? null
  if (memo?.from) {
    if (payment.from && isAddressEqual(payment.from, memo.from))
      return { address: memo.from, name, proven: 'chain' }
    if (memo.proof) {
      const signer = await recoverMessageAddress({
        message: stealthMemoMessage(payment.stealthAddress),
        signature: memo.proof,
      }).catch(() => null)
      if (signer && isAddressEqual(signer, memo.from))
        return { address: memo.from, name, proven: 'signed' }
    }
    return { address: memo.from, name, proven: 'claimed' }
  }
  return payment.from ? { address: getAddress(payment.from), name, proven: 'chain' } : null
}
