import { type StyleProp, View, type ViewStyle } from 'react-native'
import { SvgXml } from 'react-native-svg'
import { NETWORKS, type NetworkId } from '@/lib/crosschain'
import { colors } from '@/lib/theme'
import { Txt } from '../../primitives'
import { chainLogoXml } from './chain-logos'

export type LogoName = NetworkId | 'usdc'

/**
 * A network's mark in a round frame with Kova's 2px ink edge. A network Kova has no mark for yet
 * (Arc, Edge) gets its initial instead of a guess at its logo.
 */
export function ChainLogo({
  name,
  size = 36,
  edge = 2,
  style,
}: {
  name: LogoName
  size?: number
  edge?: number
  style?: StyleProp<ViewStyle>
}) {
  const xml = (chainLogoXml as Record<string, string>)[name]
  const label = NETWORKS.find((n) => n.id === name)?.name ?? name
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: edge,
          borderColor: colors.edge,
          overflow: 'hidden',
          backgroundColor: xml ? colors.white : colors.fill,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      {xml ? (
        <SvgXml xml={xml} width="100%" height="100%" />
      ) : (
        <Txt weight="bold" size={Math.max(8, size * 0.42)} color={colors.onFill} exact>
          {label.charAt(0)}
        </Txt>
      )}
    </View>
  )
}

/** Overlapping marks, for "goes to all of these". */
export function ChainStack({
  names,
  size = 18,
  overlap = 6,
  edge = 1.5,
}: {
  names: LogoName[]
  size?: number
  overlap?: number
  edge?: number
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {names.map((n, i) => (
        <ChainLogo
          key={n}
          name={n}
          size={size}
          edge={edge}
          style={i ? { marginLeft: -overlap } : undefined}
        />
      ))}
    </View>
  )
}
