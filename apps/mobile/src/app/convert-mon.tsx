import {
  type ChainDepositQuote,
  type MonConversionPlan,
  type PendingMonConversion,
  conversionStatus,
  conversionWasNotSent,
  formatMon,
  maxMonConversion,
  prepareMonConversion,
  sendMonConversion,
} from '@kova/monad'
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
import { parseUnits, zeroAddress } from 'viem'
import { chainDepositQuote } from '@/lib/chain'
import { isTestnet } from '@/lib/config'
import { useMonConversion } from '@/lib/mon'
import { formatUsd } from '@/lib/money'
import { colors, fonts } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Header, PillButton, Screen, Txt } from '@/ui/primitives'

const open = (url: string) => {
  void WebBrowser.openBrowserAsync(url)
}

export default function ConvertMon() {
  const { profile } = useWallet()
  return (
    <Screen>
      <Header title="Convert MON" />
      {profile && !isTestnet ? (
        <ConversionForm key={profile.address} />
      ) : (
        <Txt>MON conversion is available on mainnet.</Txt>
      )}
    </Screen>
  )
}

function ConversionForm() {
  const { profile, monBalance, approve, refresh } = useWallet()
  const { pending, activity, trackingProblem, reverted, remember, ready } = useMonConversion()
  const [amount, setAmount] = useState('')
  const [plan, setPlan] = useState<MonConversionPlan | null>(null)
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

  const preview = async (useMax = false) => {
    if (working.current || pending) return
    working.current = true
    const version = ++generation.current
    setBusy(true)
    setProblem(null)
    setPlan(null)
    try {
      const input = useMax ? await maxMonConversion(wallet) : amount
      if (useMax && version === generation.current) setAmount(input)
      const quote: ChainDepositQuote = await chainDepositQuote(wallet, {
        chain_id: 143,
        token: zeroAddress,
        amount: input,
        refund_to: wallet,
      })
      const result = await prepareMonConversion(wallet, input, quote)
      if (active.current && version === generation.current) setPlan(result)
    } catch (e) {
      if (version === generation.current)
        setProblem(e instanceof Error ? e.message : 'Couldn’t preview conversion.')
    } finally {
      working.current = false
      if (version === generation.current) setBusy(false)
    }
  }

  const confirm = async () => {
    if (!plan || working.current || pending) return
    working.current = true
    setBusy(true)
    setProblem(null)
    let remembered = false
    try {
      const signer = await approve(parseUnits(plan.quote.expected_ausd, 6))
      if (!active.current) return
      const record: PendingMonConversion = {
        wallet,
        requestId: plan.quote.request_id,
        depositAddress: plan.quote.address,
        amount: plan.quote.amount,
        startedAt: Date.parse(plan.quote.quoted_at),
      }
      await remember(record)
      remembered = true
      // These apps ship different viem declaration versions; the account is the same signer interface.
      const hash = await sendMonConversion(plan, signer as Parameters<typeof sendMonConversion>[1])
      await remember({ ...record, hash })
      setPlan(null)
      void refresh()
    } catch (e) {
      if (remembered && conversionWasNotSent(e)) {
        await remember(null)
        setPlan(null)
      }
      setProblem(e instanceof Error ? e.message : 'Couldn’t confirm conversion.')
    } finally {
      working.current = false
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <Txt size={16} color={colors.muted}>
          Your MON is in this wallet. Convert it to dollars to use it for Kova payments.
        </Txt>
        <View style={styles.card}>
          <Txt size={13}>MON in your wallet</Txt>
          <Txt weight="bold" size={32}>
            {monBalance === null ? 'Loading…' : `${formatMon(monBalance)} MON`}
          </Txt>
        </View>
        {!ready ? (
          <Txt>Loading conversion history…</Txt>
        ) : pending ? (
          <View style={styles.card} accessibilityLiveRegion="polite">
            <Txt weight="bold" size={22}>
              {reverted ? 'Transfer didn’t go through' : conversionStatus(activity)}
            </Txt>
            <Txt size={15}>
              {reverted
                ? 'Your MON wasn’t converted. The network may have charged a transaction fee.'
                : activity?.status === 'success'
                  ? 'Your dollars are ready to spend.'
                  : activity?.status === 'refund'
                    ? 'Relay is returning the funds to this wallet. Check the recovery details for progress.'
                    : activity?.status === 'failure'
                      ? 'Check Relay’s recovery details before starting another conversion.'
                      : 'Your transfer is being checked. You can leave this screen; progress is saved.'}
            </Txt>
            {activity?.received_ausd ? (
              <Txt weight="bold" size={26}>
                {formatUsd(parseUnits(activity.received_ausd, 6))} added
              </Txt>
            ) : null}
            {trackingProblem ? (
              <Txt size={14} accessibilityRole="alert">
                Tracking is temporarily unavailable. Your transfer is saved; don’t send again.
              </Txt>
            ) : null}
            {pending.hash ? (
              <Pressable
                accessibilityRole="link"
                onPress={() => open(`https://monadvision.com/tx/${pending.hash}`)}
              >
                <Txt style={styles.link}>View MON transfer</Txt>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="link"
              onPress={() =>
                open(`https://relay.link/transaction/${activity?.id ?? pending.requestId}`)
              }
            >
              <Txt style={styles.link}>Conversion and recovery details</Txt>
            </Pressable>
            {reverted || activity?.status === 'success' ? (
              <PillButton label="Done" onPress={() => void remember(null)} />
            ) : null}
          </View>
        ) : (
          <>
            <View>
              <Txt weight="semi" size={15}>
                MON to convert
              </Txt>
              <View style={styles.inputRow}>
                <TextInput
                  accessibilityLabel="MON to convert"
                  keyboardType="decimal-pad"
                  value={amount}
                  editable={!busy}
                  placeholder="0"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                  onChangeText={(value) => {
                    generation.current++
                    setAmount(value)
                    setPlan(null)
                    setProblem(null)
                  }}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => void preview(true)}
                >
                  <Txt weight="semi">Max</Txt>
                </Pressable>
              </View>
              <Txt size={12} color={colors.muted}>
                Max leaves a little MON for the network fee.
              </Txt>
            </View>
            {plan ? (
              <View style={styles.card}>
                <Txt size={13}>You receive approximately</Txt>
                <Txt weight="bold" size={36}>
                  {formatUsd(parseUnits(plan.quote.expected_ausd, 6))}
                </Txt>
                <Row label="You convert" value={`${formatMon(plan.value)} MON`} />
                <Row
                  label="Conversion fee, included"
                  value={
                    plan.quote.route_fee_usd === null
                      ? 'Included in estimate'
                      : `$${plan.quote.route_fee_usd}`
                  }
                />
                <Row label="Network fee, up to" value={`${formatMon(plan.networkFee)} MON`} />
                <Txt size={12} color={colors.muted}>
                  The final dollar amount is set when conversion starts. Any refund returns to this
                  wallet.
                </Txt>
                <PillButton
                  label={busy ? 'Confirming…' : 'Confirm conversion'}
                  disabled={busy}
                  onPress={() => void confirm()}
                />
              </View>
            ) : (
              <PillButton
                label={busy ? 'Getting estimate…' : 'Preview conversion'}
                disabled={busy || !amount || monBalance === null || monBalance === 0n}
                onPress={() => void preview()}
              />
            )}
          </>
        )}
        {problem ? (
          <Txt size={14} color={colors.coral} accessibilityRole="alert">
            {problem}
          </Txt>
        ) : null}
        <Pressable
          accessibilityRole="link"
          onPress={() => open(`https://monadvision.com/address/${wallet}`)}
        >
          <Txt style={styles.link}>View wallet on Monad</Txt>
        </Pressable>
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
  body: { padding: 20, gap: 20, paddingBottom: 40 },
  card: {
    padding: 20,
    gap: 14,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 2,
    borderColor: colors.ink,
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
