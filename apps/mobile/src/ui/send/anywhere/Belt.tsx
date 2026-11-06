import { StyleSheet, View } from 'react-native'
import { crossChainSender, NETWORKS } from '@/lib/crosschain'
import { colors } from '@/lib/theme'
import { Txt } from '../../primitives'
import { ChainStack } from './ChainLogo'

/** Every network Send reaches: Monad (an ordinary Kova send) and the bridge's. */
export function reachableNetworks() {
  const reach = crossChainSender()?.reach ?? []
  return NETWORKS.filter((n) => n.id === 'monad' || reach.includes(n.id))
}

/** Under Send's field: every network a send can reach, in one belt of marks. */
export function NetworkBelt() {
  const all = reachableNetworks()
  return (
    <View
      style={styles.belt}
      accessibilityLabel={`Goes to ${all.length} networks: ${all.map((n) => n.name).join(', ')}`}
    >
      <View style={styles.top}>
        <Txt weight="bold" size={15} color={colors.onFill}>
          Goes to {all.length} networks
        </Txt>
        <Txt weight="semi" size={12} color={colors.onInk}>
          No gas, one signature
        </Txt>
      </View>
      <ChainStack names={all.map((n) => n.id)} size={22} overlap={9} edge={2} />
      <Txt size={13} color={colors.onInk} style={{ lineHeight: 18 }}>
        Paste an address. Kova spots the network, and asks when it can’t tell.
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  belt: {
    marginTop: 12,
    borderRadius: 24,
    backgroundColor: colors.fill,
    paddingTop: 14,
    paddingBottom: 14,
    paddingHorizontal: 16,
    gap: 10,
  },
  top: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
})
