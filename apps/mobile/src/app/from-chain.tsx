import type { ChainDepositActivity, ChainDepositQuote, ChainDepositSources } from '@kova/monad'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import { type Address, parseUnits } from 'viem'
import { chainDepositActivity, chainDepositQuote, chainDepositSources } from '@/lib/chain'
import { formatUsd } from '@/lib/money'
import { colors, fonts } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Kovi } from '@/ui/art'
import { Icon } from '@/ui/Icon'
import { Header, PillButton, Screen, Sticker, Txt } from '@/ui/primitives'

export default function FromChain() {
  const { profile } = useWallet()
  return profile ? <DepositForm key={profile.address} wallet={profile.address} /> : null
}

function DepositForm({ wallet }: { wallet: Address }) {
  const { refresh } = useWallet()
  const [sources, setSources] = useState<ChainDepositSources | null>(null)
  const [chainId, setChainId] = useState(143)
  const [tokenAddress, setTokenAddress] = useState('')
  const [amount, setAmount] = useState('')
  const [refund, setRefund] = useState('')
  const [details, setDetails] = useState(false)
  const [picker, setPicker] = useState(false)
  const [quote, setQuote] = useState<ChainDepositQuote | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [trackingProblem, setTrackingProblem] = useState(false)
  const [deposits, setDeposits] = useState<ChainDepositActivity[]>([])
  const [copied, setCopied] = useState(false)
  const [retry, setRetry] = useState(0)
  const generation = useRef(0)
  const scroll = useRef<ScrollView>(null)
  const scrolledQuote = useRef<ChainDepositQuote | null>(null)
  const arrived = useRef(new Set<string>())
  const cancelQuotes = useCallback(() => {
    generation.current++
  }, [])
  const chain = sources?.chains.find((c) => c.id === chainId) ?? sources?.chains[0]
  const token = chain?.tokens.find((t) => t.address === tokenAddress) ?? chain?.tokens[0]
  const refundTo = refund.trim() || (chain?.vm === 'evm' ? wallet : '')

  useEffect(() => {
    let active = true
    setProblem(null)
    void chainDepositSources(wallet)
      .then((r) => {
        if (active) setSources(r)
      })
      .catch((e) => {
        if (active) setProblem(e instanceof Error ? e.message : 'Kova didn’t answer.')
      })
    return () => {
      active = false
      cancelQuotes()
    }
  }, [wallet, retry, cancelQuotes])

  useEffect(() => {
    if (!sources?.tracking && !sources?.live) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const look = async () => {
      if (AppState.currentState === 'active') {
        try {
          const data = await chainDepositActivity(wallet)
          if (!active) return
          setDeposits(data.filter((d) => d.deposit_tx || d.status !== 'waiting'))
          setTrackingProblem(false)
          for (const d of data)
            if (d.status === 'success' && !arrived.current.has(d.id)) {
              arrived.current.add(d.id)
              void refresh()
            }
        } catch {
          if (active) setTrackingProblem(true)
        }
      }
      if (active) timer = setTimeout(look, 8000)
    }
    void look()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [wallet, sources?.live, sources?.tracking, refresh])

  const invalidate = () => {
    generation.current++
    setQuote(null)
    setProblem(null)
    setBusy(false)
    setCopied(false)
  }
  const preview = async () => {
    if (!chain || !token) return
    const current = ++generation.current
    Keyboard.dismiss()
    setBusy(true)
    setProblem(null)
    setQuote(null)
    try {
      const made = await chainDepositQuote(wallet, {
        chain_id: chain.id,
        token: token.address,
        amount,
        refund_to: refundTo,
      })
      if (current === generation.current) {
        setQuote(made)
        void Haptics.selectionAsync()
      }
    } catch (e) {
      if (current === generation.current)
        setProblem(e instanceof Error ? e.message : 'Couldn’t get a deposit quote.')
    } finally {
      if (current === generation.current) setBusy(false)
    }
  }
  const recovery = () => void WebBrowser.openBrowserAsync('https://relay.link/withdraw')

  return (
    <Screen bg={colors.paper}>
      <Header title="Deposit crypto" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          ref={scroll}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.intro}>
            <Kovi pose="catch" size={76} />
            <View style={{ flex: 1 }}>
              <Txt weight="bold" size={27}>
                Make it spendable.
              </Txt>
              <Txt size={14} color={colors.muted} style={{ marginTop: 5, lineHeight: 20 }}>
                Send crypto. Receive dollars in your Kova balance.
              </Txt>
            </View>
          </View>
          {!sources && !problem ? (
            <Txt color={colors.muted}>Finding available networks…</Txt>
          ) : null}
          {sources && !sources.live ? <Txt color={colors.muted}>{sources.reason}</Txt> : null}
          {sources?.live && chain && token ? (
            <View style={{ gap: 16 }}>
              <View>
                <Txt weight="semi" size={13} style={styles.label}>
                  From network
                </Txt>
                <Sticker
                  radius={20}
                  onPress={() => setPicker(true)}
                  accessibilityLabel={`From network: ${chain.name}. Change network`}
                  style={{ height: 56 }}
                >
                  <View style={styles.network}>
                    <Txt weight="semi">{chain.name}</Txt>
                    <Icon name="arrow" size={18} />
                  </View>
                </Sticker>
              </View>
              <View>
                <Txt weight="semi" size={13} style={styles.label}>
                  Token
                </Txt>
                <View style={styles.tokens}>
                  {chain.tokens.map((t) => (
                    <Pressable
                      key={t.address}
                      accessibilityRole="button"
                      accessibilityState={{ selected: token.address === t.address }}
                      onPress={() => {
                        invalidate()
                        setTokenAddress(t.address)
                        void Haptics.selectionAsync()
                      }}
                      style={[styles.token, token.address === t.address && styles.selected]}
                    >
                      <Txt
                        weight="semi"
                        size={14}
                        color={token.address === t.address ? colors.white : colors.ink}
                      >
                        {t.symbol}
                      </Txt>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View>
                <Txt weight="semi" size={13} style={styles.label}>
                  Amount to send
                </Txt>
                <View style={styles.amount}>
                  <TextInput
                    accessibilityLabel="Amount to send"
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={colors.muted}
                    maxLength={80}
                    value={amount}
                    onChangeText={(v) => {
                      if (/^\d*(\.\d*)?$/.test(v)) {
                        invalidate()
                        setAmount(v)
                      }
                    }}
                    style={styles.amountInput}
                  />
                  <Txt weight="semi">{token.symbol}</Txt>
                </View>
              </View>
              {chain.vm === 'evm' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: details }}
                  onPress={() => setDetails((v) => !v)}
                >
                  <Txt size={13} weight="semi">
                    {details ? '−' : '+'} Refund & token details
                  </Txt>
                </Pressable>
              ) : null}
              {details || chain.vm !== 'evm' ? (
                <View style={{ gap: 7 }}>
                  <Txt size={13} weight="semi">
                    Your refund wallet on {chain.name}
                  </Txt>
                  <TextInput
                    accessibilityLabel="Refund address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={128}
                    placeholder={chain.vm === 'evm' ? wallet : `Your ${chain.name} wallet address`}
                    placeholderTextColor={colors.muted}
                    value={refund}
                    onChangeText={(v) => {
                      invalidate()
                      setRefund(v)
                    }}
                    style={styles.input}
                  />
                  <Txt size={12} color={colors.muted}>
                    Use a wallet you control. Refunds stay on {chain.name}, less fees. If sending
                    from an exchange, enter a personal wallet address.
                  </Txt>
                  {chain.vm === 'evm' ? (
                    <Txt selectable size={11} color={colors.muted}>
                      Token: {token.address}
                    </Txt>
                  ) : null}
                </View>
              ) : null}
              <PillButton
                label={
                  busy ? 'Getting your estimate…' : quote ? 'Refresh estimate' : 'Preview deposit'
                }
                loading={busy}
                disabled={!amount || !refundTo}
                onPress={() => void preview()}
              />
            </View>
          ) : null}
          {problem ? (
            <View accessibilityRole="alert" style={{ marginTop: 16 }}>
              <Txt color={colors.danger}>{problem}</Txt>
              {!sources ? (
                <Pressable onPress={() => setRetry((r) => r + 1)} style={{ paddingVertical: 12 }}>
                  <Txt weight="semi">Try again</Txt>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {quote ? (
            <View
              onLayout={(event) => {
                if (scrolledQuote.current === quote) return
                scrolledQuote.current = quote
                scroll.current?.scrollTo({ y: event.nativeEvent.layout.y, animated: true })
              }}
            >
              <Sticker radius={28} style={{ marginTop: 20 }}>
                <View style={styles.card}>
                  <Txt size={13} color={colors.muted}>
                    You’ll receive approximately
                  </Txt>
                  <Txt weight="bold" size={34} style={{ textAlign: 'center', marginTop: 4 }}>
                    {formatUsd(parseUnits(quote.expected_ausd, 6))}
                  </Txt>
                  <Txt size={14} color={colors.muted} style={{ textAlign: 'center', marginTop: 6 }}>
                    From {quote.amount} {quote.token.symbol} on {quote.chain.name}
                  </Txt>
                  <View style={styles.fees}>
                    <View style={styles.fee}>
                      <Txt size={12} color={colors.muted}>
                        Route fee, included
                      </Txt>
                      <Txt size={12} weight="semi">
                        {quote.route_fee_usd === null
                          ? 'Included'
                          : formatUsd(parseUnits(quote.route_fee_usd, 6))}
                      </Txt>
                    </View>
                    <View style={styles.fee}>
                      <Txt size={12} color={colors.muted}>
                        Kova fee
                      </Txt>
                      <Txt size={12} weight="semi">
                        $0
                      </Txt>
                    </View>
                  </View>
                  <View style={styles.qr}>
                    <QRCode
                      value={quote.address}
                      size={176}
                      color={colors.ink}
                      backgroundColor={colors.surface}
                      ecl="M"
                    />
                  </View>
                  <Txt weight="semi" size={14} style={styles.center}>
                    Send only {quote.token.symbol} on {quote.chain.name}
                  </Txt>
                  <Txt selectable size={14} style={styles.address}>
                    {quote.address}
                  </Txt>
                  <View style={styles.actions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Copy deposit address"
                      style={[styles.action, styles.selected]}
                      onPress={async () => {
                        try {
                          await Clipboard.setStringAsync(quote.address)
                          setCopied(true)
                          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
                        } catch {
                          setProblem('Copy failed. Select the address above to copy it.')
                        }
                      }}
                    >
                      <Icon name={copied ? 'check' : 'copy'} color={colors.white} size={18} />
                      <Txt weight="semi" size={14} color={colors.white}>
                        {copied ? 'Copied' : 'Copy'}
                      </Txt>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      style={styles.action}
                      onPress={() => {
                        void Share.share({
                          message: `Send ${quote.amount} ${quote.token.symbol} on ${quote.chain.name} to ${quote.address}. Converted to dollars in my Kova wallet. Use only this token and network; the conversion rate updates when funds arrive.`,
                        }).catch(() => {})
                      }}
                    >
                      <Icon name="share" size={18} />
                      <Txt weight="semi" size={14}>
                        Share
                      </Txt>
                    </Pressable>
                  </View>
                  <Txt size={12} color={colors.muted} style={styles.center}>
                    We’ll convert your deposit to dollars automatically. Reuse this address only for{' '}
                    {quote.token.symbol} on {quote.chain.name}. Prices and fees update when funds
                    arrive.
                  </Txt>
                  <Txt size={12} color={colors.muted} style={styles.center}>
                    Use the quoted amount. Very small deposits may not cover route costs. Your
                    sending wallet or exchange charges its own fee.
                  </Txt>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setDetails((v) => !v)}
                    style={{ paddingVertical: 10 }}
                  >
                    <Txt size={12} weight="semi">
                      {details ? 'Hide' : 'Conversion & refund details'}
                    </Txt>
                  </Pressable>
                  {details ? (
                    <View style={{ gap: 8 }}>
                      <Txt size={12} color={colors.muted}>
                        At this quote: minimum {quote.minimum_ausd} AUSD with 0.5% swap slippage.
                        This estimate changes with the market. Deposits of $0.05 or less are not
                        processed. Conversions are handled by Relay.
                      </Txt>
                      <Txt selectable size={12} color={colors.muted}>
                        Refunds on {quote.chain.name}: {quote.refund_to}
                      </Txt>
                      <Pressable accessibilityRole="link" onPress={recovery}>
                        <Txt size={13} weight="semi">
                          Get help recovering a deposit
                        </Txt>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              </Sticker>
            </View>
          ) : null}
          {trackingProblem ? (
            <Txt size={13} color={colors.muted} style={{ marginTop: 16 }}>
              Deposit tracking is reconnecting. Your funds are processed independently.
            </Txt>
          ) : null}
          {deposits.length ? (
            <View style={{ marginTop: 24, gap: 10 }}>
              <Txt weight="semi">Your deposits</Txt>
              {deposits.map((d) => (
                <Sticker key={d.id} radius={20}>
                  <View style={{ padding: 16, gap: 4 }}>
                    <Txt size={14} weight="semi">
                      {d.status === 'success'
                        ? d.received_ausd
                          ? `${formatUsd(parseUnits(d.received_ausd, 6))} arrived`
                          : 'Arrived'
                        : d.status === 'refund'
                          ? 'Refunded to your source wallet'
                          : d.status === 'failure'
                            ? 'Deposit needs attention'
                            : 'Deposit on its way'}
                    </Txt>
                    <Txt size={12} color={colors.muted}>
                      {d.status === 'success'
                        ? 'Ready to spend in Kova'
                        : d.status === 'failure'
                          ? 'Open deposit recovery below'
                          : d.status === 'refund'
                            ? 'Refunds may take time to confirm'
                            : 'We’ll update your balance when it arrives'}
                    </Txt>
                    {d.status === 'success' && d.destination_tx ? (
                      <Pressable
                        accessibilityRole="link"
                        onPress={() =>
                          void WebBrowser.openBrowserAsync(
                            `https://monadvision.com/tx/${encodeURIComponent(d.destination_tx!)}`,
                          )
                        }
                      >
                        <Txt size={12} weight="semi">
                          View transaction
                        </Txt>
                      </Pressable>
                    ) : null}
                  </View>
                </Sticker>
              ))}
              <Pressable
                accessibilityRole="link"
                onPress={recovery}
                style={{ paddingVertical: 12 }}
              >
                <Txt weight="semi" size={13}>
                  Deposit recovery
                </Txt>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
      <Modal
        visible={picker}
        transparent
        animationType="slide"
        onRequestClose={() => setPicker(false)}
      >
        <View style={styles.overlay}>
          <Pressable
            accessibilityLabel="Close network picker"
            style={StyleSheet.absoluteFill}
            onPress={() => setPicker(false)}
          />
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Txt weight="bold" size={22}>
                Choose network
              </Txt>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={12}
                onPress={() => setPicker(false)}
              >
                <Icon name="close" size={22} />
              </Pressable>
            </View>
            <ScrollView>
              {sources?.chains.map((c) => (
                <Pressable
                  key={c.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: c.id === chain?.id }}
                  style={styles.networkOption}
                  onPress={() => {
                    invalidate()
                    setChainId(c.id)
                    setTokenAddress('')
                    setRefund('')
                    setPicker(false)
                    void Haptics.selectionAsync()
                  }}
                >
                  <View>
                    <Txt weight="semi">{c.name}</Txt>
                    <Txt size={12} color={colors.muted}>
                      {c.tokens.map((t) => t.symbol).join(' · ')}
                    </Txt>
                  </View>
                  {c.id === chain?.id ? <Icon name="check" size={20} /> : null}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 48 },
  intro: { flexDirection: 'row', alignItems: 'center', gap: 14, marginVertical: 20 },
  label: { marginBottom: 8 },
  network: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
  },
  tokens: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  token: {
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 11,
    backgroundColor: colors.surface,
  },
  selected: { backgroundColor: colors.ink },
  amount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: 22,
    paddingHorizontal: 18,
    backgroundColor: colors.surface,
  },
  amountInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.semi,
    fontSize: 30,
    color: colors.ink,
    paddingVertical: 16,
  },
  input: {
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: 18,
    padding: 14,
    backgroundColor: colors.surface,
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.ink,
  },
  card: { alignItems: 'center', padding: 20, gap: 4 },
  center: { textAlign: 'center', lineHeight: 19, marginTop: 10 },
  fees: {
    alignSelf: 'stretch',
    backgroundColor: colors.sunken,
    padding: 14,
    borderRadius: 16,
    marginVertical: 14,
    gap: 8,
  },
  fee: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  qr: { padding: 12, backgroundColor: colors.surface, borderRadius: 20 },
  address: { textAlign: 'center', lineHeight: 21, marginTop: 5 },
  actions: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginVertical: 12 },
  action: {
    flex: 1,
    minHeight: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0B1A1D70' },
  sheet: {
    maxHeight: '80%',
    backgroundColor: colors.paper,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    padding: 22,
    paddingBottom: 38,
  },
  sheetHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  networkOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: colors.sunken,
  },
})
