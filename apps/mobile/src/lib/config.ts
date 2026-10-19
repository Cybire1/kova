import { getNetwork, getToken, type NetworkId } from '@kova/monad'

/**
 * Where the Monad build points: Kova on Monad mainnet, unless the MONAD variables say otherwise
 * (a local API, say; on a physical phone use your Mac's LAN address, since `localhost` is the phone).
 * The Tempo build's EXPO_PUBLIC_KOVA_API_URL and _WEB_URL don't apply here: one untracked `.env`
 * serves both branches, and reading them sent this build to Tempo's API.
 */
export const apiUrl =
  process.env.EXPO_PUBLIC_KOVA_MONAD_API_URL ?? 'https://api-monad-mainnet.up.railway.app'
export const webUrl = process.env.EXPO_PUBLIC_KOVA_MONAD_WEB_URL ?? 'https://mykova.app'

/** Public Privy identifiers; the native client must allow this app's bundle ID and kova scheme. */
export const privyAppId = process.env.EXPO_PUBLIC_PRIVY_APP_ID ?? 'cmufz0ix501jn0cl6z2vdou5a'
export const privyClientId = process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID

/**
 * Monad mainnet, with mainnet AUSD. EXPO_PUBLIC_KOVA_NETWORK=testnet runs the app on testnet (free
 * test dollars), with EXPO_PUBLIC_KOVA_MONAD_API_URL=https://api-monad.up.railway.app.
 */
export const networkId: NetworkId =
  process.env.EXPO_PUBLIC_KOVA_NETWORK === 'testnet' ? 'testnet' : 'mainnet'
export const network = getNetwork(networkId)
export const isTestnet = networkId === 'testnet'

/**
 * Where links meant for other people point: Kova's web for this network, so a testnet link opens
 * the testnet page. (webUrl stays mykova.app on both: passkey sign-in is bound to it.)
 */
export const shareWebUrl =
  process.env.EXPO_PUBLIC_KOVA_MONAD_WEB_URL ??
  (isTestnet ? 'https://web-monad.up.railway.app' : 'https://mykova.app')

/**
 * The domain Kova Pay's passkeys belong to: iOS shows it when you make or use one, and a wallet
 * is bound to it for good. mykova.app serves the Apple association file that vouches for the app.
 */
export const passkeyDomain = process.env.EXPO_PUBLIC_KOVA_PASSKEY_DOMAIN ?? 'mykova.app'

/** The chain, as people see it named. */
export const chainName = 'Monad'

/** Relay quotes deposits into AUSD on mainnet. Set 0 to hide the entry. */
export const chainDeposits = !isTestnet && process.env.EXPO_PUBLIC_KOVA_CHAIN_DEPOSITS !== '0'

/** The dollar Kova settles in on Monad: AUSD, Agora's dollar, on mainnet and testnet alike. */
export const settlementToken = getToken(networkId, 'AUSD')
