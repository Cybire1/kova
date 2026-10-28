import Svg, { G, Path, Rect } from 'react-native-svg'
import { colors, pair } from '@/lib/theme'

/** The awning's light stripe: a shade warmer than white, like canvas. In the dark the awning keeps
 * its stripes, quietened (as on mykova.app). */
export const canvas = pair('#F8F7F3', '#242424')
const coralStripe = pair('#D46558', '#5C2B25')
const tealStripe = pair('#46878B', '#1F3A3C')

/**
 * A market stall's awning: coral and canvas stripes with a scalloped edge, outlined in ink like
 * everything else. It marks a Kova Stall wherever one appears, on the web and here. Closed, the
 * stripes turn teal.
 *
 * Drawn in points for the width it is given, so stripes keep their size on any screen.
 */
export function Awning({
  width,
  height = 56,
  stripe = 26,
  tone = 'coral',
}: {
  width: number
  height?: number
  stripe?: number
  tone?: 'coral' | 'teal'
}) {
  const fill = tone === 'coral' ? coralStripe : tealStripe
  const r = stripe / 2
  // Leave room under the scallops for their outline.
  const edge = height - r - 1.5
  const count = Math.ceil(width / stripe)
  return (
    <Svg width={width} height={height} accessible={false}>
      {Array.from({ length: count }, (_, i) => {
        const x = i * stripe
        const color = i % 2 === 0 ? fill : canvas
        return (
          <G key={i}>
            <Rect x={x} y={0} width={stripe} height={edge} fill={color} />
            <Path
              d={`M${x} ${edge} A${r} ${r} 0 0 0 ${x + stripe} ${edge} Z`}
              fill={color}
              stroke={colors.line}
              strokeWidth={2}
              strokeLinejoin="round"
            />
          </G>
        )
      })}
      <Rect x={0} y={0} width={width} height={2} fill={colors.line} />
    </Svg>
  )
}
