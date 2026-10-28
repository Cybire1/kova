import { formatTokenAmount, tokenInDollars, WALLET_TOKENS } from '@kova/monad'
import * as Haptics from 'expo-haptics'
import { Redirect, router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getMonUsd } from '@/lib/chain'
import { networkId } from '@/lib/config'
import { usePrefs } from '@/lib/prefs'
import { colors } from '@/lib/theme'
import { useWalletTokens } from '@/lib/tokens'
import { Kovi } from '@/ui/art'
import { PopIn } from '@/ui/motion'
import { canConvert, convertRoute, TokenCoin, worthText } from '@/ui/OtherTokens'
import { Chip, PillButton, TextLink, Txt } from '@/ui/primitives'

/**
 * Another token arrived (USDT0, WETH…): its moment, like dollars get, in a sheet over whatever is
 * open. Kova can turn it into dollars right here, or it stays as it is.
 */
export default function TokenArrived() {
  const params = useLocalSearchParams<{ token: string; amount: string }>()
  const insets = useSafeAreaInsets()
  const { hideBalance } = usePrefs()
  const { convertible } = useWalletTokens()
  const [usdPerMon, setUsdPerMon] = useState<number | null>(null)
  const token = WALLET_TOKENS[networkId].find(
    (t) => t.address.toLowerCase() === params.token?.toLowerCase(),
  )
  const amount = /^\d{1,78}$/.test(params.amount ?? '') ? BigInt(params.amount) : 0n

  useEffect(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    void getMonUsd()
      .then(setUsdPerMon)
      .catch(() => setUsdPerMon(null))
  }, [])

  if (!token || amount === 0n) return <Redirect href="/" />
  const worth = tokenInDollars(token, amount, usdPerMon)
  const convert = canConvert(convertible, token)
  const coins = [
    { left: '6%', top: 34, size: 30, delay: 250 },
    { left: '22%', top: 4, size: 24, delay: 400 },
    { left: '70%', top: 10, size: 28, delay: 550 },
    { left: '84%', top: 52, size: 22, delay: 700 },
  ] as const

  return (
    <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.top}>
        <Chip label="Just arrived" dot={colors.tealLight} />
      </View>
      <View style={styles.stage} accessibilityElementsHidden>
        {coins.map((c) => (
          <PopIn
            key={c.left}
            delay={c.delay}
            style={{ position: 'absolute', left: c.left, top: c.top }}
          >
            <TokenCoin token={token} size={c.size} />
          </PopIn>
        ))}
        <PopIn delay={100}>
          <Kovi pose="catch" size={130} />
        </PopIn>
      </View>
      <Txt weight="bold" size={26} style={{ textAlign: 'center' }} accessibilityRole="header">
        {hideBalance ? token.symbol : `${formatTokenAmount(token, amount)} ${token.symbol}`} arrived
      </Txt>
      {worth !== null && !hideBalance ? (
        <Txt weight="semi" size={18} color={colors.muted} style={{ textAlign: 'center' }}>
          {worthText(worth)}
        </Txt>
      ) : null}
      <Txt size={15} style={{ textAlign: 'center', lineHeight: 22 }}>
        {convert
          ? `It’s in your wallet as ${token.symbol}. Turn it into dollars to pay with Kova, or keep it as it is.`
          : `It’s in your wallet as ${token.symbol}, apart from your dollars.`}
      </Txt>
      <View style={{ gap: 14, marginTop: 6 }}>
        {convert ? (
          <PillButton
            label="Turn into dollars"
            onPress={() => router.replace(convertRoute(token))}
          />
        ) : (
          <PillButton label="Done" icon="check" onPress={() => router.back()} />
        )}
        <View style={{ alignItems: 'center' }}>
          {convert ? (
            <TextLink label={`Keep ${token.symbol}`} onPress={() => router.back()} />
          ) : (
            <TextLink label="See other tokens" onPress={() => router.replace('/tokens')} />
          )}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.surface,
    paddingHorizontal: 20,
    paddingTop: 22,
    gap: 10,
  },
  top: { flexDirection: 'row', justifyContent: 'center' },
  stage: { height: 150, alignItems: 'center', justifyContent: 'flex-end' },
})
