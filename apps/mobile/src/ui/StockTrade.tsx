import {
  explorerTxUrl,
  STOCK_BUY_MAX,
  STOCK_BUY_MIN,
  STOCK_NOT_ADVICE,
  STOCK_QUOTE_SECONDS,
  STOCK_WARNINGS,
  type StockHolding,
  type StockQuote,
  shareOfDollars,
} from '@kova/monad'
import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle } from 'react-native-svg'
import { applyKey, formatUsd, groupTyped, type Key, toBase } from '@/lib/money'
import { stockUsd, useStockHoldings } from '@/lib/stocks'
import {
  attestStocks,
  buyStock,
  countryName,
  expiresAt,
  formatShares,
  quoteStock,
  STOCKS_NETWORK,
  type StockAccess,
  sellStock,
  sharesToUnits,
  type Traded,
  type TradeQuote,
  type TradeSide,
  unitsToTyped,
} from '@/lib/stocks-trade'
import { colors, pair } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Kovi, Sparkle } from './art'
import { Icon } from './Icon'
import { Keypad } from './Keypad'
import { PillButton, RoundButton, TextLink, Txt } from './primitives'
import { StockLogo } from './Stocks'

/**
 * Buying and selling a stock, in the Buy sheet: where you are decides first (a blocked country says
 * why, and nothing more); then the one-time confirmation the wallet signs; the amount; the live
 * quote with the least it gets and its 60-second hold, the warnings and what Kova is; Face ID; and
 * the shares in your wallet with a link to the transaction. The web's is
 * apps/web/src/components/wallet/stock-trade.tsx.
 */

type Step = 'blocked' | 'confirm' | 'amount' | 'review' | 'done'

const BUY_CHIPS = [10_000_000n, 50_000_000n, 100_000_000n] as const

const problemOf = (e: unknown) =>
  e instanceof Error ? e.message : 'Something went wrong. Try again.'

export function TradeFlow({
  stock,
  side,
  held,
  access,
  onAccess,
}: {
  stock: StockQuote
  side: TradeSide
  held: StockHolding | undefined
  access: StockAccess
  onAccess: (access: StockAccess) => void
}) {
  const insets = useSafeAreaInsets()
  const { profile, balance, signMessage, signTypedData, refresh } = useWallet()
  const { refresh: refreshHoldings } = useStockHoldings()
  const [step, setStep] = useState<Step>(() =>
    !access.allowed ? 'blocked' : !access.attested ? 'confirm' : 'amount',
  )
  const [typed, setTyped] = useState('')
  const [picked, setPicked] = useState<bigint | null>(null)
  const [quote, setQuote] = useState<TradeQuote | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [done, setDone] = useState<(Traded & { paid: bigint }) | null>(null)
  const buying = side === 'buy'
  const owned = held ? BigInt(held.balance) : 0n
  const address = profile?.address

  const moveTo = (next: Step) => {
    setProblem(null)
    setStep(next)
  }

  const amount = buying
    ? (() => {
        try {
          return typed && Number(typed) > 0 ? toBase(Number(typed).toFixed(2)) : 0n
        } catch {
          return 0n
        }
      })()
    : (picked ?? sharesToUnits(typed))
  const over = amount > (buying ? (balance ?? 0n) : owned)
  const tooBig = buying && amount > STOCK_BUY_MAX
  const tooSmall = buying && amount > 0n && amount < STOCK_BUY_MIN
  const onKey = useCallback(
    (key: Key) => {
      setPicked(null)
      setTyped((v) => applyKey(v, key, buying ? 2 : 6))
    },
    [buying],
  )

  const ask = useCallback(async () => {
    if (!address || amount === 0n) return
    setQuoting(true)
    setProblem(null)
    try {
      setQuote(await quoteStock(address, side, stock.symbol, amount))
    } catch (e) {
      setProblem(problemOf(e))
    } finally {
      setQuoting(false)
    }
  }, [address, amount, side, stock.symbol])

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (step !== 'review') return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [step])
  const left = quote ? Math.max(0, expiresAt(quote) - now) : 0
  const lapsed = quote !== null && left === 0
  const asking = useRef(false)
  useEffect(() => {
    if (step !== 'review' || !lapsed || busy || quoting || asking.current) return
    asking.current = true
    void ask().finally(() => {
      asking.current = false
    })
  }, [step, lapsed, busy, quoting, ask])

  const attest = async () => {
    if (!address) return
    setBusy(true)
    setProblem(null)
    try {
      await attestStocks(address, access.attestation, signMessage)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      onAccess({ ...access, attested: true })
      moveTo('amount')
    } catch (e) {
      setProblem(problemOf(e))
    } finally {
      setBusy(false)
    }
  }

  const trade = async () => {
    if (!quote || lapsed || !address) return
    setBusy(true)
    setProblem(null)
    try {
      const traded = buying
        ? await buyStock(address, signTypedData, quote)
        : await sellStock(address, signTypedData, quote)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setDone({ ...traded, paid: BigInt(quote.amount_in) })
      moveTo('done')
      void refresh()
      void refreshHoldings()
    } catch (e) {
      setProblem(problemOf(e))
    } finally {
      setBusy(false)
    }
  }

  const title = `${buying ? 'Buy' : 'Sell'} ${stock.name}`

  return (
    <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
      {step !== 'done' ? (
        <View style={styles.head}>
          {step === 'review' ? (
            <RoundButton icon="back" label="Change the amount" onPress={() => moveTo('amount')} />
          ) : null}
          <StockLogo uri={stock.logo} size={44} />
          <View style={{ flex: 1 }}>
            <Txt weight="bold" size={18} numberOfLines={1}>
              {step === 'review' ? (buying ? 'Check and buy' : 'Check and sell') : title}
            </Txt>
            <Txt size={13} color={colors.muted} numberOfLines={1}>
              {step === 'review'
                ? title
                : buying
                  ? `From your dollars · ${balance === null ? '—' : formatUsd(balance)}`
                  : `You own ${formatShares(owned)} ${stock.symbol}`}
            </Txt>
          </View>
        </View>
      ) : null}

      {step === 'blocked' ? (
        <View style={{ gap: 12, alignItems: 'center' }}>
          <View style={styles.globeWrap}>
            <View style={styles.globeShadow} />
            <View style={styles.globe}>
              <Icon name="web" size={30} color={colors.ink} />
            </View>
          </View>
          {countryName(access.country) ? (
            <View style={styles.where}>
              <Txt weight="bold" size={13} color={colors.muted}>
                You’re in {countryName(access.country)}
              </Txt>
            </View>
          ) : null}
          <Txt weight="bold" size={26} style={styles.h}>
            Not available in your country
          </Txt>
          <Txt size={15} color={colors.muted} style={{ textAlign: 'center', lineHeight: 21 }}>
            {access.reason ?? 'Stock tokens aren’t available where you are.'}
          </Txt>
          <View style={[styles.facts, { alignSelf: 'stretch' }]}>
            <FactRow
              label="Why"
              value="The issuer’s rules"
              hint="Backed, which issues xStocks, doesn’t offer them here"
            />
            <FactRow
              label="Your dollars"
              value="Untouched"
              hint="Nothing was signed or moved"
              rule
            />
          </View>
          <View style={{ alignSelf: 'stretch' }}>
            <PillButton label="Close" icon="close" onPress={() => router.back()} />
          </View>
        </View>
      ) : null}

      {step === 'confirm' ? (
        <View style={{ gap: 12 }}>
          <Txt weight="bold" size={12} color={colors.tealDeep} style={styles.eyebrow}>
            ONCE, BEFORE YOUR FIRST STOCK
          </Txt>
          <Txt weight="bold" size={26} style={{ letterSpacing: -1 }}>
            Confirm this is you
          </Txt>
          <Txt size={15} color={colors.muted} style={{ lineHeight: 21 }}>
            Stock tokens come with rules. Read this, then sign it with your wallet. Signing moves no
            money.
          </Txt>
          <Letter text={access.attestation} />
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
            onPress={() => {
              void Haptics.selectionAsync()
              setAgreed((v) => !v)
            }}
            style={styles.check}
          >
            <View style={[styles.box, agreed && styles.boxOn]}>
              {agreed ? <Icon name="check" size={16} color={colors.white} /> : null}
            </View>
            <Txt weight="bold" size={15}>
              This is true for me
            </Txt>
          </Pressable>
          {problem ? <Problem text={problem} /> : null}
          <PillButton
            label={busy ? 'Signing…' : 'Sign with Face ID'}
            icon="face"
            loading={busy}
            disabled={!agreed}
            onPress={() => void attest()}
          />
          <Txt size={12} color={colors.muted} style={{ textAlign: 'center', lineHeight: 17 }}>
            Kova keeps your signature with the country you’re in. You sign again only if that
            changes.
          </Txt>
        </View>
      ) : null}

      {step === 'amount' ? (
        <View style={{ gap: 10 }}>
          <View style={styles.typed}>
            {buying ? (
              <Txt weight="bold" size={28} color={colors.muted} style={styles.sign}>
                $
              </Txt>
            ) : null}
            <Txt
              weight="bold"
              size={picked !== null || typed.length > 7 ? 52 : 64}
              style={{ letterSpacing: -2.5 }}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {picked !== null ? unitsToTyped(picked) : groupTyped(typed)}
            </Txt>
            {buying ? null : (
              <Txt weight="bold" size={18} color={colors.muted} style={{ marginBottom: 12 }}>
                {' '}
                {stock.symbol}
              </Txt>
            )}
          </View>
          <View style={styles.about}>
            <Txt weight="bold" size={14}>
              {amount === 0n || stock.price === null
                ? buying
                  ? 'Up to $1,000 a buy'
                  : `${formatShares(owned)} ${stock.symbol} in your wallet`
                : buying
                  ? `About ${shareOfDollars(Number(amount) / 1e6, stock.price)}`
                  : `About ${stockUsd((Number(amount) / 1e18) * stock.price)}`}
            </Txt>
          </View>
          <View style={styles.chips}>
            {(buying
              ? BUY_CHIPS.map((v) => ({
                  label: formatUsd(v).replace('.00', ''),
                  on: amount === v,
                  pick: () => {
                    setPicked(null)
                    setTyped(String(Number(v) / 1e6))
                  },
                }))
              : (
                  [
                    ['25%', 4n],
                    ['50%', 2n],
                    ['All', 1n],
                  ] as const
                ).map(([label, part]) => ({
                  label,
                  on: picked !== null && picked === owned / part,
                  pick: () => {
                    setPicked(owned / part)
                    setTyped('')
                  },
                }))
            ).map((c) => (
              <Pressable
                key={c.label}
                accessibilityRole="button"
                accessibilityState={{ selected: c.on }}
                onPress={() => {
                  void Haptics.selectionAsync()
                  c.pick()
                }}
                style={[styles.chip, c.on && { backgroundColor: colors.chosen }]}
              >
                <Txt weight="bold" size={15} color={c.on ? colors.onChosen : colors.ink}>
                  {c.label}
                </Txt>
              </Pressable>
            ))}
          </View>
          <Keypad onKey={onKey} size={58} />
          <PillButton
            label={
              tooBig
                ? 'At most $1,000 a buy'
                : tooSmall
                  ? 'At least $1'
                  : over
                    ? buying
                      ? 'More than you have'
                      : 'More than you own'
                    : 'See the price'
            }
            disabled={amount === 0n || over || tooBig || tooSmall}
            onPress={() => {
              setQuote(null)
              moveTo('review')
              void ask()
            }}
          />
        </View>
      ) : null}

      {step === 'review' ? (
        <View style={{ gap: 12 }}>
          <Ticket quote={quote} buying={buying} symbol={stock.symbol} left={left} fresh={quoting} />
          {buying ? (
            <View style={styles.warn}>
              <Txt weight="bold" size={14}>
                Before you buy
              </Txt>
              {STOCK_WARNINGS.map((w) => (
                <View key={w} style={styles.warnRow}>
                  <View style={styles.warnDot} />
                  <Txt size={14} style={{ flex: 1, lineHeight: 19 }}>
                    {w}
                  </Txt>
                </View>
              ))}
            </View>
          ) : null}
          <View style={styles.role}>
            <Icon name="info" size={16} color={colors.ink} />
            <Txt size={13} style={{ flex: 1, lineHeight: 18 }}>
              {buying
                ? STOCK_NOT_ADVICE
                : `${STOCK_NOT_ADVICE.split('. ')[0]}. This swaps your ${stock.symbol} back for dollars on Monad.`}
            </Txt>
          </View>
          {problem ? <Problem text={`${problem} Your money hasn’t moved.`} /> : null}
          <PillButton
            label={
              busy
                ? buying
                  ? 'Buying…'
                  : 'Selling…'
                : quote
                  ? buying
                    ? `Buy ${formatUsd(BigInt(quote.amount_in))} of ${stock.name}`
                    : `Sell for about ${formatUsd(BigInt(quote.amount_out))}`
                  : 'Getting a price…'
            }
            icon="face"
            tone={buying ? 'coral' : 'ink'}
            loading={busy}
            disabled={!quote || lapsed || quoting}
            onPress={() => void trade()}
          />
          <Txt size={12} color={colors.muted} style={{ textAlign: 'center', lineHeight: 17 }}>
            Face ID approves it. If the price slips more than 1%, nothing happens and{' '}
            {buying ? 'your dollars stay put' : 'your shares stay put'}.
          </Txt>
        </View>
      ) : null}

      {step === 'done' && done ? (
        <View style={{ alignItems: 'center', gap: 6, paddingTop: 8 }}>
          <View style={styles.cheer}>
            <Kovi pose="cheer" size={120} />
            <View style={[styles.spark, { left: -34, top: 18 }]}>
              <Sparkle size={22} fill={colors.white} />
            </View>
            <View style={[styles.spark, { right: -36, top: 0 }]}>
              <Sparkle size={26} fill={colors.coralSoft} />
            </View>
            <View style={[styles.spark, { right: -18, bottom: 14 }]}>
              <Sparkle size={18} fill={colors.coral} />
            </View>
          </View>
          <Txt weight="bold" size={36} style={{ letterSpacing: -1.6 }}>
            {buying ? 'Bought' : 'Sold'}
          </Txt>
          <Txt weight="semi" size={16} style={{ textAlign: 'center' }}>
            {buying
              ? `${formatShares(done.received)} ${stock.symbol} is in your wallet.`
              : `${formatUsd(done.received)} is in your balance.`}
          </Txt>
          <View style={[styles.facts, { alignSelf: 'stretch', marginTop: 10 }]}>
            <FactRow
              label={buying ? 'You paid' : 'You sold'}
              value={buying ? formatUsd(done.paid) : `${formatShares(done.paid)} ${stock.symbol}`}
            />
            <FactRow
              label="You got"
              value={
                buying ? `${formatShares(done.received)} ${stock.symbol}` : formatUsd(done.received)
              }
              rule
            />
            <FactRow label="Fee" value="$0.00, Kova covers it" rule />
          </View>
          <View style={{ alignSelf: 'stretch', marginTop: 8 }}>
            <PillButton label="Done" icon="check" onPress={() => router.back()} />
          </View>
          <TextLink
            label="See it on Monad"
            onPress={() =>
              void WebBrowser.openBrowserAsync(explorerTxUrl(STOCKS_NETWORK, done.tx_hash))
            }
          />
        </View>
      ) : null}
    </View>
  )
}

function FactRow({
  label,
  value,
  hint,
  rule,
}: {
  label: string
  value: string
  hint?: string
  rule?: boolean
}) {
  return (
    <View style={[styles.fact, rule && styles.factRule]}>
      <Txt size={14} color={colors.muted}>
        {label}
      </Txt>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        <Txt weight="bold" size={14} style={{ textAlign: 'right' }}>
          {value}
        </Txt>
        {hint ? (
          <Txt size={12} color={colors.muted} style={{ textAlign: 'right' }}>
            {hint}
          </Txt>
        ) : null}
      </View>
    </View>
  )
}

/** The text to sign, set like a letter, with a coral margin and a "Sign once" sticker. */
function Letter({ text }: { text: string }) {
  const lines = text.split('\n').filter(Boolean)
  const meta = lines.filter((l) => /^(Wallet|Date):/.test(l))
  const [head, ...body] = lines.filter((l) => !/^(Wallet|Date):/.test(l))
  return (
    <View style={styles.letter} accessibilityLabel={`What you sign: ${text}`}>
      <View style={styles.margin} />
      <View style={styles.stamp}>
        <Txt weight="bold" size={11} color={colors.dark}>
          Sign once
        </Txt>
      </View>
      {head ? (
        <Txt weight="bold" size={16}>
          {head}
        </Txt>
      ) : null}
      {body.map((l) => (
        <Txt key={l} size={14} style={{ lineHeight: 20 }}>
          {l}
        </Txt>
      ))}
      <View style={styles.meta}>
        {meta.map((l) => {
          const [k, ...v] = l.split(':')
          return (
            <View key={l} style={{ flexDirection: 'row', gap: 8 }}>
              <Txt weight="semi" size={12} color={colors.muted} style={{ width: 50 }}>
                {k}
              </Txt>
              <Txt weight="bold" size={12} style={{ flex: 1 }}>
                {v.join(':').trim()}
              </Txt>
            </View>
          )
        })}
      </View>
    </View>
  )
}

/** The live quote, as a ticket on ink, torn where the price meets what you pay. */
function Ticket({
  quote,
  buying,
  symbol,
  left,
  fresh,
}: {
  quote: TradeQuote | null
  buying: boolean
  symbol: string
  left: number
  fresh: boolean
}) {
  if (!quote)
    return (
      <View
        style={[styles.ticket, { height: 216, alignItems: 'center', justifyContent: 'center' }]}
      >
        <ActivityIndicator color={colors.white} />
        <Txt weight="bold" size={13} color={colors.onInk} style={{ marginTop: 10 }}>
          Getting a live price…
        </Txt>
      </View>
    )
  const out = BigInt(quote.amount_out)
  const least = BigInt(quote.min_out)
  const seconds = Math.ceil(left / 1000)
  const price = Number(quote.price)
  return (
    <View style={styles.ticket} accessibilityLabel="Your price">
      <View style={styles.ticketTop}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt weight="semi" size={13} color={colors.onInk}>
            You get about
          </Txt>
          <Txt
            weight="bold"
            size={36}
            color={colors.white}
            style={{ letterSpacing: -1.6, opacity: fresh ? 0.45 : 1 }}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {buying ? formatShares(out) : formatUsd(out)}
            {buying ? (
              <Txt weight="bold" size={18} color={colors.onInk}>
                {' '}
                {symbol}
              </Txt>
            ) : null}
          </Txt>
          <View style={styles.least}>
            <Txt weight="bold" size={13} color={colors.dark}>
              at least {buying ? `${formatShares(least)} ${symbol}` : formatUsd(least)}
            </Txt>
          </View>
        </View>
        <Countdown left={left} fresh={fresh} />
      </View>
      <View style={styles.tear}>
        <View style={[styles.notch, { left: -11 }]} />
        <View style={styles.dash} />
        <View style={[styles.notch, { right: -11 }]} />
      </View>
      <View style={{ paddingHorizontal: 18, paddingTop: 12, gap: 6 }}>
        {(
          [
            [
              buying ? 'You pay' : 'You sell',
              buying
                ? formatUsd(BigInt(quote.amount_in))
                : `${formatShares(BigInt(quote.amount_in))} ${symbol}`,
            ],
            ['Price', Number.isFinite(price) && price > 0 ? `${stockUsd(price)} a share` : '—'],
            ['Fee', '$0.00, Kova covers it'],
          ] as const
        ).map(([k, v]) => (
          <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Txt size={14} color={colors.onInk}>
              {k}
            </Txt>
            <Txt weight="bold" size={14} color={colors.white}>
              {v}
            </Txt>
          </View>
        ))}
      </View>
      <Txt
        weight="semi"
        size={12}
        color={colors.onInk}
        style={{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: 14 }}
      >
        {fresh
          ? 'Getting a fresh price…'
          : seconds > 0
            ? `Price held for ${seconds} s`
            : 'Price lapsed'}
      </Txt>
    </View>
  )
}

/** The ring's colour on the ticket: teal light enough to read on ink, in either look. */
const ring = pair('#A9C9C9', '#5FA5A9')

function Countdown({ left, fresh }: { left: number; fresh: boolean }) {
  const size = 56
  const r = 23
  const c = 2 * Math.PI * r
  const part = Math.min(1, left / (STOCK_QUOTE_SECONDS * 1000))
  const seconds = Math.ceil(left / 1000)
  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      accessibilityRole="timer"
      accessibilityLabel={`${seconds} seconds left on this price`}
    >
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.14)"
          strokeWidth={5}
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={seconds <= 10 ? colors.coral : ring}
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={`${part * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {fresh ? (
        <ActivityIndicator color={colors.white} size="small" />
      ) : (
        <Txt weight="bold" size={17} color={colors.white}>
          {seconds}
        </Txt>
      )}
    </View>
  )
}

function Problem({ text }: { text: string }) {
  return (
    <View style={styles.problem} accessibilityRole="alert">
      <Icon name="info" size={16} color={colors.danger} />
      <Txt weight="semi" size={13} color={colors.danger} style={{ flex: 1, lineHeight: 18 }}>
        {text}
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: colors.paper, paddingHorizontal: 20, paddingTop: 26, gap: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  h: { letterSpacing: -1, textAlign: 'center' },
  eyebrow: { letterSpacing: 1.6 },
  globeWrap: { width: 78, height: 78, marginTop: 6 },
  globeShadow: {
    position: 'absolute',
    left: 6,
    top: 6,
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.teal,
  },
  globe: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.tealSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  where: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.sunken,
  },
  facts: {
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  fact: { flexDirection: 'row', gap: 12, paddingVertical: 10, alignItems: 'flex-start' },
  factRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.rule },
  letter: {
    marginTop: 4,
    paddingVertical: 14,
    paddingLeft: 18,
    paddingRight: 14,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    gap: 8,
  },
  margin: {
    position: 'absolute',
    left: 8,
    top: 14,
    bottom: 14,
    width: 2,
    borderRadius: 1,
    backgroundColor: colors.coral,
    opacity: 0.7,
  },
  stamp: {
    position: 'absolute',
    right: 14,
    top: -12,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.coral,
    transform: [{ rotate: '4deg' }],
  },
  meta: {
    marginTop: 4,
    paddingTop: 8,
    gap: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.rule,
  },
  check: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  box: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.edge,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.teal, borderColor: colors.tealDeep },
  typed: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', marginTop: 4 },
  sign: { alignSelf: 'flex-start', marginTop: 8, marginRight: 2 },
  about: {
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.tealSoft,
  },
  chips: { flexDirection: 'row', gap: 8, marginTop: 2 },
  chip: {
    flex: 1,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ticket: { borderRadius: 26, backgroundColor: colors.fill },
  ticketTop: { flexDirection: 'row', gap: 12, padding: 18, paddingBottom: 14 },
  least: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.coral,
  },
  tear: { height: 22, justifyContent: 'center' },
  dash: {
    marginHorizontal: 18,
    borderTopWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.22)',
  },
  notch: {
    position: 'absolute',
    top: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.paper,
  },
  warn: {
    gap: 4,
    padding: 14,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.coralSoft,
  },
  warnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  warnDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
    backgroundColor: colors.coralDeep,
  },
  role: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 16,
    backgroundColor: colors.sunken,
  },
  problem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 16,
    backgroundColor: colors.coralSoft,
  },
  cheer: { marginTop: 4 },
  spark: { position: 'absolute' },
})
