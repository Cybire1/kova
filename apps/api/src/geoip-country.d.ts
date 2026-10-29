/** geoip-country ships no types: the one call Kova makes. */
declare module 'geoip-country' {
  interface Lookup {
    /** ISO 3166-1 alpha-2: "NG". */
    country: string
    name: string
  }
  const geoip: { lookup(ip: string): Lookup | null }
  export default geoip
}
