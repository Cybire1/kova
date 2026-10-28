import type { ColorValue } from 'react-native'
import Svg, { Circle, Path, Rect } from 'react-native-svg'
import { colors, density } from '@/lib/theme'

/**
 * Kova's own tab icons. Each one tells part of the money story: home has a coin for a door,
 * the card shows its chip and tap waves, activity is a receipt, and you are a person with a
 * coin for a head. Inactive they are quiet outlines; active, their key part fills with colour.
 *
 * The shop side has its own: orders are a paper bag to hand over, the stall wears its striped
 * awning, and today is a stack of coins that grows through the day.
 */
export type NavIconName =
  | 'home'
  | 'card'
  | 'activity'
  | 'profile'
  | 'pay'
  | 'orders'
  | 'stall'
  | 'today'
  | 'charge'

export function NavIcon({
  name,
  active,
  size = 24,
  color,
}: {
  name: NavIconName
  active?: boolean
  size?: number
  color: ColorValue
}) {
  const line = {
    stroke: color,
    strokeWidth: active ? 2 : 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  const fill = (accent: ColorValue) => (active ? accent : 'none')

  return (
    <Svg width={size * density.icon} height={size * density.icon} viewBox="0 0 24 24">
      {name === 'home' ? (
        <>
          <Path
            d="M3.8 10.4 12 3.8l8.2 6.6v8.4a1.7 1.7 0 0 1-1.7 1.7h-13a1.7 1.7 0 0 1-1.7-1.7z"
            fill={fill(colors.tealLight)}
            {...line}
          />
          <Circle cx={12} cy={15.2} r={3} fill={fill(colors.yellow)} {...line} />
          <Path d="M12 13.9v2.6" {...line} strokeWidth={1.4} />
        </>
      ) : null}
      {name === 'card' ? (
        <>
          <Rect
            x={2.8}
            y={5.8}
            width={18.4}
            height={12.4}
            rx={2.8}
            fill={fill(colors.tealLight)}
            {...line}
          />
          <Rect
            x={5.8}
            y={9.4}
            width={4.4}
            height={3.4}
            rx={0.9}
            fill={fill(colors.yellow)}
            {...line}
            strokeWidth={1.5}
          />
          <Path
            d="M14.6 10.2a2.4 2.4 0 0 1 0 3.2M17 8.8a4.6 4.6 0 0 1 0 6"
            fill="none"
            {...line}
            strokeWidth={1.5}
          />
        </>
      ) : null}
      {name === 'activity' ? (
        <>
          <Path
            d="M5.5 3.2h13v17.4l-2.2-1.6-2.1 1.6-2.2-1.6-2.2 1.6-2.1-1.6-2.2 1.6z"
            fill={fill(colors.coralSoft)}
            {...line}
          />
          <Path d="M8.6 8h6.8M8.6 11.4h6.8M8.6 14.8h3.6" fill="none" {...line} strokeWidth={1.5} />
        </>
      ) : null}
      {name === 'profile' ? (
        <>
          <Path
            d="M4.6 20.4c.9-3.9 3.9-6 7.4-6s6.5 2.1 7.4 6"
            fill={fill(colors.coralSoft)}
            {...line}
          />
          <Circle cx={12} cy={8.4} r={4.2} fill={fill(colors.yellow)} {...line} />
          {active ? (
            <Circle
              cx={12}
              cy={8.4}
              r={2.6}
              fill="none"
              {...line}
              strokeWidth={1}
              strokeDasharray="0.6 1.6"
            />
          ) : null}
        </>
      ) : null}
      {name === 'orders' ? (
        <>
          <Path
            d="M5.2 8.4h13.6l-1.1 11.3a1.4 1.4 0 0 1-1.4 1.3H7.7a1.4 1.4 0 0 1-1.4-1.3z"
            fill={fill(colors.coralSoft)}
            {...line}
          />
          <Path d="M9 8.4V7a3 3 0 0 1 6 0v1.4" fill="none" {...line} />
          <Path d="M9.4 14.2l1.8 1.8 3.5-3.6" fill="none" {...line} strokeWidth={1.6} />
        </>
      ) : null}
      {name === 'stall' ? (
        <>
          <Path
            d="M5 11.2v8.6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8.6"
            fill={fill(colors.tealLight)}
            {...line}
          />
          <Path
            d="M3.6 8.6 5.2 3.8h13.6l1.6 4.8a1.95 1.95 0 0 1-3.8.6 1.95 1.95 0 0 1-3.8 0 1.95 1.95 0 0 1-3.8 0 1.95 1.95 0 0 1-3.8 0 1.95 1.95 0 0 1-1.6-.6z"
            fill={fill(colors.coral)}
            {...line}
          />
          <Path d="M10.2 20.8v-4.6h3.6v4.6" fill="none" {...line} strokeWidth={1.5} />
        </>
      ) : null}
      {name === 'today' ? (
        <>
          <Rect
            x={5.6}
            y={16.2}
            width={12.8}
            height={4.2}
            rx={2.1}
            fill={fill(colors.yellow)}
            {...line}
          />
          <Rect
            x={4.2}
            y={11.4}
            width={12.8}
            height={4.2}
            rx={2.1}
            fill={fill(colors.yellow)}
            {...line}
          />
          <Rect
            x={7}
            y={6.6}
            width={12.8}
            height={4.2}
            rx={2.1}
            fill={fill(colors.yellow)}
            {...line}
          />
          <Path d="M5.2 3.2v2.4M4 4.4h2.4" fill="none" {...line} strokeWidth={1.5} />
        </>
      ) : null}
      {name === 'charge' ? (
        <>
          <Path
            d="M8.3 8.6a5 5 0 0 1 0 6.8M11.4 6.1a8.4 8.4 0 0 1 0 11.8M14.5 3.6a11.9 11.9 0 0 1 0 16.8"
            fill="none"
            {...line}
            strokeWidth={2.1}
          />
          <Circle cx={5} cy={12} r={1.6} fill={colors.white} />
        </>
      ) : null}
      {name === 'pay' ? (
        <>
          <Path
            d="M4 8.2V6.2a2.2 2.2 0 0 1 2.2-2.2h2M15.8 4h2a2.2 2.2 0 0 1 2.2 2.2v2M20 15.8v2a2.2 2.2 0 0 1-2.2 2.2h-2M8.2 20h-2A2.2 2.2 0 0 1 4 17.8v-2"
            fill="none"
            {...line}
            strokeWidth={2.1}
          />
          <Circle cx={12} cy={12} r={3.2} fill={colors.white} />
        </>
      ) : null}
    </Svg>
  )
}
