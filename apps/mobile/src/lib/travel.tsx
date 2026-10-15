import * as SecureStore from 'expo-secure-store'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import type {
  CreatedTrip,
  ExtraBag,
  FlightOffer,
  FlightSearch,
  Money,
  StayDetail,
  StayRate,
  StaySearch,
  Trip,
} from './api'
import { load, save } from './storage'

/**
 * Kova Travel on the phone: the booking being put together as you move through the screens,
 * and the trips you've booked.
 *
 * A trip can only be read with its token, which only this phone holds: tokens live in the
 * Keychain, one per trip, and the list beside them holds nothing private.
 */

export interface SeatPick {
  serviceId: string
  designator: string
  passengerId: string
  segmentId: string
  price: Money
}

export interface Draft {
  flight?: {
    search: FlightSearch
    offer: FlightOffer & { extra_bags?: ExtraBag[] }
    /** Extra bag service id → how many. */
    bags: Record<string, number>
    /** `${passengerId}:${segmentId}` → the seat chosen there. */
    seats: Record<string, SeatPick>
  }
  stay?: {
    search: StaySearch
    detail: StayDetail
    rate: StayRate
    room: string
  }
}

export interface SavedTrip {
  id: string
  kind: Trip['kind']
  title: string
  subtitle: string
  image: string | null
  created_at: string
}

interface TravelState {
  draft: Draft
  setDraft: (next: Draft | ((d: Draft) => Draft)) => void
  trips: SavedTrip[]
  remember: (trip: CreatedTrip) => Promise<void>
  tokenFor: (id: string) => Promise<string | null>
}

const LIST = 'kova.trips.v1'
const tokenKey = (id: string) => `kova.trip.${id}`
const Ctx = createContext<TravelState | null>(null)

export function useTravel(): TravelState {
  const value = useContext(Ctx)
  if (!value) throw new Error('useTravel must be used inside <TravelProvider>')
  return value
}

export function TravelProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<Draft>({})
  const [trips, setTrips] = useState<SavedTrip[]>([])

  useEffect(() => {
    void load<SavedTrip[]>(LIST, []).then(setTrips)
  }, [])

  const remember = useCallback(async (trip: CreatedTrip) => {
    await SecureStore.setItemAsync(tokenKey(trip.id), trip.token, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    })
    setTrips((prev) => {
      const next = [
        {
          id: trip.id,
          kind: trip.kind,
          title: trip.summary.title,
          subtitle: trip.summary.subtitle,
          image: trip.summary.provider.image,
          created_at: trip.created_at,
        },
        ...prev.filter((t) => t.id !== trip.id),
      ].slice(0, 50)
      void save(LIST, next)
      return next
    })
  }, [])

  const tokenFor = useCallback(
    (id: string) => SecureStore.getItemAsync(tokenKey(id)).catch(() => null),
    [],
  )

  return (
    <Ctx.Provider value={{ draft, setDraft, trips, remember, tokenFor }}>{children}</Ctx.Provider>
  )
}

// --- formatting ----------------------------------------------------------------------------

/** "07:35" from a supplier's local time ("2026-10-03T07:35:00"), without shifting time zones. */
export const clock = (iso: string | null | undefined) => (iso ? iso.slice(11, 16) : '--:--')

/** "Fri 3 Oct" from a date or a local time, read as written (no time zone shift). */
export function day(iso: string | null | undefined) {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, d ?? 1)).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

export const hours = (minutes: number | null | undefined) =>
  minutes == null ? '' : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`

/** Days between two ISO dates. */
export function nights(checkIn: string, checkOut: string) {
  return Math.round(
    (Date.parse(`${checkOut.slice(0, 10)}T00:00:00Z`) -
      Date.parse(`${checkIn.slice(0, 10)}T00:00:00Z`)) /
      86_400_000,
  )
}

/** The next day after `iso`, as YYYY-MM-DD. */
export function addDays(iso: string, days: number) {
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + days * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

export const today = () => new Date().toISOString().slice(0, 10)

/** What a flight booking costs in total: the fare, plus each bag and seat chosen. */
export function flightTotal(d: NonNullable<Draft['flight']>) {
  let usd = Number(d.offer.price.usd)
  for (const [id, qty] of Object.entries(d.bags)) {
    const bag = d.offer.extra_bags?.find((b) => b.id === id)
    if (bag) usd += Number(bag.price.usd) * qty
  }
  for (const seat of Object.values(d.seats)) usd += Number(seat.price.usd)
  return Math.round(usd * 100) / 100
}
