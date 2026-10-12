'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { agoText } from '@/lib/growth'

/**
 * How fresh the numbers on Kova, live are, and the page kept live: while it's open and in view it
 * asks for the latest once a minute (the server holds them a minute), so a screen left on /stats
 * keeps counting on its own. The first paint says "every minute"; the browser then says how long ago.
 */
export function LiveUpdated({ at }: { at: string | null }) {
  const router = useRouter()
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const tick = setInterval(() => setNow(Date.now()), 15_000)
    const refresh = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh()
    }, 60_000)
    const back = () => {
      if (document.visibilityState === 'visible') {
        setNow(Date.now())
        router.refresh()
      }
    }
    document.addEventListener('visibilitychange', back)
    return () => {
      clearInterval(tick)
      clearInterval(refresh)
      document.removeEventListener('visibilitychange', back)
    }
  }, [router])

  return (
    <p className="gr-updated">
      <span className="gr-pulse" aria-hidden="true" />
      {at ? (
        <time dateTime={at}>Updated {now === null ? 'every minute' : agoText(at, now)}</time>
      ) : (
        'Numbers update every minute'
      )}
    </p>
  )
}
