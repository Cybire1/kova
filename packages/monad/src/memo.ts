import type { Hex } from 'viem'

/**
 * Kova's 32-byte memo, the same layout on every chain Kova runs on (DECISIONS D-004). On Tempo
 * it rides in a TIP-20 transferWithMemo; on Monad it is the EIP-3009 authorization's nonce.
 *
 *   bytes  0..3   "KOVA" magic (0x4b4f5641): distinguishes Kova memos from anyone else's
 *   byte   4      layout version (0x01)
 *   byte   5      kind
 *   bytes  6..15  reserved, zero in v1
 *   bytes 16..31  id of the Kova object the transfer settles (UUID, 16 raw bytes)
 *
 * Memos are public forever and are attribution hints, not authentication: never put PII in
 * one, and always verify token, recipient and amount alongside it.
 */
export const MEMO_MAGIC = '4b4f5641'
export const MEMO_VERSION = 1

export const memoKinds = { payment: 0x01, refund: 0x02, payout: 0x03, cashout: 0x0a } as const
export type MemoKind = keyof typeof memoKinds

export interface KovaMemo {
  kind: MemoKind
  /** Lowercase canonical UUID, e.g. "0192f3a4-...". */
  id: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function encodeMemo({ kind, id }: KovaMemo): Hex {
  if (!UUID_RE.test(id)) throw new Error(`Memo id must be a UUID, got ${JSON.stringify(id)}`)
  const code = memoKinds[kind]
  if (code === undefined) throw new Error(`Unknown memo kind: ${kind}`)
  const hex =
    MEMO_MAGIC +
    MEMO_VERSION.toString(16).padStart(2, '0') +
    code.toString(16).padStart(2, '0') +
    '00'.repeat(10) +
    id.replaceAll('-', '').toLowerCase()
  return `0x${hex}`
}

/** Decodes a memo. Returns null for anything that is not a well-formed v1 Kova memo. */
export function decodeMemo(memo: Hex): KovaMemo | null {
  const hex = memo.toLowerCase().replace(/^0x/, '')
  if (hex.length !== 64) return null
  if (hex.slice(0, 8) !== MEMO_MAGIC) return null
  if (Number.parseInt(hex.slice(8, 10), 16) !== MEMO_VERSION) return null
  if (hex.slice(12, 32) !== '0'.repeat(20)) return null
  const code = Number.parseInt(hex.slice(10, 12), 16)
  const kind = (Object.keys(memoKinds) as MemoKind[]).find((k) => memoKinds[k] === code)
  if (!kind) return null
  const u = hex.slice(32)
  const id = `${u.slice(0, 8)}-${u.slice(8, 12)}-${u.slice(12, 16)}-${u.slice(16, 20)}-${u.slice(20)}`
  return { kind, id }
}

export function isKovaMemo(memo: Hex): boolean {
  return decodeMemo(memo) !== null
}
