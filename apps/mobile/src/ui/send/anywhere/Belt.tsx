import { Pressable, StyleSheet, View } from 'react-native'
import { crossChainSender, NETWORKS } from '@/lib/crosschain'
import { colors } from '@/lib/theme'
import { Icon } from '../../Icon'
import { Txt } from '../../primitives'
import { ChainLogo } from './ChainLogo'

/** Every network Send reaches: Monad (an ordinary Kova send) and the bridge's. */
export function reachableNetworks() {
  const reach = crossChainSender()?.reach ?? []
  return NETWORKS.filter((n) => n.id === 'monad' || reach.includes(n.id))
}

/**
 * In Send, beside "Send as a link": one row that says what it does and opens it, rather than a
 * block of every network's mark that looked like a button and wasn't one.
 */
export function AnyNetworkRow({ onPress }: { onPress: () => void }) {
  const others = reachableNetworks().filter((n) => n.id !== 'monad')
  const more = Math.max(0, others.length - 3)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Send to another network: Base, Solana, Ethereum and ${more} more`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { transform: [{ scale: 0.98 }] }]}
    >
      <View style={styles.badge}>
        <ChainLogo name="base" size={22} edge={1.5} style={[styles.mini, { left: 0, top: 0 }]} />
        <ChainLogo name="solana" size={22} edge={1.5} style={[styles.mini, { right: 0, top: 0 }]} />
        <ChainLogo
          name="ethereum"
          size={22}
          edge={1.5}
          style={[styles.mini, { left: 0, bottom: 0 }]}
        />
        <ChainLogo
          name="arbitrum"
          size={22}
          edge={1.5}
          style={[styles.mini, { right: 0, bottom: 0 }]}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Txt weight="semi" size={16}>
          Send to another network
        </Txt>
        <Txt size={13} color={colors.muted} numberOfLines={1}>
          Base, Solana, Ethereum and {more} more
        </Txt>
      </View>
      <View style={styles.go}>
        <Icon name="arrow" size={16} />
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    marginTop: 12,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  badge: { width: 40, height: 40 },
  mini: { position: 'absolute' },
  go: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
