import { StyleSheet, View } from 'react-native'
import type { OrderStatus } from '@/lib/api'
import { colors } from '@/lib/theme'
import { Icon, type IconName } from './Icon'
import { Ping } from './motion'
import { Txt } from './primitives'

const STEPS: { status: OrderStatus; label: string; icon: IconName }[] = [
  { status: 'new', label: 'Paid', icon: 'check' },
  { status: 'preparing', label: 'Making it', icon: 'clock' },
  { status: 'ready', label: 'Ready', icon: 'bell' },
  { status: 'collected', label: 'Enjoy', icon: 'bag' },
]

/** What the buyer reads at each step, and where it ends up. */
export function progressCopy(status: OrderStatus, table: string | null) {
  switch (status) {
    case 'new':
      return {
        title: 'They’ve got your order',
        body: table
          ? `It comes to table ${table} when it’s ready. Your phone tells you first.`
          : 'Your phone tells you when it’s ready. No buzzer needed.',
      }
    case 'preparing':
      return {
        title: 'They’re making it now',
        body: table
          ? `Sit tight at table ${table}. Your phone tells you when it’s ready.`
          : 'Your phone tells you when it’s ready.',
      }
    case 'ready':
      return {
        title: 'Your order is ready',
        body: table ? `We’re bringing it to table ${table}.` : 'Collect it at the counter.',
      }
    case 'collected':
      return { title: 'Enjoy!', body: 'Handed over. Thanks for ordering with Kova.' }
    default:
      return { title: 'This order was cancelled', body: 'Ask at the counter if that’s a surprise.' }
  }
}

/** Where an order is at the counter, as four stops: paid, making it, ready, enjoy. */
export function OrderProgress({ status }: { status: OrderStatus }) {
  const at = Math.max(
    0,
    STEPS.findIndex((s) => s.status === status),
  )
  const cancelled = status === 'cancelled'
  return (
    <View
      style={styles.row}
      accessibilityRole="progressbar"
      accessibilityLabel={`Order: ${STEPS[at]?.label ?? status}`}
    >
      <View style={styles.track} />
      <View
        style={[styles.fill, { width: `${(cancelled ? 0 : at / (STEPS.length - 1)) * 76}%` }]}
      />
      {STEPS.map((step, i) => {
        const done = !cancelled && i < at
        const now = !cancelled && i === at
        return (
          <View key={step.status} style={styles.stop}>
            <View style={styles.discWrap}>
              {now && step.status !== 'collected' ? (
                <Ping size={34} color={step.status === 'ready' ? colors.coral : colors.teal} />
              ) : null}
              <View
                style={[
                  styles.disc,
                  done && { backgroundColor: colors.chosen },
                  now && {
                    backgroundColor: step.status === 'ready' ? colors.coral : colors.tealSoft,
                    transform: [{ scale: 1.12 }],
                  },
                ]}
              >
                <Icon
                  name={done ? 'check' : step.icon}
                  size={15}
                  color={done ? colors.onChosen : colors.ink}
                  strokeWidth={2.4}
                />
              </View>
            </View>
            <Txt
              weight={now ? 'bold' : 'medium'}
              size={12}
              color={now || done ? colors.ink : colors.muted}
            >
              {step.label}
            </Txt>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  track: {
    position: 'absolute',
    left: '12%',
    right: '12%',
    top: 16,
    height: 2,
    backgroundColor: colors.sunken,
  },
  fill: { position: 'absolute', left: '12%', top: 16, height: 2, backgroundColor: colors.fill },
  stop: { width: '25%', alignItems: 'center', gap: 6 },
  discWrap: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  disc: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
