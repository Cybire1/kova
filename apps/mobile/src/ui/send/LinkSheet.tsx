import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, Share, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native'
import Animated, { FadeIn, FadeInLeft, FadeInRight } from 'react-native-reanimated'
import type { Hex } from 'viem'
import type { PaymentLink } from '@/lib/chain'
import { applyKey, formatUsd, groupTyped, toBase } from '@/lib/money'
import { linkUrl, plainUsd, shareMessage } from '@/lib/paylinks'
import { colors, fonts } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Icon, type IconName } from '../Icon'
import { Keypad } from '../Keypad'
import { Envelope } from '../LinkParts'
import { Burst } from '../motion'
import { PillButton, TextLink, Txt } from '../primitives'
import { SlideToSend } from './SlideToSend'

type Step = 'amount' | 'review' | 'made'
const order: Step[] = ['amount', 'review', 'made']
const SIDE = 20

/**
 * Send as a link: an amount, a note if you like, then a link to share any way you like. The
 * dollars wait in the link until someone opens it and claims them, or until you take them back.
 * Same sheet as Send, same slide to confirm.
 */
/** Development only: dev-link links already made this run. */
const autoMade = new Set<string>()

export function LinkSheet({ start }: { start?: { amount?: string; note?: string; autoSend?: boolean } } = {}) {
  const { profile, balance, makeLink } = useWallet()
  const { width } = useWindowDimensions()
  const [step, setStep] = useState<Step>(start?.amount ? 'review' : 'amount')
  const [back, setBack] = useState(false)
  const [typed, setTyped] = useState(start?.amount ?? '')
  const [note, setNote] = useState(start?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [made, setMade] = useState<{ link: PaymentLink; key: Hex } | null>(null)
  const [copied, setCopied] = useState(false)

  const dollars = typed === '' ? 0 : Number(typed)
  const amount = dollars > 0 ? toBase(dollars.toFixed(2)) : 0n
  const over = balance !== null && amount > balance

  const moveTo = (next: Step) => {
    setBack(order.indexOf(next) < order.indexOf(step))
    setStep(next)
  }
  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))

  const url = made ? linkUrl(made.link.id, made.key) : ''
  const message = made && profile ? shareMessage(profile.name, amount, url, made.link.note) : ''

  const go = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const done = await makeLink(amount, note.trim() || undefined)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setMade({ link: done.link, key: done.key })
      // Development only: the full link, for scripted captures that open it in a browser.
      if (__DEV__) console.log('[dev] link', linkUrl(done.link.id, done.key))
      setBusy(false)
      moveTo('made')
    } catch (error) {
      const text = error instanceof Error ? error.message : 'The link wasn’t made.'
      setBusy(false)
      if (!/cancel/i.test(text)) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
        setProblem(text)
      }
    }
  }

  useEffect(() => {
    if (!__DEV__ || !start?.autoSend || !start.amount) return
    const once = `${start.amount}:${start.note ?? ''}`
    const timer = setTimeout(() => {
      if (autoMade.has(once)) return
      autoMade.add(once)
      void go()
    }, 2500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const share = () => void Share.share({ message })
  const copy = async () => {
    await Clipboard.setStringAsync(url)
    void Haptics.selectionAsync()
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const enter = back ? FadeInLeft.duration(240) : FadeInRight.duration(260)
  const pad = { paddingHorizontal: SIDE, paddingBottom: 12 }

  return (
    <View style={{ backgroundColor: colors.paper }}>
      {step === 'amount' ? (
        <Animated.View key="amount" entering={enter} style={pad}>
          <View style={styles.top}>
            <Round icon="back" label="Back" onPress={() => router.replace('/send')} />
            <View style={{ flex: 1 }}>
              <Txt weight="semi" size={17}>
                Send as a link
              </Txt>
              <Txt size={13} color={colors.muted}>
                For anyone, even without Kova
              </Txt>
            </View>
            <Pressable accessibilityRole="button" onPress={() => router.replace('/links')} hitSlop={8} style={styles.mine}>
              <Txt weight="semi" size={13}>
                Your links
              </Txt>
            </Pressable>
          </View>

          <View style={styles.entry}>
            <Txt weight="semi" size={64} style={[styles.big, typed === '' && { color: '#B4B9B8' }]} numberOfLines={1} adjustsFontSizeToFit>
              ${groupTyped(typed)}
            </Txt>
            {balance !== null ? (
              <View style={[styles.pill, over && { backgroundColor: colors.coralSoft }]}>
                <Txt weight="medium" size={14} color={over ? colors.danger : colors.onTint}>
                  {over ? `You have ${formatUsd(balance)}` : `${formatUsd(balance)} available`}
                </Txt>
              </View>
            ) : null}
            <View style={styles.note}>
              <Icon name="pen" size={15} color={colors.muted} />
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Add a note"
                placeholderTextColor="#8C9799"
                maxLength={140}
                accessibilityLabel="A note, shown to whoever opens the link"
                style={styles.noteInput}
              />
            </View>
          </View>
          <Keypad onKey={(key) => setTyped((v) => applyKey(v, key))} size={56} />
          <View style={{ marginTop: 14 }}>
            <PillButton label={over ? 'More than you have' : 'Review'} disabled={amount === 0n || over} onPress={() => moveTo('review')} />
          </View>
        </Animated.View>
      ) : null}

      {step === 'review' ? (
        <Animated.View key="review" entering={enter} style={pad}>
          <View style={styles.top}>
            <Round icon="back" label="Change the amount" onPress={() => moveTo('amount')} disabled={busy} />
            <Txt weight="semi" size={17} style={{ flex: 1 }}>
              {busy ? 'Putting it in the link' : 'Check and make the link'}
            </Txt>
          </View>

          <View style={{ alignItems: 'center', marginTop: 10 }}>
            <Envelope width={Math.min(250, width - 120)} amount={formatUsd(amount)} caption="For anyone with the link" open={!busy} delay={120} />
          </View>

          <View style={styles.facts}>
            <Fact label="Who can claim it" value="Whoever you send it to" />
            <Fact label="Not claimed?" value="Take it back any time" />
            <Fact label="Fee" value="$0.00, Kova covers it" />
            {note.trim() ? <Fact label="Note" value={note.trim()} icon="pen" hint="They see it when they open the link" /> : null}
          </View>

          <View style={styles.cash}>
            <Icon name="info" size={16} color={colors.onTint} />
            <Txt size={13} color={colors.onTint} style={{ flex: 1, lineHeight: 18 }}>
              Like cash in an envelope: whoever has the link can claim it. Send it only to them.
            </Txt>
          </View>

          {problem ? (
            <Animated.View entering={FadeIn} style={styles.problem}>
              <Icon name="info" size={18} color={colors.danger} />
              <Txt weight="medium" size={14} color={colors.danger} style={{ flex: 1 }}>
                {problem}
              </Txt>
            </Animated.View>
          ) : null}

          <SlideToSend
            label={problem ? 'Slide to try again' : `Slide to make a ${plainUsd(amount)} link`}
            busy={busy}
            disabled={over || amount === 0n}
            onSend={go}
          />
          <Txt size={12} color={colors.muted} style={{ textAlign: 'center', marginTop: 10 }}>
            Face ID confirms it. The dollars leave your balance now.
          </Txt>
        </Animated.View>
      ) : null}

      {step === 'made' && made ? (
        <Animated.View key="made" entering={FadeIn.duration(320)} style={[pad, { alignItems: 'center', paddingTop: 26 }]}>
          <Envelope width={Math.min(230, width - 140)} amount={formatUsd(amount)} caption="Ready to share" open delay={200} />
          <Burst
            spots={[
              { x: width / 2 - 140, y: 40, size: 24, fill: colors.yellow, delay: 100 },
              { x: width / 2 + 120, y: 24, size: 30, fill: colors.tealSoft, delay: 240 },
              { x: width / 2 + 110, y: 150, size: 18, fill: colors.yellow, delay: 380 },
              { x: width / 2 - 120, y: 160, size: 20, fill: colors.tealSoft, delay: 520 },
            ]}
          />
          <Txt weight="bold" size={36} style={[styles.big, { marginTop: 14, letterSpacing: -1.2 }]}>
            Your link is ready
          </Txt>
          <Txt size={15} color={colors.onTint} style={{ textAlign: 'center', marginTop: 4, lineHeight: 21, paddingHorizontal: 8 }}>
            {plainUsd(amount)} waits in it until someone claims it. Not claimed? Take it back from Your links.
          </Txt>

          <View style={styles.preview}>
            <Txt size={14} color={colors.ink} numberOfLines={3} style={{ lineHeight: 20 }}>
              {message}
            </Txt>
          </View>

          <View style={{ alignSelf: 'stretch', marginTop: 14, gap: 10 }}>
            <PillButton label="Share the link" icon="share" onPress={share} />
            <View style={styles.row}>
              <Pressable accessibilityRole="button" onPress={copy} style={({ pressed }) => [styles.option, pressed && { transform: [{ scale: 0.97 }] }]}>
                <Icon name={copied ? 'check' : 'copy'} size={18} />
                <Txt weight="semi" size={15}>
                  {copied ? 'Copied' : 'Copy link'}
                </Txt>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.replace('/links')}
                style={({ pressed }) => [styles.option, pressed && { transform: [{ scale: 0.97 }] }]}
              >
                <Icon name="list" size={18} />
                <Txt weight="semi" size={15}>
                  Your links
                </Txt>
              </Pressable>
            </View>
            <View style={{ alignItems: 'center', marginTop: 4 }}>
              <TextLink label="Done" onPress={close} />
            </View>
          </View>
        </Animated.View>
      ) : null}
    </View>
  )
}

function Fact({ label, value, hint, icon }: { label: string; value: string; hint?: string; icon?: IconName }) {
  return (
    <View style={styles.fact}>
      <Txt size={15} color={colors.muted}>
        {label}
      </Txt>
      <View style={{ flexShrink: 1, alignItems: 'flex-end' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {icon ? <Icon name={icon} size={15} /> : null}
          <Txt weight="semi" size={15} numberOfLines={1} style={{ flexShrink: 1 }}>
            {value}
          </Txt>
        </View>
        {hint ? (
          <Txt size={12} color={colors.muted}>
            {hint}
          </Txt>
        ) : null}
      </View>
    </View>
  )
}

function Round({ icon, label, onPress, disabled }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      disabled={disabled}
      onPress={() => {
        void Haptics.selectionAsync()
        onPress()
      }}
      style={({ pressed }) => [styles.round, disabled && { opacity: 0.35 }, pressed && { transform: [{ scale: 0.92 }] }]}
    >
      <Icon name={icon} size={20} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 24 },
  round: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  mine: { height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: colors.sunken, justifyContent: 'center' },
  entry: { alignItems: 'center', paddingTop: 18, paddingBottom: 14 },
  big: { letterSpacing: -2 },
  pill: { height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: colors.sunken, justifyContent: 'center', marginTop: 2 },
  note: {
    marginTop: 14,
    width: 260,
    height: 42,
    borderRadius: 21,
    paddingLeft: 14,
    paddingRight: 16,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  noteInput: { flex: 1, height: '100%', fontFamily: fonts.medium, fontSize: 15, color: colors.ink },
  facts: { marginTop: 14, borderRadius: 22, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.surface, paddingHorizontal: 16, paddingVertical: 6 },
  fact: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 9 },
  cash: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, marginBottom: 14, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, backgroundColor: colors.tealSoft },
  problem: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, padding: 12, borderRadius: 16, backgroundColor: colors.coralSoft },
  preview: { alignSelf: 'stretch', marginTop: 16, padding: 14, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.ink, borderStyle: 'dashed' },
  row: { flexDirection: 'row', gap: 10 },
  option: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    borderWidth: 2,
    borderColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
})
