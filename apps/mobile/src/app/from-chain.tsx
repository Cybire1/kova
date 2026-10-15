import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, Share, StyleSheet, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated'
import {
  type ChainDeposit,
  type DepositSources,
  depositAddressFor,
  depositSources,
  depositsTo,
} from '@/lib/chain'
import { colors, fonts } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Flyer } from '@/ui/art'
import { Icon } from '@/ui/Icon'
import { Bob } from '@/ui/motion'
import { Header, Screen, Sticker, Txt } from '@/ui/primitives'

/** Each kind of chain, drawn as a coloured disc with its mark, so it reads at a glance. */
const LOOK: Record<string, { mark: string; fill: string; ink: string }> = {
  evm: { mark: 'Ξ', fill: '#8FA2E8', ink: colors.ink },
  sol: { mark: '◎', fill: '#B7A3EE', ink: colors.ink },
  tron: { mark: 'T', fill: '#E89A8F', ink: colors.ink },
  btc: { mark: '₿', fill: '#F2C26B', ink: colors.ink },
}

const CHAIN_NAMES: Record<string, string> = {
  eth: 'Ethereum',
  base: 'Base',
  arb: 'Arbitrum',
  bsc: 'BNB Chain',
  pol: 'Polygon',
  op: 'Optimism',
  avax: 'Avalanche',
  sol: 'Solana',
  tron: 'Tron',
  btc: 'Bitcoin',
  monad: 'Monad',
}

/**
 * Bringing money in from another chain, with Aurora Intents (NEAR Intents). Pick where your money
 * is; Kova shows this wallet's own permanent address there. Send USDC, USDT, ETH, SOL or BTC and
 * it arrives here as dollars on Monad, with nothing to bridge and no gas to buy.
 */
export default function FromChain() {
  const { profile } = useWallet()
  const [sources, setSources] = useState<DepositSources | null>(null)
  const [source, setSource] = useState('evm')
  const [addresses, setAddresses] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [deposits, setDeposits] = useState<ChainDeposit[]>([])
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!profile) return
    void depositSources(profile.address)
      .then(setSources)
      .catch((error) => setProblem(error instanceof Error ? error.message : 'Kova didn’t answer.'))
  }, [profile])

  const live = sources?.live ?? false
  const address = addresses[source]

  // This wallet's address for the chosen chain: made once, the same every time after.
  useEffect(() => {
    if (!profile || !live || address) return
    let current = true
    setProblem(null)
    void depositAddressFor(profile.address, source)
      .then((made) => current && setAddresses((a) => ({ ...a, [source]: made.address })))
      .catch(
        (error) =>
          current && setProblem(error instanceof Error ? error.message : 'Kova didn’t answer.'),
      )
    return () => {
      current = false
    }
  }, [profile, live, source, address])

  // Deposits on their way, every few seconds while this screen is open.
  useEffect(() => {
    if (!profile || !address) return
    let stopped = false
    const look = () =>
      void depositsTo(profile.address, address)
        .then((d) => !stopped && setDeposits(d))
        .catch(() => {})
    look()
    const timer = setInterval(look, 5000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [profile, address])

  const chosen = sources?.sources.find((s) => s.id === source)

  return (
    <Screen bg={colors.paper}>
      <Header title="From another chain" />
      <ScrollView contentContainerStyle={styles.body}>
        <Txt size={16} color={colors.muted} style={{ lineHeight: 23 }}>
          Send from wherever your money is. It arrives here as dollars, with nothing to bridge and
          no gas to buy.
        </Txt>

        <View style={styles.sources}>
          {(sources?.sources ?? []).map((s) => {
            const look = LOOK[s.id] ?? LOOK.evm
            const on = s.id === source
            return (
              <Pressable
                key={s.id}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={s.name}
                onPress={() => {
                  void Haptics.selectionAsync()
                  setSource(s.id)
                  setDeposits([])
                }}
                style={({ pressed }) => [
                  styles.source,
                  on && styles.sourceOn,
                  pressed && { transform: [{ scale: 0.96 }] },
                ]}
              >
                <View style={[styles.disc, { backgroundColor: look?.fill }]}>
                  <Txt weight="bold" size={20} color={look?.ink}>
                    {look?.mark}
                  </Txt>
                </View>
                <Txt
                  weight="semi"
                  size={13}
                  color={on ? colors.white : colors.ink}
                  numberOfLines={1}
                >
                  {s.id === 'evm' ? 'EVM chains' : s.name}
                </Txt>
              </Pressable>
            )
          })}
        </View>

        {chosen ? (
          <Txt size={14} color={colors.onTint} style={{ marginTop: 14, lineHeight: 20 }}>
            Send{' '}
            <Txt weight="semi" size={14}>
              {chosen.send.join(', ')}
            </Txt>{' '}
            on {listOf(chosen.chains)}.
          </Txt>
        ) : null}

        {sources && !live ? (
          <Animated.View entering={FadeInDown.duration(300)}>
            <Sticker radius={28} style={{ marginTop: 18 }}>
              <View style={styles.soon}>
                <Bob>
                  <Flyer size={110} />
                </Bob>
                <Txt weight="semi" size={20} style={{ textAlign: 'center' }}>
                  Live on Monad mainnet
                </Txt>
                <Txt
                  size={15}
                  color={colors.muted}
                  style={{ textAlign: 'center', lineHeight: 22, marginTop: 6 }}
                >
                  NEAR Intents moves real liquidity between chains, so this opens when Kova moves to
                  mainnet. On testnet, use free test dollars.
                </Txt>
              </View>
            </Sticker>
          </Animated.View>
        ) : null}

        {live && address ? (
          <Animated.View key={source} entering={FadeIn.duration(260)}>
            <Sticker radius={30} style={{ marginTop: 18 }}>
              <View style={styles.card}>
                <View style={styles.qr}>
                  <QRCode
                    value={address}
                    size={176}
                    color={colors.ink}
                    backgroundColor={colors.surface}
                    ecl="M"
                  />
                </View>
                <Txt weight="semi" size={13} color={colors.muted} style={{ marginTop: 14 }}>
                  Your {chosen?.id === 'evm' ? 'EVM' : chosen?.name} address
                </Txt>
                <Txt size={15} style={styles.address} selectable>
                  {address}
                </Txt>
                <View style={styles.actions}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={async () => {
                      await Clipboard.setStringAsync(address)
                      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1600)
                    }}
                    style={[styles.action, { backgroundColor: colors.ink }]}
                  >
                    <Icon name={copied ? 'check' : 'copy'} size={18} color={colors.white} />
                    <Txt weight="semi" size={15} color={colors.white}>
                      {copied ? 'Copied' : 'Copy'}
                    </Txt>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void Share.share({ message: address })}
                    style={styles.action}
                  >
                    <Icon name="share" size={18} />
                    <Txt weight="semi" size={15}>
                      Share
                    </Txt>
                  </Pressable>
                </View>
              </View>
            </Sticker>
            <Txt
              size={13}
              color={colors.muted}
              style={{ marginTop: 12, lineHeight: 19, textAlign: 'center' }}
            >
              Yours to keep: reuse it any time. Arrives as {sources?.arrives_as} in about 1–3
              minutes. Kova charges nothing; the swap costs a small route fee.
            </Txt>
          </Animated.View>
        ) : null}

        {live && !address && !problem ? (
          <Txt size={15} color={colors.muted} style={{ marginTop: 24, textAlign: 'center' }}>
            Making your address…
          </Txt>
        ) : null}

        {problem ? (
          <Txt weight="medium" size={15} color={colors.danger} style={{ marginTop: 18 }}>
            {problem}
          </Txt>
        ) : null}

        {deposits.length ? (
          <View style={{ marginTop: 22 }}>
            <Txt
              weight="semi"
              size={14}
              color={colors.muted}
              style={{ marginBottom: 8, marginLeft: 4 }}
            >
              Coming in
            </Txt>
            <View style={styles.list}>
              {deposits.map((d, i) => (
                <View
                  key={`${d.tx_hash}:${d.status}`}
                  style={[styles.row, i < deposits.length - 1 && styles.rule]}
                >
                  <View
                    style={[
                      styles.dot,
                      {
                        backgroundColor:
                          d.status === 'arrived'
                            ? colors.positive
                            : d.status === 'failed'
                              ? colors.danger
                              : colors.coral,
                      },
                    ]}
                  />
                  <View style={{ flex: 1 }}>
                    <Txt weight="semi" size={15}>
                      {d.status === 'arrived'
                        ? `${d.amount} arrived`
                        : d.status === 'failed'
                          ? 'Didn’t go through'
                          : `${d.amount} on its way`}
                    </Txt>
                    <Txt size={13} color={colors.muted}>
                      {d.status === 'arrived'
                        ? 'In your Kova wallet on Monad'
                        : `From ${CHAIN_NAMES[d.chain ?? ''] ?? d.chain ?? 'another chain'}, swapping to dollars`}
                    </Txt>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  )
}

/** "Ethereum, Base and Arbitrum". */
function listOf(items: readonly string[]) {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 40 },
  sources: { flexDirection: 'row', gap: 10, marginTop: 18 },
  source: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  sourceOn: { backgroundColor: colors.ink },
  disc: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  soon: { alignItems: 'center', padding: 22 },
  card: { alignItems: 'center', padding: 20 },
  qr: { padding: 12, borderRadius: 20, backgroundColor: colors.surface },
  address: {
    fontFamily: fonts.medium,
    letterSpacing: 0.4,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 22,
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16, alignSelf: 'stretch' },
  action: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  list: {
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rule: { borderBottomWidth: 1, borderColor: colors.sunken },
  dot: { width: 10, height: 10, borderRadius: 5 },
})
