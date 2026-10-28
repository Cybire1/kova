import * as Haptics from 'expo-haptics'
import { useFocusEffect, useLocalSearchParams } from 'expo-router'
import { type ReactNode, useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native'
import { FadeIn } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { formatUsd } from '@/lib/money'
import { usePrivate } from '@/lib/private'
import type { PrivateReceipt } from '@/lib/private-core'
import { colors, pair } from '@/lib/theme'
import Animated from '@/ui/animated'
import { Icon, type IconName } from '@/ui/Icon'
import { PrivateCard, PrivateFlow, PrivateRow, ReceivingCard } from '@/ui/Private'
import { Header, PillButton, Rise, RoundButton, Screen, TextLink, Txt } from '@/ui/primitives'

/** "Today", "Yesterday", or the date: how private payments are grouped. */
function dayOf(at: number) {
  const d = new Date(at)
  if (d.toDateString() === new Date().toDateString()) return 'Today'
  if (d.toDateString() === new Date(Date.now() - 86_400_000).toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
}

/**
 * Private dollars: the part of your balance only you can tell is yours. Nothing to manage here:
 * what's private and who it's from at the top, a plain button to move them to the main wallet (with
 * what that gives away, said once), how it works a tap away, every private payment below, and
 * whether people can send to you privately at the bottom.
 */
export default function PrivateDollars() {
  const p = usePrivate()
  // Development only: `menu=1` opens the ⋯ and `how=1` How private works, for screenshots.
  const dev = useLocalSearchParams<{ menu?: string; how?: string }>()
  const [refreshing, setRefreshing] = useState(false)
  const [menu, setMenu] = useState(__DEV__ && dev.menu === '1')
  const [confirming, setConfirming] = useState(false)
  const [how, setHow] = useState(__DEV__ && dev.how === '1')
  const { refresh } = p

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )

  const days = useMemo(() => {
    const groups: { day: string; receipts: PrivateReceipt[] }[] = []
    // Your own dollars put together into one address aren't a payment to you.
    for (const r of p.receipts.filter((x) => x.kind !== 'change')) {
      const day = dayOf(r.at)
      const last = groups[groups.length - 1]
      if (last?.day === day) last.receipts.push(r)
      else groups.push({ day, receipts: [r] })
    }
    return groups
  }, [p.receipts])
  const payments = days.reduce((n, d) => n + d.receipts.length, 0)
  const canMakePublic = p.keysHere && p.waiting > 0n && !p.progress

  return (
    <Screen edges={['top']}>
      <Header
        title="Private dollars"
        subtitle={p.keysHere && p.published ? 'Only you can see these' : undefined}
        right={
          p.keysHere ? <RoundButton icon="more" label="More" onPress={() => setMenu(true)} /> : null
        }
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.ink}
            onRefresh={async () => {
              setRefreshing(true)
              await refresh()
              setRefreshing(false)
            }}
          />
        }
      >
        {!p.ready ? (
          <ActivityIndicator color={colors.ink} style={{ marginTop: 60 }} />
        ) : (
          <>
            <Rise>
              <PrivateCard plain />
            </Rise>

            {/* The way out of private, where people look for it: right under the amount. */}
            {canMakePublic ? (
              <View style={{ marginTop: 14, gap: 8 }}>
                <PillButton
                  label="Move to main wallet"
                  icon="receive"
                  onPress={() => {
                    void Haptics.selectionAsync()
                    setConfirming(true)
                  }}
                />
                <Txt size={13} color={colors.muted} style={{ textAlign: 'center', lineHeight: 18 }}>
                  You don’t need to, to spend them: Kova pays and sends from private dollars
                  privately.
                </Txt>
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: how }}
              onPress={() => {
                void Haptics.selectionAsync()
                setHow(!how)
              }}
              hitSlop={6}
              style={styles.howLink}
            >
              <Icon name="info" size={16} />
              <Txt weight="semi" size={15} style={{ textDecorationLine: 'underline' }}>
                How private works
              </Txt>
              <Icon name={how ? 'chevronUp' : 'chevronDown'} size={15} strokeWidth={2.4} />
            </Pressable>
            {how ? (
              <Animated.View entering={FadeIn.duration(220)} style={styles.explain}>
                <PrivateFlow receipt={p.receipts.find((r) => r.kind !== 'change')} />
                <Txt size={14} color={colors.onTint} style={{ marginTop: 14, lineHeight: 20 }}>
                  Someone who sends you dollars privately pays an address made just for that
                  payment. Who sent it and how much is public, but only your keys can tell the
                  address is yours, so nobody can add up what you receive.
                </Txt>
                <Txt size={13} color={colors.muted} style={{ marginTop: 8, lineHeight: 18 }}>
                  They count in your balance straight away. When you pay a shop or send privately,
                  Kova pays straight from them, so your wallet never shows. If a payment needs a
                  little more than your balance holds, just enough moves in first, and Kova says so
                  before it does: that move is public.
                </Txt>
              </Animated.View>
            ) : null}

            <View style={styles.sectionRow}>
              <Txt weight="bold" size={20}>
                Every private payment
              </Txt>
              {days.length ? (
                <Txt size={14} color={colors.muted}>
                  {payments} {payments === 1 ? 'payment' : 'payments'}
                </Txt>
              ) : null}
            </View>
            {days.length === 0 ? (
              <View style={styles.none}>
                <Txt size={15} color={colors.muted} style={{ lineHeight: 21 }}>
                  {p.keysHere
                    ? 'Private payments show up here the moment they land.'
                    : 'Set up private receiving on this phone to see them.'}
                </Txt>
              </View>
            ) : (
              days.map((group) => (
                <View key={group.day} style={{ marginBottom: 14 }}>
                  <Txt weight="semi" size={13} color={colors.muted} style={styles.day}>
                    {group.day}
                  </Txt>
                  <View style={styles.list}>
                    {group.receipts.map((r, i) => (
                      <PrivateRow key={r.id} receipt={r} last={i === group.receipts.length - 1} />
                    ))}
                  </View>
                </View>
              ))
            )}

            <Txt weight="bold" size={20} style={styles.section}>
              Receiving privately
            </Txt>
            <ReceivingCard />
          </>
        )}
      </ScrollView>

      <Sheet visible={menu} onClose={() => setMenu(false)}>
        <MenuRow
          icon="info"
          label="How private works"
          detail="What’s public, and what only you can see"
          onPress={() => {
            setMenu(false)
            setHow(true)
          }}
        />
        <MenuRow
          icon="receive"
          label="Move to main wallet"
          detail={
            canMakePublic
              ? `${formatUsd(p.waiting)} out of private, into your main wallet`
              : 'Nothing private to move right now'
          }
          disabled={!canMakePublic}
          onPress={() => {
            setMenu(false)
            setConfirming(true)
          }}
        />
      </Sheet>

      <Sheet visible={confirming} onClose={() => setConfirming(false)}>
        <Txt weight="bold" size={24} style={{ letterSpacing: -0.6, marginTop: 8 }}>
          Move {formatUsd(p.waiting)} to your main wallet?
        </Txt>
        <Txt size={15} color={colors.onTint} style={{ marginTop: 8, lineHeight: 22 }}>
          Once they’re in your main wallet, anyone can see these dollars reached you. They’re yours
          either way, and Kova covers the fee.
        </Txt>
        <View style={{ marginTop: 18, gap: 12 }}>
          <PillButton
            label={`Move ${formatUsd(p.waiting)}`}
            icon="receive"
            onPress={() => {
              setConfirming(false)
              void p.moveIn()
            }}
          />
          <View style={{ alignItems: 'center' }}>
            <TextLink label="Keep them private" onPress={() => setConfirming(false)} />
          </View>
        </View>
      </Sheet>
    </Screen>
  )
}

/** A sheet from the bottom, over a dimmed screen. */
function Sheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean
  onClose: () => void
  children: ReactNode
}) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 4 }]}>
        <View style={styles.grip} />
        {children}
      </View>
    </Modal>
  )
}

function MenuRow({
  icon,
  label,
  detail,
  onPress,
  disabled,
}: {
  icon: IconName
  label: string
  detail: string
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${detail}`}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={() => {
        void Haptics.selectionAsync()
        onPress()
      }}
      style={({ pressed }) => [
        styles.menuRow,
        disabled && { opacity: 0.45 },
        pressed && { opacity: 0.6 },
      ]}
    >
      <View style={styles.menuIcon}>
        <Icon name={icon} size={19} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt weight="semi" size={16}>
          {label}
        </Txt>
        <Txt size={13} color={colors.muted}>
          {detail}
        </Txt>
      </View>
      <Icon name="arrow" size={18} color={colors.muted} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  section: { marginTop: 28, marginBottom: 12, letterSpacing: -0.4 },
  sectionRow: {
    marginTop: 28,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  howLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 16,
    paddingVertical: 4,
  },
  explain: {
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    padding: 14,
    marginTop: 10,
  },
  none: {
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.line,
    borderStyle: 'dashed',
    padding: 16,
  },
  day: { marginBottom: 8, marginLeft: 4 },
  list: {
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  backdrop: { flex: 1, backgroundColor: pair('rgba(11,26,29,0.32)', 'rgba(0,0,0,0.6)') },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 6,
  },
  grip: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.rule,
    marginBottom: 8,
  },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  menuIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
