import { KovaError } from '../errors.js'
import { countryOf } from './stock-trades.js'

/**
 * Countries under comprehensive sanctions (US, UK and EU), where Kova doesn't offer the services
 * that move money through a partner: cash-outs to banks abroad and the dollar card. Read from the
 * visitor's IP, like the stocks check; a country Kova can't tell isn't refused here, because the
 * partner's own ID check comes after.
 */
export const SANCTIONED_COUNTRIES: Readonly<Record<string, string>> = {
  CU: 'Cuba',
  IR: 'Iran',
  KP: 'North Korea',
  SY: 'Syria',
  RU: 'Russia',
  BY: 'Belarus',
}

/** Refuses the request when it comes from a sanctioned country, naming it plainly. */
export function refuseSanctioned(ip: string, what: string) {
  const country = countryOf(ip)
  const name = country ? SANCTIONED_COUNTRIES[country] : undefined
  if (name)
    throw new KovaError('forbidden', `${what} isn’t available in ${name}.`, {
      country,
      sanctioned: true,
    })
}
