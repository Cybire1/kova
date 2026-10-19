import { useEffect, useRef, useState } from 'react'
import type { Entry } from '@/components/wallet/provider'

/** Public history and the first private scan catch up independently; neither replays old money. */
export function useArrivals(
  wallet: string | undefined,
  activity: Entry[],
  publicReady: boolean,
  privateReady: boolean,
) {
  const state = useRef({ wallet, publicReady: false, privateReady: false, seen: new Set<string>() })
  const [queue, setQueue] = useState<{ wallet: string; entries: Entry[] } | null>(null)
  useEffect(() => {
    if (state.current.wallet !== wallet) {
      state.current = { wallet, publicReady: false, privateReady: false, seen: new Set() }
      setQueue(null)
    }
    if (!wallet) return
    const session = state.current
    const arriving: Entry[] = []
    for (const privately of [false, true]) {
      const ready = privately ? privateReady : publicReady
      const wasReady = privately ? session.privateReady : session.publicReady
      const entries = activity.filter((entry) => Boolean(entry.oneTime) === privately)
      if (!ready) continue
      for (const entry of entries) {
        const seen = session.seen.has(entry.id)
        session.seen.add(entry.id)
        if (
          !wasReady ||
          seen ||
          (entry.kind !== 'received' && entry.kind !== 'added') ||
          BigInt(entry.amount) <= 0n ||
          entry.link ||
          entry.address?.toLowerCase() === wallet.toLowerCase() ||
          (privately && !entry.waiting) ||
          (entry.kind === 'added' && entry.name === 'Test dollars')
        )
          continue
        arriving.push(entry)
      }
    }
    session.publicReady = publicReady
    session.privateReady = privateReady
    if (arriving.length)
      setQueue((current) => ({
        wallet,
        entries: [
          ...(current?.wallet === wallet ? current.entries : []),
          ...arriving.sort((a, b) => a.at - b.at),
        ],
      }))
  }, [wallet, activity, publicReady, privateReady])
  return {
    arrival: queue?.wallet === wallet ? (queue?.entries[0] ?? null) : null,
    dismiss: () =>
      setQueue((current) => (current ? { ...current, entries: current.entries.slice(1) } : null)),
  }
}
