import Svg, { Circle, Path, Rect } from 'react-native-svg'
import { colors, density } from '@/lib/theme'

/** Line icons on a 24px grid, drawn to match the illustrations' rounded ink stroke. */
const glyphs = {
  arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
  back: ['M14.5 5.5L8 12l6.5 6.5'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  search: ['M18 11a7 7 0 1 1-14 0a7 7 0 1 1 14 0', 'M20 20l-4-4'],
  bell: ['M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z', 'M10 20a2 2 0 0 0 4 0'],
  send: ['M4 12l16-8-6 16-3-6z', 'M11 14l9-10'],
  scan: [
    'M4 8V6a2 2 0 0 1 2-2h2',
    'M16 4h2a2 2 0 0 1 2 2v2',
    'M20 16v2a2 2 0 0 1-2 2h-2',
    'M8 20H6a2 2 0 0 1-2-2v-2',
    'M7 12h10',
  ],
  receive: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
  request: ['M12 20V9', 'M7 14l5-5 5 5', 'M5 4h14'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  home: ['M4 11l8-7 8 7v9H4z'],
  clock: ['M12 8v4l3 2'],
  user: ['M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6'],
  face: [
    'M4 8V6a2 2 0 0 1 2-2h2',
    'M16 4h2a2 2 0 0 1 2 2v2',
    'M20 16v2a2 2 0 0 1-2 2h-2',
    'M8 20H6a2 2 0 0 1-2-2v-2',
    'M9 9.5v1',
    'M15 9.5v1',
    'M9 15c1.8 1.4 4.2 1.4 6 0',
  ],
  lock: ['M8 11V8a4 4 0 0 1 8 0v3'],
  tap: ['M8.5 8.5a5 5 0 0 1 0 7', 'M11.5 6a8.5 8.5 0 0 1 0 12', 'M14.5 3.5a12 12 0 0 1 0 17'],
  del: ['M9 6h11v12H9l-5-6z', 'M12.5 9.5l5 5', 'M17.5 9.5l-5 5'],
  info: ['M12 11v5', 'M12 8h.01'],
  print: ['M7 9V4h10v5', 'M7 14h10v6H7z'],
  copy: ['M9 9h10v10H9z', 'M5 15V5h10'],
  share: ['M12 15V4', 'M8 8l4-4 4 4', 'M5 12v7h14v-7'],
  pen: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  snow: ['M12 3v18', 'M4.2 7.5l15.6 9', 'M19.8 7.5l-15.6 9'],
  card: ['M3 10h18'],
  bank: [
    'M3.5 9.5L12 4.5l8.5 5z',
    'M6 10.5v6.5',
    'M10 10.5v6.5',
    'M14 10.5v6.5',
    'M18 10.5v6.5',
    'M3.5 19.5h17',
  ],
  terminal: ['M7 3h10v18H7z', 'M10 17h4'],
  chart: ['M5 19V11', 'M12 19V5', 'M19 19v-6'],
  swap: ['M7 7h12', 'M15 3l4 4-4 4', 'M17 17H5', 'M9 13l-4 4 4 4'],
  eye: ['M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z'],
  eyeOff: [
    'M4 4l16 16',
    'M9.9 5.7A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.2 3.9',
    'M6.3 7.4C3.9 9.2 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.5 0 2.9-.4 4.1-1',
  ],
  down: ['M12 5v14', 'M6 13l6 6 6-6'],
  up: ['M12 19V5', 'M6 11l6-6 6 6'],
  chevronDown: ['M6.5 9.5l5.5 5.5 5.5-5.5'],
  chevronUp: ['M6.5 14.5L12 9l5.5 5.5'],
  list: ['M8 6h12', 'M8 12h12', 'M8 18h12', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
  /** Three dots, drawn as filled discs below. */
  more: [],
  stall: ['M3.5 9.5h17L19 4.5H5z', 'M5 9.5v10h14v-10', 'M10 19.5v-5h4v5'],
  tag: ['M3.5 12.5V4.5h8l9 9-8 8z', 'M8 8.5h.01'],
  camera: ['M4 8h3l1.5-2.5h7L17 8h3v11H4z', 'M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z'],
  image: ['M4 5h16v14H4z', 'M4 16l5-5 4 4 2.5-2.5L20 17', 'M15.5 8.5h.01'],
  barcode: ['M4 6v12', 'M7 6v12', 'M10.5 6v12', 'M13 6v12', 'M16.5 6v12', 'M20 6v12'],
  whatsapp: [
    'M4.5 19.5l1.2-3.6A7.5 7.5 0 1 1 8.4 18.6z',
    'M9.2 9.3c.3 1.9 1.9 3.8 4 4.6l1-1 1.6.7-.4 1.6c-3.4.2-6.6-3-6.7-6.4l1.5-.5.8 1.5z',
  ],
  trash: ['M5 7h14', 'M9 7V5h6v2', 'M7 7l1 13h8l1-13'],
  keypad: [
    'M6 5h.01',
    'M12 5h.01',
    'M18 5h.01',
    'M6 11h.01',
    'M12 11h.01',
    'M18 11h.01',
    'M6 17h.01',
    'M12 17h.01',
    'M18 17h.01',
  ],
  grid: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
  bag: ['M5 8h14l-1 12H6z', 'M9 8V6.5a3 3 0 0 1 6 0V8'],
  sparkle: [
    'M12 3.5l1.9 5.6 5.6 1.9-5.6 1.9L12 18.5l-1.9-5.6L4.5 11l5.6-1.9z',
    'M19 17v4',
    'M17 19h4',
  ],
  bolt: ['M13 3L5.5 13.5h6L10.5 21 18 10.5h-6z'],
  web: [
    'M3.5 12h17',
    'M12 3.5c2.4 2.3 3.5 5.1 3.5 8.5s-1.1 6.2-3.5 8.5c-2.4-2.3-3.5-5.1-3.5-8.5s1.1-6.2 3.5-8.5z',
  ],
  /** No signal: the wifi arcs, struck through. */
  noSignal: [
    'M3 9.5a13 13 0 0 1 18 0',
    'M6.5 13a8 8 0 0 1 11 0',
    'M9.6 16.4a3.4 3.4 0 0 1 4.8 0',
    'M12 19.6h.01',
    'M4.5 3.5l15 17',
  ],
  qr: [
    'M4 4h6v6H4z',
    'M14 4h6v6h-6z',
    'M4 14h6v6H4z',
    'M14 14h3v3h-3z',
    'M20 14v.01',
    'M14 20h.01',
    'M17.5 20H20v-3',
    'M7 7h.01',
    'M17 7h.01',
    'M7 17h.01',
  ],
} as const

export type IconName = keyof typeof glyphs

export function Icon({
  name,
  size = 22,
  color = colors.ink,
  strokeWidth = 2,
}: {
  name: IconName
  size?: number
  color?: string
  strokeWidth?: number
}) {
  const common = {
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  }
  return (
    <Svg width={size * density.icon} height={size * density.icon} viewBox="0 0 24 24">
      {name === 'clock' || name === 'info' || name === 'web' ? (
        <Circle cx={12} cy={12} r={8.5} {...common} />
      ) : null}
      {name === 'user' ? <Circle cx={12} cy={8} r={4} {...common} /> : null}
      {name === 'eye' ? <Circle cx={12} cy={12} r={3} {...common} /> : null}
      {name === 'lock' ? <Rect x={5} y={11} width={14} height={9} rx={2.5} {...common} /> : null}
      {name === 'card' ? <Rect x={3} y={6} width={18} height={12} rx={3} {...common} /> : null}
      {name === 'print' ? <Rect x={4} y={9} width={16} height={7} rx={2} {...common} /> : null}
      {name === 'more'
        ? [5, 12, 19].map((x) => <Circle key={x} cx={x} cy={12} r={2} fill={color} />)
        : null}
      {glyphs[name].map((d) => (
        <Path key={d} d={d} {...common} />
      ))}
    </Svg>
  )
}
