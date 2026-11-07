import type { NetworkId } from '@kova/monad'

/**
 * Where Kova for Chrome talks to. Set at build time (build.mjs): the default is Kova on Monad
 * mainnet; `KOVA_NETWORK=testnet KOVA_WEB=http://localhost:3014 node build.mjs` builds one for the
 * test network and a local mykova.app.
 */
declare const __KOVA_NETWORK__: NetworkId
declare const __KOVA_WEB__: string
declare const __KOVA_API__: string

export const NETWORK: NetworkId = __KOVA_NETWORK__
/** mykova.app: where the wallet's passkey lives, and so where every owner signature happens. */
export const WEB = __KOVA_WEB__
/** Kova's API: budgets, payments and Kova's cosignature. */
export const API = __KOVA_API__
