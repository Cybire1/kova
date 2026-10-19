import Link from 'next/link'

/**
 * Kova's brand on the web: the Tap K mark, the wordmark (its o is a coin) and the painted art.
 * Geometry matches the app's ui/Logo.tsx and docs/design/logo/*.svg.
 */

const STEM = 'M62 46 V154'
const WAVES = [
  'M92.6 74.3 A40 40 0 0 1 92.6 125.7',
  'M115.6 55 A70 70 0 0 1 115.6 145',
  'M138.6 35.7 A100 100 0 0 1 138.6 164.3',
]

export function LogoMark({
  size = 40,
  stem = 'var(--ink)',
  wave = 'var(--coral)',
}: {
  size?: number
  stem?: string
  wave?: string
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" role="img" aria-label="Kova">
      <path d={STEM} stroke={stem} strokeWidth={19} strokeLinecap="round" />
      {WAVES.map((d) => (
        <path key={d} d={d} stroke={wave} strokeWidth={17} strokeLinecap="round" fill="none" />
      ))}
    </svg>
  )
}

export function Wordmark({
  height = 24,
  ink = 'var(--ink)',
  coin = 'var(--coral-soft)',
}: {
  height?: number
  ink?: string
  coin?: string
}) {
  const line = {
    stroke: ink,
    strokeWidth: 15.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  }
  return (
    <svg
      width={(height * 252) / 100}
      height={height}
      viewBox="0 0 252 100"
      role="img"
      aria-label="Kova"
    >
      <path d="M8 8 V92" {...line} />
      <path d="M12 70 L40 38" {...line} />
      <path d="M26 56 L44 92" {...line} />
      <circle cx={86} cy={65} r={27} fill={coin} stroke={ink} strokeWidth={15.5} />
      <path d="M130 40 L150 92 L170 40" {...line} />
      <circle cx={212} cy={66} r={26} {...line} />
      <path d="M238 40 V92" {...line} />
    </svg>
  )
}

/** Mark + wordmark + what this surface is, e.g. "Merchant". */
export function Brand({ label, href = '/' }: { label?: string; href?: string }) {
  return (
    <Link href={href} className="brand" aria-label="Kova home">
      <LogoMark size={34} />
      <Wordmark height={20} />
      {label ? <span className="brand-label">{label}</span> : null}
    </Link>
  )
}

/** Painted art in /public/art, with each image's height over its width. */
const ART = {
  'kovi-wave': 1,
  'kovi-cheer': 1,
  'kovi-oops': 1,
  'kovi-catch': 1,
  'kovi-key': 1,
  'kovi-ride': 1,
  'kovi-sleep': 1,
  'kovi-peek': 0.5,
  'badge-shop': 1,
  'badge-add': 1,
  'scene-paid-terminal': 750 / 720,
  'scene-welcome': 903 / 1100,
  'scene-send': 510 / 1026,
  'scene-faceid': 900 / 1080,
  'scene-coin-rain': 846 / 1100,
  'card-active': 825 / 1100,
  'coin-usd': 1,
  'coin-eur': 1,
  'coin-gbp': 1,
  'coin-ngn': 1,
  'avatar-1': 1,
  'avatar-2': 1,
  'avatar-3': 1,
  'avatar-4': 1,
  'avatar-5': 1,
  'avatar-6': 1,
  'avatar-7': 1,
  plane: 1,
  'sparkle-4': 1,
  'sparkle-8': 1,
  'sparkle-11': 1,
} as const

export type ArtName = keyof typeof ART

export function Art({
  name,
  size,
  className,
  alt = '',
  priority,
  style,
}: {
  name: ArtName
  size: number
  className?: string
  alt?: string
  priority?: boolean
  style?: React.CSSProperties
}) {
  return (
    // biome-ignore lint/performance/noImgElement: pre-sized WebP art, no optimizer needed
    <img
      src={`/art/${name}.webp`}
      width={size}
      height={Math.round(size * ART[name])}
      className={className}
      alt={alt}
      draggable={false}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      style={style}
    />
  )
}

const glyphs = {
  arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
  back: ['M14.5 5.5L8 12l6.5 6.5'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  plus: ['M12 5v14', 'M5 12h14'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  terminal: ['M7 3h10v18H7z', 'M10 17h4'],
  tap: ['M8.5 8.5a5 5 0 0 1 0 7', 'M11.5 6a8.5 8.5 0 0 1 0 12', 'M14.5 3.5a12 12 0 0 1 0 17'],
  del: ['M9 6h11v12H9l-5-6z', 'M12.5 9.5l5 5', 'M17.5 9.5l-5 5'],
  copy: ['M9 9h10v10H9z', 'M5 15V5h10'],
  refresh: ['M19 12a7 7 0 1 1-2.05-4.95', 'M19 4v4h-4'],
  home: ['M4 11l8-7 8 7v9H4z', 'M10 20v-5h4v5'],
  list: ['M8 6h12', 'M8 12h12', 'M8 18h12', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
  code: ['M8 7l-5 5 5 5', 'M16 7l5 5-5 5', 'M13.5 4l-3 16'],
  settings: ['M4 7h10', 'M18 7h2', 'M4 17h2', 'M10 17h10', 'M16 5v4', 'M8 15v4'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-4-4'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v6H4V6h6'],
  mail: ['M4 6.5h16v11H4z', 'M4.5 7l7.5 6 7.5-6'],
  key: ['M14.5 13a5 5 0 1 0-4.24-2.35L4 17v3h3v-2h2v-2h2l1.5-1.5', 'M16 8h.01'],
  bolt: ['M13 3L5 14h6l-1 7 8-11h-6z'],
  out: ['M10 4H5v16h5', 'M15 8l4 4-4 4', 'M19 12H9'],
  download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
  chevron: ['M9.5 5.5L16 12l-6.5 6.5'],
  eye: [
    'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z',
    'M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  ],
  globe: [
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
    'M3 12h18',
    'M12 3c2.5 2.7 3.5 5.7 3.5 9s-1 6.3-3.5 9c-2.5-2.7-3.5-5.7-3.5-9s1-6.3 3.5-9z',
  ],
  shield: ['M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z', 'M8.5 12l2.5 2.5 4.5-5'],
  send: ['M4 12l16-8-6 16-3-6z', 'M11 14l9-10'],
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  stall: ['M3.5 9.5h17L19 4.5H5z', 'M5 9.5v10h14v-10', 'M10 19.5v-5h4v5'],
  tag: ['M3.5 12.5V4.5h8l9 9-8 8z', 'M8 8.5h.01'],
  camera: ['M4 8h3l1.5-2.5h7L17 8h3v11H4z', 'M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z'],
  barcode: ['M4 6v12', 'M7 6v12', 'M10.5 6v12', 'M13 6v12', 'M16.5 6v12', 'M20 6v12'],
  whatsapp: [
    'M4.5 19.5l1.2-3.6A7.5 7.5 0 1 1 8.4 18.6z',
    'M9.2 9.3c.3 1.9 1.9 3.8 4 4.6l1-1 1.6.7-.4 1.6c-3.4.2-6.6-3-6.7-6.4l1.5-.5.8 1.5z',
  ],
  up: ['M12 19V5', 'M6 11l6-6 6 6'],
  bag: ['M5.5 8h13l-1.2 12.5H6.7z', 'M9 10V7a3 3 0 0 1 6 0v3'],
  share: ['M12 15V4', 'M8 8l4-4 4 4', 'M5 12v7h14v-7'],
  trash: ['M5 7h14', 'M9 7V5h6v2', 'M7 7l1 13h8l1-13'],
  // The wallet's glyphs, as the app draws them (apps/mobile src/ui/Icon.tsx), circles and boxes as paths.
  bell: ['M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z', 'M10 20a2 2 0 0 0 4 0'],
  scan: [
    'M4 8V6a2 2 0 0 1 2-2h2',
    'M16 4h2a2 2 0 0 1 2 2v2',
    'M20 16v2a2 2 0 0 1-2 2h-2',
    'M8 20H6a2 2 0 0 1-2-2v-2',
    'M7 12h10',
  ],
  receive: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
  request: ['M12 20V9', 'M7 14l5-5 5 5', 'M5 4h14'],
  minus: ['M5 12h14'],
  clock: ['M12 3.5a8.5 8.5 0 1 0 0 17.0a8.5 8.5 0 1 0 0 -17.0z', 'M12 8v4l3 2'],
  user: ['M12 4a4 4 0 1 0 0 8a4 4 0 1 0 0 -8z', 'M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6'],
  face: [
    'M4 8V6a2 2 0 0 1 2-2h2',
    'M16 4h2a2 2 0 0 1 2 2v2',
    'M20 16v2a2 2 0 0 1-2 2h-2',
    'M8 20H6a2 2 0 0 1-2-2v-2',
    'M9 9.5v1',
    'M15 9.5v1',
    'M9 15c1.8 1.4 4.2 1.4 6 0',
  ],
  lock: [
    'M7 11h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z',
    'M8 11V8a4 4 0 0 1 8 0v3',
  ],
  info: ['M12 3.5a8.5 8.5 0 1 0 0 17.0a8.5 8.5 0 1 0 0 -17.0z', 'M12 11v5', 'M12 8h.01'],
  pen: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
  eyeOff: [
    'M4 4l16 16',
    'M9.9 5.7A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.2 3.9',
    'M6.3 7.4C3.9 9.2 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.5 0 2.9-.4 4.1-1',
  ],
  chevronDown: ['M6.5 9.5l5.5 5.5 5.5-5.5'],
  card: ['M5 5.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z', 'M3 10h18'],
  down: ['M12 5v14', 'M6 13l6 6 6-6'],
  link: [
    'M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1',
    'M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1',
  ],
  gift: [
    'M4 11h16v9H4z',
    'M3 7h18v4H3z',
    'M12 7v13',
    'M12 7c-1.5-3-5-3.5-5-1.2C7 7 9.5 7 12 7z',
    'M12 7c1.5-3 5-3.5 5-1.2C17 7 14.5 7 12 7z',
  ],
} as const

export type IconName = keyof typeof glyphs

export function Icon({
  name,
  size = 20,
  color = 'currentColor',
}: {
  name: IconName
  size?: number
  color?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {glyphs[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

export type NavIconName = 'home' | 'activity' | 'people' | 'profile' | 'pay'

/**
 * The dock's own icons, drawn as the app draws them (apps/mobile src/ui/NavIcons.tsx): home has a
 * coin for a door, activity is a receipt, people are two of you. Inactive they are quiet outlines;
 * active, their key part fills with colour.
 */
export function NavIcon({
  name,
  active,
  size = 22,
}: {
  name: NavIconName
  active?: boolean
  size?: number
}) {
  const line = {
    stroke: 'currentColor',
    strokeWidth: active ? 2 : 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  const fill = (accent: string) => (active ? accent : 'none')
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {name === 'home' ? (
        <>
          <path
            d="M3.8 10.4 12 3.8l8.2 6.6v8.4a1.7 1.7 0 0 1-1.7 1.7h-13a1.7 1.7 0 0 1-1.7-1.7z"
            fill={fill('#8fb9bb')}
            {...line}
          />
          <circle cx={12} cy={15.2} r={3} fill={fill('var(--coral-soft)')} {...line} />
          <path d="M12 13.9v2.6" {...line} strokeWidth={1.4} />
        </>
      ) : null}
      {name === 'activity' ? (
        <>
          <path
            d="M5.5 3.2h13v17.4l-2.2-1.6-2.1 1.6-2.2-1.6-2.2 1.6-2.1-1.6-2.2 1.6z"
            fill={fill('var(--coral-soft)')}
            {...line}
          />
          <path d="M8.6 8h6.8M8.6 11.4h6.8M8.6 14.8h3.6" fill="none" {...line} strokeWidth={1.5} />
        </>
      ) : null}
      {name === 'people' ? (
        <>
          <path d="M14.2 14.3c.6-.2 1.3-.3 2-.3 2.6 0 4.6 1.7 5.3 4.9" fill="none" {...line} />
          <circle cx={16.2} cy={8.6} r={3} fill={fill('#8fb9bb')} {...line} />
          <path
            d="M2.6 20.4c.8-3.7 3.4-5.8 6.5-5.8s5.7 2.1 6.5 5.8"
            fill={fill('var(--coral-soft)')}
            {...line}
          />
          <circle cx={9.1} cy={9} r={3.7} fill={fill('var(--coral-soft)')} {...line} />
        </>
      ) : null}
      {name === 'profile' ? (
        <>
          <path
            d="M4.6 20.4c.9-3.9 3.9-6 7.4-6s6.5 2.1 7.4 6"
            fill={fill('var(--coral-soft)')}
            {...line}
          />
          <circle cx={12} cy={8.4} r={4.2} fill={fill('var(--coral-soft)')} {...line} />
        </>
      ) : null}
      {name === 'pay' ? (
        <>
          <path
            d="M4 8.2V6.2a2.2 2.2 0 0 1 2.2-2.2h2M15.8 4h2a2.2 2.2 0 0 1 2.2 2.2v2M20 15.8v2a2.2 2.2 0 0 1-2.2 2.2h-2M8.2 20h-2A2.2 2.2 0 0 1 4 17.8v-2"
            fill="none"
            {...line}
            strokeWidth={2.1}
          />
          <circle cx={12} cy={12} r={3.2} fill="currentColor" />
        </>
      ) : null}
    </svg>
  )
}

/** The app's pill button: label on the left, its icon in a round cap on the right. */
export function Pill({
  children,
  icon = 'arrow',
  href,
  onClick,
  disabled,
  tone = 'ink',
  type = 'button',
  className,
  wide,
}: {
  children: React.ReactNode
  icon?: IconName
  href?: string
  onClick?: () => void
  disabled?: boolean
  tone?: 'ink' | 'coral' | 'light' | 'paper'
  type?: 'button' | 'submit'
  className?: string
  wide?: boolean
}) {
  const inner = (
    <>
      <span className="pill-label">{children}</span>
      <span className="pill-cap">
        <Icon name={icon} size={18} />
      </span>
    </>
  )
  const props = {
    className: `pill${wide ? ' pill-block' : ''}${className ? ` ${className}` : ''}`,
    'data-tone': tone,
  }
  if (href)
    return href.startsWith('/') ? (
      <Link href={href} {...props}>
        {inner}
      </Link>
    ) : (
      <a href={href} {...props}>
        {inner}
      </a>
    )
  return (
    <button type={type} onClick={onClick} disabled={disabled} {...props}>
      {inner}
    </button>
  )
}
