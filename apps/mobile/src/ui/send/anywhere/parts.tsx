import { Pressable, StyleSheet, View } from 'react-native'
import { type Detected, howKnown } from '@/lib/crosschain'
import { colors } from '@/lib/theme'
import { Icon } from '../../Icon'
import { Txt } from '../../primitives'
import { ChainLogo } from './ChainLogo'

/** The address they gave, its ends in ink and its middle muted, with what Kova read it as. */
export function AddressField({
  found,
  problem,
  onClear,
}: {
  found: Detected
  /** Drawn in the danger colour: the address can't go where it was headed. */
  problem?: boolean
  onClear?: () => void
}) {
  const a = found.address
  const head = a.slice(0, 6)
  const tail = a.slice(-4)
  const middle = a.length > 14 ? ` ${a.slice(6, 10)} … ${a.slice(-8, -4)} ` : ' … '
  return (
    <View>
      <View style={[styles.field, problem ? { borderColor: colors.danger } : null]}>
        {found.kind === 'solana' ? (
          <ChainLogo name="solana" size={40} />
        ) : found.kind === 'evm' ? (
          <View style={styles.kind}>
            <Txt weight="bold" size={12} color={colors.onFill} style={{ letterSpacing: 0.3 }}>
              EVM
            </Txt>
          </View>
        ) : null}
        <Txt
          weight="bold"
          size={17}
          numberOfLines={1}
          style={{ flex: 1, letterSpacing: 0.2, marginLeft: found.kind === 'move' ? 8 : 0 }}
          accessibilityLabel={`Address ${a}`}
        >
          {head}
          <Txt weight="semi" size={17} color={colors.muted}>
            {middle}
          </Txt>
          {tail}
        </Txt>
        {onClear ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change address"
            hitSlop={8}
            onPress={onClear}
            style={styles.clear}
          >
            <Icon name="close" size={14} strokeWidth={2.8} />
          </Pressable>
        ) : null}
      </View>
      {problem ? null : (
        <Txt weight="semi" size={12} color={colors.muted} style={styles.known}>
          {howKnown(found)}
        </Txt>
      )}
    </View>
  )
}

/** A quiet line with an info mark. */
export function InfoLine({ children, tint }: { children: string; tint?: boolean }) {
  return (
    <View style={[styles.info, tint && styles.infoTint]}>
      <View style={{ marginTop: 1 }}>
        <Icon name="info" size={16} color={tint ? colors.onTint : colors.muted} strokeWidth={2.4} />
      </View>
      <Txt
        size={13}
        color={tint ? colors.onTint : colors.muted}
        style={{ flex: 1, lineHeight: 18 }}
      >
        {children}
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  field: {
    height: 60,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 8,
    paddingRight: 10,
    gap: 10,
  },
  kind: {
    height: 28,
    paddingHorizontal: 8,
    borderRadius: 9,
    backgroundColor: colors.fill,
    justifyContent: 'center',
    marginLeft: 6,
  },
  clear: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.wash,
    alignItems: 'center',
    justifyContent: 'center',
  },
  known: { marginTop: 8, marginLeft: 6 },
  info: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 4 },
  infoTint: {
    borderRadius: 20,
    backgroundColor: colors.sunken,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 10,
  },
})
