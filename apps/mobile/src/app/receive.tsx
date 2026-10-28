import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, Share, StyleSheet, View } from 'react-native'
import {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { isTestnet } from '@/lib/config'
import { personLink } from '@/lib/links'
import { useOffline } from '@/lib/offline'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import Animated from '@/ui/animated'
import { CodeCard } from '@/ui/CodeCard'
import { Icon } from '@/ui/Icon'
import { Header, PillButton, Screen, Txt } from '@/ui/primitives'

/**
 * Your code: anyone with Kova scans it to pay you. Someone paying from a crypto wallet or an
 * exchange opens the folded section under it for the address, in the exact words they need.
 */
export default function Receive() {
  const { profile } = useWallet()
  const { offline } = useOffline()
  const [open, setOpen] = useState(false)
  const scroll = useRef<ScrollView>(null)
  if (!profile) return null
  const link = personLink({
    address: profile.address,
    name: profile.name,
    currency: profile.currency,
  })

  return (
    <Screen bg={colors.tealLight}>
      <Header title="Get paid" backIcon="close" />
      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.body}
        // On a small phone the opened section lands below the fold: bring it into view.
        onContentSizeChange={() => {
          if (open) scroll.current?.scrollToEnd({ animated: true })
        }}
      >
        <Txt weight="semi" size={30} style={{ letterSpacing: -0.6, textAlign: 'center' }}>
          Scan to pay {profile.name.split(' ')[0]}
        </Txt>
        <Txt
          size={16}
          color={colors.onTint}
          style={{ textAlign: 'center', marginTop: 6, lineHeight: 22 }}
        >
          {offline
            ? 'No signal? They scan this, then you scan their payment code.'
            : 'Share this code or link to receive Kova payments.'}
        </Txt>
        <CodeCard value={link} />
        <FromOutside address={profile.address} open={open} onToggle={() => setOpen(!open)} />
      </ScrollView>
      <View style={styles.footer}>
        <PillButton
          label="Share my link"
          icon="share"
          onPress={() => void Share.share({ message: `Pay me on Kova: ${link}` })}
        />
      </View>
    </Screen>
  )
}

/**
 * Folded by default: the wallet's address for someone sending from outside Kova, with the token
 * and network named exactly, since sending the wrong one loses the money. Then the way in for
 * MON and other crypto, on mainnet.
 */
function FromOutside({
  address,
  open,
  onToggle,
}: {
  address: string
  open: boolean
  onToggle: () => void
}) {
  const [copied, setCopied] = useState(false)
  const turn = useSharedValue(0)
  useEffect(() => {
    turn.value = withTiming(open ? 1 : 0, {
      duration: 240,
      easing: Easing.bezier(0.32, 0.72, 0, 1),
    })
  }, [open, turn])
  const chevron = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.value * 180}deg` }],
  }))

  return (
    <View style={styles.outside}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          void Haptics.selectionAsync()
          onToggle()
        }}
        style={({ pressed }) => [styles.outsideHead, pressed && styles.pressed]}
      >
        <Txt weight="semi" size={15} style={{ flex: 1 }}>
          Paying from a crypto wallet or exchange?
        </Txt>
        <Animated.View style={chevron}>
          <Icon name="chevronDown" size={18} strokeWidth={2.4} />
        </Animated.View>
      </Pressable>
      {open ? (
        <Animated.View entering={FadeIn.duration(220)}>
          <View style={styles.outsideBody}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy your AUSD address on Monad"
              onPress={async () => {
                await Clipboard.setStringAsync(address)
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
                setCopied(true)
                setTimeout(() => setCopied(false), 1600)
              }}
              style={({ pressed }) => [styles.address, pressed && { opacity: 0.7 }]}
            >
              <Txt weight="medium" size={14} numberOfLines={1} style={{ flex: 1 }}>
                {address.slice(0, 10)}…{address.slice(-8)}
              </Txt>
              <Icon name={copied ? 'check' : 'copy'} size={18} />
              <Txt weight="semi" size={14}>
                {copied ? 'Copied' : 'Copy'}
              </Txt>
            </Pressable>
            <Txt size={13} color={colors.onTint} style={{ marginTop: 10, lineHeight: 18 }}>
              Receive AUSD on Monad here. MON appears separately and needs conversion.
            </Txt>
          </View>
          {!isTestnet ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/from-chain')}
              style={({ pressed }) => [styles.deposit, pressed && styles.pressed]}
            >
              <View style={{ flex: 1 }}>
                <Txt weight="semi" size={15}>
                  Depositing MON or other crypto?
                </Txt>
                <Txt size={12} color={colors.onTint} style={{ marginTop: 5 }}>
                  Choose a token and network. We convert it to dollars for you.
                </Txt>
              </View>
              <Icon name="arrow" size={18} />
            </Pressable>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  body: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  outside: {
    alignSelf: 'stretch',
    marginTop: 22,
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: 20,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  outsideHead: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  outsideBody: { paddingHorizontal: 16, paddingBottom: 16 },
  address: {
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.sunken,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deposit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderTopWidth: 2,
    borderTopColor: colors.line,
  },
  pressed: { backgroundColor: colors.sunken },
  footer: { paddingHorizontal: 20, paddingBottom: 12, paddingTop: 8 },
})
