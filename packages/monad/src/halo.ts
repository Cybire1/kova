import { secp256k1 } from '@noble/curves/secp256k1'
import {
  type Address,
  bytesToHex,
  getAddress,
  type Hex,
  hexToBytes,
  keccak256,
  recoverAddress,
} from 'viem'

/**
 * The Kova Card's chip: an Arx HaLo, spoken to over ISO 7816 (ISO-DEP) from the till's NFC.
 *
 * This is the small part of Arx's LibHaLo (MIT, github.com/arx-research/libhalo) Kova needs: read
 * the card's key, and have it sign a 32-byte digest with it. LibHaLo itself pulls in ethers, a
 * websocket client and Node polyfills, which a phone app doesn't need for two commands.
 *
 *   SELECT       00 A4 04 00 0A A0000009490148614C6F 00  (or the legacy AID 481199130E9F01)
 *   command      B0 51 00 00 Lc <payload> 00
 *   GET_PKEYS    payload 02                    → [len ‖ pubkey] per key slot, slot 1 first
 *   FETCH_SIGN   payload 06 ‖ keyNo ‖ digest   → DER signature ‖ 04 ‖ X ‖ Y
 *   error        E1 ‖ code
 *
 * Slot 1 is generated on the chip at the factory and never leaves it. The chip may return a
 * high-s signature, so it is normalized to low s and its recovery id found by recovering the
 * public key, as LibHaLo does.
 */

/** Sends one APDU and returns the response including the status word. */
export type Transceive = (apdu: number[]) => Promise<number[]>

/** The application ids a phone must be allowed to select (iOS: the select-identifiers entitlement). */
export const HALO_AIDS = ['A0000009490148614C6F', '481199130E9F01'] as const

const SELECT = [
  [0x00, 0xa4, 0x04, 0x00, 0x0a, ...hexToBytes('0xA0000009490148614C6F'), 0x00],
  [0x00, 0xa4, 0x04, 0x00, 0x07, ...hexToBytes('0x481199130E9F01'), 0x00],
]

const CMD_GET_PKEYS = 0x02
const CMD_FETCH_SIGN = 0x06
/** The factory key. */
export const CARD_KEY_SLOT = 1

const N = secp256k1.CURVE.n

const HALO_ERRORS: Record<number, string> = {
  1: 'This card doesn’t know that command.',
  2: 'This card has no key in that slot.',
  10: 'This card’s key isn’t set up.',
  12: 'The card couldn’t sign. Try again.',
  13: 'The card refused the data it was given.',
  25: 'The card is resting after too many requests. Try again in a moment.',
}

export class HaloError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message)
    this.name = 'HaloError'
  }
}

async function select(transceive: Transceive) {
  for (const apdu of SELECT) {
    const res = await transceive(apdu)
    if (res.length === 2 && res[0] === 0x90 && res[1] === 0x00) return
  }
  throw new HaloError('This isn’t a Kova Card. Hold a Kova Card to the top of the phone.')
}

async function command(transceive: Transceive, payload: number[]): Promise<Uint8Array> {
  await select(transceive)
  const res = await transceive([0xb0, 0x51, 0x00, 0x00, payload.length, ...payload, 0x00])
  if (res.length < 2) throw new HaloError('The card didn’t answer. Hold it still and try again.')
  const sw = ((res[res.length - 2] as number) << 8) | (res[res.length - 1] as number)
  const data = Uint8Array.from(res.slice(0, -2))
  if (data.length === 2 && data[0] === 0xe1)
    throw new HaloError(
      HALO_ERRORS[data[1] as number] ?? `The card refused (E1 ${data[1]}).`,
      data[1],
    )
  if (sw !== 0x9000) throw new HaloError('The card didn’t answer. Hold it still and try again.')
  return data
}

/** An Ethereum address from an uncompressed public key (04 ‖ X ‖ Y). */
export function addressOfPublicKey(publicKey: Uint8Array): Address {
  if (publicKey.length !== 65 || publicKey[0] !== 0x04)
    throw new HaloError('The card sent a key Kova can’t read.')
  return getAddress(`0x${keccak256(publicKey.slice(1)).slice(-40)}`)
}

/** The public key in each slot, slot 1 first. */
export function parsePublicKeys(data: Uint8Array): Uint8Array[] {
  const keys: Uint8Array[] = []
  let at = 0
  while (at < data.length) {
    const len = data[at] as number
    if (!len) break
    keys.push(data.slice(at + 1, at + 1 + len))
    at += 1 + len
  }
  return keys
}

/** Reads the card's address: the key in slot 1. */
export async function readCard(transceive: Transceive): Promise<Address> {
  const keys = parsePublicKeys(await command(transceive, [CMD_GET_PKEYS]))
  const key = keys[CARD_KEY_SLOT - 1]
  if (!key) throw new HaloError('This card has no key yet.')
  return addressOfPublicKey(key)
}

/** r and s from a DER signature, with s normalized to the low half (EIP-2). */
export function parseDerSignature(der: Uint8Array): { r: bigint; s: bigint; length: number } {
  if (der[0] !== 0x30 || der[2] !== 0x02)
    throw new HaloError('The card sent a signature Kova can’t read.')
  const rLen = der[3] as number
  if (der[4 + rLen] !== 0x02) throw new HaloError('The card sent a signature Kova can’t read.')
  const sLen = der[5 + rLen] as number
  const r = BigInt(bytesToHex(der.slice(4, 4 + rLen))) % N
  let s = BigInt(bytesToHex(der.slice(6 + rLen, 6 + rLen + sLen))) % N
  if (s > N / 2n) s = N - s
  return { r, s, length: 6 + rLen + sLen }
}

export interface CardSignature {
  card: Address
  /** 65 bytes, r ‖ s ‖ v, low s: what the KovaCard contract and viem expect. */
  signature: Hex
}

/** Has the card sign a 32-byte digest, and returns its address with the signature. */
export async function signWithCard(transceive: Transceive, digest: Hex): Promise<CardSignature> {
  const digestBytes = hexToBytes(digest)
  if (digestBytes.length !== 32) throw new HaloError('A card signs exactly 32 bytes.')
  const res = await command(transceive, [CMD_FETCH_SIGN, CARD_KEY_SLOT, ...digestBytes])
  const { r, s, length } = parseDerSignature(res)
  const card = addressOfPublicKey(res.slice(length, length + 65))
  const rs = `${r.toString(16).padStart(64, '0')}${s.toString(16).padStart(64, '0')}`
  for (const v of [27, 28]) {
    const signature = `0x${rs}${v.toString(16)}` as Hex
    if ((await recoverAddress({ hash: digest, signature })) === card) return { card, signature }
  }
  throw new HaloError('The card’s signature doesn’t check out. Try again.')
}

// ── A software HaLo ─────────────────────────────────────────────────────────────────────────

function toDer(r: bigint, s: bigint): number[] {
  const int = (n: bigint) => {
    let bytes = [...hexToBytes(`0x${n.toString(16).padStart(64, '0')}`)]
    while (bytes.length > 1 && bytes[0] === 0 && (bytes[1] as number) < 0x80) bytes = bytes.slice(1)
    if ((bytes[0] as number) >= 0x80) bytes = [0, ...bytes]
    return [0x02, bytes.length, ...bytes]
  }
  const body = [...int(r), ...int(s)]
  return [0x30, body.length, ...body]
}

/**
 * A card that answers exactly as a HaLo chip does, from a private key: for tests, and for the
 * simulator, which has no NFC. Like a real chip it signs with whichever s it likes (here, always
 * high when it can), so the till's normalization is exercised every time.
 */
export function softCard(privateKey: Hex): Transceive {
  const publicKey = secp256k1.getPublicKey(hexToBytes(privateKey), false)
  let selected = false
  return async (apdu) => {
    if (apdu[0] === 0x00 && apdu[1] === 0xa4) {
      const aid = bytesToHex(Uint8Array.from(apdu.slice(5, 5 + (apdu[4] as number))))
        .slice(2)
        .toUpperCase()
      selected = aid === HALO_AIDS[0]
      return selected ? [0x90, 0x00] : [0x6a, 0x82]
    }
    if (!selected || apdu[0] !== 0xb0 || apdu[1] !== 0x51) return [0x6d, 0x00]
    const payload = apdu.slice(5, 5 + (apdu[4] as number))
    if (payload[0] === CMD_GET_PKEYS) return [65, ...publicKey, 0x00, 0x90, 0x00]
    if (payload[0] === CMD_FETCH_SIGN) {
      if (payload[1] !== CARD_KEY_SLOT) return [0xe1, 0x02, 0x90, 0x00]
      const digest = Uint8Array.from(payload.slice(2, 34))
      const sig = secp256k1.sign(digest, hexToBytes(privateKey), { lowS: true })
      const highS = N - sig.s
      return [...toDer(sig.r, highS), ...publicKey, 0x90, 0x00]
    }
    return [0xe1, 0x01, 0x90, 0x00]
  }
}
