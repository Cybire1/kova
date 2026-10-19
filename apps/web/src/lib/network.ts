import type { NetworkId } from '@kova/monad'

/** Production and public builds use mainnet; testnet must be selected explicitly. */
const selected = process.env.KOVA_NETWORK ?? 'mainnet'
if (selected !== 'mainnet' && selected !== 'testnet') {
  throw new Error('KOVA_NETWORK must be mainnet or testnet')
}

export const network: NetworkId = selected

const publicApis: Record<NetworkId, string> = {
  mainnet: 'https://api-monad-mainnet.up.railway.app',
  testnet: 'https://api-monad.up.railway.app',
}

export const apiUrl = process.env.KOVA_API_URL || publicApis[network]
export const publicApiUrl = process.env.KOVA_PUBLIC_API_URL || apiUrl
