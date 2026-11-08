import type { Cabin } from '@/ui/travel/PeopleSheet'
import type { Place } from './api'
import { load, save } from './storage'

/**
 * Kova Travel starts where you are. The phone's time zone (then its region setting) picks a home
 * city, which becomes the first "From" and the ideas under the search. Once someone searches,
 * their own choices win: the last "From", cabin and party come back next time.
 *
 * Every place is a city code, which Duffel searches across all of that city's airports, with the
 * city centre's coordinates for hotel searches.
 */

const place = (
  iata: string,
  city: string,
  country: string,
  latitude: number,
  longitude: number,
): Place => ({ type: 'city', iata, name: city, city, country, latitude, longitude })

const P = {
  LOS: place('LOS', 'Lagos', 'NG', 6.5244, 3.3792),
  ACC: place('ACC', 'Accra', 'GH', 5.6037, -0.187),
  NBO: place('NBO', 'Nairobi', 'KE', -1.2921, 36.8219),
  JNB: place('JNB', 'Johannesburg', 'ZA', -26.2041, 28.0473),
  CPT: place('CPT', 'Cape Town', 'ZA', -33.9249, 18.4241),
  KGL: place('KGL', 'Kigali', 'RW', -1.9441, 30.0619),
  ADD: place('ADD', 'Addis Ababa', 'ET', 9.03, 38.74),
  KLA: place('KLA', 'Kampala', 'UG', 0.3476, 32.5825),
  DAR: place('DAR', 'Dar es Salaam', 'TZ', -6.7924, 39.2083),
  ZNZ: place('ZNZ', 'Zanzibar', 'TZ', -6.1659, 39.2026),
  CAI: place('CAI', 'Cairo', 'EG', 30.0444, 31.2357),
  CMN: place('CMN', 'Casablanca', 'MA', 33.5731, -7.5898),
  DKR: place('DKR', 'Dakar', 'SN', 14.7167, -17.4677),
  ABJ: place('ABJ', 'Abidjan', 'CI', 5.36, -4.0083),
  LON: place('LON', 'London', 'GB', 51.5072, -0.1276),
  DUB: place('DUB', 'Dublin', 'IE', 53.3498, -6.2603),
  PAR: place('PAR', 'Paris', 'FR', 48.8566, 2.3522),
  MAD: place('MAD', 'Madrid', 'ES', 40.4168, -3.7038),
  BCN: place('BCN', 'Barcelona', 'ES', 41.3874, 2.1686),
  LIS: place('LIS', 'Lisbon', 'PT', 38.7223, -9.1393),
  AMS: place('AMS', 'Amsterdam', 'NL', 52.3676, 4.9041),
  BER: place('BER', 'Berlin', 'DE', 52.52, 13.405),
  ROM: place('ROM', 'Rome', 'IT', 41.9028, 12.4964),
  IST: place('IST', 'Istanbul', 'TR', 41.0082, 28.9784),
  DXB: place('DXB', 'Dubai', 'AE', 25.2048, 55.2708),
  BOM: place('BOM', 'Mumbai', 'IN', 19.076, 72.8777),
  NYC: place('NYC', 'New York', 'US', 40.7128, -74.006),
  MIA: place('MIA', 'Miami', 'US', 25.7617, -80.1918),
  CHI: place('CHI', 'Chicago', 'US', 41.8781, -87.6298),
  LAX: place('LAX', 'Los Angeles', 'US', 34.0522, -118.2437),
  YTO: place('YTO', 'Toronto', 'CA', 43.6532, -79.3832),
  MEX: place('MEX', 'Mexico City', 'MX', 19.4326, -99.1332),
  CUN: place('CUN', 'Cancún', 'MX', 21.1619, -86.8515),
}

interface Home {
  from: Place
  ideas: Place[]
}

/** A home city and the trips people there often take. Domestic Nigerian routes are left out: no supplier Kova uses sells them yet. */
const HOMES: Record<string, Home> = {
  NG: { from: P.LOS, ideas: [P.ACC, P.LON, P.DXB, P.NBO] },
  GH: { from: P.ACC, ideas: [P.LOS, P.LON, P.DXB, P.JNB] },
  KE: { from: P.NBO, ideas: [P.ZNZ, P.DXB, P.JNB, P.LON] },
  ZA: { from: P.JNB, ideas: [P.CPT, P.LON, P.DXB, P.NBO] },
  RW: { from: P.KGL, ideas: [P.NBO, P.DXB, P.ADD, P.LON] },
  ET: { from: P.ADD, ideas: [P.NBO, P.DXB, P.LON, P.JNB] },
  UG: { from: P.KLA, ideas: [P.NBO, P.DXB, P.KGL, P.LON] },
  TZ: { from: P.DAR, ideas: [P.ZNZ, P.NBO, P.DXB, P.JNB] },
  EG: { from: P.CAI, ideas: [P.DXB, P.IST, P.LON, P.PAR] },
  MA: { from: P.CMN, ideas: [P.PAR, P.MAD, P.LON, P.IST] },
  SN: { from: P.DKR, ideas: [P.ABJ, P.PAR, P.CMN, P.LON] },
  CI: { from: P.ABJ, ideas: [P.DKR, P.ACC, P.PAR, P.CMN] },
  GB: { from: P.LON, ideas: [P.PAR, P.LIS, P.DXB, P.NYC] },
  IE: { from: P.DUB, ideas: [P.LON, P.LIS, P.PAR, P.NYC] },
  FR: { from: P.PAR, ideas: [P.LIS, P.LON, P.BCN, P.NYC] },
  ES: { from: P.MAD, ideas: [P.LIS, P.PAR, P.LON, P.NYC] },
  PT: { from: P.LIS, ideas: [P.PAR, P.LON, P.MAD, P.NYC] },
  NL: { from: P.AMS, ideas: [P.LIS, P.LON, P.BCN, P.NYC] },
  DE: { from: P.BER, ideas: [P.LIS, P.LON, P.BCN, P.NYC] },
  IT: { from: P.ROM, ideas: [P.PAR, P.LON, P.BCN, P.NYC] },
  TR: { from: P.IST, ideas: [P.LON, P.DXB, P.PAR, P.BER] },
  AE: { from: P.DXB, ideas: [P.LON, P.LOS, P.NBO, P.BOM] },
  IN: { from: P.BOM, ideas: [P.DXB, P.LON, P.IST, P.NYC] },
  CA: { from: P.YTO, ideas: [P.NYC, P.LON, P.CUN, P.PAR] },
  MX: { from: P.MEX, ideas: [P.CUN, P.NYC, P.MAD, P.LAX] },
  US: { from: P.NYC, ideas: [P.LON, P.MIA, P.CUN, P.PAR] },
}

/** Where nobody's home is known: no "From", and trips that sell from most places. */
const ANYWHERE = [P.LON, P.DXB, P.NYC, P.LIS]

/** Time zones that name a country (and, in the US, a city). */
const ZONES: Record<string, string> = {
  'Africa/Lagos': 'NG',
  'Africa/Accra': 'GH',
  'Africa/Nairobi': 'KE',
  'Africa/Johannesburg': 'ZA',
  'Africa/Kigali': 'RW',
  'Africa/Addis_Ababa': 'ET',
  'Africa/Kampala': 'UG',
  'Africa/Dar_es_Salaam': 'TZ',
  'Africa/Cairo': 'EG',
  'Africa/Casablanca': 'MA',
  'Africa/Dakar': 'SN',
  'Africa/Abidjan': 'CI',
  'Europe/London': 'GB',
  'Europe/Dublin': 'IE',
  'Europe/Paris': 'FR',
  'Europe/Madrid': 'ES',
  'Europe/Lisbon': 'PT',
  'Europe/Amsterdam': 'NL',
  'Europe/Berlin': 'DE',
  'Europe/Rome': 'IT',
  'Europe/Istanbul': 'TR',
  'Asia/Dubai': 'AE',
  'Asia/Kolkata': 'IN',
  'Asia/Calcutta': 'IN',
  'America/Toronto': 'CA',
  'America/Mexico_City': 'MX',
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Phoenix': 'US',
  'America/Los_Angeles': 'US',
}

const US_CITY: Record<string, Place> = {
  'America/Chicago': P.CHI,
  'America/Los_Angeles': P.LAX,
}

function phoneRegion(): { country: string | null; zone: string | null } {
  let zone: string | null = null
  let region: string | null = null
  try {
    const options = Intl.DateTimeFormat().resolvedOptions()
    zone = options.timeZone ?? null
    region = options.locale.split(/[-_]/)[1]?.toUpperCase() ?? null
  } catch {
    // No Intl: nowhere in particular.
  }
  // The time zone says where the phone is; the region setting is often left on "US".
  const country = (zone && ZONES[zone]) || (region && HOMES[region] ? region : null)
  return { country, zone }
}

/** The city a search starts from, guessed from the phone. Null when it can't tell. */
export function homeCity(): Place | null {
  const { country, zone } = phoneRegion()
  if (!country) return null
  if (country === 'US' && zone && US_CITY[zone]) return US_CITY[zone]
  return HOMES[country]?.from ?? null
}

/** Trip ideas from a city: the known ones for a home city, else the phone's, else anywhere. */
export function tripIdeas(from: Place | null): Place[] {
  const known = Object.values(HOMES).find((h) => from && h.from.iata === from.iata)
  const country = phoneRegion().country
  const list = known?.ideas ?? (country ? HOMES[country]?.ideas : null) ?? ANYWHERE
  return list.filter((p) => p.iata !== from?.iata).slice(0, 4)
}

/** The example trip in the "say it" box, from where the phone is. */
export function exampleTrip(from: Place | null): string {
  const to = tripIdeas(from)[0]
  return from && to
    ? `${from.city} to ${to.city} next Friday, back Sunday`
    : 'Lisbon to London next Friday, back Sunday'
}

// --- what someone chose last time ---------------------------------------------------------------

const PREFS = 'kova.travel.prefs.v1'

export interface TravelPrefs {
  from: Place | null
  cabin: Cabin
  adults: number
  children: number
  infants: number
  rooms: number
}

export const loadTravelPrefs = () => load<TravelPrefs | null>(PREFS, null)

export function saveTravelPrefs(prefs: TravelPrefs) {
  return save(PREFS, prefs).catch(() => {})
}
