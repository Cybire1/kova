import {
  type ChainDepositQuote,
  exactTokenAmount,
  formatMon,
  formatTokenAmount,
  type PendingTokenConversion,
  pendingTokenConversion,
  prepareTokenConversion,
  sendTokenConversion,
  type TokenConversionPlan,
  tokenConversionStatus,
  tokenInDollars,
  type WalletToken,
  worthMentioning,
} from '@kova/monad'
import { useLocalSearchParams } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useEffect, useRef, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { parseUnits } from 'viem'
import { chainDepositQuote, getMonUsd } from '@/lib/chain'
import { isTestnet } from '@/lib/config'
import { formatUsd } from '@/lib/money'
import { usePrefs } from '@/lib/prefs'
import { colors, fonts } from '@/lib/theme'
import { refreshTokens, relayTransfer, useTokenConversion, useWalletTokens } from '@/lib/tokens'
import { useWallet } from '@/lib/wallet'
import { Kovi } from '@/ui/art'
import { canConvert, TokenCoin, worthText } from '@/ui/OtherTokens'
import { Header, PillButton, Screen, Txt } from '@/ui/primitives'

const open = (url: string) => {
  void WebBrowser.openBrowserAsync(url)
}

/** Every other token the wallet holds, and the way to turn each into dollars. */
export default function OtherTokens() {
  const { profile } = useWallet()
  const { hideBalance } = usePrefs()
  const { ready, held, convertible } = useWalletTokens()
  const conversion = useTokenConversion()
  const { convert: asked } = useLocalSearchParams<{ convert?: string }>()
  const [opened, setOpened] = useState<string | null>(null)
  const [usdPerMon, setUsdPerMon] = useState<number | null>(null)
  const answered = useRef(false)

  useEffect(() => {
    void refreshTokens()
    void getMonUsd()
      .then(setUsdPerMon)
      .catch(() => setUsdPerMon(null))
  }, [])
  // Opened from an arrival or Home to convert one: straight to it, once it's known to convert.
  useEffect(() => {
    if (answered.current || !asked || conversion.pending) return
    const found = held.find((h) => h.token.symbol === asked && canConvert(convertible, h.token))
    if (!found) return
    answered.current = true
    setOpened(found.token.symbol)
  }, [asked, held, convertible, conversion.pending])

  const converting = opened ? held.find((h) => h.token.symbol === opened) : undefined
  if (profile && converting && canConvert(convertible, converting.token) && !conversion.pending)
    return (
      <Screen>
        <Header title="Turn into dollars" onBack={() => setOpened(null)} />
        <ConvertToken
          key={converting.token.address}
          token={converting.token}
          held={converting.amount}
          usdPerMon={usdPerMon}
          onSent={async (pending) => {
            await conversion.remember(pending)
            setOpened(null)
          }}
        />
      </Screen>
    )

  const kept = held.filter((h) => !canConvert(convertible, h.token)).map((h) => h.token.symbol)
  return (
    <Screen>
      <Header title="Other tokens" />
      <ScrollView contentContainerStyle={styles.body}>
        <Txt size={16} color={colors.muted}>
          Tokens in this wallet besides your dollars. Turn them into dollars to pay with Kova.
        </Txt>
        {conversion.pending ? (
          <Progress
            pending={conversion.pending}
            activity={conversion.activity}
            trackingProblem={conversion.trackingProblem}
            onDone={() => void conversion.remember(null)}
          />
        ) : null}
        {!ready ? (
          <Txt color={colors.muted}>Looking on Monad…</Txt>
        ) : held.length === 0 ? (
          <View style={styles.empty}>
            <Kovi pose="sleep" size={140} />
            <Txt weight="semi" size={17}>
              No other tokens
            </Txt>
            <Txt size={14} color={colors.muted} style={{ textAlign: 'center', maxWidth: 280 }}>
              {isTestnet
                ? 'When test USDC reaches this wallet, it shows up here.'
                : 'When USDC, USDT0 or other tokens reach this wallet on Monad, they show up here.'}
            </Txt>
          </View>
        ) : (
          held.map(({ token, amount }) => {
            const worth = tokenInDollars(token, amount, usdPerMon)
            const action =
              !canConvert(convertible, token) || conversion.pending
                ? null
                : worthMentioning(token, amount)
                  ? 'convert'
                  : 'dust'
            return (
              <View key={token.address} style={[styles.card, styles.item]}>
                <TokenCoin token={token} />
                <View style={{ flex: 1 }}>
                  <Txt weight="semi" size={16}>
                    {hideBalance ? '••••' : formatTokenAmount(token, amount)} {token.symbol}
                  </Txt>
                  <Txt size={12} color={colors.muted} style={{ marginTop: 2 }}>
                    {token.name}
                    {worth !== null && !hideBalance ? ` · ${worthText(worth)}` : ''}
                  </Txt>
                </View>
                {action === 'convert' ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Turn ${token.symbol} into dollars`}
                    onPress={() => setOpened(token.symbol)}
                    style={({ pressed }) => [styles.go, pressed && { opacity: 0.8 }]}
                  >
                    <Txt weight="bold" size={13} color={colors.onChosen}>
                      Turn into dollars
                    </Txt>
                  </Pressable>
                ) : action === 'dust' ? (
                  <Txt size={12} color={colors.muted}>
                    Too little to convert
                  </Txt>
                ) : null}
              </View>
            )
          })
        )}
        {ready && kept.length > 0 ? (
          <Txt size={13} color={colors.muted}>
            {isTestnet
              ? 'Turning tokens into dollars works on mainnet.'
              : `Kova can’t turn ${list(kept)} into dollars yet, so ${kept.length === 1 ? 'it stays' : 'they stay'} in your wallet as ${kept.length === 1 ? 'it is' : 'they are'}.`}
          </Txt>
        ) : null}
        {profile ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => open(`https://monadvision.com/address/${profile.address}`)}
          >
            <Txt style={styles.link}>See your wallet’s transfers</Txt>
          </Pressable>
        ) : null}
      </ScrollView>
    </Screen>
  )
}

const list = (names: string[]) =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`

function Progress({
  pending,
  activity,
  trackingProblem,
  onDone,
}: {
  pending: PendingTokenConversion
  activity: ReturnType<typeof useTokenConversion>['activity']
  trackingProblem: boolean
  onDone: () => void
}) {
  const status = activity?.status
  const finished = status === 'success' || status === 'refund' || status === 'failure'
  const stale = Date.now() - pending.startedAt > 10 * 60_000
  return (
    <View style={styles.card} accessibilityLiveRegion="polite">
      <Txt weight="bold" size={22}>
        {tokenConversionStatus(pending.symbol, activity)}
      </Txt>
      <Txt size={15}>
        {status === 'success'
          ? 'Your dollars are ready to spend.'
          : status === 'refund'
            ? `Relay is sending your ${pending.symbol} back to this wallet.`
            : status === 'failure'
              ? 'Check the conversion details before trying again.'
              : `Your ${pending.symbol} is on its way to become dollars. You can leave this screen; progress is saved.`}
      </Txt>
      {activity?.received_ausd ? (
        <Txt weight="bold" size={26}>
          {formatUsd(parseUnits(activity.received_ausd, 6))} added
        </Txt>
      ) : null}
      {trackingProblem ? (
        <Txt size={14} accessibilityRole="alert">
          Tracking is unavailable for now. Your transfer is saved; don’t send again.
        </Txt>
      ) : null}
      <Pressable
        accessibilityRole="link"
        onPress={() => open(`https://monadvision.com/tx/${pending.hash}`)}
      >
        <Txt style={styles.link}>View {pending.symbol} transfer</Txt>
      </Pressable>
      <Pressable
        accessibilityRole="link"
        onPress={() => open(`https://relay.link/transaction/${activity?.id ?? pending.requestId}`)}
      >
        <Txt style={styles.link}>Conversion and recovery details</Txt>
      </Pressable>
      {finished || stale ? <PillButton label="Done" icon="check" onPress={onDone} /> : null}
    </View>
  )
}

function ConvertToken({
  token,
  held,
  usdPerMon,
  onSent,
}: {
  token: WalletToken
  held: bigint
  usdPerMon: number | null
  onSent: (pending: PendingTokenConversion) => Promise<void>
}) {
  const { profile, approve, refresh } = useWallet()
  const { hideBalance } = usePrefs()
  const [amount, setAmount] = useState(() => exactTokenAmount(token, held))
  const [plan, setPlan] = useState<TokenConversionPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const working = useRef(false)
  const generation = useRef(0)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const wallet = profile!.address
  const worth = tokenInDollars(token, held, usdPerMon)

  const edit = (value: string) => {
    generation.current++
    setAmount(value)
    setPlan(null)
    setProblem(null)
  }

  const preview = async () => {
    if (working.current) return
    working.current = true
    const version = ++generation.current
    setBusy(true)
    setProblem(null)
    setPlan(null)
    try {
      const quote: ChainDepositQuote = await chainDepositQuote(wallet, {
        chain_id: 143,
        token: token.address,
        amount,
        refund_to: wallet,
      })
      const result = await prepareTokenConversion(wallet, token, amount, quote)
      if (active.current && version === generation.current) setPlan(result)
    } catch (e) {
      if (version === generation.current)
        setProblem(e instanceof Error ? e.message : 'Couldn’t preview the conversion.')
    } finally {
      working.current = false
      if (version === generation.current) setBusy(false)
    }
  }

  const confirm = async () => {
    if (!plan || working.current) return
    working.current = true
    setBusy(true)
    setProblem(null)
    try {
      // Approved like a payment of what it becomes, with Face ID.
      const signer = await approve(parseUnits(plan.quote.expected_ausd, 6))
      if (!active.current) return
      // These apps ship different viem declaration versions; the account is the same signer interface.
      const hash = await sendTokenConversion(
        plan,
        signer as Parameters<typeof sendTokenConversion>[1],
        relayTransfer,
      )
      await onSent(pendingTokenConversion(plan, hash))
      void refreshTokens()
      void refresh()
    } catch (e) {
      if (active.current)
        setProblem(e instanceof Error ? e.message : 'Couldn’t confirm the conversion.')
    } finally {
      working.current = false
      if (active.current) setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <View style={styles.card}>
          <View style={styles.item}>
            <TokenCoin token={token} />
            <Txt size={13}>{token.name} in your wallet</Txt>
          </View>
          <Txt weight="bold" size={32}>
            {hideBalance ? '••••' : formatTokenAmount(token, held)} {token.symbol}
          </Txt>
          {worth !== null && !hideBalance ? (
            <Txt size={14} color={colors.muted}>
              {worthText(worth)}
            </Txt>
          ) : null}
        </View>
        <View>
          <Txt weight="semi" size={15}>
            {token.symbol} to turn into dollars
          </Txt>
          <View style={styles.inputRow}>
            <TextInput
              accessibilityLabel={`${token.symbol} to turn into dollars`}
              keyboardType="decimal-pad"
              value={amount}
              editable={!busy}
              placeholder="0"
              placeholderTextColor={colors.muted}
              style={styles.input}
              onChangeText={edit}
            />
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              hitSlop={10}
              onPress={() => edit(exactTokenAmount(token, held))}
            >
              <Txt weight="semi">Max</Txt>
            </Pressable>
          </View>
        </View>
        {plan ? (
          <View style={styles.card}>
            <Txt size={13}>You receive about</Txt>
            <Txt weight="bold" size={36}>
              {formatUsd(parseUnits(plan.quote.expected_ausd, 6))}
            </Txt>
            <Row
              label="You turn in"
              value={`${formatTokenAmount(token, plan.amount)} ${token.symbol}`}
            />
            <Row
              label="Conversion fee, included"
              value={
                plan.quote.route_fee_usd === null
                  ? 'Included in estimate'
                  : `$${plan.quote.route_fee_usd}`
              }
            />
            <Row
              label="Network fee"
              value={plan.gasless ? 'Paid by Kova' : `Up to ${formatMon(plan.networkFee)} MON`}
            />
            <Txt size={12} color={colors.muted}>
              The final dollar amount is set when the conversion starts. Anything that can’t convert
              comes back to this wallet.
            </Txt>
            <PillButton
              label={`Turn ${token.symbol} into dollars`}
              loading={busy}
              onPress={() => void confirm()}
            />
          </View>
        ) : (
          <PillButton
            label="See what you get"
            loading={busy}
            disabled={!amount}
            onPress={() => void preview()}
          />
        )}
        {problem ? (
          <Txt size={14} color={colors.coral} accessibilityRole="alert">
            {problem}
          </Txt>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Txt size={13} style={{ flex: 1 }}>
        {label}
      </Txt>
      <Txt size={13} weight="semi" style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  body: { padding: 20, gap: 16, paddingBottom: 40 },
  card: {
    padding: 20,
    gap: 14,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // Ink, and cream in the dark, so the way to dollars stands out on a card in either.
  go: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 999,
    justifyContent: 'center',
    backgroundColor: colors.chosen,
  },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 16 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: 18,
    paddingHorizontal: 16,
    marginVertical: 10,
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 16,
    fontFamily: fonts.medium,
    fontSize: 24,
    color: colors.ink,
  },
  row: { flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  link: { textDecorationLine: 'underline', fontSize: 14, paddingVertical: 8 },
})
