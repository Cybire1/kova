import { conversionStatus, formatMon, MIN_MON_CARD_BALANCE, monCardVisible } from '@kova/monad'
import { router } from 'expo-router'
import { useEffect, useRef } from 'react'
import { Pressable, View } from 'react-native'
import { isTestnet } from '@/lib/config'
import { useMonConversion } from '@/lib/mon'
import { formatUsd } from '@/lib/money'
import { usePrefs } from '@/lib/prefs'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Icon } from './Icon'
import { Sticker, Txt } from './primitives'

/** `usd`: what the MON is worth at Chainlink's MON / USD price, when there is one. */
export function MonWalletCard({ usd = null }: { usd?: bigint | null }) {
  const { monBalance } = useWallet()
  const { hideBalance } = usePrefs()
  const { pending, activity, reverted, ready, dismissedAt, dismissCard, completeCard } =
    useMonConversion()
  const completing = useRef(false)
  const completed = activity?.status === 'success' && activity.received_ausd !== null
  useEffect(() => {
    if (!completed || completing.current) return
    completing.current = true
    void completeCard()
      .catch(() => {})
      .finally(() => {
        completing.current = false
      })
  }, [completed, activity, completeCard])
  if (isTestnet || !ready || !monCardVisible(monBalance, dismissedAt, completed)) return null
  return (
    <View
      style={{
        marginTop: 12,
        padding: 12,
        borderWidth: 2,
        borderColor: colors.ink,
        borderRadius: 22,
        backgroundColor: colors.tealLight,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/convert-mon')}
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          padding: 4,
          minHeight: 56,
        }}
      >
        <Icon name="swap" />
        <View style={{ flex: 1 }}>
          <Txt weight="semi" size={15}>
            {pending
              ? reverted
                ? 'MON conversion didn’t go through'
                : conversionStatus(activity)
              : `${hideBalance ? '••••' : formatMon(monBalance!)} MON in your wallet${!hideBalance && usd ? `, ≈ ${formatUsd(usd)}` : ''}`}
          </Txt>
          <Txt size={12} color={colors.onTint} style={{ marginTop: 4 }}>
            {pending ? 'View progress and details' : 'Convert to dollars to pay with Kova'}
          </Txt>
        </View>
        <Icon name="arrow" size={18} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss MON balance"
        onPress={() => void dismissCard()}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="close" size={18} />
      </Pressable>
    </View>
  )
}

export function MonConversionEntry() {
  const { monBalance } = useWallet()
  const { pending } = useMonConversion()
  if (isTestnet || (!pending && (monBalance === null || monBalance < MIN_MON_CARD_BALANCE)))
    return null
  return (
    <Sticker
      radius={24}
      onPress={() => router.push('/convert-mon')}
      style={{ minHeight: 66, marginBottom: 12 }}
    >
      <View style={{ flex: 1, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Txt weight="semi" size={16}>
            {pending ? 'View MON conversion' : 'Convert MON in your wallet'}
          </Txt>
          <Txt size={13} color={colors.muted}>
            {pending ? 'Progress and recovery details' : 'Turn your MON into dollars to spend'}
          </Txt>
        </View>
        <Icon name="arrow" size={20} />
      </View>
    </Sticker>
  )
}
