import type { UiMessage } from '../shared/types.js'

/** Asks the background, and throws its error as a sentence. */
export async function send<T>(message: UiMessage): Promise<T> {
  const reply = (await chrome.runtime.sendMessage(message)) as {
    ok: boolean
    value?: T
    error?: string
  }
  if (!reply?.ok) throw new Error(reply?.error ?? 'Kova didn’t answer.')
  return reply.value as T
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/** "$1,284.50"; whole dollars drop their cents when `short`. */
export function money(value: string | number, short = false): string {
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return '—'
  const text = usd.format(n)
  return short ? text.replace(/\.00$/, '') : text
}

/** "10¢" under a dollar, "$4.99" from there. */
export function price(value: string | number): string {
  const n = typeof value === 'string' ? Number(value) : value
  return n > 0 && n < 1 ? `${Math.round(n * 100)}¢` : money(n)
}

export const host = (origin: string) => {
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}

const PALETTE = [
  '#46878B',
  '#D46558',
  '#14306E',
  '#1E5B3A',
  '#7A5AF5',
  '#B5523F',
  '#2F6F9F',
  '#8A6A1F',
]

/** A site's tile: its first letter on a colour of its own, the same every time. */
export function Fav({ origin, size = 34 }: { origin: string; size?: number }) {
  const name = host(origin).replace(/^www\./, '')
  let hash = 0
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0
  return (
    <span
      className="fav"
      style={{
        background: PALETTE[hash % PALETTE.length],
        width: size,
        height: size,
        fontSize: size * 0.42,
      }}
      aria-hidden="true"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" role="img" aria-label="Kova">
      <path
        d="M62 46V154"
        stroke="currentColor"
        strokeWidth="19"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M92.6 74.3A40 40 0 0 1 92.6 125.7M115.6 55A70 70 0 0 1 115.6 145M138.6 35.7A100 100 0 0 1 138.6 164.3"
        stroke="#D46558"
        strokeWidth="17"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}

export function Word({ height = 16 }: { height?: number }) {
  return (
    <svg width={(height * 252) / 100} height={height} viewBox="0 0 252 100" aria-hidden="true">
      <g
        stroke="currentColor"
        strokeWidth="15.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path d="M8 8V92M12 70L40 38M26 56L44 92M130 40L150 92L170 40M238 40V92" />
        <circle cx="212" cy="66" r="26" />
      </g>
      <circle cx="86" cy="65" r="27" fill="#EBB3AA" stroke="currentColor" strokeWidth="15.5" />
    </svg>
  )
}

const PATHS = {
  arrow: 'M5 12h14M13 6l6 6-6 6',
  back: 'M15 6l-6 6 6 6',
  plus: 'M12 5v14M5 12h14',
  send: 'M20.5 3.5 10 14M20.5 3.5l-6 17-4.5-6.5-6.5-4.5z',
  down: 'M12 4v14M6 12l6 6 6-6',
  card: 'M3 7.5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10h18M7 15h3',
  snow: 'M12 2.5v19M4 7l16 10M4 17 20 7M9.5 4 12 6l2.5-2M9.5 20l2.5-2 2.5 2',
  shield: 'M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6zM9 12l2 2 4-4',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  pause: 'M9 5v14M15 5v14',
  key: 'M7 14.5a3.5 3.5 0 1 0 0 .01M10 13l9.5-9.5M17 6l2.5 2.5M14.5 8.5l2 2',
  trash: 'M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13',
  out: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10',
  ext: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
} as const

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg
      className="i"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

export function Monad() {
  return (
    <span className="mon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
        <path
          fill="#fff"
          d="M12 4c-2.31 0-8 5.69-8 8s5.69 8 8 8 8-5.69 8-8-5.69-8-8-8m-1.247 12.575c-.974-.266-3.593-4.847-3.328-5.822s4.848-3.593 5.822-3.328 3.593 4.847 3.328 5.822-4.847 3.593-5.822 3.328"
        />
      </svg>
    </span>
  )
}
