import { StyleSheet, View } from 'react-native'
import { colors, pair } from '@/lib/theme'
import { Icon } from './Icon'
import { Txt } from './primitives'

/**
 * A private note, shown as what it is: a slip of paper taped down, with a lock on it. Only the
 * two people in the payment can read it; Kova carried it sealed.
 */
export function PrivateNote({ text, caption }: { text: string; caption: string }) {
  return (
    <View style={styles.wrap} accessible accessibilityLabel={`Private note: ${text}. ${caption}`}>
      <View style={styles.paper}>
        <View style={styles.tape} />
        <View style={styles.lock}>
          <Icon name="lock" size={13} color={colors.white} strokeWidth={2.4} />
          <Txt weight="semi" size={12} color={colors.white}>
            Private note
          </Txt>
        </View>
        <Txt weight="semi" size={22} style={styles.text}>
          “{text}”
        </Txt>
        <Txt size={13} color={colors.onTint}>
          {caption}
        </Txt>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 28, paddingTop: 10 },
  paper: {
    transform: [{ rotate: '-1.5deg' }],
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: 18,
    backgroundColor: pair('#F6E7C8', '#1F1A12'),
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 14,
    gap: 6,
  },
  tape: {
    position: 'absolute',
    top: -11,
    alignSelf: 'center',
    width: 74,
    height: 20,
    borderRadius: 3,
    backgroundColor: pair('rgba(169, 201, 201, 0.85)', 'rgba(95, 165, 169, 0.6)'),
    transform: [{ rotate: '3deg' }],
  },
  lock: {
    position: 'absolute',
    top: -13,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
    backgroundColor: colors.fill,
  },
  text: { letterSpacing: -0.4, lineHeight: 28 },
})
