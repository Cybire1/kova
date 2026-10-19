import 'server-only'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { network } from './network'

/**
 * The signed-in shop, as its secret key sealed in an httpOnly cookie (AES-256-GCM).
 *
 * The browser holds only ciphertext it cannot read or forge; every call to Kova is made from
 * this server with the unsealed key. Signing out deletes the cookie.
 */

const COOKIE = network === 'testnet' ? 'kova_session_testnet' : 'kova_session'
const MAX_AGE = 60 * 60 * 24 * 30

function secret() {
  const value = process.env.SESSION_SECRET
  if (!value && process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET is not set')
  return createHash('sha256').update(value ?? 'kova-dev-session-secret').digest()
}

function seal(text: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', secret(), iv)
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')
}

function unseal(token: string): string | null {
  try {
    const raw = Buffer.from(token, 'base64url')
    const decipher = createDecipheriv('aes-256-gcm', secret(), raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(12, 28))
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

export interface Session {
  key: string
  /** Signed in to the shared demo shop rather than one's own. */
  demo: boolean
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value
  const text = token ? unseal(token) : null
  if (!text) return null
  try {
    return JSON.parse(text) as Session
  } catch {
    return null
  }
}

/** Only from a Server Function or Route Handler. */
export async function startSession(session: Session) {
  ;(await cookies()).set(COOKIE, seal(JSON.stringify(session)), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  })
}

export async function endSession() {
  ;(await cookies()).delete(COOKIE)
}
