import * as Haptics from 'expo-haptics'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { createItem, type MenuImport, readMenuPhoto } from '@/lib/api'
import { type PhotoSource, takePhoto } from '@/lib/photos'
import { useStall } from '@/lib/stall'
import { colors, fonts } from '@/lib/theme'
import { Kovi } from '@/ui/art'
import { Icon } from '@/ui/Icon'
import { Header, PillButton, Screen, Txt } from '@/ui/primitives'

type Line = MenuImport['items'][number] & { keep: boolean }
type Stage = 'pick' | 'reading' | 'review' | 'saving'

const symbols: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  NGN: '₦',
  KES: 'KSh ',
  MXN: 'MX$',
}
const original = (o: { amount: number; currency: string }) =>
  o.currency === 'USD' || o.currency === 'UNKNOWN'
    ? null
    : `${symbols[o.currency] ?? ''}${o.amount.toLocaleString('en-US')}`

/**
 * Snap your menu: a photo of a menu board or price list becomes items on your stall. Kova reads
 * names and prices, turns local prices into dollars at its reference rate, and you check every
 * line before anything is added.
 */
export default function SnapMenu() {
  const { stall, refresh } = useStall()
  const [stage, setStage] = useState<Stage>('pick')
  const [photo, setPhoto] = useState<string | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [currency, setCurrency] = useState('USD')
  const [problem, setProblem] = useState<string | null>(null)
  const [added, setAdded] = useState(0)

  const read = async (from: PhotoSource) => {
    setProblem(null)
    try {
      const shot = await takePhoto(from, 'menu')
      if (!shot?.base64) return
      setPhoto(shot.uri)
      setStage('reading')
      const menu = await readMenuPhoto(shot.base64)
      if (!menu.items.length)
        throw new Error('No prices found in that photo. Try closer, straight on, in good light.')
      setCurrency(menu.currency)
      setLines(menu.items.map((i) => ({ ...i, keep: true })))
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setStage('review')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kova couldn’t read that menu.'
      setProblem(
        /not set up/i.test(message)
          ? 'Reading menus isn’t switched on for this Kova server yet. Add items one at a time for now.'
          : message,
      )
      setStage('pick')
    }
  }

  const update = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const chosen = lines.filter((l) => l.keep)

  const addAll = async () => {
    setStage('saving')
    setProblem(null)
    let done = 0
    for (const line of chosen) {
      try {
        await createItem({
          name: line.name.trim(),
          price: line.price,
          description: line.description || null,
          stall_ids: stall ? [stall.id] : [],
        })
        done += 1
        setAdded((n) => n + 1)
      } catch (error) {
        setProblem(`${line.name}: ${error instanceof Error ? error.message : 'couldn’t be added'}`)
        break
      }
    }
    // Keep only the lines that didn't make it, so fixing one and trying again is easy.
    setLines((ls) => {
      let skipped = 0
      return ls.filter((l) => !l.keep || skipped++ >= done)
    })
    await refresh().catch(() => {})
    if (done === chosen.length) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      router.back()
    } else setStage('review')
  }

  return (
    <Screen bg={colors.paper}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Header title="Snap your menu" backIcon="close" />
        {stage === 'pick' || stage === 'reading' ? (
          <View style={styles.pick}>
            <View style={styles.frame}>
              {photo ? (
                <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <Kovi pose="key" size={170} />
              )}
              {stage === 'reading' ? <Reading /> : null}
            </View>
            <Txt
              weight="bold"
              size={26}
              style={{ letterSpacing: -0.6, marginTop: 22, textAlign: 'center' }}
            >
              {stage === 'reading' ? 'Reading your menu' : 'Photograph your price board'}
            </Txt>
            <Txt
              size={15}
              color={colors.muted}
              style={{ textAlign: 'center', marginTop: 6, lineHeight: 22 }}
            >
              {stage === 'reading'
                ? 'Picking out every item and price. Prices in euros, pounds or any other money become dollars at Kova’s reference rate.'
                : 'A menu, a chalkboard or a printed price list. You check every line before anything goes on your stall.'}
            </Txt>
            {problem ? (
              <Txt
                weight="medium"
                size={14}
                color={colors.danger}
                style={{ textAlign: 'center', marginTop: 12, lineHeight: 20 }}
              >
                {problem}
              </Txt>
            ) : null}
            <View style={{ flex: 1 }} />
            {stage === 'pick' ? (
              <View style={{ alignSelf: 'stretch', gap: 10 }}>
                <PillButton
                  label="Take a photo"
                  icon="camera"
                  onPress={() => void read('camera')}
                />
                <PillButton
                  label="Choose a photo"
                  icon="image"
                  tone="white"
                  onPress={() => void read('library')}
                />
              </View>
            ) : (
              <ActivityIndicator color={colors.ink} style={{ marginBottom: 24 }} />
            )}
          </View>
        ) : (
          <>
            <ScrollView
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
              keyboardShouldPersistTaps="handled"
            >
              <Txt size={14} color={colors.muted} style={{ lineHeight: 20, marginBottom: 12 }}>
                Found {lines.length} {lines.length === 1 ? 'item' : 'items'}
                {currency !== 'USD' && currency !== 'UNKNOWN'
                  ? `, priced in ${currency} and turned into dollars`
                  : ''}
                . Untick what isn’t for sale, and fix anything misread.
              </Txt>
              <View style={styles.lines}>
                {lines.map((l, i) => (
                  <View
                    key={`${l.name}-${i}`}
                    style={[
                      styles.line,
                      i < lines.length - 1 && styles.rule,
                      !l.keep && { opacity: 0.45 },
                    ]}
                  >
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: l.keep }}
                      accessibilityLabel={`Add ${l.name}`}
                      hitSlop={8}
                      onPress={() => {
                        void Haptics.selectionAsync()
                        update(i, { keep: !l.keep })
                      }}
                      style={[styles.check, l.keep && styles.checkOn]}
                    >
                      {l.keep ? (
                        <Icon name="check" size={16} color={colors.white} strokeWidth={2.8} />
                      ) : null}
                    </Pressable>
                    <View style={{ flex: 1 }}>
                      <TextInput
                        value={l.name}
                        onChangeText={(name) => update(i, { name })}
                        style={styles.name}
                        accessibilityLabel="Name"
                        maxLength={80}
                      />
                      {original(l.original) ? (
                        <Txt size={12} color={colors.muted}>
                          {original(l.original)} on the menu
                        </Txt>
                      ) : null}
                    </View>
                    <View style={styles.price}>
                      <Txt weight="semi" size={15} color={colors.muted}>
                        $
                      </Txt>
                      <TextInput
                        value={l.price}
                        onChangeText={(price) =>
                          update(i, { price: price.replace(/[^0-9.]/g, '') })
                        }
                        keyboardType="decimal-pad"
                        style={styles.priceInput}
                        accessibilityLabel={`Price of ${l.name}`}
                      />
                    </View>
                  </View>
                ))}
              </View>
            </ScrollView>
            <View style={styles.footer}>
              {problem ? (
                <Txt
                  weight="medium"
                  size={14}
                  color={colors.danger}
                  style={{ marginBottom: 10, textAlign: 'center' }}
                >
                  {problem}
                </Txt>
              ) : null}
              <PillButton
                label={
                  stage === 'saving'
                    ? `Adding ${added + 1} of ${chosen.length}`
                    : `Add ${chosen.length} to ${stall?.name ?? 'your stall'}`
                }
                icon="plus"
                disabled={chosen.length === 0}
                loading={stage === 'saving'}
                onPress={addAll}
              />
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </Screen>
  )
}

/** A coral line sweeping down the photo while Kova reads it. */
function Reading() {
  const reduced = useReducedMotion()
  const v = useSharedValue(0)
  useEffect(() => {
    if (!reduced)
      v.value = withRepeat(
        withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      )
  }, [reduced, v])
  const style = useAnimatedStyle(() => ({ top: `${6 + v.value * 88}%` }))
  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(169,201,201,0.28)' }]}
      pointerEvents="none"
    >
      <Animated.View style={[styles.sweep, style]} />
    </View>
  )
}

const styles = StyleSheet.create({
  pick: { flex: 1, alignItems: 'center', paddingHorizontal: 24, paddingBottom: 12 },
  frame: {
    marginTop: 12,
    width: 250,
    height: 250,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sweep: {
    position: 'absolute',
    left: 14,
    right: 14,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.coral,
  },
  lines: {
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rule: { borderBottomWidth: 1, borderColor: colors.sunken },
  check: {
    width: 28,
    height: 28,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.ink },
  name: { fontFamily: fonts.semi, fontSize: 16, color: colors.ink, paddingVertical: 2 },
  price: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 40,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: colors.paper,
  },
  priceInput: {
    minWidth: 52,
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.ink,
    textAlign: 'right',
  },
  footer: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12 },
})
