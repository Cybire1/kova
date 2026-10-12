import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native'
import Animated, { FadeInLeft, FadeInRight, FadeIn } from 'react-native-reanimated'
import { type Address, getAddress, isAddressEqual } from 'viem'
import { parseScanned } from '@/lib/links'
import { applyKey, currencyInfo, type DisplayCurrency, displayCurrencies, formatLocal, formatUsd, groupTyped, toBase } from '@/lib/money'
import { usePrivate } from '@/lib/private'
import { fetchReceivingKey, UntrustedKey } from '@/lib/private-core'
import { rateLabel } from '@/lib/rates'
import { load, save } from '@/lib/storage'
import { colors, fonts } from '@/lib/theme'
import { type Contact, type Entry, isUnnamed, useWallet } from '@/lib/wallet'
import { Avatar, Flyer } from '../art'
import { Icon, type IconName } from '../Icon'
import { Keypad } from '../Keypad'
import { EnvelopeBadge } from '../LinkParts'
import { Bob, Burst } from '../motion'
import { NameSheet } from '../NameSheet'
import { PillButton, TextLink, Txt } from '../primitives'
import { MoveInOffer, SendPrivately, SentPrivately } from '../Private'
import { Stage as KoviStage } from '../Stage'
import { ArcRoute, type Leg } from './ArcRoute'
import { SlideToSend } from './SlideToSend'

/** Development only: dev-link sends already made this run. */
const autoSent = new Set<string>()

/** Whether the last send was private: the switch starts there next time, for anyone who can receive privately. */
const PRIVATELY = 'kova.send.privately.v1'

/** Whether they can receive privately: their published key, checked against their signature. */
type Reach = 'checking' | 'yes' | 'no' | 'untrusted'

type Step = 'who' | 'amount' | 'review' | 'sent'
const order: Step[] = ['who', 'amount', 'review', 'sent']

export type Payee = {
  address: Address
  name?: string
  currency?: string
  amount?: string
  note?: string
  rename?: boolean
  /** Development only: slide to send by itself, so every state can be screenshotted on a simulator. */
  autoSend?: boolean
  /** Development only: start with Send privately on. */
  privately?: boolean
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const DAY = 86_400_000
const SIDE = 20

/**
 * Sending, in one sheet over Home: who, how much, a look at the route, slide to send, and the
 * same sheet becomes the receipt. The sheet is sized to each step, so it grows for the keypad and
 * settles low once the money has landed, showing your balance behind it as it drops.
 */
export function SendSheet({ payee }: { payee?: Payee }) {
  const { profile, balance, send, contacts, noteReaches } = useWallet()
  const dollars = usePrivate()
  const { width } = useWindowDimensions()
  const inner = width - SIDE * 2

  const [step, setStep] = useState<Step>(payee ? (payee.amount ? 'review' : 'amount') : 'who')
  const [back, setBack] = useState(false)
  const [to, setTo] = useState<Payee | null>(payee ?? null)
  const [typed, setTyped] = useState(payee?.amount ?? '')
  const [note, setNote] = useState(payee?.note ?? '')
  const [leg, setLeg] = useState<Leg>('waiting')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [entry, setEntry] = useState<Entry | null>(null)
  const [naming, setNaming] = useState(!!payee?.rename)
  /** Whether they can read a private note: null while asking Kova for their note key. */
  const [reaches, setReaches] = useState<boolean | null>(null)
  const [reach, setReach] = useState<Reach>('checking')
  const [privately, setPrivately] = useState(Boolean(payee?.privately))

  const moveTo = (next: Step) => {
    setBack(order.indexOf(next) < order.indexOf(step))
    setStep(next)
  }

  const saved = to ? contacts.find((c) => isAddressEqual(c.address, to.address))?.name : undefined
  const name = to ? (saved && !isUnnamed(saved) ? saved : to.name) || short(to.address) : ''
  const first = name.split(' ')[0]
  const theirs = to && (displayCurrencies as readonly string[]).includes(to.currency ?? '') ? (to.currency as DisplayCurrency) : null
  const local = theirs && theirs !== 'USD' ? theirs : null
  const typedDollars = typed === '' ? 0 : Number(typed)
  const amount = typedDollars > 0 ? toBase(typedDollars.toFixed(2)) : 0n
  const over = balance !== null && amount > balance
  // Short, but private dollars would cover it: they can be moved in first, in one tap.
  const shortBy = over && balance !== null ? amount - balance : 0n
  const covered = shortBy > 0n && dollars.waiting >= shortBy
  const sendPrivately = privately && reach === 'yes'
  // With Send privately on, wait for their key's check: a private send never quietly goes out in the open.
  const checking = privately && reach === 'checking'

  const pick = (p: Payee) => {
    void Haptics.selectionAsync()
    setTo(p)
    if (p.amount) setTyped(p.amount)
    if (p.note) setNote(p.note)
    moveTo(p.amount ? 'review' : 'amount')
  }

  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))

  const go = async () => {
    if (!to) return
    setBusy(true)
    setProblem(null)
    setLeg('flying')
    const started = Date.now()
    try {
      const done = await send({ address: to.address, name, currency: theirs ?? undefined }, amount, note.trim() || undefined, { privately: sendPrivately })
      // Let Kovi finish the leg he is on: the flight is timed to about what the chain takes.
      await new Promise((r) => setTimeout(r, Math.max(0, 1360 - (Date.now() - started))))
      setLeg('landed')
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      await new Promise((r) => setTimeout(r, 620))
      setEntry(done)
      setBusy(false)
      moveTo('sent')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The money did not move.'
      setLeg('waiting')
      setBusy(false)
      if (!/cancel/i.test(message)) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
        setProblem(message)
      }
    }
  }

  const address = to?.address
  useEffect(() => {
    if (!address) return
    let live = true
    setReaches(null)
    setReach('checking')
    void noteReaches(address).then((yes) => live && setReaches(yes))
    // Only someone who has published a private key, signed by their own wallet, is offered a private send.
    void fetchReceivingKey(address)
      .then((meta) => live && setReach(meta ? 'yes' : 'no'))
      .catch((error) => live && setReach(error instanceof UntrustedKey ? 'untrusted' : 'no'))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address])

  // The switch starts where it was left last time.
  useEffect(() => {
    if (payee?.privately) return
    let live = true
    void load<boolean>(PRIVATELY, false).then((on) => live && setPrivately(on))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const choosePrivately = (on: boolean) => {
    setPrivately(on)
    void save(PRIVATELY, on)
  }

  // The send as of the latest render: whether they can receive privately is only known a moment in.
  const latestGo = useRef(go)
  latestGo.current = go
  useEffect(() => {
    if (!__DEV__ || !payee?.autoSend || step !== 'review') return
    // Once per app run, however many times the dev link mounts this sheet.
    const once = `${payee.address}:${payee.amount ?? ''}:${payee.note ?? ''}`
    if (autoSent.has(once)) return
    const timer = setTimeout(() => {
      if (autoSent.has(once)) return
      autoSent.add(once)
      void latestGo.current()
    }, 2500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const enter = back ? FadeInLeft.duration(240) : FadeInRight.duration(260)
  const pad = { paddingHorizontal: SIDE, paddingBottom: 12 }

  return (
    <View style={styles.sheet}>
      {step === 'who' ? (
        <Animated.View key="who" entering={enter} style={pad}>
          <Who onPick={pick} />
        </Animated.View>
      ) : null}

      {step === 'amount' && to ? (
        <Animated.View key="amount" entering={enter} style={pad}>
          <View style={styles.top}>
            {payee ? null : <Round icon="back" label="Back" onPress={() => moveTo('who')} />}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isUnnamed(name) ? 'Add a name' : `Rename ${name}`}
              onPress={() => setNaming(true)}
              style={styles.whoRow}
            >
              <View>
                <Avatar name={name} id={to.address} size={44} />
                <View style={styles.pen}>
                  <Icon name={isUnnamed(name) ? 'plus' : 'pen'} size={10} color={colors.white} />
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Txt weight="semi" size={17} numberOfLines={1}>
                  To {isUnnamed(name) ? short(to.address) : name}
                </Txt>
                <Txt size={13} color={colors.muted} numberOfLines={1}>
                  {isUnnamed(name) ? 'Tap their face to add a name' : short(to.address)}
                </Txt>
              </View>
            </Pressable>
          </View>

          <View style={styles.entry}>
            <Txt weight="semi" size={64} style={[styles.big, typed === '' && { color: '#B4B9B8' }]} numberOfLines={1} adjustsFontSizeToFit>
              ${groupTyped(typed)}
            </Txt>
            <View style={styles.subRow}>
              {local && typedDollars > 0 ? (
                <View style={[styles.pill, { backgroundColor: colors.tealSoft }]}>
                  <Txt weight="semi" size={14}>
                    {first} sees ≈ {formatLocal(typedDollars, local)}
                  </Txt>
                </View>
              ) : null}
              {balance !== null ? (
                <View style={[styles.pill, over && { backgroundColor: colors.coralSoft }]}>
                  <Txt weight="medium" size={14} color={over ? colors.danger : colors.onTint}>
                    {over ? `You have ${formatUsd(balance)}` : `${formatUsd(balance)} available`}
                  </Txt>
                </View>
              ) : null}
            </View>
            <View style={styles.note}>
              <Icon name="lock" size={15} color={colors.muted} />
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Private note"
                placeholderTextColor="#8C9799"
                maxLength={60}
                accessibilityLabel="Private note, only you and them can read it"
                style={styles.noteInput}
              />
            </View>
          </View>
          <Keypad onKey={(key) => setTyped((v) => applyKey(v, key))} size={56} />
          <View style={{ marginTop: 14 }}>
            {covered ? (
              <MoveInOffer short={shortBy} compact />
            ) : (
              <PillButton label={over ? 'More than you have' : 'Review'} disabled={amount === 0n || over} onPress={() => moveTo('review')} />
            )}
          </View>
          <NameSheet person={naming ? { address: to.address, name } : null} onClose={() => setNaming(false)} />
        </Animated.View>
      ) : null}

      {step === 'review' && to && profile ? (
        <Animated.View key="review" entering={enter} style={pad}>
          <View style={styles.top}>
            <Round icon="back" label="Change the amount" onPress={() => moveTo('amount')} disabled={busy} />
            <Txt weight="semi" size={17} style={{ flex: 1 }}>
              {busy ? `Sending to ${first}` : 'Check and send'}
            </Txt>
          </View>

          <View style={{ marginTop: 18 }}>
            <ArcRoute width={inner} you={{ name: profile.name, id: profile.address }} them={{ name, id: to.address }} leg={leg} privately={sendPrivately} />
          </View>

          <View style={styles.sums}>
            <Txt weight="bold" size={48} style={styles.big} numberOfLines={1} adjustsFontSizeToFit>
              {formatUsd(amount)}
            </Txt>
            <Txt size={15} color={colors.onTint}>
              {local ? `${first} gets ${formatUsd(amount)}, about ${formatLocal(typedDollars, local)}` : isUnnamed(name) ? 'They get all of it' : `${first} gets all of it`}
            </Txt>
          </View>

          <View style={styles.facts}>
            <Fact label="Fee" value="$0.00, Kova covers it" />
            <Fact label="Arrives" value="In about a second" icon="bolt" />
            {local ? (
              <Fact
                label="Rate"
                value={`1 USD ≈ ${currencyInfo[local].perUsd.toLocaleString('en-US', { maximumFractionDigits: currencyInfo[local].decimals === 0 ? 0 : 4 })} ${local}`}
                hint={rateLabel()}
              />
            ) : null}
            {note.trim() ? (
              <Fact
                label="Note"
                value={note.trim()}
                icon="lock"
                hint={reaches === null ? 'Sealing…' : reaches ? `Sealed: only you and ${first} can read it` : `Sealed for you; ${first} can’t get private notes yet`}
              />
            ) : null}
          </View>

          {reach === 'yes' ? (
            <View style={{ marginBottom: 14 }}>
              <SendPrivately on={privately} onChange={choosePrivately} amount={amount} first={isUnnamed(name) ? 'they' : first} disabled={busy} />
            </View>
          ) : reach === 'untrusted' ? (
            <View style={styles.untrusted}>
              <Icon name="info" size={16} color={colors.muted} />
              <Txt size={13} color={colors.muted} style={{ flex: 1, lineHeight: 18 }}>
                Kova gave a private key for {isUnnamed(name) ? 'them' : first} that they didn’t sign, so this send can’t be private.
              </Txt>
            </View>
          ) : reach === 'no' && privately ? (
            // You send privately by habit, but they can't receive that way yet: say so, rather than send in the open quietly.
            <View style={styles.untrusted}>
              <Icon name="lock" size={16} color={colors.muted} />
              <Txt size={13} color={colors.muted} style={{ flex: 1, lineHeight: 18 }}>
                {isUnnamed(name) ? 'They' : first} can’t receive privately yet, so Monad will show who gets this one.
              </Txt>
            </View>
          ) : null}

          {problem ? (
            <Animated.View entering={FadeIn} style={styles.problem}>
              <Icon name="info" size={18} color={colors.danger} />
              <Txt weight="medium" size={14} color={colors.danger} style={{ flex: 1 }}>
                {problem}
                {/went through/i.test(problem) ? '' : ' Your money hasn’t moved.'}
              </Txt>
            </Animated.View>
          ) : null}
          {covered ? (
            <View style={{ marginBottom: 12 }}>
              <MoveInOffer short={shortBy} />
            </View>
          ) : over ? (
            <Txt weight="medium" size={14} color={colors.danger} style={{ textAlign: 'center', marginBottom: 10 }}>
              You have {formatUsd(balance ?? 0n)}. Add money or send less.
            </Txt>
          ) : null}

          <SlideToSend
            label={problem ? 'Slide to try again' : `Slide to send ${formatUsd(amount)}${sendPrivately ? ' privately' : ''}`}
            busy={busy}
            disabled={over || amount === 0n || checking}
            onSend={go}
          />
          <Txt size={12} color={colors.muted} style={{ textAlign: 'center', marginTop: 10 }}>
            Face ID confirms it. Payments on Monad can’t be undone.
          </Txt>
        </Animated.View>
      ) : null}

      {step === 'sent' && to && entry ? (
        <Animated.View key="sent" entering={FadeIn.duration(320)} style={[pad, { alignItems: 'center', paddingTop: 22 }]}>
          <KoviStage pose="cheer" size={150} />
          <Burst
            spots={[
              { x: width / 2 - 110, y: 50, size: 24, fill: colors.yellow, delay: 0 },
              { x: width / 2 + 105, y: 34, size: 30, fill: colors.tealSoft, delay: 140 },
              { x: width / 2 + 84, y: 150, size: 18, fill: colors.yellow, delay: 280 },
              { x: width / 2 - 90, y: 160, size: 20, fill: colors.tealSoft, delay: 420 },
            ]}
          />
          <Txt weight="bold" size={44} style={[styles.big, { marginTop: 10 }]}>
            Sent
          </Txt>
          <Txt weight="medium" size={18} style={{ textAlign: 'center', marginTop: 2 }}>
            {formatUsd(amount)} landed with {first}
            {local ? `, about ${formatLocal(typedDollars, local)}` : ''}
          </Txt>
          <View style={styles.time}>
            <Icon name="bolt" size={16} color={colors.white} />
            <Txt weight="semi" size={14} color={colors.white}>
              {entry.ms ? `Arrived in ${(entry.ms / 1000).toFixed(2)} s on Monad` : 'Arrived on Monad'}
            </Txt>
          </View>
          {entry.privately && entry.oneTime ? (
            <View style={{ alignSelf: 'stretch', marginTop: 18 }}>
              <SentPrivately amount={amount} oneTime={entry.oneTime} first={isUnnamed(name) ? 'they' : first} txHash={entry.txHash} />
            </View>
          ) : null}
          <View style={{ alignSelf: 'stretch', marginTop: entry.privately ? 16 : 22, gap: 12 }}>
            <PillButton label="Done" icon="check" onPress={close} />
            <View style={{ alignItems: 'center' }}>
              <TextLink
                label="See receipt"
                onPress={() => {
                  close()
                  router.push({ pathname: '/receipt/[id]', params: { id: entry.id } })
                }}
              />
            </View>
          </View>
        </Animated.View>
      ) : null}
    </View>
  )
}

/** Who to send to: one field for a name, an address or a link; your recent people one tap away. */
function Who({ onPick }: { onPick: (p: Payee) => void }) {
  const { contacts, activity } = useWallet()
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [naming, setNaming] = useState<Contact | null>(null)

  const people = useMemo(() => {
    const lastWith = (a: Address) => activity.find((e) => e.address && isAddressEqual(e.address, a))
    return contacts.map((c) => ({ ...c, last: lastWith(c.address) })).sort((x, y) => (y.last?.at ?? 0) - (x.last?.at ?? 0))
  }, [contacts, activity])

  const query = text.trim().toLowerCase()
  const shown = query ? people.filter((p) => p.name.toLowerCase().includes(query) || p.address.toLowerCase().includes(query)) : people
  const direct = query ? parseScanned(text) : null

  const go = (value: string) => {
    const scanned = parseScanned(value)
    if (!scanned) return setProblem('That isn’t a Kova link or a wallet address.')
    if (scanned.kind === 'charge') return router.replace({ pathname: '/pay/[id]', params: { id: scanned.id } })
    if (scanned.kind === 'pair') return router.replace({ pathname: '/terminal/setup', params: { code: scanned.code } })
    if (scanned.kind === 'claim') return router.replace({ pathname: '/c/[id]', params: { id: scanned.id, ...(scanned.key ? { key: scanned.key } : {}) } })
    if (scanned.kind === 'stall') return router.replace({ pathname: '/s/[slug]', params: { slug: scanned.slug, ...(scanned.table ? { table: scanned.table } : {}) } })
    onPick({ address: getAddress(scanned.address), name: scanned.name, currency: scanned.currency, amount: scanned.amount, note: scanned.note })
  }

  const paste = async () => {
    const clip = (await Clipboard.getStringAsync()).trim()
    if (!clip) return setProblem('Nothing to paste. Ask them for their Kova link.')
    setText(clip)
    setProblem(parseScanned(clip) ? null : 'That isn’t a Kova link or a wallet address.')
  }

  return (
    <View style={{ paddingTop: 24 }}>
      <Txt weight="bold" size={30} style={{ letterSpacing: -0.8 }}>
        Send to
      </Txt>

      <View style={[styles.field, problem ? { borderColor: colors.danger } : null]}>
        <Icon name="send" size={18} color={colors.muted} />
        <TextInput
          value={text}
          onChangeText={(v) => {
            setText(v)
            setProblem(null)
          }}
          onSubmitEditing={() => go(text)}
          placeholder="Name, address or link"
          placeholderTextColor="#8C9799"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          style={styles.input}
        />
        {text ? (
          <FieldButton icon="close" label="Clear" onPress={() => setText('')} />
        ) : (
          <>
            <FieldButton icon="copy" label="Paste" onPress={paste} />
            <FieldButton icon="scan" label="Scan" onPress={() => router.push('/scan')} solid />
          </>
        )}
      </View>
      {problem ? (
        <Txt weight="medium" size={14} color={colors.danger} style={{ marginTop: 8, marginLeft: 6 }}>
          {problem}
        </Txt>
      ) : null}

      {direct && direct.kind === 'person' ? (
        <Pressable accessibilityRole="button" onPress={() => go(text)} style={({ pressed }) => [styles.direct, pressed && { transform: [{ scale: 0.98 }] }]}>
          <Avatar name={direct.name ?? direct.address} id={direct.address} size={48} />
          <View style={{ flex: 1 }}>
            <Txt weight="semi" size={16} color={colors.white}>
              Send to {direct.name || short(direct.address)}
            </Txt>
            <Txt size={13} color={colors.onInk}>
              {direct.amount ? `They asked for $${direct.amount}` : 'Monad address, ready to pay'}
            </Txt>
          </View>
          <View style={styles.directGo}>
            <Icon name="arrow" size={20} />
          </View>
        </Pressable>
      ) : null}

      {direct && direct.kind === 'claim' ? (
        <Pressable accessibilityRole="button" onPress={() => go(text)} style={({ pressed }) => [styles.direct, pressed && { transform: [{ scale: 0.98 }] }]}>
          <View style={styles.directBadge}>
            <EnvelopeBadge size={34} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt weight="semi" size={16} color={colors.white}>
              Open this link
            </Txt>
            <Txt size={13} color={colors.onInk}>
              Someone sent you dollars
            </Txt>
          </View>
          <View style={styles.directGo}>
            <Icon name="arrow" size={20} />
          </View>
        </Pressable>
      ) : null}

      {!query ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send as a link, for anyone, even without Kova"
          onPress={() => router.replace('/send/link')}
          style={({ pressed }) => [styles.asLink, pressed && { transform: [{ scale: 0.98 }] }]}
        >
          <EnvelopeBadge size={40} />
          <View style={{ flex: 1 }}>
            <Txt weight="semi" size={16}>
              Send as a link
            </Txt>
            <Txt size={13} color={colors.muted}>
              For anyone, even without Kova
            </Txt>
          </View>
          <Pressable accessibilityRole="button" hitSlop={6} onPress={() => router.replace('/links')} style={styles.yourLinks}>
            <Txt weight="semi" size={13}>
              Your links
            </Txt>
          </Pressable>
        </Pressable>
      ) : null}

      {people.length === 0 && !direct ? (
        <View style={styles.empty}>
          <Bob>
            <Flyer size={120} />
          </Bob>
          <Txt weight="semi" size={18}>
            Send your first payment
          </Txt>
          <Txt size={14} color={colors.muted} style={{ textAlign: 'center', marginTop: 4, lineHeight: 20 }}>
            Scan a friend’s Kova code or paste their link. They’ll be saved here for next time.
          </Txt>
        </View>
      ) : null}

      {!query && people.length > 3 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -SIDE, marginTop: 20 }} contentContainerStyle={{ paddingHorizontal: SIDE, gap: 12 }}>
          {people.slice(0, 8).map((p) => (
            <Pressable
              key={p.address}
              accessibilityRole="button"
              accessibilityLabel={`Send to ${p.name}`}
              accessibilityHint="Hold to rename"
              onPress={() => onPick({ address: p.address, name: p.name, currency: p.currency })}
              onLongPress={() => setNaming(p)}
              style={({ pressed }) => [styles.recent, pressed && { transform: [{ scale: 0.94 }] }]}
            >
              <Avatar name={p.name} id={p.address} size={60} />
              <Txt weight="semi" size={13} numberOfLines={1}>
                {isUnnamed(p.name) ? p.address.slice(0, 6) : p.name.split(' ')[0]}
              </Txt>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {shown.length > 0 ? (
        <>
          <Txt weight="semi" size={14} color={colors.muted} style={styles.section}>
            {query ? `Matches (${shown.length})` : 'Everyone'}
          </Txt>
          <View style={styles.list}>
            <ScrollView style={{ maxHeight: 64 * 4.5 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              {shown.map((p, i) => (
                <Pressable
                  key={p.address}
                  accessibilityRole="button"
                  accessibilityLabel={`Send to ${p.name}`}
                  accessibilityHint="Hold to rename"
                  onPress={() => onPick({ address: p.address, name: p.name, currency: p.currency })}
                  onLongPress={() => setNaming(p)}
                  style={({ pressed }) => [styles.row, i < shown.length - 1 && styles.rule, pressed && { backgroundColor: colors.sunken }]}
                >
                  <Avatar name={p.name} id={p.address} size={42} />
                  <View style={{ flex: 1 }}>
                    <Txt weight="semi" size={16} numberOfLines={1}>
                      {isUnnamed(p.name) ? short(p.address) : p.name}
                    </Txt>
                    <Txt size={13} color={colors.muted} numberOfLines={1}>
                      {story(p.last)}
                    </Txt>
                  </View>
                  <Icon name="arrow" size={18} color={colors.muted} />
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </>
      ) : query && !direct ? (
        <Txt size={15} color={colors.muted} style={{ marginTop: 16, marginLeft: 6 }}>
          No one matches “{text.trim()}”. Paste their Kova link or a full address.
        </Txt>
      ) : null}
      <NameSheet person={naming} onClose={() => setNaming(null)} />
    </View>
  )
}

function ago(at: number) {
  const days = Math.floor((Date.now() - at) / DAY)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(at).toLocaleDateString([], { day: 'numeric', month: 'short' })
}

/** One line about your history with someone: the latest money that moved between you. */
function story(last: Entry | undefined) {
  if (!last) return 'No payments yet'
  const amount = formatUsd(BigInt(last.amount))
  return last.kind === 'sent' || last.kind === 'paid' ? `You sent ${amount} · ${ago(last.at)}` : `Paid you ${amount} · ${ago(last.at)}`
}

function Fact({ label, value, hint, icon }: { label: string; value: string; hint?: string; icon?: IconName }) {
  return (
    <View style={styles.fact}>
      <Txt size={15} color={colors.muted}>
        {label}
      </Txt>
      <View style={{ flexShrink: 1, alignItems: 'flex-end' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {icon ? <Icon name={icon} size={15} color={icon === 'bolt' ? colors.coral : colors.ink} /> : null}
          <Txt weight="semi" size={15} numberOfLines={1}>
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

function FieldButton({ icon, label, onPress, solid }: { icon: IconName; label: string; onPress: () => void; solid?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.fieldButton, solid && { backgroundColor: colors.coral }, pressed && { transform: [{ scale: 0.94 }] }]}
    >
      <Icon name={icon} size={18} color={solid ? colors.white : colors.ink} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: colors.paper },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 24 },
  round: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  whoRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  pen: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.paper,
    backgroundColor: colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entry: { alignItems: 'center', paddingTop: 18, paddingBottom: 14 },
  big: { letterSpacing: -2 },
  subRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 2 },
  pill: { height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: colors.sunken, justifyContent: 'center' },
  note: {
    marginTop: 14,
    width: 240,
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
  sums: { alignItems: 'center', marginTop: 4 },
  facts: { marginTop: 18, marginBottom: 16, borderRadius: 22, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.surface, paddingHorizontal: 16, paddingVertical: 6 },
  fact: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 9 },
  problem: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, padding: 12, borderRadius: 16, backgroundColor: colors.coralSoft },
  untrusted: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 12, paddingHorizontal: 4 },
  time: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: colors.ink },
  field: {
    marginTop: 14,
    height: 50,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 18,
    paddingRight: 7,
    gap: 10,
  },
  input: { flex: 1, height: '100%', fontFamily: fonts.medium, fontSize: 16, color: colors.ink },
  fieldButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.sunken, alignItems: 'center', justifyContent: 'center' },
  direct: { marginTop: 12, borderRadius: 24, backgroundColor: colors.ink, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  directBadge: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  asLink: {
    marginTop: 12,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  yourLinks: { height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: colors.sunken, justifyContent: 'center' },
  directGo: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  section: { marginTop: 20, marginBottom: 8, marginLeft: 4 },
  recent: { width: 68, alignItems: 'center', gap: 6 },
  list: { borderRadius: 22, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.surface, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, height: 56 },
  rule: { borderBottomWidth: 1, borderColor: colors.sunken },
  empty: { alignItems: 'center', paddingTop: 18, paddingHorizontal: 12 },
})
