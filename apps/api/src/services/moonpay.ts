import { createHmac } from 'node:crypto'
import { isIP } from 'node:net'
import { config } from '../config.js'
import { chainDepositQuote } from './chain-deposits.js'
import type { TopUp } from './ramp.js'

/**
 * Card and bank top-ups with MoonPay. MoonPay sells no dollar on Monad, so it buys USDC on Base and
 * pays it to this wallet's own deposit address, and Relay turns that into AUSD on Monad: the same
 * route as any deposit from Base (services/chain-deposits.ts), landing seconds after MoonPay pays.
 * Kova never touches the money: MoonPay's hosted widget takes the card or bank payment.
 *
 * Every link is signed with the secret key (MoonPay requires it when the address is set) and tied
 * to the IP of whoever asked for it (allowedIpAddress, required to go live), so a link that pays
 * into one wallet can't be handed to someone else to pay through.
 * dev.moonpay.com/widget/on-ramp/customization/url-signing and …/ip-matching
 */
const WIDGET = { live: 'https://buy.moonpay.com', sandbox: 'https://buy-sandbox.moonpay.com' }
const BASE = 8453
const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
/** MoonPay's fiat (GET /v3/currencies, type fiat, 28 Oct 2026); anything else pays in USD. */
const FIAT = new Set(
  'AUD BRL CAD CHF COP CZK DKK DOP EGP EUR GBP HKD IDR ILS JOD KES KWD LKR MXN NGN NOK NZD OMR PEN PLN RON SEK THB TRY TWD USD VND ZAR'.split(
    ' ',
  ),
)
/** MoonPay's smallest card purchase in dollars; other currencies have their own, shown in the widget. */
const MIN_USD = 20

/** MoonPay's signature: base64 HMAC-SHA256 with the secret key. */
export function sign(secret: string, message: string) {
  return createHmac('sha256', secret).update(message).digest('base64')
}

/**
 * The IP as MoonPay compares it: IPv4 without leading zeros, IPv6 in RFC 5952 form, a mapped IPv4
 * unmapped, ports and brackets gone. Null if it isn't an IP (then the link goes without one).
 */
export function canonicalIp(raw: string): string | null {
  let ip = raw.trim()
  if (ip.startsWith('[')) ip = ip.slice(1, ip.indexOf(']'))
  else if (/^[\d.]+:\d+$/.test(ip)) ip = ip.split(':')[0] ?? ip
  if (/^::ffff:[\d.]+$/i.test(ip)) ip = ip.slice(7)
  const version = isIP(ip)
  if (version === 4)
    return ip
      .split('.')
      .map((part) => String(Number(part)))
      .join('.')
  // The URL parser writes IPv6 hosts in RFC 5952 form: lowercase, longest zero run as ::.
  if (version === 6) return new URL(`http://[${ip}]/`).hostname.slice(1, -1)
  return null
}

// A wallet's deposit address for USDC on Base is reusable, so it's asked of Relay once and kept;
// the card screen fetches a link every time Add money opens.
const addresses = new Map<string, { address: string; until: number }>()
export function clearMoonPayAddresses() {
  addresses.clear()
}

async function depositAddress(wallet: string) {
  const key = wallet.toLowerCase()
  const kept = addresses.get(key)
  if (kept && kept.until > Date.now()) return kept.address
  const quote = await chainDepositQuote(wallet, {
    chain_id: BASE,
    token: BASE_USDC,
    amount: '50',
    refund_to: wallet,
  })
  addresses.set(key, { address: quote.address, until: Date.now() + 6 * 3_600_000 })
  return quote.address
}

export const moonPayConfigured = () =>
  Boolean(config.MOONPAY_PUBLISHABLE_KEY && config.MOONPAY_SECRET_KEY)

export async function moonPayTopUp(
  wallet: string,
  currency: string,
  options: { dollars?: number; returnTo?: string; clientIp?: string } = {},
): Promise<TopUp> {
  const publishable = config.MOONPAY_PUBLISHABLE_KEY
  const secret = config.MOONPAY_SECRET_KEY
  const off: TopUp = { live: false, provider: 'MoonPay', url: null, min_usd: MIN_USD }
  // USDC on Base and Relay are mainnet things; deposits also have their own switch.
  if (config.KOVA_NETWORK !== 'mainnet' || !publishable || !secret) return off
  if (config.KOVA_CHAIN_DEPOSITS !== '1' || !config.RELAY_API_KEY) return off
  const fiat = FIAT.has(currency) ? currency : 'USD'
  // MoonPay's sandbox has no USDC on Base, so test keys buy its test USDC (Ethereum) instead:
  // nothing real moves, and the checkout, the signing and the IP check are what get tried.
  const sandbox = publishable.startsWith('pk_test_')
  const params = new URLSearchParams({
    apiKey: publishable,
    currencyCode: sandbox ? 'usdc' : 'usdc_base',
    walletAddress: await depositAddress(wallet),
    baseCurrencyCode: fiat.toLowerCase(),
    theme: 'light',
  })
  if (options.dollars && options.dollars > 0 && fiat === 'USD')
    params.set('baseCurrencyAmount', String(Math.max(MIN_USD, Math.round(options.dollars))))
  // MoonPay only sends people back to https (the app's kova:// link is left out; its in-app
  // browser closes on Done).
  if (options.returnTo?.startsWith('https://')) params.set('redirectURL', options.returnTo)
  const ip = options.clientIp ? canonicalIp(options.clientIp) : null
  if (ip) params.set('allowedIpAddress', sign(secret, ip))
  const query = `?${params.toString()}`
  const widget = sandbox ? WIDGET.sandbox : WIDGET.live
  return {
    live: true,
    provider: 'MoonPay',
    url: `${widget}${query}&signature=${encodeURIComponent(sign(secret, query))}`,
    min_usd: MIN_USD,
  }
}
