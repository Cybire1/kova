import * as Haptics from 'expo-haptics'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import { type Checkout, getCheckout } from '@/lib/api'
import { colors } from '@/lib/theme'
import { useWatchedOrder } from '@/lib/watch'
import { Icon } from '@/ui/Icon'
import { Burst, PopIn } from '@/ui/motion'
import { OrderProgress, progressCopy } from '@/ui/OrderProgress'
import { Header, PillButton, Rise, Screen, Sticker, Txt } from '@/ui/primitives'
import { Stage } from '@/ui/Stage'

/**
 * The buzzer, as a moment: the counter marked your order ready, so Kovi rings the bell and says
 * where it is, on its way to your table or waiting at the counter.
 */
export default function OrderReady() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { width } = useWindowDimensions()
  const watched = useWatchedOrder(id)
  const [checkout, setCheckout] = useState<Checkout | null>(null)

  useEffect(() => {
    // Ding, ding: two taps a beat apart, like a bell on a counter.
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    const second = setTimeout(
      () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
      420,
    )
    getCheckout(id)
      .then(setCheckout)
      .catch(() => {})
    return () => clearTimeout(second)
  }, [id])

  const order = checkout?.order
  const table = order?.table ?? watched?.table ?? null
  const stall = order?.stall?.name ?? watched?.stall ?? checkout?.merchant_name ?? ''
  const items = order
    ? order.lines.map((l) => (l.quantity > 1 ? `${l.quantity} × ${l.name}` : l.name)).join(', ')
    : (watched?.items ?? '')
  const status = order?.status === 'collected' ? 'collected' : 'ready'
  const copy = progressCopy('ready', table)
  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))
  const cx = width / 2

  return (
    <Screen bg={colors.tealSoft}>
      <Header backIcon="close" onBack={close} />
      <View style={{ height: 290, alignItems: 'center', justifyContent: 'flex-end' }}>
        <PopIn delay={300} style={styles.bubble}>
          <Icon name="bell" size={20} />
          <Txt weight="bold" size={20}>
            Ding!
          </Txt>
          <View style={styles.bubbleTail} />
        </PopIn>
        <Stage pose="cheer" size={210} />
        <Burst
          spots={[
            { x: cx - 128, y: 70, size: 30, fill: colors.white, delay: 200 },
            { x: cx + 132, y: 96, size: 26, fill: colors.coralSoft, delay: 380 },
            { x: cx - 112, y: 214, size: 20, fill: colors.coralSoft, delay: 520 },
            { x: cx + 118, y: 236, size: 22, fill: colors.white, delay: 660 },
            { x: cx + 40, y: 24, size: 16, fill: colors.white, delay: 800 },
          ]}
        />
      </View>

      <Rise style={styles.copy}>
        <Txt
          weight="bold"
          size={40}
          style={{ letterSpacing: -1.4, textAlign: 'center', lineHeight: 44 }}
        >
          {copy.title}
        </Txt>
        <Txt weight="medium" size={20} style={{ textAlign: 'center', marginTop: 8 }}>
          {copy.body}
        </Txt>
      </Rise>

      <Rise delay={160} style={{ paddingHorizontal: 20 }}>
        <Sticker radius={26}>
          <View style={styles.ticket}>
            <View
              style={[styles.where, { backgroundColor: table ? colors.coral : colors.surface }]}
            >
              {table ? (
                <>
                  <Txt weight="semi" size={11} color={colors.white} style={{ letterSpacing: 0.6 }}>
                    TABLE
                  </Txt>
                  <Txt
                    weight="bold"
                    size={table.length > 3 ? 16 : 26}
                    color={colors.white}
                    numberOfLines={1}
                    style={{ lineHeight: 30 }}
                  >
                    {table}
                  </Txt>
                </>
              ) : (
                <>
                  <Icon name="stall" size={24} />
                  <Txt weight="semi" size={11} style={{ letterSpacing: 0.6, marginTop: 2 }}>
                    COUNTER
                  </Txt>
                </>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Txt weight="bold" size={18} numberOfLines={1}>
                {stall}
              </Txt>
              <Txt size={14} color={colors.muted} numberOfLines={2} style={{ lineHeight: 19 }}>
                {items}
              </Txt>
            </View>
          </View>
          <View style={styles.progress}>
            <OrderProgress status={status} />
          </View>
        </Sticker>
      </Rise>

      <View style={styles.footer}>
        <PillButton label={table ? 'Lovely, thanks' : 'On my way'} icon="check" onPress={close} />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  bubble: {
    position: 'absolute',
    top: 8,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.raised,
  },
  bubbleTail: {
    position: 'absolute',
    bottom: -8,
    alignSelf: 'center',
    left: '50%',
    marginLeft: -7,
    width: 14,
    height: 14,
    backgroundColor: colors.raised,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: colors.line,
    transform: [{ rotate: '45deg' }],
  },
  copy: { alignItems: 'center', paddingHorizontal: 28, marginTop: 14, marginBottom: 20 },
  ticket: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, paddingBottom: 12 },
  where: {
    width: 64,
    height: 64,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  progress: {
    paddingTop: 14,
    paddingBottom: 12,
    borderTopWidth: 2,
    borderColor: colors.sunken,
    borderStyle: 'dashed',
  },
  footer: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, marginTop: 'auto' },
})
