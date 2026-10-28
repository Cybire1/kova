import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { Pressable, StyleSheet } from 'react-native'
import { usePrefs } from '@/lib/prefs'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Icon } from './Icon'
import { Txt } from './primitives'

/**
 * The way back from shop mode to your wallet, at the top of every shop screen, as on the web: the
 * shop is a feature of the wallet, entered from Home and left from here. A phone that's only a
 * shop's till, with no wallet, has nothing to go back to and shows nothing.
 */
export function WalletBack() {
  const { setMode } = usePrefs()
  const { status } = useWallet()
  if (status !== 'ready') return null
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back to your wallet"
      hitSlop={8}
      onPress={() => {
        void Haptics.selectionAsync()
        setMode('pay')
        router.replace('/')
      }}
      style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
    >
      <Icon name="back" size={16} strokeWidth={2.4} />
      <Txt weight="semi" size={14}>
        Wallet
      </Txt>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 2,
    height: 34,
    paddingLeft: 7,
    paddingRight: 12,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  pressed: { transform: [{ scale: 0.96 }] },
})
