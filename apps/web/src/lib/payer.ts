/**
 * The wallet that pays in this browser, for the stamp card: there's nothing to sign up for, the
 * wallet that pays is the card. It's the last wallet that paid a shop from this browser (the Kova
 * wallet, an email wallet, MetaMask), or else the Kova wallet opened here. Only the address is kept.
 */

const PROFILE = 'kova.web.profile.v1'
const LAST_PAYER = 'kova.web.payer.v1'
const ADDRESS = /^0x[0-9a-fA-F]{40}$/

const readAddress = (key: string, pick: (value: unknown) => unknown): string | null => {
  try {
    const raw = localStorage.getItem(key)
    const address = raw ? pick(JSON.parse(raw)) : null
    return typeof address === 'string' && ADDRESS.test(address) ? address : null
  } catch {
    return null
  }
}

/** The address whose stamps this browser shows, or null when no wallet has paid from here. */
export function knownPayer(): string | null {
  return (
    readAddress(LAST_PAYER, (a) => a) ??
    readAddress(PROFILE, (p) => (p as { address?: unknown })?.address)
  )
}

/** Remembers the wallet that just paid, so the shop's stamp card can show its stamps. */
export function rememberPayer(address: string) {
  if (!ADDRESS.test(address)) return
  try {
    localStorage.setItem(LAST_PAYER, JSON.stringify(address))
  } catch {
    // Private mode or full storage: the card just shows as new next time.
  }
}
