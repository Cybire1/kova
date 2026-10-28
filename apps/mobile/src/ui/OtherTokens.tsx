import { formatTokenAmount, tokenInDollars, type WalletToken, worthMentioning } from '@kova/monad'
import { router } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'
import { formatUsd } from '@/lib/money'
import { usePrefs } from '@/lib/prefs'
import { colors } from '@/lib/theme'
import { useWalletTokens } from '@/lib/tokens'
import { Icon } from './Icon'
import { Txt } from './primitives'

/**
 * Other tokens: USDC, USDT0, WETH and the rest of what a wallet can hold on Monad besides its
 * dollars (apps/web src/components/wallet/tokens.tsx on the web).
 */

/** The coins are drawn, so they keep their colours in the dark: teal for a dollar, coral for MON. */
const COIN = { dollar: '#8FB9BB', mon: '#EBB3AA', other: '#DEDCD8' } as const

export function TokenCoin({ token, size = 40 }: { token: WalletToken; size?: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: colors.dark,
        backgroundColor: COIN[token.worth ?? 'other'],
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Txt weight="bold" size={size * 0.44} color={colors.dark} exact>
        {token.glyph}
      </Txt>
    </View>
  )
}

/** "≈ $5.00", or "under $0.01" rather than a false "$0.00". */
export const worthText = (worth: bigint) =>
  worth > 0n && worth < 10_000n ? 'under $0.01' : `≈ ${formatUsd(worth)}`

export const canConvert = (convertible: WalletToken[], token: WalletToken) =>
  convertible.some((t) => t.address.toLowerCase() === token.address.toLowerCase())

export const convertRoute = (token: WalletToken) =>
  ({ pathname: '/tokens', params: { convert: token.symbol } }) as const

/** Home: what else the wallet holds, a tap from turning it into dollars. Nothing when there's none. */
export function OtherTokensCard({ usdPerMon = null }: { usdPerMon?: number | null }) {
  const { held: all, convertible } = useWalletTokens()
  const { hideBalance } = usePrefs()
  // Dust stays off Home; the Other tokens screen still lists it.
  const held = all.filter((h) => worthMentioning(h.token, h.amount))
  if (held.length === 0) return null
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Other tokens. In your wallet, apart from your dollars"
        onPress={() => router.push('/tokens')}
        style={styles.head}
      >
        <View style={{ flex: 1 }}>
          <Txt weight="semi" size={15}>
            Other tokens
          </Txt>
          <Txt size={12} color={colors.muted} style={{ marginTop: 2 }}>
            In your wallet, apart from your dollars
          </Txt>
        </View>
        <Icon name="arrow" size={18} />
      </Pressable>
      {held.slice(0, 3).map(({ token, amount }, i) => {
        const worth = tokenInDollars(token, amount, usdPerMon)
        const convert = canConvert(convertible, token)
        const shown = `${hideBalance ? '••••' : formatTokenAmount(token, amount)} ${token.symbol}`
        return (
          <Pressable
            key={token.address}
            accessibilityRole="button"
            accessibilityLabel={convert ? `${shown}. Turn into dollars` : shown}
            onPress={() => router.push(convert ? convertRoute(token) : '/tokens')}
            style={({ pressed }) => [
              styles.row,
              i > 0 && styles.rule,
              pressed && { backgroundColor: colors.sunken },
            ]}
          >
            <TokenCoin token={token} size={36} />
            <View style={{ flex: 1 }}>
              <Txt weight="semi" size={15}>
                {shown}
              </Txt>
              <Txt size={12} color={colors.muted} style={{ marginTop: 2 }}>
                {worth !== null && !hideBalance ? worthText(worth) : token.name}
              </Txt>
            </View>
            {convert ? (
              <View style={styles.chip}>
                <Txt weight="bold" size={12} color={colors.onChosen}>
                  Turn into dollars
                </Txt>
              </View>
            ) : null}
          </Pressable>
        )
      })}
      {held.length > 3 ? (
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push('/tokens')}
          style={[styles.row, styles.rule, { minHeight: 44 }]}
        >
          <Txt weight="bold" size={13}>
            See all {held.length}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: 22,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
    minHeight: 44,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  rule: { borderTopWidth: 1, borderTopColor: colors.sunken },
  // Ink, and cream in the dark, so the way to dollars stands out on a card in either.
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.chosen,
  },
})
