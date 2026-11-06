import * as Haptics from 'expo-haptics'
import { Pressable, StyleSheet, View } from 'react-native'
import { canCoverGas, eta, type Network, network, type Quote, shortAddress } from '@/lib/crosschain'
import { formatUsd } from '@/lib/money'
import { colors } from '@/lib/theme'
import { Plane } from '../../art'
import { Txt } from '../../primitives'
import { ChainLogo } from './ChainLogo'

/** USDC base units → "249.95". */
const usdc = (base: bigint) => formatUsd(base).replace('$', '')

/** The dashes of the tear line, each with a name to key it by. */
const PERFORATION = Array.from({ length: 22 }, (_, i) => `dash-${i}`)

const codeSize = (code: string) => (code.length <= 3 ? 38 : code.length === 4 ? 34 : 29)

/**
 * The review, as a boarding pass: from Monad to their network, in codes like airports, then what
 * you send, what they get, when it lands and the fee. When the bridge lets their gas go uncovered,
 * that's the one choice here; otherwise Circle always delivers and takes its fee in USDC.
 */
export function BoardingPass({
  to,
  recipient,
  quote,
  live,
  coverOptional,
  onCover,
}: {
  to: Network
  recipient: string
  quote: Quote
  /** Whether these are the exact numbers (otherwise an estimate, while the quote comes in). */
  live: boolean
  coverOptional: boolean
  onCover: (on: boolean) => void
}) {
  const from = network('monad')
  const coverable = coverOptional && canCoverGas(to)
  return (
    <View style={styles.pass} accessibilityLabel={`From Monad to ${to.name}`}>
      <View style={styles.top}>
        <View style={styles.between}>
          <Txt weight="bold" size={11} color={colors.muted} style={styles.label}>
            FROM
          </Txt>
          <Txt weight="bold" size={11} color={colors.muted} style={styles.label}>
            TO
          </Txt>
        </View>
        <View style={[styles.between, { alignItems: 'center' }]}>
          <Txt weight="bold" size={codeSize(from.code)} style={styles.code}>
            {from.code}
          </Txt>
          <View style={styles.arc}>
            <View style={styles.dots}>
              {Array.from({ length: 9 }, (_, i) => {
                const u = i / 8
                const y = 34 - 4 * 30 * u * (1 - u)
                return <View key={u} style={[styles.dot, { left: 4 + u * 84, top: y }]} />
              })}
            </View>
            <View style={styles.plane}>
              <Plane size={30} />
            </View>
          </View>
          <Txt weight="bold" size={codeSize(to.code)} style={styles.code}>
            {to.code}
          </Txt>
        </View>
        <View style={[styles.between, { marginTop: 8, alignItems: 'center' }]}>
          <View style={styles.who}>
            <ChainLogo name="monad" size={22} />
            <Txt weight="semi" size={13}>
              You, on Monad
            </Txt>
          </View>
          <View style={styles.who}>
            <Txt weight="semi" size={13}>
              {shortAddress(recipient)}
            </Txt>
            <ChainLogo name={to.id} size={22} />
          </View>
        </View>
      </View>

      <View style={styles.tear}>
        <View style={[styles.notch, { left: -15 }]} />
        <View style={[styles.notchCover, { left: -19 }]} />
        <View style={[styles.notch, { right: -15 }]} />
        <View style={[styles.notchCover, { right: -19 }]} />
        <View style={styles.perforation}>
          {PERFORATION.map((id) => (
            <View key={id} style={styles.perf} />
          ))}
        </View>
      </View>

      <View style={styles.bottom}>
        <View style={styles.grid}>
          <Field label="YOU SEND" value={formatUsd(quote.amount)} />
          <Field label="THEY GET" value={`${live ? '' : '≈ '}${usdc(quote.receive)}`} unit="USDC" />
          <Field label="ARRIVES" value={`≈ ${eta(quote.seconds)}`} />
          <Field
            label="FEE"
            value={quote.fee === 0n ? 'Free' : `${live ? '' : '≈ '}${formatUsd(quote.fee)}`}
          />
        </View>
        <View style={styles.rule} />
        {coverable ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt weight="bold" size={15}>
                Cover their gas
              </Txt>
              <Txt size={13} color={colors.muted} style={{ lineHeight: 18 }}>
                {quote.coverGas
                  ? `They can spend it the moment it lands. Circle sets the fee.`
                  : `Free, but they need a little ${to.gasToken} on ${to.name} to collect it.`}
              </Txt>
            </View>
            <Pressable
              accessibilityRole="switch"
              accessibilityLabel="Cover their gas"
              accessibilityState={{ checked: quote.coverGas }}
              hitSlop={8}
              onPress={() => {
                void Haptics.selectionAsync()
                onCover(!quote.coverGas)
              }}
              style={[styles.track, quote.coverGas && { backgroundColor: colors.teal }]}
            >
              <View style={[styles.knob, { left: quote.coverGas ? 22 : 2 }]} />
            </Pressable>
          </View>
        ) : quote.coverGas ? (
          <Txt size={13} color={colors.muted} style={{ lineHeight: 18 }}>
            Circle delivers it on {to.name} and takes its fee from the USDC, so they need no gas.
            You need no MON either.
          </Txt>
        ) : (
          <Txt size={13} color={colors.muted} style={{ lineHeight: 18 }}>
            On {to.name} they collect it themselves, with a little {to.gasToken} for gas.
          </Txt>
        )}
      </View>
    </View>
  )
}

function Field({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View style={{ width: '50%', gap: 4, paddingRight: 8 }}>
      <Txt weight="bold" size={11} color={colors.muted} style={styles.label}>
        {label}
      </Txt>
      <Txt weight="bold" size={22} style={{ letterSpacing: -0.5 }}>
        {value}
        {unit ? (
          <Txt weight="bold" size={13} color={colors.muted}>
            {` ${unit}`}
          </Txt>
        ) : null}
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  pass: {
    borderRadius: 28,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  top: { paddingTop: 18, paddingHorizontal: 20, paddingBottom: 16, gap: 4 },
  between: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { letterSpacing: 1.3 },
  code: { letterSpacing: -1.5 },
  arc: { width: 92, height: 44 },
  dots: { ...StyleSheet.absoluteFillObject },
  dot: {
    position: 'absolute',
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.ink,
    opacity: 0.55,
  },
  plane: { position: 'absolute', left: 31, top: -4, transform: [{ rotate: '18deg' }] },
  who: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tear: { height: 26, justifyContent: 'center' },
  notch: {
    position: 'absolute',
    top: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.paper,
  },
  notchCover: {
    position: 'absolute',
    top: -2,
    width: 18,
    height: 32,
    backgroundColor: colors.paper,
  },
  perforation: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 22,
  },
  perf: { width: 6, height: 2, borderRadius: 1, backgroundColor: colors.rule },
  bottom: { paddingTop: 14, paddingHorizontal: 20, paddingBottom: 18, gap: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 16 },
  rule: { height: 1, backgroundColor: colors.rule },
  track: {
    width: 52,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.edge,
    backgroundColor: colors.sunken,
  },
  knob: {
    position: 'absolute',
    top: 2,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.edge,
    backgroundColor: colors.white,
  },
})
