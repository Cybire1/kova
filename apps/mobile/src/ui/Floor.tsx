import Svg, { Ellipse, Path } from 'react-native-svg'
import { colors } from '@/lib/theme'

const ink = colors.ink

/** A minimal paper-cut floor: a disc with a thin edge and a soft shadow where Kovi stands. */
export function Floor({
  width = 180,
  top = colors.surface,
  side = colors.sunken,
}: {
  width?: number
  top?: string
  side?: string
}) {
  const h = width * 0.2
  const rx = width / 2 - 3
  const ry = h / 2 - 5
  return (
    <Svg width={width} height={h} viewBox={`${-width / 2} ${-h / 2} ${width} ${h}`}>
      <Path
        d={`M${-rx} -2 A${rx} ${ry} 0 0 0 ${rx} -2 L${rx} 4 A${rx} ${ry} 0 0 1 ${-rx} 4 Z`}
        fill={side}
        stroke={ink}
        strokeWidth={2.4}
        strokeLinejoin="round"
      />
      <Ellipse cx={0} cy={-2} rx={rx} ry={ry} fill={top} stroke={ink} strokeWidth={2.4} />
      <Ellipse cx={0} cy={-3} rx={rx * 0.34} ry={ry * 0.42} fill={ink} opacity={0.12} />
    </Svg>
  )
}
