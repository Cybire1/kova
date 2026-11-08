import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { networks, tokens, X402_VERSION, type X402Requirement } from '@kova/monad'
import { type Address, getAddress, isAddress } from 'viem'
import { network } from './network'

/**
 * The try page for Kova for Chrome (mykova.app/chrome): a 10¢ tip any connected site can ask for,
 * and a 1¢ article that answers HTTP 402 until it's paid (x402). Both pay KOVA_TRY_PAY_TO, a wallet
 * Kova controls; unset, the page explains and the payments stay off.
 */

/** The article's price: one cent, in AUSD base units. */
export const ARTICLE_PRICE = 10_000n
/** The tip on the try page: ten cents. */
export const TIP = 100_000n
/** The cookie that keeps the article open for a day once it's paid, so a refresh never pays twice. */
export const ARTICLE_COOKIE = 'kova_article'

export function tryPayTo(): Address | null {
  const value = process.env.KOVA_TRY_PAY_TO
  return value && isAddress(value) ? getAddress(value) : null
}

export function articleRequirement(payTo: Address): X402Requirement {
  const ausd = tokens[network].AUSD
  if (!ausd) throw new Error('No AUSD on this network')
  return {
    scheme: 'exact',
    network: `eip155:${networks[network].chainId}`,
    amount: ARTICLE_PRICE.toString(),
    asset: ausd.address,
    payTo,
    maxTimeoutSeconds: 300,
    extra: { name: ausd.domain.name, version: ausd.domain.version },
  }
}

/** The PAYMENT-REQUIRED header: base64 JSON of what the article accepts. */
export function paymentRequired(requirement: X402Requirement, url: string, error?: string) {
  return Buffer.from(
    JSON.stringify({
      x402Version: X402_VERSION,
      resource: { url, description: 'The cent that pays for the web', mimeType: 'text/html' },
      accepts: [requirement],
      ...(error ? { error } : {}),
    }),
  ).toString('base64')
}

const sign = (secret: string, expires: number) =>
  createHmac('sha256', secret).update(`kova-article:${expires}`).digest('base64url')

/** A day's access to the article, signed with the session secret. Null without one. */
export function articleAccess(): string | null {
  const secret = process.env.SESSION_SECRET
  if (!secret) return null
  const expires = Math.floor(Date.now() / 1000) + 86_400
  return `${expires}.${sign(secret, expires)}`
}

export function hasArticleAccess(value: string | undefined): boolean {
  const secret = process.env.SESSION_SECRET
  if (!secret || !value) return false
  const [raw, mac] = value.split('.')
  const expires = Number(raw)
  if (!mac || !Number.isInteger(expires) || expires < Date.now() / 1000) return false
  const expected = Buffer.from(sign(secret, expires))
  const given = Buffer.from(mac)
  return expected.length === given.length && timingSafeEqual(expected, given)
}
