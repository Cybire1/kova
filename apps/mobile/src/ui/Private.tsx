import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { Pressable, StyleSheet, Switch, View } from 'react-native'
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated'
import { explorerTx } from '@/lib/chain'
import { formatUsd } from '@/lib/money'
import { usePrivate } from '@/lib/private'
import type { PrivateReceipt } from '@/lib/private-core'
import { type MoveProgress, shortAddress } from '@/lib/takings-core'
import { colors } from '@/lib/theme'
import { isUnnamed, useWallet } from '@/lib/wallet'
import { Avatar } from './art'
import { PrivateAvatar, when } from './EntryRow'
import { Icon } from './Icon'
import { PopIn } from './motion'
import { PillButton, Txt } from './primitives'
import { AddressChip, freshMove } from './Takings'

/**
 * Private dollars, drawn: payments people sent this wallet privately, each at a one-time address
 * only its keys can open, and the one tap that moves them into the balance. The card is ink, like
 * private takings: what's in it is yours alone. Each payment shows who sent it (Monad shows that)
 * beside the address it went to (which only you can tie to you).
 */

const progressLabel = (p: MoveProgress) =>
  p.step === 'unlocking'
    ? 'Opening your keys…'
    : p.step === 'checking'
      ? 'Checking each address…'
      : p.step === 'signing'
        ? `Signing ${p.done} of ${p.total}…`
        : p.total > 1
          ? `Moving ${Math.min(p.done + 1, p.total)} of ${p.total}…`
          : 'Moving it in…'

const waitingOf = (receipts: PrivateReceipt[]) => receipts.filter((r) => BigInt(r.held) > 0n)

/** Who sent it, as you know them: your name for them, or their short address. */
export function useSenderName() {
  const { contacts } = useWallet()
  return (from: string | null) => {
    if (!from) return 'Someone'
    const known = contacts.find((c) => c.address.toLowerCase() === from.toLowerCase())
    return known && !isUnnamed(known.name) ? known.name : shortAddress(from)
  }
}

/**
 * The private dollars at a glance: what waits at one-time addresses, and Move in. It tells every
 * state in place: keys not on this phone yet, nothing yet, moving (each address signs its own move),
 * and moved, with how long it took and the move on Monadscan.
 */
export function PrivateCard({ onOpen, plain }: { onOpen?: () => void; plain?: boolean }) {
  const p = usePrivate()
  const senderName = useSenderName()
  const waiting = waitingOf(p.receipts)
  const moved = freshMove(p.moved)
  const done = moved !== null && !p.progress && waiting.length === 0
  const lead = plain ? { marginTop: 0 } : null

  // The people behind what's waiting, newest first, each once.
  const senders: { key: string; label: string }[] = []
  for (const r of waiting) {
    const label = senderName(r.from)
    if (!senders.some((s) => s.label === label)) senders.push({ key: r.id, label })
  }

  return (
    <Animated.View layout={LinearTransition} style={styles.card}>
      {plain ? null : (
        <Pressable
          accessibilityRole={onOpen ? 'button' : undefined}
          accessibilityLabel={onOpen ? 'Private dollars. See every private payment' : undefined}
          disabled={!onOpen}
          onPress={onOpen}
          style={styles.cardHead}
        >
          <View style={styles.lockDisc}>
            <Icon name="lock" size={17} color={colors.white} strokeWidth={2.3} />
          </View>
          <Txt weight="semi" size={15} color={colors.white} style={{ flex: 1 }}>
            Private dollars
          </Txt>
          {onOpen ? <Icon name="arrow" size={18} color={colors.onInk} /> : null}
        </Pressable>
      )}

      {done && moved ? (
        <Animated.View entering={FadeIn.duration(260)}>
          <PopIn style={[styles.movedTag, lead]}>
            <Icon name="check" size={13} color={colors.ink} strokeWidth={2.6} />
            <Txt weight="semi" size={12}>
              {moved.count ? 'Moved in' : 'Nothing to move'}
            </Txt>
          </PopIn>
          {moved.count ? (
            <>
              <Txt
                weight="bold"
                size={44}
                color={colors.white}
                style={styles.amount}
                accessibilityLabel={`Moved ${formatUsd(moved.amount)} into your balance in ${(moved.ms / 1000).toFixed(1)} seconds`}
              >
                {formatUsd(moved.amount)}
              </Txt>
              <Txt size={15} color={colors.onInk}>
                into your balance in {(moved.ms / 1000).toFixed(1)} s, from {moved.count} {moved.count === 1 ? 'address' : 'addresses'}
              </Txt>
            </>
          ) : (
            <Txt size={15} color={colors.onInk} style={{ marginTop: 10, lineHeight: 21 }}>
              Those addresses were already empty: everything there had been moved in.
            </Txt>
          )}
          {moved.failed ? (
            <Txt weight="medium" size={13} color={colors.coralSoft} style={{ marginTop: 8 }}>
              {moved.failed} didn’t move: {moved.reason}
            </Txt>
          ) : null}
          <View style={styles.doneRow}>
            {moved.explorerUrl ? (
              <Pressable
                accessibilityRole="link"
                onPress={() => void WebBrowser.openBrowserAsync(moved.explorerUrl as string)}
                style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.7 }]}
              >
                <Icon name="web" size={16} color={colors.white} />
                <Txt weight="semi" size={14} color={colors.white}>
                  View on Monadscan
                </Txt>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" onPress={p.clearMoved} style={({ pressed }) => [styles.doneButton, pressed && { opacity: 0.8 }]}>
              <Txt weight="semi" size={14}>
                Done
              </Txt>
            </Pressable>
          </View>
        </Animated.View>
      ) : !p.keysHere ? (
        <View>
          <Txt weight="bold" size={24} color={colors.white} style={[{ marginTop: 14, letterSpacing: -0.6 }, lead]}>
            Receive privately
          </Txt>
          <Txt size={14} color={colors.onInk} style={{ marginTop: 4, lineHeight: 20 }}>
            Let people send you dollars without the whole of Monad seeing they’re yours. Your wallet makes your private keys with one
            signature, and they stay on this phone.
          </Txt>
          <View style={{ marginTop: 14 }}>
            <PillButton label={p.working ? 'Setting up…' : 'Set up'} icon="face" tone="white" loading={p.working} onPress={() => void p.setUp()} />
          </View>
        </View>
      ) : waiting.length || p.progress ? (
        <View>
          <Txt weight="bold" size={44} color={colors.white} style={[styles.amount, lead]} numberOfLines={1} adjustsFontSizeToFit>
            {formatUsd(p.waiting)}
          </Txt>
          <Txt size={15} color={colors.onInk}>
            waiting at {p.waitingCount} one-time {p.waitingCount === 1 ? 'address' : 'addresses'}, only yours to open
          </Txt>
          <View style={styles.chips}>
            {senders.slice(0, 2).map((s) => (
              <View key={s.key} style={styles.fromChip}>
                <Txt weight="semi" size={12} color={colors.onInk}>
                  From{' '}
                </Txt>
                <Txt weight="semi" size={12} color={colors.white} numberOfLines={1}>
                  {s.label}
                </Txt>
              </View>
            ))}
            {senders.length > 2 ? <AddressChip label={`+${senders.length - 2} more`} onInk /> : null}
          </View>
          {moved?.count ? (
            <Txt weight="medium" size={13} color={colors.tealLight} style={{ marginTop: 12 }}>
              Moved {formatUsd(moved.amount)} in {(moved.ms / 1000).toFixed(1)} s. {moved.failed ? `${moved.failed} didn’t: ${moved.reason}` : ''}
            </Txt>
          ) : moved?.failed && !p.progress ? (
            <View style={styles.problem}>
              <Icon name="info" size={16} color={colors.coralSoft} />
              <Txt weight="medium" size={13} color={colors.coralSoft} style={{ flex: 1, lineHeight: 18 }}>
                {moved.reason}
              </Txt>
            </View>
          ) : null}
          <View style={{ marginTop: 16 }}>
            <PillButton
              label={p.progress ? progressLabel(p.progress) : 'Move into my balance'}
              icon="receive"
              tone="white"
              loading={Boolean(p.progress)}
              onPress={() => void p.moveIn()}
            />
          </View>
          <Txt size={12} color={colors.onInk} style={styles.foot}>
            Kova pays the gas. Each address signs its own move.
          </Txt>
        </View>
      ) : (
        <View>
          <Txt weight="bold" size={44} color={colors.white} style={[styles.amount, lead]}>
            {formatUsd(0n)}
          </Txt>
          <Txt size={15} color={colors.onInk} style={{ lineHeight: 21 }}>
            {p.published === false
              ? 'Your keys are on this phone. Kova hasn’t got their public half yet; it tries again by itself.'
              : 'When someone sends you dollars privately, they wait here, at an address made for that payment alone.'}
          </Txt>
          <View style={styles.chips}>
            <AddressChip label="Next payment" onInk pending />
            <AddressChip label="The one after" onInk pending />
          </View>
        </View>
      )}

      {p.problem ? (
        <View style={styles.problem}>
          <Icon name="info" size={16} color={colors.coralSoft} />
          <Txt weight="medium" size={13} color={colors.coralSoft} style={{ flex: 1 }}>
            {p.problem.text}
          </Txt>
        </View>
      ) : null}
    </Animated.View>
  )
}

/** One private payment: who sent it, the address it alone went to, and whether it's in your balance yet. */
export function PrivateRow({ receipt, last }: { receipt: PrivateReceipt; last?: boolean }) {
  const { activity } = useWallet()
  const senderName = useSenderName()
  const name = senderName(receipt.from)
  const waiting = BigInt(receipt.held) > 0n
  const entry = activity.find((e) => e.kind === 'received' && e.txHash?.toLowerCase() === receipt.txHash.toLowerCase())
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${formatUsd(BigInt(receipt.amount))} from ${name}, privately, to ${shortAddress(receipt.stealthAddress)}. ${waiting ? 'Waiting to move in' : 'In your balance'}`}
      onPress={() =>
        entry ? router.push({ pathname: '/receipt/[id]', params: { id: entry.id } }) : void WebBrowser.openBrowserAsync(receipt.explorerUrl)
      }
      style={({ pressed }) => [styles.row, !last && styles.rowRule, pressed && { opacity: 0.65 }]}
    >
      <PrivateAvatar name={name} id={receipt.from ?? receipt.stealthAddress} size={40} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt weight="semi" size={16} numberOfLines={1}>
          {name}
        </Txt>
        <Txt size={13} color={colors.muted} numberOfLines={1}>
          {receipt.note ? `“${receipt.note}”` : `To ${shortAddress(receipt.stealthAddress)}`}, {when(receipt.at)}
        </Txt>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 3 }}>
        <Txt weight="semi" size={16} color={colors.positive}>
          {formatUsd(BigInt(receipt.amount), { sign: true })}
        </Txt>
        <Txt weight="semi" size={12} color={waiting ? colors.coralDeep : colors.muted}>
          {waiting ? 'Waiting' : 'Moved in'}
        </Txt>
      </View>
    </Pressable>
  )
}

/**
 * How it stays private: someone pays an address made for that payment alone, and it's yours to
 * move in. Drawn with the real sender and address when there's a payment to show.
 */
export function PrivateFlow({ receipt }: { receipt?: PrivateReceipt }) {
  const senderName = useSenderName()
  const from = receipt ? senderName(receipt.from) : 'Someone'
  return (
    <View style={styles.flow} accessible accessibilityLabel="Someone pays an address made for that payment alone, which only your keys can open">
      <View style={styles.flowEnd}>
        <Avatar name={from} id={receipt?.from ?? undefined} size={40} />
        <Txt weight="semi" size={12} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ maxWidth: 84 }}>
          {from}
        </Txt>
      </View>
      <View style={styles.flowLine} />
      <View style={styles.flowMiddle}>
        <AddressChip address={receipt?.stealthAddress} label={receipt ? undefined : 'its own address'} pending={!receipt} />
        <Txt size={11} color={colors.muted}>
          Monad sees this
        </Txt>
      </View>
      <View style={styles.flowLine} />
      <View style={styles.flowEnd}>
        <View style={styles.flowYou}>
          <Icon name="lock" size={18} color={colors.white} strokeWidth={2.3} />
        </View>
        <Txt weight="semi" size={12}>
          Only you
        </Txt>
      </View>
    </View>
  )
}

/** Whether anyone can send to this wallet privately, and the one tap that makes it so. */
export function ReceivingCard() {
  const p = usePrivate()
  const on = p.keysHere && p.published === true
  return (
    <View style={styles.receiving}>
      <View style={styles.receivingTop}>
        <View style={[styles.receivingIcon, { backgroundColor: on ? colors.tealSoft : colors.sunken }]}>
          <Icon name="lock" size={19} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt weight="semi" size={16}>
            {on ? 'Anyone can send to you privately' : p.keysHere ? 'Almost ready' : 'Not set up on this phone'}
          </Txt>
          <Txt size={13} color={colors.muted} style={{ lineHeight: 18 }}>
            {on
              ? 'Kova has your private key, signed by your wallet, so senders can check it’s really yours.'
              : p.keysHere
                ? 'Your keys are on this phone. Kova gets their public half as soon as it can be reached.'
                : 'Your wallet makes your private keys with one signature. They never leave this phone.'}
          </Txt>
        </View>
      </View>
      {p.keysHere ? null : (
        <View style={{ marginTop: 12 }}>
          <PillButton label={p.working ? 'Setting up…' : 'Set up'} icon="face" loading={p.working} onPress={() => void p.setUp()} />
        </View>
      )}
    </View>
  )
}

/**
 * When the balance is short but private dollars would cover it: move them in first, in one tap.
 * The wallet opens for it (Face ID once), so what comes next needs none. `compact`: the button
 * alone, where the screen already shows what you have.
 */
export function MoveInOffer({ short, compact }: { short: bigint; compact?: boolean }) {
  const p = usePrivate()
  if (p.waiting < short && !p.progress) return null
  const button = (
    <PillButton
      label={p.progress ? progressLabel(p.progress) : `Move in your private ${formatUsd(p.waiting)} first`}
      icon="receive"
      loading={Boolean(p.progress)}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        void p.moveIn({ openWallet: true })
      }}
    />
  )
  const problem =
    p.problem?.during === 'move' ? (
      <Txt weight="medium" size={13} color={colors.danger} style={{ marginTop: compact ? 8 : 0, textAlign: compact ? 'center' : 'left' }}>
        {p.problem.text}
      </Txt>
    ) : null
  if (compact)
    return (
      <View>
        {button}
        {problem}
      </View>
    )
  return (
    <View style={styles.offer}>
      <View style={styles.offerTop}>
        <View style={styles.offerLock}>
          <Icon name="lock" size={15} color={colors.white} strokeWidth={2.4} />
        </View>
        <Txt weight="medium" size={14} style={{ flex: 1, lineHeight: 19 }}>
          You’re {formatUsd(short)} short, but {formatUsd(p.waiting)} waits in your private dollars.
        </Txt>
      </View>
      {button}
      {problem}
    </View>
  )
}

/**
 * Send privately, on the review step: off by default, remembered once chosen. On, the card turns
 * ink and says exactly what Monad will and won't show.
 */
export function SendPrivately({
  on,
  onChange,
  amount,
  first,
  disabled,
}: {
  on: boolean
  onChange: (on: boolean) => void
  amount: bigint
  first: string
  disabled?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled: !!disabled }}
      accessibilityLabel={`Send privately. ${on ? `On. People on Monad will see you sent ${formatUsd(amount)}, but not to whom.` : 'Off.'}`}
      disabled={disabled}
      onPress={() => {
        void Haptics.selectionAsync()
        onChange(!on)
      }}
      style={[styles.send, on && styles.sendOn]}
    >
      <View style={[styles.sendLock, { backgroundColor: on ? colors.coral : colors.sunken }]}>
        <Icon name="lock" size={16} color={on ? colors.white : colors.ink} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt weight="semi" size={15} color={on ? colors.white : colors.ink}>
          Send privately
        </Txt>
        <Txt size={12} color={on ? colors.onInk : colors.muted} style={{ lineHeight: 16 }}>
          {on ? `On Monad, people will see you sent ${formatUsd(amount)}, but not to whom.` : `Hide who gets it from everyone but ${first}.`}
        </Txt>
      </View>
      <Switch
        value={on}
        disabled={disabled}
        onValueChange={(next) => {
          void Haptics.selectionAsync()
          onChange(next)
        }}
        trackColor={{ true: colors.teal, false: colors.sunken }}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    </Pressable>
  )
}

/** Where a private send went, in the sheet's Sent step and on its receipt: the one-time address, not them. */
export function SentPrivately({ amount, oneTime, first, txHash }: { amount: bigint; oneTime: string; first: string; txHash?: string }) {
  return (
    <View style={styles.sent}>
      <View style={styles.sentTag}>
        <Icon name="lock" size={13} color={colors.white} strokeWidth={2.4} />
        <Txt weight="semi" size={12} color={colors.white}>
          Sent privately
        </Txt>
      </View>
      <Txt size={14} color={colors.onTint} style={{ lineHeight: 20, marginTop: 8 }}>
        Monad shows {formatUsd(amount)} going to <Txt weight="semi" size={14}>{shortAddress(oneTime)}</Txt>, an address made for this payment
        alone. Only {first} can open it.
      </Txt>
      {txHash ? (
        <Pressable
          accessibilityRole="link"
          onPress={() => void WebBrowser.openBrowserAsync(explorerTx(txHash))}
          hitSlop={8}
          style={styles.sentLink}
        >
          <Icon name="web" size={15} />
          <Txt weight="semi" size={14} style={{ textDecorationLine: 'underline' }}>
            See it on Monadscan
          </Txt>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: 28, backgroundColor: colors.ink, padding: 18, overflow: 'hidden' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lockDisc: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.coral, alignItems: 'center', justifyContent: 'center' },
  amount: { marginTop: 12, letterSpacing: -1.6, lineHeight: 50 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  fromChip: {
    height: 28,
    maxWidth: 170,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.28)',
    flexDirection: 'row',
    alignItems: 'center',
  },
  foot: { textAlign: 'center', marginTop: 10, lineHeight: 17 },
  movedTag: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 26,
    paddingHorizontal: 10,
    marginTop: 14,
    borderRadius: 13,
    backgroundColor: colors.tealSoft,
  },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  ghost: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  doneButton: { height: 44, paddingHorizontal: 22, borderRadius: 22, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  problem: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 11 },
  rowRule: { borderBottomWidth: 1, borderColor: colors.sunken },
  flow: { flexDirection: 'row', alignItems: 'flex-start' },
  flowEnd: { alignItems: 'center', gap: 5, width: 84 },
  flowMiddle: { alignItems: 'center', gap: 5, paddingTop: 6 },
  flowLine: { flex: 1, height: 2, marginTop: 20, backgroundColor: colors.ink, minWidth: 8 },
  flowYou: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiving: { borderRadius: 24, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.surface, padding: 14 },
  receivingTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  receivingIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  offer: { borderRadius: 22, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.surface, padding: 12, gap: 10 },
  offerTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  offerLock: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  send: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 10,
  },
  sendOn: { backgroundColor: colors.ink },
  sendLock: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  sent: { alignSelf: 'stretch', borderRadius: 20, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.surface, padding: 14 },
  sentTag: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
    backgroundColor: colors.ink,
  },
  sentLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
})
