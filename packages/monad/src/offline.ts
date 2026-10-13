import { type Address, bytesToHex, bytesToString, concat, getAddress, type Hex, hexToBytes, isAddressEqual, keccak256, recoverTypedDataAddress, stringToBytes, toHex } from 'viem'
import { type TransferAuthorization, transferAuthorizationTypedData } from './authorization.js'
import { networkByChainId } from './networks.js'
import { tokenByAddress } from './tokens.js'

/**
 * Offline payments: dollars that move with no internet.
 *
 * A Kova payment is an EIP-3009 authorization: the payer's wallet signs "move $X from me to them",
 * with a random nonce, and anyone can submit it. Signing needs no network, so a phone with no signal
 * can still pay: it signs, and the signed payment travels as a code (a QR on the screen, or a link
 * over AirDrop, Bluetooth or a message). The receiver's phone checks the signature on the spot, also
 * with no network, and whichever phone gets signal first hands it to Kova's relayer, which settles it
 * on Monad in about a second and pays the gas. Both submitting is fine: the token accepts each
 * authorization once.
 *
 * What can't be checked offline is the payer's balance, so the payer's phone keeps back what it has
 * already promised, and each code is capped (OFFLINE_MAX). An offline payment can wait a week
 * (OFFLINE_VALIDITY) to be settled.
 */

/** How long an offline payment can wait to be settled. */
export const OFFLINE_VALIDITY = 7n * 24n * 3600n
/** The most one offline payment can carry, in the dollar's base units (6 decimals): $100. */
export const OFFLINE_MAX = 100_000_000n
/** The most a name on an offline payment carries, in characters. */
export const OFFLINE_NAME_MAX = 40

export interface OfflinePayment {
  chainId: number
  token: Address
  authorization: TransferAuthorization
  signature: Hex
  /** What the sender calls themselves. Not signed: their address is what the signature proves. */
  name: string | null
}

const VERSION = 1
// version(1) chainId(4) token(20) from(20) to(20) value(16) validBefore(8) nonce(32) signature(65) name(rest, UTF-8)
const FIXED = 1 + 4 + 20 + 20 + 20 + 16 + 8 + 32 + 65

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

function toBase64url(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63]!
    if (i + 2 < bytes.length) out += B64[n & 63]!
  }
  return out
}

function fromBase64url(text: string): Uint8Array | null {
  const bytes: number[] = []
  let bits = 0
  let acc = 0
  for (const ch of text) {
    const v = B64.indexOf(ch)
    if (v < 0) return null
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((acc >> bits) & 0xff)
    }
  }
  return new Uint8Array(bytes)
}

const chars = (text: string, max: number) => [...text.trim()].slice(0, max).join('')

/** The payment as a short, URL-safe code: what the QR holds and what follows the # in its link. */
export function encodeOfflinePayment(p: OfflinePayment): string {
  if (p.authorization.validAfter !== 0n) throw new Error('An offline payment is valid from the moment it is signed.')
  const name = p.name ? stringToBytes(chars(p.name, OFFLINE_NAME_MAX)) : new Uint8Array(0)
  const bytes = hexToBytes(
    concat([
      toHex(VERSION, { size: 1 }),
      toHex(p.chainId, { size: 4 }),
      p.token,
      p.authorization.from,
      p.authorization.to,
      toHex(p.authorization.value, { size: 16 }),
      toHex(p.authorization.validBefore, { size: 8 }),
      p.authorization.nonce,
      p.signature,
    ]),
  )
  const all = new Uint8Array(bytes.length + name.length)
  all.set(bytes)
  all.set(name, bytes.length)
  return toBase64url(all)
}

/** A code back into a payment, or null when it isn't one. Says nothing about the signature: verifyOfflinePayment does. */
export function decodeOfflinePayment(code: string): OfflinePayment | null {
  const bytes = fromBase64url(code.trim())
  if (!bytes || bytes.length < FIXED || bytes[0] !== VERSION) return null
  try {
    const hex = bytesToHex(bytes.slice(0, FIXED))
    let at = 2
    const take = (n: number) => {
      const part = `0x${hex.slice(at, at + n * 2)}` as Hex
      at += n * 2
      return part
    }
    take(1)
    const chainId = Number(BigInt(take(4)))
    const token = getAddress(take(20))
    const from = getAddress(take(20))
    const to = getAddress(take(20))
    const value = BigInt(take(16))
    const validBefore = BigInt(take(8))
    const nonce = take(32)
    const signature = take(65)
    const name = bytes.length > FIXED ? chars(bytesToString(bytes.slice(FIXED)), OFFLINE_NAME_MAX) || null : null
    return { chainId, token, authorization: { from, to, value, validAfter: 0n, validBefore, nonce }, signature, name }
  } catch {
    return null
  }
}

export type OfflineCheck =
  | { ok: true }
  | { ok: false; reason: 'unknown-network' | 'unknown-token' | 'bad-signature' | 'expired' | 'too-large' | 'zero' }

/**
 * Whether a payment is genuinely the sender's and still usable, checked with no network: the
 * signature recovers to its sender, its dollar is one Kova knows, it isn't empty, over the cap or
 * past its time. Whether the sender still holds the money is only known once it's settled.
 */
export async function verifyOfflinePayment(p: OfflinePayment, now = BigInt(Math.floor(Date.now() / 1000))): Promise<OfflineCheck> {
  let network: ReturnType<typeof networkByChainId>
  try {
    network = networkByChainId(p.chainId)
  } catch {
    return { ok: false, reason: 'unknown-network' }
  }
  const token = tokenByAddress(network.id, p.token)
  if (!token) return { ok: false, reason: 'unknown-token' }
  if (p.authorization.value === 0n) return { ok: false, reason: 'zero' }
  if (p.authorization.value > OFFLINE_MAX) return { ok: false, reason: 'too-large' }
  if (p.authorization.validBefore <= now) return { ok: false, reason: 'expired' }
  const signer = await recoverTypedDataAddress({ ...transferAuthorizationTypedData(token, p.chainId, p.authorization), signature: p.signature }).catch(() => null)
  if (!signer || !isAddressEqual(signer, p.authorization.from)) return { ok: false, reason: 'bad-signature' }
  return { ok: true }
}

/** One payment's lasting id: its sender and nonce, as the token records it (AuthorizationUsed). */
export function offlinePaymentId(p: Pick<OfflinePayment, 'authorization'>): Hex {
  return keccak256(concat([p.authorization.from, p.authorization.nonce]))
}

/** The link that carries a payment: the code after the #, so it never reaches a server. */
export function offlinePaymentLink(code: string, site = 'https://mykova.app'): string {
  return `${site.replace(/\/$/, '')}/o#${code}`
}

/** The code from a scanned QR or a pasted link, or null. */
export function offlineCodeFrom(text: string): string | null {
  const trimmed = text.trim()
  const hash = trimmed.match(/\/o#([A-Za-z0-9_-]{200,})$/)
  if (hash) return hash[1] ?? null
  return /^[A-Za-z0-9_-]{200,}$/.test(trimmed) ? trimmed : null
}
