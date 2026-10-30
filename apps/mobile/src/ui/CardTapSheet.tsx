import { useEffect, useState } from 'react'
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native'
import {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { cancelTap, openNfcSettings, type TapSession, watchTap } from '@/lib/card'
import { colors, pair } from '@/lib/theme'
import Animated from '@/ui/animated'
import { CardArt } from '@/ui/art'
import { Icon } from '@/ui/Icon'
import { Ping, PopIn } from '@/ui/motion'
import { PillButton, TextLink, Txt } from '@/ui/primitives'

/**
 * Android's tap sheet. iPhone has Apple's NFC sheet for reading a card; Android has nothing, so a
 * till would just sit there. This is Kova's: mounted once at the root, it follows lib/card's tap
 * session and shows the back of a phone with the card going to its antenna, the waves quickening
 * when the card connects, a tick when it's read, and, if NFC is off, the one button that turns it
 * on (the tap carries on by itself when they come back).
 */
export function CardTapSheet() {
  const [tap, setTap] = useState<TapSession | null>(null)
  useEffect(() => watchTap(setTap), [])
  const insets = useSafeAreaInsets()
  if (Platform.OS !== 'android') return null
  const stage = tap?.stage
  const title =
    stage === 'off'
      ? 'Turn on NFC'
      : stage === 'reading'
        ? 'Keep holding…'
        : stage === 'done'
          ? (tap?.message ?? 'Done')
          : stage === 'failed'
            ? 'Try again'
            : 'Ready to tap'
  const body =
    stage === 'off'
      ? 'Kova reads the card over NFC, and it’s switched off on this phone. Turn it on, then come back: the tap carries on.'
      : stage === 'reading'
        ? 'The card is connected. Don’t move it for a second.'
        : stage === 'done'
          ? 'You can take the card away.'
          : stage === 'failed'
            ? (tap?.message ?? 'That didn’t work.')
            : `${tap?.prompt ?? 'Hold the card flat against the back of your phone'}. Move it slowly around the middle until it connects.`
  return (
    <Modal visible={!!tap} transparent animationType="slide" onRequestClose={cancelTap}>
      <Pressable accessibilityLabel="Cancel" style={styles.backdrop} onPress={cancelTap} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        <View style={styles.grip} />
        <TapArt stage={stage ?? 'waiting'} />
        <Txt
          weight="bold"
          size={26}
          style={{ textAlign: 'center', letterSpacing: -0.6, marginTop: 6 }}
          accessibilityLiveRegion="polite"
        >
          {title}
        </Txt>
        <Txt
          size={15}
          color={stage === 'failed' ? colors.danger : colors.muted}
          style={{ textAlign: 'center', marginTop: 6, lineHeight: 21, paddingHorizontal: 8 }}
        >
          {body}
        </Txt>
        <View style={{ marginTop: 20, gap: 10, alignItems: 'center' }}>
          {stage === 'off' ? (
            <View style={{ alignSelf: 'stretch' }}>
              <PillButton label="Turn on NFC" icon="tap" onPress={() => void openNfcSettings()} />
            </View>
          ) : null}
          {stage === 'done' ? null : <TextLink label="Cancel" onPress={cancelTap} />}
        </View>
      </View>
    </Modal>
  )
}

const PHONE_W = 118
const PHONE_H = 214
/** The antenna: on most Android phones, a little above the middle of the back. */
const SPOT = { x: PHONE_W / 2, y: PHONE_H * 0.42 }
const CARD_W = 150

/**
 * The back of a phone, its antenna pulsing, and the Kova Card. Waiting, the card glides in from the
 * side to the antenna and back, over and over; connected, it stays docked and the waves turn ink
 * and quicken; read, a tick pops; off, the antenna is dimmed with the card set aside.
 */
function TapArt({ stage }: { stage: TapSession['stage'] }) {
  const reduced = useReducedMotion()
  const glide = useSharedValue(0)
  const docked = stage === 'reading' || stage === 'done'
  useEffect(() => {
    if (docked) glide.value = withSpring(1, { damping: 16, stiffness: 160 })
    else if (stage === 'off' || stage === 'failed' || reduced)
      glide.value = withTiming(0.15, { duration: 300 })
    else
      glide.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 1300, easing: Easing.bezier(0.3, 0, 0.2, 1) }),
          withTiming(1, { duration: 700 }),
          withTiming(0, { duration: 600, easing: Easing.in(Easing.quad) }),
          withTiming(0, { duration: 300 }),
        ),
        -1,
      )
  }, [docked, stage, reduced, glide])
  // The card's centre travels from the lower right to the antenna, turning flat as it lands.
  const card = useAnimatedStyle(() => ({
    opacity: 0.35 + 0.65 * Math.min(1, glide.value * 1.6),
    transform: [
      { translateX: (1 - glide.value) * 120 },
      { translateY: (1 - glide.value) * 70 },
      { rotate: `${(1 - glide.value) * 14 - 8}deg` },
    ],
  }))
  return (
    <View style={styles.art} accessible={false}>
      <View style={styles.phone}>
        <View style={styles.camera}>
          <View style={styles.lens} />
          <View style={[styles.lens, { width: 10, height: 10 }]} />
        </View>
        <View
          style={[
            styles.spot,
            { left: SPOT.x - 30, top: SPOT.y - 30, opacity: stage === 'off' ? 0.25 : 1 },
          ]}
        >
          {stage === 'off' ? null : (
            <>
              <Ping size={60} color={docked ? colors.ink : colors.coral} />
              <Ping
                size={60}
                color={docked ? colors.ink : colors.coral}
                delay={docked ? 400 : 1200}
              />
            </>
          )}
          <Icon name="tap" size={22} color={stage === 'off' ? colors.muted : colors.ink} />
        </View>
      </View>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.card,
          { left: ART_W / 2 - CARD_W / 2, top: PHONE_TOP + SPOT.y - CARD_W * 0.32 },
          card,
        ]}
      >
        <CardArt width={CARD_W} last4="••••" />
      </Animated.View>
      {stage === 'done' ? (
        <View style={[styles.tick, { left: ART_W / 2 + PHONE_W / 2 - 20, top: PHONE_TOP - 10 }]}>
          <PopIn>
            <View style={styles.tickDisc}>
              <Icon name="check" size={22} color={colors.white} strokeWidth={3} />
            </View>
          </PopIn>
        </View>
      ) : null}
    </View>
  )
}

const ART_W = 300
const PHONE_TOP = 18

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: pair('rgba(11,26,29,0.32)', 'rgba(0,0,0,0.6)') },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  grip: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.rule,
  },
  art: { alignSelf: 'center', width: ART_W, height: PHONE_H + PHONE_TOP + 24, marginTop: 8 },
  phone: {
    position: 'absolute',
    left: ART_W / 2 - PHONE_W / 2,
    top: PHONE_TOP,
    width: PHONE_W,
    height: PHONE_H,
    borderRadius: 26,
    borderWidth: 3,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  camera: {
    position: 'absolute',
    left: 12,
    top: 12,
    width: 34,
    height: 50,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'space-evenly',
  },
  lens: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: colors.ink },
  spot: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    position: 'absolute',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 6,
  },
  tick: { position: 'absolute' },
  tickDisc: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.paper,
  },
})
