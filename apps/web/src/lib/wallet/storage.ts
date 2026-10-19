import type { NetworkId } from '@kova/monad'

/** Preserve the site's original storage, while keeping another chain's receipts and keys apart. */
export function networkStorageKey(
  key: string,
  network: NetworkId,
  hostname = typeof window === 'undefined' ? '' : window.location.hostname,
) {
  const original = hostname === 'web-monad.up.railway.app' ? 'testnet' : 'mainnet'
  return network === original ? key : `${key}.${network}`
}
