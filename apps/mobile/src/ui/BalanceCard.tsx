import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import Svg, { Circle } from 'react-native-svg'
import { baseToNumber, type DisplayCurrency, formatLocal, formatUsd } from '@/lib/money'
import { usePrefs } from '@/lib/prefs'
import { colors } from '@/lib/theme'
import { Coin } from './art'
import { Icon } from './Icon'
import { Txt } from './primitives'

/** Secondary text on teal. */
const onTeal = '#DCEBEA'

/**
 * The balance, as the first thing on Home: dollars as the headline with the sign and cents set
 * small and raised like a price tag, the local equivalent as a chip, and a one-tap way to hide it
 * all when someone is looking over your shoulder. It is one balance: dollars sent to you privately
 * count in it the moment they're found, and tapping the amount shows how much of it is private.
 */
export function BalanceCard({
  balance,
  privateAmount = 0n,
  onPrivate,
  currency,
  takings,
  waiting,
  splitOpen = false,
}: {
  /** Development only: start with the split shown, for screenshots (Home's dev link `split=1`). */
  splitOpen?: boolean
  /** The wallet's own balance on Monad. */
  balance: bigint | null
  /** Dollars sent to this wallet privately, at addresses only its keys can open: part of the balance shown. */
  privateAmount?: bigint
  /** Opens the private dollars, from the split. */
  onPrivate?: () => void
  currency: DisplayCurrency
  /**
   * The shop's private takings, still at their sales' one-time addresses: money the balance can't
   * see, so it's shown beside it, a tap from moving it home.
   */
  takings?: { amount: bigint; onPress: () => void } | null
  /**
   * Offline payments signed but not settled: what this wallet has promised in codes, and what was
   * promised to it. Not in the balance until they settle on Monad.
   */
  waiting?: { out: bigint; in: bigint; onPress: () => void } | null
}) {
  const { hideBalance, setHideBalance } = usePrefs()
  const total = balance === null ? null : balance + privateAmount
  const shown = useCounted(total)
  const usd = shown === null ? null : formatUsd(shown)
  const [whole, cents] =
    usd === null ? ['—', ''] : [usd.slice(1, usd.lastIndexOf('.')), usd.slice(usd.lastIndexOf('.'))]
  const hasPrivate = privateAmount > 0n
  /** The split, shown on a tap of the amount: how much of it is private. */
  const [split, setSplit] = useState(splitOpen)
  const splitShown = split && hasPrivate

  return (
    <View
      style={styles.card}
      accessibilityLabel={
        hideBalance
          ? 'Balance hidden'
          : `Available ${usd ?? 'loading'}${hasPrivate && total !== null ? `, ${formatUsd(privateAmount)} of it private` : ''}`
      }
    >
      <Svg
        width={220}
        height={220}
        viewBox="-110 -110 220 220"
        style={styles.rings}
        pointerEvents="none"
      >
        {[104, 78, 52, 26].map((r) => (
          <Circle key={r} r={r} fill="none" stroke={colors.tealDeep} strokeWidth={2} />
        ))}
      </Svg>
      <View style={styles.coins} pointerEvents="none">
        <View style={{ transform: [{ rotate: '-14deg' }] }}>
          <Coin size={44} symbol="$" />
        </View>
        <View style={styles.coinBack}>
          <Coin size={34} symbol="€" />
        </View>
      </View>

      <View style={styles.top}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={hideBalance ? 'Show balance' : 'Hide balance'}
          hitSlop={10}
          onPress={() => {
            void Haptics.selectionAsync()
            setHideBalance(!hideBalance)
          }}
          style={styles.label}
        >
          <Txt weight="medium" size={15} color={onTeal}>
            Available
          </Txt>
          <Icon name={hideBalance ? 'eyeOff' : 'eye'} size={18} color={onTeal} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add money"
          hitSlop={8}
          onPress={() => router.push('/add-money')}
          style={({ pressed }) => [styles.add, pressed && { transform: [{ scale: 0.96 }] }]}
        >
          <Icon name="plus" size={16} />
          <Txt weight="semi" size={14}>
            Add
          </Txt>
        </Pressable>
      </View>

      <Pressable
        accessibilityRole={hasPrivate ? 'button' : undefined}
        accessibilityLabel={
          hasPrivate
            ? splitShown
              ? 'Hide how much is private'
              : 'Show how much is private'
            : undefined
        }
        disabled={!hasPrivate}
        onPress={() => {
          void Haptics.selectionAsync()
          setSplit(!split)
        }}
        style={styles.amount}
      >
        {hideBalance ? (
          <Txt weight="bold" size={44} color={colors.white} style={{ letterSpacing: 4 }}>
            ••••••
          </Txt>
        ) : (
          <>
            <Txt weight="semi" size={26} color={onTeal} style={styles.sign}>
              $
            </Txt>
            <Txt
              weight="bold"
              size={54}
              color={colors.white}
              style={styles.whole}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.5}
            >
              {whole}
            </Txt>
            <Txt weight="semi" size={24} color={onTeal} style={styles.cents}>
              {cents}
            </Txt>
          </>
        )}
        {hasPrivate && !splitShown ? (
          <View style={styles.hint}>
            <Icon name="lock" size={13} color={onTeal} strokeWidth={2.4} />
          </View>
        ) : null}
      </Pressable>

      {splitShown ? (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(140)}
          style={styles.splitRow}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              hideBalance
                ? 'Some of it is private. Open private dollars'
                : `${formatUsd(privateAmount)} of it private. Open private dollars`
            }
            hitSlop={6}
            onPress={onPrivate}
            style={({ pressed }) => [
              styles.chip,
              styles.private,
              pressed && { transform: [{ scale: 0.96 }] },
            ]}
          >
            <Icon name="lock" size={13} color={colors.white} strokeWidth={2.4} />
            <Txt weight="semi" size={13} color={colors.white}>
              {hideBalance ? '•••• of it private' : `${formatUsd(privateAmount)} of it private`}
            </Txt>
            {onPrivate ? (
              <Icon name="arrow" size={13} color={colors.onInk} strokeWidth={2.4} />
            ) : null}
          </Pressable>
        </Animated.View>
      ) : null}

      <View style={styles.chips}>
        {total !== null && currency !== 'USD' ? (
          <View style={styles.chip}>
            <Txt weight="medium" size={13} color={colors.white}>
              {hideBalance ? '≈ ••••' : `≈ ${formatLocal(baseToNumber(total), currency)}`}
            </Txt>
          </View>
        ) : null}
        {takings ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              hideBalance
                ? 'Private takings waiting. Open them'
                : `${formatUsd(takings.amount)} in private takings, waiting to move to your wallet`
            }
            hitSlop={6}
            onPress={takings.onPress}
            style={({ pressed }) => [
              styles.chip,
              styles.takings,
              pressed && { transform: [{ scale: 0.96 }] },
            ]}
          >
            <Icon name="lock" size={13} color={colors.ink} strokeWidth={2.4} />
            <Txt weight="semi" size={13}>
              {hideBalance
                ? '+•••• private takings'
                : `+${formatUsd(takings.amount)} private takings`}
            </Txt>
          </Pressable>
        ) : null}
        {waiting ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              hideBalance
                ? 'Payments waiting to settle. See them'
                : `Waiting to settle: ${[waiting.out > 0n ? `${formatUsd(waiting.out)} out` : null, waiting.in > 0n ? `${formatUsd(waiting.in)} in` : null].filter(Boolean).join(', ')}`
            }
            hitSlop={6}
            onPress={waiting.onPress}
            style={({ pressed }) => [
              styles.chip,
              styles.takings,
              pressed && { transform: [{ scale: 0.96 }] },
            ]}
          >
            <Icon name="clock" size={13} color={colors.ink} strokeWidth={2.4} />
            <Txt weight="semi" size={13}>
              {hideBalance
                ? '•••• waiting'
                : [
                    waiting.out > 0n ? formatUsd(-waiting.out) : null,
                    waiting.in > 0n ? formatUsd(waiting.in, { sign: true }) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') + ' waiting'}
            </Txt>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

/**
 * The balance as it is shown: when it changes, it counts to the new amount (about 0.7 s, easing
 * out) instead of jumping, so money leaving or arriving is something you see happen, even from
 * behind the send sheet. The first value, and any change with Reduce Motion on, is shown at once.
 */
function useCounted(balance: bigint | null) {
  const [shown, setShown] = useState(balance)
  const from = useRef(balance)
  useEffect(() => {
    const start = from.current
    from.current = balance
    if (balance === null || start === null || start === balance) return setShown(balance)
    let frame = 0
    let cancelled = false
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled) return
      if (reduced) return setShown(balance)
      const began = Date.now()
      const step = () => {
        const p = Math.min(1, (Date.now() - began) / 700)
        const eased = 1 - (1 - p) ** 3
        setShown(start + ((balance - start) * BigInt(Math.round(eased * 1000))) / 1000n)
        if (p < 1) frame = requestAnimationFrame(step)
      }
      frame = requestAnimationFrame(step)
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [balance])
  return shown
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    borderRadius: 30,
    backgroundColor: colors.teal,
    borderWidth: 2,
    borderColor: colors.ink,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 18,
    overflow: 'hidden',
  },
  rings: { position: 'absolute', right: -70, top: -70, opacity: 0.55 },
  coins: { position: 'absolute', right: 14, bottom: 12, width: 84, height: 60 },
  coinBack: { position: 'absolute', right: 0, top: 0, transform: [{ rotate: '12deg' }] },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  add: {
    height: 32,
    paddingLeft: 9,
    paddingRight: 12,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  amount: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 10, paddingRight: 70 },
  hint: { marginTop: 12, marginLeft: 6 },
  splitRow: { flexDirection: 'row', marginTop: 8 },
  sign: { marginTop: 8, marginRight: 2 },
  whole: { letterSpacing: -2.2, lineHeight: 60, flexShrink: 1 },
  cents: { marginTop: 8, marginLeft: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, paddingRight: 84 },
  chip: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    backgroundColor: colors.tealDeep,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  takings: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.ink,
    paddingHorizontal: 10,
  },
  private: { backgroundColor: colors.ink, paddingHorizontal: 11 },
})
