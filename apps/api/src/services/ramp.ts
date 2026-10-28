import { config } from '../config.js'

/**
 * Card and bank top-ups with Ramp Network. Ramp sells AUSD on Monad itself (MONAD_AUSD), so a
 * top-up lands in the wallet as the same dollars every Kova payment moves, with no swap. Kova
 * never touches the money: Ramp's hosted widget takes the card or bank payment and sends AUSD to
 * the wallet's address.
 *
 * Ramp's Monad assets are on mainnet, so on testnet this says so instead of giving a link.
 */
const RAMP = 'https://app.rampnetwork.com/'
/** Currencies Ramp prices AUSD in that Kova shows; others pay in USD. */
const FIAT = new Set(['USD', 'EUR', 'GBP', 'MXN'])

export interface TopUp {
  live: boolean
  provider: 'Ramp Network' | 'MoonPay'
  /** The hosted widget, set up for this wallet; null until Kova is on mainnet with a provider key. */
  url: string | null
  /** Ramp's smallest card purchase, in euros. */
  min_eur?: number
  /** MoonPay's smallest card purchase, in dollars. */
  min_usd?: number
}

export function topUpFor(
  wallet: string,
  currency: string,
  dollars?: number,
  returnTo?: string,
): TopUp {
  const live = config.KOVA_NETWORK === 'mainnet' && Boolean(config.RAMP_HOST_API_KEY)
  if (!live || !config.RAMP_HOST_API_KEY)
    return { live: false, provider: 'Ramp Network', url: null, min_eur: 6.25 }
  const fiat = FIAT.has(currency) ? currency : 'USD'
  const params = new URLSearchParams({
    hostApiKey: config.RAMP_HOST_API_KEY,
    hostAppName: 'Kova',
    hostLogoUrl: 'https://mykova.app/icon.png',
    defaultFlow: 'ONRAMP',
    enabledFlows: 'ONRAMP',
    enabledCryptoAssets: 'MONAD_AUSD',
    outAsset: 'MONAD_AUSD',
    inAsset: fiat,
    userAddress: wallet,
    ...(dollars && dollars > 0 ? { inAssetValue: String(Math.round(dollars * 100)) } : {}),
    ...(returnTo ? { finalUrl: returnTo } : {}),
  })
  return { live: true, provider: 'Ramp Network', url: `${RAMP}?${params}`, min_eur: 6.25 }
}

/** What the web's cash-out page hands Ramp's SDK for an off-ramp from AUSD on Monad. */
export interface CashOut {
  live: boolean
  provider: 'Ramp Network'
  config: {
    hostApiKey: string
    hostAppName: string
    hostLogoUrl: string
    defaultFlow: 'OFFRAMP'
    enabledFlows: ['OFFRAMP']
    offrampAsset: string
    defaultAsset: string
    fiatCurrency: string
    userAddress: string
  } | null
}

/**
 * Cashing out: Ramp's off-ramp sells AUSD on Monad for money in a bank or on a card. Ramp asks the
 * wallet to send the AUSD to it, and Kova's gasless send does that, approved with the passkey.
 * Needs a Ramp key with off-ramp switched on, on mainnet.
 */
export function cashOutFor(wallet: string, currency: string): CashOut {
  const live = config.KOVA_NETWORK === 'mainnet' && Boolean(config.RAMP_HOST_API_KEY)
  if (!live || !config.RAMP_HOST_API_KEY)
    return { live: false, provider: 'Ramp Network', config: null }
  return {
    live: true,
    provider: 'Ramp Network',
    config: {
      hostApiKey: config.RAMP_HOST_API_KEY,
      hostAppName: 'Kova',
      hostLogoUrl: 'https://mykova.app/icon.png',
      defaultFlow: 'OFFRAMP',
      enabledFlows: ['OFFRAMP'],
      // The SDK's own names for these (the widget maps them to enabledCryptoAssets, inAsset, outAsset).
      offrampAsset: 'MONAD_AUSD',
      defaultAsset: 'MONAD_AUSD',
      fiatCurrency: FIAT.has(currency) ? currency : 'USD',
      userAddress: wallet,
    },
  }
}
