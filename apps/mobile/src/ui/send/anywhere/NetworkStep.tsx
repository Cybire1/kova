import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import {
  crossChainSender,
  type Detected,
  eta,
  feeCeiling,
  type Network,
  type NetworkId,
  network,
  networksFor,
  useLastNetwork,
} from '@/lib/crosschain'
import { formatUsd } from '@/lib/money'
import { colors, fonts } from '@/lib/theme'
import { Icon } from '../../Icon'
import { PillButton, TextLink, Txt } from '../../primitives'
import { ChainLogo, type LogoName } from './ChainLogo'
import { AddressField, InfoLine } from './parts'

/** About what the fee will be (what's signed is the live quote, on the boarding pass). */
const feeText = (n: Network) =>
  n.id === 'monad' || n.fallbackFee === null || n.fallbackFee === 0n
    ? 'Free'
    : formatUsd(feeCeiling(n.fallbackFee))

/** Where sends can go now: the sender's networks, and Monad, which is an ordinary Kova send. */
const reachable = (): NetworkId[] => ['monad', ...(crossChainSender()?.reach ?? [])]

/**
 * Where the address can go. Kova reads the address first: a Solana address can only go to Solana
 * and a Tron one nowhere yet, so neither asks anything; an EVM address works on every EVM network
 * Kova reaches, so the person picks one (starting where they sent it last time); Sui and Aptos
 * share a shape, so that's one question, once Kova sends there. If the address can't receive where
 * it was headed, Kova stops there.
 */
export function NetworkStep({
  found,
  wrong,
  onPick,
  onChange,
}: {
  found: Detected
  /** The network the send was headed to, when the address can't receive there. */
  wrong: Network | null
  onPick: (n: Network) => void
  onChange: () => void
}) {
  const last = useLastNetwork(found.address)
  if (wrong)
    return (
      <WrongNetwork found={found} wrong={wrong} last={last} onPick={onPick} onChange={onChange} />
    )
  const reach = reachable()
  if (found.kind === 'unsupported')
    return <NotYet found={found} family={found.family} onChange={onChange} />
  if (found.kind !== 'evm' && networksFor(found.kind, reach).length === 0)
    return (
      <NotYet
        found={found}
        family={found.kind === 'move' ? 'Sui or Aptos' : 'Solana'}
        onChange={onChange}
      />
    )
  if (found.kind === 'solana')
    return <SolanaFound found={found} onPick={onPick} onChange={onChange} />
  if (found.kind === 'move')
    return <MoveChoice found={found} last={last} onPick={onPick} onChange={onChange} />
  return <EvmPicker found={found} last={last} onPick={onPick} onChange={onChange} />
}

function EvmPicker({
  found,
  last,
  onPick,
  onChange,
}: {
  found: Detected
  last: string | null
  onPick: (n: Network) => void
  onChange: () => void
}) {
  const all = networksFor('evm', reachable())
  const start = found.kind === 'evm' && found.hint ? found.hint : null
  const [chosen, setChosen] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const picked = all.find((n) => n.id === (chosen ?? start ?? last ?? 'base')) ?? network('base')
  const needle = query.trim().toLowerCase()
  const shown = needle ? all.filter((n) => n.name.toLowerCase().includes(needle)) : all
  const pinned = !needle && last ? shown.filter((n) => n.id === last) : []
  const rest = shown.filter((n) => !pinned.includes(n))

  const row = (n: Network) => {
    const on = n.id === picked.id
    return (
      <Pressable
        key={n.id}
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
        accessibilityLabel={`${n.name}, about ${eta(n.seconds)}, ${feeText(n)}`}
        onPress={() => {
          void Haptics.selectionAsync()
          setChosen(n.id)
        }}
        style={[styles.row, on && styles.rowOn]}
      >
        <ChainLogo name={n.id} size={36} />
        <View style={{ flex: 1 }}>
          <Txt weight="semi" size={16}>
            {n.name}
          </Txt>
          {n.id === 'monad' ? (
            <Txt weight="medium" size={12} color={colors.muted}>
              Stays where Kova is
            </Txt>
          ) : n.id === 'ethereum' ? (
            <Txt weight="medium" size={12} color={colors.muted}>
              Gas costs more here
            </Txt>
          ) : null}
        </View>
        <Txt weight="semi" size={14} color={colors.muted} style={styles.colTime}>
          {eta(n.seconds)}
        </Txt>
        <Txt weight="bold" size={15} style={styles.colFee}>
          {feeText(n)}
        </Txt>
        <View style={[styles.radio, on && styles.radioOn]}>
          {on ? <Icon name="check" size={12} color={colors.onChosen} strokeWidth={3.4} /> : null}
        </View>
      </Pressable>
    )
  }

  return (
    <View style={{ flex: 1 }}>
      <AddressField found={found} onClear={onChange} />
      <Txt weight="bold" size={22} style={styles.ask}>
        Which network do they use?
      </Txt>
      <Txt size={14} color={colors.muted} style={{ marginTop: 4, lineHeight: 20 }}>
        This address works on {all.length} networks. Ask them if you’re not sure.
      </Txt>
      <View style={styles.search}>
        <Icon name="search" size={18} color={colors.muted} strokeWidth={2.4} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search networks"
          placeholderTextColor="#8C9799"
          accessibilityLabel="Search networks"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
        />
      </View>
      <View style={styles.heads}>
        <Txt weight="bold" size={12} color={colors.muted} style={{ flex: 1 }}>
          Network
        </Txt>
        <Txt weight="bold" size={12} color={colors.muted} style={styles.colTime}>
          Arrives
        </Txt>
        <Txt weight="bold" size={12} color={colors.muted} style={styles.colFee}>
          Fee
        </Txt>
        <View style={{ width: 30 }} />
      </View>
      <ScrollView
        style={{ flex: 1, marginTop: 4 }}
        contentContainerStyle={{ gap: 2, paddingBottom: 8 }}
        keyboardShouldPersistTaps="handled"
      >
        {pinned.length ? (
          <>
            <Txt weight="semi" size={13} color={colors.muted} style={styles.group}>
              Last time with this address
            </Txt>
            {pinned.map(row)}
            <Txt weight="semi" size={13} color={colors.muted} style={styles.group}>
              All networks
            </Txt>
          </>
        ) : null}
        {rest.map(row)}
        {shown.length === 0 ? (
          <Txt size={14} color={colors.muted} style={{ textAlign: 'center', padding: 28 }}>
            No network called “{query.trim()}”. Kova can’t send there yet.
          </Txt>
        ) : null}
      </ScrollView>
      <View style={{ gap: 12, paddingTop: 10 }}>
        <InfoLine>
          {picked.id === 'monad'
            ? 'On Monad it stays on Kova’s own network: free, in about a second.'
            : `It goes as USDC. Circle delivers it on ${picked.name} and takes its fee from it, so they need no gas.`}
        </InfoLine>
        <PillButton label={`Continue on ${picked.name}`} onPress={() => onPick(picked)} />
      </View>
    </View>
  )
}

function SolanaFound({
  found,
  onPick,
  onChange,
}: {
  found: Detected
  onPick: (n: Network) => void
  onChange: () => void
}) {
  const sol = network('solana')
  return (
    <View style={{ flex: 1 }}>
      <AddressField found={found} onClear={onChange} />
      <View style={styles.found}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View>
            <ChainLogo name="solana" size={56} style={{ borderColor: colors.onFill }} />
            <View style={styles.foundTick}>
              <Icon name="check" size={12} color={colors.white} strokeWidth={3.4} />
            </View>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt weight="bold" size={20} color={colors.onFill} style={{ letterSpacing: -0.4 }}>
              Solana address
            </Txt>
            <Txt size={13} color={colors.onInk} style={{ lineHeight: 18 }}>
              Only Solana uses this kind of address, so there’s nothing to pick.
            </Txt>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Tile label="Arrives" value={`≈ ${eta(sol.seconds)}`} />
          <Tile label="Fee" value={feeText(sol)} />
        </View>
      </View>
      <View style={{ marginTop: 14 }}>
        <InfoLine>They get USDC in their Solana wallet, ready to use. No SOL needed.</InfoLine>
      </View>
      <View style={{ flex: 1 }} />
      <PillButton label="Continue on Solana" onPress={() => onPick(sol)} />
    </View>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.tile}>
      <Txt weight="bold" size={12} color={colors.onInk}>
        {label}
      </Txt>
      <Txt weight="bold" size={18} color={colors.onFill}>
        {value}
      </Txt>
    </View>
  )
}

function MoveChoice({
  found,
  last,
  onPick,
  onChange,
}: {
  found: Detected
  last: string | null
  onPick: (n: Network) => void
  onChange: () => void
}) {
  const options = networksFor('move', reachable())
  const [chosen, setChosen] = useState<string | null>(last)
  const picked = options.find((n) => n.id === chosen) ?? null
  return (
    <View style={{ flex: 1 }}>
      <AddressField found={found} onClear={onChange} />
      <Txt weight="bold" size={22} style={styles.ask}>
        Which one is it?
      </Txt>
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 14 }}>
        {options.map((n) => {
          const on = n.id === chosen
          return (
            <Pressable
              key={n.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => {
                void Haptics.selectionAsync()
                setChosen(n.id)
              }}
              style={[styles.choice, on && styles.choiceOn]}
            >
              <ChainLogo name={n.id} size={52} />
              <View style={{ gap: 2 }}>
                <Txt
                  weight="bold"
                  size={20}
                  color={on ? colors.onChosen : colors.ink}
                  style={{ letterSpacing: -0.4 }}
                >
                  {n.name}
                </Txt>
                <Txt weight="semi" size={13} color={on ? colors.onChosen : colors.muted}>
                  ≈ {eta(n.seconds)} · Free
                </Txt>
              </View>
              {on ? (
                <View style={styles.choiceTick}>
                  <Icon name="check" size={13} strokeWidth={3.4} color={colors.dark} />
                </View>
              ) : null}
            </Pressable>
          )
        })}
      </View>
      <View style={{ marginTop: 16 }}>
        <InfoLine tint>
          {`On Sui and Aptos they collect it themselves, so they need a little ${picked ? picked.gasToken : 'SUI or APT'} for gas. Not sure which? Ask them.`}
        </InfoLine>
      </View>
      <View style={{ flex: 1 }} />
      <PillButton
        label={picked ? `Continue on ${picked.name}` : 'Pick Sui or Aptos'}
        disabled={!picked}
        onPress={() => picked && onPick(picked)}
      />
    </View>
  )
}

const SUGGEST: NetworkId[] = ['base', 'solana', 'ethereum', 'arbitrum', 'polygon', 'optimism']

function NotYet({
  found,
  family,
  onChange,
}: {
  found: Detected
  /** What the address is, as people say it: "Tron", "Sui or Aptos". */
  family: string
  onChange: () => void
}) {
  const ask = 'Can you send me a USDC address on Base or Solana? I’m paying with Kova.'
  const [copied, setCopied] = useState(false)
  return (
    <View style={{ flex: 1 }}>
      <AddressField found={found} onClear={onChange} problem />
      <View style={{ alignItems: 'center', gap: 8, marginTop: 22, paddingHorizontal: 8 }}>
        <View style={styles.unknown}>
          <Txt weight="bold" size={22}>
            {family.charAt(0)}
          </Txt>
        </View>
        <Txt weight="bold" size={22} style={{ letterSpacing: -0.6, textAlign: 'center' }}>
          This looks like a {family} address
        </Txt>
        <Txt size={14} color={colors.muted} style={{ textAlign: 'center', lineHeight: 20 }}>
          {found.kind === 'move'
            ? 'Kova can’t send there yet. Circle doesn’t deliver on Sui or Aptos, so they’d have to collect it with their own gas.'
            : `Kova can’t send there yet. Dollars go out as USDC through Circle, and ${family} isn’t one of its networks.`}
        </Txt>
      </View>
      <View style={styles.suggest}>
        <Txt weight="bold" size={15}>
          Ask them for one of these instead
        </Txt>
        <View style={styles.suggestGrid}>
          {SUGGEST.map((id) => (
            <View key={id} style={styles.suggestItem}>
              <ChainLogo name={id as LogoName} size={40} />
              <Txt weight="semi" size={13}>
                {network(id).name}
              </Txt>
            </View>
          ))}
        </View>
        <View style={styles.bubble}>
          <Txt size={14} color={colors.onTint} style={{ lineHeight: 20 }}>
            “{ask}”
          </Txt>
        </View>
      </View>
      <View style={{ flex: 1 }} />
      <View style={{ gap: 14, alignItems: 'stretch' }}>
        <PillButton
          label={copied ? 'Copied' : 'Copy message'}
          icon={copied ? 'check' : 'copy'}
          onPress={() => {
            void Clipboard.setStringAsync(ask)
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
            setCopied(true)
          }}
        />
        <View style={{ alignItems: 'center' }}>
          <TextLink label="Use another address" onPress={onChange} />
        </View>
      </View>
    </View>
  )
}

function WrongNetwork({
  found,
  wrong,
  last,
  onPick,
  onChange,
}: {
  found: Detected
  wrong: Network
  last: string | null
  onPick: (n: Network) => void
  onChange: () => void
}) {
  const fits = useMemo(
    () => (found.kind === 'unsupported' ? [] : networksFor(found.kind)),
    [found.kind],
  )
  const instead = fits.find((n) => n.id === last) ?? fits.find((n) => n.id !== 'monad') ?? null
  const shape =
    found.kind === 'evm'
      ? 'It starts with 0x, so it lives on Base, Ethereum and the other EVM networks.'
      : found.kind === 'solana'
        ? 'It’s a Solana address, so it only works on Solana.'
        : found.kind === 'move'
          ? 'It’s a Sui or Aptos address, so it only works there.'
          : 'Kova can’t send to it yet.'
  return (
    <View style={{ flex: 1 }}>
      <AddressField found={found} problem />
      <View style={styles.stopped}>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}
        >
          <ChainLogo name={wrong.id} size={48} />
          <View style={styles.stopLine}>
            <View style={styles.stopRule} />
            <View style={styles.stopX}>
              <Icon name="close" size={12} color={colors.white} strokeWidth={3.4} />
            </View>
          </View>
          <View style={styles.stopAddress}>
            <Txt weight="bold" size={14}>
              {found.kind === 'evm' || found.kind === 'move' ? '0x' : found.address.slice(0, 2)}
            </Txt>
          </View>
        </View>
        <View style={{ gap: 6 }}>
          <Txt weight="bold" size={20} style={{ textAlign: 'center', letterSpacing: -0.4 }}>
            That’s not a {wrong.name} address
          </Txt>
          <Txt size={14} color={colors.muted} style={{ textAlign: 'center', lineHeight: 20 }}>
            {shape} Sent to {wrong.name}, nobody could open it.
          </Txt>
        </View>
        <View style={styles.safe}>
          <Icon name="lock" size={14} color={colors.positive} strokeWidth={2.6} />
          <Txt weight="bold" size={13} color={colors.positive}>
            Kova stopped it. Nothing has moved.
          </Txt>
        </View>
      </View>
      <View style={{ flex: 1 }} />
      <View style={{ gap: 10 }}>
        {instead ? (
          <PillButton label={`Send on ${instead.name} instead`} onPress={() => onPick(instead)} />
        ) : null}
        <PillButton
          tone="white"
          label={`Use a ${wrong.name} address`}
          icon="back"
          onPress={onChange}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  ask: { marginTop: 18, letterSpacing: -0.6 },
  search: {
    marginTop: 14,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.sunken,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.ink,
  },
  heads: { flexDirection: 'row', alignItems: 'center', marginTop: 14, paddingHorizontal: 12 },
  group: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  rowOn: { backgroundColor: colors.raised, borderColor: colors.edge },
  colTime: { width: 48, textAlign: 'right' },
  colFee: { width: 56, textAlign: 'right' },
  radio: {
    width: 22,
    height: 22,
    marginLeft: 4,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.edge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { backgroundColor: colors.chosen, borderColor: colors.chosen },
  found: {
    marginTop: 18,
    borderRadius: 28,
    backgroundColor: colors.fill,
    padding: 20,
    gap: 16,
  },
  foundTick: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.teal,
    borderWidth: 2,
    borderColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tile: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 2,
  },
  choice: {
    flex: 1,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: colors.edge,
    backgroundColor: colors.surface,
    padding: 16,
    paddingTop: 18,
    gap: 14,
  },
  choiceOn: { backgroundColor: colors.chosen, borderColor: colors.chosen },
  choiceTick: {
    position: 'absolute',
    right: 14,
    top: 14,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unknown: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.edge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggest: {
    marginTop: 22,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    padding: 16,
    gap: 14,
  },
  suggestGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12 },
  suggestItem: { width: '33.33%', alignItems: 'center', gap: 6 },
  bubble: {
    borderRadius: 18,
    backgroundColor: colors.sunken,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  stopped: {
    marginTop: 18,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    padding: 20,
    gap: 16,
  },
  stopLine: { width: 70, height: 22, justifyContent: 'center', alignItems: 'center' },
  stopRule: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 10,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.rule,
  },
  stopX: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopAddress: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.edge,
    backgroundColor: colors.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  safe: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
})
