import * as Haptics from 'expo-haptics'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import {
  baseToNumber,
  currencyInfo,
  type DisplayCurrency,
  displayCurrencies,
  formatUsd,
} from '@/lib/money'
import { rateLabel, ratesLive } from '@/lib/rates'
import { colors, fonts } from '@/lib/theme'
import { Coin } from '@/ui/art'
import { Icon } from '@/ui/Icon'
import { Rise, Txt } from '@/ui/primitives'
import { Sheet } from '@/ui/travel/Sheet'

/**
 * Who you are to other people, written on the card they see.
 *
 * The form is the card a friend gets when you ask them for money: you write your name straight
 * onto it, your initials fill in beside it, and the amount at the bottom shows in the currency
 * you think in, at today's rate. Choosing a currency opens every option with its live rate.
 * Used when a wallet is made (setup) and when one comes back (restore, with its balance).
 */

/** A small, everyday amount in each currency, so the example reads like a real request. */
const EXAMPLE: Record<DisplayCurrency, number> = {
  USD: 12,
  EUR: 11,
  GBP: 9.5,
  NGN: 12_500,
  KES: 1_500,
  MXN: 220,
}

const PAINTED_COINS = new Set(['$', '€', '£', '₦'])

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return words.length === 0
    ? ''
    : words
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join('')
}

function local(amount: number, currency: DisplayCurrency) {
  const info = currencyInfo[currency]
  return `${info.symbol}${amount.toLocaleString('en-US', { minimumFractionDigits: info.decimals, maximumFractionDigits: info.decimals })}`
}

export function ProfileForm({
  heading,
  note,
  name,
  onName,
  currency,
  onCurrency,
  onSubmit,
  balance,
}: {
  heading: string
  note: string
  name: string
  onName: (name: string) => void
  currency: DisplayCurrency
  onCurrency: (currency: DisplayCurrency) => void
  onSubmit?: () => void
  /** A restored wallet shows what it holds instead of an example request. */
  balance?: bigint | null
}) {
  const [picking, setPicking] = useState(false)
  const info = currencyInfo[currency]
  const restored = balance !== undefined
  const mark = initials(name)

  const example = EXAMPLE[currency]
  const exampleUsd = example / info.perUsd

  return (
    <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
      <Txt weight="semi" size={25} style={styles.heading}>
        {heading}
      </Txt>

      <Rise delay={80}>
        <View style={styles.card}>
          <View style={styles.coin} pointerEvents="none">
            <Coin size={54} symbol={PAINTED_COINS.has(info.symbol) ? info.symbol : '$'} />
          </View>

          <View style={styles.cardTop}>
            <View style={[styles.mark, !mark && styles.markEmpty]}>
              {mark ? (
                <Txt weight="bold" size={17} color={colors.white}>
                  {mark}
                </Txt>
              ) : (
                <Icon name="user" size={20} color={colors.onTint} />
              )}
            </View>
            <Txt weight="medium" size={14} color={colors.onTint}>
              {restored ? 'Your wallet' : 'Asks you for money'}
            </Txt>
          </View>

          <TextInput
            value={name}
            onChangeText={onName}
            placeholder="Your name"
            placeholderTextColor="rgba(31,52,56,0.38)"
            autoFocus
            autoCapitalize="words"
            autoComplete="name"
            autoCorrect={false}
            maxLength={40}
            returnKeyType="done"
            onSubmitEditing={onSubmit}
            accessibilityLabel="Your name"
            style={styles.name}
          />
          <View style={styles.writeLine} />

          <View style={styles.cardBottom}>
            <View style={{ flexShrink: 1 }}>
              <View style={styles.amountLine}>
                <Txt weight="bold" size={24} style={styles.amount}>
                  {restored
                    ? balance === null
                      ? '…'
                      : formatUsd(balance)
                    : local(example, currency)}
                </Txt>
                {restored ? (
                  balance !== null && currency !== 'USD' ? (
                    <Txt size={13} color={colors.onTint}>
                      ≈ {local(baseToNumber(balance) * info.perUsd, currency)}
                    </Txt>
                  ) : null
                ) : currency !== 'USD' ? (
                  <Txt size={13} color={colors.onTint}>
                    ≈ ${exampleUsd.toFixed(2)}
                  </Txt>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Money shows in ${info.name}. Change`}
                onPress={() => setPicking(true)}
                hitSlop={8}
                style={({ pressed }) => [styles.currencyChip, pressed && { opacity: 0.7 }]}
              >
                <Txt weight="semi" size={13}>
                  {info.symbol} {info.name}
                </Txt>
                <Icon name="chevronDown" size={14} />
              </Pressable>
            </View>
            <View
              style={styles.payChip}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Txt weight="bold" size={14}>
                {restored ? 'Open' : 'Pay'}
              </Txt>
              <View style={styles.payCap}>
                <Icon name="arrow" size={14} color={colors.coral} />
              </View>
            </View>
          </View>
        </View>
      </Rise>

      <Txt size={14} color={colors.muted} style={styles.note}>
        {note}
      </Txt>

      <CurrencySheet
        visible={picking}
        value={currency}
        onClose={() => setPicking(false)}
        onPick={(next) => {
          void Haptics.selectionAsync()
          onCurrency(next)
          setPicking(false)
        }}
      />
    </ScrollView>
  )
}

/** Every currency Kova shows, each with what a dollar is worth in it today. */
export function CurrencySheet({
  visible,
  value,
  onClose,
  onPick,
}: {
  visible: boolean
  value: DisplayCurrency
  onClose: () => void
  onPick: (currency: DisplayCurrency) => void
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Show my money in">
      <Txt size={14} color={colors.muted} style={{ marginBottom: 14 }}>
        Your money stays in dollars. This is only how Kova shows it to you.
      </Txt>
      <View style={styles.grid}>
        {displayCurrencies.map((code) => {
          const c = currencyInfo[code]
          const on = code === value
          return (
            <Pressable
              key={code}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={c.name}
              onPress={() => onPick(code)}
              style={({ pressed }) => [
                styles.tile,
                on && styles.tileOn,
                pressed && { transform: [{ scale: 0.97 }] },
              ]}
            >
              <Txt
                weight="bold"
                size={26}
                color={on ? colors.white : colors.ink}
                style={{ letterSpacing: -0.5 }}
              >
                {c.symbol}
              </Txt>
              <Txt
                weight="semi"
                size={15}
                color={on ? colors.white : colors.ink}
                style={{ marginTop: 6 }}
              >
                {c.name}
              </Txt>
              <Txt size={12} color={on ? colors.onInk : colors.muted} style={{ marginTop: 2 }}>
                {code === 'USD'
                  ? 'No conversion'
                  : `$1 = ${c.symbol}${c.perUsd.toLocaleString('en-US', { maximumFractionDigits: c.decimals === 0 ? 0 : 3 })}`}
              </Txt>
            </Pressable>
          )
        })}
      </View>
      <View style={styles.provenance}>
        <Icon name={ratesLive() ? 'check' : 'info'} size={14} color={colors.muted} />
        <Txt size={12} color={colors.muted}>
          {ratesLive() ? `${rateLabel()}, published on Monad` : 'Reference rates, updated by Kova'}
        </Txt>
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  form: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 },
  heading: { letterSpacing: -0.7, lineHeight: 31, paddingHorizontal: 4 },
  card: {
    marginTop: 16,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.coralSoft,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  coin: { position: 'absolute', right: 16, top: -18, transform: [{ rotate: '12deg' }] },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markEmpty: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.onTint,
  },
  name: {
    marginTop: 10,
    paddingVertical: 2,
    fontFamily: fonts.bold,
    fontSize: 32,
    letterSpacing: -1,
    color: colors.ink,
  },
  writeLine: {
    height: 0,
    borderBottomWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.ink,
    opacity: 0.35,
    marginTop: 2,
  },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 14,
  },
  amountLine: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  amount: { letterSpacing: -0.6 },
  payChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 40,
    paddingLeft: 16,
    paddingRight: 4,
    borderRadius: 20,
    backgroundColor: colors.coral,
  },
  payCap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currencyChip: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 4,
    height: 30,
    marginTop: 6,
    paddingHorizontal: 11,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  note: { marginTop: 14, lineHeight: 20, paddingHorizontal: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '48%',
    flexGrow: 1,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  tileOn: { backgroundColor: colors.ink },
  provenance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    marginBottom: 4,
  },
})
